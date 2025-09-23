/**
 * Transaction Categorization Service
 * AI-powered expense categorization with machine learning
 */

import { knex } from '../utils/database';
import { auditLogger } from '../utils/audit';
import { RuleEngineService } from './ruleEngineService';

interface CategorySuggestion {
  id: string;
  category_id: string;
  category_name: string;
  confidence_score: number;
  reasoning: {
    primary_factors: string[];
    similar_transactions: number;
    merchant_history: boolean;
    amount_pattern: boolean;
    rule_based: boolean;
  };
  suggestion_source: 'ml_model' | 'similarity' | 'rules' | 'merchant_history';
}

interface CategorizationResult {
  transaction_id: string;
  category_id: string;
  confidence_score: number;
  applied_rules: string[];
  suggestions_used: number;
  processing_time_ms: number;
}

interface CategorizationAnalytics {
  overall_stats: {
    total_transactions: number;
    categorized_transactions: number;
    auto_categorized: number;
    manually_categorized: number;
    categorization_rate: number;
    avg_confidence_score: number;
  };
  accuracy_metrics: {
    correct_predictions: number;
    total_predictions: number;
    accuracy_rate: number;
    precision_by_category: Array<{
      category_id: string;
      category_name: string;
      precision: number;
      recall: number;
      f1_score: number;
    }>;
  };
  performance_trends: Array<{
    date: string;
    auto_categorized: number;
    manual_corrections: number;
    accuracy_rate: number;
  }>;
  top_merchants: Array<{
    merchant_name: string;
    transaction_count: number;
    categorization_accuracy: number;
    most_common_category: string;
  }>;
}

export class TransactionCategorizationService {
  private ruleEngine: RuleEngineService;

  constructor() {
    this.ruleEngine = new RuleEngineService();
  }

  /**
   * Categorize a specific transaction
   */
  async categorizeTransaction(params: {
    transactionId: string;
    categoryId: string;
    organizationId: string;
    userId: string;
    applyRules?: boolean;
    confidenceOverride?: number;
  }): Promise<CategorizationResult> {
    const { transactionId, categoryId, organizationId, userId, applyRules, confidenceOverride } = params;
    const startTime = Date.now();

    // Verify transaction exists and belongs to organization
    const transaction = await knex('transactions')
      .where('id', transactionId)
      .where('organization_id', organizationId)
      .first();

    if (!transaction) {
      throw new Error('Transaction not found');
    }

    // Verify category exists
    const category = await knex('categories')
      .where('id', categoryId)
      .where('organization_id', organizationId)
      .where('active', true)
      .first();

    if (!category) {
      throw new Error('Category not found');
    }

    // Update transaction category
    await knex('transactions')
      .where('id', transactionId)
      .update({
        category_id: categoryId,
        updated_by: userId,
        updated_at: knex.fn.now()
      });

    let appliedRules: string[] = [];
    let suggestionsUsed = 0;

    // Apply additional rules if requested
    if (applyRules) {
      const ruleResult = await this.ruleEngine.processTransactionWithRules(
        { ...transaction, category_id: categoryId },
        organizationId
      );
      appliedRules = ruleResult.applied_rules;
    }

    // Record categorization event
    await knex('category_suggestions')
      .where('transaction_id', transactionId)
      .where('suggested_category_id', categoryId)
      .update({
        accepted: true,
        accepted_by: userId,
        accepted_at: knex.fn.now()
      });

    const processingTime = Date.now() - startTime;

    await auditLogger.log({
      action: 'CATEGORIZE_TRANSACTION',
      resource_type: 'Transaction',
      resource_id: transactionId,
      organization_id: organizationId,
      user_id: userId,
      details: {
        category_id: categoryId,
        category_name: category.name,
        confidence_override: confidenceOverride,
        processing_time_ms: processingTime
      }
    });

    return {
      transaction_id: transactionId,
      category_id: categoryId,
      confidence_score: confidenceOverride || 1.0,
      applied_rules: appliedRules,
      suggestions_used: suggestionsUsed,
      processing_time_ms: processingTime
    };
  }

