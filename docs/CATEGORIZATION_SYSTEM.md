# Smart Expense Categorization System

A comprehensive, AI-powered expense categorization system with machine learning, rule-based automation, and policy enforcement for enterprise expense management.

## 🎯 Overview

This system automates expense categorization through multiple intelligent approaches:

1. **Rule-Based Engine** - If-then rules for deterministic categorization
2. **Machine Learning** - AI-powered category suggestions based on transaction patterns
3. **Policy Engine** - Compliance and spending limit enforcement
4. **Smart Matching** - Merchant normalization and pattern recognition
5. **Interactive UI** - User-friendly categorization interface with bulk operations

## 🏗️ System Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Frontend UI   │    │   API Routes     │    │   Services      │
│                 │    │                  │    │                 │
│ • Category UI   │◄──►│ • /categories    │◄──►│ • CategorySvc   │
│ • Rule Builder  │    │ • /rules         │    │ • RuleEngine    │
│ • Bulk Actions  │    │ • /transactions  │    │ • PolicyEngine  │
│ • Analytics     │    │ • /policy        │    │ • ML Service    │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                ▲
                                │
                       ┌──────────────────┐
                       │    Database      │
                       │                  │
                       │ • Categories     │
                       │ • Rules          │
                       │ • Transactions   │
                       │ • Policy Rules   │
                       │ • Violations     │
                       │ • Suggestions    │
                       └──────────────────┘
