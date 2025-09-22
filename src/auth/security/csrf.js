const csrf = require('csurf');
const authConfig = require('../../../config/auth');

class CSRFProtection {
  // Create CSRF middleware with custom configuration
  static createMiddleware(options = {}) {
    const defaultOptions = {
      cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        key: '_csrf',
      },
      ignoreMethods: ['GET', 'HEAD', 'OPTIONS'],
      value: (req) => {
        // Check multiple places for CSRF token
        return (
          req.body._csrf ||
          req.query._csrf ||
          req.headers['csrf-token'] ||
          req.headers['xsrf-token'] ||
          req.headers['x-csrf-token'] ||
          req.headers['x-xsrf-token']
        );
      },
      ...options,
    };

    return csrf(defaultOptions);
  }

  // Standard CSRF protection for web forms
  static protectForms() {
    return this.createMiddleware({
      cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        key: '_csrf',
      },
    });
  }

  // CSRF protection for API routes
  static protectAPI() {
    return this.createMiddleware({
      cookie: false, // Use session-based CSRF for API
      sessionKey: 'csrfSecret',
      value: (req) => {
        return req.headers['x-csrf-token'] || req.headers['csrf-token'];
      },
    });
  }

  // Double Submit Cookie pattern for SPA applications
  static doubleSubmitCookie() {
    return (req, res, next) => {
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
        const tokenFromHeader = req.headers['x-csrf-token'];
        const tokenFromCookie = req.cookies.csrfToken;

        if (!tokenFromHeader || !tokenFromCookie || tokenFromHeader !== tokenFromCookie) {
          return res.status(403).json({
            error: 'CSRF token validation failed',
            code: 'CSRF_VALIDATION_FAILED',
          });
        }
      }

      next();
    };
  }

  // Generate and set CSRF token for SPA
  static generateTokenForSPA() {
    return (req, res, next) => {
      const crypto = require('crypto');
      const token = crypto.randomBytes(32).toString('hex');
      
      // Set token in cookie for client-side access
      res.cookie('csrfToken', token, {
        httpOnly: false, // Client needs to read this
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 30 * 60 * 1000, // 30 minutes
      });

      // Also make it available in response for immediate use
      res.locals.csrfToken = token;
      
      next();
    };
  }

  // Custom CSRF validation middleware
  static validateToken() {
    return (req, res, next) => {
      // Skip validation for safe methods
      if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        return next();
      }

      // Skip validation for API authentication routes
      if (req.path.startsWith('/auth/api/')) {
        return next();
      }

      // Get token from various sources
      const token = this.extractToken(req);
      const sessionToken = req.session?.csrfToken;

      if (!token || !sessionToken || token !== sessionToken) {
        return res.status(403).json({
          error: 'CSRF token validation failed',
          code: 'CSRF_VALIDATION_FAILED',
        });
      }

      next();
    };
  }

  // Extract CSRF token from request
  static extractToken(req) {
    return (
      req.body._csrf ||
      req.query._csrf ||
      req.headers['csrf-token'] ||
      req.headers['x-csrf-token'] ||
      req.headers['x-xsrf-token']
    );
  }

  // Middleware to add CSRF token to response locals
  static addTokenToLocals() {
    return (req, res, next) => {
      if (req.csrfToken) {
        res.locals.csrfToken = req.csrfToken();
      }
      next();
    };
  }

  // Error handler for CSRF token validation errors
  static errorHandler() {
    return (error, req, res, next) => {
      if (error.code === 'EBADCSRFTOKEN') {
        return res.status(403).json({
          error: 'CSRF token validation failed',
          code: 'CSRF_VALIDATION_FAILED',
          message: 'Form tampered with or expired. Please refresh and try again.',
        });
      }
      
      next(error);
    };
  }

  // Generate CSRF token for manual use
  static generateToken() {
    const crypto = require('crypto');
    return crypto.randomBytes(32).toString('hex');
  }

  // Validate CSRF token manually
  static validateTokenManual(providedToken, storedToken) {
    if (!providedToken || !storedToken) {
      return false;
    }

    // Use timing-safe comparison to prevent timing attacks
    const crypto = require('crypto');
    
    const providedHash = crypto.createHash('sha256').update(providedToken).digest();
    const storedHash = crypto.createHash('sha256').update(storedToken).digest();
    
    return crypto.timingSafeEqual(providedHash, storedHash);
  }

  // Middleware for handling AJAX requests with CSRF
  static ajaxCSRF() {
    return (req, res, next) => {
      // Set CSRF token in response headers for AJAX requests
      if (req.xhr || req.headers['content-type'] === 'application/json') {
        res.set('X-CSRF-Token', req.csrfToken ? req.csrfToken() : '');
      }
      next();
    };
  }

  // Create CSRF protection based on request type
  static adaptiveProtection() {
    return (req, res, next) => {
      const isAPI = req.path.startsWith('/api/');
      const isAjax = req.xhr || req.headers['content-type'] === 'application/json';
      
      if (isAPI || isAjax) {
        // Use header-based CSRF for API/AJAX
        return this.protectAPI()(req, res, next);
      } else {
        // Use form-based CSRF for traditional web requests
        return this.protectForms()(req, res, next);
      }
    };
  }

  // Middleware to exempt certain routes from CSRF protection
  static exemptRoutes(routes = []) {
    return (req, res, next) => {
      const isExempt = routes.some(route => {
        if (typeof route === 'string') {
          return req.path === route;
        } else if (route instanceof RegExp) {
          return route.test(req.path);
        }
        return false;
      });

      if (isExempt) {
        return next();
      }

      // Apply CSRF protection
      return this.createMiddleware()(req, res, next);
    };
  }
}

module.exports = CSRFProtection;