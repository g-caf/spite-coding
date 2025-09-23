# Expense Platform - Agent Instructions

## Build and Run Commands

### Development
```bash
npm run dev          # Start development server with nodemon  
npm start           # Start production server
npm test            # Run test suite
npm run lint        # Run ESLint
npm run type-check  # TypeScript type checking
```

### Build and Database
```bash
npm run build       # Build TypeScript to JavaScript
npm run migrate     # Run database migrations
npm run seed        # Run database seeds
npm run health-check # Check system health
```

### Plaid Integration Commands
```bash
npm run plaid:sync    # Manual sync of all Plaid connections
npm run plaid:cleanup # Clean up old Plaid data
```

### Testing
```bash
npm test                    # Run all tests
npm run test:coverage      # Run tests with coverage  
npm run test:watch         # Run tests in watch mode
```

## Project Structure

This is an enterprise-grade expense management platform with comprehensive Plaid bank integration, featuring:

### Core Authentication (`src/auth/`)
- **Authentication Middleware** - Session, JWT, MFA handling
- **Authorization Middleware** - RBAC, ABAC, resource-level permissions
- **SAML Integration** - Okta, Azure AD, Google Workspace SSO
- **Session Management** - Redis-backed sessions with cleanup
- **Security Features** - MFA, CSRF, rate limiting, audit logging

### Plaid Integration (`src/services/plaid/`)
- **PlaidClient** - Low-level Plaid API client wrapper
- **PlaidService** - High-level service orchestrating Plaid operations
- **TransactionProcessor** - Handles transaction normalization and deduplication
- **SyncJobProcessor** - Background job processing for transaction syncing
- **PlaidWebhookHandler** - Real-time webhook processing

### Transaction Matching (`src/services/matching/`)
- **TransactionMatcher** - Intelligent receipt-transaction matching engine
- **Fuzzy Matching** - Amount, date, merchant, and location matching
- **Auto-Matching** - High confidence matches processed automatically
- **Manual Review** - Suggested matches for user approval

### API Routes (`src/routes/`)
- `plaid/` - Plaid integration endpoints
  - `/api/plaid/link-token` - Generate Link tokens
  - `/api/plaid/connect` - Connect bank accounts
  - `/api/plaid/accounts` - List connected accounts
  - `/api/plaid/accounts/:id/sync` - Manual sync trigger
  - `/webhook/plaid` - Real-time webhook processing

### Database Schema
- `plaid_items` - Plaid institutional connections
- `plaid_accounts` - Bank accounts from Plaid
- `plaid_transactions_raw` - Raw transaction data from Plaid
- `plaid_webhooks` - Webhook event log
- `plaid_sync_jobs` - Background sync job queue
- `transaction_receipt_matches` - Transaction-receipt matching

### Key Files
- `src/app.ts` - Main Express application with Plaid integration
- `src/services/plaid/index.ts` - Plaid integration orchestrator
- `database/migrations/007_plaid_integration.js` - Plaid database schema
- `PLAID_INTEGRATION.md` - Comprehensive Plaid documentation

## Configuration

### Required Environment Variables
- `PLAID_CLIENT_ID` - Plaid client identifier
- `PLAID_SECRET` - Plaid secret key
- `PLAID_ENVIRONMENT` - sandbox/development/production
- `PLAID_WEBHOOK_SECRET` - Webhook validation secret
- `ENCRYPTION_KEY` - 32-character encryption key for tokens
- `SESSION_SECRET` - Cryptographically secure random string
- `JWT_SECRET` - Cryptographically secure random string
- `DATABASE_URL` - PostgreSQL connection string

### Optional Configuration
- `PLAID_PRODUCTS` - Comma-separated list (default: transactions,auth)
- `PLAID_COUNTRY_CODES` - Comma-separated codes (default: US,CA)
- `RATE_LIMIT_WINDOW_MS` - Rate limit window (default: 15min)
- `RATE_LIMIT_MAX_REQUESTS` - Max requests per window (default: 50)

## Development Guidelines

### Code Style
- Use TypeScript for all new code
- Explicit error handling with proper logging
- Follow middleware pattern for Express integration
- Implement proper permission checking at multiple levels
- Use transactions for database operations affecting multiple tables

