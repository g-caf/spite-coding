# Plaid Integration Documentation

## Overview

This document describes the comprehensive Plaid integration system built for the Expense Platform. The integration provides seamless bank account connections, real-time transaction syncing, intelligent matching, and automated expense processing.

## Architecture

### Core Components

1. **PlaidClient** - Low-level Plaid API client wrapper
2. **PlaidService** - High-level service orchestrating Plaid operations  
3. **TransactionProcessor** - Handles transaction normalization and deduplication
4. **SyncJobProcessor** - Background job processing for transaction syncing
5. **PlaidWebhookHandler** - Real-time webhook processing
6. **TransactionMatcher** - Intelligent receipt-transaction matching engine

### Database Schema

The integration adds several new tables to the existing schema:

- `plaid_items` - Plaid institutional connections
- `plaid_accounts` - Bank accounts from Plaid  
- `plaid_transactions_raw` - Raw transaction data from Plaid
- `plaid_webhooks` - Webhook event log
- `plaid_sync_jobs` - Background sync job queue

## API Endpoints

### Connection Management

#### `GET /api/plaid/link-token`
Generate a Link token for Plaid Link initialization.

**Query Parameters:**
- `language` (optional) - Language preference (en, es, fr)
- `user_legal_name` (optional) - User's legal name
- `user_email` (optional) - User's email address

**Response:**
```json
{
  "success": true,
  "data": {
    "link_token": "link-sandbox-...",
    "expiration": "2024-01-01T12:00:00Z",
    "request_id": "abc123"
  }
}
```

#### `POST /api/plaid/connect`
Exchange public token and connect bank account.

**Request Body:**
```json
{
  "public_token": "public-sandbox-...",
  "metadata": {
    "institution": {
      "name": "Chase Bank",
      "institution_id": "ins_123"
    },
    "accounts": [...]
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "plaid_item": {...},
    "plaid_accounts": [...],
    "local_accounts": [...],
    "institution": {...}
  }
}
```