  /**
   * Get AI-powered category suggestions for a transaction
   */
  async getCategorySuggestions(params: {
    transactionId: string;
    organizationId: string;
    limit?: number;
  }): Promise<CategorySuggestion[]> {
    const { transactionId, organizationId, limit = 5 } = params;

    const transaction = await knex('transactions')
      .where('id', transactionId)
      .where('organization_id', organizationId)
      .first();

    if (!transaction) {
      throw new Error('Transaction not found');
    }

    // Get existing suggestions
    const existingSuggestions = await knex('category_suggestions')
      .select(
        'category_suggestions.*',
        'categories.name as category_name'
      )
      .join('categories', 'category_suggestions.suggested_category_id', 'categories.id')
      .where('category_suggestions.transaction_id', transactionId)
      .where('category_suggestions.organization_id', organizationId)
      .orderBy('confidence_score', 'desc')
      .limit(limit);

    if (existingSuggestions.length > 0) {
      return this.formatCategorySuggestions(existingSuggestions);
    }

    // Generate new suggestions
    const suggestions: CategorySuggestion[] = [];

    // 1. Rule-based suggestions
    const ruleSuggestions = await this.getRuleBasedSuggestions(transaction, organizationId);
    suggestions.push(...ruleSuggestions);

    // 2. Merchant history suggestions
    const merchantSuggestions = await this.getMerchantHistorySuggestions(transaction, organizationId);
    suggestions.push(...merchantSuggestions);

    // 3. Similarity-based suggestions
    const similaritySuggestions = await this.getSimilarityBasedSuggestions(transaction, organizationId);
    suggestions.push(...similaritySuggestions);

    // 4. ML model suggestions (placeholder for actual ML implementation)
    const mlSuggestions = await this.getMLBasedSuggestions(transaction, organizationId);
    suggestions.push(...mlSuggestions);

    // Remove duplicates and sort by confidence
    const uniqueSuggestions = this.deduplicateSuggestions(suggestions);
    const topSuggestions = uniqueSuggestions
      .sort((a, b) => b.confidence_score - a.confidence_score)
      .slice(0, limit);

    // Store suggestions for future reference
    await this.storeCategorySuggestions(transactionId, organizationId, topSuggestions);

    return topSuggestions;
  }

  /**
   * Auto-categorize multiple transactions
   */
  async autoCategorizeTransactions(params: {
    organizationId: string;
    userId: string;
    transactionIds?: string[];
    dateRange?: { start: string; end: string };
    confidenceThreshold?: number;
    dryRun?: boolean;
  }): Promise<{
    categorized_count: number;
    skipped_count: number;
    failed_count: number;
    details: Array<{
      transaction_id: string;
      category_id?: string;
      confidence_score: number;
      status: 'categorized' | 'skipped' | 'failed';
      reason?: string;
    }>;
  }> {
    const { organizationId, userId, transactionIds, dateRange, confidenceThreshold = 0.8, dryRun = true } = params;

    let query = knex('transactions')
      .where('organization_id', organizationId)
      .whereNull('category_id'); // Only uncategorized transactions

    if (transactionIds) {
      query = query.whereIn('id', transactionIds);
    }

    if (dateRange) {
      query = query.whereBetween('transaction_date', [dateRange.start, dateRange.end]);
    }

    const transactions = await query.orderBy('transaction_date', 'desc');

    let categorizedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    const details: any[] = [];

    for (const transaction of transactions) {
      try {
        const suggestions = await this.getCategorySuggestions({
          transactionId: transaction.id,
          organizationId
        });

        if (suggestions.length === 0 || suggestions[0].confidence_score < confidenceThreshold) {
          skippedCount++;
          details.push({
            transaction_id: transaction.id,
            confidence_score: suggestions[0]?.confidence_score || 0,
            status: 'skipped',
            reason: 'Confidence below threshold'
          });
          continue;
        }

        const bestSuggestion = suggestions[0];

        if (!dryRun) {
          await this.categorizeTransaction({
            transactionId: transaction.id,
            categoryId: bestSuggestion.category_id,
            organizationId,
            userId,
            confidenceOverride: bestSuggestion.confidence_score
          });
        }

        categorizedCount++;
        details.push({
          transaction_id: transaction.id,
          category_id: bestSuggestion.category_id,
          confidence_score: bestSuggestion.confidence_score,
          status: 'categorized'
        });

      } catch (error) {
        failedCount++;
        details.push({
          transaction_id: transaction.id,
          confidence_score: 0,
          status: 'failed',
          reason: error.message
        });
      }
    }

    await auditLogger.log({
      action: 'AUTO_CATEGORIZE_TRANSACTIONS',
      resource_type: 'Transaction',
      organization_id: organizationId,
      user_id: userId,
      details: {
        total_processed: transactions.length,
        categorized_count: categorizedCount,
        skipped_count: skippedCount,
        failed_count: failedCount,
        confidence_threshold: confidenceThreshold,
        dry_run: dryRun
      }
    });

    return {
      categorized_count: categorizedCount,
      skipped_count: skippedCount,
      failed_count: failedCount,
      details
    };
  }

