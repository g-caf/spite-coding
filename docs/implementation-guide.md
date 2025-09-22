# Implementation Guide

## Getting Started

This guide walks through implementing the expense platform database schema and building applications on top of it.

## Project Structure

```
expense-platform/
├── database/
│   ├── migrations/           # Database schema migrations
│   │   ├── 001_initial_setup.js
│   │   ├── 002_organizations_and_users.js
│   │   ├── 003_financial_accounts.js
│   │   ├── 004_transactions_and_authorizations.js
│   │   ├── 005_receipts_and_matching.js
│   │   └── 006_business_logic_and_functions.js
│   ├── seeds/               # Development seed data
│   │   ├── 001_organizations_and_users.js
│   │   ├── 002_financial_data.js
│   │   ├── 003_transactions_and_receipts.js
│   │   └── 004_rules_and_automation.js
│   └── functions/           # SQL functions and procedures
│       └── security_functions.sql
├── docs/                    # Documentation
│   ├── schema-overview.md
│   ├── security-policies.md
│   └── implementation-guide.md
├── package.json
├── knexfile.js
├── README.md
└── .env.example
```

## Database Setup

### 1. Install Dependencies

```bash
npm install knex pg bcrypt
```

### 2. Configure Database Connection

Create `.env` from `.env.example`:

```bash
cp .env.example .env
```

Edit `.env` with your database credentials:

```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=expense_platform_dev
DB_USER=expense_user
DB_PASSWORD=expense_password
DB_ENCRYPTION_KEY=your-strong-32-character-encryption-key
```

### 3. Create Database and Run Migrations

```bash
# Create database
createdb expense_platform_dev

# Run migrations
npx knex migrate:latest

# Seed with sample data
npx knex seed:run
```

## Application Integration

### Database Connection Setup

```javascript
// db.js
const knex = require('knex');
const config = require('./knexfile')[process.env.NODE_ENV || 'development'];

const db = knex(config);

// Helper function to set organization context
async function setOrganizationContext(organizationId, userId = null, encryptionKey = null) {
  await db.raw('SELECT set_config(?, ?, true)', [
    'app.current_organization_id', 
    organizationId
  ]);
  
  if (userId) {
    await db.raw('SELECT set_config(?, ?, true)', [
      'app.current_user_id', 
      userId
    ]);
  }
  
  if (encryptionKey) {
    await db.raw('SELECT set_config(?, ?, true)', [
      'app.encryption_key', 
      encryptionKey
    ]);
  }
}

module.exports = { db, setOrganizationContext };
```

### Express.js Middleware

```javascript
// middleware/security.js
const { setOrganizationContext } = require('../db');

// Set database context for each request
async function setDatabaseContext(req, res, next) {
  if (req.user) {
    try {
      await setOrganizationContext(
        req.user.organization_id,
        req.user.id,
        process.env.DB_ENCRYPTION_KEY
      );
    } catch (error) {
      console.error('Failed to set database context:', error);
      return res.status(500).json({ error: 'Database context error' });
    }
  }
  next();
}

// Check user permissions
function requirePermission(resource, action) {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    try {
      const hasPermission = await db.raw(
        'SELECT check_user_permission(?, ?, ?)', 
        [req.user.id, resource, action]
      );
      
      if (!hasPermission.rows[0].check_user_permission) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
      
      next();
    } catch (error) {
      console.error('Permission check error:', error);
      return res.status(500).json({ error: 'Permission check failed' });
    }
  };
}

module.exports = { setDatabaseContext, requirePermission };
```

### API Endpoints

