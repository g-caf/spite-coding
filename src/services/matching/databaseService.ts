/**
 * Database Service for Matching Engine
 * Handles database operations for transactions, receipts, and matches
 */

import { Knex } from 'knex';
import { 
  MatchingTransaction, 
  MatchingReceipt, 
  MatchResult,
  LearningFeedback,
  MerchantMapping 
} from './types.js';
import { logger } from '../../utils/logger.js';

export class MatchingDatabaseService {
  constructor(private db: Knex) {}

  /**
   * Get unmatched transactions for an organization
   */
  async getUnmatchedTransactions(organizationId: string, limit = 1000): Promise<MatchingTransaction[]> {
    try {
      const transactions = await this.db('transactions')
        .leftJoin('matches', function(join) {
          join.on('transactions.id', '=', 'matches.transaction_id')
              .andOnVal('matches.active', '=', true);
        })
        .where('transactions.organization_id', organizationId)
        .whereNull('matches.id')
        .where('transactions.status', '!=', 'cancelled')
        .select([
          'transactions.id',
          'transactions.organization_id',
          'transactions.amount',
          'transactions.transaction_date',
          'transactions.posted_date',
          'transactions.description',
          'transactions.merchant_name',
          'transactions.merchant_category',
          'transactions.user_id',
          'transactions.account_id',
          'transactions.currency',
          'transactions.status',
          'transactions.metadata'
        ])
        .limit(limit)
        .orderBy('transactions.transaction_date', 'desc');

      return transactions.map(this.mapTransactionFromDb);
    } catch (error) {
      logger.error('Error fetching unmatched transactions', {
        organization_id: organizationId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Get unmatched receipts for an organization
   */
  async getUnmatchedReceipts(organizationId: string, limit = 1000): Promise<MatchingReceipt[]> {
    try {
      const receipts = await this.db('receipts')
        .leftJoin('matches', function(join) {
          join.on('receipts.id', '=', 'matches.receipt_id')
              .andOnVal('matches.active', '=', true);
        })
        .leftJoin('extracted_fields', 'receipts.id', '=', 'extracted_fields.receipt_id')
        .where('receipts.organization_id', organizationId)
        .whereNull('matches.id')
        .whereIn('receipts.status', ['processed', 'uploaded'])
        .select([
          'receipts.id',
          'receipts.organization_id',
          'receipts.total_amount',
          'receipts.currency',
          'receipts.receipt_date',
          'receipts.merchant_name',
          'receipts.merchant_id',
          'receipts.uploaded_by',
          'receipts.status',
          'receipts.metadata'
        ])
        .groupBy('receipts.id')
        .limit(limit)
        .orderBy('receipts.receipt_date', 'desc');

      // Get extracted fields for each receipt
      const receiptIds = receipts.map(r => r.id);
      const extractedFields = await this.getExtractedFields(receiptIds);

      return receipts.map(receipt => this.mapReceiptFromDb(receipt, extractedFields[receipt.id] || []));
    } catch (error) {
      logger.error('Error fetching unmatched receipts', {
        organization_id: organizationId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Get extracted fields for multiple receipts
   */
  private async getExtractedFields(receiptIds: string[]) {
    if (receiptIds.length === 0) return {};

    const fields = await this.db('extracted_fields')
      .whereIn('receipt_id', receiptIds)
      .select([
        'receipt_id',
        'field_name',
        'field_value',
        'field_type',
        'confidence_score',
        'verified'
      ]);

    const fieldsByReceipt: Record<string, any[]> = {};
    for (const field of fields) {
      if (!fieldsByReceipt[field.receipt_id]) {
        fieldsByReceipt[field.receipt_id] = [];
      }
      fieldsByReceipt[field.receipt_id].push({
        field_name: field.field_name,
        field_value: field.field_value,
        field_type: field.field_type,
        confidence_score: parseFloat(field.confidence_score),
        verified: field.verified
      });
    }

    return fieldsByReceipt;
  }

  /**
   * Save a confirmed match
   */
  async saveMatch(matchResult: MatchResult): Promise<void> {
    try {
      await this.db.transaction(async (trx) => {
        // Insert the match
        await trx('matches').insert({
          id: matchResult.match_id,
          organization_id: await this.getTransactionOrganizationId(matchResult.transaction_id, trx),
          transaction_id: matchResult.transaction_id,
          receipt_id: matchResult.receipt_id,
          match_type: matchResult.match_type,
          confidence_score: matchResult.confidence_score,
          matching_criteria: JSON.stringify(matchResult.match_criteria),
          matched_by: matchResult.matched_by,
          matched_at: matchResult.created_at,
          active: true,
          notes: matchResult.notes
        });

        // Update receipt status to matched
        await trx('receipts')
          .where('id', matchResult.receipt_id)
          .update({ 
            status: 'matched',
            updated_at: this.db.fn.now()
          });

        // Update transaction status if needed
        await trx('transactions')
          .where('id', matchResult.transaction_id)
          .update({ 
            status: 'matched',
            updated_at: this.db.fn.now()
          });
      });

      logger.info('Match saved successfully', {
        match_id: matchResult.match_id,
        transaction_id: matchResult.transaction_id,
        receipt_id: matchResult.receipt_id
      });

    } catch (error) {
      logger.error('Error saving match', {
        match_id: matchResult.match_id,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Save learning feedback
   */
  async saveLearningFeedback(feedback: LearningFeedback): Promise<void> {
    try {
      await this.db('learning_feedback').insert({
        id: `feedback-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        match_id: feedback.match_id,
        was_correct: feedback.was_correct,
        user_correction: feedback.user_correction ? JSON.stringify(feedback.user_correction) : null,
        user_id: feedback.user_id,
        feedback_date: feedback.feedback_date,
        notes: feedback.notes
      });

      logger.info('Learning feedback saved', {
        match_id: feedback.match_id,
        was_correct: feedback.was_correct,
        user_id: feedback.user_id
      });

    } catch (error) {
      logger.error('Error saving learning feedback', {
        match_id: feedback.match_id,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Get merchant mappings for an organization
   */
  async getMerchantMappings(organizationId: string): Promise<MerchantMapping[]> {
    try {
      const mappings = await this.db('merchant_mappings')
        .where('organization_id', organizationId)
        .where('active', true)
        .orderBy('usage_count', 'desc')
        .select([
          'id',
          'organization_id',
          'raw_names',
          'canonical_name',
          'category',
          'confidence',
          'created_from',
          'verified',
          'usage_count',
          'last_used'
        ]);

      return mappings.map(mapping => ({
        ...mapping,
        raw_names: JSON.parse(mapping.raw_names),
        confidence: parseFloat(mapping.confidence)
      }));

    } catch (error) {
      logger.error('Error fetching merchant mappings', {
        organization_id: organizationId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Save or update merchant mapping
   */
  async saveMerchantMapping(mapping: MerchantMapping): Promise<void> {
    try {
      await this.db('merchant_mappings')
        .insert({
          id: mapping.id,
          organization_id: mapping.organization_id,
          raw_names: JSON.stringify(mapping.raw_names),
          canonical_name: mapping.canonical_name,
          category: mapping.category,
          confidence: mapping.confidence,
          created_from: mapping.created_from,
          verified: mapping.verified,
          usage_count: mapping.usage_count,
          last_used: mapping.last_used,
          active: true
        })
        .onConflict('id')
        .merge({
          raw_names: JSON.stringify(mapping.raw_names),
          canonical_name: mapping.canonical_name,
          confidence: mapping.confidence,
          usage_count: mapping.usage_count,
          last_used: mapping.last_used,
          updated_at: this.db.fn.now()
        });

      logger.info('Merchant mapping saved', {
        mapping_id: mapping.id,
        organization_id: mapping.organization_id,
        canonical_name: mapping.canonical_name
      });

    } catch (error) {
      logger.error('Error saving merchant mapping', {
        mapping_id: mapping.id,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Get matching statistics for an organization
   */
  async getMatchingStats(organizationId: string, periodDays: number = 30): Promise<any> {
    try {
      const periodStart = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);

      const stats = await this.db.raw(`
        SELECT 
          COUNT(DISTINCT t.id) as total_transactions,
          COUNT(DISTINCT r.id) as total_receipts,
          COUNT(DISTINCT CASE WHEN m.match_type = 'auto' THEN m.id END) as auto_matched,
          COUNT(DISTINCT CASE WHEN m.match_type = 'manual' THEN m.id END) as manual_matched,
          COUNT(DISTINCT CASE WHEN m.id IS NULL AND t.id IS NOT NULL THEN t.id END) as unmatched_transactions,
          COUNT(DISTINCT CASE WHEN m.id IS NULL AND r.id IS NOT NULL THEN r.id END) as unmatched_receipts,
          AVG(m.confidence_score) as average_confidence,
          COUNT(DISTINCT lf.id) as user_corrections,
          COUNT(DISTINCT CASE WHEN lf.was_correct = true THEN lf.id END) as correct_feedback,
          COUNT(DISTINCT CASE WHEN lf.was_correct = false THEN lf.id END) as incorrect_feedback
        FROM 
          transactions t
        FULL OUTER JOIN receipts r ON t.organization_id = r.organization_id
        LEFT JOIN matches m ON (t.id = m.transaction_id OR r.id = m.receipt_id) AND m.active = true
        LEFT JOIN learning_feedback lf ON m.id = lf.match_id
        WHERE 
          (t.organization_id = ? OR r.organization_id = ?)
          AND (t.created_at >= ? OR r.created_at >= ? OR t.created_at IS NULL OR r.created_at IS NULL)
      `, [organizationId, organizationId, periodStart, periodStart]);

      return stats.rows[0] || {};

    } catch (error) {
      logger.error('Error fetching matching stats', {
        organization_id: organizationId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Get organization ID for a transaction
   */
  private async getTransactionOrganizationId(transactionId: string, trx?: Knex.Transaction): Promise<string> {
    const query = (trx || this.db)('transactions')
      .where('id', transactionId)
      .select('organization_id')
      .first();

    const result = await query;
    return result?.organization_id;
  }

  /**
   * Map database transaction to MatchingTransaction
   */
  private mapTransactionFromDb(dbTransaction: any): MatchingTransaction {
    return {
      id: dbTransaction.id,
      organization_id: dbTransaction.organization_id,
      amount: parseFloat(dbTransaction.amount),
      transaction_date: new Date(dbTransaction.transaction_date),
      posted_date: new Date(dbTransaction.posted_date || dbTransaction.transaction_date),
      description: dbTransaction.description,
      merchant_name: dbTransaction.merchant_name,
      merchant_category: dbTransaction.merchant_category,
      location: dbTransaction.metadata?.location,
      user_id: dbTransaction.user_id,
      account_id: dbTransaction.account_id,
      currency: dbTransaction.currency || 'USD',
      status: dbTransaction.status
    };
  }

  /**
   * Map database receipt to MatchingReceipt
   */
  private mapReceiptFromDb(dbReceipt: any, extractedFields: any[]): MatchingReceipt {
    return {
      id: dbReceipt.id,
      organization_id: dbReceipt.organization_id,
      total_amount: parseFloat(dbReceipt.total_amount || 0),
      currency: dbReceipt.currency || 'USD',
      receipt_date: new Date(dbReceipt.receipt_date),
      merchant_name: dbReceipt.merchant_name,
      merchant_id: dbReceipt.merchant_id,
      location: dbReceipt.metadata?.location,
      uploaded_by: dbReceipt.uploaded_by,
      status: dbReceipt.status,
      metadata: dbReceipt.metadata || {},
      extracted_fields: extractedFields
    };
  }
}