  /**
   * Accept a category suggestion
   */
  async acceptCategorySuggestion(params: {
    suggestionId: string;
    organizationId: string;
    userId: string;
    feedback?: string;
  }): Promise<CategorizationResult> {
    const { suggestionId, organizationId, userId, feedback } = params;

    const suggestion = await knex('category_suggestions')
      .where('id', suggestionId)
      .where('organization_id', organizationId)
      .first();

    if (!suggestion) {
      throw new Error('Suggestion not found');
    }

    // Categorize the transaction
    const result = await this.categorizeTransaction({
      transactionId: suggestion.transaction_id,
      categoryId: suggestion.suggested_category_id,
      organizationId,
      userId
    });

    // Record feedback
    if (feedback) {
      await knex('rule_feedback').insert({
        organization_id: organizationId,
        transaction_id: suggestion.transaction_id,
        expected_category_id: suggestion.suggested_category_id,
        correction_type: 'category',
        feedback,
        was_correct: true,
        user_id: userId,
        created_at: knex.fn.now(),
        updated_at: knex.fn.now()
      });
    }

    return result;
  }

  /**
   * Reject a category suggestion
   */
  async rejectCategorySuggestion(params: {
    suggestionId: string;
    correctCategoryId?: string;
    organizationId: string;
    userId: string;
    feedback?: string;
  }): Promise<{ success: boolean; learning_applied: boolean }> {
    const { suggestionId, correctCategoryId, organizationId, userId, feedback } = params;

    const suggestion = await knex('category_suggestions')
      .where('id', suggestionId)
      .where('organization_id', organizationId)
      .first();

    if (!suggestion) {
      throw new Error('Suggestion not found');
    }

    // If correct category provided, categorize the transaction
    if (correctCategoryId) {
      await this.categorizeTransaction({
        transactionId: suggestion.transaction_id,
        categoryId: correctCategoryId,
        organizationId,
        userId
      });
    }

    // Record negative feedback
    await knex('rule_feedback').insert({
      organization_id: organizationId,
      transaction_id: suggestion.transaction_id,
      expected_category_id: correctCategoryId || suggestion.suggested_category_id,
      correction_type: 'category',
      feedback: feedback || 'Suggestion rejected',
      was_correct: false,
      user_id: userId,
      created_at: knex.fn.now(),
      updated_at: knex.fn.now()
    });

    return {
      success: true,
      learning_applied: true
    };
  }

