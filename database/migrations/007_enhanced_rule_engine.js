/**
 * Enhanced Rule Engine Migration
 * Additional tables for rule applications, feedback, and notifications
 */

exports.up = async function(knex) {
  // Rule applications tracking
  await knex.schema.createTable('rule_applications', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('organization_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
    table.uuid('rule_id').notNullable().references('id').inTable('rules').onDelete('CASCADE');
    table.uuid('transaction_id').notNullable().references('id').inTable('transactions').onDelete('CASCADE');
    table.jsonb('applied_actions').defaultTo('{}');
    table.decimal('confidence_score', 5, 4);
    table.integer('execution_time_ms').defaultTo(0);
    table.uuid('applied_by').references('id').inTable('users');
    table.timestamp('applied_at').defaultTo(knex.fn.now());
    table.timestamps(true, true);
    
    table.index(['organization_id']);
    table.index(['rule_id']);
    table.index(['transaction_id']);
    table.index(['applied_at']);
  });

  // Rule feedback for learning
  await knex.schema.createTable('rule_feedback', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('organization_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
    table.uuid('rule_application_id').references('id').inTable('rule_applications').onDelete('CASCADE');
    table.uuid('transaction_id').notNullable().references('id').inTable('transactions').onDelete('CASCADE');
    table.uuid('expected_category_id').references('id').inTable('categories');
    table.uuid('applied_rule_id').references('id').inTable('rules');
    table.enu('correction_type', ['category', 'policy', 'merchant']).notNullable();
    table.text('feedback');
    table.boolean('was_correct').defaultTo(false);
    table.uuid('user_id').notNullable().references('id').inTable('users');
    table.timestamps(true, true);
    
    table.index(['organization_id']);
    table.index(['rule_application_id']);
    table.index(['transaction_id']);
    table.index(['correction_type']);
    table.index(['user_id']);
  });

  // Notification queue for rule-triggered notifications
  await knex.schema.createTable('notification_queue', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('organization_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
    table.uuid('transaction_id').references('id').inTable('transactions').onDelete('CASCADE');
    table.enu('notification_type', ['rule_triggered', 'approval_required', 'policy_violation', 'duplicate_detected']).notNullable();
    table.jsonb('recipients').defaultTo('[]'); // User IDs
    table.boolean('notify_manager').defaultTo(false);
    table.text('message');
    table.jsonb('metadata').defaultTo('{}');
    table.enu('status', ['pending', 'sent', 'failed']).defaultTo('pending');
    table.timestamp('scheduled_for').defaultTo(knex.fn.now());
    table.timestamp('sent_at');
    table.text('error_message');
    table.integer('retry_count').defaultTo(0);
    table.timestamps(true, true);
    
    table.index(['organization_id']);
    table.index(['notification_type']);
    table.index(['status']);
    table.index(['scheduled_for']);
  });

  // Merchant intelligence for better matching
  await knex.schema.createTable('merchant_intelligence', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('organization_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
    table.string('raw_merchant_name').notNullable();
    table.string('normalized_name').notNullable();
    table.uuid('canonical_merchant_id').references('id').inTable('merchants');
    table.string('merchant_category');
    table.jsonb('aliases').defaultTo('[]');
    table.decimal('confidence_score', 5, 4);
    table.integer('usage_count').defaultTo(1);
    table.boolean('verified').defaultTo(false);
    table.uuid('verified_by').references('id').inTable('users');
    table.timestamp('last_seen').defaultTo(knex.fn.now());
    table.timestamps(true, true);
    
    table.unique(['organization_id', 'raw_merchant_name']);
    table.index(['organization_id']);
    table.index(['normalized_name']);
    table.index(['canonical_merchant_id']);
    table.index(['last_seen']);
  });

  // Policy violations tracking
  await knex.schema.createTable('policy_violations', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('organization_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
    table.uuid('transaction_id').notNullable().references('id').inTable('transactions').onDelete('CASCADE');
    table.uuid('rule_id').references('id').inTable('rules');
    table.enu('violation_type', [
      'missing_receipt', 'over_spending_limit', 'unapproved_category', 
      'weekend_transaction', 'duplicate_transaction', 'suspicious_merchant'
    ]).notNullable();
    table.enu('severity', ['low', 'medium', 'high', 'critical']).defaultTo('medium');
    table.text('description').notNullable();
    table.jsonb('violation_details').defaultTo('{}');
    table.enu('status', ['open', 'acknowledged', 'resolved', 'false_positive']).defaultTo('open');
    table.uuid('assigned_to').references('id').inTable('users');
    table.text('resolution_notes');
    table.timestamp('resolved_at');
    table.timestamps(true, true);
    
    table.index(['organization_id']);
    table.index(['transaction_id']);
    table.index(['rule_id']);
    table.index(['violation_type']);
    table.index(['severity']);
    table.index(['status']);
  });

  // Category suggestions for machine learning
  await knex.schema.createTable('category_suggestions', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('organization_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
    table.uuid('transaction_id').notNullable().references('id').inTable('transactions').onDelete('CASCADE');
    table.uuid('suggested_category_id').notNullable().references('id').inTable('categories');
    table.decimal('confidence_score', 5, 4).notNullable();
    table.jsonb('reasoning').defaultTo('{}'); // Why this category was suggested
    table.string('suggestion_source').notNullable(); // 'ml_model', 'similarity', 'rules'
    table.boolean('accepted').defaultTo(false);
    table.uuid('accepted_by').references('id').inTable('users');
    table.timestamp('accepted_at');
    table.timestamps(true, true);
    
    table.index(['organization_id']);
    table.index(['transaction_id']);
    table.index(['suggested_category_id']);
    table.index(['confidence_score']);
    table.index(['suggestion_source']);
    table.index(['accepted']);
  });

  // Enhanced categories table with additional metadata
  await knex.schema.alterTable('categories', (table) => {
    table.jsonb('tax_settings').defaultTo('{}');
    table.jsonb('department_settings').defaultTo('{}');
    table.jsonb('policy_settings').defaultTo('{}');
    table.jsonb('ml_features').defaultTo('{}'); // Features for ML models
    table.integer('auto_categorization_count').defaultTo(0);
    table.integer('manual_override_count').defaultTo(0);
    table.decimal('accuracy_score', 5, 4).defaultTo(0);
  });

  // Enhanced rules table
  await knex.schema.alterTable('rules', (table) => {
    table.enu('rule_type', ['categorization', 'policy', 'automation']).defaultTo('categorization');
    table.decimal('success_rate', 5, 4).defaultTo(0);
  });

  // Enable RLS
  await knex.raw(`
    ALTER TABLE rule_applications ENABLE ROW LEVEL SECURITY;
    ALTER TABLE rule_feedback ENABLE ROW LEVEL SECURITY;
    ALTER TABLE notification_queue ENABLE ROW LEVEL SECURITY;
    ALTER TABLE merchant_intelligence ENABLE ROW LEVEL SECURITY;
    ALTER TABLE policy_violations ENABLE ROW LEVEL SECURITY;
    ALTER TABLE category_suggestions ENABLE ROW LEVEL SECURITY;
  `);

  // RLS Policies
  await knex.raw(`
    CREATE POLICY rule_applications_isolation ON rule_applications
      FOR ALL USING (organization_id = current_setting('app.current_organization_id')::uuid);
      
    CREATE POLICY rule_feedback_isolation ON rule_feedback
      FOR ALL USING (organization_id = current_setting('app.current_organization_id')::uuid);
      
    CREATE POLICY notification_queue_isolation ON notification_queue
      FOR ALL USING (organization_id = current_setting('app.current_organization_id')::uuid);
      
    CREATE POLICY merchant_intelligence_isolation ON merchant_intelligence
      FOR ALL USING (organization_id = current_setting('app.current_organization_id')::uuid);
      
    CREATE POLICY policy_violations_isolation ON policy_violations
      FOR ALL USING (organization_id = current_setting('app.current_organization_id')::uuid);
      
    CREATE POLICY category_suggestions_isolation ON category_suggestions
      FOR ALL USING (organization_id = current_setting('app.current_organization_id')::uuid);
  `);

  // Audit triggers
  await knex.raw(`
    CREATE TRIGGER rule_applications_audit AFTER INSERT OR UPDATE OR DELETE ON rule_applications
      FOR EACH ROW EXECUTE FUNCTION audit_trigger();
      
    CREATE TRIGGER rule_feedback_audit AFTER INSERT OR UPDATE OR DELETE ON rule_feedback
      FOR EACH ROW EXECUTE FUNCTION audit_trigger();
      
    CREATE TRIGGER policy_violations_audit AFTER INSERT OR UPDATE OR DELETE ON policy_violations
      FOR EACH ROW EXECUTE FUNCTION audit_trigger();
  `);

  // Function to normalize merchant names
  await knex.raw(`
    CREATE OR REPLACE FUNCTION normalize_merchant_name(raw_name TEXT)
    RETURNS TEXT AS $$
    BEGIN
      IF raw_name IS NULL THEN
        RETURN NULL;
      END IF;
      
      -- Convert to lowercase and remove common suffixes/prefixes
      raw_name := LOWER(TRIM(raw_name));
      raw_name := REGEXP_REPLACE(raw_name, '^(the|a) ', '', 'g');
      raw_name := REGEXP_REPLACE(raw_name, ' (inc|ltd|llc|corp|co)\.?$', '', 'g');
      raw_name := REGEXP_REPLACE(raw_name, '[^a-z0-9 ]', '', 'g');
      raw_name := REGEXP_REPLACE(raw_name, ' +', ' ', 'g');
      
      RETURN TRIM(raw_name);
    END;
    $$ LANGUAGE plpgsql;
  `);

  // Function to automatically create merchant intelligence entries
  await knex.raw(`
    CREATE OR REPLACE FUNCTION create_merchant_intelligence()
    RETURNS TRIGGER AS $$
    DECLARE
      normalized_name TEXT;
      existing_intelligence UUID;
    BEGIN
      -- Extract merchant name from description if not provided
      IF NEW.merchant_name IS NULL AND NEW.description IS NOT NULL THEN
        NEW.merchant_name := SPLIT_PART(NEW.description, ' ', 1);
      END IF;
      
      IF NEW.merchant_name IS NOT NULL THEN
        normalized_name := normalize_merchant_name(NEW.merchant_name);
        
        -- Check if we already have intelligence for this merchant
        SELECT id INTO existing_intelligence
        FROM merchant_intelligence
        WHERE organization_id = NEW.organization_id
        AND raw_merchant_name = NEW.merchant_name;
        
        IF existing_intelligence IS NULL THEN
          -- Create new merchant intelligence entry
          INSERT INTO merchant_intelligence (
            organization_id,
            raw_merchant_name,
            normalized_name,
            confidence_score,
            usage_count,
            last_seen
          ) VALUES (
            NEW.organization_id,
            NEW.merchant_name,
            normalized_name,
            0.5,
            1,
            NEW.transaction_date
          );
        ELSE
          -- Update existing entry
          UPDATE merchant_intelligence
          SET 
            usage_count = usage_count + 1,
            last_seen = GREATEST(last_seen, NEW.transaction_date),
            updated_at = NOW()
          WHERE id = existing_intelligence;
        END IF;
      END IF;
      
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER create_merchant_intelligence_after_transaction
      AFTER INSERT ON transactions
      FOR EACH ROW
      EXECUTE FUNCTION create_merchant_intelligence();
  `);

  // Function to update category accuracy scores
  await knex.raw(`
    CREATE OR REPLACE FUNCTION update_category_accuracy()
    RETURNS TRIGGER AS $$
    DECLARE
      cat_id UUID;
      total_auto INTEGER;
      total_override INTEGER;
    BEGIN
      -- Get category ID from the feedback
      cat_id := NEW.expected_category_id;
      
      IF cat_id IS NOT NULL THEN
        -- Count auto-categorizations and manual overrides
        SELECT 
          COUNT(CASE WHEN ra.id IS NOT NULL THEN 1 END),
          COUNT(CASE WHEN rf.correction_type = 'category' THEN 1 END)
        INTO total_auto, total_override
        FROM transactions t
        LEFT JOIN rule_applications ra ON t.id = ra.transaction_id
        LEFT JOIN rule_feedback rf ON ra.id = rf.rule_application_id
        WHERE t.category_id = cat_id
        AND t.organization_id = NEW.organization_id;
        
        -- Update category accuracy score
        UPDATE categories
        SET 
          auto_categorization_count = total_auto,
          manual_override_count = total_override,
          accuracy_score = CASE 
            WHEN total_auto > 0 THEN (total_auto - total_override) * 1.0 / total_auto
            ELSE 0
          END,
          updated_at = NOW()
        WHERE id = cat_id;
      END IF;
      
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER update_accuracy_after_feedback
      AFTER INSERT ON rule_feedback
      FOR EACH ROW
      EXECUTE FUNCTION update_category_accuracy();
  `);

  // Function to detect duplicate transactions
  await knex.raw(`
    CREATE OR REPLACE FUNCTION detect_duplicate_transactions()
    RETURNS TRIGGER AS $$
    DECLARE
      duplicate_count INTEGER;
    BEGIN
      -- Look for potential duplicates within 24 hours
      SELECT COUNT(*)
      INTO duplicate_count
      FROM transactions t
      WHERE t.organization_id = NEW.organization_id
      AND t.id != NEW.id
      AND ABS(t.amount - NEW.amount) < 0.01
      AND t.transaction_date BETWEEN (NEW.transaction_date - INTERVAL '24 hours') 
                                 AND (NEW.transaction_date + INTERVAL '24 hours')
      AND (
        t.description = NEW.description 
        OR t.merchant_name = NEW.merchant_name
      );
      
      -- Create policy violation if duplicates found
      IF duplicate_count > 0 THEN
        INSERT INTO policy_violations (
          organization_id,
          transaction_id,
          violation_type,
          severity,
          description,
          violation_details
        ) VALUES (
          NEW.organization_id,
          NEW.id,
          'duplicate_transaction',
          'medium',
          'Potential duplicate transaction detected',
          jsonb_build_object(
            'duplicate_count', duplicate_count,
            'detection_criteria', 'amount_date_merchant'
          )
        );
      END IF;
      
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER detect_duplicates_after_transaction
      AFTER INSERT ON transactions
      FOR EACH ROW
      EXECUTE FUNCTION detect_duplicate_transactions();
  `);
};

