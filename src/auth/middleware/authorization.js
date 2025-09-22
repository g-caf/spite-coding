const { PermissionManager } = require('../rbac/permissions');
const { logAuditEvent } = require('../utils/audit');

class AuthorizationMiddleware {
  // Require specific permission
  static requirePermission(permission) {
    return (req, res, next) => {
      const user = req.user;
      
      if (!user) {
        return AuthorizationMiddleware.sendForbidden(res, 'Authentication required');
      }

      const hasPermission = PermissionManager.hasPermission(
        user.expandedPermissions || user.permissions || [],
        permission
      );

      if (!hasPermission) {
        // Log authorization failure
        logAuditEvent({
          event: 'authorization_denied',
          userId: user.id,
          permission,
          endpoint: req.path,
          method: req.method,
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
          success: false,
        }).catch(console.error);

        return AuthorizationMiddleware.sendForbidden(
          res, 
          `Permission required: ${permission}`
        );
      }

      next();
    };
  }

  // Require any of the specified permissions
  static requireAnyPermission(permissions) {
    return (req, res, next) => {
      const user = req.user;
      
      if (!user) {
        return AuthorizationMiddleware.sendForbidden(res, 'Authentication required');
      }

      const hasAnyPermission = PermissionManager.hasAnyPermission(
        user.expandedPermissions || user.permissions || [],
        permissions
      );

      if (!hasAnyPermission) {
        // Log authorization failure
        logAuditEvent({
          event: 'authorization_denied',
          userId: user.id,
          permissions,
          endpoint: req.path,
          method: req.method,
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
          success: false,
        }).catch(console.error);

        return AuthorizationMiddleware.sendForbidden(
          res, 
          `One of these permissions required: ${permissions.join(', ')}`
        );
      }

      next();
    };
  }

  // Require all of the specified permissions
  static requireAllPermissions(permissions) {
    return (req, res, next) => {
      const user = req.user;
      
      if (!user) {
        return AuthorizationMiddleware.sendForbidden(res, 'Authentication required');
      }

      const hasAllPermissions = PermissionManager.hasAllPermissions(
        user.expandedPermissions || user.permissions || [],
        permissions
      );

      if (!hasAllPermissions) {
        // Log authorization failure
        logAuditEvent({
          event: 'authorization_denied',
          userId: user.id,
          permissions,
          endpoint: req.path,
          method: req.method,
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
          success: false,
        }).catch(console.error);

        return AuthorizationMiddleware.sendForbidden(
          res, 
          `All of these permissions required: ${permissions.join(', ')}`
        );
      }

      next();
    };
  }

  // Require specific role
  static requireRole(role) {
    return (req, res, next) => {
      const user = req.user;
      
      if (!user) {
        return AuthorizationMiddleware.sendForbidden(res, 'Authentication required');
      }

      const hasRole = user.roles && user.roles.includes(role.toUpperCase());

      if (!hasRole) {
        // Log authorization failure
        logAuditEvent({
          event: 'authorization_denied',
          userId: user.id,
          role,
          endpoint: req.path,
          method: req.method,
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
          success: false,
        }).catch(console.error);

        return AuthorizationMiddleware.sendForbidden(
          res, 
          `Role required: ${role}`
        );
      }

      next();
    };
  }

  // Require any of the specified roles
  static requireAnyRole(roles) {
    return (req, res, next) => {
      const user = req.user;
      
      if (!user) {
        return AuthorizationMiddleware.sendForbidden(res, 'Authentication required');
      }

      const hasAnyRole = roles.some(role => 
        user.roles && user.roles.includes(role.toUpperCase())
      );

      if (!hasAnyRole) {
        // Log authorization failure
        logAuditEvent({
          event: 'authorization_denied',
          userId: user.id,
          roles,
          endpoint: req.path,
          method: req.method,
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
          success: false,
        }).catch(console.error);

        return AuthorizationMiddleware.sendForbidden(
          res, 
          `One of these roles required: ${roles.join(', ')}`
        );
      }

      next();
    };
  }

  // Resource-based access control
  static requireResourceAccess(resourceType, action, resourceIdParam = 'id') {
    return async (req, res, next) => {
      const user = req.user;
      
      if (!user) {
        return AuthorizationMiddleware.sendForbidden(res, 'Authentication required');
      }

      try {
        // Get resource from request parameters, body, or query
        const resourceId = req.params[resourceIdParam] || 
                          req.body[resourceIdParam] || 
                          req.query[resourceIdParam];

        // Fetch resource to check ownership/organization
        const resource = await AuthorizationMiddleware.fetchResource(
          resourceType, 
          resourceId
        );

        if (!resource) {
          return res.status(404).json({
            error: 'Resource not found',
            code: 'RESOURCE_NOT_FOUND'
          });
        }

        // Check permission with context
        const canAccess = PermissionManager.canAccessResource(
          user.expandedPermissions || user.permissions || [],
          resourceType,
          action,
          {
            user,
            targetResource: resource,
            organization: { id: user.organizationId }
          }
        );

        if (!canAccess) {
          // Log authorization failure
          await logAuditEvent({
            event: 'resource_access_denied',
            userId: user.id,
            resourceType,
            resourceId,
            action,
            endpoint: req.path,
            method: req.method,
            ipAddress: req.ip,
            userAgent: req.get('User-Agent'),
            success: false,
          });

          return AuthorizationMiddleware.sendForbidden(
            res, 
            `Access denied to ${resourceType}:${action}`
          );
        }

        // Attach resource to request for use in route handler
        req.resource = resource;
        next();
      } catch (error) {
        console.error('Resource access check error:', error);
        return res.status(500).json({
          error: 'Internal server error',
          code: 'INTERNAL_ERROR'
        });
      }
    };
  }

