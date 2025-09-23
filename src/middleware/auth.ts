/**
 * Authentication and Authorization Middleware
 */

import { Request, Response, NextFunction } from 'express';
import * as jwt from 'jsonwebtoken';
import { logger } from '../utils/logger.js';

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        organization_id: string;
        role: string;
      };
    }
  }
}

/**
 * Authenticate user from JWT token or session
 */
export const authenticateUser = (req: Request, res: Response, next: NextFunction) => {
  try {
    // Try JWT token first (for API access)
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret') as any;
        req.user = {
          id: decoded.userId,
          email: decoded.email,
          organization_id: decoded.organizationId,
          role: decoded.role
        };
        return next();
      } catch (jwtError) {
        logger.warn('Invalid JWT token', { error: jwtError });
      }
    }

    // Try session authentication (for web interface)
    if ((req as any).session?.user) {
      req.user = (req as any).session.user;
      return next();
    }

    // No authentication found
    return res.status(401).json({
      success: false,
      error: 'Authentication required'
    });

  } catch (error) {
    logger.error('Authentication error', {
      error: error instanceof Error ? error.message : String(error)
    });
    
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
};

/**
 * Require organization context
 */
export const requireOrganization = (req: Request, res: Response, next: NextFunction) => {
  if (!req.user?.organization_id) {
    return res.status(400).json({
      success: false,
      error: 'Organization context required'
    });
  }
  
  next();
};

/**
 * Require specific role
 */
export const requireRole = (requiredRole: string) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user?.role || req.user.role !== requiredRole) {
      return res.status(403).json({
        success: false,
        error: `Role '${requiredRole}' required`
      });
    }
    
    next();
  };
};

/**
 * Require one of multiple roles
 */
export const requireAnyRole = (roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user?.role || !roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: `One of roles [${roles.join(', ')}] required`
      });
    }
    
    next();
  };
};
