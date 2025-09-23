export interface User {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  organization_id: string;
  organizationId: string; // Alias for compatibility
  role: string;
  roles?: string[];
  permissions?: string[];
  mfaEnabled?: boolean;
  expandedPermissions?: string[];
  created_at?: string;
  updated_at?: string;
}

// Extend Express Request to include user
declare global {
  namespace Express {
    interface Request {
      user?: User;
      organizationId?: string;
    }
  }
}

export {};
