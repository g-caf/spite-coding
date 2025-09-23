/**
 * Transaction Categorization API Routes
 * Smart categorization with ML suggestions and bulk operations
 */

import { Router } from 'express';
import { TransactionCategorizationService } from '../../services/transactionCategorizationService';
import { authenticateToken } from '../../auth/middleware/authentication';
import { requirePermissions } from '../../auth/middleware/authorization';
import { validateRequest } from '../../middleware/validation';
import { body, param, query } from 'express-validator';

const router = Router();
const categorizationService = new TransactionCategorizationService();

// Apply authentication to all routes
router.use(authenticateToken);

/**
 * POST /api/transactions/:id/categorize
 * Apply categorization to a specific transaction
 */
router.post('/:id/categorize',
  validateRequest([
    param('id').isUUID(),
    body('category_id').isUUID(),
    body('apply_rules').optional().isBoolean(),
    body('confidence_override').optional().isNumeric().isFloat({ min: 0, max: 1 })
  ]),
  requirePermissions(['write_transactions']),
  async (req, res) => {
    try {
      const transactionId = req.params.id;
      const organizationId = req.user.organization_id;
      const userId = req.user.id;
      const { category_id, apply_rules, confidence_override } = req.body;

      const result = await categorizationService.categorizeTransaction({
        transactionId,
        categoryId: category_id,
        organizationId,
        userId,
        applyRules: apply_rules,
        confidenceOverride: confidence_override
      });

      res.json({
        success: true,
        data: result,
        message: 'Transaction categorized successfully'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to categorize transaction',
        message: error.message
      });
    }
  }
);

/**
 * GET /api/transactions/:id/suggestions
 * Get AI-powered category suggestions for a transaction
 */
router.get('/:id/suggestions',
  validateRequest([
    param('id').isUUID(),
    query('limit').optional().isInt({ min: 1, max: 10 }).default(5)
  ]),
  requirePermissions(['read_transactions']),
  async (req, res) => {
    try {
      const transactionId = req.params.id;
      const organizationId = req.user.organization_id;
      const limit = parseInt(req.query.limit as string) || 5;

      const suggestions = await categorizationService.getCategorySuggestions({
        transactionId,
        organizationId,
        limit
      });

      res.json({
        success: true,
        data: suggestions
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to get category suggestions',
        message: error.message
      });
    }
  }
);

/**
 * POST /api/transactions/auto-categorize
 * Auto-categorize multiple uncategorized transactions
 */
router.post('/auto-categorize',
  validateRequest([
    body('transaction_ids').optional().isArray(),
    body('date_range').optional().isObject(),
    body('confidence_threshold').optional().isNumeric().isFloat({ min: 0, max: 1 }),
    body('dry_run').optional().isBoolean()
  ]),
  requirePermissions(['write_transactions']),
  async (req, res) => {
    try {
      const organizationId = req.user.organization_id;
      const userId = req.user.id;
      const { transaction_ids, date_range, confidence_threshold, dry_run } = req.body;

      const result = await categorizationService.autoCategorizeTransactions({
        organizationId,
        userId,
        transactionIds: transaction_ids,
        dateRange: date_range,
        confidenceThreshold: confidence_threshold || 0.8,
        dryRun: dry_run !== false
      });

      res.json({
        success: true,
        data: result,
        message: dry_run !== false 
          ? `Would categorize ${result.categorized_count} transactions`
          : `Categorized ${result.categorized_count} transactions`
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to auto-categorize transactions',
        message: error.message
      });
    }
  }
);

/**
 * POST /api/transactions/suggestions/accept
 * Accept a category suggestion and provide feedback
 */
router.post('/suggestions/accept',
  validateRequest([
    body('suggestion_id').isUUID(),
    body('feedback').optional().isLength({ max: 1000 })
  ]),
  requirePermissions(['write_transactions']),
  async (req, res) => {
    try {
      const organizationId = req.user.organization_id;
      const userId = req.user.id;
      const { suggestion_id, feedback } = req.body;

      const result = await categorizationService.acceptCategorySuggestion({
        suggestionId: suggestion_id,
        organizationId,
        userId,
        feedback
      });

      res.json({
        success: true,
        data: result,
        message: 'Category suggestion accepted'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to accept suggestion',
        message: error.message
      });
    }
  }
);

/**
 * POST /api/transactions/suggestions/reject
 * Reject a category suggestion and provide feedback
 */
