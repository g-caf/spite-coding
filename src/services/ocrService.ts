/**
 * OCR Service with AWS Textract Integration
 * Extracts structured data from receipt images and PDFs
 */

import { 
  TextractClient, 
  AnalyzeExpenseCommand,
  AnalyzeDocumentCommand,
  GetDocumentAnalysisCommand,
  StartDocumentAnalysisCommand,
  DocumentLocation
} from '@aws-sdk/client-textract';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import winston from 'winston';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/ocr.log' })
  ]
});

// Configure AWS clients
const textractClient = new TextractClient({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

export interface ExtractedField {
  fieldName: string;
  fieldValue: string;
  fieldType: 'amount' | 'date' | 'text' | 'phone' | 'address';
  confidence: number;
  boundingBox?: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
  verified: boolean;
}

export interface OCRResult {
  receiptId: string;
  organizationId: string;
  totalAmount?: number;
  currency?: string;
  receiptDate?: Date;
  merchantName?: string;
  extractedFields: ExtractedField[];
  rawOCRData: any;
  confidence: number;
  processingTime: number;
  lineItems?: LineItem[];
  taxAmount?: number;
  tipAmount?: number;
}

export interface LineItem {
  description: string;
  quantity?: number;
  unitPrice?: number;
  totalPrice: number;
  category?: string;
  confidence: number;
}

export class OCRService {
  private readonly maxRetries = 3;
  private readonly retryDelay = 2000; // 2 seconds

  /**
   * Process receipt image/PDF and extract structured data
   */
  async processReceipt(
    receiptId: string,
    organizationId: string,
    filePath: string,
    mimeType: string
  ): Promise<OCRResult> {
    const startTime = Date.now();
    
    try {
      logger.info(`Starting OCR processing for receipt ${receiptId}`, {
        receiptId,
        organizationId,
        filePath,
        mimeType
      });

      let ocrData: any;

      if (mimeType === 'application/pdf' || filePath.endsWith('.pdf')) {
        // For PDFs, use asynchronous analysis for better accuracy
        ocrData = await this.processLargeDocument(filePath);
      } else {
        // For images, use synchronous expense analysis for speed
        ocrData = await this.processReceiptImage(filePath);
      }

      const result = await this.parseOCRData(ocrData, receiptId, organizationId);
      result.processingTime = Date.now() - startTime;

      logger.info(`OCR processing completed for receipt ${receiptId}`, {
        receiptId,
        processingTime: result.processingTime,
        confidence: result.confidence,
        fieldsExtracted: result.extractedFields.length
      });

      return result;

    } catch (error) {
      logger.error(`OCR processing failed for receipt ${receiptId}`, {
        receiptId,
        error: error instanceof Error ? error.message : 'Unknown error',
        processingTime: Date.now() - startTime
      });
      throw error;
    }
  }

  /**
   * Process receipt image using Textract AnalyzeExpense API
   */
  private async processReceiptImage(filePath: string): Promise<any> {
    const document = await this.getDocumentFromS3(filePath);
    
    const command = new AnalyzeExpenseCommand({
      Document: document
    });

    const response = await textractClient.send(command);
    return response;
  }

  /**
   * Process large document (PDF) using asynchronous analysis
   */
  private async processLargeDocument(filePath: string): Promise<any> {
    const documentLocation: DocumentLocation = {
      S3Object: {
        Bucket: process.env.S3_BUCKET_NAME!,
        Name: filePath.replace(/^\//, '') // Remove leading slash if present
      }
    };

    // Start asynchronous analysis
    const startCommand = new StartDocumentAnalysisCommand({
      DocumentLocation: documentLocation,
      FeatureTypes: ['TABLES', 'FORMS']
    });

    const startResponse = await textractClient.send(startCommand);
    const jobId = startResponse.JobId;

    if (!jobId) {
      throw new Error('Failed to start document analysis job');
    }

    // Poll for completion
    let status = 'IN_PROGRESS';
    let attempts = 0;
    const maxAttempts = 30; // 30 attempts with 2-second delays = 60 seconds max

    while (status === 'IN_PROGRESS' && attempts < maxAttempts) {
      await this.sleep(this.retryDelay);
      
      const getCommand = new GetDocumentAnalysisCommand({ JobId: jobId });
      const getResponse = await textractClient.send(getCommand);
      
      status = getResponse.JobStatus || 'FAILED';
      
      if (status === 'SUCCEEDED') {
        return getResponse;
      } else if (status === 'FAILED') {
        throw new Error('Document analysis failed');
      }
      
      attempts++;
    }

    throw new Error('Document analysis timed out');
  }

  /**
   * Get document content from S3 or local file
   */
  private async getDocumentFromS3(filePath: string): Promise<{ Bytes?: Uint8Array; S3Object?: any }> {
    if (process.env.NODE_ENV === 'production') {
      // For S3 storage, return S3Object reference
      return {
        S3Object: {
          Bucket: process.env.S3_BUCKET_NAME!,
          Name: filePath.replace(/^\//, '') // Remove leading slash if present
        }
      };
    } else {
      // For local storage, read file content
      const fs = require('fs').promises;
      const fileBuffer = await fs.readFile(filePath);
      return { Bytes: new Uint8Array(fileBuffer) };
    }
  }

  /**
   * Parse OCR data into structured format
   */
  private async parseOCRData(ocrData: any, receiptId: string, organizationId: string): Promise<OCRResult> {
    const result: OCRResult = {
      receiptId,
      organizationId,
      extractedFields: [],
      rawOCRData: ocrData,
      confidence: 0,
      processingTime: 0,
      lineItems: []
    };

    if (ocrData.ExpenseDocuments && ocrData.ExpenseDocuments.length > 0) {
      // Parse AnalyzeExpense response
      const expenseDoc = ocrData.ExpenseDocuments[0];
      result.confidence = this.calculateOverallConfidence(expenseDoc);

      // Extract summary fields
      if (expenseDoc.SummaryFields) {
        for (const field of expenseDoc.SummaryFields) {
          const extractedField = this.parseExpenseField(field);
          if (extractedField) {
            result.extractedFields.push(extractedField);
            
            // Map to standard fields
            switch (extractedField.fieldName.toLowerCase()) {
              case 'total':
              case 'amount_paid':
                result.totalAmount = this.parseAmount(extractedField.fieldValue);
                break;
              case 'vendor_name':
              case 'merchant_name':
                result.merchantName = extractedField.fieldValue;
                break;
              case 'invoice_receipt_date':
              case 'receipt_date':
                result.receiptDate = this.parseDate(extractedField.fieldValue);
                break;
              case 'tax':
                result.taxAmount = this.parseAmount(extractedField.fieldValue);
                break;
              case 'tip':
                result.tipAmount = this.parseAmount(extractedField.fieldValue);
                break;
            }
          }
        }
      }

      // Extract line items
      if (expenseDoc.LineItemGroups) {
        result.lineItems = this.parseLineItems(expenseDoc.LineItemGroups);
      }

      // Detect currency
      result.currency = this.detectCurrency(result.extractedFields);

    } else if (ocrData.Blocks) {
      // Parse AnalyzeDocument response for PDFs
      result.confidence = this.calculateDocumentConfidence(ocrData.Blocks);
      result.extractedFields = this.parseDocumentBlocks(ocrData.Blocks);
      
      // Extract key fields from parsed blocks
      this.mapDocumentFields(result);
    }

    // Post-processing validation
    this.validateExtractedData(result);

    return result;
  }

  /**
   * Parse expense field from Textract response
   */
  private parseExpenseField(field: any): ExtractedField | null {
    if (!field.Type?.Text || !field.ValueDetection?.Text) {
      return null;
    }

    const fieldName = field.Type.Text.toLowerCase().replace(/\s+/g, '_');
    const fieldValue = field.ValueDetection.Text;
    const confidence = field.ValueDetection.Confidence / 100;

    let fieldType: ExtractedField['fieldType'] = 'text';
    
    // Determine field type based on content
    if (fieldName.includes('total') || fieldName.includes('amount') || fieldName.includes('price')) {
      fieldType = 'amount';
    } else if (fieldName.includes('date')) {
      fieldType = 'date';
    } else if (fieldName.includes('phone')) {
      fieldType = 'phone';
    } else if (fieldName.includes('address')) {
      fieldType = 'address';
    }

    const boundingBox = field.ValueDetection.Geometry?.BoundingBox ? {
      left: field.ValueDetection.Geometry.BoundingBox.Left,
      top: field.ValueDetection.Geometry.BoundingBox.Top,
      width: field.ValueDetection.Geometry.BoundingBox.Width,
      height: field.ValueDetection.Geometry.BoundingBox.Height
    } : undefined;

    return {
      fieldName,
      fieldValue,
      fieldType,
      confidence,
      boundingBox,
      verified: false
    };
  }

  /**
   * Parse line items from expense document
   */
  private parseLineItems(lineItemGroups: any[]): LineItem[] {
    const lineItems: LineItem[] = [];

    for (const group of lineItemGroups) {
      if (group.LineItems) {
        for (const item of group.LineItems) {
          const lineItem: LineItem = {
            description: '',
            totalPrice: 0,
            confidence: 0
          };

          let confidenceSum = 0;
          let confidenceCount = 0;

          for (const field of item.LineItemExpenseFields || []) {
            const fieldName = field.Type?.Text?.toLowerCase();
            const fieldValue = field.ValueDetection?.Text;
            const fieldConfidence = field.ValueDetection?.Confidence / 100;

            if (fieldConfidence) {
              confidenceSum += fieldConfidence;
              confidenceCount++;
            }

            switch (fieldName) {
              case 'item':
              case 'description':
                lineItem.description = fieldValue || '';
                break;
              case 'quantity':
                lineItem.quantity = this.parseNumber(fieldValue);
                break;
              case 'price':
              case 'unit_price':
                lineItem.unitPrice = this.parseAmount(fieldValue);
                break;
              case 'product_code':
                // Could be used for categorization
                break;
            }
          }

          // Calculate total price if not directly available
          if (!lineItem.totalPrice && lineItem.quantity && lineItem.unitPrice) {
            lineItem.totalPrice = lineItem.quantity * lineItem.unitPrice;
          }

          lineItem.confidence = confidenceCount > 0 ? confidenceSum / confidenceCount : 0;

          if (lineItem.description && lineItem.totalPrice > 0) {
            lineItems.push(lineItem);
          }
        }
      }
    }

    return lineItems;
  }

  /**
   * Parse document blocks for PDFs
   */
  private parseDocumentBlocks(blocks: any[]): ExtractedField[] {
    const extractedFields: ExtractedField[] = [];
    const keyValuePairs = this.extractKeyValuePairs(blocks);

    for (const [key, value] of keyValuePairs) {
      const fieldName = key.toLowerCase().replace(/[^a-z0-9]/g, '_');
      
      let fieldType: ExtractedField['fieldType'] = 'text';
      if (this.isAmountField(key)) {
        fieldType = 'amount';
      } else if (this.isDateField(key)) {
        fieldType = 'date';
      }

      extractedFields.push({
        fieldName,
        fieldValue: value,
        fieldType,
        confidence: 0.8, // Default confidence for document analysis
        verified: false
      });
    }

    return extractedFields;
  }

  /**
   * Extract key-value pairs from document blocks
   */
  private extractKeyValuePairs(blocks: any[]): Map<string, string> {
    const keyValuePairs = new Map<string, string>();
    
    // This is a simplified implementation
    // In production, you'd implement more sophisticated text analysis
    const textLines = blocks
      .filter(block => block.BlockType === 'LINE')
      .map(block => block.Text)
      .filter(text => text && text.trim());

    for (const line of textLines) {
      // Look for patterns like "Total: $25.99" or "Date: 01/15/2024"
      const colonMatch = line.match(/^([^:]+):\s*(.+)$/);
      if (colonMatch) {
        const [, key, value] = colonMatch;
        keyValuePairs.set(key.trim(), value.trim());
      }
    }

    return keyValuePairs;
  }

  /**
   * Helper methods
   */
  private calculateOverallConfidence(expenseDoc: any): number {
    let confidenceSum = 0;
    let confidenceCount = 0;

    if (expenseDoc.SummaryFields) {
      for (const field of expenseDoc.SummaryFields) {
        if (field.ValueDetection?.Confidence) {
          confidenceSum += field.ValueDetection.Confidence;
          confidenceCount++;
        }
      }
    }

    return confidenceCount > 0 ? (confidenceSum / confidenceCount) / 100 : 0;
  }

  private calculateDocumentConfidence(blocks: any[]): number {
    const confidences = blocks
      .filter(block => block.Confidence)
      .map(block => block.Confidence);

    return confidences.length > 0 ? 
      confidences.reduce((sum, conf) => sum + conf, 0) / (confidences.length * 100) : 0;
  }

  private parseAmount(value: string): number | undefined {
    if (!value) return undefined;
    
    // Remove currency symbols and spaces
    const cleanValue = value.replace(/[$£€¥₹,\s]/g, '');
    const amount = parseFloat(cleanValue);
    
    return isNaN(amount) ? undefined : Math.round(amount * 100) / 100; // Round to 2 decimal places
  }

  private parseNumber(value: string): number | undefined {
    if (!value) return undefined;
    
    const number = parseFloat(value.replace(/[,\s]/g, ''));
    return isNaN(number) ? undefined : number;
  }

  private parseDate(value: string): Date | undefined {
    if (!value) return undefined;

    // Try multiple date formats
    const dateFormats = [
      /(\d{1,2})\/(\d{1,2})\/(\d{4})/, // MM/DD/YYYY
      /(\d{4})-(\d{2})-(\d{2})/, // YYYY-MM-DD
      /(\d{1,2})-(\d{1,2})-(\d{4})/, // MM-DD-YYYY
      /(\d{1,2})\.(\d{1,2})\.(\d{4})/, // MM.DD.YYYY
    ];

    for (const format of dateFormats) {
      const match = value.match(format);
      if (match) {
        const date = new Date(value);
        if (!isNaN(date.getTime())) {
          return date;
        }
      }
    }

    // Try natural language parsing
    const date = new Date(value);
    return isNaN(date.getTime()) ? undefined : date;
  }

  private detectCurrency(fields: ExtractedField[]): string {
    // Look for currency symbols in field values
    for (const field of fields) {
      if (field.fieldType === 'amount') {
        if (field.fieldValue.includes('$')) return 'USD';
        if (field.fieldValue.includes('£')) return 'GBP';
        if (field.fieldValue.includes('€')) return 'EUR';
        if (field.fieldValue.includes('¥')) return 'JPY';
        if (field.fieldValue.includes('₹')) return 'INR';
      }
    }
    
    return 'USD'; // Default currency
  }

  private isAmountField(key: string): boolean {
    const amountKeywords = ['total', 'amount', 'price', 'cost', 'tax', 'tip', 'subtotal', 'balance'];
    return amountKeywords.some(keyword => key.toLowerCase().includes(keyword));
  }

  private isDateField(key: string): boolean {
    const dateKeywords = ['date', 'time', 'timestamp'];
    return dateKeywords.some(keyword => key.toLowerCase().includes(keyword));
  }

  private mapDocumentFields(result: OCRResult): void {
    for (const field of result.extractedFields) {
      switch (field.fieldName.toLowerCase()) {
        case 'total':
        case 'amount':
        case 'balance_due':
          result.totalAmount = this.parseAmount(field.fieldValue);
          break;
        case 'vendor':
        case 'merchant':
        case 'company':
          result.merchantName = field.fieldValue;
          break;
        case 'date':
        case 'invoice_date':
          result.receiptDate = this.parseDate(field.fieldValue);
          break;
        case 'tax':
          result.taxAmount = this.parseAmount(field.fieldValue);
          break;
      }
    }
  }

  private validateExtractedData(result: OCRResult): void {
    // Validate amounts
    if (result.totalAmount !== undefined) {
      if (result.totalAmount < 0 || result.totalAmount > 10000) {
        logger.warn(`Suspicious total amount: ${result.totalAmount}`, {
          receiptId: result.receiptId
        });
      }
    }

    // Validate dates
    if (result.receiptDate) {
      const now = new Date();
      const oneYearAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      if (result.receiptDate < oneYearAgo || result.receiptDate > tomorrow) {
        logger.warn(`Suspicious receipt date: ${result.receiptDate}`, {
          receiptId: result.receiptId
        });
      }
    }

    // Validate field consistency
    const lineItemTotal = result.lineItems?.reduce((sum, item) => sum + item.totalPrice, 0);
    if (lineItemTotal && result.totalAmount && Math.abs(lineItemTotal - result.totalAmount) > 0.01) {
      logger.warn(`Line item total (${lineItemTotal}) doesn't match receipt total (${result.totalAmount})`, {
        receiptId: result.receiptId
      });
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Update field confidence after human verification
   */
  async updateFieldVerification(
    receiptId: string,
    fieldName: string,
    isCorrect: boolean,
    correctedValue?: string
  ): Promise<void> {
    // This would update the extracted_fields table
    // Implementation depends on your database layer
    logger.info(`Field verification updated`, {
      receiptId,
      fieldName,
      isCorrect,
      correctedValue
    });
  }

  /**
   * Reprocess receipt with updated parameters
   */
  async reprocessReceipt(
    receiptId: string,
    organizationId: string,
    filePath: string,
    mimeType: string,
    options: { enhancedAccuracy?: boolean; customModel?: string } = {}
  ): Promise<OCRResult> {
    logger.info(`Reprocessing receipt ${receiptId}`, options);
    return this.processReceipt(receiptId, organizationId, filePath, mimeType);
  }
}