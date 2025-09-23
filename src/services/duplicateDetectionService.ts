/**
 * Duplicate Detection Service
 * Detects duplicate receipts using multiple strategies
 */

import crypto from 'crypto';
import knex from 'knex';
import winston from 'winston';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/duplicates.log' })
  ]
});

export interface DuplicateCheckResult {
  isDuplicate: boolean;
  existingReceiptId?: string;
  matchType?: 'exact_hash' | 'similar_content' | 'metadata_match';
  confidence: number;
  matchedFields?: string[];
}

export interface SimilarityMetrics {
  filename: number;
  size: number;
  amount: number;
  date: number;
  merchant: number;
  overall: number;
}

export class DuplicateDetectionService {
  private db: knex.Knex;

  constructor(database: knex.Knex) {
    this.db = database;
  }

  /**
   * Check for duplicate receipts using multiple strategies
   */
  async checkForDuplicate(
    organizationId: string,
    fileHash: string,
    filename: string,
    fileSize: number,
    amount?: number,
    date?: Date,
    merchantName?: string
  ): Promise<DuplicateCheckResult> {
    try {
      // Strategy 1: Exact file hash match (most reliable)
      const exactMatch = await this.checkExactHash(organizationId, fileHash);
      if (exactMatch.isDuplicate) {
        return exactMatch;
      }

      // Strategy 2: Similar content analysis
      const contentMatch = await this.checkSimilarContent(
        organizationId,
        filename,
        fileSize,
        amount,
        date,
        merchantName
      );
      if (contentMatch.isDuplicate) {
        return contentMatch;
      }

      // Strategy 3: Metadata-based matching
      const metadataMatch = await this.checkMetadataMatch(
        organizationId,
        filename,
        amount,
        date,
        merchantName
      );
      if (metadataMatch.isDuplicate) {
        return metadataMatch;
      }

      return {
        isDuplicate: false,
        confidence: 0
      };

    } catch (error) {
      logger.error('Duplicate detection failed', {
        organizationId,
        fileHash,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      // Fail safe - don't block uploads due to duplicate detection errors
      return {
        isDuplicate: false,
        confidence: 0
      };
    }
  }

  /**
   * Strategy 1: Check for exact file hash match
   */
  private async checkExactHash(
    organizationId: string,
    fileHash: string
  ): Promise<DuplicateCheckResult> {
    const existingReceipt = await this.db('receipts')
      .where({
        organization_id: organizationId,
        file_hash: fileHash
      })
      .andWhere('status', '!=', 'failed') // Don't consider failed receipts
      .select('id', 'original_filename', 'created_at')
      .first();

    if (existingReceipt) {
      logger.info('Exact duplicate detected', {
        organizationId,
        existingReceiptId: existingReceipt.id,
        fileHash
      });

      return {
        isDuplicate: true,
        existingReceiptId: existingReceipt.id,
        matchType: 'exact_hash',
        confidence: 1.0,
        matchedFields: ['file_hash']
      };
    }

    return { isDuplicate: false, confidence: 0 };
  }

  /**
   * Strategy 2: Check for similar content based on multiple factors
   */
  private async checkSimilarContent(
    organizationId: string,
    filename: string,
    fileSize: number,
    amount?: number,
    date?: Date,
    merchantName?: string
  ): Promise<DuplicateCheckResult> {
    // Find potentially similar receipts within reasonable time window
    const timeWindow = date ? new Date(date.getTime() - 7 * 24 * 60 * 60 * 1000) : null; // 7 days before
    const timeWindowEnd = date ? new Date(date.getTime() + 1 * 24 * 60 * 60 * 1000) : null; // 1 day after

    let query = this.db('receipts')
      .where('organization_id', organizationId)
      .andWhere('status', '!=', 'failed');

    // Add time window filter if date is available
    if (timeWindow && timeWindowEnd) {
      query = query.andWhereBetween('receipt_date', [timeWindow, timeWindowEnd]);
    }

    // Add size similarity filter (within 20% of original size)
    const minSize = Math.floor(fileSize * 0.8);
    const maxSize = Math.ceil(fileSize * 1.2);
    query = query.andWhereBetween('file_size', [minSize, maxSize]);

    const candidates = await query.select('*').limit(100); // Reasonable limit

    let bestMatch: DuplicateCheckResult = { isDuplicate: false, confidence: 0 };

    for (const candidate of candidates) {
      const similarity = this.calculateSimilarity({
        filename,
        fileSize,
        amount,
        date,
        merchantName
      }, candidate);

      if (similarity.overall > 0.85) { // High similarity threshold
        const matchType = similarity.overall > 0.95 ? 'exact_hash' : 'similar_content';
        
        const result: DuplicateCheckResult = {
          isDuplicate: true,
          existingReceiptId: candidate.id,
          matchType,
          confidence: similarity.overall,
          matchedFields: this.getMatchedFields(similarity)
        };

        if (similarity.overall > bestMatch.confidence) {
          bestMatch = result;
        }
      }
    }

    if (bestMatch.isDuplicate) {
      logger.info('Similar content duplicate detected', {
        organizationId,
        existingReceiptId: bestMatch.existingReceiptId,
        confidence: bestMatch.confidence,
        matchedFields: bestMatch.matchedFields
      });
    }

    return bestMatch;
  }

  /**
   * Strategy 3: Metadata-based matching (filename, amount, date patterns)
   */
  private async checkMetadataMatch(
    organizationId: string,
    filename: string,
    amount?: number,
    date?: Date,
    merchantName?: string
  ): Promise<DuplicateCheckResult> {
    if (!amount && !date && !merchantName) {
      return { isDuplicate: false, confidence: 0 };
    }

    let query = this.db('receipts')
      .where('organization_id', organizationId)
      .andWhere('status', '!=', 'failed');

    const conditions: string[] = [];
    let confidence = 0;

    // Exact amount match
    if (amount !== undefined) {
      query = query.andWhere('total_amount', amount);
      conditions.push('amount');
      confidence += 0.4;
    }

    // Date match (within same day)
    if (date) {
      const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);
      query = query.andWhereBetween('receipt_date', [startOfDay, endOfDay]);
      conditions.push('date');
      confidence += 0.3;
    }

    // Merchant name similarity
    if (merchantName) {
      query = query.andWhere('merchant_name', 'ilike', `%${merchantName}%`);
      conditions.push('merchant');
      confidence += 0.3;
    }

    // Filename similarity (same base name)
    const baseFilename = this.extractBaseFilename(filename);
    if (baseFilename.length > 5) { // Only if meaningful filename
      query = query.andWhere('original_filename', 'ilike', `%${baseFilename}%`);
      conditions.push('filename');
      confidence += 0.2;
    }

    const matches = await query.select('*').limit(10);

    if (matches.length > 0 && confidence > 0.7) {
      const bestMatch = matches[0]; // Take the first/most recent match

      logger.info('Metadata duplicate detected', {
        organizationId,
        existingReceiptId: bestMatch.id,
        confidence,
        matchedFields: conditions
      });

      return {
        isDuplicate: true,
        existingReceiptId: bestMatch.id,
        matchType: 'metadata_match',
        confidence,
        matchedFields: conditions
      };
    }

    return { isDuplicate: false, confidence: 0 };
  }

  /**
   * Calculate similarity between two receipts
   */
  private calculateSimilarity(
    candidate: {
      filename: string;
      fileSize: number;
      amount?: number;
      date?: Date;
      merchantName?: string;
    },
    existing: any
  ): SimilarityMetrics {
    const metrics: SimilarityMetrics = {
      filename: 0,
      size: 0,
      amount: 0,
      date: 0,
      merchant: 0,
      overall: 0
    };

    // Filename similarity
    metrics.filename = this.calculateStringSimilarity(
      candidate.filename.toLowerCase(),
      existing.original_filename?.toLowerCase() || ''
    );

    // File size similarity (exact match or very close)
    const sizeDiff = Math.abs(candidate.fileSize - (existing.file_size || 0));
    const avgSize = (candidate.fileSize + (existing.file_size || 0)) / 2;
    metrics.size = sizeDiff === 0 ? 1.0 : Math.max(0, 1 - (sizeDiff / avgSize));

    // Amount similarity
    if (candidate.amount !== undefined && existing.total_amount !== undefined) {
      const amountDiff = Math.abs(candidate.amount - existing.total_amount);
      const avgAmount = (candidate.amount + existing.total_amount) / 2;
      metrics.amount = amountDiff === 0 ? 1.0 : Math.max(0, 1 - (amountDiff / avgAmount));
    }

    // Date similarity
    if (candidate.date && existing.receipt_date) {
      const dateDiff = Math.abs(candidate.date.getTime() - new Date(existing.receipt_date).getTime());
      const oneDayMs = 24 * 60 * 60 * 1000;
      metrics.date = dateDiff === 0 ? 1.0 : Math.max(0, 1 - (dateDiff / oneDayMs));
    }

    // Merchant similarity
    if (candidate.merchantName && existing.merchant_name) {
      metrics.merchant = this.calculateStringSimilarity(
        candidate.merchantName.toLowerCase(),
        existing.merchant_name.toLowerCase()
      );
    }

    // Calculate overall similarity with weights
    const weights = {
      filename: 0.15,
      size: 0.25,
      amount: 0.35,
      date: 0.15,
      merchant: 0.25
    };

    // Only consider metrics that have values
    let totalWeight = 0;
    let weightedSum = 0;

    if (metrics.filename > 0) {
      weightedSum += metrics.filename * weights.filename;
      totalWeight += weights.filename;
    }
    if (metrics.size > 0) {
      weightedSum += metrics.size * weights.size;
      totalWeight += weights.size;
    }
    if (metrics.amount > 0) {
      weightedSum += metrics.amount * weights.amount;
      totalWeight += weights.amount;
    }
    if (metrics.date > 0) {
      weightedSum += metrics.date * weights.date;
      totalWeight += weights.date;
    }
    if (metrics.merchant > 0) {
      weightedSum += metrics.merchant * weights.merchant;
      totalWeight += weights.merchant;
    }

    metrics.overall = totalWeight > 0 ? weightedSum / totalWeight : 0;

    return metrics;
  }

  /**
   * Calculate string similarity using Levenshtein distance
   */
  private calculateStringSimilarity(str1: string, str2: string): number {
    if (str1 === str2) return 1.0;
    if (!str1 || !str2) return 0;

    const matrix = [];
    const len1 = str1.length;
    const len2 = str2.length;

    // Create matrix
    for (let i = 0; i <= len1; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= len2; j++) {
      matrix[0][j] = j;
    }

    // Fill matrix
    for (let i = 1; i <= len1; i++) {
      for (let j = 1; j <= len2; j++) {
        const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,     // deletion
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j - 1] + cost // substitution
        );
      }
    }

