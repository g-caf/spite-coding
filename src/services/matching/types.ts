/**
 * Type definitions for the intelligent matching engine
 */

export interface MatchingTransaction {
  id: string;
  organization_id: string;
  amount: number;
  transaction_date: Date;
  posted_date: Date;
  description: string;
  merchant_name?: string;
  merchant_category?: string;
  location?: {
    latitude?: number;
    longitude?: number;
    address?: string;
  };
  user_id: string;
  account_id: string;
  currency: string;
  status: string;
}

export interface MatchingReceipt {
  id: string;
  organization_id: string;
  total_amount: number;
  currency: string;
  receipt_date: Date;
  merchant_name?: string;
  merchant_id?: string;
  location?: {
    latitude?: number;
    longitude?: number;
    address?: string;
  };
  uploaded_by: string;
  status: string;
  metadata: Record<string, any>;
  extracted_fields: ExtractedField[];
}

export interface ExtractedField {
  field_name: string;
  field_value: string;
  field_type: string;
  confidence_score: number;
  verified: boolean;
}

export interface MatchCandidate {
  transaction_id: string;
  receipt_id: string;
  confidence_score: number;
  match_criteria: MatchCriteria;
  reasoning: string[];
  warnings: string[];
}

export interface MatchCriteria {
  amount_match: AmountMatch;
  date_match: DateMatch;
  merchant_match: MerchantMatch;
  location_match?: LocationMatch;
  user_match: UserMatch;
  currency_match: CurrencyMatch;
}

export interface AmountMatch {
  matched: boolean;
  transaction_amount: number;
  receipt_amount: number;
  difference: number;
  difference_percentage: number;
  tolerance_applied: number;
  score: number;
}

export interface DateMatch {
  matched: boolean;
  transaction_date: Date;
  receipt_date: Date;
  days_difference: number;
  score: number;
}

export interface MerchantMatch {
  matched: boolean;
  transaction_merchant: string;
  receipt_merchant: string;
  similarity_score: number;
  canonical_name?: string;
  score: number;
}

export interface LocationMatch {
  matched: boolean;
  distance_km?: number;
  same_address: boolean;
  score: number;
}

export interface UserMatch {
  matched: boolean;
  transaction_user: string;
  receipt_user: string;
  score: number;
}

export interface CurrencyMatch {
  matched: boolean;
  transaction_currency: string;
  receipt_currency: string;
  score: number;
}

export interface MatchingConfig {
  amount_tolerance_percentage: number;
  amount_tolerance_fixed: number;
  date_window_days: number;
  merchant_similarity_threshold: number;
  location_radius_km: number;
  auto_match_threshold: number;
  suggest_threshold: number;
  confidence_weights: {
    amount: number;
    date: number;
    merchant: number;
    location: number;
    user: number;
    currency: number;
  };
  max_candidates: number;
  enable_learning: boolean;
}

export interface MatchResult {
  match_id?: string;
  transaction_id: string;
  receipt_id: string;
  match_type: 'auto' | 'suggested' | 'manual' | 'reviewed' | 'rejected';
  confidence_score: number;
  match_criteria: MatchCriteria;
  created_at: Date;
  matched_by?: string;
  notes?: string;
}

export interface MatchSuggestion {
  candidates: MatchCandidate[];
  unmatched_transactions: string[];
  unmatched_receipts: string[];
  processing_stats: {
    transactions_processed: number;
    receipts_processed: number;
    matches_found: number;
    auto_matches: number;
    suggestions: number;
    processing_time_ms: number;
  };
}

export interface LearningFeedback {
  match_id: string;
  was_correct: boolean;
  user_correction?: {
    correct_transaction_id?: string;
    correct_receipt_id?: string;
  };
  user_id: string;
  feedback_date: Date;
  notes?: string;
}

export interface MerchantMapping {
  id: string;
  organization_id: string;
  raw_names: string[];
  canonical_name: string;
  category?: string;
  confidence: number;
  created_from: 'transaction' | 'receipt' | 'manual';
  verified: boolean;
  usage_count: number;
  last_used: Date;
}

export interface MatchingRule {
  id: string;
  organization_id: string;
  name: string;
  conditions: {
    merchant_patterns?: string[];
    amount_range?: { min: number; max: number };
    category?: string;
    user_ids?: string[];
    custom_logic?: string;
  };
  actions: {
    set_category?: string;
    set_merchant?: string;
    auto_approve?: boolean;
    require_receipt?: boolean;
  };
  priority: number;
  active: boolean;
  match_count: number;
  success_rate: number;
  created_by: string;
  updated_at: Date;
}

export interface MatchingMetrics {
  organization_id: string;
  period_start: Date;
  period_end: Date;
  total_transactions: number;
  total_receipts: number;
  auto_matched: number;
  manual_matched: number;
  unmatched_transactions: number;
  unmatched_receipts: number;
  average_confidence: number;
  accuracy_rate: number;
  processing_time_avg_ms: number;
  user_corrections: number;
}
