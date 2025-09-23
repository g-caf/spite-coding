/**
 * Learning Engine for Matching Intelligence
 * Learns from user feedback to improve matching accuracy
 */

import { 
  LearningFeedback, 
  MatchingConfig, 
  MatchingMetrics,
  MatchingRule,
  MatchCandidate 
} from './types.js';
import { logger } from '../../utils/logger.js';

interface LearningPattern {
  organization_id: string;
  pattern_type: 'merchant' | 'amount_tolerance' | 'date_window' | 'location_radius';
  pattern_data: any;
  success_rate: number;
  sample_size: number;
  last_updated: Date;
}

export class LearningEngine {
  private feedbackHistory: LearningFeedback[] = [];
  private learningPatterns: Map<string, LearningPattern[]> = new Map();
  private organizationRules: Map<string, MatchingRule[]> = new Map();

  /**
   * Record user feedback on a match
   */
  async recordFeedback(feedback: LearningFeedback): Promise<void> {
    this.feedbackHistory.push(feedback);
    
    logger.info('Learning feedback recorded', {
      match_id: feedback.match_id,
      was_correct: feedback.was_correct,
      user_id: feedback.user_id,
      has_correction: !!feedback.user_correction
    });

    // Update learning patterns based on feedback
    await this.updateLearningPatterns(feedback);
  }

  /**
   * Get suggested configuration adjustments based on learning
   */
  async getSuggestedConfig(
    organizationId: string,
    currentConfig: MatchingConfig
  ): Promise<Partial<MatchingConfig>> {
    const patterns = this.learningPatterns.get(organizationId) || [];
    const suggestions: Partial<MatchingConfig> = {};

    // Analyze amount tolerance patterns
    const amountPatterns = patterns.filter(p => p.pattern_type === 'amount_tolerance');
    if (amountPatterns.length > 0) {
      const avgTolerance = amountPatterns.reduce((sum, p) => sum + p.pattern_data.optimal_tolerance, 0) / amountPatterns.length;
      if (Math.abs(avgTolerance - currentConfig.amount_tolerance_percentage) > 0.01) {
        suggestions.amount_tolerance_percentage = avgTolerance;
      }
    }

    // Analyze date window patterns
    const datePatterns = patterns.filter(p => p.pattern_type === 'date_window');
    if (datePatterns.length > 0) {
      const avgWindow = datePatterns.reduce((sum, p) => sum + p.pattern_data.optimal_days, 0) / datePatterns.length;
      if (Math.abs(avgWindow - currentConfig.date_window_days) > 1) {
        suggestions.date_window_days = Math.round(avgWindow);
      }
    }

    // Analyze weight adjustments based on what criteria users correct most
    const weightSuggestions = this.analyzeWeightAdjustments(organizationId, currentConfig);
    if (Object.keys(weightSuggestions).length > 0) {
      suggestions.confidence_weights = {
        ...currentConfig.confidence_weights,
        ...weightSuggestions
      };
    }

    logger.info('Config suggestions generated', {
      organization_id: organizationId,
      suggestions_count: Object.keys(suggestions).length,
      suggestions
    });

    return suggestions;
  }

