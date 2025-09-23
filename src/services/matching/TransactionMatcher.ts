import { Knex } from 'knex';
import winston from 'winston';

interface MatchingRule {
  id: string;
  organization_id: string;
  name: string;
  rule_type: 'amount_date' | 'merchant_amount' | 'fuzzy_match' | 'custom';
  criteria: {
    amount_tolerance?: number;
    date_tolerance_days?: number;
    merchant_similarity_threshold?: number;
    custom_logic?: string;
  };
  priority: number;
  active: boolean;
}

interface Transaction {
  id: string;
  organization_id: string;
  amount: number;
  transaction_date: Date;
  merchant_id?: string;
  description: string;
  metadata: any;
}

interface Receipt {
  id: string;
  organization_id: string;
  amount: number;
  transaction_date: Date;
  merchant_name?: string;
  raw_text?: string;
  metadata: any;
  status: 'pending' | 'matched' | 'manual_review';
}

interface MatchCandidate {
  transaction: Transaction;
  receipt: Receipt;
  confidence: number;
  matching_rule: string;
  match_factors: {
    amount_match?: number;
    date_match?: number;
    merchant_match?: number;
    location_match?: number;
    custom_factors?: any;
  };
}

export class TransactionMatcher {
  private db: Knex;
  private logger: winston.Logger;

  constructor(db: Knex, logger: winston.Logger) {
    this.db = db;
    this.logger = logger;
  }

  async matchNewTransaction(transactionId: string): Promise<any> {
    const trx = await this.db.transaction();
    
    try {
      const transaction = await trx('transactions')
        .where('id', transactionId)
        .first() as Transaction;

      if (!transaction) {
        throw new Error('Transaction not found');
      }

      this.logger.info('Attempting to match transaction', {
        transactionId,
        organizationId: transaction.organization_id,
        amount: transaction.amount,
        date: transaction.transaction_date
      });

      // Find potential receipt matches
      const candidates = await this.findMatchingCandidates(trx, transaction);

      if (candidates.length === 0) {
        this.logger.info('No matching candidates found', { transactionId });
        await trx.commit();
        return { matched: false, reason: 'no_candidates' };
      }

      // Sort by confidence score
      candidates.sort((a, b) => b.confidence - a.confidence);

      const bestCandidate = candidates[0];

      // Auto-match if confidence is high enough
      if (bestCandidate.confidence >= 0.8) {
        const matchResult = await this.createMatch(
          trx,
          transaction,
          bestCandidate.receipt,
          bestCandidate
        );

        await trx.commit();

        this.logger.info('Transaction auto-matched', {
          transactionId,
          receiptId: bestCandidate.receipt.id,
          confidence: bestCandidate.confidence,
          rule: bestCandidate.matching_rule
        });

        return {
          matched: true,
          auto_matched: true,
          match_id: matchResult.id,
          confidence: bestCandidate.confidence,
          receipt_id: bestCandidate.receipt.id
        };
      }

      // Create suggested matches for manual review
      const suggestions = candidates
        .filter(c => c.confidence >= 0.4)
        .slice(0, 5); // Top 5 suggestions

      if (suggestions.length > 0) {
        await this.createMatchSuggestions(trx, transaction, suggestions);
        await trx.commit();

        this.logger.info('Created match suggestions for manual review', {
          transactionId,
          suggestionCount: suggestions.length,
          topConfidence: suggestions[0].confidence
        });

        return {
          matched: false,
          has_suggestions: true,
          suggestion_count: suggestions.length,
          top_confidence: suggestions[0].confidence
        };
      }

      await trx.commit();
      return { matched: false, reason: 'low_confidence' };

    } catch (error) {
      await trx.rollback();
      this.logger.error('Error matching transaction', {
        transactionId,
        error: (error as Error).message
      });
      throw error;
    }
  }