exports.down = async function(knex) {
  await knex.raw('DROP FUNCTION IF EXISTS detect_duplicate_transactions() CASCADE');
  await knex.raw('DROP FUNCTION IF EXISTS update_category_accuracy() CASCADE');
  await knex.raw('DROP FUNCTION IF EXISTS create_merchant_intelligence() CASCADE');
  await knex.raw('DROP FUNCTION IF EXISTS normalize_merchant_name(TEXT)');
  
  await knex.schema.dropTableIfExists('category_suggestions');
  await knex.schema.dropTableIfExists('policy_violations');
  await knex.schema.dropTableIfExists('merchant_intelligence');
  await knex.schema.dropTableIfExists('notification_queue');
  await knex.schema.dropTableIfExists('rule_feedback');
  await knex.schema.dropTableIfExists('rule_applications');
  
  await knex.schema.alterTable('categories', (table) => {
    table.dropColumn('tax_settings');
    table.dropColumn('department_settings');
    table.dropColumn('policy_settings');
    table.dropColumn('ml_features');
    table.dropColumn('auto_categorization_count');
    table.dropColumn('manual_override_count');
    table.dropColumn('accuracy_score');
  });
  
  await knex.schema.alterTable('rules', (table) => {
    table.dropColumn('rule_type');
    table.dropColumn('success_rate');
  });
};