router.post('/suggestions/reject',
  validateRequest([
    body('suggestion_id').isUUID(),
    body('correct_category_id').optional().isUUID(),
    body('feedback').optional().isLength({ max: 1000 })
  ]),
  requirePermissions(['write_transactions']),
  async (req, res) => {
    try {
      const organizationId = req.user.organization_id;
      const userId = req.user.id;
      const { suggestion_id, correct_category_id, feedback } = req.body;

      const result = await categorizationService.rejectCategorySuggestion({
        suggestionId: suggestion_id,
        correctCategoryId: correct_category_id,
        organizationId,
        userId,
        feedback
      });

      res.json({
        success: true,
        data: result,
        message: 'Category suggestion rejected and feedback recorded'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to reject suggestion',
        message: error.message
      });
    }
  }
);

/**
 * GET /api/transactions/uncategorized
 * Get uncategorized transactions with suggestions
 */
router.get('/uncategorized',
  validateRequest([
    query('limit').optional().isInt({ min: 1, max: 100 }).default(20),
    query('offset').optional().isInt({ min: 0 }).default(0),
    query('include_suggestions').optional().isBoolean().default(true)
  ]),
  requirePermissions(['read_transactions']),
  async (req, res) => {
    try {
      const organizationId = req.user.organization_id;
      const { limit, offset, include_suggestions } = req.query;

      const result = await categorizationService.getUncategorizedTransactions({
        organizationId,
        limit: parseInt(limit as string),
        offset: parseInt(offset as string),
        includeSuggestions: include_suggestions === 'true'
      });

      res.json({
        success: true,
        data: result.transactions,
        meta: {
          total: result.total,
          limit: parseInt(limit as string),
          offset: parseInt(offset as string),
          has_more: result.hasMore
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to get uncategorized transactions',
        message: error.message
      });
    }
  }
);

/**
 * GET /api/transactions/categorization/analytics
 * Get categorization analytics and performance metrics
 */
router.get('/categorization/analytics',
  validateRequest([
    query('start_date').optional().isISO8601(),
    query('end_date').optional().isISO8601(),
    query('include_accuracy').optional().isBoolean().default(true)
  ]),
  requirePermissions(['read_analytics']),
  async (req, res) => {
    try {
      const organizationId = req.user.organization_id;
      const { start_date, end_date, include_accuracy } = req.query;

      const analytics = await categorizationService.getCategorizationAnalytics({
        organizationId,
        startDate: start_date as string,
        endDate: end_date as string,
        includeAccuracy: include_accuracy === 'true'
      });

      res.json({
        success: true,
        data: analytics
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to get categorization analytics',
        message: error.message
      });
    }
  }
);

/**
 * POST /api/transactions/train-model
 * Trigger model training with recent categorization data
 */
router.post('/train-model',
  validateRequest([
    body('model_type').optional().isIn(['similarity', 'ml_classification', 'merchant_matching']),
    body('training_period_days').optional().isInt({ min: 7, max: 365 }).default(90)
  ]),
  requirePermissions(['admin']),
  async (req, res) => {
    try {
      const organizationId = req.user.organization_id;
      const userId = req.user.id;
      const { model_type, training_period_days } = req.body;

      const result = await categorizationService.trainModel({
        organizationId,
        userId,
        modelType: model_type || 'ml_classification',
        trainingPeriodDays: training_period_days || 90
      });

      res.json({
        success: true,
        data: result,
        message: 'Model training initiated successfully'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to train model',
        message: error.message
      });
    }
  }
);

/**
 * POST /api/transactions/bulk-recategorize
 * Recategorize transactions based on updated rules
 */
router.post('/bulk-recategorize',
  validateRequest([
    body('category_mapping').isObject(),
    body('apply_to_future').optional().isBoolean(),
    body('date_range').optional().isObject()
  ]),
  requirePermissions(['write_transactions', 'write_rules']),
  async (req, res) => {
    try {
      const organizationId = req.user.organization_id;
      const userId = req.user.id;
      const { category_mapping, apply_to_future, date_range } = req.body;

      const result = await categorizationService.bulkRecategorize({
        organizationId,
        userId,
        categoryMapping: category_mapping,
        applyToFuture: apply_to_future,
        dateRange: date_range
      });

      res.json({
        success: true,
        data: result,
        message: `Recategorized ${result.updated_count} transactions`
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to bulk recategorize',
        message: error.message
      });
    }
  }
);

/**
 * GET /api/transactions/merchant-analysis
 * Analyze merchant categorization patterns
 */
router.get('/merchant-analysis',
  validateRequest([
    query('merchant_name').optional().isString(),
    query('include_suggestions').optional().isBoolean().default(true)
  ]),
  requirePermissions(['read_analytics']),
  async (req, res) => {
    try {
      const organizationId = req.user.organization_id;
      const { merchant_name, include_suggestions } = req.query;

      const analysis = await categorizationService.analyzeMerchantCategorization({
        organizationId,
        merchantName: merchant_name as string,
        includeSuggestions: include_suggestions === 'true'
      });

      res.json({
        success: true,
        data: analysis
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to analyze merchant categorization',
        message: error.message
      });
    }
  }
);

export default router;
