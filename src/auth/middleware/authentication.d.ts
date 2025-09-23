import { Request, Response, NextFunction } from 'express';

export interface AuthUser {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  organizationId?: string;
  organization_id?: string;
  roles?: string[];
  permissions?: string[];
  mfaEnabled?: boolean;
  expandedPermissions?: string[];
}

export interface AuthRequest extends Request {
  user?: AuthUser;
  authMethod?: 'session' | 'jwt';
}

export interface AuthOptions {
  required?: boolean;
  allowGuest?: boolean;
  sessionOnly?: boolean;
  jwtOnly?: boolean;
}

declare class AuthenticationMiddleware {
  static authenticate(options?: AuthOptions): (req: AuthRequest, res: Response, next: NextFunction) => Promise<void>;
  static requireAuth(): (req: AuthRequest, res: Response, next: NextFunction) => Promise<void>;
  static optionalAuth(): (req: AuthRequest, res: Response, next: NextFunction) => Promise<void>;
  static requireSession(): (req: AuthRequest, res: Response, next: NextFunction) => Promise<void>;
  static requireJWT(): (req: AuthRequest, res: Response, next: NextFunction) => Promise<void>;
  static requireMFA(): (req: AuthRequest, res: Response, next: NextFunction) => void;
  static requireOrganization(organizationId?: string | null): (req: AuthRequest, res: Response, next: NextFunction) => void;
  static requireAdmin(): (req: AuthRequest, res: Response, next: NextFunction) => void;
  static rateLimitAuth(): (req: Request, res: Response, next: NextFunction) => void;
  static extractToken(req: Request): string | null;
  static validateJWTUser(decoded: any): Promise<AuthUser>;
  static sendUnauthorized(res: Response, message?: string): Response;
  static isAuthenticated(req: AuthRequest): boolean;
  static getCurrentUser(req: AuthRequest): AuthUser | null;
  static logout(): (req: AuthRequest, res: Response, next: NextFunction) => Promise<void>;
}

// Export individual methods as named exports
export const authenticate = AuthenticationMiddleware.authenticate;
export const requireAuth = AuthenticationMiddleware.requireAuth;
export const authenticateToken = AuthenticationMiddleware.requireAuth; // Alias
export const optionalAuth = AuthenticationMiddleware.optionalAuth;
export const requireSession = AuthenticationMiddleware.requireSession;
export const requireJWT = AuthenticationMiddleware.requireJWT;
export const requireMFA = AuthenticationMiddleware.requireMFA;
export const requireOrganization = AuthenticationMiddleware.requireOrganization;
export const requireAdmin = AuthenticationMiddleware.requireAdmin;

export = AuthenticationMiddleware;
