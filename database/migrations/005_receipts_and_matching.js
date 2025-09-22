/**
 * Receipts and Matching Migration
 * Receipt management, OCR data extraction, and transaction matching
 */

exports.up = async function(knex) {
  // Receipts table
  await knex.schema.createTable('receipts', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('organization_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
    table.uuid('uploaded_by').notNullable().references('id').inTable('users');
    table.string('original_filename').notNullable();
    table.string('file_path').notNullable();
    table.string('file_type');
    table.integer('file_size');
    table.string('file_hash'); // For deduplication
    table.enu('status', ['uploaded', 'processing', 'processed', 'failed', 'matched']).defaultTo('uploaded');
    table.timestamp('processed_at');
    table.jsonb('processing_errors').defaultTo('[]');
    table.decimal('total_amount', 15, 2);
    table.string('currency', 3);
    table.timestamp('receipt_date');
    table.uuid('merchant_id').references('id').inTable('merchants');
    table.string('merchant_name'); // Raw extracted name before matching
    table.jsonb('metadata').defaultTo('{}');
    table.timestamps(true, true);
    table.uuid('updated_by').references('id').inTable('users');
    
    table.unique(['file_hash', 'organization_id']); // Prevent duplicates
    table.index(['organization_id']);
    table.index(['uploaded_by']);
    table.index(['status']);
    table.index(['receipt_date']);
    table.index(['merchant_id']);
    table.index(['file_hash']);
  });

  // Receipt images table (for multiple images per receipt)
  await knex.schema.createTable('receipt_images', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('organization_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
    table.uuid('receipt_id').notNullable().references('id').inTable('receipts').onDelete('CASCADE');
    table.string('file_path').notNullable();
    table.string('file_type');
    table.integer('file_size');
    table.integer('sequence_number').defaultTo(1); // Order of images
    table.jsonb('ocr_data').defaultTo('{}'); // Raw OCR output
    table.decimal('confidence_score', 5, 4); // OCR confidence 0-1
    table.timestamps(true, true);
    
    table.unique(['receipt_id', 'sequence_number']);
    table.index(['organization_id']);
    table.index(['receipt_id']);
  });

  // Extracted fields from receipts (structured data from OCR)
  await knex.schema.createTable('extracted_fields', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('organization_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
    table.uuid('receipt_id').notNullable().references('id').inTable('receipts').onDelete('CASCADE');
    table.string('field_name').notNullable(); // e.g., 'total', 'tax', 'merchant_name', 'date'
    table.text('field_value').notNullable();
    table.string('field_type'); // e.g., 'amount', 'date', 'text'
    table.decimal('confidence_score', 5, 4); // Extraction confidence 0-1
    table.jsonb('bounding_box'); // Coordinates in the image
    table.boolean('verified').defaultTo(false); // Human verified
    table.uuid('verified_by').references('id').inTable('users');
    table.timestamp('verified_at');
    table.timestamps(true, true);
    
    table.index(['organization_id']);
    table.index(['receipt_id']);
    table.index(['field_name']);
    table.index(['verified']);
  });

  // Transaction to Receipt matches
  await knex.schema.createTable('matches', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('organization_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
    table.uuid('transaction_id').notNullable().references('id').inTable('transactions').onDelete('CASCADE');
    table.uuid('receipt_id').notNullable().references('id').inTable('receipts').onDelete('CASCADE');
    table.enu('match_type', ['auto', 'manual', 'reviewed', 'rejected']).notNullable();
    table.decimal('confidence_score', 5, 4); // Matching confidence 0-1
    table.jsonb('matching_criteria').defaultTo('{}'); // What criteria were used
    table.uuid('matched_by').references('id').inTable('users');
    table.timestamp('matched_at').defaultTo(knex.fn.now());
    table.boolean('active').defaultTo(true); // Allow for unmatch/rematch
    table.text('notes');
    table.timestamps(true, true);
    table.uuid('updated_by').references('id').inTable('users');
    
    table.unique(['transaction_id', 'receipt_id', 'active']); // One active match per pair
    table.index(['organization_id']);
    table.index(['transaction_id']);
    table.index(['receipt_id']);
    table.index(['match_type']);
    table.index(['active']);
    table.index(['matched_at']);
  });

  // Categorization rules for automatic processing
  await knex.schema.createTable('rules', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('organization_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
    table.string('name').notNullable();
    table.text('description');
    table.jsonb('conditions').notNullable(); // Rule conditions (merchant, amount range, etc.)
    table.jsonb('actions').notNullable(); // What to do when rule matches (set category, etc.)
    table.integer('priority').defaultTo(100); // Rule execution priority
    table.boolean('active').defaultTo(true);
    table.integer('match_count').defaultTo(0); // How many times this rule has matched
    table.timestamp('last_matched_at');
    table.timestamps(true, true);
    table.uuid('created_by').references('id').inTable('users');
    table.uuid('updated_by').references('id').inTable('users');
    
    table.unique(['organization_id', 'name']);
    table.index(['organization_id']);
    table.index(['active']);
    table.index(['priority']);
  });

  // Enable RLS
  await knex.raw(`
    ALTER TABLE receipts ENABLE ROW LEVEL SECURITY;
    ALTER TABLE receipt_images ENABLE ROW LEVEL SECURITY;
    ALTER TABLE extracted_fields ENABLE ROW LEVEL SECURITY;
    ALTER TABLE matches ENABLE ROW LEVEL SECURITY;
    ALTER TABLE rules ENABLE ROW LEVEL SECURITY;
  `);

  // RLS Policies
  await knex.raw(`
    CREATE POLICY receipts_isolation ON receipts
      FOR ALL USING (organization_id = current_setting('app.current_organization_id')::uuid);
      
    CREATE POLICY receipt_images_isolation ON receipt_images
      FOR ALL USING (organization_id = current_setting('app.current_organization_id')::uuid);
      
    CREATE POLICY extracted_fields_isolation ON extracted_fields
      FOR ALL USING (organization_id = current_setting('app.current_organization_id')::uuid);
      
    CREATE POLICY matches_isolation ON matches
      FOR ALL USING (organization_id = current_setting('app.current_organization_id')::uuid);
      
    CREATE POLICY rules_isolation ON rules
      FOR ALL USING (organization_id = current_setting('app.current_organization_id')::uuid);
  `);

  // Audit triggers
  await knex.raw(`
    CREATE TRIGGER receipts_audit AFTER INSERT OR UPDATE OR DELETE ON receipts
      FOR EACH ROW EXECUTE FUNCTION audit_trigger();
      
    CREATE TRIGGER receipt_images_audit AFTER INSERT OR UPDATE OR DELETE ON receipt_images
      FOR EACH ROW EXECUTE FUNCTION audit_trigger();
      
    CREATE TRIGGER extracted_fields_audit AFTER INSERT OR UPDATE OR DELETE ON extracted_fields
      FOR EACH ROW EXECUTE FUNCTION audit_trigger();
      
    CREATE TRIGGER matches_audit AFTER INSERT OR UPDATE OR DELETE ON matches
      FOR EACH ROW EXECUTE FUNCTION audit_trigger();
      
    CREATE TRIGGER rules_audit AFTER INSERT OR UPDATE OR DELETE ON rules
      FOR EACH ROW EXECUTE FUNCTION audit_trigger();
  `);

  // Function to update receipt status after processing
  await knex.raw(`
    CREATE OR REPLACE FUNCTION update_receipt_status()
    RETURNS TRIGGER AS $$
    BEGIN
      -- Update receipt status to processed when OCR is complete
      UPDATE receipts 
      SET 
        status = 'processed',
        processed_at = NOW(),
        updated_at = NOW()
      WHERE id = NEW.receipt_id
      AND status = 'processing';
      
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER update_status_after_extraction
      AFTER INSERT ON extracted_fields
      FOR EACH ROW
      EXECUTE FUNCTION update_receipt_status();
  `);

  // Function for automatic matching based on rules
  await knex.raw(`
    CREATE OR REPLACE FUNCTION auto_match_transaction_receipt()
    RETURNS TRIGGER AS $$
    DECLARE
      matching_receipt_id UUID;
      match_confidence DECIMAL(5,4);
    BEGIN
      -- Simple matching logic (can be enhanced with ML)
      SELECT r.id, 0.85 INTO matching_receipt_id, match_confidence
      FROM receipts r
      WHERE r.organization_id = NEW.organization_id
      AND r.total_amount BETWEEN (NEW.amount * 0.95) AND (NEW.amount * 1.05)
      AND r.receipt_date BETWEEN (NEW.transaction_date - INTERVAL '3 days') AND (NEW.transaction_date + INTERVAL '1 day')
      AND r.status = 'processed'
      AND NOT EXISTS (
        SELECT 1 FROM matches m 
        WHERE m.receipt_id = r.id 
        AND m.active = true
      )
      ORDER BY ABS(r.total_amount - NEW.amount), ABS(EXTRACT(epoch FROM (r.receipt_date - NEW.transaction_date)))
      LIMIT 1;
      
      -- Create match if found
      IF matching_receipt_id IS NOT NULL THEN
        INSERT INTO matches (
          id, organization_id, transaction_id, receipt_id, 
          match_type, confidence_score, matching_criteria,
          matched_at, active
        ) VALUES (
          uuid_generate_v4(), NEW.organization_id, NEW.id, matching_receipt_id,
          'auto', match_confidence, 
          jsonb_build_object(
            'amount_match', true,
            'date_range_match', true,
            'confidence', match_confidence
          ),
          NOW(), true
        );
        
        -- Update receipt status to matched
        UPDATE receipts 
        SET status = 'matched', updated_at = NOW()
        WHERE id = matching_receipt_id;
      END IF;
      
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER auto_match_after_transaction
      AFTER INSERT ON transactions
      FOR EACH ROW
      WHEN (NEW.status = 'processed')
      EXECUTE FUNCTION auto_match_transaction_receipt();
  `);
};

exports.down = async function(knex) {
  await knex.raw('DROP FUNCTION IF EXISTS auto_match_transaction_receipt() CASCADE');
  await knex.raw('DROP FUNCTION IF EXISTS update_receipt_status() CASCADE');
  await knex.schema.dropTableIfExists('rules');
  await knex.schema.dropTableIfExists('matches');
  await knex.schema.dropTableIfExists('extracted_fields');
  await knex.schema.dropTableIfExists('receipt_images');
  await knex.schema.dropTableIfExists('receipts');
};