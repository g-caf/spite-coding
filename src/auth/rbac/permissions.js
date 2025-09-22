// Define all available permissions in the system
const PERMISSIONS = {
  // User management
  USER_READ: 'user:read',
  USER_CREATE: 'user:create',
  USER_UPDATE: 'user:update',
  USER_DELETE: 'user:delete',
  USER_INVITE: 'user:invite',

  // Expense management
  EXPENSE_READ: 'expense:read',
  EXPENSE_CREATE: 'expense:create',
  EXPENSE_UPDATE: 'expense:update',
  EXPENSE_DELETE: 'expense:delete',
  EXPENSE_APPROVE: 'expense:approve',
  EXPENSE_REJECT: 'expense:reject',
  EXPENSE_EXPORT: 'expense:export',

  // Report management
  REPORT_READ: 'report:read',
  REPORT_CREATE: 'report:create',
  REPORT_UPDATE: 'report:update',
  REPORT_DELETE: 'report:delete',
  REPORT_SUBMIT: 'report:submit',
  REPORT_APPROVE: 'report:approve',
  REPORT_REJECT: 'report:reject',

  // Organization management
  ORG_READ: 'organization:read',
  ORG_UPDATE: 'organization:update',
  ORG_SETTINGS: 'organization:settings',
  ORG_BILLING: 'organization:billing',

  // Admin functions
  ADMIN_AUDIT_LOGS: 'admin:audit_logs',
  ADMIN_USER_IMPERSONATE: 'admin:user_impersonate',
  ADMIN_SYSTEM_SETTINGS: 'admin:system_settings',
  ADMIN_ROLE_MANAGEMENT: 'admin:role_management',

  // Integration management
  INTEGRATION_READ: 'integration:read',
  INTEGRATION_MANAGE: 'integration:manage',

  // Category management
  CATEGORY_READ: 'category:read',
  CATEGORY_MANAGE: 'category:manage',

  // Policy management
  POLICY_READ: 'policy:read',
  POLICY_MANAGE: 'policy:manage',
};

// Define roles and their permissions
const ROLES = {
  // Basic user - can manage their own expenses
  USER: {
    name: 'User',
    description: 'Basic user with expense management capabilities',
    permissions: [
      PERMISSIONS.EXPENSE_READ,
      PERMISSIONS.EXPENSE_CREATE,
      PERMISSIONS.EXPENSE_UPDATE,
      PERMISSIONS.EXPENSE_DELETE,
      PERMISSIONS.REPORT_READ,
      PERMISSIONS.REPORT_CREATE,
      PERMISSIONS.REPORT_UPDATE,
      PERMISSIONS.REPORT_DELETE,
      PERMISSIONS.REPORT_SUBMIT,
      PERMISSIONS.CATEGORY_READ,
      PERMISSIONS.POLICY_READ,
      PERMISSIONS.USER_READ, // Own user data only
    ],
  },

  // Team lead - can approve expenses for team members
  TEAM_LEAD: {
    name: 'Team Lead',
    description: 'Team leader with approval capabilities',
    permissions: [
      ...ROLES.USER?.permissions || [],
      PERMISSIONS.EXPENSE_APPROVE,
      PERMISSIONS.EXPENSE_REJECT,
      PERMISSIONS.REPORT_APPROVE,
      PERMISSIONS.REPORT_REJECT,
      PERMISSIONS.EXPENSE_EXPORT,
    ],
  },

  // Manager - broader approval and user management
  MANAGER: {
    name: 'Manager',
    description: 'Manager with team oversight capabilities',
    permissions: [
      ...ROLES.TEAM_LEAD?.permissions || [],
      PERMISSIONS.USER_CREATE,
      PERMISSIONS.USER_UPDATE,
      PERMISSIONS.USER_INVITE,
      PERMISSIONS.CATEGORY_MANAGE,
      PERMISSIONS.POLICY_MANAGE,
    ],
  },

  // Finance - financial oversight and reporting
  FINANCE: {
    name: 'Finance',
    description: 'Finance team with reporting and analysis capabilities',
    permissions: [
      PERMISSIONS.EXPENSE_READ,
      PERMISSIONS.EXPENSE_APPROVE,
      PERMISSIONS.EXPENSE_REJECT,
      PERMISSIONS.EXPENSE_EXPORT,
      PERMISSIONS.REPORT_READ,
      PERMISSIONS.REPORT_APPROVE,
      PERMISSIONS.REPORT_REJECT,
      PERMISSIONS.USER_READ,
      PERMISSIONS.CATEGORY_READ,
      PERMISSIONS.CATEGORY_MANAGE,
      PERMISSIONS.POLICY_READ,
      PERMISSIONS.POLICY_MANAGE,
      PERMISSIONS.ORG_BILLING,
    ],
  },

  // HR Admin - user and organization management
  HR_ADMIN: {
    name: 'HR Admin',
    description: 'HR administrator with user management capabilities',
    permissions: [
      PERMISSIONS.USER_READ,
      PERMISSIONS.USER_CREATE,
      PERMISSIONS.USER_UPDATE,
      PERMISSIONS.USER_DELETE,
      PERMISSIONS.USER_INVITE,
      PERMISSIONS.ORG_READ,
      PERMISSIONS.ORG_UPDATE,
      PERMISSIONS.CATEGORY_READ,
      PERMISSIONS.POLICY_READ,
      PERMISSIONS.INTEGRATION_READ,
    ],
  },

  // Organization Admin - full organization control
  ORG_ADMIN: {
    name: 'Organization Admin',
    description: 'Organization administrator with full org control',
    permissions: [
      ...ROLES.MANAGER?.permissions || [],
      ...ROLES.FINANCE?.permissions || [],
      ...ROLES.HR_ADMIN?.permissions || [],
      PERMISSIONS.ORG_SETTINGS,
      PERMISSIONS.ADMIN_ROLE_MANAGEMENT,
      PERMISSIONS.INTEGRATION_MANAGE,
      PERMISSIONS.ADMIN_AUDIT_LOGS,
    ],
  },

  // System Admin - full system access
  SYSTEM_ADMIN: {
    name: 'System Admin',
    description: 'System administrator with full access',
    permissions: Object.values(PERMISSIONS),
  },
};

