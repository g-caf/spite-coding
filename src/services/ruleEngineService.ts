/**
 * Rule Engine Service
 * Advanced categorization and automation rules with machine learning
 */

import { knex } from '../utils/database';
import { auditLogger } from '../utils/audit';
import { getErrorMessage } from '../utils/errorHandling';

export interface Rule {
  id: string;
  organization_id: string;
  name: string;
  description?: string;
  rule_type: 'categorization' | 'policy' | 'automation';
  conditions: RuleConditions;
  actions: RuleActions;
  priority: number;
  active: boolean;
  match_count: number;
  success_rate: number;
  last_matched_at?: Date;
  created_by: string;
  updated_by: string;
  created_at: Date;
  updated_at: Date;
}

export interface RuleConditions {
  // Basic conditions
  merchant_names?: any[];
  merchant_categories?: any[];
  amount_range?: {
    min?: number;
    max?: number;
  };
  description_keywords?: any[];
  
  // Advanced conditions
  user_ids?: any[];
  account_ids?: any[];
  time_conditions?: {
    days_of_week?: number[]; // 0=Sunday, 6=Saturday
    time_range?: {
      start: string; // HH:MM
      end: string;   // HH:MM
    };
    date_range?: {
      start?: string;
      end?: string;
    };
  };
  
  // Transaction properties
  is_recurring?: boolean;
  transaction_type?: 'debit' | 'credit';
  currency?: any[];
  
  // Location conditions
  location_conditions?: {
    countries?: any[];
    cities?: any[];
    radius_km?: number;
    coordinates?: {
      latitude: number;
      longitude: number;
    };
  };
  
  // Frequency conditions
  frequency_conditions?: {
    occurrence_count?: number;
    time_window_days?: number;
    same_merchant?: boolean;
    same_amount?: boolean;
  };
  
  // Custom logic (JavaScript expression)
  custom_logic?: string;
  
  // ML-based conditions
  similarity_conditions?: {
    reference_transaction_id?: string;
    similarity_threshold?: number;
    features?: any[]; // 'amount', 'merchant', 'description', 'time'
  };
}

export interface RuleActions {
  // Categorization actions
  set_category?: string;
  set_gl_account?: string;
  set_memo?: string;
  
  // Approval workflow actions
  require_approval?: boolean;
  auto_approve?: boolean;
  require_receipt?: boolean;
  require_justification?: boolean;
  
  // Notification actions
  notify_manager?: boolean;
  notify_users?: any[];
  send_email?: {
    template: string;
    recipients: any[];
    subject?: string;
  };
  
  // Policy enforcement actions
  flag_for_review?: boolean;
  block_transaction?: boolean;
  apply_spending_limit?: number;
  
  // Data enrichment actions
  set_merchant?: string;
  set_department?: string;
  set_project?: string;
  add_tags?: any[];
  
  // Duplicate detection actions
  flag_as_duplicate?: boolean;
  merge_with_transaction?: string;
  
  // Custom actions
  webhook_url?: string;
  custom_script?: string;
  
  // Learning actions
  train_model?: {
    feature_type: string;
    feedback_weight: number;
  };
}

export interface RuleValidation {
  isValid: boolean;
  errors: any[];
  warnings: any[];
}

export interface RuleTestResult {
  rule: Rule;
  matches: number;
  total_tested: number;
  match_rate: number;
  matched_transactions: Array<{
    transaction_id: string;
    confidence_score: number;
    applied_actions: any[];
    reasons: any[];
  }>;
  performance_metrics: {
    execution_time_ms: number;
    memory_usage_kb: number;
  };
}

export interface RuleAnalytics {
  rule_performance: Array<{
    rule_id: string;
    rule_name: string;
    match_count: number;
    success_rate: number;
    avg_execution_time: number;
    last_matched: Date;
  }>;
  category_accuracy: Array<{
    category_id: string;
    category_name: string;
    auto_categorized: number;
    manually_corrected: number;
    accuracy_rate: number;
  }>;
  system_metrics: {
    total_rules: number;
    active_rules: number;
    avg_processing_time: number;
    automation_rate: number;
    user_corrections: number;
  };
}