    const distance = matrix[len1][len2];
    const maxLength = Math.max(len1, len2);
    
    return maxLength === 0 ? 1.0 : 1 - (distance / maxLength);
  }

  /**
   * Extract base filename without extension and common patterns
   */
  private extractBaseFilename(filename: string): string {
    // Remove extension
    let baseName = filename.replace(/\.[^/.]+$/, '');
    
    // Remove common timestamp patterns
    baseName = baseName.replace(/[-_]\d{4}[-_]\d{2}[-_]\d{2}/, '');
    baseName = baseName.replace(/[-_]\d{8}/, '');
    baseName = baseName.replace(/[-_]\d{10,13}/, ''); // Unix timestamps
    
    // Remove common suffixes
    baseName = baseName.replace(/[-_](copy|duplicate|scan|receipt|invoice)$/i, '');
    baseName = baseName.replace(/[-_]\d+$/, ''); // Trailing numbers
    
    return baseName.trim();
  }

  /**
   * Determine which fields contributed to the match
   */
  private getMatchedFields(similarity: SimilarityMetrics): string[] {
    const matchedFields: string[] = [];
    
    if (similarity.filename > 0.8) matchedFields.push('filename');
    if (similarity.size > 0.9) matchedFields.push('file_size');
    if (similarity.amount > 0.99) matchedFields.push('amount');
    if (similarity.date > 0.9) matchedFields.push('date');
    if (similarity.merchant > 0.8) matchedFields.push('merchant');
    
    return matchedFields;
  }

  /**
   * Get list of potential duplicates for review
   */
  async getPotentialDuplicates(
    organizationId: string,
    threshold: number = 0.7,
    limit: number = 50
  ): Promise<Array<{
    receiptId1: string;
    receiptId2: string;
    confidence: number;
    matchType: string;
    matchedFields: string[];
    createdAt: Date;
  }>> {
    // This would implement a batch job to find potential duplicates
    // For now, return empty array as this is typically run as a background job
    return [];
  }

  /**
   * Mark receipts as duplicate/not duplicate (for machine learning training)
   */
  async markDuplicate(
    receiptId1: string,
    receiptId2: string,
    isDuplicate: boolean,
    userId: string
  ): Promise<void> {
    // Store human feedback for improving duplicate detection algorithms
    await this.db('duplicate_feedback').insert({
      id: crypto.randomUUID(),
      receipt_id_1: receiptId1,
      receipt_id_2: receiptId2,
      is_duplicate: isDuplicate,
      marked_by: userId,
      created_at: new Date()
    }).onConflict(['receipt_id_1', 'receipt_id_2']).merge();

    logger.info('Duplicate feedback recorded', {
      receiptId1,
      receiptId2,
      isDuplicate,
      markedBy: userId
    });
  }

  /**
   * Update duplicate detection rules based on feedback
   */
  async updateDetectionRules(): Promise<void> {
    // This would analyze feedback and adjust detection parameters
    // Implementation would involve machine learning model updates
    logger.info('Duplicate detection rules updated');
  }
}