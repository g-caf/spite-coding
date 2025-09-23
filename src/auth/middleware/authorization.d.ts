import { Request, Response, NextFunction } from 'express';
import { AuthRequest } from './authentication';

declare class AuthorizationMiddleware {
  static requirePermission(permission: string): (req: AuthRequest, res: Response, next: NextFunction) => void;
  static requireAnyPermission(permissions: string[]): (req: AuthRequest, res: Response, next: NextFunction) => void;
  static requireAllPermissions(permissions: string[]): (req: AuthRequest, res: Response, next: NextFunction) => void;
  static requireRole(role: string): (req: AuthRequest, res: Response, next: NextFunction) => void;
  static requireAnyRole(roles: string[]): (req: AuthRequest, res: Response, next: NextFunction) => void;
  static requireResource(resourceType: string, action: string): (req: AuthRequest, res: Response, next: NextFunction) => void;
  static requireOrganization(organizationField?: string): (req: AuthRequest, res: Response, next: NextFunction) => void;
  static sendForbidden(res: Response, message?: string): Response;
  static hasPermission(user: any, permission: string): boolean;
  static canAccessResource(user: any, resourceType: string, action: string, resource?: any): boolean;
}

// Export individual methods as named exports
export const requirePermission = AuthorizationMiddleware.requirePermission;
export const requirePermissions = (permissions: string | string[]) => {
  if (Array.isArray(permissions)) {
    return AuthorizationMiddleware.requireAnyPermission(permissions);
  } else {
    return AuthorizationMiddleware.requirePermission(permissions);
  }
};
export const requireAnyPermission = AuthorizationMiddleware.requireAnyPermission;
export const requireAllPermissions = AuthorizationMiddleware.requireAllPermissions;
export const requireRole = AuthorizationMiddleware.requireRole;
export const requireAnyRole = AuthorizationMiddleware.requireAnyRole;
export const requireResource = AuthorizationMiddleware.requireResource;

export = AuthorizationMiddleware;
