/**
 * Enhanced Matching Engine Tables
 * Additional tables for learning, merchant mappings, and feedback
 */

exports.up = async function(knex) {
  // Learning feedback table
  await knex.schema.createTable('learning_feedback', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.string('match_id').notNullable(); // Reference to match or rejected match
    table.boolean('was_correct').notNullable();
    table.jsonb('user_correction').defaultTo(null); // Corrected transaction/receipt IDs
    table.uuid('user_id').notNullable().references('id').inTable('users');
    table.timestamp('feedback_date').notNullable();
    table.text('notes');
    table.timestamps(true, true);
    
    table.index(['match_id']);
    table.index(['user_id']);
    table.index(['feedback_date']);
    table.index(['was_correct']);
  });

  // Merchant mappings table for canonicalization
  await knex.schema.createTable('merchant_mappings', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('organization_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
    table.jsonb('raw_names').notNullable(); // Array of raw merchant names
    table.string('canonical_name').notNullable();
    table.string('category');
    table.decimal('confidence', 5, 4).defaultTo(0.8);
    table.enu('created_from', ['transaction', 'receipt', 'manual', 'learning']).defaultTo('manual');
    table.boolean('verified').defaultTo(false);
    table.integer('usage_count').defaultTo(0);
    table.timestamp('last_used');
    table.boolean('active').defaultTo(true);
    table.timestamps(true, true);
    table.uuid('created_by').references('id').inTable('users');
    table.uuid('updated_by').references('id').inTable('users');
    
    table.unique(['organization_id', 'canonical_name']);
    table.index(['organization_id']);
    table.index(['canonical_name']);
    table.index(['active']);
    table.index(['usage_count']);
  });

  // Matching configuration per organization
  await knex.schema.createTable('matching_configs', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('organization_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
    table.decimal('amount_tolerance_percentage', 5, 4).defaultTo(0.05); // 5%
    table.decimal('amount_tolerance_fixed', 10, 2).defaultTo(1.00); // $1.00
    table.integer('date_window_days').defaultTo(7);
    table.decimal('merchant_similarity_threshold', 5, 4).defaultTo(0.7);
    table.decimal('location_radius_km', 8, 2).defaultTo(5.0);
    table.decimal('auto_match_threshold', 5, 4).defaultTo(0.85);
    table.decimal('suggest_threshold', 5, 4).defaultTo(0.5);
    table.jsonb('confidence_weights').defaultTo(JSON.stringify({
      amount: 0.35,
      date: 0.20,
      merchant: 0.25,
      location: 0.10,
      user: 0.05,
      currency: 0.05
    }));
    table.integer('max_candidates').defaultTo(10);
    table.boolean('enable_learning').defaultTo(true);
    table.boolean('active').defaultTo(true);
    table.timestamps(true, true);
    table.uuid('updated_by').references('id').inTable('users');
    
    table.unique(['organization_id', 'active']); // One active config per org
    table.index(['organization_id']);
  });

  // Matching performance metrics
  await knex.schema.createTable('matching_metrics', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('organization_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
    table.date('metric_date').notNullable();
    table.integer('total_transactions').defaultTo(0);
    table.integer('total_receipts').defaultTo(0);
    table.integer('auto_matched').defaultTo(0);
    table.integer('manual_matched').defaultTo(0);
    table.integer('unmatched_transactions').defaultTo(0);
    table.integer('unmatched_receipts').defaultTo(0);
    table.decimal('average_confidence', 5, 4).defaultTo(0);
    table.decimal('accuracy_rate', 5, 4).defaultTo(0);
    table.integer('processing_time_avg_ms').defaultTo(0);
    table.integer('user_corrections').defaultTo(0);
    table.timestamps(true, true);
    
    table.unique(['organization_id', 'metric_date']);
    table.index(['organization_id']);
    table.index(['metric_date']);
  });

  // Learning patterns for ML improvement
  await knex.schema.createTable('learning_patterns', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('organization_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
    table.enu('pattern_type', ['merchant', 'amount_tolerance', 'date_window', 'location_radius', 'user_behavior']).notNullable();
    table.jsonb('pattern_data').notNullable(); // Pattern-specific data
    table.decimal('success_rate', 5, 4).notNullable();
    table.integer('sample_size').notNullable();
    table.decimal('confidence', 5, 4).defaultTo(0.5);
    table.boolean('active').defaultTo(true);
    table.timestamps(true, true);
    table.timestamp('last_evaluated');
    
    table.index(['organization_id']);
    table.index(['pattern_type']);
    table.index(['success_rate']);
    table.index(['active']);
  });

  // Enhanced transaction table with location and better merchant info
  await knex.schema.alterTable('transactions', (table) => {
    table.jsonb('location_data'); // GPS, address, etc.
    table.string('merchant_category');
    table.string('original_description'); // Keep original before processing
    table.decimal('fx_rate', 10, 6); // For foreign exchange
    table.string('original_currency', 3);
  });

  // Enhanced receipts table
  await knex.schema.alterTable('receipts', (table) => {
    table.jsonb('location_data'); // GPS, address from mobile app
    table.integer('processing_version').defaultTo(1); // Track OCR/processing versions
  });

  // Match rejection reasons
  await knex.schema.createTable('match_rejections', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('organization_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
    table.uuid('transaction_id').references('id').inTable('transactions').onDelete('CASCADE');
    table.uuid('receipt_id').references('id').inTable('receipts').onDelete('CASCADE');
    table.decimal('original_confidence', 5, 4);
    table.uuid('rejected_by').notNullable().references('id').inTable('users');
    table.timestamp('rejected_at').defaultTo(knex.fn.now());
    table.text('reason');
    table.uuid('correct_transaction_id').references('id').inTable('transactions');
    table.uuid('correct_receipt_id').references('id').inTable('receipts');
    table.timestamps(true, true);
    
    table.index(['organization_id']);
    table.index(['transaction_id']);
    table.index(['receipt_id']);
    table.index(['rejected_by']);
    table.index(['rejected_at']);
  });

  // Enable RLS on new tables
  await knex.raw(`
    ALTER TABLE learning_feedback ENABLE ROW LEVEL SECURITY;
    ALTER TABLE merchant_mappings ENABLE ROW LEVEL SECURITY;
    ALTER TABLE matching_configs ENABLE ROW LEVEL SECURITY;
    ALTER TABLE matching_metrics ENABLE ROW LEVEL SECURITY;
    ALTER TABLE learning_patterns ENABLE ROW LEVEL SECURITY;
    ALTER TABLE match_rejections ENABLE ROW LEVEL SECURITY;
  `);

  // RLS Policies
  await knex.raw(`
    CREATE POLICY learning_feedback_isolation ON learning_feedback
      FOR ALL USING (EXISTS (
        SELECT 1 FROM users u WHERE u.id = user_id 
        AND u.organization_id = current_setting('app.current_organization_id')::uuid
      ));
      
    CREATE POLICY merchant_mappings_isolation ON merchant_mappings
      FOR ALL USING (organization_id = current_setting('app.current_organization_id')::uuid);
      
    CREATE POLICY matching_configs_isolation ON matching_configs
      FOR ALL USING (organization_id = current_setting('app.current_organization_id')::uuid);
      
    CREATE POLICY matching_metrics_isolation ON matching_metrics
      FOR ALL USING (organization_id = current_setting('app.current_organization_id')::uuid);
      
    CREATE POLICY learning_patterns_isolation ON learning_patterns
      FOR ALL USING (organization_id = current_setting('app.current_organization_id')::uuid);
      
    CREATE POLICY match_rejections_isolation ON match_rejections
      FOR ALL USING (organization_id = current_setting('app.current_organization_id')::uuid);
  `);

  // Audit triggers
  await knex.raw(`
    CREATE TRIGGER learning_feedback_audit AFTER INSERT OR UPDATE OR DELETE ON learning_feedback
      FOR EACH ROW EXECUTE FUNCTION audit_trigger();
      
    CREATE TRIGGER merchant_mappings_audit AFTER INSERT OR UPDATE OR DELETE ON merchant_mappings
      FOR EACH ROW EXECUTE FUNCTION audit_trigger();
      
    CREATE TRIGGER matching_configs_audit AFTER INSERT OR UPDATE OR DELETE ON matching_configs
      FOR EACH ROW EXECUTE FUNCTION audit_trigger();
      
    CREATE TRIGGER match_rejections_audit AFTER INSERT OR UPDATE OR DELETE ON match_rejections
      FOR EACH ROW EXECUTE FUNCTION audit_trigger();
  `);

  // Function to update merchant mapping usage
  await knex.raw(`
    CREATE OR REPLACE FUNCTION update_merchant_mapping_usage()
    RETURNS TRIGGER AS $$
    BEGIN
      -- Update usage count when a match is made with known merchant
      UPDATE merchant_mappings 
      SET 
        usage_count = usage_count + 1,
        last_used = NOW(),
        updated_at = NOW()
      WHERE organization_id = NEW.organization_id
      AND canonical_name = (
        SELECT merchant_name FROM receipts 
        WHERE id = NEW.receipt_id
        LIMIT 1
      );
      
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER update_merchant_usage_on_match
      AFTER INSERT ON matches
      FOR EACH ROW
      EXECUTE FUNCTION update_merchant_mapping_usage();
  `);

  // Function to generate daily metrics
  await knex.raw(`
    CREATE OR REPLACE FUNCTION generate_daily_matching_metrics()
    RETURNS void AS $$
    DECLARE
      org_record RECORD;
      metric_date DATE := CURRENT_DATE - INTERVAL '1 day';
    BEGIN
      FOR org_record IN SELECT id FROM organizations LOOP
        INSERT INTO matching_metrics (
          organization_id,
          metric_date,
          total_transactions,
          total_receipts,
          auto_matched,
          manual_matched,
          unmatched_transactions,
          unmatched_receipts,
          average_confidence,
          accuracy_rate,
          user_corrections
        )
        SELECT 
          org_record.id,
          metric_date,
          COUNT(DISTINCT t.id),
          COUNT(DISTINCT r.id),
          COUNT(DISTINCT CASE WHEN m.match_type = 'auto' THEN m.id END),
          COUNT(DISTINCT CASE WHEN m.match_type = 'manual' THEN m.id END),
          COUNT(DISTINCT CASE WHEN m.id IS NULL AND t.id IS NOT NULL THEN t.id END),
          COUNT(DISTINCT CASE WHEN m.id IS NULL AND r.id IS NOT NULL THEN r.id END),
          COALESCE(AVG(m.confidence_score), 0),
          CASE 
            WHEN COUNT(lf.id) > 0 THEN 
              COUNT(CASE WHEN lf.was_correct THEN 1 END)::decimal / COUNT(lf.id)
            ELSE 0 
          END,
          COUNT(DISTINCT lf.id)
        FROM 
          transactions t
        FULL OUTER JOIN receipts r ON t.organization_id = r.organization_id
        LEFT JOIN matches m ON (t.id = m.transaction_id OR r.id = m.receipt_id) 
          AND m.active = true
          AND DATE(m.matched_at) = metric_date
        LEFT JOIN learning_feedback lf ON m.id = lf.match_id
          AND DATE(lf.feedback_date) = metric_date
        WHERE 
          (t.organization_id = org_record.id OR r.organization_id = org_record.id)
          AND (DATE(t.created_at) = metric_date OR DATE(r.created_at) = metric_date
               OR t.created_at IS NULL OR r.created_at IS NULL)
        ON CONFLICT (organization_id, metric_date) DO NOTHING;
      END LOOP;
    END;
    $$ LANGUAGE plpgsql;
  `);

  // Create indexes for better performance
  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transactions_unmatched 
      ON transactions (organization_id, status) 
      WHERE status != 'cancelled';
      
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_receipts_unmatched 
      ON receipts (organization_id, status) 
      WHERE status IN ('processed', 'uploaded');
      
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_matches_active 
      ON matches (transaction_id, receipt_id, active) 
      WHERE active = true;
      
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_extracted_fields_receipt 
      ON extracted_fields (receipt_id, field_name);
      
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transactions_merchant_date 
      ON transactions (organization_id, merchant_name, transaction_date);
      
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_receipts_merchant_date 
      ON receipts (organization_id, merchant_name, receipt_date);
  `);
};

exports.down = async function(knex) {
  await knex.raw('DROP FUNCTION IF EXISTS generate_daily_matching_metrics() CASCADE');
  await knex.raw('DROP FUNCTION IF EXISTS update_merchant_mapping_usage() CASCADE');
  
  await knex.schema.alterTable('receipts', (table) => {
    table.dropColumn('location_data');
    table.dropColumn('processing_version');
  });
  
  await knex.schema.alterTable('transactions', (table) => {
    table.dropColumn('location_data');
    table.dropColumn('merchant_category');
    table.dropColumn('original_description');
    table.dropColumn('fx_rate');
    table.dropColumn('original_currency');
  });
  
  await knex.schema.dropTableIfExists('match_rejections');
  await knex.schema.dropTableIfExists('learning_patterns');
  await knex.schema.dropTableIfExists('matching_metrics');
  await knex.schema.dropTableIfExists('matching_configs');
  await knex.schema.dropTableIfExists('merchant_mappings');
  await knex.schema.dropTableIfExists('learning_feedback');
};
