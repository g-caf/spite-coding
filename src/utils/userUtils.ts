import { User } from '../types/user';

/**
 * Normalize user object to ensure both organizationId and organization_id are available
 */
export function normalizeUser(user: Partial<User>): User {
  const normalized = { ...user } as User;
  
  // Ensure both organizationId and organization_id exist
  if (normalized.organization_id && !normalized.organizationId) {
    normalized.organizationId = normalized.organization_id;
  }
  if (normalized.organizationId && !normalized.organization_id) {
    normalized.organization_id = normalized.organizationId;
  }
  
  return normalized;
}

/**
 * Get organization ID from user object, handling both property names
 */
export function getUserOrganizationId(user?: Partial<User>): string | undefined {
  if (!user) return undefined;
  return user.organization_id || user.organizationId;
}

/**
 * Check if user has required role
 */
export function userHasRole(user: User, role: string): boolean {
  return user.roles?.includes(role) || user.role === role;
}

/**
 * Check if user has any of the specified roles
 */
export function userHasAnyRole(user: User, roles: string[]): boolean {
  if (!user.roles) return roles.includes(user.role);
  return roles.some(role => user.roles!.includes(role));
}
