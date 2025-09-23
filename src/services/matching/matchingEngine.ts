/**
 * Intelligent Matching Engine Core
 * Connects receipts to bank/card transactions using multiple criteria
 */

import { 
  MatchingTransaction, 
  MatchingReceipt, 
  MatchCandidate, 
  MatchingConfig,
  MatchCriteria,
  AmountMatch,
  DateMatch,
  MerchantMatch,
  LocationMatch,
  UserMatch,
  CurrencyMatch,
  MatchSuggestion,
  MatchResult
} from './types.js';
import { MerchantMatcher } from './merchantMatcher.js';
import { LocationMatcher } from './locationMatcher.js';
import { LearningEngine } from './learningEngine.js';
import { logger } from '../../utils/logger.js';

export class MatchingEngine {
  private config: MatchingConfig;
  private merchantMatcher: MerchantMatcher;
  private locationMatcher: LocationMatcher;
  private learningEngine: LearningEngine;

  constructor(config?: Partial<MatchingConfig>) {
    this.config = {
      amount_tolerance_percentage: 0.05, // 5%
      amount_tolerance_fixed: 1.00, // $1.00
      date_window_days: 7,
      merchant_similarity_threshold: 0.7,
      location_radius_km: 5.0,
      auto_match_threshold: 0.85,
      suggest_threshold: 0.5,
      confidence_weights: {
        amount: 0.35,
        date: 0.20,
        merchant: 0.25,
        location: 0.10,
        user: 0.05,
        currency: 0.05
      },
      max_candidates: 10,
      enable_learning: true,
      ...config
    };

    this.merchantMatcher = new MerchantMatcher();
    this.locationMatcher = new LocationMatcher();
    this.learningEngine = new LearningEngine();
  }

  /**
   * Find matching candidates for a transaction
   */
  async findMatchCandidates(
    transaction: MatchingTransaction,
    receipts: MatchingReceipt[]
  ): Promise<MatchCandidate[]> {
    const startTime = Date.now();
    const candidates: MatchCandidate[] = [];

    logger.info(`Finding match candidates for transaction ${transaction.id}`, {
      transaction_id: transaction.id,
      amount: transaction.amount,
      receipts_count: receipts.length
    });

    for (const receipt of receipts) {
      try {
        const candidate = await this.evaluateMatch(transaction, receipt);
        if (candidate.confidence_score >= this.config.suggest_threshold) {
          candidates.push(candidate);
        }
      } catch (error) {
        logger.warn(`Error evaluating match between transaction ${transaction.id} and receipt ${receipt.id}`, {
          error: error instanceof Error ? error.message : String(error),
          transaction_id: transaction.id,
          receipt_id: receipt.id
        });
      }
    }

    // Sort by confidence score (highest first)
    candidates.sort((a, b) => b.confidence_score - a.confidence_score);

    // Limit results
    const limitedCandidates = candidates.slice(0, this.config.max_candidates);

    const processingTime = Date.now() - startTime;
    logger.info(`Match candidate search completed`, {
      transaction_id: transaction.id,
      candidates_found: limitedCandidates.length,
      processing_time_ms: processingTime
    });

    return limitedCandidates;
  }

  /**
   * Find matching candidates for a receipt
   */
  async findTransactionCandidates(
    receipt: MatchingReceipt,
    transactions: MatchingTransaction[]
  ): Promise<MatchCandidate[]> {
    const startTime = Date.now();
    const candidates: MatchCandidate[] = [];

    logger.info(`Finding transaction candidates for receipt ${receipt.id}`, {
      receipt_id: receipt.id,
      amount: receipt.total_amount,
      transactions_count: transactions.length
    });

    for (const transaction of transactions) {
      try {
        const candidate = await this.evaluateMatch(transaction, receipt);
        if (candidate.confidence_score >= this.config.suggest_threshold) {
          candidates.push(candidate);
        }
      } catch (error) {
        logger.warn(`Error evaluating match between transaction ${transaction.id} and receipt ${receipt.id}`, {
          error: error instanceof Error ? error.message : String(error),
          transaction_id: transaction.id,
          receipt_id: receipt.id
        });
      }
    }

    // Sort by confidence score (highest first)
    candidates.sort((a, b) => b.confidence_score - a.confidence_score);

    // Limit results
    const limitedCandidates = candidates.slice(0, this.config.max_candidates);

    const processingTime = Date.now() - startTime;
    logger.info(`Transaction candidate search completed`, {
      receipt_id: receipt.id,
      candidates_found: limitedCandidates.length,
      processing_time_ms: processingTime
    });

    return limitedCandidates;
  }