  async matchNewReceipt(receiptId: string): Promise<any> {
    const trx = await this.db.transaction();
    
    try {
      const receipt = await trx('receipts')
        .where('id', receiptId)
        .first() as Receipt;

      if (!receipt) {
        throw new Error('Receipt not found');
      }

      this.logger.info('Attempting to match receipt', {
        receiptId,
        organizationId: receipt.organization_id,
        amount: receipt.amount,
        date: receipt.transaction_date
      });

      // Find potential transaction matches
      const candidates = await this.findMatchingTransactions(trx, receipt);

      if (candidates.length === 0) {
        this.logger.info('No matching transactions found', { receiptId });
        await trx.commit();
        return { matched: false, reason: 'no_candidates' };
      }

      candidates.sort((a, b) => b.confidence - a.confidence);
      const bestCandidate = candidates[0];

      if (bestCandidate.confidence >= 0.8) {
        const matchResult = await this.createMatch(
          trx,
          bestCandidate.transaction,
          receipt,
          bestCandidate
        );

        await trx.commit();

        this.logger.info('Receipt auto-matched', {
          receiptId,
          transactionId: bestCandidate.transaction.id,
          confidence: bestCandidate.confidence
        });

        return {
          matched: true,
          auto_matched: true,
          match_id: matchResult.id,
          confidence: bestCandidate.confidence,
          transaction_id: bestCandidate.transaction.id
        };
      }

      // Create suggestions for manual review
      const suggestions = candidates
        .filter(c => c.confidence >= 0.4)
        .slice(0, 5);

      if (suggestions.length > 0) {
        await this.createReceiptSuggestions(trx, receipt, suggestions);
        await trx.commit();

        return {
          matched: false,
          has_suggestions: true,
          suggestion_count: suggestions.length,
          top_confidence: suggestions[0].confidence
        };
      }

      await trx.commit();
      return { matched: false, reason: 'low_confidence' };

    } catch (error) {
      await trx.rollback();
      this.logger.error('Error matching receipt', {
        receiptId,
        error: (error as Error).message
      });
      throw error;
    }
  }

  private async findMatchingCandidates(
    trx: Knex.Transaction,
    transaction: Transaction
  ): Promise<MatchCandidate[]> {
    // Find unmatched receipts within date and amount range
    const dateRange = 7; // days
    const amountTolerance = 0.05; // 5%

    const startDate = new Date(transaction.transaction_date);
    startDate.setDate(startDate.getDate() - dateRange);
    
    const endDate = new Date(transaction.transaction_date);
    endDate.setDate(endDate.getDate() + dateRange);

    const minAmount = transaction.amount * (1 - amountTolerance);
    const maxAmount = transaction.amount * (1 + amountTolerance);

    const potentialReceipts = await trx('receipts')
      .where('organization_id', transaction.organization_id)
      .where('status', 'pending')
      .whereBetween('transaction_date', [startDate, endDate])
      .whereBetween('amount', [minAmount, maxAmount])
      .whereNotExists(
        trx('transaction_receipt_matches')
          .select(1)
          .whereRaw('receipt_id = receipts.id')
          .where('status', 'matched')
      );

    const candidates: MatchCandidate[] = [];

    for (const receipt of potentialReceipts) {
      const confidence = await this.calculateMatchConfidence(
        trx,
        transaction,
        receipt as Receipt
      );

      if (confidence > 0) {
        candidates.push({
          transaction,
          receipt: receipt as Receipt,
          confidence: confidence.score,
          matching_rule: confidence.primary_rule,
          match_factors: confidence.factors
        });
      }
    }

    return candidates;
  }

  private async findMatchingTransactions(
    trx: Knex.Transaction,
    receipt: Receipt
  ): Promise<MatchCandidate[]> {
    const dateRange = 7;
    const amountTolerance = 0.05;

    const startDate = new Date(receipt.transaction_date);
    startDate.setDate(startDate.getDate() - dateRange);
    
    const endDate = new Date(receipt.transaction_date);
    endDate.setDate(endDate.getDate() + dateRange);

    const minAmount = receipt.amount * (1 - amountTolerance);
    const maxAmount = receipt.amount * (1 + amountTolerance);

    const potentialTransactions = await trx('transactions')
      .where('organization_id', receipt.organization_id)
      .where('status', 'processed')
      .whereBetween('transaction_date', [startDate, endDate])
      .whereBetween('amount', [minAmount, maxAmount])
      .whereNotExists(
        trx('transaction_receipt_matches')
          .select(1)
          .whereRaw('transaction_id = transactions.id')
          .where('status', 'matched')
      );

    const candidates: MatchCandidate[] = [];

    for (const transaction of potentialTransactions) {
      const confidence = await this.calculateMatchConfidence(
        trx,
        transaction as Transaction,
        receipt
      );

      if (confidence > 0) {
        candidates.push({
          transaction: transaction as Transaction,
          receipt,
          confidence: confidence.score,
          matching_rule: confidence.primary_rule,
          match_factors: confidence.factors
        });
      }
    }

    return candidates;
  }

