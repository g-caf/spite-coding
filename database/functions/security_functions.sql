-- Additional security and utility functions for the expense platform

-- Function to check if user has specific permission
CREATE OR REPLACE FUNCTION check_user_permission(
  p_user_id UUID,
  p_resource TEXT,
  p_action TEXT
) RETURNS BOOLEAN AS $$
DECLARE
  has_permission BOOLEAN := false;
BEGIN
  -- Check if user has the specific permission or is an admin
  SELECT EXISTS (
    SELECT 1 
    FROM role_assignments ra
    WHERE ra.user_id = p_user_id
    AND ra.organization_id = current_setting('app.current_organization_id')::uuid
    AND ra.active = true
    AND (ra.expires_at IS NULL OR ra.expires_at > NOW())
    AND (
      ra.permissions->p_resource ? p_action
      OR ra.role = 'admin' -- Admins have all permissions
    )
  ) INTO has_permission;
  
  RETURN has_permission;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get user's effective permissions
CREATE OR REPLACE FUNCTION get_user_permissions(p_user_id UUID)
RETURNS JSONB AS $$
DECLARE
  user_permissions JSONB := '{}'::jsonb;
  role_record RECORD;
BEGIN
  -- Aggregate all permissions from all active roles
  FOR role_record IN
    SELECT ra.role, ra.permissions
    FROM role_assignments ra
    WHERE ra.user_id = p_user_id
    AND ra.organization_id = current_setting('app.current_organization_id')::uuid
    AND ra.active = true
    AND (ra.expires_at IS NULL OR ra.expires_at > NOW())
  LOOP
    -- Merge permissions from this role
    user_permissions := user_permissions || role_record.permissions;
    
    -- If user is admin, give all permissions
    IF role_record.role = 'admin' THEN
      user_permissions := '{
        "users": ["create", "read", "update", "delete"],
        "accounts": ["create", "read", "update", "delete"],
        "transactions": ["create", "read", "update", "delete"],
        "receipts": ["create", "read", "update", "delete"],
        "reports": ["create", "read", "update", "delete"],
        "audit": ["read"]
      }'::jsonb;
      EXIT; -- No need to check other roles
    END IF;
  END LOOP;
  
  RETURN user_permissions;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to log custom audit events
CREATE OR REPLACE FUNCTION log_audit_event(
  p_event_type audit_event_type,
  p_table_name TEXT DEFAULT NULL,
  p_record_id UUID DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
) RETURNS UUID AS $$
DECLARE
  audit_id UUID;
BEGIN
  audit_id := uuid_generate_v4();
  
  INSERT INTO audit_events (
    id,
    organization_id,
    event_type,
    table_name,
    record_id,
    user_id,
    metadata,
    created_at
  ) VALUES (
    audit_id,
    current_setting('app.current_organization_id')::uuid,
    p_event_type,
    p_table_name,
    p_record_id,
    current_setting('app.current_user_id')::uuid,
    p_metadata,
    NOW()
  );
  
  RETURN audit_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to calculate transaction matching score
CREATE OR REPLACE FUNCTION calculate_match_score(
  p_transaction_id UUID,
  p_receipt_id UUID
) RETURNS DECIMAL(5,4) AS $$
DECLARE
  transaction_record transactions%ROWTYPE;
  receipt_record receipts%ROWTYPE;
  score DECIMAL(5,4) := 0.0;
  amount_diff DECIMAL(15,2);
  date_diff INTEGER;
