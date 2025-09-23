/**
 * Plaid Integration Migration
 * Tables for managing Plaid connections and syncing data
 */

exports.up = async function(knex) {
  // Plaid Items (connections to financial institutions)
  await knex.schema.createTable('plaid_items', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('organization_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
    table.uuid('connected_by_user_id').notNullable().references('id').inTable('users');
    table.string('item_id').notNullable().unique();
    table.text('encrypted_access_token').notNullable(); // Encrypted Plaid access token
    table.string('institution_id').notNullable();
    table.string('institution_name').notNullable();
    table.jsonb('institution_metadata').defaultTo('{}');
    table.string('cursor'); // For transaction sync
    table.timestamp('last_sync_at');
    table.timestamp('last_successful_sync_at');
    table.integer('consecutive_failures').defaultTo(0);
    table.enu('sync_status', ['active', 'error', 'disabled']).defaultTo('active');
    table.jsonb('error_info').defaultTo('{}');
    table.boolean('webhook_enabled').defaultTo(true);
    table.timestamps(true, true);
    table.uuid('created_by').references('id').inTable('users');
    table.uuid('updated_by').references('id').inTable('users');
    
    table.index(['organization_id']);
    table.index(['item_id']);
    table.index(['institution_id']);
    table.index(['sync_status']);
    table.index(['last_sync_at']);
  });

  // Plaid Accounts (bank accounts from Plaid)
  await knex.schema.createTable('plaid_accounts', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('organization_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
    table.uuid('plaid_item_id').notNullable().references('id').inTable('plaid_items').onDelete('CASCADE');
    table.uuid('local_account_id').references('id').inTable('accounts'); // Link to our accounts table
    table.string('account_id').notNullable(); // Plaid account ID
    table.string('persistent_account_id'); // Plaid persistent account ID
    table.string('name').notNullable();
    table.string('official_name');
    table.string('type').notNullable(); // depository, credit, etc.
    table.string('subtype').notNullable(); // checking, savings, credit card, etc.
    table.jsonb('balances').defaultTo('{}'); // Current, available, etc.
    table.string('mask'); // Last 4 digits
    table.jsonb('verification_status').defaultTo('{}');
    table.boolean('enabled').defaultTo(true);
    table.timestamps(true, true);
    table.uuid('created_by').references('id').inTable('users');
    table.uuid('updated_by').references('id').inTable('users');
    
    table.unique(['account_id', 'plaid_item_id']);
    table.index(['organization_id']);
    table.index(['plaid_item_id']);
    table.index(['local_account_id']);
    table.index(['type', 'subtype']);
    table.index(['enabled']);
  });

  // Raw Plaid transactions (before processing)
  await knex.schema.createTable('plaid_transactions_raw', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('organization_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
    table.uuid('plaid_item_id').notNullable().references('id').inTable('plaid_items').onDelete('CASCADE');
    table.uuid('plaid_account_id').notNullable().references('id').inTable('plaid_accounts').onDelete('CASCADE');
    table.string('transaction_id').notNullable().unique(); // Plaid transaction ID
    table.string('account_id').notNullable(); // Plaid account ID
    table.decimal('amount', 15, 2).notNullable(); // Amount in account's currency
    table.string('iso_currency_code', 3).notNullable();
    table.string('unofficial_currency_code', 10); // For non-standard currencies
    table.string('merchant_name');
    table.string('name').notNullable(); // Transaction name/description
    table.string('original_description'); // Original bank description
    table.date('date').notNullable(); // Transaction date
    table.date('authorized_date'); // Authorization date
    table.timestamp('datetime'); // Transaction datetime if available
    table.boolean('pending').defaultTo(false);
    table.string('pending_transaction_id'); // Links pending to posted
    table.jsonb('category'); // Plaid categorization
    table.string('category_id');
    table.jsonb('merchant_data').defaultTo('{}'); // Merchant details from Plaid
    table.jsonb('payment_meta').defaultTo('{}'); // Payment metadata
    table.jsonb('location').defaultTo('{}'); // Transaction location
    table.jsonb('personal_finance_category').defaultTo('{}'); // Enhanced categorization
    table.text('logo_url'); // Merchant logo
    table.text('website'); // Merchant website
    table.enu('processing_status', ['pending', 'processed', 'error', 'duplicate']).defaultTo('pending');
    table.uuid('processed_transaction_id').references('id').inTable('transactions'); // Link to processed transaction
    table.jsonb('processing_errors').defaultTo('{}');
    table.timestamps(true, true);
    
    table.index(['organization_id']);
    table.index(['plaid_item_id']);
    table.index(['plaid_account_id']);
    table.index(['transaction_id']);
    table.index(['account_id']);
    table.index(['date']);
    table.index(['processing_status']);
    table.index(['pending']);
    table.index(['organization_id', 'date']);
    table.index(['plaid_account_id', 'date']);
  });

  // Plaid webhooks log
  await knex.schema.createTable('plaid_webhooks', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('organization_id').references('id').inTable('organizations');
    table.string('item_id'); // Plaid item ID
    table.string('webhook_type').notNullable();
    table.string('webhook_code').notNullable();
    table.jsonb('webhook_data').notNullable();
    table.boolean('processed').defaultTo(false);
    table.timestamp('processed_at');
    table.jsonb('processing_result').defaultTo('{}');
    table.string('request_id'); // Plaid request ID
    table.timestamps(true, true);
    
    table.index(['item_id']);
    table.index(['webhook_type', 'webhook_code']);
    table.index(['processed']);
    table.index(['created_at']);
  });

  // Sync jobs for background processing
  await knex.schema.createTable('plaid_sync_jobs', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('organization_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
    table.uuid('plaid_item_id').references('id').inTable('plaid_items').onDelete('CASCADE');
    table.enu('job_type', ['initial_sync', 'incremental_sync', 'full_refresh', 'webhook_triggered']).notNullable();
    table.enu('status', ['pending', 'running', 'completed', 'failed', 'cancelled']).defaultTo('pending');
    table.timestamp('scheduled_at').defaultTo(knex.fn.now());
    table.timestamp('started_at');
    table.timestamp('completed_at');
    table.jsonb('job_data').defaultTo('{}'); // Parameters for the job
    table.jsonb('result_data').defaultTo('{}'); // Results and metrics
    table.text('error_message');
    table.integer('retry_count').defaultTo(0);
    table.timestamp('next_retry_at');
    table.timestamps(true, true);
    
    table.index(['organization_id']);
    table.index(['plaid_item_id']);
    table.index(['job_type']);
    table.index(['status']);
    table.index(['scheduled_at']);
    table.index(['status', 'scheduled_at']);
  });

  // Add Plaid metadata to existing accounts table
  await knex.schema.alterTable('accounts', (table) => {
    table.uuid('plaid_account_id').references('id').inTable('plaid_accounts');
    table.boolean('plaid_managed').defaultTo(false);
    table.timestamp('last_plaid_sync');
    table.jsonb('plaid_metadata').defaultTo('{}');
  });

  // Add Plaid metadata to existing transactions table  
  await knex.schema.alterTable('transactions', (table) => {
    table.uuid('plaid_transaction_id').references('id').inTable('plaid_transactions_raw');
    table.boolean('plaid_sourced').defaultTo(false);
    table.string('plaid_transaction_id_external'); // Original Plaid transaction ID
    table.jsonb('plaid_metadata').defaultTo('{}');
  });

  // Enable RLS on new tables
  await knex.raw(`
    ALTER TABLE plaid_items ENABLE ROW LEVEL SECURITY;
    ALTER TABLE plaid_accounts ENABLE ROW LEVEL SECURITY;
    ALTER TABLE plaid_transactions_raw ENABLE ROW LEVEL SECURITY;
    ALTER TABLE plaid_sync_jobs ENABLE ROW LEVEL SECURITY;
  `);

  // RLS Policies
  await knex.raw(`
    CREATE POLICY plaid_items_isolation ON plaid_items
      FOR ALL USING (organization_id = current_setting('app.current_organization_id')::uuid);
      
    CREATE POLICY plaid_accounts_isolation ON plaid_accounts
      FOR ALL USING (organization_id = current_setting('app.current_organization_id')::uuid);
      
    CREATE POLICY plaid_transactions_raw_isolation ON plaid_transactions_raw
      FOR ALL USING (organization_id = current_setting('app.current_organization_id')::uuid);
      
    CREATE POLICY plaid_sync_jobs_isolation ON plaid_sync_jobs
      FOR ALL USING (organization_id = current_setting('app.current_organization_id')::uuid);
  `);

  // Audit triggers
  await knex.raw(`
    CREATE TRIGGER plaid_items_audit AFTER INSERT OR UPDATE OR DELETE ON plaid_items
      FOR EACH ROW EXECUTE FUNCTION audit_trigger();
      
    CREATE TRIGGER plaid_accounts_audit AFTER INSERT OR UPDATE OR DELETE ON plaid_accounts
      FOR EACH ROW EXECUTE FUNCTION audit_trigger();
      
    CREATE TRIGGER plaid_transactions_raw_audit AFTER INSERT OR UPDATE OR DELETE ON plaid_transactions_raw
      FOR EACH ROW EXECUTE FUNCTION audit_trigger();
      
    CREATE TRIGGER plaid_sync_jobs_audit AFTER INSERT OR UPDATE OR DELETE ON plaid_sync_jobs
      FOR EACH ROW EXECUTE FUNCTION audit_trigger();
  `);

  // Functions for encrypting/decrypting Plaid access tokens
  await knex.raw(`
    CREATE OR REPLACE FUNCTION encrypt_plaid_token(access_token TEXT)
    RETURNS TEXT AS $$
    BEGIN
      RETURN encode(
        pgp_sym_encrypt(
          access_token, 
          current_setting('app.encryption_key')
        ), 
        'base64'
      );
    END;
    $$ LANGUAGE plpgsql;

    CREATE OR REPLACE FUNCTION decrypt_plaid_token(encrypted_token TEXT)
    RETURNS TEXT AS $$
    BEGIN
      IF encrypted_token IS NULL THEN
        RETURN NULL;
      END IF;
      
      RETURN pgp_sym_decrypt(
        decode(encrypted_token, 'base64'),
        current_setting('app.encryption_key')
      );
    END;
    $$ LANGUAGE plpgsql;
  `);

  // Function to clean up old raw transactions
  await knex.raw(`
    CREATE OR REPLACE FUNCTION cleanup_old_plaid_data()
    RETURNS void AS $$
    BEGIN
      -- Delete processed raw transactions older than 90 days
      DELETE FROM plaid_transactions_raw 
      WHERE processing_status = 'processed' 
      AND created_at < NOW() - INTERVAL '90 days';
      
      -- Delete old webhook logs
      DELETE FROM plaid_webhooks 
      WHERE processed = true 
      AND created_at < NOW() - INTERVAL '30 days';
      
      -- Delete completed sync jobs older than 30 days
      DELETE FROM plaid_sync_jobs 
      WHERE status IN ('completed', 'failed')
      AND created_at < NOW() - INTERVAL '30 days';
    END;
    $$ LANGUAGE plpgsql;
  `);
};

exports.down = async function(knex) {
  await knex.raw('DROP FUNCTION IF EXISTS cleanup_old_plaid_data()');
  await knex.raw('DROP FUNCTION IF EXISTS decrypt_plaid_token(TEXT)');
  await knex.raw('DROP FUNCTION IF EXISTS encrypt_plaid_token(TEXT)');
  
  await knex.schema.alterTable('transactions', (table) => {
    table.dropColumn('plaid_metadata');
    table.dropColumn('plaid_transaction_id_external');
    table.dropColumn('plaid_sourced');
    table.dropColumn('plaid_transaction_id');
  });
  
  await knex.schema.alterTable('accounts', (table) => {
    table.dropColumn('plaid_metadata');
    table.dropColumn('last_plaid_sync');
    table.dropColumn('plaid_managed');
    table.dropColumn('plaid_account_id');
  });
  
  await knex.schema.dropTableIfExists('plaid_sync_jobs');
  await knex.schema.dropTableIfExists('plaid_webhooks');
  await knex.schema.dropTableIfExists('plaid_transactions_raw');
  await knex.schema.dropTableIfExists('plaid_accounts');
  await knex.schema.dropTableIfExists('plaid_items');
};