  private async calculateMatchConfidence(
    trx: Knex.Transaction,
    transaction: Transaction,
    receipt: Receipt
  ): Promise<any> {
    const factors = {
      amount_match: 0,
      date_match: 0,
      merchant_match: 0,
      location_match: 0
    };

    let totalWeight = 0;
    let weightedScore = 0;

    // Amount matching (weight: 40%)
    const amountWeight = 0.4;
    const amountDiff = Math.abs(transaction.amount - receipt.amount);
    const amountPercDiff = amountDiff / Math.max(transaction.amount, receipt.amount);
    
    if (amountPercDiff <= 0.01) { // Exact or within 1%
      factors.amount_match = 1.0;
    } else if (amountPercDiff <= 0.05) { // Within 5%
      factors.amount_match = 0.8;
    } else if (amountPercDiff <= 0.1) { // Within 10%
      factors.amount_match = 0.5;
    } else {
      factors.amount_match = 0;
    }

    weightedScore += factors.amount_match * amountWeight;
    totalWeight += amountWeight;

    // Date matching (weight: 30%)
    const dateWeight = 0.3;
    const dateDiff = Math.abs(
      transaction.transaction_date.getTime() - receipt.transaction_date.getTime()
    );
    const daysDiff = dateDiff / (1000 * 60 * 60 * 24);

    if (daysDiff === 0) {
      factors.date_match = 1.0;
    } else if (daysDiff <= 1) {
      factors.date_match = 0.9;
    } else if (daysDiff <= 3) {
      factors.date_match = 0.7;
    } else if (daysDiff <= 7) {
      factors.date_match = 0.4;
    } else {
      factors.date_match = 0;
    }

    weightedScore += factors.date_match * dateWeight;
    totalWeight += dateWeight;

    // Merchant matching (weight: 25%)
    const merchantWeight = 0.25;
    if (transaction.merchant_id && receipt.merchant_name) {
      const merchant = await trx('merchants')
        .where('id', transaction.merchant_id)
        .first();

      if (merchant) {
        factors.merchant_match = this.calculateStringSimilarity(
          merchant.normalized_name,
          this.normalizeMerchantName(receipt.merchant_name)
        );
      }
    } else if (receipt.merchant_name) {
      // Compare with transaction description
      factors.merchant_match = this.calculateStringSimilarity(
        this.normalizeMerchantName(transaction.description),
        this.normalizeMerchantName(receipt.merchant_name)
      );
    }

    weightedScore += factors.merchant_match * merchantWeight;
    totalWeight += merchantWeight;

    // Location matching (weight: 5%) - if available
    const locationWeight = 0.05;
    if (transaction.metadata?.location && receipt.metadata?.location) {
      factors.location_match = this.calculateLocationSimilarity(
        transaction.metadata.location,
        receipt.metadata.location
      );
      weightedScore += factors.location_match * locationWeight;
      totalWeight += locationWeight;
    }

    const finalScore = totalWeight > 0 ? weightedScore / totalWeight : 0;

    return {
      score: finalScore,
      factors,
      primary_rule: this.determinePrimaryRule(factors),
      details: {
        amount_diff_pct: amountPercDiff,
        days_diff: daysDiff,
        total_weight: totalWeight
      }
    };
  }

  private async createMatch(
    trx: Knex.Transaction,
    transaction: Transaction,
    receipt: Receipt,
    candidate: MatchCandidate
  ) {
    const [match] = await trx('transaction_receipt_matches')
      .insert({
        organization_id: transaction.organization_id,
        transaction_id: transaction.id,
        receipt_id: receipt.id,
        match_type: 'auto',
        confidence_score: candidate.confidence,
        matching_rule: candidate.matching_rule,
        match_factors: candidate.match_factors,
        status: 'matched',
        matched_at: new Date()
      })
      .returning('*');

    // Update receipt status
    await trx('receipts')
      .where('id', receipt.id)
      .update({ status: 'matched' });

    return match;
  }

  private async createMatchSuggestions(
    trx: Knex.Transaction,
    transaction: Transaction,
    suggestions: MatchCandidate[]
  ) {
    const suggestionRecords = suggestions.map(suggestion => ({
      organization_id: transaction.organization_id,
      transaction_id: transaction.id,
      receipt_id: suggestion.receipt.id,
      match_type: 'suggested',
      confidence_score: suggestion.confidence,
      matching_rule: suggestion.matching_rule,
      match_factors: suggestion.match_factors,
      status: 'suggested'
    }));

    await trx('transaction_receipt_matches').insert(suggestionRecords);
  }

