/**
 * Financial Accounts Migration
 * Bank accounts, credit cards, and other financial accounts
 */

exports.up = async function(knex) {
  // GL (General Ledger) Accounts
  await knex.schema.createTable('gl_accounts', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('organization_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
    table.string('account_code').notNullable();
    table.string('account_name').notNullable();
    table.enu('account_type', ['asset', 'liability', 'equity', 'revenue', 'expense']).notNullable();
    table.text('description');
    table.boolean('active').defaultTo(true);
    table.timestamps(true, true);
    table.uuid('created_by').references('id').inTable('users');
    table.uuid('updated_by').references('id').inTable('users');
    
    table.unique(['organization_id', 'account_code']);
    table.index(['organization_id']);
    table.index(['account_type']);
    table.index(['active']);
  });

  // Financial Accounts (Bank accounts, credit cards, etc.)
  await knex.schema.createTable('accounts', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('organization_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
    table.string('name').notNullable();
    table.enu('account_type', ['checking', 'savings', 'credit_card', 'loan', 'investment']).notNullable();
    table.text('encrypted_account_number'); // Encrypted sensitive data
    table.string('bank_name');
    table.string('routing_number');
    table.decimal('current_balance', 15, 2).defaultTo(0);
    table.string('currency', 3).defaultTo('USD');
    table.uuid('default_gl_account_id').references('id').inTable('gl_accounts');
    table.jsonb('metadata').defaultTo('{}');
    table.boolean('active').defaultTo(true);
    table.timestamps(true, true);
    table.uuid('created_by').references('id').inTable('users');
    table.uuid('updated_by').references('id').inTable('users');
    
    table.index(['organization_id']);
    table.index(['account_type']);
    table.index(['active']);
  });

  // Merchants/Vendors
  await knex.schema.createTable('merchants', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('organization_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
    table.string('name').notNullable();
    table.string('normalized_name').notNullable(); // For fuzzy matching
    table.jsonb('aliases').defaultTo('[]'); // Alternative names
    table.uuid('default_category_id'); // Will reference categories table
    table.string('tax_id');
    table.jsonb('address').defaultTo('{}');
    table.jsonb('contact_info').defaultTo('{}');
    table.jsonb('metadata').defaultTo('{}');
    table.boolean('active').defaultTo(true);
    table.timestamps(true, true);
    table.uuid('created_by').references('id').inTable('users');
    table.uuid('updated_by').references('id').inTable('users');
    
    table.unique(['organization_id', 'normalized_name']);
    table.index(['organization_id']);
    table.index(['normalized_name']);
    table.index(['active']);
  });

  // Categories for expense classification
  await knex.schema.createTable('categories', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('organization_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
    table.string('name').notNullable();
    table.string('code');
    table.uuid('parent_id').references('id').inTable('categories'); // For hierarchical categories
    table.uuid('gl_account_id').references('id').inTable('gl_accounts');
    table.text('description');
    table.jsonb('rules').defaultTo('{}'); // Auto-categorization rules
    table.boolean('active').defaultTo(true);
    table.timestamps(true, true);
    table.uuid('created_by').references('id').inTable('users');
    table.uuid('updated_by').references('id').inTable('users');
    
    table.unique(['organization_id', 'name']);
    table.index(['organization_id']);
    table.index(['parent_id']);
    table.index(['active']);
  });

  // Update merchants table to reference categories
  await knex.schema.alterTable('merchants', (table) => {
    table.foreign('default_category_id').references('id').inTable('categories');
  });

  // Enable RLS
  await knex.raw(`
    ALTER TABLE gl_accounts ENABLE ROW LEVEL SECURITY;
    ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
    ALTER TABLE merchants ENABLE ROW LEVEL SECURITY;
    ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
  `);

  // RLS Policies
  await knex.raw(`
    CREATE POLICY gl_accounts_isolation ON gl_accounts
      FOR ALL USING (organization_id = current_setting('app.current_organization_id')::uuid);
      
    CREATE POLICY accounts_isolation ON accounts
      FOR ALL USING (organization_id = current_setting('app.current_organization_id')::uuid);
      
    CREATE POLICY merchants_isolation ON merchants
      FOR ALL USING (organization_id = current_setting('app.current_organization_id')::uuid);
      
    CREATE POLICY categories_isolation ON categories
      FOR ALL USING (organization_id = current_setting('app.current_organization_id')::uuid);
  `);

  // Audit triggers
  await knex.raw(`
    CREATE TRIGGER gl_accounts_audit AFTER INSERT OR UPDATE OR DELETE ON gl_accounts
      FOR EACH ROW EXECUTE FUNCTION audit_trigger();
      
    CREATE TRIGGER accounts_audit AFTER INSERT OR UPDATE OR DELETE ON accounts
      FOR EACH ROW EXECUTE FUNCTION audit_trigger();
      
    CREATE TRIGGER merchants_audit AFTER INSERT OR UPDATE OR DELETE ON merchants
      FOR EACH ROW EXECUTE FUNCTION audit_trigger();
      
    CREATE TRIGGER categories_audit AFTER INSERT OR UPDATE OR DELETE ON categories
      FOR EACH ROW EXECUTE FUNCTION audit_trigger();
  `);

  // Encryption functions for sensitive data
  await knex.raw(`
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
  `);
};

exports.down = async function(knex) {
  await knex.raw('DROP FUNCTION IF EXISTS decrypt_account_number(TEXT)');
  await knex.raw('DROP FUNCTION IF EXISTS encrypt_account_number(TEXT)');
  await knex.schema.dropTableIfExists('categories');
  await knex.schema.dropTableIfExists('merchants');
  await knex.schema.dropTableIfExists('accounts');
  await knex.schema.dropTableIfExists('gl_accounts');
};