### Security Practices
- All passwords hashed with bcrypt
- Plaid access tokens encrypted at rest using AES-256
- CSRF protection on forms and APIs
- Rate limiting on authentication and Plaid endpoints
- Comprehensive audit logging for all financial data access
- Organization-scoped data isolation using Row Level Security (RLS)
- HMAC signature validation for webhooks

### Plaid Integration Patterns
- Always use transactions for multi-table operations
- Encrypt/decrypt access tokens using provided functions
- Implement idempotent processing for webhooks
- Use background jobs for sync operations
- Handle Plaid API errors gracefully with retries
- Deduplicate transactions using Plaid transaction IDs

### Testing Approach
- Unit tests for service logic
- Integration tests for API endpoints
- Mock Plaid API calls in tests
- Test webhook processing thoroughly
- Test transaction matching algorithms
- Security tests for financial data access

## Dependencies

### Core
- `express` - Web framework
- `typescript` - TypeScript support
- `knex` - SQL query builder
- `pg` - PostgreSQL client
- `winston` - Logging
- `redis` - Redis client

### Plaid Integration
- `plaid` - Official Plaid client library
- `crypto` - Built-in encryption utilities

### Authentication & Security
- `passport` - Authentication middleware
- `passport-saml` - SAML 2.0 authentication
- `bcrypt` - Password hashing
- `helmet` - Security headers
- `express-rate-limit` - Rate limiting
- `express-validator` - Input validation

### Utilities
- `express-session` - Session management
- `connect-redis` - Redis session store
- `nodemailer` - Email sending
- `speakeasy` - TOTP MFA
- `qrcode` - MFA QR code generation

## Common Issues

### Database Setup
Ensure PostgreSQL has required extensions:
```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
```

### Redis Connection
Ensure Redis server is running:
```bash
redis-server
# or with Docker
docker run -d -p 6379:6379 redis:alpine
```

### Plaid Environment Setup
1. Create Plaid account and get credentials
2. Set up webhook endpoint (must be HTTPS in production)
3. Configure products and country codes
4. Test with Plaid's sandbox environment first

### Environment Variables
Critical variables that must be set:
- All Plaid configuration variables
- 32-character encryption key for token security
- Secure session and JWT secrets
- Database connection string

### Webhook Issues
- Ensure webhook URL is accessible from Plaid servers
- Verify HMAC signature validation is working
- Check webhook secret matches Plaid dashboard configuration
- Monitor webhook processing logs for errors

## Architecture Notes

### Multi-tenant Design
- Organization-scoped data access using RLS policies
- User permissions tied to organization membership
- Plaid connections isolated by organization
- Session isolation between organizations

### Transaction Processing Pipeline
1. **Raw Storage** - Transactions stored exactly as received from Plaid
2. **Deduplication** - Using Plaid transaction IDs as primary keys
3. **Normalization** - Converting to local transaction format
4. **Matching** - Intelligent receipt-transaction matching
5. **Reconciliation** - Balance updates and audit trails

### Real-time Processing
- Webhook-driven transaction updates
- Background job processing for sync operations
- Rate limiting to handle high-volume webhooks
- Circuit breaker pattern for failing connections

### Security Model
- Defense in depth with multiple security layers
- Encrypted financial data at rest and in transit
- Comprehensive audit trail for compliance
- Real-time monitoring and alerting
- PCI DSS and SOX compliance considerations

### Scalability Considerations
- Background job processing with retry logic
- Connection pooling for database operations
- Rate limiting and circuit breakers for external APIs
- Horizontal scaling support for sync processors

## Monitoring & Health Checks

### Health Endpoints
- `/health` - Overall system health including Plaid status
- Database connectivity checks
- Plaid integration status
- Sync job processing health

### Key Metrics to Monitor
- Transaction processing volume and success rates
- Plaid API response times and error rates
- Webhook processing latency
- Database connection pool utilization
- Background job queue depth

### Alerting Triggers
- Failed Plaid connections (consecutive failures > 5)
- Webhook processing delays (> 5 minutes)
- High error rates in sync jobs (> 10%)
- Database connection failures
- Encryption/decryption errors

This system provides enterprise-grade expense management with seamless bank integration, real-time transaction processing, and intelligent receipt matching capabilities.