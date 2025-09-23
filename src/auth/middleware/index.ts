// Import and re-export authentication middleware
import AuthenticationMiddleware, { 
  authenticate, requireAuth, authenticateToken, optionalAuth, 
  requireSession, requireJWT, requireMFA, requireOrganization, requireAdmin 
} from './authentication';

// Import and re-export authorization middleware
import AuthorizationMiddleware, { 
  requirePermission, requirePermissions, requireAnyPermission, 
  requireAllPermissions, requireRole, requireAnyRole, requireResource 
} from './authorization';

// Re-export all functions
export { 
  AuthenticationMiddleware, authenticate, requireAuth, authenticateToken, 
  optionalAuth, requireSession, requireJWT, requireMFA, requireOrganization, 
  requireAdmin, AuthorizationMiddleware, requirePermission, requirePermissions, 
  requireAnyPermission, requireAllPermissions, requireRole, requireAnyRole, 
  requireResource 
};

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