  /**
   * Create organization-specific rules from learned patterns
   */
  async generateMatchingRules(organizationId: string): Promise<MatchingRule[]> {
    const patterns = this.learningPatterns.get(organizationId) || [];
    const rules: MatchingRule[] = [];

    // Generate merchant-specific rules
    const merchantPatterns = patterns.filter(p => p.pattern_type === 'merchant');
    for (const pattern of merchantPatterns) {
      if (pattern.success_rate > 0.8 && pattern.sample_size >= 5) {
        const rule: MatchingRule = {
          id: `rule-merchant-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          organization_id: organizationId,
          name: `Auto-match for ${pattern.pattern_data.canonical_name}`,
          conditions: {
            merchant_patterns: pattern.pattern_data.name_variations,
            amount_range: pattern.pattern_data.typical_amount_range
          },
          actions: {
            set_merchant: pattern.pattern_data.canonical_name,
            auto_approve: pattern.success_rate > 0.95
          },
          priority: 100,
          active: true,
          match_count: pattern.sample_size,
          success_rate: pattern.success_rate,
          created_by: 'learning_engine',
          updated_at: new Date()
        };
        rules.push(rule);
      }
    }

    return rules;
  }

  /**
   * Analyze match candidates and suggest improvements
   */
  async analyzeMatchingPerformance(
    organizationId: string,
    recentMatches: MatchCandidate[]
  ): Promise<MatchingMetrics> {
    const feedback = this.feedbackHistory.filter(f => 
      recentMatches.some(m => m.transaction_id === f.match_id.split('-')[0] || 
                              m.receipt_id === f.match_id.split('-')[1])
    );

    const totalMatches = recentMatches.length;
    const correctMatches = feedback.filter(f => f.was_correct).length;
    const incorrectMatches = feedback.filter(f => !f.was_correct).length;

    const metrics: MatchingMetrics = {
      organization_id: organizationId,
      period_start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
      period_end: new Date(),
      total_transactions: totalMatches,
      total_receipts: totalMatches,
      auto_matched: recentMatches.filter(m => m.confidence_score > 0.85).length,
      manual_matched: recentMatches.filter(m => m.confidence_score <= 0.5).length,
      unmatched_transactions: 0, // Would come from database in real implementation
      unmatched_receipts: 0,
      average_confidence: totalMatches > 0 
        ? recentMatches.reduce((sum, m) => sum + m.confidence_score, 0) / totalMatches 
        : 0,
      accuracy_rate: feedback.length > 0 ? correctMatches / feedback.length : 0,
      processing_time_avg_ms: 150, // Placeholder
      user_corrections: incorrectMatches
    };

    return metrics;
  }

  /**
   * Update learning patterns based on feedback
   */
  private async updateLearningPatterns(feedback: LearningFeedback): Promise<void> {
    // This would analyze the feedback and update patterns
    // For now, we'll create simple patterns based on corrections

    if (feedback.user_correction) {
      // Extract organization from match ID (simplified)
      const organizationId = 'placeholder-org'; // Would extract from actual match data
      
      const pattern: LearningPattern = {
        organization_id: organizationId,
        pattern_type: 'merchant',
        pattern_data: {
          correction_type: 'user_override',
          was_correct: feedback.was_correct
        },
        success_rate: feedback.was_correct ? 1.0 : 0.0,
        sample_size: 1,
        last_updated: new Date()
      };

      const patterns = this.learningPatterns.get(organizationId) || [];
      patterns.push(pattern);
      this.learningPatterns.set(organizationId, patterns);
    }
  }

  /**
   * Analyze weight adjustments based on user corrections
   */
  private analyzeWeightAdjustments(
    organizationId: string,
    currentConfig: MatchingConfig
  ): Partial<MatchingConfig['confidence_weights']> {
    const orgFeedback = this.feedbackHistory.filter(f => 
      // Would filter by organization in real implementation
      true
    );

    if (orgFeedback.length < 10) {
      return {}; // Need more data
    }

    const corrections = orgFeedback.filter(f => !f.was_correct);
    if (corrections.length === 0) {
      return {}; // No corrections needed
    }

    // Analyze what types of matches users correct most often
    const correctionPatterns = {
      amount_heavy: 0,
      merchant_heavy: 0,
      date_heavy: 0,
      location_heavy: 0
    };

    // This would analyze the actual match criteria that led to incorrect matches
    // and suggest weight adjustments accordingly

    const suggestions: Partial<MatchingConfig['confidence_weights']> = {};

    // Example: if users often correct amount-heavy matches, reduce amount weight
    if (correctionPatterns.amount_heavy > corrections.length * 0.3) {
      suggestions.amount = Math.max(0.1, currentConfig.confidence_weights.amount - 0.05);
      suggestions.merchant = Math.min(0.5, currentConfig.confidence_weights.merchant + 0.03);
    }

    return suggestions;
  }

  /**
   * Get learning statistics for an organization
   */
  async getLearningStats(organizationId: string): Promise<{
    total_feedback: number;
    accuracy_rate: number;
    patterns_learned: number;
    rules_generated: number;
    last_learning_update: Date | null;
  }> {
    const orgFeedback = this.feedbackHistory.filter(f => 
      // Would filter by organization in real implementation
      true
    );

    const patterns = this.learningPatterns.get(organizationId) || [];
    const rules = this.organizationRules.get(organizationId) || [];

    const correctFeedback = orgFeedback.filter(f => f.was_correct);
    
    return {
      total_feedback: orgFeedback.length,
      accuracy_rate: orgFeedback.length > 0 ? correctFeedback.length / orgFeedback.length : 0,
      patterns_learned: patterns.length,
      rules_generated: rules.length,
      last_learning_update: patterns.length > 0 
        ? new Date(Math.max(...patterns.map(p => p.last_updated.getTime())))
        : null
    };
  }

  /**
   * Reset learning data for an organization (useful for testing)
   */
  async resetLearning(organizationId: string): Promise<void> {
    this.learningPatterns.delete(organizationId);
    this.organizationRules.delete(organizationId);
    
    // Remove feedback for this organization
    this.feedbackHistory = this.feedbackHistory.filter(f => 
      // Would filter by organization in real implementation
      false
    );

    logger.info('Learning data reset', { organization_id: organizationId });
  }

  /**
   * Export learning data for backup/analysis
   */
  async exportLearningData(organizationId: string): Promise<{
    patterns: LearningPattern[];
    rules: MatchingRule[];
    feedback_summary: {
      total: number;
      correct: number;
      incorrect: number;
    };
  }> {
    const patterns = this.learningPatterns.get(organizationId) || [];
    const rules = this.organizationRules.get(organizationId) || [];
    const orgFeedback = this.feedbackHistory.filter(f => 
      // Would filter by organization in real implementation
      true
    );

    return {
      patterns,
      rules,
      feedback_summary: {
        total: orgFeedback.length,
        correct: orgFeedback.filter(f => f.was_correct).length,
        incorrect: orgFeedback.filter(f => !f.was_correct).length
      }
    };
  }
}
