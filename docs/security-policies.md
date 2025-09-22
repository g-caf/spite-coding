# Security Policies & Implementation

## Overview

The expense platform implements comprehensive security measures including Row-Level Security (RLS), data encryption, audit trails, and role-based access control. This document details the security implementation and best practices.

## Row-Level Security (RLS)

### Implementation

All tables containing organization-specific data implement RLS policies that automatically filter data based on the current organization context.

### Setting Organization Context

Before executing any queries, the application must set the organization context:

```sql
-- Set the current organization context
SELECT set_config('app.current_organization_id', '<organization_uuid>', true);

-- Optionally set user context for additional audit trail information
SELECT set_config('app.current_user_id', '<user_uuid>', true);
```

### RLS Policies

Each organization-scoped table has a policy like this:

```sql
-- Example: Users table RLS policy
CREATE POLICY users_isolation ON users
  FOR ALL USING (organization_id = current_setting('app.current_organization_id')::uuid);

-- Example: More complex policy with role-based restrictions
CREATE POLICY transactions_access ON transactions
  FOR SELECT USING (
    organization_id = current_setting('app.current_organization_id')::uuid
    AND (
      -- Admins can see all transactions
      EXISTS (
        SELECT 1 FROM role_assignments ra 
        WHERE ra.user_id = current_setting('app.current_user_id')::uuid 
        AND ra.role = 'admin' 
        AND ra.active = true
      )
      OR 
      -- Users can see transactions they created or were assigned to
      created_by = current_setting('app.current_user_id')::uuid
    )
  );
```

### Testing RLS

```sql
-- Test organization isolation
SET app.current_organization_id = '00000000-0000-0000-0000-000000000001';
SELECT COUNT(*) FROM users; -- Should only show Org 1 users

SET app.current_organization_id = '00000000-0000-0000-0000-000000000002';  
SELECT COUNT(*) FROM users; -- Should only show Org 2 users
```

## Data Encryption

### Encrypted Fields

The following fields are encrypted at rest:

- `users.encrypted_ssn` - Social Security Numbers
- `accounts.encrypted_account_number` - Bank account numbers

### Encryption Setup

```sql
-- Set encryption key (should be done at application level)
SELECT set_config('app.encryption_key', 'your-strong-encryption-key-here', true);
```

### Encryption Functions

```sql
-- Encrypt account number
CREATE OR REPLACE FUNCTION encrypt_account_number(account_number TEXT)
RETURNS TEXT AS $$
BEGIN
  RETURN encode(
    pgp_sym_encrypt(
      account_number, 
      current_setting('app.encryption_key')
    ), 
    'base64'
  );
END;
$$ LANGUAGE plpgsql;

-- Decrypt account number
CREATE OR REPLACE FUNCTION decrypt_account_number(encrypted_account_number TEXT)
RETURNS TEXT AS $$
BEGIN
  IF encrypted_account_number IS NULL THEN
    RETURN NULL;
  END IF;
  
  RETURN pgp_sym_decrypt(
    decode(encrypted_account_number, 'base64'),
    current_setting('app.encryption_key')
  );
END;
$$ LANGUAGE plpgsql;
```

### Usage Example

```sql
-- Insert encrypted data
INSERT INTO accounts (id, organization_id, name, encrypted_account_number)
VALUES (
  uuid_generate_v4(),
  current_setting('app.current_organization_id')::uuid,
  'Business Checking',
  encrypt_account_number('1234567890')
);

-- Query with decryption (requires encryption key)
SELECT 
  name,
  decrypt_account_number(encrypted_account_number) as account_number
FROM accounts;
```

## Role-Based Access Control (RBAC)

### Role Hierarchy

1. **Admin** - Full system access
2. **Manager** - Department/team management
3. **Employee** - Standard user access
4. **Viewer** - Read-only access

### Permission System

Permissions are stored as JSON in the `role_assignments` table:

```json
{
  "users": ["create", "read", "update", "delete"],
  "accounts": ["read", "update"],
  "transactions": ["create", "read", "update"],
  "receipts": ["create", "read", "update", "delete"],
  "reports": ["create", "read", "update"]
}
```

### Checking Permissions

```sql
-- Function to check user permissions
CREATE OR REPLACE FUNCTION check_user_permission(
  user_id UUID,
  resource TEXT,
  action TEXT
) RETURNS BOOLEAN AS $$
DECLARE
  has_permission BOOLEAN := false;
BEGIN
  SELECT EXISTS (
    SELECT 1 
    FROM role_assignments ra
    WHERE ra.user_id = check_user_permission.user_id
    AND ra.organization_id = current_setting('app.current_organization_id')::uuid
    AND ra.active = true
    AND (ra.expires_at IS NULL OR ra.expires_at > NOW())
    AND (
      ra.permissions->resource ? action
      OR ra.role = 'admin' -- Admins have all permissions
    )
  ) INTO has_permission;
  
  RETURN has_permission;
END;
$$ LANGUAGE plpgsql;

-- Usage
SELECT check_user_permission(
  '00000000-0000-0000-0000-000000000101'::uuid,
  'transactions',
  'create'
);
```

## Audit Trail

### Automatic Audit Logging

All data changes are automatically logged via triggers:

```sql
CREATE OR REPLACE FUNCTION audit_trigger() 
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO audit_events (
    id,
    event_type,
    table_name,
    record_id,
    user_id,
    organization_id,
    old_values,
    new_values,
    created_at
  ) VALUES (
    uuid_generate_v4(),
    CASE 
      WHEN TG_OP = 'INSERT' THEN 'create'::audit_event_type
      WHEN TG_OP = 'UPDATE' THEN 'update'::audit_event_type
      WHEN TG_OP = 'DELETE' THEN 'delete'::audit_event_type
    END,
    TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id),
    COALESCE(NEW.updated_by, OLD.updated_by, NEW.created_by, OLD.created_by),
    COALESCE(NEW.organization_id, OLD.organization_id),
    CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN to_jsonb(NEW) ELSE NULL END,
    NOW()
  );
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
```

### Manual Audit Events

```sql
-- Log custom events (login, permission changes, etc.)
INSERT INTO audit_events (
  id, event_type, user_id, organization_id, metadata, created_at
) VALUES (
  uuid_generate_v4(),
  'login'::audit_event_type,
  current_setting('app.current_user_id')::uuid,
  current_setting('app.current_organization_id')::uuid,
  jsonb_build_object(
    'ip_address', '192.168.1.100',
    'user_agent', 'Mozilla/5.0...',
    'success', true
  ),
  NOW()
);
```

### Audit Queries

```sql
-- Get audit trail for a specific record
SELECT 
  ae.event_type,
  ae.created_at,
  u.first_name || ' ' || u.last_name as user_name,
  ae.old_values,
  ae.new_values
FROM audit_events ae
LEFT JOIN users u ON ae.user_id = u.id
WHERE ae.table_name = 'transactions'
  AND ae.record_id = '<transaction_uuid>'
ORDER BY ae.created_at DESC;

-- Get recent activity summary
SELECT 
  ae.event_type,
  ae.table_name,
  COUNT(*) as event_count,
  MAX(ae.created_at) as last_event
FROM audit_events ae
WHERE ae.organization_id = current_setting('app.current_organization_id')::uuid
  AND ae.created_at >= NOW() - INTERVAL '24 hours'
GROUP BY ae.event_type, ae.table_name
ORDER BY event_count DESC;
```

## Application-Level Security

### Session Management

```javascript
// Example session management (Node.js/Express)
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 8 // 8 hours
  }
}));

// Set database context on each request
app.use(async (req, res, next) => {
  if (req.user) {
    await db.raw('SELECT set_config(?, ?, true)', [
      'app.current_organization_id', 
      req.user.organization_id
    ]);
    await db.raw('SELECT set_config(?, ?, true)', [
      'app.current_user_id', 
      req.user.id
    ]);
    await db.raw('SELECT set_config(?, ?, true)', [
      'app.encryption_key', 
      process.env.DB_ENCRYPTION_KEY
    ]);
  }
  next();
});
```

### Input Validation

```javascript
// Example input validation middleware
const validateTransaction = (req, res, next) => {
  const { amount, description, category_id } = req.body;
  
  // Validate required fields
  if (!amount || amount <= 0) {
    return res.status(400).json({ error: 'Valid amount required' });
  }
  
  if (!description || description.trim().length === 0) {
    return res.status(400).json({ error: 'Description required' });
  }
  
  // Sanitize inputs
  req.body.description = description.trim().substring(0, 255);
  
  // Validate UUIDs
  if (category_id && !isValidUUID(category_id)) {
    return res.status(400).json({ error: 'Invalid category ID' });
  }
  
  next();
};
```

### API Security Headers

```javascript
// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  next();
});
```

## Security Best Practices

### Database Level

1. **Use prepared statements** - Always use parameterized queries
2. **Limit privileges** - Database users should have minimal required privileges
3. **Enable SSL** - All database connections should use SSL/TLS
4. **Regular updates** - Keep PostgreSQL updated with security patches
5. **Monitor access** - Log and monitor all database access

### Application Level

1. **Authentication** - Implement strong authentication (MFA recommended)
2. **Session security** - Use secure session management
3. **Input validation** - Validate and sanitize all user inputs
4. **Output encoding** - Encode output to prevent XSS
5. **HTTPS only** - All communication should use HTTPS
6. **Rate limiting** - Implement rate limiting on API endpoints

### Operational Security

1. **Key management** - Use proper key management systems (AWS KMS, HashiCorp Vault)
2. **Environment separation** - Separate dev/staging/production environments
3. **Access logging** - Log all system access
4. **Regular audits** - Conduct regular security audits
5. **Backup encryption** - Encrypt all backups
6. **Incident response** - Have incident response procedures in place

## Compliance Requirements

### SOX Compliance

- Immutable audit trail for all financial data changes
- Access controls and segregation of duties
- Regular access reviews and certifications

### PCI DSS (if handling payment data)

- Encrypted storage of sensitive payment data
- Access controls and monitoring
- Regular security assessments

### GDPR (for EU users)

- Data anonymization/deletion capabilities
- Consent management
- Data portability features
- Privacy by design implementation

## Security Monitoring

### Database Monitoring

```sql
-- Monitor failed login attempts
SELECT 
  metadata->>'ip_address' as ip,
  COUNT(*) as failed_attempts,
  MAX(created_at) as last_attempt
FROM audit_events 
WHERE event_type = 'login' 
  AND metadata->>'success' = 'false'
  AND created_at >= NOW() - INTERVAL '1 hour'
GROUP BY metadata->>'ip_address'
HAVING COUNT(*) > 5;

-- Monitor privilege escalations
SELECT *
FROM audit_events
WHERE event_type IN ('permission_grant', 'permission_revoke')
  AND created_at >= NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC;
```

### Application Monitoring

- Monitor authentication failures
- Track API rate limiting violations  
- Alert on unusual data access patterns
- Log all administrative actions
- Monitor for SQL injection attempts

This comprehensive security framework provides enterprise-grade protection while maintaining usability and performance.