```

## 📊 Database Schema

### Core Tables

#### Categories
```sql
categories (
  id UUID PRIMARY KEY,
  organization_id UUID,
  name VARCHAR NOT NULL,
  parent_id UUID REFERENCES categories(id),
  gl_account_id UUID,
  tax_settings JSONB,
  department_settings JSONB,
  policy_settings JSONB,
  auto_categorization_count INT,
  manual_override_count INT,
  accuracy_score DECIMAL(5,4)
)
```

#### Rules
```sql
rules (
  id UUID PRIMARY KEY,
  organization_id UUID,
  name VARCHAR NOT NULL,
  rule_type ENUM('categorization', 'policy', 'automation'),
  conditions JSONB,
  actions JSONB,
  priority INT,
  success_rate DECIMAL(5,4),
  match_count INT
)
```

#### Policy Rules
```sql
policy_rules (
  id UUID PRIMARY KEY,
  organization_id UUID,
  policy_type ENUM('spending_limit', 'receipt_requirement', ...),
  conditions JSONB,
  enforcement JSONB,
  severity ENUM('low', 'medium', 'high', 'critical')
)
```

### Intelligence Tables

#### Category Suggestions
```sql
category_suggestions (
  id UUID PRIMARY KEY,
  transaction_id UUID,
  suggested_category_id UUID,
  confidence_score DECIMAL(5,4),
  reasoning JSONB,
  suggestion_source VARCHAR,
  accepted BOOLEAN
)
```

#### Merchant Intelligence
```sql
merchant_intelligence (
  id UUID PRIMARY KEY,
  raw_merchant_name VARCHAR,
  normalized_name VARCHAR,
  canonical_merchant_id UUID,
  confidence_score DECIMAL(5,4),
  usage_count INT
)
```

## 🤖 Rule Engine

### Rule Structure

Rules follow a flexible JSON structure for conditions and actions:

```javascript
// Example Rule
{
  "name": "Auto-categorize Starbucks as Business Meals",
  "rule_type": "categorization",
  "conditions": {
    "merchant_names": ["starbucks", "starbucks coffee"],
    "amount_range": { "min": 1.00, "max": 100.00 },
    "time_conditions": {
      "business_hours_only": true
    }
  },
  "actions": {
    "set_category": "business-meals-category-id",
    "require_receipt": true,
    "set_memo": "Auto-categorized business meal"
  },
  "priority": 100
}
```

### Supported Conditions

#### Basic Conditions
- **merchant_names**: Array of merchant names to match
- **merchant_categories**: MCC codes or categories
- **amount_range**: Min/max amount thresholds
- **description_keywords**: Keywords in transaction description

#### Advanced Conditions
- **user_ids**: Specific users this rule applies to
- **time_conditions**: Business hours, weekdays, date ranges
- **frequency_conditions**: Transaction frequency limits
- **location_conditions**: Geographic restrictions
- **custom_logic**: JavaScript expressions for complex logic

#### AI-Enhanced Conditions
- **similarity_conditions**: ML-based transaction similarity
- **merchant_intelligence**: Normalized merchant matching

### Supported Actions

#### Categorization Actions
- **set_category**: Assign expense category
- **set_gl_account**: Map to GL account
- **set_memo**: Add transaction memo

#### Workflow Actions
- **require_approval**: Force manual approval
- **require_receipt**: Mandate receipt upload
- **flag_for_review**: Mark for manual review

#### Notification Actions
- **notify_manager**: Alert user's manager
- **notify_users**: Alert specific users
- **send_email**: Custom email notifications

#### Policy Actions
- **block_transaction**: Prevent transaction processing
- **create_violation**: Log policy violation
- **apply_spending_limit**: Enforce spending limits

## 🧠 Machine Learning Components

### Category Suggestion Engine

The ML engine uses multiple approaches for intelligent suggestions:

1. **Similarity-Based Matching**
   ```javascript
   // Find similar transactions
   SELECT category_id, COUNT(*) as frequency
   FROM transactions 
   WHERE similarity(description, ?) > 0.3
     AND ABS(amount - ?) < (? * 0.5)
   GROUP BY category_id
   ORDER BY frequency DESC
   ```

2. **Merchant History Analysis**
   ```javascript
   // Historical merchant categorization
   const merchantHistory = await getMerchantCategorization(merchantName);
   const suggestion = {
     category_id: mostFrequentCategory,
     confidence_score: frequency / totalTransactions,
     reasoning: ["Historical categorization pattern"]
   };
   ```

3. **Pattern Recognition**
   - Amount patterns by category
   - Time-based categorization patterns
   - User-specific preferences
   - Department spending patterns

### Learning Feedback Loop

```javascript
// User corrections improve the system
async submitLearningFeedback({
  transaction_id,
  expected_category_id,
  correction_type: 'category',
  feedback: 'User explanation'
}) {
  // Store feedback
  await recordFeedback(feedback);
  
  // Update model weights
  await updateMLModel(feedback);
  
  // Generate new rules if patterns detected
  const patterns = await analyzeUserCorrections();
  if (patterns.length > 0) {
    await suggestNewRules(patterns);
  }
}
```

## 🛡️ Policy Engine

### Policy Types

#### Spending Limits
```javascript
{
  "policy_type": "spending_limit",
  "conditions": {
    "user_ids": ["user-id"],
    "amount_limits": {
      "daily": 500,
      "monthly": 5000,
      "per_transaction": 1000
    }
  },
  "enforcement": {
    "require_approval": true,
    "notify_manager": true,
    "block_transaction": false
  }
}
```

#### Receipt Requirements
```javascript
{
  "policy_type": "receipt_requirement",
  "conditions": {
    "receipt_requirements": {
      "threshold_amount": 25.00,
      "categories_requiring_receipt": ["travel", "meals"],
      "max_days_to_submit": 30
    }
  },
  "enforcement": {
    "flag_for_review": true,
    "require_justification": true
  }
}
```

#### Time Restrictions
```javascript
{
  "policy_type": "time_restriction",
  "conditions": {
    "time_restrictions": {
      "business_hours_only": true,
      "weekdays_only": false,
      "blocked_dates": ["2024-12-25", "2024-01-01"]
    }
  },
  "enforcement": {
    "require_approval": true,
    "notify_compliance": true
  }
}
```

### Compliance Monitoring

The system automatically tracks compliance metrics:

```javascript
// Daily compliance calculation
const complianceMetrics = {
  total_transactions: 150,
  compliant_transactions: 142,
  policy_violations: 8,
  compliance_rate: 94.67,
  violation_breakdown: {
    "spending_limit": 3,
    "receipt_requirement": 4,
    "time_restriction": 1
  }
};
```

## 📡 API Endpoints

### Category Management

```bash
# List categories (hierarchical)
GET /api/categories?include_hierarchy=true

# Create category
POST /api/categories
{
  "name": "Business Meals",
  "parent_id": "travel-category-id",
  "gl_account_id": "gl-account-id",
  "tax_settings": { "taxable": true, "tax_rate": 0.08 },
  "policy_settings": { "receipt_required": true }
}