BEGIN
  -- Get transaction and receipt details
  SELECT * INTO transaction_record FROM transactions WHERE id = p_transaction_id;
  SELECT * INTO receipt_record FROM receipts WHERE id = p_receipt_id;
  
  IF transaction_record.id IS NULL OR receipt_record.id IS NULL THEN
    RETURN 0.0;
  END IF;
  
  -- Amount matching (40% of score)
  amount_diff := ABS(transaction_record.amount - receipt_record.total_amount);
  IF amount_diff = 0 THEN
    score := score + 0.4;
  ELSIF amount_diff <= (transaction_record.amount * 0.05) THEN -- Within 5%
    score := score + 0.3;
  ELSIF amount_diff <= (transaction_record.amount * 0.10) THEN -- Within 10%
    score := score + 0.2;
  END IF;
  
  -- Date matching (30% of score)
  date_diff := ABS(EXTRACT(epoch FROM (transaction_record.transaction_date - receipt_record.receipt_date)) / 86400);
  IF date_diff = 0 THEN
    score := score + 0.3;
  ELSIF date_diff <= 1 THEN -- Within 1 day
    score := score + 0.2;
  ELSIF date_diff <= 3 THEN -- Within 3 days
    score := score + 0.1;
  END IF;
  
  -- Merchant matching (20% of score)
  IF transaction_record.merchant_id = receipt_record.merchant_id THEN
    score := score + 0.2;
  ELSIF transaction_record.merchant_id IS NOT NULL AND receipt_record.merchant_name IS NOT NULL THEN
    -- Partial merchant name matching
    IF EXISTS (
      SELECT 1 FROM merchants m 
      WHERE m.id = transaction_record.merchant_id 
      AND (
        lower(m.name) LIKE '%' || lower(receipt_record.merchant_name) || '%'
        OR lower(receipt_record.merchant_name) LIKE '%' || lower(m.name) || '%'
      )
    ) THEN
      score := score + 0.1;
    END IF;
  END IF;
  
  -- Currency matching (10% of score)
  IF transaction_record.currency = receipt_record.currency THEN
    score := score + 0.1;
  END IF;
  
  RETURN LEAST(score, 1.0); -- Cap at 1.0
END;
$$ LANGUAGE plpgsql;

-- Function to apply categorization rules to a transaction
CREATE OR REPLACE FUNCTION apply_categorization_rules(p_transaction_id UUID)
RETURNS JSONB AS $$
DECLARE
  transaction_record transactions%ROWTYPE;
  rule_record rules%ROWTYPE;
  applied_actions JSONB := '[]'::jsonb;
  rule_conditions JSONB;
  rule_actions JSONB;
  matches_conditions BOOLEAN;
BEGIN
  -- Get transaction details
  SELECT * INTO transaction_record FROM transactions WHERE id = p_transaction_id;
  
  IF transaction_record.id IS NULL THEN
    RETURN applied_actions;
  END IF;
  
  -- Loop through active rules in priority order
  FOR rule_record IN
    SELECT * FROM rules r
    WHERE r.organization_id = transaction_record.organization_id
    AND r.active = true
    ORDER BY r.priority DESC, r.created_at ASC
  LOOP
    rule_conditions := rule_record.conditions;
    rule_actions := rule_record.actions;
    matches_conditions := true;
    
    -- Check amount range condition
    IF rule_conditions ? 'amount_range' THEN
      IF NOT (
        transaction_record.amount >= COALESCE((rule_conditions->'amount_range'->>'min')::decimal, 0)
        AND transaction_record.amount <= COALESCE((rule_conditions->'amount_range'->>'max')::decimal, 999999999)
      ) THEN
        matches_conditions := false;
      END IF;
    END IF;
    
    -- Check merchant name condition
    IF matches_conditions AND rule_conditions ? 'merchant_names' THEN
      IF NOT EXISTS (
        SELECT 1 FROM merchants m
        WHERE m.id = transaction_record.merchant_id
        AND lower(m.name) = ANY(
          SELECT lower(value::text) 
          FROM jsonb_array_elements_text(rule_conditions->'merchant_names')
        )
      ) THEN
        matches_conditions := false;
      END IF;
    END IF;
    
    -- If rule matches, apply actions
    IF matches_conditions THEN
      -- Update match count
      UPDATE rules SET 
        match_count = match_count + 1,
        last_matched_at = NOW()
      WHERE id = rule_record.id;
      
      -- Apply category action
      IF rule_actions ? 'set_category' THEN
        UPDATE transactions 
        SET category_id = (rule_actions->>'set_category')::uuid,
            updated_at = NOW(),
            updated_by = current_setting('app.current_user_id', true)::uuid
        WHERE id = p_transaction_id;
      END IF;
      
      -- Apply memo action
      IF rule_actions ? 'set_memo' THEN
        UPDATE transactions 
        SET memo = rule_actions->>'set_memo',
            updated_at = NOW(),
            updated_by = current_setting('app.current_user_id', true)::uuid
        WHERE id = p_transaction_id;
      END IF;
      
      -- Record applied action
      applied_actions := applied_actions || jsonb_build_object(
        'rule_id', rule_record.id,
        'rule_name', rule_record.name,
        'actions', rule_actions,
        'applied_at', NOW()
      );
    END IF;
  END LOOP;
  
  RETURN applied_actions;
