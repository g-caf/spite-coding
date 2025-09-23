/**
 * Receipt Service Tests
 * Comprehensive test suite for receipt processing functionality
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import knex from 'knex';
import ReceiptService from '../services/receiptService';
import { OCRService } from '../services/ocrService';
import { EmailService } from '../services/emailService';
import { DuplicateDetectionService } from '../services/duplicateDetectionService';

// Mock dependencies
jest.mock('../services/ocrService');
jest.mock('../services/emailService');
jest.mock('../services/duplicateDetectionService');

describe('ReceiptService', () => {
  let db: knex.Knex;
  let receiptService: ReceiptService;
  let mockOCRService: jest.Mocked<OCRService>;
  let mockEmailService: jest.Mocked<EmailService>;
  let mockDuplicateService: jest.Mocked<DuplicateDetectionService>;

  beforeEach(async () => {
    // Setup test database
    db = knex({
      client: 'sqlite3',
      connection: ':memory:',
      useNullAsDefault: true
    });

    // Create test tables
    await createTestTables(db);

    // Setup service with mocks
    receiptService = new ReceiptService(db);
    
    // Get mocked instances
    mockOCRService = new OCRService() as jest.Mocked<OCRService>;
    mockEmailService = new EmailService() as jest.Mocked<EmailService>;
    mockDuplicateService = new DuplicateDetectionService(db) as jest.Mocked<DuplicateDetectionService>;

    // Setup default mock behaviors
    mockDuplicateService.checkForDuplicate.mockResolvedValue({
      isDuplicate: false,
      confidence: 0
    });

    mockOCRService.processReceipt.mockResolvedValue({
      receiptId: 'test-receipt-id',
      organizationId: 'test-org',
      totalAmount: 25.99,
      currency: 'USD',
      receiptDate: new Date('2024-01-15'),
      merchantName: 'Test Store',
      extractedFields: [
        {
          fieldName: 'total',
          fieldValue: '25.99',
          fieldType: 'amount',
          confidence: 0.95,
          verified: false
        }
      ],
      rawOCRData: {},
      confidence: 0.95,
      processingTime: 1500
    });
  });

  afterEach(async () => {
    await db.destroy();
    jest.clearAllMocks();
  });

  describe('processUpload', () => {
    it('should successfully process a valid receipt upload', async () => {
      const mockFile = createMockFile('receipt.jpg', 'image/jpeg', 100000);
      const organizationId = 'org-1';
      const uploadedBy = 'user-1';

      const result = await receiptService.processUpload(organizationId, uploadedBy, mockFile);

      expect(result.status).toBe('success');
      expect(result.receiptId).toBeDefined();
      expect(result.processingTime).toBeGreaterThan(0);
      expect(result.ocrResult).toBeDefined();
      expect(result.ocrResult?.totalAmount).toBe(25.99);

      // Verify database record was created
      const receipt = await db('receipts').where('id', result.receiptId).first();
      expect(receipt).toBeDefined();
      expect(receipt.organization_id).toBe(organizationId);
      expect(receipt.uploaded_by).toBe(uploadedBy);
    });

    it('should detect and handle duplicate receipts', async () => {
      const mockFile = createMockFile('receipt.jpg', 'image/jpeg', 100000);
      mockDuplicateService.checkForDuplicate.mockResolvedValue({
        isDuplicate: true,
        existingReceiptId: 'existing-receipt-id',
        matchType: 'exact_hash',
        confidence: 1.0
      });

      const result = await receiptService.processUpload('org-1', 'user-1', mockFile);

      expect(result.status).toBe('duplicate');
      expect(result.duplicateOf).toBe('existing-receipt-id');
    });

    it('should handle OCR processing failures gracefully', async () => {
      const mockFile = createMockFile('receipt.jpg', 'image/jpeg', 100000);
      mockOCRService.processReceipt.mockRejectedValue(new Error('OCR processing failed'));

      const result = await receiptService.processUpload('org-1', 'user-1', mockFile);

      expect(result.status).toBe('failed');
      expect(result.error).toContain('OCR processing failed');
      
      // Verify receipt status was updated to failed
      const receipt = await db('receipts').where('id', result.receiptId).first();
      expect(receipt.status).toBe('failed');
    });

    it('should save extracted fields correctly', async () => {
      const mockFile = createMockFile('receipt.jpg', 'image/jpeg', 100000);
      const organizationId = 'org-1';

      const result = await receiptService.processUpload(organizationId, 'user-1', mockFile);

      // Verify extracted fields were saved
      const extractedFields = await db('extracted_fields')
        .where('receipt_id', result.receiptId)
        .select('*');

      expect(extractedFields).toHaveLength(1);
      expect(extractedFields[0].field_name).toBe('total');
      expect(extractedFields[0].field_value).toBe('25.99');
      expect(extractedFields[0].field_type).toBe('amount');
      expect(extractedFields[0].confidence_score).toBe(0.95);
    });
  });

  describe('processEmailReceipt', () => {
    it('should process email with valid attachments', async () => {
      // Create test user
      const userId = await db('users').insert({
        id: 'user-1',
        organization_id: 'org-1',
        email: 'test@example.com',
        name: 'Test User'
      }).returning('id');

      const emailData = {
        from: 'test@example.com',
        subject: 'Receipt from lunch meeting',
        body: 'Please process this receipt',
        attachments: [
          createMockFile('receipt1.jpg', 'image/jpeg', 50000),
          createMockFile('receipt2.pdf', 'application/pdf', 200000)
        ]
      };

      const results = await receiptService.processEmailReceipt('org-1', emailData);

      expect(results).toHaveLength(2);
      expect(results[0].status).toBe('success');
      expect(results[1].status).toBe('success');
      
      expect(mockEmailService.sendReceiptProcessedEmail).toHaveBeenCalledWith(
        'test@example.com',
        results
      );
    });

    it('should handle unknown email sender', async () => {
      const emailData = {
        from: 'unknown@example.com',
        subject: 'Receipt',
        body: 'Test',
        attachments: [createMockFile('receipt.jpg', 'image/jpeg', 50000)]
      };

      await expect(receiptService.processEmailReceipt('org-1', emailData))
        .rejects.toThrow('User not found for email: unknown@example.com');
    });
  });

  describe('searchReceipts', () => {
    beforeEach(async () => {
      // Create test data
      await createTestReceipts(db);
    });

    it('should search receipts by organization', async () => {
      const result = await receiptService.searchReceipts({
        organizationId: 'org-1'
      });

      expect(result.receipts).toHaveLength(3);
      expect(result.total).toBe(3);
      expect(result.hasMore).toBe(false);
    });

    it('should filter receipts by status', async () => {
      const result = await receiptService.searchReceipts({
        organizationId: 'org-1',
        status: 'processed'
      });

      expect(result.receipts).toHaveLength(2);
      expect(result.receipts.every(r => r.status === 'processed')).toBe(true);
    });

    it('should filter receipts by merchant name', async () => {
      const result = await receiptService.searchReceipts({
        organizationId: 'org-1',
        merchantName: 'Starbucks'
      });

      expect(result.receipts).toHaveLength(1);
      expect(result.receipts[0].merchantName).toContain('Starbucks');
    });

    it('should filter receipts by amount range', async () => {
      const result = await receiptService.searchReceipts({
        organizationId: 'org-1',
        amountMin: 20,
        amountMax: 50
      });

      expect(result.receipts).toHaveLength(1);
      expect(result.receipts[0].totalAmount).toBeGreaterThanOrEqual(20);
      expect(result.receipts[0].totalAmount).toBeLessThanOrEqual(50);
    });

    it('should support pagination', async () => {
      const result = await receiptService.searchReceipts({
        organizationId: 'org-1',
        limit: 2,
        offset: 1
      });

      expect(result.receipts).toHaveLength(2);
      expect(result.total).toBe(3);
      expect(result.hasMore).toBe(false);
    });
  });

  describe('getReceiptById', () => {
    it('should retrieve receipt with extracted fields', async () => {
      const receiptId = await createTestReceipt(db, {
        organization_id: 'org-1',
        uploaded_by: 'user-1',
        status: 'processed',
        total_amount: 25.99,
        merchant_name: 'Test Store'
      });

      await createTestExtractedFields(db, receiptId);

      const receipt = await receiptService.getReceiptById(receiptId, 'org-1');

      expect(receipt).toBeDefined();
      expect(receipt!.id).toBe(receiptId);
      expect(receipt!.extractedFields).toHaveLength(2);
    });

    it('should return null for non-existent receipt', async () => {
      const receipt = await receiptService.getReceiptById('non-existent', 'org-1');
      expect(receipt).toBeNull();
    });

    it('should not return receipts from other organizations', async () => {
      const receiptId = await createTestReceipt(db, {
        organization_id: 'org-2',
        uploaded_by: 'user-1'
      });

      const receipt = await receiptService.getReceiptById(receiptId, 'org-1');
      expect(receipt).toBeNull();
    });
  });

  describe('updateExtractedField', () => {
    it('should update field value and mark as verified', async () => {
      const receiptId = await createTestReceipt(db, {
        organization_id: 'org-1',
        uploaded_by: 'user-1',
        total_amount: 25.99
      });

      const fieldId = await createTestExtractedField(db, receiptId, {
        field_name: 'total',
        field_value: '25.99',
        confidence_score: 0.8
      });

      await receiptService.updateExtractedField(
        receiptId,
        'org-1',
        'total',
        '26.50',
        'user-1'
      );

      const updatedField = await db('extracted_fields')
        .where('id', fieldId)
        .first();

      expect(updatedField.field_value).toBe('26.50');
      expect(updatedField.verified).toBe(true);
      expect(updatedField.verified_by).toBe('user-1');

      // Verify receipt total was updated
      const updatedReceipt = await db('receipts')
        .where('id', receiptId)
        .first();
      expect(updatedReceipt.total_amount).toBe(26.50);
    });
  });

  describe('deleteReceipt', () => {
    it('should delete receipt and related records', async () => {
      const receiptId = await createTestReceipt(db, {
        organization_id: 'org-1',
        uploaded_by: 'user-1'
      });

      await createTestExtractedFields(db, receiptId);

      await receiptService.deleteReceipt(receiptId, 'org-1', 'user-1');

      // Verify receipt was deleted
      const receipt = await db('receipts').where('id', receiptId).first();
      expect(receipt).toBeUndefined();

      // Verify extracted fields were deleted (cascade)
      const fields = await db('extracted_fields').where('receipt_id', receiptId);
      expect(fields).toHaveLength(0);
    });

    it('should throw error for non-existent receipt', async () => {
      await expect(receiptService.deleteReceipt('non-existent', 'org-1', 'user-1'))
        .rejects.toThrow('Receipt not found');
    });
  });

  describe('getProcessingStatus', () => {
    it('should return current processing status', async () => {
      const receiptId = await createTestReceipt(db, {
        organization_id: 'org-1',
        uploaded_by: 'user-1',
        status: 'processing'
      });

      const status = await receiptService.getProcessingStatus(receiptId, 'org-1');

      expect(status.status).toBe('processing');
      expect(status.lastUpdated).toBeDefined();
    });

    it('should return processing errors if any', async () => {
      const receiptId = await createTestReceipt(db, {
        organization_id: 'org-1',
        uploaded_by: 'user-1',
        status: 'failed',
        processing_errors: JSON.stringify([{ error: 'OCR failed', timestamp: new Date() }])
      });

      const status = await receiptService.getProcessingStatus(receiptId, 'org-1');

      expect(status.status).toBe('failed');
      expect(status.processingErrors).toHaveLength(1);
      expect(status.processingErrors![0].error).toBe('OCR failed');
    });
  });
});

// Helper functions
function createMockFile(
  name: string, 
  mimeType: string, 
  size: number
): Express.Multer.File {
  const buffer = Buffer.alloc(size);
  return {
    fieldname: 'receipts',
    originalname: name,
    encoding: '7bit',
    mimetype: mimeType,
    size,
    buffer,
    destination: '/tmp',
    filename: name,
    path: `/tmp/${name}`,
    stream: {} as any,
    hash: 'test-hash-' + Math.random().toString(36).substring(7)
  } as Express.Multer.File;
}

async function createTestTables(db: knex.Knex) {
  // Create minimal test tables
  await db.schema.createTable('users', table => {
    table.string('id').primary();
    table.string('organization_id');
    table.string('email');
    table.string('name');
    table.timestamps(true, true);
  });

  await db.schema.createTable('receipts', table => {
    table.string('id').primary();
    table.string('organization_id');
    table.string('uploaded_by');
    table.string('original_filename');
    table.string('file_path');
    table.string('file_type');
    table.integer('file_size');
    table.string('file_hash');
    table.string('status').defaultTo('uploaded');
    table.timestamp('processed_at');
    table.json('processing_errors');
    table.decimal('total_amount', 15, 2);
    table.string('currency', 3);
    table.timestamp('receipt_date');
    table.string('merchant_name');
    table.json('metadata');
    table.timestamps(true, true);
  });

  await db.schema.createTable('extracted_fields', table => {
    table.string('id').primary();
    table.string('organization_id');
    table.string('receipt_id');
    table.string('field_name');
    table.text('field_value');
    table.string('field_type');
    table.decimal('confidence_score', 5, 4);
    table.json('bounding_box');
    table.boolean('verified').defaultTo(false);
    table.string('verified_by');
    table.timestamp('verified_at');
    table.timestamps(true, true);
  });
}

async function createTestReceipts(db: knex.Knex) {
  await db('receipts').insert([
    {
      id: 'receipt-1',
      organization_id: 'org-1',
      uploaded_by: 'user-1',
      original_filename: 'starbucks.jpg',
      file_path: '/uploads/starbucks.jpg',
      file_type: 'image/jpeg',
      file_size: 100000,
      file_hash: 'hash-1',
      status: 'processed',
      total_amount: 15.50,
      merchant_name: 'Starbucks',
      created_at: new Date('2024-01-15'),
      updated_at: new Date('2024-01-15')
    },
    {
      id: 'receipt-2',
      organization_id: 'org-1',
      uploaded_by: 'user-1',
      original_filename: 'office-depot.pdf',
      file_path: '/uploads/office-depot.pdf',
      file_type: 'application/pdf',
      file_size: 200000,
      file_hash: 'hash-2',
      status: 'processed',
      total_amount: 45.99,
      merchant_name: 'Office Depot',
      created_at: new Date('2024-01-16'),
      updated_at: new Date('2024-01-16')
    },
    {
      id: 'receipt-3',
      organization_id: 'org-1',
      uploaded_by: 'user-2',
      original_filename: 'taxi.jpg',
      file_path: '/uploads/taxi.jpg',
      file_type: 'image/jpeg',
      file_size: 75000,
      file_hash: 'hash-3',
      status: 'processing',
      total_amount: 25.00,
      merchant_name: 'Yellow Cab',
      created_at: new Date('2024-01-17'),
      updated_at: new Date('2024-01-17')
    }
  ]);
}

async function createTestReceipt(db: knex.Knex, data: any): Promise<string> {
  const receiptId = 'test-receipt-' + Math.random().toString(36).substring(7);
  
  await db('receipts').insert({
    id: receiptId,
    original_filename: 'test.jpg',
    file_path: '/uploads/test.jpg',
    file_type: 'image/jpeg',
    file_size: 100000,
    file_hash: 'test-hash',
    created_at: new Date(),
    updated_at: new Date(),
    ...data
  });

  return receiptId;
}

async function createTestExtractedField(
  db: knex.Knex, 
  receiptId: string, 
  data: any
): Promise<string> {
  const fieldId = 'field-' + Math.random().toString(36).substring(7);
  
  await db('extracted_fields').insert({
    id: fieldId,
    organization_id: 'org-1',
    receipt_id: receiptId,
    field_type: 'text',
    confidence_score: 0.9,
    verified: false,
    created_at: new Date(),
    updated_at: new Date(),
    ...data
  });

  return fieldId;
}

async function createTestExtractedFields(db: knex.Knex, receiptId: string) {
  await db('extracted_fields').insert([
    {
      id: 'field-1',
      organization_id: 'org-1',
      receipt_id: receiptId,
      field_name: 'total',
      field_value: '25.99',
      field_type: 'amount',
      confidence_score: 0.95,
      verified: false,
      created_at: new Date(),
      updated_at: new Date()
    },
    {
      id: 'field-2',
      organization_id: 'org-1',
      receipt_id: receiptId,
      field_name: 'merchant_name',
      field_value: 'Test Store',
      field_type: 'text',
      confidence_score: 0.90,
      verified: false,
      created_at: new Date(),
      updated_at: new Date()
    }
  ]);
}