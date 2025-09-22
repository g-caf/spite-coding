const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const authConfig = require('../../../config/auth');
const { logAuditEvent } = require('../utils/audit');

class MFAManager {
  // Generate MFA secret for new user
  static generateSecret(userEmail, userName) {
    return speakeasy.generateSecret({
      name: `${authConfig.mfa.issuer} (${userEmail})`,
      issuer: authConfig.mfa.issuer,
      length: 32,
    });
  }

  // Generate QR code for MFA setup
  static async generateQRCode(secret) {
    try {
      const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);
      return qrCodeUrl;
    } catch (error) {
      console.error('Error generating QR code:', error);
      throw new Error('Failed to generate QR code');
    }
  }

  // Verify MFA token
  static verifyToken(secret, token) {
    return speakeasy.totp.verify({
      secret: secret,
      encoding: 'base32',
      token: token,
      window: authConfig.mfa.window,
    });
  }

  // Enable MFA for user
  static async enableMFA(userId, secret, verificationToken, req = null) {
    try {
      // Verify the token before enabling
      const isValid = this.verifyToken(secret, verificationToken);
      
      if (!isValid) {
        await logAuditEvent({
          event: 'mfa_enable_failed',
          userId,
          reason: 'Invalid verification token',
          ipAddress: req?.ip,
          userAgent: req?.get('User-Agent'),
          success: false,
        });
        
        throw new Error('Invalid verification token');
      }

      // Here you would typically update the user in your database
      // For now, we'll just log the event
      await logAuditEvent({
        event: 'mfa_enabled',
        userId,
        ipAddress: req?.ip,
        userAgent: req?.get('User-Agent'),
        success: true,
      });

      return {
        success: true,
        backupCodes: this.generateBackupCodes(),
      };
    } catch (error) {
      console.error('Error enabling MFA:', error);
      throw error;
    }
  }

  // Disable MFA for user
  static async disableMFA(userId, currentPassword, req = null) {
    try {
      // Here you would verify the current password
      // For now, we'll assume it's valid and just log the event
      
      await logAuditEvent({
        event: 'mfa_disabled',
        userId,
        ipAddress: req?.ip,
        userAgent: req?.get('User-Agent'),
        success: true,
      });

      return { success: true };
    } catch (error) {
      console.error('Error disabling MFA:', error);
      throw error;
    }
  }

  // Verify MFA during login
  static async verifyLoginMFA(userId, token, req = null) {
    try {
      // Here you would fetch the user's MFA secret from the database
      // For now, we'll use a mock secret
      const userSecret = 'mock-secret'; // This would come from database
      
      const isValid = this.verifyToken(userSecret, token);
      
      if (!isValid) {
        await logAuditEvent({
          event: 'mfa_verification_failed',
          userId,
          ipAddress: req?.ip,
          userAgent: req?.get('User-Agent'),
          success: false,
        });
        
        return { success: false, error: 'Invalid MFA token' };
      }

      await logAuditEvent({
        event: 'mfa_verification_success',
        userId,
        ipAddress: req?.ip,
        userAgent: req?.get('User-Agent'),
        success: true,
      });

      return { success: true };
    } catch (error) {
      console.error('Error verifying MFA:', error);
      return { success: false, error: 'MFA verification failed' };
    }
  }

  // Generate backup codes
  static generateBackupCodes(count = 10) {
    const codes = [];
    for (let i = 0; i < count; i++) {
      // Generate 8-character alphanumeric codes
      const code = Math.random().toString(36).substring(2, 10).toUpperCase();
      codes.push(code);
    }
    return codes;
  }

  // Verify backup code
  static async verifyBackupCode(userId, code, req = null) {
    try {
      // Here you would check if the backup code exists and hasn't been used
      // For now, we'll simulate this
      
      await logAuditEvent({
        event: 'backup_code_used',
        userId,
        ipAddress: req?.ip,
        userAgent: req?.get('User-Agent'),
        success: true,
      });

      return { success: true };
    } catch (error) {
      console.error('Error verifying backup code:', error);
      return { success: false, error: 'Invalid backup code' };
    }
  }

  // Generate new backup codes (invalidate old ones)
  static async regenerateBackupCodes(userId, req = null) {
    try {
      const newCodes = this.generateBackupCodes();
      
      await logAuditEvent({
        event: 'backup_codes_regenerated',
        userId,
        ipAddress: req?.ip,
        userAgent: req?.get('User-Agent'),
        success: true,
      });

      return { success: true, backupCodes: newCodes };
    } catch (error) {
      console.error('Error regenerating backup codes:', error);
      throw error;
    }
  }

  // Check if user has MFA enabled
  static async isMFAEnabled(userId) {
    // Here you would check the database
    // For now, return false
    return false;
  }

  // Get MFA status for user
  static async getMFAStatus(userId) {
    try {
      const isEnabled = await this.isMFAEnabled(userId);
      
      return {
        enabled: isEnabled,
        backupCodesRemaining: isEnabled ? 5 : 0, // This would come from database
      };
    } catch (error) {
      console.error('Error getting MFA status:', error);
      return { enabled: false, backupCodesRemaining: 0 };
    }
  }

  // MFA middleware for routes that require MFA verification
  static requireMFAVerification() {
    return async (req, res, next) => {
      const user = req.user;
      
      if (!user) {
        return res.status(401).json({
          error: 'Authentication required',
          code: 'UNAUTHORIZED'
        });
      }

      // Check if user has MFA enabled
      const mfaStatus = await this.getMFAStatus(user.id);
      
      if (mfaStatus.enabled && !req.session.mfaVerified) {
        return res.status(403).json({
          error: 'MFA verification required',
          code: 'MFA_REQUIRED',
          redirectTo: '/auth/mfa/verify'
        });
      }

      next();
    };
  }

  // Middleware to check if MFA setup is required
  static checkMFASetupRequired() {
    return async (req, res, next) => {
      const user = req.user;
      
      if (!user) {
        return next();
      }

      // Check if organization requires MFA but user hasn't set it up
      const orgRequiresMFA = true; // This would come from organization settings
      const mfaStatus = await this.getMFAStatus(user.id);
      
      if (orgRequiresMFA && !mfaStatus.enabled) {
        return res.status(403).json({
          error: 'MFA setup required',
          code: 'MFA_SETUP_REQUIRED',
          redirectTo: '/auth/mfa/setup'
        });
      }

      next();
    };
  }
}

module.exports = MFAManager;