```javascript
// routes/transactions.js
const express = require('express');
const { db } = require('../db');
const { requirePermission } = require('../middleware/security');

const router = express.Router();

// Get transactions with pagination
router.get('/', requirePermission('transactions', 'read'), async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;
    
    const transactions = await db('transactions')
      .select(
        'transactions.*',
        'merchants.name as merchant_name',
        'categories.name as category_name',
        'accounts.name as account_name'
      )
      .leftJoin('merchants', 'transactions.merchant_id', 'merchants.id')
      .leftJoin('categories', 'transactions.category_id', 'categories.id')
      .leftJoin('accounts', 'transactions.account_id', 'accounts.id')
      .orderBy('transaction_date', 'desc')
      .limit(limit)
      .offset(offset);
    
    const total = await db('transactions').count('id as count').first();
    
    res.json({
      data: transactions,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(total.count),
        pages: Math.ceil(total.count / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

// Create new transaction
router.post('/', requirePermission('transactions', 'create'), async (req, res) => {
  try {
    const {
      account_id,
      merchant_id,
      category_id,
      amount,
      description,
      transaction_date,
      memo
    } = req.body;
    
    // Validate required fields
    if (!account_id || !amount || !description || !transaction_date) {
      return res.status(400).json({ 
        error: 'Missing required fields: account_id, amount, description, transaction_date' 
      });
    }
    
    const [transaction] = await db('transactions')
      .insert({
        id: db.raw('uuid_generate_v4()'),
        account_id,
        merchant_id,
        category_id,
        transaction_id: `TXN_${Date.now()}`,
        type: amount < 0 ? 'debit' : 'credit',
        amount: Math.abs(amount),
        description,
        memo,
        transaction_date,
        status: 'processed',
        created_by: req.user.id
      })
      .returning('*');
    
    res.status(201).json(transaction);
  } catch (error) {
    console.error('Error creating transaction:', error);
    res.status(500).json({ error: error.message || 'Failed to create transaction' });
  }
});

// Get unmatched transactions
router.get('/unmatched', requirePermission('transactions', 'read'), async (req, res) => {
  try {
    const unmatched = await db('transactions')
      .leftJoin('matches', function() {
        this.on('transactions.id', '=', 'matches.transaction_id')
            .andOn('matches.active', '=', db.raw('true'));
      })
      .whereNull('matches.id')
      .where('transactions.status', 'processed')
      .select('transactions.*')
      .orderBy('transactions.transaction_date', 'desc');
    
    res.json(unmatched);
  } catch (error) {
    console.error('Error fetching unmatched transactions:', error);
    res.status(500).json({ error: 'Failed to fetch unmatched transactions' });
  }
});

module.exports = router;
```

### Receipt Processing

```javascript
// routes/receipts.js
const express = require('express');
const multer = require('multer');
const { db } = require('../db');
const { requirePermission } = require('../middleware/security');

const upload = multer({ dest: 'uploads/' });
const router = express.Router();

// Upload receipt
router.post('/', 
  upload.single('receipt'),
  requirePermission('receipts', 'create'),
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'Receipt file is required' });
    }
    
    try {
      const [receipt] = await db('receipts')
        .insert({
          id: db.raw('uuid_generate_v4()'),
          uploaded_by: req.user.id,
          original_filename: req.file.originalname,
          file_path: req.file.path,
          file_type: req.file.mimetype,
          file_size: req.file.size,
          file_hash: calculateFileHash(req.file.buffer),
          status: 'uploaded'
        })
        .returning('*');
      
      // Trigger OCR processing (would integrate with OCR service)
      processReceiptAsync(receipt.id);
      
      res.status(201).json(receipt);
    } catch (error) {
      console.error('Error uploading receipt:', error);
      res.status(500).json({ error: 'Failed to upload receipt' });
    }
  }
);

// Get receipt processing status
router.get('/:id/status', requirePermission('receipts', 'read'), async (req, res) => {
  try {
    const receipt = await db('receipts')
      .select('id', 'status', 'processed_at', 'processing_errors')
      .where('id', req.params.id)
      .first();
    
    if (!receipt) {
      return res.status(404).json({ error: 'Receipt not found' });
    }
    
    res.json(receipt);
  } catch (error) {
    console.error('Error fetching receipt status:', error);
    res.status(500).json({ error: 'Failed to fetch receipt status' });
  }
});

// Get extracted fields
router.get('/:id/fields', requirePermission('receipts', 'read'), async (req, res) => {
  try {
    const fields = await db('extracted_fields')
      .where('receipt_id', req.params.id)
      .orderBy('field_name');
    
    res.json(fields);
  } catch (error) {
    console.error('Error fetching extracted fields:', error);
    res.status(500).json({ error: 'Failed to fetch extracted fields' });
  }
});

// Verify extracted field
router.put('/:receiptId/fields/:fieldId/verify', 
  requirePermission('receipts', 'update'),
  async (req, res) => {
    try {
      const { field_value } = req.body;
      
      await db('extracted_fields')
        .where('id', req.params.fieldId)
        .where('receipt_id', req.params.receiptId)
        .update({
          field_value,
          verified: true,
          verified_by: req.user.id,
          verified_at: db.fn.now()
        });
      
      res.json({ message: 'Field verified successfully' });
    } catch (error) {
      console.error('Error verifying field:', error);
      res.status(500).json({ error: 'Failed to verify field' });
    }
  }
);

module.exports = router;
```

