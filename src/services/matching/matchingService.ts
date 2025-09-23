/**
 * Main Matching Service
 * Orchestrates the intelligent matching engine and provides the public API
 */

import { 
  MatchingTransaction, 
  MatchingReceipt, 
  MatchCandidate, 
  MatchSuggestion,
  MatchResult,
  MatchingConfig,
  LearningFeedback,
  MatchingMetrics
} from './types.js';
import { MatchingEngine } from './matchingEngine.js';
import { LearningEngine } from './learningEngine.js';
import { logger } from '../../utils/logger.js';

export class MatchingService {
  private engines: Map<string, MatchingEngine> = new Map();
  private learningEngine: LearningEngine;

  constructor() {
    this.learningEngine = new LearningEngine();
  }

  /**
   * Get or create matching engine for organization
   */
  private getEngine(organizationId: string, config?: Partial<MatchingConfig>): MatchingEngine {
    let engine = this.engines.get(organizationId);
    if (!engine) {
      engine = new MatchingEngine(config);
      this.engines.set(organizationId, engine);
    } else if (config) {
      engine.updateConfig(config);
    }
    return engine;
  }

  /**
   * Automatic matching for new transactions/receipts
   */
  async performAutoMatching(
    organizationId: string,
    transactions: MatchingTransaction[],
    receipts: MatchingReceipt[],
    config?: Partial<MatchingConfig>
  ): Promise<MatchSuggestion> {
    const startTime = Date.now();
    const engine = this.getEngine(organizationId, config);

    logger.info('Starting automatic matching', {
      organization_id: organizationId,
      transactions_count: transactions.length,
      receipts_count: receipts.length
    });

    const allCandidates: MatchCandidate[] = [];
    const processedTransactions = new Set<string>();
    const processedReceipts = new Set<string>();

    // Find candidates for each transaction
    for (const transaction of transactions) {
      try {
        // Filter receipts that haven't been processed yet
        const availableReceipts = receipts.filter(r => !processedReceipts.has(r.id));
        
        const candidates = await engine.findMatchCandidates(transaction, availableReceipts);
        
        // Check for auto-match (high confidence)
        const autoMatch = candidates.find(c => c.confidence_score >= engine.getConfig().auto_match_threshold);
        
        if (autoMatch) {
          allCandidates.push(autoMatch);
          processedTransactions.add(transaction.id);
          processedReceipts.add(autoMatch.receipt_id);
          
          logger.info('Auto-match found', {
            transaction_id: transaction.id,
            receipt_id: autoMatch.receipt_id,
            confidence: autoMatch.confidence_score
          });
        } else {
          // Add best suggestion if above threshold
          const bestCandidate = candidates[0];
          if (bestCandidate && bestCandidate.confidence_score >= engine.getConfig().suggest_threshold) {
            allCandidates.push(bestCandidate);
          }
        }
      } catch (error) {
        logger.error('Error in auto matching for transaction', {
          transaction_id: transaction.id,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    // Find unmatched items
    const unmatchedTransactions = transactions
      .filter(t => !processedTransactions.has(t.id))
      .map(t => t.id);
    
    const unmatchedReceipts = receipts
      .filter(r => !processedReceipts.has(r.id))
      .map(r => r.id);

    const processingTime = Date.now() - startTime;
    const autoMatches = allCandidates.filter(c => c.confidence_score >= engine.getConfig().auto_match_threshold);
    const suggestions = allCandidates.filter(c => 
      c.confidence_score >= engine.getConfig().suggest_threshold && 
      c.confidence_score < engine.getConfig().auto_match_threshold
    );

    const result: MatchSuggestion = {
      candidates: allCandidates,
      unmatched_transactions: unmatchedTransactions,
      unmatched_receipts: unmatchedReceipts,
      processing_stats: {
        transactions_processed: transactions.length,
        receipts_processed: receipts.length,
        matches_found: allCandidates.length,
        auto_matches: autoMatches.length,
        suggestions: suggestions.length,
        processing_time_ms: processingTime
      }
    };

    logger.info('Auto-matching completed', {
      organization_id: organizationId,
      ...result.processing_stats
    });

    return result;
  }

  /**
   * Get match suggestions for a specific item
   */
  async getMatchSuggestions(
    organizationId: string,
    itemId: string,
    itemType: 'transaction' | 'receipt',
    candidates: MatchingTransaction[] | MatchingReceipt[],
    config?: Partial<MatchingConfig>
  ): Promise<MatchCandidate[]> {
    const engine = this.getEngine(organizationId, config);

    logger.info('Getting match suggestions', {
      organization_id: organizationId,
      item_id: itemId,
      item_type: itemType,
      candidates_count: candidates.length
    });

    try {
      if (itemType === 'transaction') {
        const transaction = candidates.find(c => c.id === itemId) as MatchingTransaction;
        if (!transaction) {
          throw new Error('Transaction not found');
        }
        const receipts = candidates.filter(c => c.id !== itemId) as MatchingReceipt[];
        return await engine.findMatchCandidates(transaction, receipts);
      } else {
        const receipt = candidates.find(c => c.id === itemId) as MatchingReceipt;
        if (!receipt) {
          throw new Error('Receipt not found');
        }
        const transactions = candidates.filter(c => c.id !== itemId) as MatchingTransaction[];
        return await engine.findTransactionCandidates(receipt, transactions);
      }
    } catch (error) {
      logger.error('Error getting match suggestions', {
        organization_id: organizationId,
        item_id: itemId,
        item_type: itemType,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Confirm a match (user accepts suggestion or creates manual match)
   */
  async confirmMatch(
    organizationId: string,
    transactionId: string,
    receiptId: string,
    matchType: 'auto' | 'manual' | 'reviewed',
    userId: string,
    confidence?: number,
    notes?: string
  ): Promise<MatchResult> {
    logger.info('Confirming match', {
      organization_id: organizationId,
      transaction_id: transactionId,
      receipt_id: receiptId,
      match_type: matchType,
      user_id: userId
    });

    // In a real implementation, this would save to database
    const result: MatchResult = {
      match_id: `match-${transactionId}-${receiptId}-${Date.now()}`,
      transaction_id: transactionId,
      receipt_id: receiptId,
      match_type: matchType,
      confidence_score: confidence || 1.0,
      match_criteria: {} as any, // Would be populated from the original matching
      created_at: new Date(),
      matched_by: userId,
      notes
    };

    // Record positive feedback for learning
    await this.learningEngine.recordFeedback({
      match_id: result.match_id!,
      was_correct: true,
      user_id: userId,
      feedback_date: new Date(),
      notes: `User confirmed match: ${matchType}`
    });

    return result;
  }

  /**
   * Reject match suggestions (user disagrees)
   */
  async rejectMatch(
    organizationId: string,
    transactionId: string,
    receiptId: string,
    userId: string,
    reason?: string,
    correctTransactionId?: string,
    correctReceiptId?: string
  ): Promise<void> {
    logger.info('Rejecting match', {
      organization_id: organizationId,
      transaction_id: transactionId,
      receipt_id: receiptId,
      user_id: userId,
      reason,
      has_correction: !!(correctTransactionId || correctReceiptId)
    });

    // Record negative feedback for learning
    const feedback: LearningFeedback = {
      match_id: `rejected-${transactionId}-${receiptId}`,
      was_correct: false,
      user_id: userId,
      feedback_date: new Date(),
      notes: reason
    };

    if (correctTransactionId || correctReceiptId) {
      feedback.user_correction = {
        correct_transaction_id: correctTransactionId,
        correct_receipt_id: correctReceiptId
      };
    }

    await this.learningEngine.recordFeedback(feedback);
  }

  /**
   * Get unmatched items for an organization
   */
  async getUnmatchedItems(organizationId: string): Promise<{
    transactions: MatchingTransaction[];
    receipts: MatchingReceipt[];
  }> {
    // In a real implementation, this would query the database
    // for transactions and receipts without active matches
    
    logger.info('Getting unmatched items', { organization_id: organizationId });

    // Placeholder return - would be actual database query
    return {
      transactions: [],
      receipts: []
    };
  }

  /**
   * Bulk matching operation for large datasets
   */
  async performBulkMatching(
    organizationId: string,
    batchSize: number = 100,
    config?: Partial<MatchingConfig>
  ): Promise<{
    total_processed: number;
    matches_created: number;
    processing_time_ms: number;
    errors: string[];
  }> {
    const startTime = Date.now();
    let totalProcessed = 0;
    let matchesCreated = 0;
    const errors: string[] = [];

    logger.info('Starting bulk matching', {
      organization_id: organizationId,
      batch_size: batchSize
    });

    try {
      // Get unmatched items in batches
      const { transactions, receipts } = await this.getUnmatchedItems(organizationId);
      
      for (let i = 0; i < transactions.length; i += batchSize) {
        const transactionBatch = transactions.slice(i, i + batchSize);
        const receiptBatch = receipts.slice(0, batchSize * 2); // More receipts for better matching
        
        try {
          const suggestions = await this.performAutoMatching(
            organizationId,
            transactionBatch,
            receiptBatch,
            config
          );

          // Auto-confirm high-confidence matches
          const autoMatches = suggestions.candidates.filter(c => 
            c.confidence_score >= (config?.auto_match_threshold || 0.85)
          );

          for (const match of autoMatches) {
            await this.confirmMatch(
              organizationId,
              match.transaction_id,
              match.receipt_id,
              'auto',
              'system',
              match.confidence_score
            );
            matchesCreated++;
          }

          totalProcessed += transactionBatch.length;
        } catch (error) {
          const errorMsg = `Batch ${i}-${i + batchSize}: ${error instanceof Error ? error.message : String(error)}`;
          errors.push(errorMsg);
          logger.error('Bulk matching batch error', { error: errorMsg });
        }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      errors.push(`Bulk matching failed: ${errorMsg}`);
      logger.error('Bulk matching error', { error: errorMsg });
    }

    const processingTime = Date.now() - startTime;

    logger.info('Bulk matching completed', {
      organization_id: organizationId,
      total_processed: totalProcessed,
      matches_created: matchesCreated,
      processing_time_ms: processingTime,
      error_count: errors.length
    });

    return {
      total_processed: totalProcessed,
      matches_created: matchesCreated,
      processing_time_ms: processingTime,
      errors
    };
  }

  /**
   * Get matching performance metrics
   */
  async getMatchingMetrics(
    organizationId: string,
    periodDays: number = 30
  ): Promise<MatchingMetrics> {
    logger.info('Getting matching metrics', {
      organization_id: organizationId,
      period_days: periodDays
    });

    // This would query actual database metrics in production
    return await this.learningEngine.analyzeMatchingPerformance(organizationId, []);
  }

  /**
   * Update matching configuration with learning suggestions
   */
  async updateConfigWithLearning(organizationId: string): Promise<MatchingConfig> {
    const engine = this.getEngine(organizationId);
    const currentConfig = engine.getConfig();
    
    const suggestions = await this.learningEngine.getSuggestedConfig(organizationId, currentConfig);
    
    if (Object.keys(suggestions).length > 0) {
      engine.updateConfig(suggestions);
      
      logger.info('Config updated with learning suggestions', {
        organization_id: organizationId,
        suggestions
      });
    }

    return engine.getConfig();
  }

  /**
   * Get learning statistics
   */
  async getLearningStats(organizationId: string) {
    return await this.learningEngine.getLearningStats(organizationId);
  }

  /**
   * Reset matching engine for organization (useful for testing)
   */
  async resetEngine(organizationId: string): Promise<void> {
    this.engines.delete(organizationId);
    await this.learningEngine.resetLearning(organizationId);
    
    logger.info('Matching engine reset', { organization_id: organizationId });
  }
}

// Singleton instance
export const matchingService = new MatchingService();
