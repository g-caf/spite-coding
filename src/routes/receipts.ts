/**
 * Receipt API Routes
 * RESTful API endpoints for receipt management
 */

import express from 'express';
import { body, param, query, validationResult } from 'express-validator';
import knex from 'knex';
import winston from 'winston';
import ReceiptService from '../services/receiptService';
import { 
  uploadSingle, 
  uploadMultiple, 
  uploadEmailAttachments,
  processUploadedFiles,
  handleUploadError,
  cleanupTempFiles
} from '../middleware/upload';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/receipt-api.log' })
  ]
});

export function createReceiptRoutes(db: knex.Knex) {
  const router = express.Router();
  const receiptService = new ReceiptService(db);

  // Middleware to check authentication and organization access
  const requireAuth = (req: any, res: any, next: any) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!req.user.organizationId) {
      return res.status(403).json({ error: 'Organization access required' });
    }
    next();
  };

  // Middleware to check permissions
  const requirePermission = (resource: string, action: string) => {
    return (req: any, res: any, next: any) => {
      // This would integrate with your existing permission system
      // For now, we'll assume all authenticated users have basic permissions
      if (!req.user.permissions || !req.user.permissions[resource]?.includes(action)) {
        return res.status(403).json({ error: `Permission denied: ${action} on ${resource}` });
      }
      next();
    };
  };

  // Validation middleware
  const handleValidationErrors = (req: any, res: any, next: any) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }
    next();
  };

  /**
   * POST /api/receipts/upload
   * Upload single receipt file
   */
  router.post('/upload',
    requireAuth,
    requirePermission('receipts', 'create'),
    uploadSingle,
    processUploadedFiles,
    [
      body('metadata').optional().isObject(),
      body('tags').optional().isArray()
    ],
    handleValidationErrors,
    async (req: any, res: any, next: any) => {
      try {
        if (!req.file) {
          return res.status(400).json({ error: 'No file uploaded' });
        }

        const metadata = {
          ...req.body.metadata,
          tags: req.body.tags || [],
          uploadSource: 'web_interface'
        };

        const result = await receiptService.processUpload(
          req.user.organizationId,
          req.user.id,
          req.file,
          metadata
        );

        logger.info(`Receipt upload processed`, {
          userId: req.user.id,
          organizationId: req.user.organizationId,
          result: result.status,
          receiptId: result.receiptId
        });

        res.status(201).json({
          success: true,
          receiptId: result.receiptId,
          status: result.status,
          processingTime: result.processingTime,
          ocrResult: result.ocrResult,
          error: result.error,
          duplicateOf: result.duplicateOf
        });

      } catch (error) {
        logger.error(`Receipt upload failed`, {
          userId: req.user?.id,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        next(error);
      }
    }
  );

  /**
   * POST /api/receipts/upload/multiple
   * Upload multiple receipt files
   */
  router.post('/upload/multiple',
    requireAuth,
    requirePermission('receipts', 'create'),
    uploadMultiple,
    processUploadedFiles,
    [
      body('metadata').optional().isObject(),
      body('tags').optional().isArray()
    ],
    handleValidationErrors,
    async (req: any, res: any, next: any) => {
      try {
        if (!req.files || req.files.length === 0) {
          return res.status(400).json({ error: 'No files uploaded' });
        }

        const metadata = {
          ...req.body.metadata,
          tags: req.body.tags || [],
          uploadSource: 'web_interface'
        };

        const results = [];

        for (const file of req.files as Express.Multer.File[]) {
          const result = await receiptService.processUpload(
            req.user.organizationId,
            req.user.id,
            file,
            metadata
          );
          results.push(result);
        }

        const successful = results.filter(r => r.status === 'success');
        const failed = results.filter(r => r.status === 'failed');
        const duplicates = results.filter(r => r.status === 'duplicate');

        logger.info(`Multiple receipt upload processed`, {
          userId: req.user.id,
          organizationId: req.user.organizationId,
          total: results.length,
          successful: successful.length,
          failed: failed.length,
          duplicates: duplicates.length
        });

        res.status(201).json({
          success: true,
          summary: {
            total: results.length,
            successful: successful.length,
            failed: failed.length,
            duplicates: duplicates.length
          },
          results
        });

      } catch (error) {
        logger.error(`Multiple receipt upload failed`, {
          userId: req.user?.id,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        next(error);
      }
    }
  );

  /**
   * POST /api/receipts/email
   * Process receipt from email
   */
  router.post('/email',
    requireAuth,
    requirePermission('receipts', 'create'),
    uploadEmailAttachments,
    processUploadedFiles,
    [
      body('from').isEmail().normalizeEmail(),
      body('subject').isString().isLength({ min: 1, max: 200 }),
      body('body').isString().isLength({ max: 5000 })
    ],
    handleValidationErrors,
    async (req: any, res: any, next: any) => {
      try {
        const emailData = {
          from: req.body.from,
          subject: req.body.subject,
          body: req.body.body,
          attachments: req.files as Express.Multer.File[] || []
        };

        const results = await receiptService.processEmailReceipt(
          req.user.organizationId,
          emailData
        );

        logger.info(`Email receipt processed`, {
          organizationId: req.user.organizationId,
          from: emailData.from,
          attachmentCount: emailData.attachments.length,
          processedCount: results.length
        });

        res.status(201).json({
          success: true,
          processedCount: results.length,
          results
        });

      } catch (error) {
        logger.error(`Email receipt processing failed`, {
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        next(error);
      }
    }
  );

  /**
   * GET /api/receipts
   * Search and list receipts
   */
  router.get('/',
    requireAuth,
    requirePermission('receipts', 'read'),
    [
      query('status').optional().isIn(['uploaded', 'processing', 'processed', 'failed', 'matched']),
      query('merchant').optional().isString().isLength({ max: 100 }),
      query('dateFrom').optional().isISO8601(),
      query('dateTo').optional().isISO8601(),
      query('amountMin').optional().isFloat({ min: 0 }),
      query('amountMax').optional().isFloat({ min: 0 }),
      query('tags').optional().isString(),
      query('limit').optional().isInt({ min: 1, max: 100 }),
      query('offset').optional().isInt({ min: 0 })
    ],
    handleValidationErrors,
    async (req: any, res: any, next: any) => {
      try {
        const params = {
          organizationId: req.user.organizationId,
          userId: req.query.userId,
          status: req.query.status,
          merchantName: req.query.merchant,
          dateFrom: req.query.dateFrom ? new Date(req.query.dateFrom) : undefined,
          dateTo: req.query.dateTo ? new Date(req.query.dateTo) : undefined,
          amountMin: req.query.amountMin ? parseFloat(req.query.amountMin) : undefined,
          amountMax: req.query.amountMax ? parseFloat(req.query.amountMax) : undefined,
          tags: req.query.tags ? req.query.tags.split(',') : undefined,
          limit: req.query.limit ? parseInt(req.query.limit) : 50,
          offset: req.query.offset ? parseInt(req.query.offset) : 0
        };

        const result = await receiptService.searchReceipts(params);

        res.json({
          success: true,
          data: result.receipts,
          pagination: {
            total: result.total,
            limit: params.limit,
            offset: params.offset,
            hasMore: result.hasMore
          }
        });

      } catch (error) {
        logger.error(`Receipt search failed`, {
          userId: req.user?.id,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        next(error);
      }
    }
  );

  /**
   * GET /api/receipts/:id
   * Get receipt details by ID
   */
  router.get('/:id',
    requireAuth,
    requirePermission('receipts', 'read'),
    [
      param('id').isUUID()
    ],
    handleValidationErrors,
    async (req: any, res: any, next: any) => {
      try {
        const receipt = await receiptService.getReceiptById(
          req.params.id,
          req.user.organizationId
        );

        if (!receipt) {
          return res.status(404).json({ error: 'Receipt not found' });
        }

        res.json({
          success: true,
          data: receipt
        });

      } catch (error) {
        logger.error(`Get receipt failed`, {
          receiptId: req.params.id,
          userId: req.user?.id,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        next(error);
      }
    }
  );

  /**
   * PUT /api/receipts/:id/fields
   * Update extracted field values
   */
  router.put('/:id/fields',
    requireAuth,
    requirePermission('receipts', 'update'),
    [
      param('id').isUUID(),
      body('fieldName').isString().isLength({ min: 1, max: 50 }),
      body('fieldValue').isString().isLength({ min: 1, max: 500 })
    ],
    handleValidationErrors,
    async (req: any, res: any, next: any) => {
      try {
        await receiptService.updateExtractedField(
          req.params.id,
          req.user.organizationId,
          req.body.fieldName,
          req.body.fieldValue,
          req.user.id
        );

        logger.info(`Receipt field updated`, {
          receiptId: req.params.id,
          fieldName: req.body.fieldName,
          userId: req.user.id
        });

        res.json({
          success: true,
          message: 'Field updated successfully'
        });

      } catch (error) {
        logger.error(`Field update failed`, {
          receiptId: req.params.id,
          fieldName: req.body.fieldName,
          userId: req.user?.id,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        next(error);
      }
    }
  );

  /**
   * GET /api/receipts/:id/status
   * Get receipt processing status
   */
  router.get('/:id/status',
    requireAuth,
    requirePermission('receipts', 'read'),
    [
      param('id').isUUID()
    ],
    handleValidationErrors,
    async (req: any, res: any, next: any) => {
      try {
        const status = await receiptService.getProcessingStatus(
          req.params.id,
          req.user.organizationId
        );

        res.json({
          success: true,
          data: status
        });

      } catch (error) {
        logger.error(`Get status failed`, {
          receiptId: req.params.id,
          userId: req.user?.id,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        
        if (error instanceof Error && error.message === 'Receipt not found') {
          return res.status(404).json({ error: 'Receipt not found' });
        }
        
        next(error);
      }
    }
  );

  /**
   * DELETE /api/receipts/:id
   * Delete receipt
   */
  router.delete('/:id',
    requireAuth,
    requirePermission('receipts', 'delete'),
    [
      param('id').isUUID()
    ],
    handleValidationErrors,
    async (req: any, res: any, next: any) => {
      try {
        await receiptService.deleteReceipt(
          req.params.id,
          req.user.organizationId,
          req.user.id
        );

        logger.info(`Receipt deleted`, {
          receiptId: req.params.id,
          userId: req.user.id,
          organizationId: req.user.organizationId
        });

        res.json({
          success: true,
          message: 'Receipt deleted successfully'
        });

      } catch (error) {
        logger.error(`Receipt deletion failed`, {
          receiptId: req.params.id,
          userId: req.user?.id,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        
        if (error instanceof Error && error.message === 'Receipt not found') {
          return res.status(404).json({ error: 'Receipt not found' });
        }
        
        next(error);
      }
    }
  );

  /**
   * GET /api/receipts/search
   * Advanced receipt search with content matching
   */
  router.get('/search',
    requireAuth,
    requirePermission('receipts', 'read'),
    [
      query('q').isString().isLength({ min: 1, max: 200 }),
      query('fields').optional().isString(),
      query('limit').optional().isInt({ min: 1, max: 100 }),
      query('offset').optional().isInt({ min: 0 })
    ],
    handleValidationErrors,
    async (req: any, res: any, next: any) => {
      try {
        const searchQuery = req.query.q as string;
        const searchFields = req.query.fields ? 
          (req.query.fields as string).split(',') : 
          ['merchant_name', 'extracted_fields.field_value'];
        
        const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
        const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;

        // Build full-text search query
        const receipts = await db('receipts as r')
          .leftJoin('extracted_fields as ef', 'r.id', 'ef.receipt_id')
          .leftJoin('users as u', 'r.uploaded_by', 'u.id')
          .where('r.organization_id', req.user.organizationId)
          .andWhere(function() {
            this.where('r.merchant_name', 'ilike', `%${searchQuery}%`)
                .orWhere('r.original_filename', 'ilike', `%${searchQuery}%`)
                .orWhere('ef.field_value', 'ilike', `%${searchQuery}%`);
          })
          .select(
            'r.*',
            'u.name as uploader_name',
            db.raw('array_agg(DISTINCT jsonb_build_object(\'fieldName\', ef.field_name, \'fieldValue\', ef.field_value, \'confidence\', ef.confidence_score)) as extracted_fields')
          )
          .groupBy('r.id', 'u.name')
          .orderBy('r.created_at', 'desc')
          .limit(limit)
          .offset(offset);

        // Get total count
        const [{ count }] = await db('receipts as r')
          .leftJoin('extracted_fields as ef', 'r.id', 'ef.receipt_id')
          .where('r.organization_id', req.user.organizationId)
          .andWhere(function() {
            this.where('r.merchant_name', 'ilike', `%${searchQuery}%`)
                .orWhere('r.original_filename', 'ilike', `%${searchQuery}%`)
                .orWhere('ef.field_value', 'ilike', `%${searchQuery}%`);
          })
          .countDistinct('r.id as count');

        const total = parseInt(count as string, 10);

        res.json({
          success: true,
          data: receipts,
          pagination: {
            total,
            limit,
            offset,
            hasMore: offset + receipts.length < total
          },
          searchQuery
        });

      } catch (error) {
        logger.error(`Receipt search failed`, {
          searchQuery: req.query.q,
          userId: req.user?.id,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        next(error);
      }
    }
  );

  // Error handling middleware
  router.use(handleUploadError);
  router.use(cleanupTempFiles);

  // Global error handler
  router.use((error: any, req: any, res: any, next: any) => {
    logger.error(`Receipt API error`, {
      path: req.path,
      method: req.method,
      userId: req.user?.id,
      error: error.message,
      stack: error.stack
    });

    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
    });
  });

  return router;
}

export default createReceiptRoutes;