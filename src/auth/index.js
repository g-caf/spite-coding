const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const sessionManager = require('./session/manager');
const samlConfig = require('./saml/config');
const AuthenticationMiddleware = require('./middleware/authentication');
const AuthorizationMiddleware = require('./middleware/authorization');
const MFAManager = require('./security/mfa');
const CSRFProtection = require('./security/csrf');
const { UserManagementService } = require('./utils/userManagement');
const { logAuditEvent } = require('./utils/audit');
const authConfig = require('../../config/auth');

class AuthenticationSystem {
  constructor() {
    this.initialized = false;
  }

  // Initialize the complete authentication system
  async initialize(app) {
    try {
      console.log('Initializing Enterprise Authentication System...');

      // Initialize session manager
      await sessionManager.initialize();

      // Configure passport
      this.configurePassport();

      // Initialize SAML strategies
      samlConfig.initializeStrategies();

      // Apply middleware to Express app
      this.applyMiddleware(app);

      // Configure authentication routes
      this.configureRoutes(app);

      this.initialized = true;
      console.log('Authentication System initialized successfully');
    } catch (error) {
      console.error('Failed to initialize Authentication System:', error);
      throw error;
    }
  }

  // Configure passport strategies
  configurePassport() {
    // Configure local strategy for username/password authentication
    passport.use(new LocalStrategy(
      {
        usernameField: 'email',
        passwordField: 'password',
        passReqToCallback: true,
      },
      async (req, email, password, done) => {
        try {
          // Find user by email
          const user = await UserManagementService.findUserByEmail(email);
          
          if (!user) {
            await logAuditEvent({
              event: 'login_failure',
              email,
              reason: 'User not found',
              ipAddress: req.ip,
              userAgent: req.get('User-Agent'),
              success: false,
            });

            return done(null, false, { message: 'Invalid credentials' });
          }

          // Check if user is active
          if (!user.isActive) {
            await logAuditEvent({
              event: 'login_failure',
              userId: user.id,
              email,
              reason: 'Account deactivated',
              ipAddress: req.ip,
              userAgent: req.get('User-Agent'),
              success: false,
            });

            return done(null, false, { message: 'Account deactivated' });
          }

          // Verify password
          const isValidPassword = await UserManagementService.verifyPassword(user, password);
          
          if (!isValidPassword) {
            await logAuditEvent({
              event: 'login_failure',
              userId: user.id,
              email,
              reason: 'Invalid password',
              ipAddress: req.ip,
              userAgent: req.get('User-Agent'),
              success: false,
            });

            return done(null, false, { message: 'Invalid credentials' });
          }

          // Log successful login
          await logAuditEvent({
            event: 'login_success',
            userId: user.id,
            email,
            provider: 'local',
            ipAddress: req.ip,
            userAgent: req.get('User-Agent'),
            success: true,
          });

          return done(null, user);
        } catch (error) {
          console.error('Local authentication error:', error);
          return done(error);
        }
      }
    ));

    // Serialize user for session
    passport.serializeUser((user, done) => {
      done(null, {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        organizationId: user.organizationId,
        roles: user.roles,
        permissions: user.permissions,
        mfaEnabled: user.mfaEnabled,
      });
    });

    // Deserialize user from session
    passport.deserializeUser(async (sessionUser, done) => {
      try {
        // You might want to refresh user data from database here
        // For now, just return the session user
        done(null, sessionUser);
      } catch (error) {
        done(error);
      }
    });
  }