# Bulk categorize transactions
POST /api/categories/bulk-categorize
{
  "transaction_ids": ["txn1", "txn2"],
  "category_id": "category-id",
  "apply_rules": true
}

# Category analytics
GET /api/categories/analytics/usage?start_date=2024-01-01&end_date=2024-12-31
```

### Rule Engine

```bash
# List rules with filtering
GET /api/rules?active_only=true&rule_type=categorization

# Create rule
POST /api/rules
{
  "name": "Travel Expense Rule",
  "rule_type": "categorization",
  "conditions": { /* conditions */ },
  "actions": { /* actions */ },
  "priority": 100
}

# Test rule against transactions
POST /api/rules/test
{
  "rule": { /* rule definition */ },
  "test_transactions": [ /* sample transactions */ ],
  "dry_run": true
}

# Apply rule to existing transactions
POST /api/rules/:id/apply
{
  "date_range": { "start": "2024-01-01", "end": "2024-12-31" },
  "dry_run": false
}

# Rule performance analytics
GET /api/rules/analytics/performance?start_date=2024-01-01
```

### Transaction Categorization

```bash
# Categorize single transaction
POST /api/transactions/:id/categorize
{
  "category_id": "category-id",
  "apply_rules": true,
  "confidence_override": 0.95
}

# Get AI suggestions
GET /api/transactions/:id/suggestions?limit=5

# Auto-categorize multiple transactions
POST /api/transactions/auto-categorize
{
  "confidence_threshold": 0.8,
  "date_range": { "start": "2024-01-01", "end": "2024-12-31" },
  "dry_run": false
}

# Accept AI suggestion
POST /api/transactions/suggestions/accept
{
  "suggestion_id": "suggestion-id",
  "feedback": "Good suggestion"
}

# Get uncategorized transactions
GET /api/transactions/uncategorized?limit=20&include_suggestions=true

# Categorization analytics
GET /api/transactions/categorization/analytics?include_accuracy=true
```

### Policy Engine

```bash
# List policy rules
GET /api/policy/rules?policy_type=spending_limit&active_only=true

# Create policy rule
POST /api/policy/rules
{
  "name": "Daily Spending Limit",
  "policy_type": "spending_limit",
  "conditions": { /* conditions */ },
  "enforcement": { /* enforcement actions */ },
  "severity": "high"
}

# List policy violations
GET /api/policy/violations?status=open&severity=high

# Resolve violation
PUT /api/policy/violations/:id/resolve
{
  "resolution": "resolved",
  "notes": "Approved by manager"
}

# Generate compliance report
GET /api/policy/compliance/report?start_date=2024-01-01&end_date=2024-12-31

# Policy dashboard
GET /api/policy/dashboard

# Evaluate transaction against policies
POST /api/policy/evaluate
{
  "transaction_id": "transaction-id"
}

# Spending limits
GET /api/policy/spending-limits?user_id=user-id
POST /api/policy/spending-limits
{
  "limit_type": "monthly",
  "limit_amount": 5000,
  "category_id": "travel-category"
}
```

## 🎨 User Interface

### Categorization Dashboard

The main UI provides:

1. **Transaction List**: Uncategorized transactions with AI suggestions
2. **Bulk Actions**: Auto-categorize, bulk assign, rule application
3. **Category Hierarchy**: Searchable category tree
4. **Analytics**: Categorization accuracy, time saved, compliance metrics
5. **Rule Builder**: Visual rule creation interface

### Key Features

#### Smart Suggestions
- AI-powered category recommendations
- Confidence scoring
- Reasoning explanations
- One-click acceptance

#### Bulk Operations
- Auto-categorize with confidence threshold
- Bulk category assignment
- Rule-based processing
- Preview before applying

#### Analytics Dashboard
- Categorization accuracy trends
- Time savings metrics
- Top merchants analysis
- Category usage statistics

## 🚀 Getting Started

### 1. Database Setup

```bash
# Run migrations
npm run migrate

# Seed sample data
npm run seed
```

### 2. Configure Environment

```bash
# Set up environment variables
cp .env.example .env