export interface LearningFeedback {
  transaction_id: string;
  expected_category_id: string;
  applied_rule_id?: string;
  correction_type: 'category' | 'policy' | 'merchant';
  feedback: string;
  organization_id: string;
  userId: string;
}

export class RuleEngineService {
  /**
   * Get all rules with optional filtering
   */
  async getRules(organization_id: string, filters: {
    activeOnly?: boolean;
    ruleType?: string;
    priorityMin?: number;
    priorityMax?: number;
  } = {}): Promise<Rule[]> {
    const query = knex('rules')
      .where('organization_id', organizationId);

    if (filters.activeOnly) {
      query.where('active', true);
    }

    if (filters.ruleType) {
      query.where('rule_type', filters.ruleType);
    }

    if (filters.priorityMin !== undefined) {
      query.where('priority', '>=', filters.priorityMin);
    }

    if (filters.priorityMax !== undefined) {
      query.where('priority', '<=', filters.priorityMax);
    }

    query.orderBy('priority', 'desc').orderBy('created_at', 'asc');

    return await query;
  }

  /**
   * Get a specific rule by ID
   */
  async getRuleById(ruleId: string, organization_id: string): Promise<Rule | null> {
    const rule = await knex('rules')
      .where('id', ruleId)
      .where('organization_id', organizationId)
      .first();

    if (!rule) return null;

    // Calculate success rate based on recent matches
    const stats = await knex.raw(`
      SELECT 
        COUNT(*) as total_applications,
        COUNT(CASE WHEN feedback.was_correct THEN 1 END) as successful_applications
      FROM rule_applications ra
      LEFT JOIN rule_feedback feedback ON ra.id = feedback.rule_application_id
      WHERE ra.rule_id = ? AND ra.created_at >= NOW() - INTERVAL '30 days'
    `, [ruleId]);

    if (stats.rows[0] && parseInt(stats.rows[0].total_applications) > 0) {
      rule.success_rate = (parseInt(stats.rows[0].successful_applications) / parseInt(stats.rows[0].total_applications)) * 100;
    }

    return rule;
  }

  /**
   * Create a new rule
   */
  async createRule(ruleData: Partial<Rule>): Promise<Rule> {
    // Check for duplicate rule names
    const existingRule = await knex('rules')
      .where('organization_id', ruleData.organization_id)
      .where('name', ruleData.name)
      .first();

    if (existingRule) {
      throw new Error(`Rule "${ruleData.name}" already exists`);
    }

    const [rule] = await knex('rules')
      .insert({
        organization_id: ruleData.organization_id,
        name: ruleData.name,
        description: ruleData.description,
        rule_type: ruleData.rule_type,
        conditions: JSON.stringify(ruleData.conditions),
        actions: JSON.stringify(ruleData.actions),
        priority: ruleData.priority || 100,
        active: ruleData.active !== false,
        match_count: 0,
        success_rate: 0,
        created_by: ruleData.created_by,
        updated_by: ruleData.updated_by,
        created_at: knex.fn.now(),
        updated_at: knex.fn.now()
      })
      .returning('*');

    await auditLogger.log({
      action: 'CREATE_RULE',
      resource_type: 'Rule',
      resource_id: rule.id,
      organization_id: ruleData.organization_id,
      user_id: ruleData.created_by,
      details: {
        rule_name: rule.name,
        rule_type: rule.rule_type,
        priority: rule.priority
      }
    });

    return rule;
  }