  private async createReceiptSuggestions(
    trx: Knex.Transaction,
    receipt: Receipt,
    suggestions: MatchCandidate[]
  ) {
    const suggestionRecords = suggestions.map(suggestion => ({
      organization_id: receipt.organization_id,
      transaction_id: suggestion.transaction.id,
      receipt_id: receipt.id,
      match_type: 'suggested',
      confidence_score: suggestion.confidence,
      matching_rule: suggestion.matching_rule,
      match_factors: suggestion.match_factors,
      status: 'suggested'
    }));

    await trx('transaction_receipt_matches').insert(suggestionRecords);
  }

  private calculateStringSimilarity(str1: string, str2: string): number {
    if (!str1 || !str2) return 0;
    
    str1 = str1.toLowerCase();
    str2 = str2.toLowerCase();

    if (str1 === str2) return 1;

    // Levenshtein distance calculation
    const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));

    for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
    for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;

    for (let j = 1; j <= str2.length; j++) {
      for (let i = 1; i <= str1.length; i++) {
        const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j][i - 1] + 1,
          matrix[j - 1][i] + 1,
          matrix[j - 1][i - 1] + indicator
        );
      }
    }

    const maxLen = Math.max(str1.length, str2.length);
    return maxLen > 0 ? 1 - (matrix[str2.length][str1.length] / maxLen) : 0;
  }

  private calculateLocationSimilarity(loc1: any, loc2: any): number {
    // Simple location matching - could be enhanced with proper geolocation
    if (!loc1 || !loc2) return 0;

    const fields = ['city', 'state', 'zip', 'address'];
    let matches = 0;
    let totalFields = 0;

    for (const field of fields) {
      if (loc1[field] && loc2[field]) {
        totalFields++;
        if (loc1[field].toLowerCase() === loc2[field].toLowerCase()) {
          matches++;
        }
      }
    }

    return totalFields > 0 ? matches / totalFields : 0;
  }

  private determinePrimaryRule(factors: any): string {
    const { amount_match, date_match, merchant_match, location_match } = factors;

    if (amount_match >= 0.9 && date_match >= 0.9) {
      return 'amount_date';
    } else if (merchant_match >= 0.8 && amount_match >= 0.8) {
      return 'merchant_amount';
    } else if (amount_match >= 0.7 && date_match >= 0.7 && merchant_match >= 0.5) {
      return 'fuzzy_match';
    } else {
      return 'low_confidence';
    }
  }

  private normalizeMerchantName(name: string): string {
    if (!name) return '';
    
    return name
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  async approveMatch(matchId: string, userId: string): Promise<any> {
    const trx = await this.db.transaction();

    try {
      const match = await trx('transaction_receipt_matches')
        .where('id', matchId)
        .first();

      if (!match) {
        throw new Error('Match not found');
      }

      await trx('transaction_receipt_matches')
        .where('id', matchId)
        .update({
          status: 'matched',
          match_type: 'manual',
          matched_at: new Date(),
          matched_by: userId
        });

      // Update receipt status
      await trx('receipts')
        .where('id', match.receipt_id)
        .update({ status: 'matched' });

      // Remove other suggestions for this transaction and receipt
      await trx('transaction_receipt_matches')
        .where('transaction_id', match.transaction_id)
        .where('id', '!=', matchId)
        .update({ status: 'rejected' });

      await trx('transaction_receipt_matches')
        .where('receipt_id', match.receipt_id)
        .where('id', '!=', matchId)
        .update({ status: 'rejected' });

      await trx.commit();

      this.logger.info('Match approved manually', {
        matchId,
        transactionId: match.transaction_id,
        receiptId: match.receipt_id,
        userId
      });

      return { success: true };
    } catch (error) {
      await trx.rollback();
      throw error;
    }
  }

  async rejectMatch(matchId: string, userId: string): Promise<any> {
    const trx = await this.db.transaction();

    try {
      await trx('transaction_receipt_matches')
        .where('id', matchId)
        .update({
          status: 'rejected',
          rejected_at: new Date(),
          rejected_by: userId
        });

      await trx.commit();
      return { success: true };
    } catch (error) {
      await trx.rollback();
      throw error;
    }
  }
}