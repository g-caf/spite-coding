/**
 * Business Logic and Functions Migration
 * Advanced business rules, functions, and triggers
 */

const fs = require('fs');
const path = require('path');

exports.up = async function(knex) {
  // Load and execute the security functions SQL file
  const sqlFunctions = fs.readFileSync(
    path.join(__dirname, '../functions/security_functions.sql'),
    'utf8'
  );
  
  await knex.raw(sqlFunctions);

  // Create additional business logic triggers
  await knex.raw(`
    -- Trigger to apply categorization rules after transaction insert/update
    CREATE OR REPLACE FUNCTION apply_rules_after_transaction()
    RETURNS TRIGGER AS $$
    DECLARE
      applied_rules JSONB;
    BEGIN
      -- Only apply rules for processed transactions
      IF NEW.status = 'processed' AND (OLD IS NULL OR OLD.status != 'processed') THEN
        -- Apply categorization rules
        applied_rules := apply_categorization_rules(NEW.id);
        
        -- Log rule application if any rules were applied
        IF jsonb_array_length(applied_rules) > 0 THEN
          PERFORM log_audit_event(
            'update',
            'transactions',
            NEW.id,
            jsonb_build_object(
              'action', 'rules_applied',
              'applied_rules', applied_rules
            )
          );
        END IF;
      END IF;
      
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER apply_rules_after_transaction_trigger
      AFTER INSERT OR UPDATE ON transactions
      FOR EACH ROW
      EXECUTE FUNCTION apply_rules_after_transaction();
  `);

  // Create duplicate detection trigger
  await knex.raw(`
    -- Trigger to detect duplicate transactions
    CREATE OR REPLACE FUNCTION check_duplicates_after_transaction()
    RETURNS TRIGGER AS $$
    DECLARE
      duplicates JSONB;
    BEGIN
      -- Check for duplicates on processed transactions
      IF NEW.status = 'processed' THEN
        duplicates := detect_duplicate_transactions(NEW.id);
        
        -- If potential duplicates found, flag for review
        IF jsonb_array_length(duplicates) > 0 THEN
          -- Update metadata to flag as potential duplicate
          UPDATE transactions SET
            metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
              'potential_duplicates', duplicates,
              'requires_review', true,
              'duplicate_check_date', NOW()
            ),
            updated_at = NOW()
          WHERE id = NEW.id;
          
          -- Log duplicate detection
          PERFORM log_audit_event(
            'update',
            'transactions',
            NEW.id,
            jsonb_build_object(
              'action', 'duplicate_detection',
              'potential_duplicates', duplicates
            )
          );
        END IF;
      END IF;
      
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER check_duplicates_after_transaction_trigger
      AFTER INSERT OR UPDATE ON transactions
      FOR EACH ROW
      EXECUTE FUNCTION check_duplicates_after_transaction();
  `);

  // Create merchant normalization function and trigger
  await knex.raw(`
    -- Function to normalize merchant names
    CREATE OR REPLACE FUNCTION normalize_merchant_name(merchant_name TEXT)
    RETURNS TEXT AS $$
    BEGIN
      IF merchant_name IS NULL THEN
        RETURN NULL;
      END IF;
      
      -- Convert to lowercase and remove common suffixes/prefixes
      merchant_name := lower(trim(merchant_name));
      merchant_name := regexp_replace(merchant_name, '^(the\\s+)', '', 'g');
      merchant_name := regexp_replace(merchant_name, '\\s+(inc|llc|corp|ltd|co)\\s*$', '', 'g');
      merchant_name := regexp_replace(merchant_name, '[^a-z0-9\\s]', '', 'g');
      merchant_name := regexp_replace(merchant_name, '\\s+', ' ', 'g');
      
      RETURN trim(merchant_name);
    END;
    $$ LANGUAGE plpgsql;

    -- Trigger to auto-normalize merchant names
    CREATE OR REPLACE FUNCTION normalize_merchant_before_insert()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.normalized_name := normalize_merchant_name(NEW.name);
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER normalize_merchant_trigger
      BEFORE INSERT OR UPDATE ON merchants
      FOR EACH ROW
      EXECUTE FUNCTION normalize_merchant_before_insert();
  `);

  // Create receipt processing workflow functions
  await knex.raw(`
    -- Function to update receipt processing status
    CREATE OR REPLACE FUNCTION update_receipt_processing_status(
      p_receipt_id UUID,
      p_status receipt_status,
      p_error_message TEXT DEFAULT NULL
    ) RETURNS BOOLEAN AS $$
    BEGIN
      UPDATE receipts SET
        status = p_status,
        processed_at = CASE WHEN p_status IN ('processed', 'failed') THEN NOW() ELSE processed_at END,
        processing_errors = CASE 
          WHEN p_error_message IS NOT NULL 
          THEN COALESCE(processing_errors, '[]'::jsonb) || jsonb_build_array(
            jsonb_build_object(
              'error', p_error_message,
              'timestamp', NOW()
            )
          )
          ELSE processing_errors
        END,
        updated_at = NOW()
      WHERE id = p_receipt_id;
      
      -- Log status change
      PERFORM log_audit_event(
        'update',
        'receipts',
        p_receipt_id,
        jsonb_build_object(
          'action', 'status_change',
          'new_status', p_status,
          'error_message', p_error_message
        )
      );
      
      RETURN true;
    END;
    $$ LANGUAGE plpgsql;
  `);

  // Create account balance validation
  await knex.raw(`
    -- Function to validate account balance before transaction
    CREATE OR REPLACE FUNCTION validate_account_balance()
    RETURNS TRIGGER AS $$
    DECLARE
      account_balance DECIMAL(15,2);
      credit_limit DECIMAL(15,2);
    BEGIN
      -- Get current account balance
      SELECT current_balance INTO account_balance
      FROM accounts
      WHERE id = NEW.account_id;
      
      -- For debit transactions on checking/savings accounts
      IF NEW.type = 'debit' AND EXISTS (
        SELECT 1 FROM accounts 
        WHERE id = NEW.account_id 
        AND account_type IN ('checking', 'savings')
      ) THEN
        -- Check for sufficient funds (allow small overdraft)
        IF (account_balance - NEW.amount) < -100.00 THEN
          RAISE EXCEPTION 'Insufficient funds for transaction. Available balance: %', account_balance;
        END IF;
      END IF;
      
      -- For credit card accounts, check credit limit
      IF NEW.type = 'debit' AND EXISTS (
        SELECT 1 FROM accounts 
        WHERE id = NEW.account_id 
        AND account_type = 'credit_card'
      ) THEN
        credit_limit := COALESCE((
          SELECT (metadata->>'credit_limit')::decimal
          FROM accounts
          WHERE id = NEW.account_id
        ), 0);
        
        IF credit_limit > 0 AND ABS(account_balance - NEW.amount) > credit_limit THEN
          RAISE EXCEPTION 'Transaction exceeds credit limit. Limit: %, Current balance: %', 
            credit_limit, account_balance;
        END IF;
      END IF;
      
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER validate_balance_before_transaction
      BEFORE INSERT OR UPDATE ON transactions
      FOR EACH ROW
      WHEN (NEW.status = 'processed')
      EXECUTE FUNCTION validate_account_balance();
  `);

  // Create data retention and cleanup functions
  await knex.raw(`
    -- Function to archive old audit events
    CREATE OR REPLACE FUNCTION archive_old_audit_events()
    RETURNS INTEGER AS $$
    DECLARE
      archived_count INTEGER := 0;
      retention_date DATE;
    BEGIN
      -- Calculate retention date (7 years for compliance)
      retention_date := CURRENT_DATE - INTERVAL '7 years';
      
      -- Archive events older than retention period
      WITH archived AS (
        DELETE FROM audit_events
        WHERE created_at < retention_date
        RETURNING id
      )
      SELECT COUNT(*) INTO archived_count FROM archived;
      
      -- Log the archival
      IF archived_count > 0 THEN
        PERFORM log_audit_event(
          'delete',
          'audit_events',
          NULL,
          jsonb_build_object(
            'action', 'archive_old_events',
            'archived_count', archived_count,
            'retention_date', retention_date
          )
        );
      END IF;
      
      RETURN archived_count;
    END;
    $$ LANGUAGE plpgsql;

    -- Function to cleanup expired authorizations
    CREATE OR REPLACE FUNCTION cleanup_expired_authorizations()
    RETURNS INTEGER AS $$
    DECLARE
      cleanup_count INTEGER := 0;
    BEGIN
      WITH expired AS (
        UPDATE authorizations SET
          status = 'expired',
          updated_at = NOW()
        WHERE status = 'approved'
        AND expires_at < NOW()
        RETURNING id
      )
      SELECT COUNT(*) INTO cleanup_count FROM expired;
      
      RETURN cleanup_count;
    END;
    $$ LANGUAGE plpgsql;
  `);

  // Grant permissions on new functions
  await knex.raw(`
    GRANT EXECUTE ON FUNCTION update_receipt_processing_status(UUID, receipt_status, TEXT) TO PUBLIC;
    GRANT EXECUTE ON FUNCTION archive_old_audit_events() TO PUBLIC;
    GRANT EXECUTE ON FUNCTION cleanup_expired_authorizations() TO PUBLIC;
    GRANT EXECUTE ON FUNCTION normalize_merchant_name(TEXT) TO PUBLIC;
  `);

  // Create indexes for performance optimization
  await knex.raw(`
    -- Additional performance indexes
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transactions_processing_date 
    ON transactions(organization_id, transaction_date, status);
    
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_receipts_processing_status 
    ON receipts(organization_id, status, created_at);
    
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_events_table_record 
    ON audit_events(table_name, record_id, created_at);
    
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_extracted_fields_receipt_name 
    ON extracted_fields(receipt_id, field_name);
    
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_matches_active_confidence 
    ON matches(active, confidence_score DESC) WHERE active = true;
    
    -- Partial index for unmatched transactions
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transactions_unmatched 
    ON transactions(organization_id, created_at DESC) 
    WHERE status = 'processed' AND id NOT IN (
      SELECT transaction_id FROM matches WHERE active = true
    );
    
    -- Full-text search index for merchants
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_merchants_search 
    ON merchants USING gin(to_tsvector('english', name || ' ' || COALESCE(normalized_name, '')));
  `);
};

