const passport = require('passport');
const SamlStrategy = require('passport-saml').Strategy;
const authConfig = require('../../../config/auth');
const { logAuditEvent } = require('../utils/audit');
const { createOrUpdateUser } = require('../utils/userManagement');

class SAMLConfig {
  constructor() {
    this.strategies = new Map();
  }

  initializeStrategies() {
    // Initialize Okta SAML strategy
    if (authConfig.saml.okta.entryPoint) {
      this.registerStrategy('okta', this.createSamlStrategy('okta'));
    }

    // Initialize Azure AD SAML strategy
    if (authConfig.saml.azureAD.entryPoint) {
      this.registerStrategy('azure', this.createSamlStrategy('azureAD'));
    }

    // Initialize Google Workspace SAML strategy
    if (authConfig.saml.google.entryPoint) {
      this.registerStrategy('google', this.createSamlStrategy('google'));
    }
  }

  createSamlStrategy(provider) {
    const providerConfig = authConfig.saml[provider === 'azure' ? 'azureAD' : provider];
    
    return new SamlStrategy(
      {
        entryPoint: providerConfig.entryPoint,
        issuer: providerConfig.issuer,
        cert: providerConfig.cert,
        callbackUrl: providerConfig.callbackUrl,
        audience: authConfig.saml.common.audience,
        identifierFormat: authConfig.saml.common.identifierFormat,
        wantAuthnResponseSigned: authConfig.saml.common.wantAuthnResponseSigned,
        wantAssertionsSigned: authConfig.saml.common.wantAssertionsSigned,
        signatureAlgorithm: authConfig.saml.common.signatureAlgorithm,
        passReqToCallback: true,
      },
      async (req, profile, done) => {
        try {
          // Extract user information from SAML profile
          const userData = this.extractUserData(profile, provider);
          
          // Create or update user
          const user = await createOrUpdateUser(userData, provider);
          
          // Log successful SAML login
          await logAuditEvent({
            event: 'saml_login',
            userId: user.id,
            provider,
            email: userData.email,
            ipAddress: req.ip,
            userAgent: req.get('User-Agent'),
            success: true,
          });

          return done(null, user);
        } catch (error) {
          // Log failed SAML login
          await logAuditEvent({
            event: 'saml_login',
            provider,
            email: profile.email || profile.nameID,
            ipAddress: req.ip,
            userAgent: req.get('User-Agent'),
            success: false,
            error: error.message,
          });

          return done(error, false);
        }
      }
    );
  }

  registerStrategy(name, strategy) {
    passport.use(`saml-${name}`, strategy);
    this.strategies.set(name, strategy);
  }

  extractUserData(profile, provider) {
    const baseData = {
      email: profile.email || profile.nameID,
      firstName: profile.firstName || profile.givenName || '',
      lastName: profile.lastName || profile.surname || '',
      provider,
      providerId: profile.nameID,
      isActive: true,
    };

    // Provider-specific attribute mapping
    switch (provider) {
      case 'okta':
        return {
          ...baseData,
          organizationId: profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/organizationId'],
          department: profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/department'],
          roles: this.extractRoles(profile, 'okta'),
        };

      case 'azure':
        return {
          ...baseData,
          organizationId: profile['http://schemas.microsoft.com/identity/claims/tenantid'],
          department: profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/department'],
          roles: this.extractRoles(profile, 'azure'),
        };

      case 'google':
        return {
          ...baseData,
          organizationId: profile['https://schemas.google.com/organizationId'],
          department: profile['https://schemas.google.com/department'],
          roles: this.extractRoles(profile, 'google'),
        };

      default:
        return baseData;
    }
  }

  extractRoles(profile, provider) {
    const roleAttributes = {
      okta: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/role',
      azure: 'http://schemas.microsoft.com/ws/2008/06/identity/claims/role',
      google: 'https://schemas.google.com/role',
    };

    const roleAttribute = roleAttributes[provider];
    const roles = profile[roleAttribute];

    if (!roles) return ['user']; // Default role

    return Array.isArray(roles) ? roles : [roles];
  }

  generateMetadata(provider) {
    const strategy = this.strategies.get(provider);
    if (!strategy) {
      throw new Error(`SAML strategy for ${provider} not found`);
    }

    return strategy.generateServiceProviderMetadata(
      null, // No signing cert for SP
      null  // No signing cert for SP
    );
  }

  getAvailableProviders() {
    return Array.from(this.strategies.keys());
  }
}

module.exports = new SAMLConfig();