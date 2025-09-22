/**
 * Transactions and Authorizations Migration
 * Core financial transaction processing and authorization workflow
 */

exports.up = async function(knex) {
  // Authorizations (pre-authorizations, holds, etc.)
  await knex.schema.createTable('authorizations', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('organization_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
    table.uuid('account_id').notNullable().references('id').inTable('accounts').onDelete('CASCADE');
    table.uuid('merchant_id').references('id').inTable('merchants');
    table.string('authorization_code').notNullable();
    table.decimal('amount', 15, 2).notNullable();
    table.string('currency', 3).defaultTo('USD');
    table.enu('status', ['pending', 'approved', 'rejected', 'expired']).defaultTo('pending');
    table.timestamp('authorized_at').defaultTo(knex.fn.now());
    table.timestamp('expires_at');
    table.jsonb('metadata').defaultTo('{}');
    table.timestamps(true, true);
    table.uuid('created_by').references('id').inTable('users');
    table.uuid('updated_by').references('id').inTable('users');
    
    table.unique(['authorization_code', 'account_id']);
    table.index(['organization_id']);
    table.index(['account_id']);
    table.index(['merchant_id']);
    table.index(['status']);
    table.index(['authorized_at']);
    table.index(['expires_at']);
  });

  // Transactions (completed financial transactions)
  await knex.schema.createTable('transactions', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('organization_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
    table.uuid('account_id').notNullable().references('id').inTable('accounts').onDelete('CASCADE');
    table.uuid('authorization_id').references('id').inTable('authorizations');
    table.uuid('merchant_id').references('id').inTable('merchants');
    table.uuid('category_id').references('id').inTable('categories');
    table.string('transaction_id').notNullable(); // External transaction ID
    table.enu('type', ['debit', 'credit']).notNullable();
    table.decimal('amount', 15, 2).notNullable();
    table.string('currency', 3).defaultTo('USD');
    table.string('description').notNullable();
    table.text('memo');
    table.enu('status', ['pending', 'processed', 'rejected', 'cancelled']).defaultTo('pending');
    table.timestamp('transaction_date').notNullable();
    table.timestamp('posted_date');
    table.jsonb('metadata').defaultTo('{}');
    table.jsonb('reconciliation_data').defaultTo('{}');
    table.boolean('is_recurring').defaultTo(false);
    table.uuid('recurring_parent_id').references('id').inTable('transactions');
    table.timestamps(true, true);
    table.uuid('created_by').references('id').inTable('users');
    table.uuid('updated_by').references('id').inTable('users');
    
    table.unique(['transaction_id', 'account_id']);
    table.index(['organization_id']);
    table.index(['account_id']);
    table.index(['authorization_id']);
    table.index(['merchant_id']);
    table.index(['category_id']);
    table.index(['type']);
    table.index(['status']);
    table.index(['transaction_date']);
    table.index(['posted_date']);
    table.index(['is_recurring']);
    table.index(['organization_id', 'transaction_date']);
    table.index(['account_id', 'transaction_date']);
  });

  // Transaction line items (for complex transactions with multiple GL accounts)
  await knex.schema.createTable('transaction_line_items', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('organization_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
    table.uuid('transaction_id').notNullable().references('id').inTable('transactions').onDelete('CASCADE');
    table.uuid('gl_account_id').notNullable().references('id').inTable('gl_accounts');
    table.uuid('category_id').references('id').inTable('categories');
    table.decimal('amount', 15, 2).notNullable();
    table.string('description');
    table.jsonb('metadata').defaultTo('{}');
    table.timestamps(true, true);
    table.uuid('created_by').references('id').inTable('users');
    table.uuid('updated_by').references('id').inTable('users');
    
    table.index(['organization_id']);
    table.index(['transaction_id']);
    table.index(['gl_account_id']);
    table.index(['category_id']);
  });

  // Enable RLS
  await knex.raw(`
    ALTER TABLE authorizations ENABLE ROW LEVEL SECURITY;
    ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE transaction_line_items ENABLE ROW LEVEL SECURITY;
  `);

  // RLS Policies
  await knex.raw(`
    CREATE POLICY authorizations_isolation ON authorizations
      FOR ALL USING (organization_id = current_setting('app.current_organization_id')::uuid);
      
    CREATE POLICY transactions_isolation ON transactions
      FOR ALL USING (organization_id = current_setting('app.current_organization_id')::uuid);
      
    CREATE POLICY transaction_line_items_isolation ON transaction_line_items
      FOR ALL USING (organization_id = current_setting('app.current_organization_id')::uuid);
  `);

  // Audit triggers
  await knex.raw(`
    CREATE TRIGGER authorizations_audit AFTER INSERT OR UPDATE OR DELETE ON authorizations
      FOR EACH ROW EXECUTE FUNCTION audit_trigger();
      
    CREATE TRIGGER transactions_audit AFTER INSERT OR UPDATE OR DELETE ON transactions
      FOR EACH ROW EXECUTE FUNCTION audit_trigger();
      
    CREATE TRIGGER transaction_line_items_audit AFTER INSERT OR UPDATE OR DELETE ON transaction_line_items
      FOR EACH ROW EXECUTE FUNCTION audit_trigger();
  `);

  // Function to update account balance after transaction
  await knex.raw(`
    CREATE OR REPLACE FUNCTION update_account_balance()
    RETURNS TRIGGER AS $$
    DECLARE
      balance_change DECIMAL(15,2);
    BEGIN
      -- Calculate balance change based on account type and transaction type
      IF NEW.type = 'debit' THEN
        balance_change = -NEW.amount;
      ELSE
        balance_change = NEW.amount;
      END IF;
      
      -- Update account balance
      UPDATE accounts 
      SET 
        current_balance = current_balance + balance_change,
        updated_at = NOW()
      WHERE id = NEW.account_id;
      
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER update_balance_after_transaction
      AFTER INSERT ON transactions
      FOR EACH ROW
      WHEN (NEW.status = 'processed')
      EXECUTE FUNCTION update_account_balance();
  `);

  // Function for transaction validation
  await knex.raw(`
    CREATE OR REPLACE FUNCTION validate_transaction()
    RETURNS TRIGGER AS $$
    BEGIN
      -- Validate amount is positive
      IF NEW.amount <= 0 THEN
        RAISE EXCEPTION 'Transaction amount must be positive';
      END IF;
      
      -- Validate transaction date is not in the future
      IF NEW.transaction_date > NOW() THEN
        RAISE EXCEPTION 'Transaction date cannot be in the future';
      END IF;
      
      -- Validate currency matches account currency
      IF EXISTS (
        SELECT 1 FROM accounts 
        WHERE id = NEW.account_id 
        AND currency != NEW.currency
      ) THEN
        RAISE EXCEPTION 'Transaction currency must match account currency';
      END IF;
      
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER validate_transaction_before_insert
      BEFORE INSERT OR UPDATE ON transactions
      FOR EACH ROW
      EXECUTE FUNCTION validate_transaction();
  `);
};

exports.down = async function(knex) {
  await knex.raw('DROP FUNCTION IF EXISTS validate_transaction() CASCADE');
  await knex.raw('DROP FUNCTION IF EXISTS update_account_balance() CASCADE');
  await knex.schema.dropTableIfExists('transaction_line_items');
  await knex.schema.dropTableIfExists('transactions');
  await knex.schema.dropTableIfExists('authorizations');
};