/**
 * Receipt Processing Service
 * Orchestrates the complete receipt processing pipeline
 */

import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import path from 'path';
import winston from 'winston';
import knex from 'knex';
import { OCRService, OCRResult, ExtractedField } from './ocrService';
import { EmailService } from './emailService';
import { DuplicateDetectionService } from './duplicateDetectionService';
import { getErrorMessage } from '../utils/errorHandling';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/receipts.log' })
  ]
});

export interface ReceiptUpload {
  id: string;
  organization_id: string;
  uploadedBy: string;
  originalFilename: string;
  filePath: string;
  fileType: string;
  fileSize: number;
  fileHash: string;
  status: 'uploaded' | 'processing' | 'processed' | 'failed' | 'matched';
  metadata?: Record<string, any>;
}

export interface ProcessingResult {
  receiptId: string;
  status: 'success' | 'failed' | 'duplicate';
  ocrResult?: OCRResult;
  error?: string;
  duplicateOf?: string;
  processingTime: number;
}

export interface ReceiptSearchParams {
  organization_id: string;
  userId?: string;
  status?: string;
  merchantName?: string;
  dateFrom?: Date;
  dateTo?: Date;
  amountMin?: number;
  amountMax?: number;
  tags?: any[];
  limit?: number;
  offset?: number;
}

export interface ReceiptSearchResult {
  receipts: ReceiptWithDetails[];
  total: number;
  hasMore: boolean;
}

export interface ReceiptWithDetails {
  id: string;
  organization_id: string;
  uploadedBy: string;
  uploaderName: string;
  originalFilename: string;
  filePath: string;
  fileType: string;
  fileSize: number;
  status: string;
  totalAmount?: number;
  currency?: string;
  receiptDate?: Date;
  merchantName?: string;
  extractedFields: ExtractedField[];
  metadata: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
  matchedTransactionId?: string;
  thumbnailUrl?: string;
}

export class ReceiptService {
  private db: knex.Knex;
  private ocrService: OCRService;
  private emailService: EmailService;
  private duplicateDetectionService: DuplicateDetectionService;

  constructor(database: knex.Knex) {
    this.db = database;
    this.ocrService = new OCRService();
    this.emailService = new EmailService();
    this.duplicateDetectionService = new DuplicateDetectionService(database);
  }

  /**
   * Process uploaded receipt file
   */
  async processUpload(
    organization_id: string,
    uploadedBy: string,
    file: Express.Multer.File,
    metadata: Record<string, any> = {}
  ): Promise<ProcessingResult> {
    const startTime = Date.now();
    const receiptId = uuidv4();

    try {
      logger.info(`Starting receipt processing`, {
        receiptId,
        organization_id,
        uploadedBy,
        filename: file.originalname,
        size: file.size,
        type: file.mimetype
      });

      // Calculate file hash for duplicate detection
      const fileHash = await this.calculateFileHash(file);

      // Check for duplicates
      const duplicateCheck = await this.duplicateDetectionService.checkForDuplicate(
        organization_id,
        fileHash,
        file.originalname,
        file.size
      );

      if (duplicateCheck.isDuplicate) {
        logger.info(`Duplicate receipt detected`, {
          receiptId,
          duplicateOf: duplicateCheck.existingReceiptId
        });

        return {
          receiptId,
          status: 'duplicate',
          duplicateOf: duplicateCheck.existingReceiptId,
          processingTime: Date.now() - startTime
        };
      }

      // Create receipt record
      const receipt = await this.createReceiptRecord({
        id: receiptId,
        organization_id,
        uploadedBy,
        originalFilename: file.originalname,
        filePath: file.path || (file as any).key || '',
        fileType: file.mimetype,
        fileSize: file.size,
        fileHash,
        status: 'uploaded',
        metadata
      });

      // Update status to processing
      await this.updateReceiptStatus(receiptId, 'processing');

      // Process with OCR
      const ocrResult = await this.ocrService.processReceipt(
        receiptId,
        organization_id,
        receipt.filePath,
        receipt.fileType
      );

      // Save extracted fields
      await this.saveExtractedFields(receiptId, organization_id, ocrResult.extractedFields);

      // Update receipt with OCR results
      await this.updateReceiptWithOCRResults(receiptId, ocrResult);

      // Update status to processed
      await this.updateReceiptStatus(receiptId, 'processed', new Date());

      // Trigger automatic matching (async)
      this.triggerAutomaticMatching(receiptId, organizationId).catch(error => {
        logger.error(`Automatic matching failed for receipt ${receiptId}`, { error: getErrorMessage(error) });
      });

      logger.info(`Receipt processing completed successfully`, {
        receiptId,
        processingTime: Date.now() - startTime,
        confidence: ocrResult.confidence
      });

      return {
        receiptId,
        status: 'success',
        ocrResult,
        processingTime: Date.now() - startTime
      };

    } catch (error) {
      logger.error(`Receipt processing failed`, {
        receiptId,
        error: error instanceof Error ? getErrorMessage(error) : 'Unknown error',
        processingTime: Date.now() - startTime
      });

      // Update receipt status to failed
      await this.updateReceiptStatus(receiptId, 'failed').catch(() => {});

      // Save error details
      await this.saveProcessingError(receiptId, error instanceof Error ? getErrorMessage(error) : 'Unknown error');

      return {
        receiptId,
        status: 'failed',
        error: error instanceof Error ? getErrorMessage(error) : 'Unknown error',
        processingTime: Date.now() - startTime
      };
    }
  }