  /**
   * Update an existing rule
   */
  async updateRule(
    ruleId: string,
    organization_id: string,
    updateData: Partial<Rule>
  ): Promise<Rule | null> {
    const existingRule = await knex('rules')
      .where('id', ruleId)
      .where('organization_id', organizationId)
      .first();

    if (!existingRule) {
      return null;
    }

    // Check for duplicate names if name is being changed
    if (updateData.name && updateData.name !== existingRule.name) {
      const duplicateRule = await knex('rules')
        .where('organization_id', organizationId)
        .where('name', updateData.name)
        .whereNot('id', ruleId)
        .first();

      if (duplicateRule) {
        throw new Error(`Rule "${updateData.name}" already exists`);
      }
    }

    const updateFields: any = {
      updated_by: updateData.updated_by,
      updated_at: knex.fn.now()
    };

    if (updateData.name !== undefined) updateFields.name = updateData.name;
    if (updateData.description !== undefined) updateFields.description = updateData.description;
    if (updateData.rule_type !== undefined) updateFields.rule_type = updateData.rule_type;
    if (updateData.conditions !== undefined) updateFields.conditions = JSON.stringify(updateData.conditions);
    if (updateData.actions !== undefined) updateFields.actions = JSON.stringify(updateData.actions);
    if (updateData.priority !== undefined) updateFields.priority = updateData.priority;
    if (updateData.active !== undefined) updateFields.active = updateData.active;

    await knex('rules')
      .where('id', ruleId)
      .where('organization_id', organizationId)
      .update(updateFields);

    await auditLogger.log({
      action: 'UPDATE_RULE',
      resource_type: 'Rule',
      resource_id: ruleId,
      organization_id: organization_id,
      user_id: updateData.updated_by,
      details: {
        changes: Object.keys(updateFields).filter(key => !['updated_by', 'updated_at'].includes(key))
      }
    });

    return this.getRuleById(ruleId, organizationId);
  }

  /**
   * Delete a rule (soft delete)
   */
  async deleteRule(ruleId: string, organization_id: string): Promise<boolean> {
    const rule = await knex('rules')
      .where('id', ruleId)
      .where('organization_id', organizationId)
      .first();

    if (!rule) {
      return false;
    }

    await knex('rules')
      .where('id', ruleId)
      .where('organization_id', organizationId)
      .update({
        active: false,
        updated_at: knex.fn.now()
      });

    await auditLogger.log({
      action: 'DELETE_RULE',
      resource_type: 'Rule',
      resource_id: ruleId,
      organization_id: organization_id,
      details: {
        rule_name: rule.name
      }
    });

    return true;
  }