  // Apply authentication middleware to Express app
  applyMiddleware(app) {
    const cookieParser = require('cookie-parser');
    const helmet = require('helmet');

    // Security headers
    app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "https:"],
        },
      },
      hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true,
      },
    }));

    // Cookie parser
    app.use(cookieParser());

    // Session management
    app.use(sessionManager.getSessionMiddleware());

    // Passport initialization
    app.use(passport.initialize());
    app.use(passport.session());

    // Rate limiting for authentication routes
    app.use('/auth', AuthenticationMiddleware.rateLimitAuth());

    // CSRF protection (exempt some routes)
    app.use(CSRFProtection.exemptRoutes([
      '/auth/api/login',
      '/auth/api/refresh',
      '/auth/saml/*/callback',
    ]));

    console.log('Authentication middleware applied successfully');
  }

  // Configure authentication routes
  configureRoutes(app) {
    const express = require('express');
    const jwt = require('jsonwebtoken');
    const router = express.Router();

    // Local login route
    router.post('/login', 
      AuthenticationMiddleware.rateLimitAuth(),
      CSRFProtection.validateToken(),
      passport.authenticate('local'),
      async (req, res) => {
        try {
          const user = req.user;
          
          // Create session
          const sessionId = await sessionManager.createSession(req, user);
          
          // Check if MFA is required
          if (user.mfaEnabled) {
            req.session.mfaPending = true;
            return res.json({
              success: true,
              requireMFA: true,
              redirectTo: '/auth/mfa/verify',
            });
          }

          res.json({
            success: true,
            user: {
              id: user.id,
              email: user.email,
              firstName: user.firstName,
              lastName: user.lastName,
              roles: user.roles,
            },
            sessionId,
          });
        } catch (error) {
          console.error('Login error:', error);
          res.status(500).json({
            success: false,
            error: 'Internal server error',
          });
        }
      }
    );

    // MFA verification route
    router.post('/mfa/verify',
      AuthenticationMiddleware.requireAuth(),
      async (req, res) => {
        try {
          const { token, backupCode } = req.body;
          const user = req.user;

          let mfaResult;
          if (token) {
            mfaResult = await MFAManager.verifyLoginMFA(user.id, token, req);
          } else if (backupCode) {
            mfaResult = await MFAManager.verifyBackupCode(user.id, backupCode, req);
          } else {
            return res.status(400).json({
              success: false,
              error: 'Token or backup code required',
            });
          }

          if (mfaResult.success) {
            req.session.mfaVerified = true;
            req.session.mfaPending = false;

            return res.json({
              success: true,
              message: 'MFA verification successful',
            });
          } else {
            return res.status(400).json({
              success: false,
              error: mfaResult.error,
            });
          }
        } catch (error) {
          console.error('MFA verification error:', error);
          res.status(500).json({
            success: false,
            error: 'Internal server error',
          });
        }
      }
    );

    // SAML routes
    const availableProviders = samlConfig.getAvailableProviders();
    availableProviders.forEach(provider => {
      // SAML login
      router.get(`/saml/${provider}`, 
        passport.authenticate(`saml-${provider}`)
      );

      // SAML callback
      router.post(`/saml/${provider}/callback`,
        passport.authenticate(`saml-${provider}`, {
          failureRedirect: '/login?error=saml_failure',
        }),
        async (req, res) => {
          try {
            const user = req.user;
            await sessionManager.createSession(req, user);

            if (user.mfaEnabled) {
              req.session.mfaPending = true;
              return res.redirect('/auth/mfa/verify');
            }

            res.redirect('/dashboard');
          } catch (error) {
            console.error('SAML callback error:', error);
            res.redirect('/login?error=callback_error');
          }
        }
      );

      // SAML metadata
      router.get(`/saml/${provider}/metadata`, (req, res) => {
        try {
          const metadata = samlConfig.generateMetadata(provider);
          res.type('application/xml');
          res.send(metadata);
        } catch (error) {
          console.error('SAML metadata error:', error);
          res.status(500).send('Error generating metadata');
        }
      });
    });

    // JWT API routes
    router.post('/api/login',
      express.json(),
      async (req, res) => {
        try {
          const { email, password } = req.body;

          const user = await UserManagementService.findUserByEmail(email);
          if (!user || !user.isActive) {
            return res.status(401).json({
              success: false,
              error: 'Invalid credentials',
            });
          }

          const isValidPassword = await UserManagementService.verifyPassword(user, password);
          if (!isValidPassword) {
            return res.status(401).json({
              success: false,
              error: 'Invalid credentials',
            });
          }

          // Generate JWT tokens
          const accessToken = jwt.sign(
            {
              id: user.id,
              email: user.email,
              organizationId: user.organizationId,
              roles: user.roles,
              permissions: user.permissions,
            },
            authConfig.jwt.secret,
            { 
              expiresIn: authConfig.jwt.expiresIn,
              algorithm: authConfig.jwt.algorithm,
            }
          );

          const refreshToken = jwt.sign(
            { id: user.id, type: 'refresh' },
            authConfig.jwt.secret,
            { 
              expiresIn: authConfig.jwt.refreshTokenExpiresIn,
              algorithm: authConfig.jwt.algorithm,
            }
          );

          res.json({
            success: true,
            accessToken,
            refreshToken,
            expiresIn: authConfig.jwt.expiresIn,
            user: {
              id: user.id,
              email: user.email,
              firstName: user.firstName,
              lastName: user.lastName,
              roles: user.roles,
            },
          });

        } catch (error) {
          console.error('API login error:', error);
          res.status(500).json({
            success: false,
            error: 'Internal server error',
          });
        }
      }
    );

    // Logout route
    router.post('/logout',
      AuthenticationMiddleware.logout(),
      (req, res) => {
        res.json({ success: true, message: 'Logged out successfully' });
      }
    );

    // Current user route
    router.get('/me',
      AuthenticationMiddleware.requireAuth(),
      (req, res) => {
        res.json({
          success: true,
          user: req.user,
        });
      }
    );

    // Mount auth routes
    app.use('/auth', router);

    console.log('Authentication routes configured successfully');
  }

  // Get authentication middleware
  getMiddleware() {
    if (!this.initialized) {
      throw new Error('Authentication system not initialized');
    }

    return {
      // Authentication middleware
      authenticate: AuthenticationMiddleware.authenticate.bind(AuthenticationMiddleware),
      requireAuth: AuthenticationMiddleware.requireAuth.bind(AuthenticationMiddleware),
      requireSession: AuthenticationMiddleware.requireSession.bind(AuthenticationMiddleware),
      requireJWT: AuthenticationMiddleware.requireJWT.bind(AuthenticationMiddleware),
      requireMFA: AuthenticationMiddleware.requireMFA.bind(AuthenticationMiddleware),
      requireAdmin: AuthenticationMiddleware.requireAdmin.bind(AuthenticationMiddleware),

      // Authorization middleware  
      requirePermission: AuthorizationMiddleware.requirePermission.bind(AuthorizationMiddleware),
      requireRole: AuthorizationMiddleware.requireRole.bind(AuthorizationMiddleware),
      requireResourceAccess: AuthorizationMiddleware.requireResourceAccess.bind(AuthorizationMiddleware),
      requireOrganizationScope: AuthorizationMiddleware.requireOrganizationScope.bind(AuthorizationMiddleware),

      // Security middleware
      csrfProtection: CSRFProtection.createMiddleware.bind(CSRFProtection),
      rateLimitAuth: AuthenticationMiddleware.rateLimitAuth.bind(AuthenticationMiddleware),
    };
  }

  // Shutdown handler
  async shutdown() {
    try {
      await sessionManager.close();
      console.log('Authentication system shutdown complete');
    } catch (error) {
      console.error('Error during authentication system shutdown:', error);
    }
  }
}

// Create singleton instance
const authSystem = new AuthenticationSystem();

module.exports = {
  AuthenticationSystem,
  authSystem,
  // Export middleware for direct use
  ...authSystem.getMiddleware,
};