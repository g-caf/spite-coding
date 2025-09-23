import { Request, Response, NextFunction } from 'express';
import { AuthRequest } from './middleware/authentication';

export const organizationMiddleware = (req: AuthRequest, res: Response, next: NextFunction) => {
  const user = req.user;
  
  if (!user) {
    return res.status(401).json({
      error: 'Authentication required',
      code: 'UNAUTHORIZED'
    });
  }

  // Check organization context
  const organizationId = req.params.organizationId || req.body.organizationId || user.organization_id || user.organizationId;
  
  if (!organizationId) {
    return res.status(400).json({
      error: 'Organization context required',
      code: 'ORGANIZATION_REQUIRED'
    });
  }

  // Verify user belongs to the organization
  const userOrgId = user.organization_id || user.organizationId;
  if (userOrgId && userOrgId !== organizationId) {
    // Check if user has system admin privileges
    const isSystemAdmin = user.roles && user.roles.includes('SYSTEM_ADMIN');
    if (!isSystemAdmin) {
      return res.status(403).json({
        error: 'Access denied: Organization membership required',
        code: 'ORG_ACCESS_DENIED'
      });
    }
  }

  // Add organization context to request
  (req as any).organizationId = organizationId;
  
  next();
};

export default organizationMiddleware;