  // Organization-scoped access (users can only access their org's data)
  static requireOrganizationScope(strict = true) {
    return (req, res, next) => {
      const user = req.user;
      
      if (!user) {
        return AuthorizationMiddleware.sendForbidden(res, 'Authentication required');
      }

      // Add organization filter to query
      if (strict) {
        // Force organization ID in query parameters
        req.query.organizationId = user.organizationId;
        
        // Also add to body if it's a POST/PUT request
        if (req.method === 'POST' || req.method === 'PUT') {
          req.body.organizationId = user.organizationId;
        }
      }

      // Add organization context to request
      req.organizationScope = user.organizationId;
      
      next();
    };
  }

  // Owner-only access (users can only access resources they own)
  static requireOwnership(ownerIdParam = 'ownerId') {
    return (req, res, next) => {
      const user = req.user;
      
      if (!user) {
        return AuthorizationMiddleware.sendForbidden(res, 'Authentication required');
      }

      // Check if resource belongs to user
      const ownerId = req.params[ownerIdParam] || 
                     req.body[ownerIdParam] || 
                     req.query[ownerIdParam];

      if (ownerId && ownerId !== user.id) {
        // Check if user has elevated permissions
        const hasElevatedAccess = PermissionManager.hasAnyPermission(
          user.expandedPermissions || user.permissions || [],
          ['expense:approve', 'report:approve', 'admin:system_settings']
        );

        if (!hasElevatedAccess) {
          return AuthorizationMiddleware.sendForbidden(
            res, 
            'Access denied: Resource ownership required'
          );
        }
      }

      next();
    };
  }

  // Dynamic permission check based on resource and action
  static checkResourcePermission(getResourceType, getAction) {
    return async (req, res, next) => {
      const user = req.user;
      
      if (!user) {
        return AuthorizationMiddleware.sendForbidden(res, 'Authentication required');
      }

      try {
        const resourceType = typeof getResourceType === 'function' 
          ? await getResourceType(req) 
          : getResourceType;
          
        const action = typeof getAction === 'function' 
          ? await getAction(req) 
          : getAction;

        const permission = `${resourceType}:${action}`;
        
        const hasPermission = PermissionManager.hasPermission(
          user.expandedPermissions || user.permissions || [],
          permission
        );

        if (!hasPermission) {
          await logAuditEvent({
            event: 'authorization_denied',
            userId: user.id,
            permission,
            endpoint: req.path,
            method: req.method,
            ipAddress: req.ip,
            userAgent: req.get('User-Agent'),
            success: false,
          });

          return AuthorizationMiddleware.sendForbidden(
            res, 
            `Permission required: ${permission}`
          );
        }

        next();
      } catch (error) {
        console.error('Dynamic permission check error:', error);
        return res.status(500).json({
          error: 'Internal server error',
          code: 'INTERNAL_ERROR'
        });
      }
    };
  }

  // Helper method to fetch resource (would need to be implemented based on your data layer)
  static async fetchResource(resourceType, resourceId) {
    // This would typically fetch from your database
    // For now, return a mock resource
    return {
      id: resourceId,
      organizationId: 'mock-org-id',
      ownerId: 'mock-owner-id',
      type: resourceType,
    };
  }

  // Send forbidden response
  static sendForbidden(res, message = 'Access forbidden') {
    return res.status(403).json({
      error: message,
      code: 'FORBIDDEN',
    });
  }

  // Middleware to add user permissions to response (for frontend)
  static addUserPermissions() {
    return (req, res, next) => {
      const originalJson = res.json;
      
      res.json = function(data) {
        if (req.user) {
          data.userPermissions = req.user.expandedPermissions || req.user.permissions || [];
          data.userRoles = req.user.roles || [];
        }
        
        originalJson.call(this, data);
      };
      
      next();
    };
  }

  // Check if user can perform action on resource
  static canPerformAction(req, resourceType, action) {
    const user = req.user;
    
    if (!user) return false;

    return PermissionManager.canAccessResource(
      user.expandedPermissions || user.permissions || [],
      resourceType,
      action,
      {
        user,
        organization: { id: user.organizationId }
      }
    );
  }
}

module.exports = AuthorizationMiddleware;