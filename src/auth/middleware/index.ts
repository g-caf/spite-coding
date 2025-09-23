// Import and re-export authentication middleware (JavaScript files)
const AuthenticationMiddleware = require('./authentication');
const { 
  authenticate, requireAuth, authenticateToken, optionalAuth, 
  requireSession, requireJWT, requireMFA, requireOrganization, requireAdmin 
} = require('./authentication');

// Import and re-export authorization middleware (JavaScript files)
const AuthorizationMiddleware = require('./authorization');
const { 
  requirePermission, requirePermissions, requireAnyPermission, 
  requireAllPermissions, requireRole, requireAnyRole, requireResource 
} = require('./authorization');

// Re-export all functions
export { 
  AuthenticationMiddleware, authenticate, requireAuth, authenticateToken, 
  optionalAuth, requireSession, requireJWT, requireMFA, requireOrganization, 
  requireAdmin, AuthorizationMiddleware, requirePermission, requirePermissions, 
  requireAnyPermission, requireAllPermissions, requireRole, requireAnyRole, 
  requireResource 
};

// Export authMiddleware alias for backwards compatibility
export const authMiddleware = AuthenticationMiddleware;

// Common middleware combinations
export const requireAuthAndPermission = (permission: string) => {
  return [
    AuthenticationMiddleware.requireAuth(),
    AuthorizationMiddleware.requirePermission(permission)
  ];
};

export const requireAuthAndRole = (role: string) => {
  return [
    AuthenticationMiddleware.requireAuth(),
    AuthorizationMiddleware.requireRole(role)
  ];
};