### Matching System

```javascript
// services/matching.js
const { db } = require('../db');

class MatchingService {
  // Find potential matches for a transaction
  async findPotentialMatches(transactionId) {
    const query = `
      SELECT 
        r.id as receipt_id,
        r.total_amount,
        r.receipt_date,
        r.merchant_name,
        calculate_match_score(?, r.id) as match_score
      FROM receipts r
      WHERE r.status = 'processed'
      AND NOT EXISTS (
        SELECT 1 FROM matches m 
        WHERE m.receipt_id = r.id 
        AND m.active = true
      )
      AND calculate_match_score(?, r.id) >= 0.7
      ORDER BY match_score DESC
      LIMIT 10
    `;
    
    const results = await db.raw(query, [transactionId, transactionId]);
    return results.rows;
  }
  
  // Create a manual match
  async createMatch(transactionId, receiptId, userId, notes = null) {
    const matchScore = await db.raw(
      'SELECT calculate_match_score(?, ?) as score',
      [transactionId, receiptId]
    );
    
    const [match] = await db('matches')
      .insert({
        id: db.raw('uuid_generate_v4()'),
        transaction_id: transactionId,
        receipt_id: receiptId,
        match_type: 'manual',
        confidence_score: matchScore.rows[0].score,
        matching_criteria: {
          manual_review: true,
          reviewed_by: userId
        },
        matched_by: userId,
        active: true,
        notes
      })
      .returning('*');
    
    // Update receipt status
    await db('receipts')
      .where('id', receiptId)
      .update({ status: 'matched' });
    
    return match;
  }
  
  // Auto-match based on rules
  async performAutoMatching() {
    const unmatchedTransactions = await db('transactions')
      .leftJoin('matches', function() {
        this.on('transactions.id', '=', 'matches.transaction_id')
            .andOn('matches.active', '=', db.raw('true'));
      })
      .whereNull('matches.id')
      .where('transactions.status', 'processed')
      .select('transactions.id');
    
    const matches = [];
    
    for (const transaction of unmatchedTransactions) {
      const potentialMatches = await this.findPotentialMatches(transaction.id);
      
      // Auto-match if confidence score is very high (>= 0.9)
      const bestMatch = potentialMatches[0];
      if (bestMatch && bestMatch.match_score >= 0.9) {
        const match = await db('matches')
          .insert({
            id: db.raw('uuid_generate_v4()'),
            transaction_id: transaction.id,
            receipt_id: bestMatch.receipt_id,
            match_type: 'auto',
            confidence_score: bestMatch.match_score,
            matching_criteria: {
              auto_matched: true,
              confidence_threshold: 0.9
            },
            active: true
          })
          .returning('*');
        
        matches.push(match[0]);
        
        // Update receipt status
        await db('receipts')
          .where('id', bestMatch.receipt_id)
          .update({ status: 'matched' });
      }
    }
    
    return matches;
  }
}

module.exports = new MatchingService();
```

## Testing

### Unit Tests

```javascript
// tests/transactions.test.js
const { db, setOrganizationContext } = require('../db');

describe('Transactions', () => {
  beforeEach(async () => {
    await setOrganizationContext('00000000-0000-0000-0000-000000000001');
  });
  
  test('should create transaction with audit trail', async () => {
    const transaction = await db('transactions')
      .insert({
        id: db.raw('uuid_generate_v4()'),
        account_id: '00000000-0000-0000-0000-000000000902',
        transaction_id: 'TEST_001',
        type: 'debit',
        amount: 25.00,
        description: 'Test transaction',
        transaction_date: new Date(),
        status: 'processed',
        created_by: '00000000-0000-0000-0000-000000000101'
      })
      .returning('*');
    
    expect(transaction[0]).toHaveProperty('id');
    expect(transaction[0].amount).toBe('25.00');
    
    // Check audit trail
    const auditEvent = await db('audit_events')
      .where('table_name', 'transactions')
      .where('record_id', transaction[0].id)
      .where('event_type', 'create')
      .first();
    
    expect(auditEvent).toBeTruthy();
  });
});
```