# Configure database connection
DATABASE_URL=postgresql://user:pass@localhost:5432/expense_platform

# Configure ML services (optional)
ML_SERVICE_URL=http://localhost:8080
ML_API_KEY=your-api-key
```

### 3. Start Services

```bash
# Start main application
npm run dev

# Start ML service (optional)
npm run ml-service
```

### 4. Access UI

Visit `http://localhost:3000/categorization` for the categorization interface.

## 🔧 Configuration

### Rule Engine Settings

```javascript
// config/rules.js
module.exports = {
  maxRulesPerOrganization: 100,
  defaultConfidenceThreshold: 0.8,
  maxConditionsPerRule: 10,
  ruleExecutionTimeout: 5000,
  enableMLSuggestions: true,
  enableLearningFeedback: true
};
```

### ML Configuration

```javascript
// config/ml.js
module.exports = {
  suggestionLimit: 5,
  minConfidenceScore: 0.3,
  similarityThreshold: 0.3,
  retrainInterval: '24 hours',
  featureExtraction: {
    useAmount: true,
    useDescription: true,
    useMerchant: true,
    useTime: true,
    useLocation: false
  }
};
```

### Policy Engine Settings

```javascript
// config/policy.js
module.exports = {
  maxPoliciesPerOrganization: 50,
  defaultSpendingLimitCurrency: 'USD',
  receiptRequiredThreshold: 25.00,
  violationSeverityLevels: ['low', 'medium', 'high', 'critical'],
  autoComplianceReporting: true,
  complianceReportSchedule: 'daily'
};
```

## 📈 Performance Optimization

### Database Optimization

- Indexes on frequently queried columns
- Partitioning for large transaction tables
- Query optimization with EXPLAIN
- Connection pooling

### Caching Strategy

```javascript
// Redis caching for frequently accessed data
const cache = {
  categories: '1 hour',
  rules: '30 minutes',
  suggestions: '15 minutes',
  merchantIntelligence: '24 hours'
};
```

### Batch Processing

```javascript
// Process transactions in batches
const batchSize = 100;
const transactions = await getUncategorizedTransactions();

for (let i = 0; i < transactions.length; i += batchSize) {
  const batch = transactions.slice(i, i + batchSize);
  await processTransactionBatch(batch);
}
```

## 🧪 Testing

### Unit Tests

```bash
# Run unit tests
npm test

# Run specific test suite
npm test -- --grep "CategoryService"

# Run with coverage
npm run test:coverage
```

### Integration Tests

```bash
# Run integration tests
npm run test:integration

# Test specific endpoints
npm run test:integration -- --grep "categorization routes"
```

### Performance Tests

```bash
# Load testing
npm run test:load

# Memory leak testing
npm run test:memory
```

## 🔒 Security Considerations

### Data Protection
- Row-level security (RLS) for multi-tenant isolation
- Encryption of sensitive financial data
- Audit logging for all categorization changes
- GDPR compliance for user data

### API Security
- JWT-based authentication
- Role-based authorization
- Rate limiting on API endpoints
- Input validation and sanitization

### Policy Enforcement
- Spending limit enforcement
- Approval workflow security
- Violation tracking and alerting
- Compliance reporting

## 📊 Monitoring & Analytics

### System Metrics
- Categorization accuracy rates
- Rule execution performance
- Policy compliance rates
- User adoption metrics

### Business Intelligence
- Category spending trends
- Merchant analysis
- Department budget tracking
- Compliance reporting

### Alerting
- Policy violations
- System errors
- Performance degradation
- Compliance issues

## 🛠️ Maintenance

### Regular Tasks
- Model retraining
- Rule optimization
- Policy updates
- Data cleanup

### Monitoring
- System health checks
- Performance monitoring
- Error tracking
- User feedback analysis

## 📚 Additional Resources

- [API Documentation](./API_DOCS.md)
- [Rule Engine Guide](./RULE_ENGINE.md)
- [Policy Configuration](./POLICY_GUIDE.md)
- [ML Model Training](./ML_TRAINING.md)
- [Deployment Guide](./DEPLOYMENT.md)

---

This comprehensive categorization system provides enterprise-grade expense management with intelligent automation, ensuring accuracy, compliance, and significant time savings for finance teams.
