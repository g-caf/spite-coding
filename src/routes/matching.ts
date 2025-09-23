/**
 * Matching API Routes
 * Provides REST endpoints for the intelligent matching engine
 */

import { Router, Request, Response } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { matchingService } from '../services/matching/matchingService.js';
import { logger } from '../utils/logger.js';
import { authenticateUser, requireOrganization } from '../middleware/auth.js';

const router = Router();

// Apply authentication to all routes
router.use(authenticateUser);
router.use(requireOrganization);

/**
 * POST /api/matching/auto
 * Perform automatic matching for new items
 */
router.post('/auto', 
  body('transactions').isArray().withMessage('Transactions must be an array'),
  body('receipts').isArray().withMessage('Receipts must be an array'),
  body('config').optional().isObject().withMessage('Config must be an object'),
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ 
          success: false, 
          error: 'Validation failed', 
          details: errors.array() 
        });
      }

      const { transactions, receipts, config } = req.body;
      const organizationId = req.user?.organization_id;

      if (!organizationId) {
        return res.status(400).json({ 
          success: false, 
          error: 'Organization ID required' 
        });
      }

      logger.info('Auto-matching request received', {
        organization_id: organizationId,
        user_id: req.user?.id,
        transactions_count: transactions.length,
        receipts_count: receipts.length
      });

      const result = await matchingService.performAutoMatching(
        organizationId,
        transactions,
        receipts,
        config
      );

      res.json({
        success: true,
        data: result
      });

    } catch (error) {
      logger.error('Auto-matching error', {
        error: error instanceof Error ? error.message : String(error),
        organization_id: req.user?.organization_id
      });

      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
);

/**
 * GET /api/matching/suggestions/:id
 * Get match suggestions for a specific transaction or receipt
 */
router.get('/suggestions/:id',
  param('id').isUUID().withMessage('Invalid ID format'),
  query('type').isIn(['transaction', 'receipt']).withMessage('Type must be transaction or receipt'),
  query('candidates').optional().isJSON().withMessage('Candidates must be valid JSON'),
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ 
          success: false, 
          error: 'Validation failed', 
          details: errors.array() 
        });
      }

      const { id } = req.params;
      const { type, candidates: candidatesJson, config } = req.query;
      const organizationId = req.user?.organization_id;

      if (!organizationId) {
        return res.status(400).json({ 
          success: false, 
          error: 'Organization ID required' 
        });
      }

      // Parse candidates from query parameter or fetch from database
      let candidates = [];
      if (candidatesJson) {
        try {
          candidates = JSON.parse(candidatesJson as string);
        } catch (error) {
          return res.status(400).json({
            success: false,
            error: 'Invalid candidates JSON format'
          });
        }
      } else {
        // In production, fetch candidates from database based on type
        candidates = []; // Placeholder
      }

      logger.info('Match suggestions request received', {
        organization_id: organizationId,
        user_id: req.user?.id,
        item_id: id,
        item_type: type,
        candidates_count: candidates.length
      });

      const suggestions = await matchingService.getMatchSuggestions(
        organizationId,
        id,
        type as 'transaction' | 'receipt',
        candidates,
        config as any
      );

      res.json({
        success: true,
        data: {
          item_id: id,
          item_type: type,
          suggestions,
          suggestions_count: suggestions.length
        }
      });

    } catch (error) {
      logger.error('Match suggestions error', {
        error: error instanceof Error ? error.message : String(error),
        organization_id: req.user?.organization_id,
        item_id: req.params.id
      });

      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
);

/**
 * POST /api/matching/confirm
 * User confirms a match
 */