### Integration Tests

```javascript
// tests/integration/matching.test.js
const request = require('supertest');
const app = require('../app');

describe('Matching Integration', () => {
  test('should match transaction to receipt', async () => {
    // Create transaction
    const transactionRes = await request(app)
      .post('/api/transactions')
      .send({
        account_id: '00000000-0000-0000-0000-000000000902',
        amount: 12.50,
        description: 'Coffee purchase',
        transaction_date: '2024-02-01T10:00:00Z'
      })
      .expect(201);
    
    // Upload receipt
    const receiptRes = await request(app)
      .post('/api/receipts')
      .attach('receipt', 'tests/fixtures/starbucks_receipt.jpg')
      .expect(201);
    
    // Create manual match
    const matchRes = await request(app)
      .post('/api/matches')
      .send({
        transaction_id: transactionRes.body.id,
        receipt_id: receiptRes.body.id,
        notes: 'Manual match for testing'
      })
      .expect(201);
    
    expect(matchRes.body.match_type).toBe('manual');
    expect(matchRes.body.confidence_score).toBeGreaterThan(0);
  });
});
```

## Performance Considerations

### Database Optimization

1. **Connection Pooling**
```javascript
// Use connection pooling
const db = knex({
  client: 'postgresql',
  connection: {
    // ... connection config
  },
  pool: {
    min: 5,
    max: 50,
    acquireTimeoutMillis: 60000,
    createTimeoutMillis: 30000,
    destroyTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    reapIntervalMillis: 1000,
    createRetryIntervalMillis: 100,
  }
});
```

2. **Query Optimization**
```javascript
// Use proper indexing and query patterns
const getTransactionsByDateRange = async (startDate, endDate) => {
  return await db('transactions')
    .whereBetween('transaction_date', [startDate, endDate])
    .orderBy('transaction_date', 'desc')
    .select('*');
};
```

3. **Bulk Operations**
```javascript
// Use batch inserts for bulk operations
const createMultipleTransactions = async (transactions) => {
  return await db('transactions')
    .insert(transactions)
    .returning('*');
};
```

### Caching

```javascript
// Use Redis for caching frequently accessed data
const redis = require('redis');
const client = redis.createClient();

const getCachedUserPermissions = async (userId) => {
  const cacheKey = `user_permissions:${userId}`;
  const cached = await client.get(cacheKey);
  
  if (cached) {
    return JSON.parse(cached);
  }
  
  const permissions = await db.raw(
    'SELECT get_user_permissions(?)', 
    [userId]
  );
  
  await client.setex(cacheKey, 300, JSON.stringify(permissions)); // 5 min cache
  return permissions;
};
```

## Monitoring and Maintenance

### Health Checks

```javascript
// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    // Check database connection
    await db.raw('SELECT 1');
    
    // Check RLS is working
    await db.raw('SELECT current_setting(\'row_security\')');
    
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: 'connected',
      rls: 'enabled'
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: error.message
    });
  }
});
```

### Maintenance Tasks

```javascript
// Scheduled maintenance tasks
const cron = require('node-cron');

// Cleanup expired authorizations daily
cron.schedule('0 2 * * *', async () => {
  try {
    const result = await db.raw('SELECT cleanup_expired_authorizations()');
    console.log(`Cleaned up ${result.rows[0].cleanup_expired_authorizations} expired authorizations`);
  } catch (error) {
    console.error('Error cleaning up authorizations:', error);
  }
});

// Archive old audit events monthly
cron.schedule('0 1 1 * *', async () => {
  try {
    const result = await db.raw('SELECT archive_old_audit_events()');
    console.log(`Archived ${result.rows[0].archive_old_audit_events} old audit events`);
  } catch (error) {
    console.error('Error archiving audit events:', error);
  }
});
```

This implementation guide provides a complete foundation for building applications on top of the expense platform database schema. The examples demonstrate proper security practices, performance optimization, and maintainability patterns.