  /**
   * Process receipt from email
   */
  async processEmailReceipt(
    organization_id: string,
    emailData: {
      from: string;
      subject: string;
      body: string;
      attachments: Express.Multer.File[];
    }
  ): Promise<ProcessingResult[]> {
    logger.info(`Processing email receipt`, {
      organization_id,
      from: emailData.from,
      attachmentCount: emailData.attachments.length
    });

    // Find user by email
    const user = await this.db('users')
      .where({ email: emailData.from, organization_id: organizationId })
      .first();

    if (!user) {
      throw new Error(`User not found for email: ${emailData.from}`);
    }

    const results: ProcessingResult[] = [];

    // Process each attachment
    for (const attachment of emailData.attachments) {
      if (this.isValidReceiptFile(attachment)) {
        const metadata = {
          source: 'email',
          emailSubject: emailData.subject,
          emailFrom: emailData.from,
          emailBody: emailData.body.substring(0, 1000) // First 1000 chars
        };

        const result = await this.processUpload(organization_id, user.id, attachment, metadata);
        results.push(result);
      }
    }

    // Send confirmation email
    if (results.length > 0) {
      await this.emailService.sendReceiptProcessedEmail(emailData.from, results);
    }

    return results;
  }

  /**
   * Search receipts with advanced filters
   */
  async searchReceipts(params: ReceiptSearchParams): Promise<ReceiptSearchResult> {
    const limit = params.limit || 50;
    const offset = params.offset || 0;

    let query = this.db('receipts as r')
      .leftJoin('users as u', 'r.uploaded_by', 'u.id')
      .leftJoin('matches as m', function() {
        this.on('r.id', '=', 'm.receipt_id').andOn('m.active', '=', true);
      })
      .where('r.organization_id', params.organization_id)
      .select(
        'r.*',
        'u.name as uploader_name',
        'm.transaction_id as matched_transaction_id'
      );

    // Apply filters
    if (params.userId) {
      query = query.where('r.uploaded_by', params.userId);
    }

    if (params.status) {
      query = query.where('r.status', params.status);
    }

    if (params.merchantName) {
      query = query.where('r.merchant_name', 'ilike', `%${params.merchantName}%`);
    }

    if (params.dateFrom) {
      query = query.where('r.receipt_date', '>=', params.dateFrom);
    }

    if (params.dateTo) {
      query = query.where('r.receipt_date', '<=', params.dateTo);
    }

    if (params.amountMin !== undefined) {
      query = query.where('r.total_amount', '>=', params.amountMin);
    }

    if (params.amountMax !== undefined) {
      query = query.where('r.total_amount', '<=', params.amountMax);
    }

    if (params.tags && params.tags.length > 0) {
      query = query.whereRaw(
        'r.metadata->>\'tags\' ?| array[?]',
        [params.tags]
      );
    }

    // Get total count
    const totalQuery = query.clone();
    const [{ count }] = await totalQuery.count('r.id as count');
    const total = parseInt(count as string, 10);

    // Get paginated results
    const receipts = await query
      .orderBy('r.created_at', 'desc')
      .limit(limit)
      .offset(offset);

    // Fetch extracted fields for each receipt
    const receiptsWithDetails = await Promise.all(
      receipts.map(async (receipt: any) => {
        const extractedFields = await this.getExtractedFields(receipt.id);
        
        return {
          ...receipt,
          extractedFields,
          thumbnailUrl: await this.generateThumbnailUrl(receipt.file_path)
        } as ReceiptWithDetails;
      })
    );

    return {
      receipts: receiptsWithDetails,
      total,
      hasMore: offset + receipts.length < total
    };
  }

