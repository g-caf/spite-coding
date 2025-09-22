# Expense Platform - Agent Instructions

## Build and Run Commands

### Development
```bash
npm run dev          # Start development server with nodemon
npm start           # Start production server
npm test            # Run test suite
npm run lint        # Run ESLint
```

### Build Verification
```bash
npm run build       # Verify build (currently just echo)
node src/app.js     # Test direct execution
```

### Testing
```bash
npm test                    # Run all tests
npm run test:coverage      # Run tests with coverage
npm run test:watch         # Run tests in watch mode
```

## Project Structure

This is an enterprise-grade authentication system for an expense management platform with the following key components:

### Core Authentication (`src/auth/`)
- **Authentication Middleware** - Session, JWT, MFA handling
- **Authorization Middleware** - RBAC, ABAC, resource-level permissions
- **SAML Integration** - Okta, Azure AD, Google Workspace SSO
- **Session Management** - Redis-backed sessions with cleanup
- **Security Features** - MFA, CSRF, rate limiting, audit logging

### Key Files
- `src/app.js` - Main Express application with example routes
- `src/auth/index.js` - Authentication system orchestrator
- `config/auth.js` - Central configuration for all auth features
- `package.json` - Dependencies and scripts

### Configuration
- Copy `.env.example` to `.env` and configure
- Requires Redis server for session storage
- SAML providers require certificates and endpoints

## Development Guidelines

### Code Style
- Use explicit error handling
- Log security events for audit trail
- Follow middleware pattern for Express integration
- Implement proper permission checking at multiple levels

### Security Practices
- All passwords hashed with bcrypt
- CSRF protection on forms and APIs
- Rate limiting on authentication endpoints
- Comprehensive audit logging
- Session security with HttpOnly/Secure cookies
- Organization-scoped data access

### Testing Approach
- Unit tests for individual components
- Integration tests for auth flows
- Security tests for vulnerabilities
- Use supertest for HTTP endpoint testing

## Dependencies

### Core
- `express` - Web framework
- `passport` - Authentication middleware
- `passport-saml` - SAML 2.0 authentication
- `express-session` - Session management
- `connect-redis` - Redis session store

### Security
- `bcrypt` - Password hashing
- `helmet` - Security headers
- `csurf` - CSRF protection
- `express-rate-limit` - Rate limiting
- `speakeasy` - TOTP MFA
- `jsonwebtoken` - JWT tokens

### Utilities  
- `winston` - Logging
- `redis` - Redis client
- `nodemailer` - Email sending
- `qrcode` - MFA QR code generation

## Common Issues

### Redis Connection
Ensure Redis server is running before starting the app:
```bash
redis-server
# or with Docker
docker run -d -p 6379:6379 redis:alpine
```

### Environment Variables
Critical variables that must be set:
- `SESSION_SECRET` - Cryptographically secure random string
- `JWT_SECRET` - Cryptographically secure random string
- SAML provider configurations (optional but recommended)

### SAML Configuration
For SAML SSO, you need:
1. Identity provider metadata/configuration
2. X.509 certificate from IdP
3. Callback URLs configured in IdP
4. Proper attribute mappings

## Architecture Notes

### Multi-tenant Design
- Organization-scoped data access
- User permissions tied to organization membership  
- Session isolation between organizations

### Permission System
- Role-based (RBAC) and Attribute-based (ABAC) access control
- Hierarchical permissions with inheritance
- Context-aware authorization decisions
- Resource-level permission checking

### Security Model
- Defense in depth with multiple security layers
- Comprehensive audit trail for compliance
- Real-time threat detection and alerting
- Secure session management with Redis

This system is designed for enterprise use with high security requirements, multi-tenant architecture, and comprehensive compliance features.