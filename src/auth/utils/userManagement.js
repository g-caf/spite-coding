const bcrypt = require('bcrypt');
const crypto = require('crypto');
const authConfig = require('../../../config/auth');
const { logAuditEvent } = require('./audit');
const { PermissionManager } = require('../rbac/permissions');

class UserManagementService {
  // Create or update user from SAML/SSO provider
  static async createOrUpdateUser(userData, provider = 'saml') {
    try {
      const {
        email,
        firstName,
        lastName,
        organizationId,
        department,
        roles = ['USER'],
        providerId,
      } = userData;

      // Check if user already exists
      let user = await this.findUserByEmail(email);
      
      if (user) {
        // Update existing user
        user = await this.updateUser(user.id, {
          firstName,
          lastName,
          organizationId,
          department,
          roles,
          providerId,
          lastLoginAt: new Date(),
          provider,
        });

        await logAuditEvent({
          event: 'user_updated',
          userId: user.id,
          email,
          provider,
          success: true,
        });
      } else {
        // Create new user
        user = await this.createUser({
          email,
          firstName,
          lastName,
          organizationId,
          department,
          roles,
          providerId,
          provider,
          isActive: true,
          createdAt: new Date(),
          lastLoginAt: new Date(),
        });

        await logAuditEvent({
          event: 'user_created',
          userId: user.id,
          email,
          provider,
          success: true,
        });
      }

      return user;
    } catch (error) {
      console.error('Error creating/updating user:', error);
      
      await logAuditEvent({
        event: 'user_creation_failed',
        email: userData.email,
        provider,
        error: error.message,
        success: false,
      });

      throw error;
    }
  }

  // Create new local user account
  static async createLocalUser(userData) {
    try {
      const {
        email,
        password,
        firstName,
        lastName,
        organizationId,
        roles = ['USER'],
      } = userData;

      // Validate password strength
      this.validatePasswordStrength(password);

      // Check if user already exists
      const existingUser = await this.findUserByEmail(email);
      if (existingUser) {
        throw new Error('User already exists');
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, authConfig.password.saltRounds);

      // Create user
      const user = await this.createUser({
        email,
        password: hashedPassword,
        firstName,
        lastName,
        organizationId,
        roles,
        provider: 'local',
        isActive: true,
        emailVerified: false,
        createdAt: new Date(),
      });

      // Send verification email
      await this.sendEmailVerification(user);

      await logAuditEvent({
        event: 'local_user_created',
        userId: user.id,
        email,
        organizationId,
        success: true,
      });

      return user;
    } catch (error) {
      console.error('Error creating local user:', error);
      throw error;
    }
  }

  // Validate password strength
  static validatePasswordStrength(password) {
    const config = authConfig.password;
    const errors = [];

    if (password.length < config.minLength) {
      errors.push(`Password must be at least ${config.minLength} characters long`);
    }

    if (config.requireUppercase && !/[A-Z]/.test(password)) {
      errors.push('Password must contain at least one uppercase letter');
    }

    if (config.requireLowercase && !/[a-z]/.test(password)) {
      errors.push('Password must contain at least one lowercase letter');
    }

    if (config.requireNumbers && !/\d/.test(password)) {
      errors.push('Password must contain at least one number');
    }

    if (config.requireSpecialChars && !/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
      errors.push('Password must contain at least one special character');
    }

    if (errors.length > 0) {
      throw new Error(errors.join('. '));
    }
  }

  // Verify user password
  static async verifyPassword(user, password) {
    if (user.provider !== 'local' || !user.password) {
      return false;
    }

    return await bcrypt.compare(password, user.password);
  }

  // Change user password
  static async changePassword(userId, currentPassword, newPassword, req = null) {
    try {
      const user = await this.findUserById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Verify current password for local accounts
      if (user.provider === 'local') {
        const isCurrentPasswordValid = await this.verifyPassword(user, currentPassword);
        if (!isCurrentPasswordValid) {
          throw new Error('Current password is incorrect');
        }
      }

      // Validate new password strength
      this.validatePasswordStrength(newPassword);

      // Hash new password
      const hashedPassword = await bcrypt.hash(newPassword, authConfig.password.saltRounds);

      // Update user password
      await this.updateUser(userId, {
        password: hashedPassword,
        passwordChangedAt: new Date(),
      });

      // Revoke all existing sessions except current one
      const sessionManager = require('../session/manager');
      await sessionManager.revokeUserSessions(userId, req?.session?.id);

      await logAuditEvent({
        event: 'password_change',
        userId,
        ipAddress: req?.ip,
        userAgent: req?.get('User-Agent'),
        success: true,
      });

      return { success: true };
    } catch (error) {
      console.error('Error changing password:', error);

      await logAuditEvent({
        event: 'password_change',
        userId,
        error: error.message,
        ipAddress: req?.ip,
        userAgent: req?.get('User-Agent'),
        success: false,
      });

      throw error;
    }
  }