#### `GET /api/plaid/accounts`
List all connected bank accounts for the organization.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "item_id": "item_123",
      "institution_name": "Chase Bank",
      "sync_status": "active",
      "last_sync_at": "2024-01-01T12:00:00Z",
      "accounts": [
        {
          "id": "uuid",
          "plaid_account_id": "acc_123",
          "name": "Chase Checking",
          "type": "depository",
          "subtype": "checking",
          "mask": "0000",
          "balances": {
            "current": 1000.00,
            "available": 900.00
          }
        }
      ]
    }
  ]
}
```

#### `DELETE /api/plaid/accounts/:itemId`
Disconnect a Plaid connection.

**Response:**
```json
{
  "success": true,
  "message": "Account disconnected successfully"
}
```

### Transaction Syncing

#### `POST /api/plaid/accounts/:itemId/sync`
Trigger manual transaction sync.

**Response:**
```json
{
  "success": true,
  "data": {
    "success": true,
    "message": "Sync scheduled"
  }
}
```

#### `GET /api/plaid/sync-status`
Get sync status for all connected accounts.

**Response:**
```json
{
  "success": true,
  "data": {
    "recent_jobs": [...],
    "health_metrics": {
      "total_connections": 5,
      "active_connections": 4,
      "error_connections": 1,
      "avg_failures": 0.2
    }
  }
}
```

### Webhook Endpoint

#### `POST /webhook/plaid`
Receive real-time updates from Plaid.

This endpoint handles various webhook types:
- `TRANSACTIONS` - New or updated transactions
- `ITEM` - Connection status changes
- `ERROR` - Error notifications

## Transaction Processing Pipeline

### 1. Raw Transaction Storage
- Transactions are first stored in `plaid_transactions_raw` exactly as received
- Includes all Plaid metadata and categorization
- Enables reprocessing and auditing

### 2. Deduplication
- Uses Plaid `transaction_id` as primary key
- Handles pending vs posted transaction scenarios
- Manages transaction modifications and removals

### 3. Normalization
- Converts Plaid data to local transaction format
- Determines debit/credit based on account type
- Maps Plaid categories to local categories
- Creates or matches merchants

### 4. Local Transaction Creation
- Creates records in main `transactions` table
- Links to local `accounts` table
- Updates account balances
- Triggers matching process

## Transaction Matching Engine

The matching engine automatically connects bank transactions to uploaded receipts using multiple algorithms:

### Matching Factors

1. **Amount Matching (40% weight)**
   - Exact match: 100% confidence
   - Within 1%: 80% confidence  
   - Within 5%: 80% confidence
   - Within 10%: 50% confidence

2. **Date Matching (30% weight)**
   - Same day: 100% confidence
   - Within 1 day: 90% confidence
   - Within 3 days: 70% confidence
   - Within 7 days: 40% confidence

3. **Merchant Matching (25% weight)**
   - Uses fuzzy string matching
   - Compares receipt merchant to transaction description
   - Normalizes merchant names for better matching

4. **Location Matching (5% weight)**
   - Compares location data when available
   - Matches city, state, zip code fields

### Auto-Matching Rules

- **High Confidence (≥80%)**: Automatically matched
- **Medium Confidence (40-79%)**: Creates suggestions for manual review
- **Low Confidence (<40%)**: No match suggested

### Manual Review Process

1. Users can review suggested matches in the UI
2. Approve/reject functionality available
3. Confidence scores and match factors displayed
4. Audit trail of all matching decisions

## Sync Job Processing

### Job Types

- `initial_sync` - First-time historical transaction import (up to 2 years)
- `incremental_sync` - Regular updates using cursor-based sync
- `full_refresh` - Complete re-sync from beginning
- `webhook_triggered` - Sync triggered by webhook

### Job Processing

1. Jobs are queued in `plaid_sync_jobs` table
2. Background processor runs every 30 seconds
3. Failed jobs automatically retry with exponential backoff
4. Maximum 3 retry attempts before marking as failed

### Rate Limiting

- Respects Plaid API rate limits
- Implements circuit breaker pattern for failing items
- Automatically disables items with consecutive failures

## Security Features

### Data Encryption
- Plaid access tokens encrypted at rest using AES-256
- Encryption key stored separately from database
- Sensitive data encrypted in flight and at rest

### Webhook Validation
- HMAC signature validation for incoming webhooks
- Prevents webhook spoofing attacks
- Request rate limiting on webhook endpoint

### Access Control
- Organization-level data isolation using RLS
- User-level permissions for Plaid operations
- Audit logging for all financial data access

### Compliance
- PCI DSS considerations for financial data
- SOX compliance for audit trails
- GDPR/privacy compliance for data handling

## Error Handling

### Plaid API Errors
- Automatic retry for transient errors
- User notifications for authentication issues
- Graceful degradation for service unavailability

### Sync Failures
- Detailed error logging and tracking
- Automatic disabling of problematic connections
- Health monitoring and alerting

### Data Consistency
- Transaction-based operations
- Idempotent processing
- Conflict resolution for concurrent updates

## Monitoring & Alerting

### Health Checks
- Connection status monitoring
- Sync job success/failure rates
- API response time tracking
- Webhook processing health

### Metrics
- Transaction volumes processed
- Match success rates
- Error rates by type
- Performance metrics

### Alerts
- Failed sync jobs
- High error rates
- Webhook processing delays
- Connection authentication failures

## Configuration

### Environment Variables

Required variables:
- `PLAID_CLIENT_ID` - Plaid client identifier
- `PLAID_SECRET` - Plaid secret key
- `PLAID_ENVIRONMENT` - sandbox/development/production
- `PLAID_WEBHOOK_SECRET` - Webhook validation secret
- `ENCRYPTION_KEY` - 32-character encryption key

Optional variables:
- `PLAID_PRODUCTS` - Comma-separated list of products
- `PLAID_COUNTRY_CODES` - Comma-separated country codes
- `RATE_LIMIT_WINDOW_MS` - Rate limit window
- `RATE_LIMIT_MAX_REQUESTS` - Max requests per window

### Database Setup

1. Run migrations: `npm run migrate`
2. Ensure RLS policies are enabled
3. Configure audit triggers
4. Set up encryption functions

## Development Setup

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Configure Environment**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

3. **Setup Database**
   ```bash
   npm run migrate
   npm run seed
   ```

4. **Start Development Server**
   ```bash
   npm run dev
   ```

## Testing

### Unit Tests
- Service layer testing
- Transaction processing logic
- Matching algorithm validation

### Integration Tests
- API endpoint testing
- Database transaction testing
- Webhook processing testing

### Load Testing
- High-volume transaction processing
- Concurrent user connections
- API rate limit validation

## Production Deployment

### Infrastructure Requirements
- PostgreSQL 12+ with encryption support
- Redis for session storage
- HTTPS endpoints for webhooks
- Monitoring and logging infrastructure

### Scaling Considerations
- Horizontal scaling of sync job processors
- Database read replicas for reporting
- Connection pooling optimization
- CDN for static assets

### Backup & Recovery
- Regular database backups
- Point-in-time recovery capability
- Encrypted backup storage
- Disaster recovery procedures

## Troubleshooting

### Common Issues

1. **Connection Failures**
   - Check Plaid credentials
   - Verify webhook URL accessibility
   - Review institution status

2. **Sync Issues**  
   - Check sync job logs
   - Verify cursor state
   - Review error patterns

3. **Matching Problems**
   - Adjust confidence thresholds
   - Review matching rules
   - Check merchant normalization

### Debug Tools

- `/api/plaid/sync-status` - Overall health
- Database sync job tables
- Application logs
- Plaid dashboard

## Support

For additional support:
- Check Plaid documentation
- Review application logs
- Contact system administrators
- File issues in project repository