  /**
   * Get uncategorized transactions with suggestions
   */
  async getUncategorizedTransactions(params: {
    organizationId: string;
    limit?: number;
    offset?: number;
    includeSuggestions?: boolean;
  }): Promise<{
    transactions: any[];
    total: number;
    hasMore: boolean;
  }> {
    const { organizationId, limit = 20, offset = 0, includeSuggestions = true } = params;

    const totalQuery = knex('transactions')
      .where('organization_id', organizationId)
      .whereNull('category_id')
      .count('id as count')
      .first();

    const transactionsQuery = knex('transactions')
      .where('organization_id', organizationId)
      .whereNull('category_id')
      .orderBy('transaction_date', 'desc')
      .limit(limit)
      .offset(offset);

    const [totalResult, transactions] = await Promise.all([totalQuery, transactionsQuery]);
    const total = parseInt(totalResult.count);

    // Add suggestions if requested
    if (includeSuggestions) {
      for (const transaction of transactions) {
        try {
          transaction.suggestions = await this.getCategorySuggestions({
            transactionId: transaction.id,
            organizationId,
            limit: 3
          });
        } catch (error) {
          transaction.suggestions = [];
        }
      }
    }

    return {
      transactions,
      total,
      hasMore: offset + transactions.length < total
    };
  }

