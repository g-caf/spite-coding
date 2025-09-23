// Quick script to fix the ROLES initialization issue
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/auth/rbac/permissions.js');
let content = fs.readFileSync(filePath, 'utf8');

// Replace the ROLES object literal with two-phase initialization
content = content.replace(
  /\/\/ Define roles and their permissions\nconst ROLES = \{[\s\S]*?\n\};/,
  `// Define roles and their permissions (two-phase to avoid self-reference)
const ROLES = {};

// Phase 1: Define base roles without inheritance
ROLES.USER = {
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
    PERMISSIONS.USER_READ,
  ],
};

ROLES.FINANCE = {
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
};

ROLES.HR_ADMIN = {
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
};

// Phase 2: Define inherited roles (now ROLES.USER etc. are available)
ROLES.TEAM_LEAD = {
  name: 'Team Lead',
  description: 'Team leader with approval capabilities',
  permissions: [
    ...ROLES.USER.permissions,
    PERMISSIONS.EXPENSE_APPROVE,
    PERMISSIONS.EXPENSE_REJECT,
    PERMISSIONS.REPORT_APPROVE,
    PERMISSIONS.REPORT_REJECT,
    PERMISSIONS.EXPENSE_EXPORT,
  ],
};

ROLES.MANAGER = {
  name: 'Manager',
  description: 'Manager with team oversight capabilities',
  permissions: [
    ...ROLES.TEAM_LEAD.permissions,
    PERMISSIONS.USER_CREATE,
    PERMISSIONS.USER_UPDATE,
    PERMISSIONS.USER_INVITE,
    PERMISSIONS.CATEGORY_MANAGE,
    PERMISSIONS.POLICY_MANAGE,
  ],
};

ROLES.ORG_ADMIN = {
  name: 'Organization Admin',
  description: 'Organization administrator with full org control',
  permissions: [
    ...ROLES.MANAGER.permissions,
    ...ROLES.FINANCE.permissions,
    ...ROLES.HR_ADMIN.permissions,
    PERMISSIONS.ORG_SETTINGS,
    PERMISSIONS.ADMIN_ROLE_MANAGEMENT,
    PERMISSIONS.INTEGRATION_MANAGE,
    PERMISSIONS.ADMIN_AUDIT_LOGS,
  ],
};

ROLES.SYSTEM_ADMIN = {
  name: 'System Admin',
  description: 'System administrator with full access',
  permissions: Object.values(PERMISSIONS),
};`
);

console.log('Fixed ROLES initialization in permissions.js');
fs.writeFileSync(filePath, content);