// Permission hierarchy for inheritance
const PERMISSION_HIERARCHY = {
  [PERMISSIONS.EXPENSE_APPROVE]: [PERMISSIONS.EXPENSE_READ],
  [PERMISSIONS.EXPENSE_REJECT]: [PERMISSIONS.EXPENSE_READ],
  [PERMISSIONS.REPORT_APPROVE]: [PERMISSIONS.REPORT_READ],
  [PERMISSIONS.REPORT_REJECT]: [PERMISSIONS.REPORT_READ],
  [PERMISSIONS.USER_UPDATE]: [PERMISSIONS.USER_READ],
  [PERMISSIONS.USER_DELETE]: [PERMISSIONS.USER_READ],
  [PERMISSIONS.CATEGORY_MANAGE]: [PERMISSIONS.CATEGORY_READ],
  [PERMISSIONS.POLICY_MANAGE]: [PERMISSIONS.POLICY_READ],
  [PERMISSIONS.ORG_UPDATE]: [PERMISSIONS.ORG_READ],
  [PERMISSIONS.INTEGRATION_MANAGE]: [PERMISSIONS.INTEGRATION_READ],
};

class PermissionManager {
  static getAllPermissions() {
    return PERMISSIONS;
  }

  static getAllRoles() {
    return ROLES;
  }

  static getRolePermissions(roleName) {
    const role = ROLES[roleName.toUpperCase()];
    if (!role) {
      throw new Error(`Role ${roleName} not found`);
    }
    return role.permissions;
  }

  static hasPermission(userPermissions, requiredPermission) {
    if (!Array.isArray(userPermissions)) {
      return false;
    }

    // Direct permission check
    if (userPermissions.includes(requiredPermission)) {
      return true;
    }

    // Check for inherited permissions
    const inheritedPermissions = PERMISSION_HIERARCHY[requiredPermission] || [];
    return inheritedPermissions.some(permission => 
      userPermissions.includes(permission)
    );
  }

  static hasAnyPermission(userPermissions, requiredPermissions) {
    return requiredPermissions.some(permission => 
      this.hasPermission(userPermissions, permission)
    );
  }

  static hasAllPermissions(userPermissions, requiredPermissions) {
    return requiredPermissions.every(permission => 
      this.hasPermission(userPermissions, permission)
    );
  }

  static expandPermissions(permissions) {
    const expandedPermissions = new Set(permissions);
    
    permissions.forEach(permission => {
      const inherited = PERMISSION_HIERARCHY[permission] || [];
      inherited.forEach(inheritedPermission => {
        expandedPermissions.add(inheritedPermission);
      });
    });

    return Array.from(expandedPermissions);
  }

  static getUserPermissions(userRoles) {
    const allPermissions = new Set();
    
    userRoles.forEach(roleName => {
      try {
        const rolePermissions = this.getRolePermissions(roleName);
        rolePermissions.forEach(permission => {
          allPermissions.add(permission);
        });
      } catch (error) {
        console.warn(`Role ${roleName} not found, skipping`);
      }
    });

    return this.expandPermissions(Array.from(allPermissions));
  }

  static canAccessResource(userPermissions, resource, action, context = {}) {
    const requiredPermission = `${resource}:${action}`;
    
    // Basic permission check
    if (!this.hasPermission(userPermissions, requiredPermission)) {
      return false;
    }

    // Context-based access control (ABAC)
    return this.checkAttributeBasedAccess(userPermissions, resource, action, context);
  }

  static checkAttributeBasedAccess(userPermissions, resource, action, context) {
    const { user, targetResource, organization } = context;

    // Organization-based access control
    if (targetResource?.organizationId && user?.organizationId) {
      // Users can only access resources from their organization
      if (targetResource.organizationId !== user.organizationId) {
        // Unless they have cross-org permissions (system admin)
        if (!this.hasPermission(userPermissions, PERMISSIONS.ADMIN_SYSTEM_SETTINGS)) {
          return false;
        }
      }
    }

    // Owner-based access control
    if (targetResource?.ownerId && user?.id) {
      // Users can access their own resources
      if (targetResource.ownerId === user.id) {
        return true;
      }
      
      // Or if they have elevated permissions for the resource type
      const elevatedActions = ['approve', 'reject', 'delete'];
      if (elevatedActions.includes(action)) {
        return this.hasPermission(userPermissions, `${resource}:${action}`);
      }
    }

    return true;
  }

  static getResourcePermissions(userPermissions, resourceType) {
    return Object.values(PERMISSIONS)
      .filter(permission => permission.startsWith(`${resourceType}:`))
      .filter(permission => this.hasPermission(userPermissions, permission));
  }
}

module.exports = {
  PERMISSIONS,
  ROLES,
  PermissionManager,
};