router.post('/confirm',
  body('transaction_id').isUUID().withMessage('Invalid transaction ID'),
  body('receipt_id').isUUID().withMessage('Invalid receipt ID'),
  body('match_type').isIn(['auto', 'manual', 'reviewed']).withMessage('Invalid match type'),
  body('confidence').optional().isFloat({ min: 0, max: 1 }).withMessage('Confidence must be between 0 and 1'),
  body('notes').optional().isString().withMessage('Notes must be a string'),
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ 
          success: false, 
          error: 'Validation failed', 
          details: errors.array() 
        });
      }

      const { transaction_id, receipt_id, match_type, confidence, notes } = req.body;
      const organizationId = req.user?.organization_id;
      const userId = req.user?.id;

      if (!organizationId || !userId) {
        return res.status(400).json({ 
          success: false, 
          error: 'Organization ID and User ID required' 
        });
      }

      logger.info('Match confirmation request received', {
        organization_id: organizationId,
        user_id: userId,
        transaction_id,
        receipt_id,
        match_type
      });

      const result = await matchingService.confirmMatch(
        organizationId,
        transaction_id,
        receipt_id,
        match_type,
        userId,
        confidence,
        notes
      );

      res.json({
        success: true,
        data: result
      });

    } catch (error) {
      logger.error('Match confirmation error', {
        error: error instanceof Error ? error.message : String(error),
        organization_id: req.user?.organization_id,
        user_id: req.user?.id
      });

      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
);

/**
 * POST /api/matching/reject
 * User rejects suggestions
 */
router.post('/reject',
  body('transaction_id').isUUID().withMessage('Invalid transaction ID'),
  body('receipt_id').isUUID().withMessage('Invalid receipt ID'),
  body('reason').optional().isString().withMessage('Reason must be a string'),
  body('correct_transaction_id').optional().isUUID().withMessage('Invalid correct transaction ID'),
  body('correct_receipt_id').optional().isUUID().withMessage('Invalid correct receipt ID'),
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ 
          success: false, 
          error: 'Validation failed', 
          details: errors.array() 
        });
      }

      const { 
        transaction_id, 
        receipt_id, 
        reason, 
        correct_transaction_id, 
        correct_receipt_id 
      } = req.body;
      const organizationId = req.user?.organization_id;
      const userId = req.user?.id;

      if (!organizationId || !userId) {
        return res.status(400).json({ 
          success: false, 
          error: 'Organization ID and User ID required' 
        });
      }

      logger.info('Match rejection request received', {
        organization_id: organizationId,
        user_id: userId,
        transaction_id,
        receipt_id,
        has_correction: !!(correct_transaction_id || correct_receipt_id)
      });

      await matchingService.rejectMatch(
        organizationId,
        transaction_id,
        receipt_id,
        userId,
        reason,
        correct_transaction_id,
        correct_receipt_id
      );

      res.json({
        success: true,
        message: 'Match rejection recorded'
      });

    } catch (error) {
      logger.error('Match rejection error', {
        error: error instanceof Error ? error.message : String(error),
        organization_id: req.user?.organization_id,
        user_id: req.user?.id
      });

      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
);

/**
 * GET /api/matching/unmatched
 * Get unmatched transactions and receipts
 */
router.get('/unmatched',
  query('type').optional().isIn(['transactions', 'receipts', 'both']).withMessage('Invalid type'),
  query('limit').optional().isInt({ min: 1, max: 1000 }).withMessage('Limit must be between 1 and 1000'),
  query('offset').optional().isInt({ min: 0 }).withMessage('Offset must be non-negative'),
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ 
          success: false, 
          error: 'Validation failed', 
          details: errors.array() 
        });
      }

      const { type = 'both', limit = 50, offset = 0 } = req.query;
      const organizationId = req.user?.organization_id;

      if (!organizationId) {
        return res.status(400).json({ 
          success: false, 
          error: 'Organization ID required' 
        });
      }

      logger.info('Unmatched items request received', {
        organization_id: organizationId,
        user_id: req.user?.id,
        type,
        limit,
        offset
      });

      const result = await matchingService.getUnmatchedItems(organizationId);

      // Apply pagination and filtering
      const response: any = {};
      
      if (type === 'transactions' || type === 'both') {
        response.transactions = result.transactions.slice(
          Number(offset), 
          Number(offset) + Number(limit)
        );
      }
      
      if (type === 'receipts' || type === 'both') {
        response.receipts = result.receipts.slice(
          Number(offset), 
          Number(offset) + Number(limit)
        );
      }

      response.metadata = {
        total_transactions: result.transactions.length,
        total_receipts: result.receipts.length,
        limit: Number(limit),
        offset: Number(offset)
      };

      res.json({
        success: true,
        data: response
      });

    } catch (error) {
      logger.error('Unmatched items error', {
        error: error instanceof Error ? error.message : String(error),
        organization_id: req.user?.organization_id
      });

      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
);