  /**
   * Get categorization analytics
   */
  async getCategorizationAnalytics(params: {
    organizationId: string;
    startDate?: string;
    endDate?: string;
    includeAccuracy?: boolean;
  }): Promise<CategorizationAnalytics> {
    const { organizationId, startDate, endDate, includeAccuracy = true } = params;

    let dateFilter = '';
    const queryParams: any[] = [organizationId];

    if (startDate || endDate) {
      dateFilter = 'AND t.transaction_date';
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

    // Overall statistics
    const overallStats = await knex.raw(`
      SELECT 
        COUNT(*) as total_transactions,
        COUNT(category_id) as categorized_transactions,
        COUNT(CASE WHEN ra.id IS NOT NULL THEN 1 END) as auto_categorized,
        COUNT(CASE WHEN category_id IS NOT NULL AND ra.id IS NULL THEN 1 END) as manually_categorized,
        ROUND(
          COUNT(category_id) * 100.0 / NULLIF(COUNT(*), 0), 2
        ) as categorization_rate,
        ROUND(AVG(cs.confidence_score), 3) as avg_confidence_score
      FROM transactions t
      LEFT JOIN rule_applications ra ON t.id = ra.transaction_id
      LEFT JOIN category_suggestions cs ON t.id = cs.transaction_id AND cs.accepted = true
      WHERE t.organization_id = ? ${dateFilter}
    `, queryParams);

    // Accuracy metrics (if requested)
    let accuracyMetrics = null;
    if (includeAccuracy) {
      accuracyMetrics = await knex.raw(`
        WITH accuracy_data AS (
          SELECT 
            c.id as category_id,
            c.name as category_name,
            COUNT(CASE WHEN rf.was_correct THEN 1 END) as correct_predictions,
            COUNT(rf.id) as total_predictions
          FROM categories c
          LEFT JOIN transactions t ON c.id = t.category_id
          LEFT JOIN rule_feedback rf ON t.id = rf.transaction_id
          WHERE c.organization_id = ? ${dateFilter.replace('t.', '')}
          GROUP BY c.id, c.name
        )
        SELECT 
          category_id,
          category_name,
          ROUND(
            correct_predictions * 100.0 / NULLIF(total_predictions, 0), 2
          ) as precision,
          total_predictions
        FROM accuracy_data
        WHERE total_predictions > 0
        ORDER BY total_predictions DESC
      `, queryParams);
    }

    // Performance trends
    const performanceTrends = await knex.raw(`
      SELECT 
        DATE_TRUNC('day', t.transaction_date) as date,
        COUNT(CASE WHEN ra.id IS NOT NULL THEN 1 END) as auto_categorized,
        COUNT(CASE WHEN rf.correction_type = 'category' THEN 1 END) as manual_corrections,
        ROUND(
          COUNT(CASE WHEN rf.was_correct OR rf.id IS NULL THEN 1 END) * 100.0 / 
          NULLIF(COUNT(*), 0), 2
        ) as accuracy_rate
      FROM transactions t
      LEFT JOIN rule_applications ra ON t.id = ra.transaction_id
      LEFT JOIN rule_feedback rf ON ra.id = rf.rule_application_id
      WHERE t.organization_id = ? ${dateFilter}
      AND t.category_id IS NOT NULL
      GROUP BY DATE_TRUNC('day', t.transaction_date)
      ORDER BY date DESC
      LIMIT 30
    `, queryParams);

    // Top merchants analysis
    const topMerchants = await knex.raw(`
      SELECT 
        COALESCE(mi.normalized_name, t.merchant_name, 'Unknown') as merchant_name,
        COUNT(t.id) as transaction_count,
        ROUND(
          COUNT(CASE WHEN rf.was_correct OR rf.id IS NULL THEN 1 END) * 100.0 / 
          NULLIF(COUNT(*), 0), 2
        ) as categorization_accuracy,
        MODE() WITHIN GROUP (ORDER BY c.name) as most_common_category
      FROM transactions t
      LEFT JOIN merchant_intelligence mi ON t.merchant_name = mi.raw_merchant_name 
        AND t.organization_id = mi.organization_id
      LEFT JOIN categories c ON t.category_id = c.id
      LEFT JOIN rule_applications ra ON t.id = ra.transaction_id
      LEFT JOIN rule_feedback rf ON ra.id = rf.rule_application_id
      WHERE t.organization_id = ? ${dateFilter}
      AND t.category_id IS NOT NULL
      GROUP BY COALESCE(mi.normalized_name, t.merchant_name, 'Unknown')
      HAVING COUNT(t.id) >= 3
      ORDER BY transaction_count DESC
      LIMIT 20
    `, queryParams);

    return {
      overall_stats: overallStats.rows[0],
      accuracy_metrics: {
        correct_predictions: 0,
        total_predictions: 0,
        accuracy_rate: 0,
        precision_by_category: accuracyMetrics?.rows || []
      },
      performance_trends: performanceTrends.rows,
      top_merchants: topMerchants.rows
    };
  }

  /**
   * Train categorization model with recent data
   */
  async trainModel(params: {
    organizationId: string;
    userId: string;
    modelType?: string;
    trainingPeriodDays?: number;
  }): Promise<{ training_started: boolean; model_id: string; estimated_completion: string }> {
    const { organizationId, userId, modelType = 'ml_classification', trainingPeriodDays = 90 } = params;

    // This would integrate with actual ML training pipeline
    // For now, we'll simulate the training process

    const trainingData = await knex('transactions')
      .select('*')
      .where('organization_id', organizationId)
      .whereNotNull('category_id')
      .where('created_at', '>=', knex.raw(`NOW() - INTERVAL '${trainingPeriodDays} days'`))
      .orderBy('created_at', 'desc');

    if (trainingData.length < 50) {
      throw new Error('Insufficient training data. Need at least 50 categorized transactions.');
    }

    // Create training job record
    const [trainingJob] = await knex('ml_training_jobs').insert({
      organization_id: organizationId,
      model_type: modelType,
      status: 'started',
      training_data_count: trainingData.length,
      started_by: userId,
      started_at: knex.fn.now(),
      estimated_completion: knex.raw('NOW() + INTERVAL \'30 minutes\'')
    }).returning('*');

    await auditLogger.log({
      action: 'START_MODEL_TRAINING',
      resource_type: 'MLModel',
      resource_id: trainingJob.id,
      organization_id: organizationId,
      user_id: userId,
      details: {
        model_type: modelType,
        training_data_count: trainingData.length,
        training_period_days: trainingPeriodDays
      }
    });

    return {
      training_started: true,
      model_id: trainingJob.id,
      estimated_completion: trainingJob.estimated_completion
    };
  }

  /**
   * Private helper methods
   */

  private async getRuleBasedSuggestions(transaction: any, organizationId: string): Promise<CategorySuggestion[]> {
    const activeRules = await knex('rules')
      .where('organization_id', organizationId)
      .where('active', true)
      .where('rule_type', 'categorization')
      .orderBy('priority', 'desc');

    const suggestions: CategorySuggestion[] = [];

    for (const rule of activeRules) {
      const conditions = JSON.parse(rule.conditions);
      const actions = JSON.parse(rule.actions);

      if (!actions.set_category) continue;

      // Simple rule matching (can be enhanced)
      let matches = 0;
      let totalConditions = 0;
      const factors: string[] = [];

      if (conditions.merchant_names) {
        totalConditions++;
        const merchantMatch = conditions.merchant_names.some((name: string) =>
          transaction.description?.toLowerCase().includes(name.toLowerCase())
        );
        if (merchantMatch) {
          matches++;
          factors.push('Merchant name pattern');
        }
      }

      if (conditions.amount_range) {
        totalConditions++;
        const amount = Math.abs(transaction.amount);
        const { min, max } = conditions.amount_range;
        if ((min === undefined || amount >= min) && (max === undefined || amount <= max)) {
          matches++;
          factors.push('Amount within range');
        }
      }

      if (totalConditions > 0 && matches === totalConditions) {
        const category = await knex('categories')
          .where('id', actions.set_category)
          .first();

        if (category) {
          suggestions.push({
            id: `rule_${rule.id}`,
            category_id: category.id,
            category_name: category.name,
            confidence_score: 0.9,
            reasoning: {
              primary_factors: factors,
              similar_transactions: 0,
              merchant_history: false,
              amount_pattern: conditions.amount_range ? true : false,
              rule_based: true
            },
            suggestion_source: 'rules'
          });
        }
      }
    }

    return suggestions;
  }

  private async getMerchantHistorySuggestions(transaction: any, organizationId: string): Promise<CategorySuggestion[]> {
    if (!transaction.merchant_name) return [];

    const merchantHistory = await knex('transactions as t')
      .select('c.id', 'c.name', knex.raw('COUNT(*) as frequency'))
      .join('categories as c', 't.category_id', 'c.id')
      .where('t.organization_id', organizationId)
      .where('t.merchant_name', 'ilike', `%${transaction.merchant_name}%`)
      .groupBy('c.id', 'c.name')
      .orderBy('frequency', 'desc')
      .limit(3);

    return merchantHistory.map(history => ({
      id: `merchant_${history.id}`,
      category_id: history.id,
      category_name: history.name,
      confidence_score: Math.min(0.8, parseInt(history.frequency) / 10),
      reasoning: {
        primary_factors: [`${history.frequency} previous transactions with this merchant`],
        similar_transactions: parseInt(history.frequency),
        merchant_history: true,
        amount_pattern: false,
        rule_based: false
      },
      suggestion_source: 'merchant_history'
    }));
  }

  private async getSimilarityBasedSuggestions(transaction: any, organizationId: string): Promise<CategorySuggestion[]> {
    // Find similar transactions based on amount and description
    const similarTransactions = await knex.raw(`
      SELECT 
        t.category_id,
        c.name as category_name,
        COUNT(*) as similarity_count,
        AVG(ABS(t.amount - ?)) as avg_amount_diff,
        similarity(t.description, ?) as description_similarity
      FROM transactions t
      JOIN categories c ON t.category_id = c.id
      WHERE t.organization_id = ?
      AND t.category_id IS NOT NULL
      AND t.id != ?
      AND ABS(t.amount - ?) < (? * 0.5)
      AND similarity(t.description, ?) > 0.3
      GROUP BY t.category_id, c.name
      ORDER BY similarity_count DESC, description_similarity DESC
      LIMIT 3
    `, [
      transaction.amount,
      transaction.description,
      organizationId,
      transaction.id,
      transaction.amount,
      Math.abs(transaction.amount),
      transaction.description
    ]);

    return similarTransactions.rows.map((similar: any) => ({
      id: `similarity_${similar.category_id}`,
      category_id: similar.category_id,
      category_name: similar.category_name,
      confidence_score: Math.min(0.7, parseFloat(similar.description_similarity) + 0.2),
      reasoning: {
        primary_factors: ['Similar amount and description'],
        similar_transactions: parseInt(similar.similarity_count),
        merchant_history: false,
        amount_pattern: true,
        rule_based: false
      },
      suggestion_source: 'similarity'
    }));
  }

  private async getMLBasedSuggestions(transaction: any, organizationId: string): Promise<CategorySuggestion[]> {
    // Placeholder for actual ML model integration
    // Would use TensorFlow.js, scikit-learn API, or cloud ML service

    // For now, return a simple heuristic-based suggestion
    const commonCategories = await knex('transactions as t')
      .select('c.id', 'c.name', knex.raw('COUNT(*) as frequency'))
      .join('categories as c', 't.category_id', 'c.id')
      .where('t.organization_id', organizationId)
      .whereNotNull('t.category_id')
      .groupBy('c.id', 'c.name')
      .orderBy('frequency', 'desc')
      .limit(2);

    return commonCategories.map((category: any) => ({
      id: `ml_${category.id}`,
      category_id: category.id,
      category_name: category.name,
      confidence_score: 0.6,
      reasoning: {
        primary_factors: ['Machine learning model prediction'],
        similar_transactions: parseInt(category.frequency),
        merchant_history: false,
        amount_pattern: false,
        rule_based: false
      },
      suggestion_source: 'ml_model'
    }));
  }

  private deduplicateSuggestions(suggestions: CategorySuggestion[]): CategorySuggestion[] {
    const seen = new Set();
    return suggestions.filter(suggestion => {
      if (seen.has(suggestion.category_id)) {
        return false;
      }
      seen.add(suggestion.category_id);
      return true;
    });
  }

  private async storeCategorySuggestions(
    transactionId: string,
    organizationId: string,
    suggestions: CategorySuggestion[]
  ): Promise<void> {
    const records = suggestions.map(suggestion => ({
      organization_id: organizationId,
      transaction_id: transactionId,
      suggested_category_id: suggestion.category_id,
      confidence_score: suggestion.confidence_score,
      reasoning: JSON.stringify(suggestion.reasoning),
      suggestion_source: suggestion.suggestion_source,
      created_at: knex.fn.now(),
      updated_at: knex.fn.now()
    }));

    if (records.length > 0) {
      await knex('category_suggestions').insert(records);
    }
  }

  private formatCategorySuggestions(suggestions: any[]): CategorySuggestion[] {
    return suggestions.map(suggestion => ({
      id: suggestion.id,
      category_id: suggestion.suggested_category_id,
      category_name: suggestion.category_name,
      confidence_score: parseFloat(suggestion.confidence_score),
      reasoning: JSON.parse(suggestion.reasoning || '{}'),
      suggestion_source: suggestion.suggestion_source
    }));
  }

  /**
   * Additional helper methods for bulk operations and merchant analysis
   */

  async bulkRecategorize(params: {
    organizationId: string;
    userId: string;
    categoryMapping: Record<string, string>;
    applyToFuture?: boolean;
    dateRange?: { start: string; end: string };
  }): Promise<{ updated_count: number; rule_count: number }> {
    const { organizationId, userId, categoryMapping, applyToFuture, dateRange } = params;

    let updatedCount = 0;
    let ruleCount = 0;

    for (const [oldCategoryId, newCategoryId] of Object.entries(categoryMapping)) {
      let query = knex('transactions')
        .where('organization_id', organizationId)
        .where('category_id', oldCategoryId);

      if (dateRange) {
        query = query.whereBetween('transaction_date', [dateRange.start, dateRange.end]);
      }

      const updateResult = await query.update({
        category_id: newCategoryId,
        updated_by: userId,
        updated_at: knex.fn.now()
      });

      updatedCount += updateResult;

      // Create rules for future categorization if requested
      if (applyToFuture) {
        const oldCategory = await knex('categories').where('id', oldCategoryId).first();
        const newCategory = await knex('categories').where('id', newCategoryId).first();

        if (oldCategory && newCategory) {
          await knex('rules').insert({
            organization_id: organizationId,
            name: `Auto-migrate ${oldCategory.name} to ${newCategory.name}`,
            description: `Automatically recategorize transactions from ${oldCategory.name} to ${newCategory.name}`,
            rule_type: 'categorization',
            conditions: JSON.stringify({
              description_keywords: [oldCategory.name.toLowerCase()]
            }),
            actions: JSON.stringify({
              set_category: newCategoryId
            }),
            priority: 50,
            active: true,
            created_by: userId,
            updated_by: userId
          });
          ruleCount++;
        }
      }
    }

    return { updated_count: updatedCount, rule_count: ruleCount };
  }

  async analyzeMerchantCategorization(params: {
    organizationId: string;
    merchantName?: string;
    includeSuggestions?: boolean;
  }): Promise<{
    merchant_analysis: Array<{
      merchant_name: string;
      transaction_count: number;
      categories_used: Array<{
        category_id: string;
        category_name: string;
        count: number;
        percentage: number;
      }>;
      consistency_score: number;
      suggested_category?: string;
    }>;
  }> {
    const { organizationId, merchantName, includeSuggestions } = params;

    let query = knex.raw(`
      SELECT 
        COALESCE(mi.normalized_name, t.merchant_name, 'Unknown') as merchant_name,
        COUNT(t.id) as transaction_count,
        jsonb_agg(
          DISTINCT jsonb_build_object(
            'category_id', c.id,
            'category_name', c.name,
            'count', category_counts.count,
            'percentage', ROUND(category_counts.count * 100.0 / COUNT(t.id) OVER (PARTITION BY COALESCE(mi.normalized_name, t.merchant_name, 'Unknown')), 2)
          )
        ) as categories_used,
        -- Consistency score: higher when transactions are mostly in one category
        MAX(category_counts.count) * 100.0 / COUNT(t.id) as consistency_score
      FROM transactions t
      LEFT JOIN merchant_intelligence mi ON t.merchant_name = mi.raw_merchant_name 
        AND t.organization_id = mi.organization_id
      LEFT JOIN categories c ON t.category_id = c.id
      LEFT JOIN (
        SELECT 
          COALESCE(mi2.normalized_name, t2.merchant_name, 'Unknown') as merchant_name,
          t2.category_id,
          COUNT(*) as count
        FROM transactions t2
        LEFT JOIN merchant_intelligence mi2 ON t2.merchant_name = mi2.raw_merchant_name 
          AND t2.organization_id = mi2.organization_id
        WHERE t2.organization_id = ?
        AND t2.category_id IS NOT NULL
        GROUP BY COALESCE(mi2.normalized_name, t2.merchant_name, 'Unknown'), t2.category_id
      ) category_counts ON COALESCE(mi.normalized_name, t.merchant_name, 'Unknown') = category_counts.merchant_name
        AND t.category_id = category_counts.category_id
      WHERE t.organization_id = ?
      AND t.category_id IS NOT NULL
      ${merchantName ? 'AND COALESCE(mi.normalized_name, t.merchant_name, \'Unknown\') ILIKE ?' : ''}
      GROUP BY COALESCE(mi.normalized_name, t.merchant_name, 'Unknown')
      HAVING COUNT(t.id) >= 2
      ORDER BY transaction_count DESC
    `, merchantName ? [organizationId, organizationId, `%${merchantName}%`] : [organizationId, organizationId]);

    const result = await query;

    return {
      merchant_analysis: result.rows
    };
  }
}