  // Generate password reset token
  static async generatePasswordResetToken(email, req = null) {
    try {
      const user = await this.findUserByEmail(email);
      if (!user) {
        // Don't reveal whether user exists or not
        return { success: true };
      }

      if (user.provider !== 'local') {
        throw new Error('Password reset not available for SSO users');
      }

      const resetToken = crypto.randomBytes(32).toString('hex');
      const resetTokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
      const resetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      await this.updateUser(user.id, {
        resetToken: resetTokenHash,
        resetTokenExpiry,
      });

      // Send password reset email
      await this.sendPasswordResetEmail(user, resetToken);

      await logAuditEvent({
        event: 'password_reset_requested',
        userId: user.id,
        email,
        ipAddress: req?.ip,
        userAgent: req?.get('User-Agent'),
        success: true,
      });

      return { success: true };
    } catch (error) {
      console.error('Error generating password reset token:', error);
      throw error;
    }
  }

  // Reset password with token
  static async resetPassword(token, newPassword, req = null) {
    try {
      // Hash the token to compare with stored hash
      const resetTokenHash = crypto.createHash('sha256').update(token).digest('hex');

      // Find user with valid reset token
      const user = await this.findUserByResetToken(resetTokenHash);
      if (!user || user.resetTokenExpiry < new Date()) {
        throw new Error('Invalid or expired reset token');
      }

      // Validate new password strength
      this.validatePasswordStrength(newPassword);

      // Hash new password
      const hashedPassword = await bcrypt.hash(newPassword, authConfig.password.saltRounds);

      // Update user password and clear reset token
      await this.updateUser(user.id, {
        password: hashedPassword,
        resetToken: null,
        resetTokenExpiry: null,
        passwordChangedAt: new Date(),
      });

      // Revoke all existing sessions
      const sessionManager = require('../session/manager');
      await sessionManager.revokeUserSessions(user.id);

      await logAuditEvent({
        event: 'password_reset',
        userId: user.id,
        ipAddress: req?.ip,
        userAgent: req?.get('User-Agent'),
        success: true,
      });

      return { success: true };
    } catch (error) {
      console.error('Error resetting password:', error);

      await logAuditEvent({
        event: 'password_reset',
        error: error.message,
        ipAddress: req?.ip,
        userAgent: req?.get('User-Agent'),
        success: false,
      });

      throw error;
    }
  }

  // Update user roles
  static async updateUserRoles(userId, newRoles, changedBy, req = null) {
    try {
      const user = await this.findUserById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      const oldRoles = user.roles || [];
      
      await this.updateUser(userId, {
        roles: newRoles,
        rolesChangedAt: new Date(),
        rolesChangedBy: changedBy,
      });

      // Update user permissions based on new roles
      const newPermissions = PermissionManager.getUserPermissions(newRoles);
      await this.updateUser(userId, {
        permissions: newPermissions,
      });

      await logAuditEvent({
        event: 'role_change',
        userId,
        oldRoles,
        newRoles,
        changedBy,
        ipAddress: req?.ip,
        userAgent: req?.get('User-Agent'),
        success: true,
      });

      return { success: true };
    } catch (error) {
      console.error('Error updating user roles:', error);
      throw error;
    }
  }

  // Deactivate user account
  static async deactivateUser(userId, reason, deactivatedBy, req = null) {
    try {
      await this.updateUser(userId, {
        isActive: false,
        deactivatedAt: new Date(),
        deactivatedBy,
        deactivationReason: reason,
      });

      // Revoke all user sessions
      const sessionManager = require('../session/manager');
      await sessionManager.revokeUserSessions(userId);

      await logAuditEvent({
        event: 'user_deactivated',
        userId,
        reason,
        deactivatedBy,
        ipAddress: req?.ip,
        userAgent: req?.get('User-Agent'),
        success: true,
      });

      return { success: true };
    } catch (error) {
      console.error('Error deactivating user:', error);
      throw error;
    }
  }

  // Mock database methods (implement with your actual database)
  static async createUser(userData) {
    // This would create user in your database
    const user = {
      id: crypto.randomUUID(),
      ...userData,
      permissions: PermissionManager.getUserPermissions(userData.roles || ['USER']),
    };
    
    return user;
  }

  static async findUserByEmail(email) {
    // This would query your database
    return null;
  }

  static async findUserById(id) {
    // This would query your database
    return null;
  }

  static async findUserByResetToken(tokenHash) {
    // This would query your database
    return null;
  }

  static async updateUser(id, updateData) {
    // This would update user in your database
    return { id, ...updateData };
  }

  // Send email verification
  static async sendEmailVerification(user) {
    // This would send email verification
    console.log('Sending email verification to:', user.email);
  }

  // Send password reset email
  static async sendPasswordResetEmail(user, token) {
    // This would send password reset email
    console.log('Sending password reset email to:', user.email);
  }
}

module.exports = {
  UserManagementService,
  createOrUpdateUser: UserManagementService.createOrUpdateUser.bind(UserManagementService),
  createLocalUser: UserManagementService.createLocalUser.bind(UserManagementService),
};