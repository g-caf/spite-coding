const jwt = require('jsonwebtoken');
const authConfig = require('../../../config/auth');
const sessionManager = require('../session/manager');
const { logAuditEvent } = require('../utils/audit');
const { PermissionManager } = require('../rbac/permissions');

class AuthenticationMiddleware {
  // Main authentication middleware
  static authenticate(options = {}) {
    const { 
      required = true, 
      allowGuest = false,
      sessionOnly = false,
      jwtOnly = false 
    } = options;

    return async (req, res, next) => {
      try {
        let user = null;
        let authMethod = null;

        // Try session authentication first (unless JWT only)
        if (!jwtOnly && req.session && req.session.user) {
          user = req.session.user;
          authMethod = 'session';
          
          // Update session activity
          await sessionManager.updateSessionActivity(req);
        }
        
        // Try JWT authentication (unless session only)
        if (!sessionOnly && !user) {
          const token = AuthenticationMiddleware.extractToken(req);
          if (token) {
            try {
              const decoded = jwt.verify(token, authConfig.jwt.secret);
              user = await AuthenticationMiddleware.validateJWTUser(decoded);
              authMethod = 'jwt';
            } catch (jwtError) {
              if (required && !allowGuest) {
                return AuthenticationMiddleware.sendUnauthorized(res, 'Invalid token');
              }
            }
          }
        }

        // Set user context
        if (user) {
          req.user = user;
          req.authMethod = authMethod;
          
          // Ensure user has expanded permissions
          if (!user.expandedPermissions) {
            user.expandedPermissions = PermissionManager.getUserPermissions(user.roles || []);
          }
        }

        // Check if authentication is required
        if (required && !user && !allowGuest) {
          return AuthenticationMiddleware.sendUnauthorized(res, 'Authentication required');
        }

        next();
      } catch (error) {
        console.error('Authentication middleware error:', error);
        if (required && !allowGuest) {
          return AuthenticationMiddleware.sendUnauthorized(res, 'Authentication failed');
        }
        next();
      }
    };
  }

  // Require authentication (shorthand)
  static requireAuth() {
    return AuthenticationMiddleware.authenticate({ required: true });
  }

  // Optional authentication
  static optionalAuth() {
    return AuthenticationMiddleware.authenticate({ required: false, allowGuest: true });
  }

  // Session-only authentication
  static requireSession() {
    return AuthenticationMiddleware.authenticate({ 
      required: true, 
      sessionOnly: true 
    });
  }

  // JWT-only authentication
  static requireJWT() {
    return AuthenticationMiddleware.authenticate({ 
      required: true, 
      jwtOnly: true 
    });
  }

  // MFA verification middleware
  static requireMFA() {
    return (req, res, next) => {
      const user = req.user;
      
      if (!user) {
        return AuthenticationMiddleware.sendUnauthorized(res, 'Authentication required');
      }

      // Check if MFA is required but not verified
      if (user.mfaEnabled && !req.session.mfaVerified) {
        return res.status(403).json({
          error: 'MFA verification required',
          code: 'MFA_REQUIRED',
          redirectTo: '/auth/mfa/verify'
        });
      }

      next();
    };
  }

  // Organization membership middleware
  static requireOrganization(organizationId = null) {
    return (req, res, next) => {
      const user = req.user;
      
      if (!user) {
        return AuthenticationMiddleware.sendUnauthorized(res, 'Authentication required');
      }

      const requiredOrgId = organizationId || req.params.organizationId || req.body.organizationId;
      
      if (requiredOrgId && user.organizationId !== requiredOrgId) {
        // Check if user has cross-org access
        if (!PermissionManager.hasPermission(user.expandedPermissions, 'admin:system_settings')) {
          return res.status(403).json({
            error: 'Access denied: Organization membership required',
            code: 'ORG_ACCESS_DENIED'
          });
        }
      }

      next();
    };
  }

  // Admin-only middleware
  static requireAdmin() {
    return (req, res, next) => {
      const user = req.user;
      
      if (!user) {
        return AuthenticationMiddleware.sendUnauthorized(res, 'Authentication required');
      }

      const hasAdminRole = user.roles && (
        user.roles.includes('SYSTEM_ADMIN') || 
        user.roles.includes('ORG_ADMIN')
      );

      if (!hasAdminRole) {
        return res.status(403).json({
          error: 'Access denied: Admin privileges required',
          code: 'ADMIN_ACCESS_REQUIRED'
        });
      }

      next();
    };
  }

  // Rate limiting middleware for authentication
  static rateLimitAuth() {
    const rateLimit = require('express-rate-limit');
    
    return rateLimit({
      windowMs: authConfig.rateLimit.windowMs,
      max: authConfig.rateLimit.max,
      message: authConfig.rateLimit.message,
      standardHeaders: authConfig.rateLimit.standardHeaders,
      legacyHeaders: authConfig.rateLimit.legacyHeaders,
      keyGenerator: (req) => {
        // Rate limit by IP + email if provided
        const email = req.body.email || req.body.username;
        return email ? `${req.ip}:${email}` : req.ip;
      },
      handler: async (req, res) => {
        // Log rate limit exceeded
        await logAuditEvent({
          event: 'rate_limit_exceeded',
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
          email: req.body.email || req.body.username,
          endpoint: req.path,
          success: false,
        });

        res.status(429).json(authConfig.rateLimit.message);
      },
    });
  }

  // Extract JWT token from request
  static extractToken(req) {
    // Check Authorization header
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }

    // Check query parameter
    if (req.query.token) {
      return req.query.token;
    }

    // Check cookies
    if (req.cookies && req.cookies.accessToken) {
      return req.cookies.accessToken;
    }

    return null;
  }

  // Validate JWT user data
  static async validateJWTUser(decoded) {
    // Basic validation
    if (!decoded.id || !decoded.email) {
      throw new Error('Invalid token payload');
    }

    // Check token expiration
    if (decoded.exp && Date.now() >= decoded.exp * 1000) {
      throw new Error('Token expired');
    }

    // Return user object
    return {
      id: decoded.id,
      email: decoded.email,
      firstName: decoded.firstName,
      lastName: decoded.lastName,
      organizationId: decoded.organizationId,
      roles: decoded.roles || [],
      permissions: decoded.permissions || [],
      mfaEnabled: decoded.mfaEnabled || false,
    };
  }

  // Send unauthorized response
  static sendUnauthorized(res, message = 'Unauthorized') {
    return res.status(401).json({
      error: message,
      code: 'UNAUTHORIZED',
    });
  }

  // Check if user is authenticated
  static isAuthenticated(req) {
    return !!req.user;
  }

  // Get current user
  static getCurrentUser(req) {
    return req.user || null;
  }

  // Logout middleware
  static logout() {
    return async (req, res, next) => {
      try {
        if (req.session) {
          await sessionManager.destroySession(req, res);
        }

        // Clear JWT cookies if present
        res.clearCookie('accessToken');
        res.clearCookie('refreshToken');

        // Clear user context
        req.user = null;
        req.authMethod = null;

        next();
      } catch (error) {
        console.error('Logout middleware error:', error);
        next(error);
      }
    };
  }
}

module.exports = AuthenticationMiddleware;