  /**
   * Get receipt details by ID
   */
  async getReceiptById(receiptId: string, organization_id: string): Promise<ReceiptWithDetails | null> {
    const receipt = await this.db('receipts as r')
      .leftJoin('users as u', 'r.uploaded_by', 'u.id')
      .leftJoin('matches as m', function() {
        this.on('r.id', '=', 'm.receipt_id').andOn('m.active', '=', true);
      })
      .where('r.id', receiptId)
      .andWhere('r.organization_id', organizationId)
      .select(
        'r.*',
        'u.name as uploader_name',
        'm.transaction_id as matched_transaction_id'
      )
      .first();

    if (!receipt) {
      return null;
    }

    const extractedFields = await this.getExtractedFields(receiptId);
    
    return {
      ...receipt,
      extractedFields,
      thumbnailUrl: await this.generateThumbnailUrl(receipt.file_path)
    } as ReceiptWithDetails;
  }

  /**
   * Update extracted field value
   */
  async updateExtractedField(
    receiptId: string,
    organization_id: string,
    fieldName: string,
    fieldValue: string,
    userId: string
  ): Promise<void> {
    await this.db('extracted_fields')
      .where({
        receipt_id: receiptId,
        organization_id: organization_id,
        field_name: fieldName
      })
      .update({
        field_value: fieldValue,
        verified: true,
        verified_by: userId,
        verified_at: new Date(),
        updated_at: new Date()
      });

    // Update receipt fields if they're standard fields
    const updateData: any = { updated_at: new Date() };
    
    switch (fieldName) {
      case 'total':
      case 'amount_paid':
        updateData.total_amount = parseFloat(fieldValue);
        break;
      case 'vendor_name':
      case 'merchant_name':
        updateData.merchant_name = fieldValue;
        break;
      case 'invoice_receipt_date':
      case 'receipt_date':
        updateData.receipt_date = new Date(fieldValue);
        break;
    }

    if (Object.keys(updateData).length > 1) {
      await this.db('receipts')
        .where({ id: receiptId, organization_id: organizationId })
        .update(updateData);
    }

    logger.info(`Extracted field updated`, {
      receiptId,
      fieldName,
      fieldValue,
      updated_by: userId
    });
  }

  /**
   * Delete receipt
   */
  async deleteReceipt(receiptId: string, organization_id: string, userId: string): Promise<void> {
    const receipt = await this.db('receipts')
      .where({ id: receiptId, organization_id: organizationId })
      .first();

    if (!receipt) {
      throw new Error('Receipt not found');
    }

    // Delete file from storage
    await this.deleteReceiptFile(receipt.file_path);

    // Delete database records (cascading deletes will handle related records)
    await this.db('receipts')
      .where({ id: receiptId, organization_id: organizationId })
      .delete();

    logger.info(`Receipt deleted`, {
      receiptId,
      organization_id,
      deletedBy: userId
    });
  }

  /**
   * Get processing status
   */
  async getProcessingStatus(receiptId: string, organization_id: string): Promise<{
    status: string;
    progress?: number;
    processingErrors?: any[];
    lastUpdated: Date;
  }> {
    const receipt = await this.db('receipts')
      .where({ id: receiptId, organization_id: organizationId })
      .select('status', 'processing_errors', 'updated_at')
      .first();

    if (!receipt) {
      throw new Error('Receipt not found');
    }

    return {
      status: receipt.status,
      processingErrors: receipt.processing_errors || [],
      lastUpdated: receipt.updated_at
    };
  }

  /**
   * Private helper methods
   */
  private async createReceiptRecord(receipt: ReceiptUpload): Promise<ReceiptUpload> {
    const [created] = await this.db('receipts')
      .insert({
        id: receipt.id,
        organization_id: receipt.organization_id,
        uploaded_by: receipt.uploadedBy,
        original_filename: receipt.originalFilename,
        file_path: receipt.filePath,
        file_type: receipt.fileType,
        file_size: receipt.fileSize,
        file_hash: receipt.fileHash,
        status: receipt.status,
        metadata: receipt.metadata || {},
        created_at: new Date(),
        updated_at: new Date()
      })
      .returning('*');

    return created;
  }

