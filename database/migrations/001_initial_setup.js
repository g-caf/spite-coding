/**
 * Initial setup migration - Extensions and Security
 * Sets up PostgreSQL extensions and security features
 */

exports.up = async function(knex) {
  // Enable required extensions
  await knex.raw(`
    -- UUID generation
    CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
    
    -- Cryptographic functions for encryption
    CREATE EXTENSION IF NOT EXISTS "pgcrypto";
    
    -- Row Level Security
    CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";
    
    -- Full text search
    CREATE EXTENSION IF NOT EXISTS "unaccent";
  `);

  // Create enum types
  await knex.raw(`
    -- User roles
    CREATE TYPE user_role AS ENUM ('admin', 'manager', 'employee', 'viewer');
    
    -- Transaction types
    CREATE TYPE transaction_type AS ENUM ('debit', 'credit');
    
    -- Transaction status
    CREATE TYPE transaction_status AS ENUM ('pending', 'processed', 'rejected', 'cancelled');
    
    -- Receipt status
    CREATE TYPE receipt_status AS ENUM ('uploaded', 'processing', 'processed', 'failed', 'matched');
    
    -- Authorization status  
    CREATE TYPE authorization_status AS ENUM ('pending', 'approved', 'rejected', 'expired');
    
    -- Audit event types
    CREATE TYPE audit_event_type AS ENUM (
      'create', 'update', 'delete', 'login', 'logout', 
      'permission_grant', 'permission_revoke', 'data_export'
    );
    
    -- Match status
    CREATE TYPE match_status AS ENUM ('auto', 'manual', 'reviewed', 'rejected');
  `);

  // Create audit function for tracking changes
  await knex.raw(`
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
  `);
};

exports.down = async function(knex) {
  await knex.raw(`
    DROP FUNCTION IF EXISTS audit_trigger() CASCADE;
    DROP TYPE IF EXISTS match_status CASCADE;
    DROP TYPE IF EXISTS audit_event_type CASCADE;
    DROP TYPE IF EXISTS authorization_status CASCADE;
    DROP TYPE IF EXISTS receipt_status CASCADE;
    DROP TYPE IF EXISTS transaction_status CASCADE;
    DROP TYPE IF EXISTS transaction_type CASCADE;
    DROP TYPE IF EXISTS user_role CASCADE;
  `);
};