  /**
   * Evaluate a potential match between transaction and receipt
   */
  private async evaluateMatch(
    transaction: MatchingTransaction,
    receipt: MatchingReceipt
  ): Promise<MatchCandidate> {
    const criteria: MatchCriteria = {
      amount_match: this.evaluateAmountMatch(transaction, receipt),
      date_match: this.evaluateDateMatch(transaction, receipt),
      merchant_match: await this.evaluateMerchantMatch(transaction, receipt),
      location_match: this.evaluateLocationMatch(transaction, receipt),
      user_match: this.evaluateUserMatch(transaction, receipt),
      currency_match: this.evaluateCurrencyMatch(transaction, receipt)
    };

    const confidence_score = this.calculateConfidenceScore(criteria);
    const { reasoning, warnings } = this.generateReasoningAndWarnings(criteria, transaction, receipt);

    return {
      transaction_id: transaction.id,
      receipt_id: receipt.id,
      confidence_score,
      match_criteria: criteria,
      reasoning,
      warnings
    };
  }

  /**
   * Evaluate amount matching with tolerance
   */
  private evaluateAmountMatch(transaction: MatchingTransaction, receipt: MatchingReceipt): AmountMatch {
    const transactionAmount = Math.abs(transaction.amount);
    const receiptAmount = receipt.total_amount;
    const difference = Math.abs(transactionAmount - receiptAmount);
    const differencePercentage = receiptAmount > 0 ? difference / receiptAmount : 1;
    
    const percentageTolerance = receiptAmount * this.config.amount_tolerance_percentage;
    const tolerance = Math.max(percentageTolerance, this.config.amount_tolerance_fixed);
    
    const matched = difference <= tolerance;
    
    // Score based on how close the amounts are
    let score = 0;
    if (matched) {
      if (difference === 0) {
        score = 1.0;
      } else {
        score = Math.max(0, 1 - (difference / tolerance));
      }
    }

    return {
      matched,
      transaction_amount: transactionAmount,
      receipt_amount: receiptAmount,
      difference,
      difference_percentage: differencePercentage,
      tolerance_applied: tolerance,
      score
    };
  }

  /**
   * Evaluate date proximity matching
   */
  private evaluateDateMatch(transaction: MatchingTransaction, receipt: MatchingReceipt): DateMatch {
    const transactionDate = new Date(transaction.transaction_date);
    const receiptDate = new Date(receipt.receipt_date);
    
    const timeDiff = Math.abs(transactionDate.getTime() - receiptDate.getTime());
    const daysDifference = Math.ceil(timeDiff / (1000 * 60 * 60 * 24));
    
    const matched = daysDifference <= this.config.date_window_days;
    
    // Score based on proximity - closer dates get higher scores
    let score = 0;
    if (matched) {
      if (daysDifference === 0) {
        score = 1.0;
      } else {
        score = Math.max(0, 1 - (daysDifference / this.config.date_window_days));
      }
    }

    return {
      matched,
      transaction_date: transactionDate,
      receipt_date: receiptDate,
      days_difference: daysDifference,
      score
    };
  }

  /**
   * Evaluate merchant name matching with fuzzy logic
   */
  private async evaluateMerchantMatch(
    transaction: MatchingTransaction,
    receipt: MatchingReceipt
  ): Promise<MerchantMatch> {
    const transactionMerchant = transaction.merchant_name || transaction.description || '';
    const receiptMerchant = receipt.merchant_name || '';
    
    if (!transactionMerchant || !receiptMerchant) {
      return {
        matched: false,
        transaction_merchant: transactionMerchant,
        receipt_merchant: receiptMerchant,
        similarity_score: 0,
        score: 0
      };
    }

    const result = await this.merchantMatcher.compareNames(
      transactionMerchant,
      receiptMerchant,
      transaction.organization_id
    );

    const matched = result.similarity >= this.config.merchant_similarity_threshold;

    return {
      matched,
      transaction_merchant: transactionMerchant,
      receipt_merchant: receiptMerchant,
      similarity_score: result.similarity,
      canonical_name: result.canonical_name,
      score: matched ? result.similarity : 0
    };
  }

  /**
   * Evaluate location-based matching
   */
  private evaluateLocationMatch(
    transaction: MatchingTransaction,
    receipt: MatchingReceipt
  ): LocationMatch | undefined {
    if (!transaction.location || !receipt.location) {
      return undefined;
    }

    const distance = this.locationMatcher.calculateDistance(
      transaction.location,
      receipt.location
    );

    const matched = distance <= this.config.location_radius_km;
    const sameAddress = this.locationMatcher.compareAddresses(
      transaction.location.address,
      receipt.location.address
    );

    let score = 0;
    if (matched) {
      score = Math.max(0, 1 - (distance / this.config.location_radius_km));
    }
    if (sameAddress) {
      score = Math.max(score, 0.8); // Boost score for same address
    }

    return {
      matched: matched || sameAddress,
      distance_km: distance,
      same_address: sameAddress,
      score
    };
  }

  /**
   * Evaluate user/cardholder correlation
   */
  private evaluateUserMatch(transaction: MatchingTransaction, receipt: MatchingReceipt): UserMatch {
    const matched = transaction.user_id === receipt.uploaded_by;
    
    return {
      matched,
      transaction_user: transaction.user_id,
      receipt_user: receipt.uploaded_by,
      score: matched ? 1.0 : 0.0
    };
  }