/**
 * POST /api/matching/bulk
 * Perform bulk matching operation
 */
router.post('/bulk',
  body('batch_size').optional().isInt({ min: 10, max: 1000 }).withMessage('Batch size must be between 10 and 1000'),
  body('config').optional().isObject().withMessage('Config must be an object'),
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ 
          success: false, 
          error: 'Validation failed', 
          details: errors.array() 
        });
      }

      const { batch_size = 100, config } = req.body;
      const organizationId = req.user?.organization_id;

      if (!organizationId) {
        return res.status(400).json({ 
          success: false, 
          error: 'Organization ID required' 
        });
      }

      logger.info('Bulk matching request received', {
        organization_id: organizationId,
        user_id: req.user?.id,
        batch_size
      });

      const result = await matchingService.performBulkMatching(
        organizationId,
        batch_size,
        config
      );

      res.json({
        success: true,
        data: result
      });

    } catch (error) {
      logger.error('Bulk matching error', {
        error: error instanceof Error ? error.message : String(error),
        organization_id: req.user?.organization_id
      });

      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
);

/**
 * GET /api/matching/metrics
 * Get matching performance metrics
 */
router.get('/metrics',
  query('period_days').optional().isInt({ min: 1, max: 365 }).withMessage('Period must be between 1 and 365 days'),
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ 
          success: false, 
          error: 'Validation failed', 
          details: errors.array() 
        });
      }

      const { period_days = 30 } = req.query;
      const organizationId = req.user?.organization_id;

      if (!organizationId) {
        return res.status(400).json({ 
          success: false, 
          error: 'Organization ID required' 
        });
      }

      logger.info('Matching metrics request received', {
        organization_id: organizationId,
        user_id: req.user?.id,
        period_days
      });

      const metrics = await matchingService.getMatchingMetrics(
        organizationId,
        Number(period_days)
      );

      const learningStats = await matchingService.getLearningStats(organizationId);

      res.json({
        success: true,
        data: {
          metrics,
          learning_stats: learningStats
        }
      });

    } catch (error) {
      logger.error('Matching metrics error', {
        error: error instanceof Error ? error.message : String(error),
        organization_id: req.user?.organization_id
      });

      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
);

/**
 * PUT /api/matching/config
 * Update matching configuration with learning
 */
router.put('/config',
  body('apply_learning').optional().isBoolean().withMessage('Apply learning must be boolean'),
  body('manual_config').optional().isObject().withMessage('Manual config must be an object'),
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ 
          success: false, 
          error: 'Validation failed', 
          details: errors.array() 
        });
      }

      const { apply_learning = true, manual_config } = req.body;
      const organizationId = req.user?.organization_id;

      if (!organizationId) {
        return res.status(400).json({ 
          success: false, 
          error: 'Organization ID required' 
        });
      }

      logger.info('Config update request received', {
        organization_id: organizationId,
        user_id: req.user?.id,
        apply_learning,
        has_manual_config: !!manual_config
      });

      let updatedConfig;
      
      if (apply_learning) {
        updatedConfig = await matchingService.updateConfigWithLearning(organizationId);
      }
      
      if (manual_config) {
        // Apply manual configuration overrides
        // In production, this would merge with existing config
        updatedConfig = manual_config;
      }

      res.json({
        success: true,
        data: {
          config: updatedConfig,
          message: 'Configuration updated successfully'
        }
      });

    } catch (error) {
      logger.error('Config update error', {
        error: error instanceof Error ? error.message : String(error),
        organization_id: req.user?.organization_id
      });

      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
);

export default router;
