const crypto = require('crypto');

module.exports = {
  // Session configuration
  session: {
    secret: process.env.SESSION_SECRET || crypto.randomBytes(64).toString('hex'),
    name: 'expense_session',
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 60 * 1000, // 30 minutes
    },
    resave: false,
    saveUninitialized: false,
  },

  // Redis configuration
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    db: process.env.REDIS_DB || 0,
    keyPrefix: 'expense_platform:',
    ttl: 30 * 60, // 30 minutes in seconds
  },

  // JWT configuration
  jwt: {
    secret: process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex'),
    expiresIn: '15m',
    refreshTokenExpiresIn: '7d',
    algorithm: 'HS256',
  },

  // SAML configuration
  saml: {
    // Okta configuration
    okta: {
      entryPoint: process.env.OKTA_ENTRY_POINT,
      issuer: process.env.OKTA_ISSUER,
      cert: process.env.OKTA_CERT,
      callbackUrl: process.env.OKTA_CALLBACK_URL || '/auth/saml/okta/callback',
    },
    
    // Azure AD configuration
    azureAD: {
      entryPoint: process.env.AZURE_ENTRY_POINT,
      issuer: process.env.AZURE_ISSUER,
      cert: process.env.AZURE_CERT,
      callbackUrl: process.env.AZURE_CALLBACK_URL || '/auth/saml/azure/callback',
    },
    
    // Google Workspace configuration
    google: {
      entryPoint: process.env.GOOGLE_ENTRY_POINT,
      issuer: process.env.GOOGLE_ISSUER,
      cert: process.env.GOOGLE_CERT,
      callbackUrl: process.env.GOOGLE_CALLBACK_URL || '/auth/saml/google/callback',
    },
    
    // Common SAML settings
    common: {
      audience: process.env.SAML_AUDIENCE || 'expense-platform',
      identifierFormat: 'urn:oasis:names:tc:SAML:2.0:nameid-format:emailAddress',
      wantAuthnResponseSigned: true,
      wantAssertionsSigned: true,
      signatureAlgorithm: 'sha256',
    }
  },

  // Rate limiting configuration
  rateLimit: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // limit each IP to 5 requests per windowMs
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: 'Too many login attempts, please try again later.',
    },
  },

  // MFA configuration
  mfa: {
    issuer: process.env.MFA_ISSUER || 'Expense Platform',
    window: 2, // Allow 2 time windows
    encoding: 'base32',
  },

  // Password requirements
  password: {
    minLength: 12,
    requireUppercase: true,
    requireLowercase: true,
    requireNumbers: true,
    requireSpecialChars: true,
    saltRounds: 12,
  },

  // Audit logging
  audit: {
    enabled: true,
    events: [
      'login_success',
      'login_failure',
      'logout',
      'password_change',
      'role_change',
      'account_locked',
      'mfa_enabled',
      'mfa_disabled',
      'saml_login',
      'session_expired',
    ],
  },

  // Account lockout
  lockout: {
    maxAttempts: 5,
    lockoutDuration: 30 * 60 * 1000, // 30 minutes
    incrementalDelay: true,
  },
};