exports.down = async function(knex) {
  // Drop indexes
  await knex.raw(`
    DROP INDEX CONCURRENTLY IF EXISTS idx_transactions_processing_date;
    DROP INDEX CONCURRENTLY IF EXISTS idx_receipts_processing_status;
    DROP INDEX CONCURRENTLY IF EXISTS idx_audit_events_table_record;
    DROP INDEX CONCURRENTLY IF EXISTS idx_extracted_fields_receipt_name;
    DROP INDEX CONCURRENTLY IF EXISTS idx_matches_active_confidence;
    DROP INDEX CONCURRENTLY IF EXISTS idx_transactions_unmatched;
    DROP INDEX CONCURRENTLY IF EXISTS idx_merchants_search;
  `);

  // Drop functions and triggers
  await knex.raw(`
    DROP TRIGGER IF EXISTS validate_balance_before_transaction ON transactions;
    DROP TRIGGER IF EXISTS normalize_merchant_trigger ON merchants;
    DROP TRIGGER IF EXISTS check_duplicates_after_transaction_trigger ON transactions;
    DROP TRIGGER IF EXISTS apply_rules_after_transaction_trigger ON transactions;
    
    DROP FUNCTION IF EXISTS cleanup_expired_authorizations();
    DROP FUNCTION IF EXISTS archive_old_audit_events();
    DROP FUNCTION IF EXISTS validate_account_balance();
    DROP FUNCTION IF EXISTS update_receipt_processing_status(UUID, receipt_status, TEXT);
    DROP FUNCTION IF EXISTS normalize_merchant_before_insert();
    DROP FUNCTION IF EXISTS normalize_merchant_name(TEXT);
    DROP FUNCTION IF EXISTS check_duplicates_after_transaction();
    DROP FUNCTION IF EXISTS apply_rules_after_transaction();
    DROP FUNCTION IF EXISTS anonymize_user_data(UUID);
    DROP FUNCTION IF EXISTS detect_duplicate_transactions(UUID);
    DROP FUNCTION IF EXISTS apply_categorization_rules(UUID);
    DROP FUNCTION IF EXISTS calculate_match_score(UUID, UUID);
    DROP FUNCTION IF EXISTS log_audit_event(audit_event_type, TEXT, UUID, JSONB);
    DROP FUNCTION IF EXISTS get_user_permissions(UUID);
    DROP FUNCTION IF EXISTS check_user_permission(UUID, TEXT, TEXT);
  `);
};