END;
$$ LANGUAGE plpgsql;

-- Function to detect potential duplicate transactions
CREATE OR REPLACE FUNCTION detect_duplicate_transactions(p_transaction_id UUID)
RETURNS JSONB AS $$
DECLARE
  transaction_record transactions%ROWTYPE;
  duplicate_candidates JSONB := '[]'::jsonb;
  candidate_record RECORD;
BEGIN
  -- Get transaction details
  SELECT * INTO transaction_record FROM transactions WHERE id = p_transaction_id;
  
  IF transaction_record.id IS NULL THEN
    RETURN duplicate_candidates;
  END IF;
  
  -- Find potential duplicates within 24 hours, same merchant, similar amount
  FOR candidate_record IN
    SELECT 
      t.id,
      t.transaction_date,
      t.amount,
      t.description,
      ABS(t.amount - transaction_record.amount) as amount_diff,
      ABS(EXTRACT(epoch FROM (t.transaction_date - transaction_record.transaction_date))) as time_diff_seconds
    FROM transactions t
    WHERE t.organization_id = transaction_record.organization_id
    AND t.id != p_transaction_id
    AND t.merchant_id = transaction_record.merchant_id
    AND t.transaction_date BETWEEN 
      (transaction_record.transaction_date - INTERVAL '24 hours') AND 
      (transaction_record.transaction_date + INTERVAL '24 hours')
    AND ABS(t.amount - transaction_record.amount) <= 0.01 -- Within 1 cent
  LOOP
    duplicate_candidates := duplicate_candidates || jsonb_build_object(
      'transaction_id', candidate_record.id,
      'transaction_date', candidate_record.transaction_date,
      'amount', candidate_record.amount,
      'description', candidate_record.description,
      'amount_diff', candidate_record.amount_diff,
      'time_diff_hours', (candidate_record.time_diff_seconds / 3600),
      'confidence', CASE 
        WHEN candidate_record.amount_diff = 0 AND candidate_record.time_diff_seconds < 3600 THEN 0.95
        WHEN candidate_record.amount_diff = 0 THEN 0.85
        ELSE 0.70
      END
    );
  END LOOP;
  
  RETURN duplicate_candidates;
END;
$$ LANGUAGE plpgsql;

-- Function to anonymize user data for GDPR compliance
CREATE OR REPLACE FUNCTION anonymize_user_data(p_user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  -- Update user record with anonymized data
  UPDATE users SET
    email = 'anonymized_' || extract(epoch from now())::text || '@deleted.local',
    first_name = 'Anonymized',
    last_name = 'User',
    encrypted_ssn = NULL,
    phone = NULL,
    preferences = '{}',
    active = false,
    updated_at = NOW()
  WHERE id = p_user_id;
  
  -- Log the anonymization
  PERFORM log_audit_event(
    'delete',
    'users',
    p_user_id,
    jsonb_build_object('action', 'user_data_anonymized', 'reason', 'gdpr_request')
  );
  
  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant appropriate permissions
GRANT EXECUTE ON FUNCTION check_user_permission(UUID, TEXT, TEXT) TO PUBLIC;
GRANT EXECUTE ON FUNCTION get_user_permissions(UUID) TO PUBLIC;
GRANT EXECUTE ON FUNCTION log_audit_event(audit_event_type, TEXT, UUID, JSONB) TO PUBLIC;
GRANT EXECUTE ON FUNCTION calculate_match_score(UUID, UUID) TO PUBLIC;
GRANT EXECUTE ON FUNCTION apply_categorization_rules(UUID) TO PUBLIC;
GRANT EXECUTE ON FUNCTION detect_duplicate_transactions(UUID) TO PUBLIC;