  /**
   * Evaluate currency matching
   */
  private evaluateCurrencyMatch(transaction: MatchingTransaction, receipt: MatchingReceipt): CurrencyMatch {
    const transactionCurrency = transaction.currency || 'USD';
    const receiptCurrency = receipt.currency || 'USD';
    const matched = transactionCurrency === receiptCurrency;
    
    return {
      matched,
      transaction_currency: transactionCurrency,
      receipt_currency: receiptCurrency,
      score: matched ? 1.0 : 0.0
    };
  }

  /**
   * Calculate overall confidence score using weighted criteria
   */
  private calculateConfidenceScore(criteria: MatchCriteria): number {
    const weights = this.config.confidence_weights;
    let totalWeight = 0;
    let weightedScore = 0;

    // Amount matching is always available
    weightedScore += criteria.amount_match.score * weights.amount;
    totalWeight += weights.amount;

    // Date matching is always available
    weightedScore += criteria.date_match.score * weights.date;
    totalWeight += weights.date;

    // Merchant matching is always attempted
    weightedScore += criteria.merchant_match.score * weights.merchant;
    totalWeight += weights.merchant;

    // Location matching is optional
    if (criteria.location_match) {
      weightedScore += criteria.location_match.score * weights.location;
      totalWeight += weights.location;
    }

    // User matching is always available
    weightedScore += criteria.user_match.score * weights.user;
    totalWeight += weights.user;

    // Currency matching is always available
    weightedScore += criteria.currency_match.score * weights.currency;
    totalWeight += weights.currency;

    // Normalize by actual total weight used
    return totalWeight > 0 ? Math.min(1.0, weightedScore / totalWeight) : 0;
  }

  /**
   * Generate human-readable reasoning and warnings
   */
  private generateReasoningAndWarnings(
    criteria: MatchCriteria,
    transaction: MatchingTransaction,
    receipt: MatchingReceipt
  ): { reasoning: string[]; warnings: string[] } {
    const reasoning: string[] = [];
    const warnings: string[] = [];

    // Amount reasoning
    if (criteria.amount_match.matched) {
      if (criteria.amount_match.difference === 0) {
        reasoning.push('Exact amount match');
      } else {
        reasoning.push(`Amount close match (${criteria.amount_match.difference_percentage.toFixed(1)}% difference)`);
      }
    } else {
      warnings.push(`Amount mismatch: $${criteria.amount_match.transaction_amount} vs $${criteria.amount_match.receipt_amount}`);
    }

    // Date reasoning
    if (criteria.date_match.matched) {
      if (criteria.date_match.days_difference === 0) {
        reasoning.push('Same date');
      } else {
        reasoning.push(`${criteria.date_match.days_difference} day${criteria.date_match.days_difference > 1 ? 's' : ''} apart`);
      }
    } else {
      warnings.push(`Date too far apart: ${criteria.date_match.days_difference} days`);
    }

    // Merchant reasoning
    if (criteria.merchant_match.matched) {
      reasoning.push(`Merchant match (${(criteria.merchant_match.similarity_score * 100).toFixed(0)}% similar)`);
      if (criteria.merchant_match.canonical_name) {
        reasoning.push(`Canonical name: ${criteria.merchant_match.canonical_name}`);
      }
    } else {
      warnings.push('Merchant names don\'t match well');
    }

    // Location reasoning
    if (criteria.location_match) {
      if (criteria.location_match.same_address) {
        reasoning.push('Same address');
      } else if (criteria.location_match.matched) {
        reasoning.push(`Within ${criteria.location_match.distance_km?.toFixed(1)}km`);
      } else {
        warnings.push(`Too far apart: ${criteria.location_match.distance_km?.toFixed(1)}km`);
      }
    }

    // User reasoning
    if (criteria.user_match.matched) {
      reasoning.push('Same user');
    } else {
      warnings.push('Different users');
    }

    // Currency reasoning
    if (!criteria.currency_match.matched) {
      warnings.push(`Currency mismatch: ${criteria.currency_match.transaction_currency} vs ${criteria.currency_match.receipt_currency}`);
    }

    return { reasoning, warnings };
  }

  /**
   * Determine match type based on confidence score
   */
  getMatchType(confidenceScore: number): 'auto' | 'suggested' | 'manual' {
    if (confidenceScore >= this.config.auto_match_threshold) {
      return 'auto';
    } else if (confidenceScore >= this.config.suggest_threshold) {
      return 'suggested';
    } else {
      return 'manual';
    }
  }

  /**
   * Update configuration with learned parameters
   */
  updateConfig(newConfig: Partial<MatchingConfig>): void {
    this.config = { ...this.config, ...newConfig };
    logger.info('Matching engine configuration updated', { config: newConfig });
  }

  /**
   * Get current configuration
   */
  getConfig(): MatchingConfig {
    return { ...this.config };
  }
}