  private async updateReceiptStatus(
    receiptId: string, 
    status: string, 
    processedAt?: Date
  ): Promise<void> {
    const updateData: any = { 
      status, 
      updated_at: new Date() 
    };

    if (processedAt) {
      updateData.processed_at = processedAt;
    }

    await this.db('receipts')
      .where('id', receiptId)
      .update(updateData);
  }

  private async updateReceiptWithOCRResults(receiptId: string, ocrResult: OCRResult): Promise<void> {
    await this.db('receipts')
      .where('id', receiptId)
      .update({
        total_amount: ocrResult.totalAmount,
        currency: ocrResult.currency,
        receipt_date: ocrResult.receiptDate,
        merchant_name: ocrResult.merchantName,
        updated_at: new Date()
      });
  }

  private async saveExtractedFields(
    receiptId: string, 
    organization_id: string, 
    fields: ExtractedField[]
  ): Promise<void> {
    const fieldRecords = fields.map(field => ({
      id: uuidv4(),
      organization_id: organization_id,
      receipt_id: receiptId,
      field_name: field.fieldName,
      field_value: field.fieldValue,
      field_type: field.fieldType,
      confidence_score: field.confidence,
      bounding_box: field.boundingBox,
      verified: field.verified,
      created_at: new Date(),
      updated_at: new Date()
    }));

    if (fieldRecords.length > 0) {
      await this.db('extracted_fields').insert(fieldRecords);
    }
  }

  private async saveProcessingError(receiptId: string, error: string): Promise<void> {
    await this.db('receipts')
    .where('id', receiptId)
    .update({
    processing_errors: JSON.stringify([{
    error,
    timestamp: new Date().toISOString()
    }]),
    updated_at: new Date()
    });
  }

  private async getExtractedFields(receiptId: string): Promise<ExtractedField[]> {
    const fields = await this.db('extracted_fields')
      .where('receipt_id', receiptId)
      .orderBy('field_name');

    return fields.map(field => ({
      fieldName: field.field_name,
      fieldValue: field.field_value,
      fieldType: field.field_type,
      confidence: field.confidence_score,
      boundingBox: field.bounding_box,
      verified: field.verified
    }));
  }

  private async calculateFileHash(file: Express.Multer.File): Promise<string> {
    if ((file as any).hash) return (file as any).hash; // Already calculated by upload middleware
    
    const hash = crypto.createHash('sha256');
    if (file.buffer) {
      hash.update(file.buffer);
    } else if (file.path) {
      const fs = require('fs');
      const fileBuffer = fs.readFileSync(file.path);
      hash.update(fileBuffer);
    } else {
      // Fallback for S3 uploads
      hash.update(file.originalname + file.size + Date.now());
    }
    
    return hash.digest('hex');
  }

  private isValidReceiptFile(file: Express.Multer.File): boolean {
    const validMimeTypes = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'application/pdf'
    ];
    
    return validMimeTypes.includes(file.mimetype) && file.size > 0;
  }

  private async triggerAutomaticMatching(receiptId: string, organization_id: string): Promise<void> {
    // This would trigger the automatic matching logic
    // Implementation depends on your transaction matching requirements
    logger.info(`Triggering automatic matching for receipt ${receiptId}`);
  }

  private async generateThumbnailUrl(filePath: string): Promise<string | undefined> {
    // Generate thumbnail URL based on storage type
    if (process.env.NODE_ENV === 'production') {
      // For S3, generate presigned URL for thumbnail
      const thumbnailKey = filePath.replace(/(\.[^.]+)$/, '_thumb$1');
      // Implementation would generate S3 presigned URL
      return `https://${process.env.S3_BUCKET_NAME}.s3.amazonaws.com/${thumbnailKey}`;
    } else {
      // For local storage
      return filePath.replace(/(\.[^.]+)$/, '_thumb$1');
    }
  }

  private async deleteReceiptFile(filePath: string): Promise<void> {
    if (process.env.NODE_ENV === 'production') {
      // Delete from S3
      // Implementation would use S3 DeleteObject
    } else {
      // Delete local file
      const fs = require('fs').promises;
      try {
        await fs.unlink(filePath);
        // Also delete thumbnail
        const thumbnailPath = filePath.replace(/(\.[^.]+)$/, '_thumb$1');
        await fs.unlink(thumbnailPath).catch(() => {}); // Silent fail for thumbnail
      } catch (error) {
        logger.error(`Failed to delete file: ${filePath}`, { error });
      }
    }
  }
}

export default ReceiptService;