/**
 * Policy Engine Migration
 * Tables for expense policy enforcement and compliance
 */

exports.up = async function(knex) {
  // Policy rules table
  await knex.schema.createTable('policy_rules', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('organization_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
    table.string('name').notNullable();
    table.text('description');
    table.enu('policy_type', [
      'spending_limit', 'receipt_requirement', 'approval_workflow', 
      'time_restriction', 'merchant_restriction', 'category_restriction',
      'location_restriction', 'frequency_limit'
    ]).notNullable();
    table.jsonb('conditions').notNullable(); // Policy conditions
    table.jsonb('enforcement').notNullable(); // Enforcement actions
    table.enu('severity', ['low', 'medium', 'high', 'critical']).defaultTo('medium');
    table.boolean('active').defaultTo(true);
    table.integer('violation_count').defaultTo(0);
    table.decimal('effectiveness_score', 5, 2).defaultTo(0); // 0-100 effectiveness rating
    table.timestamps(true, true);
    table.uuid('created_by').notNullable().references('id').inTable('users');
    table.uuid('updated_by').notNullable().references('id').inTable('users');
    
    table.unique(['organization_id', 'name']);
    table.index(['organization_id']);
    table.index(['policy_type']);
    table.index(['severity']);
    table.index(['active']);
  });

  // ML training jobs table (for categorization models)
  await knex.schema.createTable('ml_training_jobs', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('organization_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
    table.string('model_type').notNullable();
    table.enu('status', ['pending', 'started', 'completed', 'failed']).defaultTo('pending');
    table.integer('training_data_count');
    table.jsonb('model_parameters').defaultTo('{}');
    table.decimal('accuracy_score', 5, 4);
    table.decimal('precision_score', 5, 4);
    table.decimal('recall_score', 5, 4);
    table.text('error_message');
    table.timestamp('estimated_completion');
    table.timestamp('completed_at');
    table.uuid('started_by').notNullable().references('id').inTable('users');
    table.timestamps(true, true);
    
    table.index(['organization_id']);
    table.index(['status']);
    table.index(['model_type']);
  });

  // Approval workflows table
  await knex.schema.createTable('approval_workflows', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('organization_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
    table.uuid('transaction_id').notNullable().references('id').inTable('transactions').onDelete('CASCADE');
    table.uuid('policy_rule_id').references('id').inTable('policy_rules');
    table.enu('workflow_type', ['policy_violation', 'spending_limit', 'manual_approval', 'receipt_missing']).notNullable();
    table.enu('status', ['pending', 'approved', 'rejected', 'cancelled']).defaultTo('pending');
    table.uuid('requested_by').notNullable().references('id').inTable('users');
    table.uuid('assigned_to').references('id').inTable('users');
    table.text('justification');
    table.text('approval_notes');
    table.timestamp('requested_at').defaultTo(knex.fn.now());
    table.timestamp('due_date');
    table.timestamp('responded_at');
    table.jsonb('workflow_data').defaultTo('{}');
    table.timestamps(true, true);
    
    table.index(['organization_id']);
    table.index(['transaction_id']);
    table.index(['policy_rule_id']);
    table.index(['status']);
    table.index(['assigned_to']);
    table.index(['requested_at']);
    table.index(['due_date']);
  });

  // Spending limits tracking
  await knex.schema.createTable('spending_limits', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('organization_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
    table.uuid('user_id').references('id').inTable('users').onDelete('CASCADE');
    table.uuid('category_id').references('id').inTable('categories');
    table.uuid('department_id').references('id').inTable('departments');
    table.enu('limit_type', ['daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'per_transaction']).notNullable();
    table.decimal('limit_amount', 15, 2).notNullable();
    table.decimal('current_usage', 15, 2).defaultTo(0);
    table.timestamp('period_start').notNullable();
    table.timestamp('period_end').notNullable();
    table.boolean('auto_reset').defaultTo(true);
    table.jsonb('metadata').defaultTo('{}');
    table.timestamps(true, true);
    table.uuid('created_by').references('id').inTable('users');
    table.uuid('updated_by').references('id').inTable('users');
    
    table.index(['organization_id']);
    table.index(['user_id']);
    table.index(['category_id']);
    table.index(['limit_type']);
    table.index(['period_start', 'period_end']);
  });

  // Compliance monitoring
  await knex.schema.createTable('compliance_monitoring', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('organization_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
    table.date('monitoring_date').notNullable();
    table.integer('total_transactions');
    table.integer('compliant_transactions');
    table.integer('policy_violations');
    table.integer('pending_receipts');
    table.integer('pending_approvals');
    table.decimal('compliance_rate', 5, 2);
    table.jsonb('violation_breakdown').defaultTo('{}'); // By policy type
    table.jsonb('risk_metrics').defaultTo('{}');
    table.timestamps(true, true);
    
    table.unique(['organization_id', 'monitoring_date']);
    table.index(['organization_id']);
    table.index(['monitoring_date']);
    table.index(['compliance_rate']);
  });

  // Departments table (if not already exists)
  await knex.schema.createTableIfNotExists('departments', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('organization_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
    table.string('name').notNullable();
    table.string('code');
    table.text('description');
    table.uuid('manager_id').references('id').inTable('users');
    table.jsonb('budget_info').defaultTo('{}');
    table.boolean('active').defaultTo(true);
    table.timestamps(true, true);
    table.uuid('created_by').references('id').inTable('users');
    table.uuid('updated_by').references('id').inTable('users');
    
    table.unique(['organization_id', 'name']);
    table.index(['organization_id']);
    table.index(['active']);
  });

  // Add department_id to users table if not exists
  await knex.schema.alterTable('users', (table) => {
    if (!table.hasColumn('department_id')) {
      table.uuid('department_id').references('id').inTable('departments');
      table.index(['department_id']);
    }
  });

  // Enable RLS
  await knex.raw(`
    ALTER TABLE policy_rules ENABLE ROW LEVEL SECURITY;
    ALTER TABLE ml_training_jobs ENABLE ROW LEVEL SECURITY;
    ALTER TABLE approval_workflows ENABLE ROW LEVEL SECURITY;
    ALTER TABLE spending_limits ENABLE ROW LEVEL SECURITY;
    ALTER TABLE compliance_monitoring ENABLE ROW LEVEL SECURITY;
    ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
  `);

  // RLS Policies
  await knex.raw(`
    CREATE POLICY policy_rules_isolation ON policy_rules
      FOR ALL USING (organization_id = current_setting('app.current_organization_id')::uuid);
      
    CREATE POLICY ml_training_jobs_isolation ON ml_training_jobs
      FOR ALL USING (organization_id = current_setting('app.current_organization_id')::uuid);
      
    CREATE POLICY approval_workflows_isolation ON approval_workflows
      FOR ALL USING (organization_id = current_setting('app.current_organization_id')::uuid);
      
    CREATE POLICY spending_limits_isolation ON spending_limits
      FOR ALL USING (organization_id = current_setting('app.current_organization_id')::uuid);
      
    CREATE POLICY compliance_monitoring_isolation ON compliance_monitoring
      FOR ALL USING (organization_id = current_setting('app.current_organization_id')::uuid);
      
    CREATE POLICY departments_isolation ON departments
      FOR ALL USING (organization_id = current_setting('app.current_organization_id')::uuid);
  `);

  // Audit triggers
  await knex.raw(`
    CREATE TRIGGER policy_rules_audit AFTER INSERT OR UPDATE OR DELETE ON policy_rules
      FOR EACH ROW EXECUTE FUNCTION audit_trigger();
      
    CREATE TRIGGER approval_workflows_audit AFTER INSERT OR UPDATE OR DELETE ON approval_workflows
      FOR EACH ROW EXECUTE FUNCTION audit_trigger();
      
    CREATE TRIGGER spending_limits_audit AFTER INSERT OR UPDATE OR DELETE ON spending_limits
      FOR EACH ROW EXECUTE FUNCTION audit_trigger();
  `);

  // Function to update spending limits usage
  await knex.raw(`
    CREATE OR REPLACE FUNCTION update_spending_limits()
    RETURNS TRIGGER AS $$
    BEGIN
      -- Update user spending limits
      UPDATE spending_limits
      SET 
        current_usage = (
          SELECT COALESCE(SUM(ABS(amount)), 0)
          FROM transactions
          WHERE created_by = NEW.created_by
          AND organization_id = NEW.organization_id
          AND transaction_date BETWEEN spending_limits.period_start AND spending_limits.period_end
          AND (spending_limits.category_id IS NULL OR category_id = spending_limits.category_id)
        ),
        updated_at = NOW()
      WHERE user_id = NEW.created_by
      AND organization_id = NEW.organization_id
      AND period_start <= NEW.transaction_date
      AND period_end >= NEW.transaction_date;
      
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER update_limits_after_transaction
      AFTER INSERT OR UPDATE ON transactions
      FOR EACH ROW
      EXECUTE FUNCTION update_spending_limits();
  `);

  // Function to auto-reset spending limits
  await knex.raw(`
    CREATE OR REPLACE FUNCTION auto_reset_spending_limits()
    RETURNS void AS $$
    BEGIN
      -- Reset daily limits
      UPDATE spending_limits
      SET 
        current_usage = 0,
        period_start = CURRENT_DATE,
        period_end = CURRENT_DATE + INTERVAL '1 day',
        updated_at = NOW()
      WHERE limit_type = 'daily'
      AND auto_reset = true
      AND period_end < CURRENT_DATE;
      
      -- Reset weekly limits
      UPDATE spending_limits
      SET 
        current_usage = 0,
        period_start = DATE_TRUNC('week', CURRENT_DATE),
        period_end = DATE_TRUNC('week', CURRENT_DATE) + INTERVAL '1 week',
        updated_at = NOW()
      WHERE limit_type = 'weekly'
      AND auto_reset = true
      AND period_end < CURRENT_DATE;
      
      -- Reset monthly limits
      UPDATE spending_limits
      SET 
        current_usage = 0,
        period_start = DATE_TRUNC('month', CURRENT_DATE),
        period_end = DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month',
        updated_at = NOW()
      WHERE limit_type = 'monthly'
      AND auto_reset = true
      AND period_end < CURRENT_DATE;
    END;
    $$ LANGUAGE plpgsql;
  `);

  // Function to calculate compliance metrics daily
  await knex.raw(`
    CREATE OR REPLACE FUNCTION calculate_daily_compliance()
    RETURNS void AS $$
    DECLARE
      org_record RECORD;
      total_txns INTEGER;
      compliant_txns INTEGER;
      violations INTEGER;
      pending_receipts INTEGER;
      pending_approvals INTEGER;
      compliance_rate DECIMAL(5,2);
    BEGIN
      -- Calculate compliance for each organization
      FOR org_record IN SELECT id FROM organizations WHERE active = true LOOP
        
        -- Count total transactions for yesterday
        SELECT COUNT(*) INTO total_txns
        FROM transactions
        WHERE organization_id = org_record.id
        AND DATE(transaction_date) = CURRENT_DATE - INTERVAL '1 day';
        
        -- Count policy violations
        SELECT COUNT(*) INTO violations
        FROM policy_violations
        WHERE organization_id = org_record.id
        AND DATE(created_at) = CURRENT_DATE - INTERVAL '1 day';
        
        -- Count pending receipts (transactions without receipts over $25)
        SELECT COUNT(*) INTO pending_receipts
        FROM transactions t
        LEFT JOIN matches m ON t.id = m.transaction_id AND m.active = true
        WHERE t.organization_id = org_record.id
        AND DATE(t.transaction_date) = CURRENT_DATE - INTERVAL '1 day'
        AND ABS(t.amount) > 25
        AND m.id IS NULL;
        
        -- Count pending approvals
        SELECT COUNT(*) INTO pending_approvals
        FROM approval_workflows
        WHERE organization_id = org_record.id
        AND DATE(requested_at) = CURRENT_DATE - INTERVAL '1 day'
        AND status = 'pending';
        
        -- Calculate compliance rate
        compliant_txns := total_txns - violations;
        compliance_rate := CASE 
          WHEN total_txns > 0 THEN (compliant_txns * 100.0) / total_txns
          ELSE 100
        END;
        
        -- Insert or update compliance record
        INSERT INTO compliance_monitoring (
          organization_id,
          monitoring_date,
          total_transactions,
          compliant_transactions,
          policy_violations,
          pending_receipts,
          pending_approvals,
          compliance_rate,
          created_at,
          updated_at
        ) VALUES (
          org_record.id,
          CURRENT_DATE - INTERVAL '1 day',
          total_txns,
          compliant_txns,
          violations,
          pending_receipts,
          pending_approvals,
          compliance_rate,
          NOW(),
          NOW()
        ) ON CONFLICT (organization_id, monitoring_date)
        DO UPDATE SET
          total_transactions = EXCLUDED.total_transactions,
          compliant_transactions = EXCLUDED.compliant_transactions,
          policy_violations = EXCLUDED.policy_violations,
          pending_receipts = EXCLUDED.pending_receipts,
          pending_approvals = EXCLUDED.pending_approvals,
          compliance_rate = EXCLUDED.compliance_rate,
          updated_at = NOW();
          
      END LOOP;
    END;
    $$ LANGUAGE plpgsql;
  `);

  // Function to check policy violations on transaction insert/update
  await knex.raw(`
    CREATE OR REPLACE FUNCTION check_policy_violations()
    RETURNS TRIGGER AS $$
    DECLARE
      policy_record RECORD;
      violation_found BOOLEAN := false;
    BEGIN
      -- Only check active policies
      FOR policy_record IN 
        SELECT * FROM policy_rules 
        WHERE organization_id = NEW.organization_id 
        AND active = true 
        ORDER BY severity DESC
      LOOP
        -- This is a simplified check - the actual implementation would be more complex
        -- and would use the PolicyEngineService for detailed evaluation
        
        -- Example: Check spending limit policy
        IF policy_record.policy_type = 'spending_limit' THEN
          -- Would implement spending limit check here
          NULL;
        END IF;
        
        -- Example: Check time restriction policy
        IF policy_record.policy_type = 'time_restriction' THEN
          -- Would implement time restriction check here
          NULL;
        END IF;
        
      END LOOP;
      
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    -- Note: This trigger would be enabled after full PolicyEngineService integration
    -- CREATE TRIGGER check_policies_after_transaction
    --   AFTER INSERT OR UPDATE ON transactions
    --   FOR EACH ROW
    --   EXECUTE FUNCTION check_policy_violations();
  `);
};

exports.down = async function(knex) {
  await knex.raw('DROP FUNCTION IF EXISTS check_policy_violations() CASCADE');
  await knex.raw('DROP FUNCTION IF EXISTS calculate_daily_compliance()');
  await knex.raw('DROP FUNCTION IF EXISTS auto_reset_spending_limits()');
  await knex.raw('DROP FUNCTION IF EXISTS update_spending_limits() CASCADE');
  
  await knex.schema.dropTableIfExists('compliance_monitoring');
  await knex.schema.dropTableIfExists('spending_limits');
  await knex.schema.dropTableIfExists('approval_workflows');
  await knex.schema.dropTableIfExists('ml_training_jobs');
  await knex.schema.dropTableIfExists('policy_rules');
  await knex.schema.dropTableIfExists('departments');
  
  await knex.schema.alterTable('users', (table) => {
    table.dropColumn('department_id');
  });
};