  /**
   * Validate rule structure and logic
   */
  async validateRule(rule: Partial<Rule>): Promise<RuleValidation> {
    const errors: any[] = [];
    const warnings: any[] = [];

    // Basic validation
    if (!rule.name || rule.name.trim().length === 0) {
      errors.push('Rule name is required');
    }

    if (!rule.rule_type || !['categorization', 'policy', 'automation'].includes(rule.rule_type)) {
      errors.push('Valid rule type is required (categorization, policy, automation)');
    }

    if (!rule.conditions || Object.keys(rule.conditions).length === 0) {
      errors.push('At least one condition is required');
    }

    if (!rule.actions || Object.keys(rule.actions).length === 0) {
      errors.push('At least one action is required');
    }

    // Validate conditions
    if (rule.conditions) {
      await this.validateConditions(rule.conditions, rule.organization_id, errors, warnings);
    }

    // Validate actions
    if (rule.actions) {
      await this.validateActions(rule.actions, rule.organization_id, errors, warnings);
    }

    // Check for conflicting rules
    if (rule.organization_id) {
      const conflictingRules = await this.findConflictingRules(rule);
      if (conflictingRules.length > 0) {
        warnings.push(`This rule may conflict with ${conflictingRules.length} existing rule(s)`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Test a rule against sample transactions
   */
  async testRule(params: {
    rule: Partial<Rule>;
    transactions: any[];
    dryRun?: boolean;
  }): Promise<RuleTestResult> {
    const { rule, transactions, dryRun = true } = params;
    const startTime = Date.now();

    const matchedTransactions = [];
    let matches = 0;

    for (const transaction of transactions) {
      const match = await this.evaluateRuleForTransaction(rule, transaction);
      
      if (match.matches) {
        matches++;
        matchedTransactions.push({
          transaction_id: transaction.id,
          confidence_score: match.confidence,
          applied_actions: match.actions,
          reasons: match.reasons
        });

        // Apply actions if not a dry run
        if (!dryRun) {
          await this.applyRuleActions(rule.actions, transaction, rule.organization_id);
        }
      }
    }

    const executionTime = Date.now() - startTime;

    return {
      rule: rule as Rule,
      matches,
      total_tested: transactions.length,
      match_rate: (matches / transactions.length) * 100,
      matched_transactions: matchedTransactions,
      performance_metrics: {
        execution_time_ms: executionTime,
        memory_usage_kb: 0 // Would implement actual memory tracking
      }
    };
  }

  /**
   * Apply a rule to existing transactions (backfill)
   */
  async applyRuleToTransactions(params: {
    ruleId: string;
    organization_id: string;
    userId: string;
    transactionIds?: any[];
    dateRange?: { start: string; end: string };
    dryRun?: boolean;
  }): Promise<{ affected_count: number; details: any[] }> {
    const { ruleId, organization_id, userId, transactionIds, dateRange, dryRun = true } = params;

    const rule = await this.getRuleById(ruleId, organizationId);
    if (!rule) {
      throw new Error('Rule not found');
    }

    let query = knex('transactions')
      .where('organization_id', organizationId);

    if (transactionIds) {
      query = query.whereIn('id', transactionIds);
    }

    if (dateRange) {
      query = query.whereBetween('transaction_date', [dateRange.start, dateRange.end]);
    }

    const transactions = await query;
    const details = [];
    let affectedCount = 0;

    for (const transaction of transactions) {
      const match = await this.evaluateRuleForTransaction(rule, transaction);
      
      if (match.matches) {
        affectedCount++;
        details.push({
          transaction_id: transaction.id,
          actions_applied: match.actions,
          confidence: match.confidence
        });

        if (!dryRun) {
          await this.applyRuleActions(rule.actions, transaction, organizationId);
          
          // Log rule application
          await knex('rule_applications').insert({
            rule_id: ruleId,
            transaction_id: transaction.id,
            organization_id: organization_id,
            applied_actions: JSON.stringify(match.actions),
            confidence_score: match.confidence,
            applied_by: userId,
            applied_at: knex.fn.now()
          });
        }
      }
    }

    if (!dryRun) {
      // Update rule match count
      await knex('rules')
        .where('id', ruleId)
        .increment('match_count', affectedCount)
        .update('last_matched_at', knex.fn.now());

      await auditLogger.log({
        action: 'APPLY_RULE_BULK',
        resource_type: 'Rule',
        resource_id: ruleId,
        organization_id: organization_id,
        user_id: userId,
        details: {
          rule_name: rule.name,
          affected_count: affectedCount,
          total_tested: transactions.length
        }
      });
    }

    return {
      affected_count: affectedCount,
      details
    };
  }

  /**
   * Get rule performance analytics
   */
  async getRuleAnalytics(params: {
    organization_id: string;
    ruleId?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<RuleAnalytics> {
    const { organization_id, ruleId, startDate, endDate } = params;

    let dateFilter = '';
    const queryParams: any[] = [organizationId];

    if (startDate || endDate) {
      dateFilter = 'AND ra.applied_at';
      if (startDate && endDate) {
        dateFilter += ' BETWEEN ? AND ?';
        queryParams.push(startDate, endDate);
      } else if (startDate) {
        dateFilter += ' >= ?';
        queryParams.push(startDate);
      } else {
        dateFilter += ' <= ?';
        queryParams.push(endDate);
      }
    }

    // Rule performance metrics
    const rulePerformance = await knex.raw(`
      SELECT 
        r.id as rule_id,
        r.name as rule_name,
        COUNT(ra.id) as match_count,
        COALESCE(AVG(
          CASE WHEN rf.was_correct THEN 100 ELSE 0 END
        ), 0) as success_rate,
        COALESCE(AVG(ra.execution_time_ms), 0) as avg_execution_time,
        MAX(ra.applied_at) as last_matched
      FROM rules r
      LEFT JOIN rule_applications ra ON r.id = ra.rule_id ${dateFilter}
      LEFT JOIN rule_feedback rf ON ra.id = rf.rule_application_id
      WHERE r.organization_id = ? 
        ${ruleId ? 'AND r.id = ?' : ''}
      GROUP BY r.id, r.name
      ORDER BY match_count DESC
    `, ruleId ? [...queryParams, ruleId] : queryParams);

    // Category accuracy analysis
    const categoryAccuracy = await knex.raw(`
      SELECT 
        c.id as category_id,
        c.name as category_name,
        COUNT(CASE WHEN ra.id IS NOT NULL THEN 1 END) as auto_categorized,
        COUNT(CASE WHEN rf.correction_type = 'category' THEN 1 END) as manually_corrected,
        CASE 
          WHEN COUNT(CASE WHEN ra.id IS NOT NULL THEN 1 END) > 0 THEN
            100.0 - (COUNT(CASE WHEN rf.correction_type = 'category' THEN 1 END) * 100.0 / 
                    COUNT(CASE WHEN ra.id IS NOT NULL THEN 1 END))
          ELSE 0
        END as accuracy_rate
      FROM categories c
      LEFT JOIN transactions t ON c.id = t.category_id
      LEFT JOIN rule_applications ra ON t.id = ra.transaction_id ${dateFilter}
      LEFT JOIN rule_feedback rf ON ra.id = rf.rule_application_id
      WHERE c.organization_id = ?
      GROUP BY c.id, c.name
      HAVING COUNT(CASE WHEN ra.id IS NOT NULL THEN 1 END) > 0
      ORDER BY auto_categorized DESC
    `, [organizationId]);

    // System-wide metrics
    const systemMetrics = await knex.raw(`
      SELECT 
        COUNT(DISTINCT r.id) as total_rules,
        COUNT(DISTINCT CASE WHEN r.active THEN r.id END) as active_rules,
        COALESCE(AVG(ra.execution_time_ms), 0) as avg_processing_time,
        CASE 
          WHEN COUNT(t.id) > 0 THEN
            (COUNT(CASE WHEN ra.id IS NOT NULL THEN 1 END) * 100.0 / COUNT(t.id))
          ELSE 0
        END as automation_rate,
        COUNT(rf.id) as user_corrections
      FROM rules r
      CROSS JOIN transactions t
      LEFT JOIN rule_applications ra ON t.id = ra.transaction_id ${dateFilter}
      LEFT JOIN rule_feedback rf ON ra.id = rf.rule_application_id
      WHERE r.organization_id = ? AND t.organization_id = ?
    `, [organization_id, organizationId]);

    return {
      rule_performance: rulePerformance.rows,
      category_accuracy: categoryAccuracy.rows,
      system_metrics: systemMetrics.rows[0]
    };
  }

  /**
   * Submit learning feedback to improve rule accuracy
   */
  async submitLearningFeedback(feedbackData: LearningFeedback): Promise<{ success: boolean; learned_patterns: any[] }> {
    const { transaction_id, expected_category_id, applied_rule_id, correction_type, feedback, organization_id, userId } = feedbackData;

    // Record the feedback
    await knex('rule_feedback').insert({
      transaction_id,
      expected_category_id,
      applied_rule_id,
      correction_type,
      feedback,
      organization_id: organization_id,
      user_id: userId,
      created_at: knex.fn.now()
    });

    // Analyze patterns and suggest rule improvements
    const learnedPatterns = await this.analyzeUserCorrections(organization_id, correction_type);

    await auditLogger.log({
      action: 'SUBMIT_LEARNING_FEEDBACK',
      resource_type: 'Rule',
      organization_id: organization_id,
      user_id: userId,
      details: {
        transaction_id,
        correction_type,
        applied_rule_id
      }
    });

    return {
      success: true,
      learned_patterns: learnedPatterns
    };
  }

  /**
   * Process transactions with active rules (called by transaction processor)
   */
  async processTransactionWithRules(transaction: any, organization_id: string): Promise<{
    applied_rules: any[];
    categorized: boolean;
    requires_approval: boolean;
    flaggedIssues: any[];
  }> {
    const activeRules = await knex('rules')
      .where('organization_id', organizationId)
      .where('active', true)
      .orderBy('priority', 'desc');

    const appliedRules: any[] = [];
    let categorized = false;
    let requiresApproval = false;
    const flaggedIssues: any[] = [];

    for (const rule of activeRules) {
      const match = await this.evaluateRuleForTransaction(rule, transaction);
      
      if (match.matches) {
        appliedRules.push(rule.id);
        
        const actionResults = await this.applyRuleActions(rule.actions, transaction, organizationId);
        
        if (actionResults.categorized) categorized = true;
        if (actionResults.requires_approval) requiresApproval = true;
        flaggedIssues.push(...actionResults.flaggedIssues);

        // Log rule application
        await knex('rule_applications').insert({
          rule_id: rule.id,
          transaction_id: transaction.id,
          organization_id: organization_id,
          applied_actions: JSON.stringify(match.actions),
          confidence_score: match.confidence,
          applied_at: knex.fn.now()
        });

        // Update rule statistics
        await knex('rules')
          .where('id', rule.id)
          .increment('match_count', 1)
          .update('last_matched_at', knex.fn.now());
      }
    }

    return {
      applied_rules: appliedRules,
      categorized,
      requires_approval: requiresApproval,
      flaggedIssues
    };
  }

  /**
   * Private helper methods
   */

  private async validateConditions(
    conditions: RuleConditions, 
    organization_id: string, 
    errors: any[], 
    warnings: any[]
  ): Promise<void> {
    // Validate merchant conditions
    if (conditions.merchant_names && conditions.merchant_names.length === 0) {
      warnings.push('Empty merchant names array');
    }

    // Validate amount range
    if (conditions.amount_range) {
      const { min, max } = conditions.amount_range;
      if (min !== undefined && max !== undefined && min > max) {
        errors.push('Amount range minimum cannot be greater than maximum');
      }
    }

    // Validate referenced entities exist
    if (conditions.user_ids && organizationId) {
      const validUsers = await knex('users')
        .whereIn('id', conditions.user_ids)
        .where('organization_id', organizationId)
        .pluck('id');
      
      const invalidUsers = conditions.user_ids.filter(id => !validUsers.includes(id));
      if (invalidUsers.length > 0) {
        errors.push(`Invalid user IDs: ${invalidUsers.join(', ')}`);
      }
    }

    // Validate custom logic syntax
    if (conditions.custom_logic) {
      try {
        // Basic syntax validation - in production, use a proper JS parser
        new Function('transaction', conditions.custom_logic);
      } catch (error) {
        errors.push(`Invalid custom logic syntax: ${getErrorMessage(error)}`);
      }
    }
  }

  private async validateActions(
    actions: RuleActions,
    organization_id: string,
    errors: any[],
    warnings: any[]
  ): Promise<void> {
    // Validate category reference
    if (actions.set_category && organizationId) {
      const category = await knex('categories')
        .where('id', actions.set_category)
        .where('organization_id', organizationId)
        .first();
      
      if (!category) {
        errors.push('Referenced category does not exist');
      }
    }

    // Validate conflicting actions
    if (actions.auto_approve && actions.require_approval) {
      errors.push('Cannot have both auto_approve and require_approval actions');
    }

    if (actions.block_transaction && actions.auto_approve) {
      errors.push('Cannot have both block_transaction and auto_approve actions');
    }

    // Validate notification recipients
    if (actions.notify_users && actions.notify_users.length > 0 && organizationId) {
      const validUsers = await knex('users')
        .whereIn('id', actions.notify_users)
        .where('organization_id', organizationId)
        .pluck('id');
      
      const invalidUsers = actions.notify_users.filter(id => !validUsers.includes(id));
      if (invalidUsers.length > 0) {
        errors.push(`Invalid notification user IDs: ${invalidUsers.join(', ')}`);
      }
    }
  }

  private async findConflictingRules(rule: Partial<Rule>): Promise<Rule[]> {
    if (!rule.organization_id || !rule.conditions) return [];

    // Find rules with overlapping conditions
    const existingRules = await knex('rules')
      .where('organization_id', rule.organization_id)
      .where('active', true)
      .where('rule_type', rule.rule_type);

    // Simple conflict detection - could be enhanced with more sophisticated logic
    return existingRules.filter(existingRule => {
      const existingConditions = JSON.parse(existingRule.conditions);
      
      // Check for merchant overlap
      if (rule.conditions.merchant_names && existingConditions.merchant_names) {
        const overlap = rule.conditions.merchant_names.some(name => 
          existingConditions.merchant_names.includes(name)
        );
        if (overlap) return true;
      }

      return false;
    });
  }

  private async evaluateRuleForTransaction(rule: Partial<Rule>, transaction: any): Promise<{
    matches: boolean;
    confidence: number;
    actions: any[];
    reasons: any[];
  }> {
    const reasons: any[] = [];
    const actions: any[] = [];
    let confidence = 0;
    let totalConditions = 0;
    let matchedConditions = 0;

    const conditions = typeof rule.conditions === 'string' ? JSON.parse(rule.conditions) : rule.conditions;

    // Evaluate merchant conditions
    if (conditions.merchant_names && conditions.merchant_names.length > 0) {
      totalConditions++;
      const merchantMatch = conditions.merchant_names.some(name => 
        transaction.description?.toLowerCase().includes(name.toLowerCase()) ||
        transaction.merchant_name?.toLowerCase().includes(name.toLowerCase())
      );
      
      if (merchantMatch) {
        matchedConditions++;
        reasons.push('Merchant name matched');
        confidence += 0.3;
      }
    }

    // Evaluate amount range
    if (conditions.amount_range) {
      totalConditions++;
      const amount = Math.abs(transaction.amount);
      const { min, max } = conditions.amount_range;
      
      if ((min === undefined || amount >= min) && (max === undefined || amount <= max)) {
        matchedConditions++;
        reasons.push('Amount within range');
        confidence += 0.2;
      }
    }

    // Evaluate description keywords
    if (conditions.description_keywords && conditions.description_keywords.length > 0) {
      totalConditions++;
      const descriptionMatch = conditions.description_keywords.some(keyword =>
        transaction.description?.toLowerCase().includes(keyword.toLowerCase())
      );
      
      if (descriptionMatch) {
        matchedConditions++;
        reasons.push('Description keyword matched');
        confidence += 0.2;
      }
    }

    // Evaluate user conditions
    if (conditions.user_ids && conditions.user_ids.length > 0) {
      totalConditions++;
      if (conditions.user_ids.includes(transaction.user_id)) {
        matchedConditions++;
        reasons.push('User matched');
        confidence += 0.1;
      }
    }

    // Custom logic evaluation
    if (conditions.custom_logic) {
      totalConditions++;
      try {
        const customResult = new Function('transaction', `return ${conditions.custom_logic}`)(transaction);
        if (customResult) {
          matchedConditions++;
          reasons.push('Custom logic matched');
          confidence += 0.2;
        }
      } catch (error) {
        // Log error but don't fail the rule
        console.warn('Custom logic evaluation failed:', getErrorMessage(error));
      }
    }

    // Determine if rule matches (all conditions must match)
    const matches = totalConditions > 0 && matchedConditions === totalConditions;

    // Extract actions if rule matches
    if (matches && rule.actions) {
      const ruleActions = typeof rule.actions === 'string' ? JSON.parse(rule.actions) : rule.actions;
      actions.push(...Object.keys(ruleActions).filter(key => ruleActions[key]));
    }

    return {
      matches,
      confidence: Math.min(confidence, 1.0),
      actions,
      reasons
    };
  }

  private async applyRuleActions(actions: RuleActions, transaction: any, organization_id: string): Promise<{
    categorized: boolean;
    requires_approval: boolean;
    flaggedIssues: any[];
  }> {
    let categorized = false;
    let requiresApproval = false;
    const flaggedIssues: any[] = [];

    if (!actions) return { categorized, requires_approval: requiresApproval, flaggedIssues: flaggedIssues };

    // Apply categorization
    if (actions.set_category) {
      await knex('transactions')
        .where('id', transaction.id)
        .update({ category_id: actions.set_category });
      categorized = true;
    }

    // Apply memo
    if (actions.set_memo) {
      await knex('transactions')
        .where('id', transaction.id)
        .update({ memo: actions.set_memo });
    }

    // Handle approval requirements
    if (actions.require_approval) {
      requiresApproval = true;
    }

    // Handle flags
    if (actions.flag_for_review) {
      flaggedIssues.push('Flagged for manual review');
    }

    if (actions.flag_as_duplicate) {
      flaggedIssues.push('Flagged as potential duplicate');
    }

    // Handle notifications (would implement actual notification sending)
    if (actions.notify_manager || actions.notify_users) {
      // Queue notification tasks
      await knex('notification_queue').insert({
        organization_id: organization_id,
        transaction_id: transaction.id,
        notification_type: 'rule_triggered',
        recipients: JSON.stringify(actions.notify_users || []),
        notify_manager: actions.notify_manager || false,
        created_at: knex.fn.now()
      });
    }

    return {
      categorized,
      requires_approval: requiresApproval,
      flaggedIssues: flaggedIssues
    };
  }

  private async analyzeUserCorrections(organization_id: string, correctionType: string): Promise<any[]> {
    const patterns: any[] = [];

    // Analyze recent corrections to identify patterns
    const recentCorrections = await knex('rule_feedback')
      .where('organization_id', organizationId)
      .where('correction_type', correctionType)
      .where('created_at', '>=', knex.raw('NOW() - INTERVAL \'30 days\''))
      .orderBy('created_at', 'desc')
      .limit(100);

    // Group by common patterns
    const merchantPatterns = new Map<string, number>();
    const categoryPatterns = new Map<string, number>();

    for (const correction of recentCorrections) {
      // Analyze transaction patterns
      const transaction = await knex('transactions')
        .where('id', correction.transaction_id)
        .first();

      if (transaction) {
        // Extract merchant patterns
        if (transaction.merchant_name) {
          merchantPatterns.set(transaction.merchant_name, (merchantPatterns.get(transaction.merchant_name) || 0) + 1);
        }

        // Extract category patterns
        const category = await knex('categories')
          .where('id', correction.expected_category_id)
          .first();

        if (category) {
          categoryPatterns.set(category.name, (categoryPatterns.get(category.name) || 0) + 1);
        }
      }
    }

    // Identify significant patterns (appearing 3+ times)
    for (const [merchant, count] of merchantPatterns.entries()) {
      if (count >= 3) {
        patterns.push(`Merchant "${merchant}" frequently requires manual categorization (${count} times)`);
      }
    }

    for (const [category, count] of categoryPatterns.entries()) {
      if (count >= 3) {
        patterns.push(`Category "${category}" frequently chosen as correction (${count} times)`);
      }
    }

    return patterns;
  }
}
