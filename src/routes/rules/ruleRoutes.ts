/**
 * Rules Engine API Routes
 * Advanced categorization and automation rules
 */

import { Router } from 'express';
import { RuleEngineService } from '../../services/ruleEngineService';
import { authenticateToken } from '../../auth/middleware/authentication';
import { requirePermissions } from '../../auth/middleware/authorization';
import { validateRequest } from '../../middleware/validation';
import { body, param, query } from 'express-validator';

const router = Router();
const ruleEngineService = new RuleEngineService();

// Apply authentication to all routes
router.use(authenticateToken);

/**
 * GET /api/rules
 * List all categorization and automation rules
 */
router.get('/',
  validateRequest([
    query('active_only').optional().isBoolean().default(true),
    query('rule_type').optional().isIn(['categorization', 'policy', 'automation']),
    query('priority_min').optional().isInt({ min: 0 }),
    query('priority_max').optional().isInt({ min: 0 })
  ]),
  requirePermissions(['read_rules']),
  async (req, res) => {
    try {
      const organizationId = req.user.organization_id;
      const filters = {
        activeOnly: req.query.active_only !== 'false',
        ruleType: req.query.rule_type as string,
        priorityMin: req.query.priority_min ? parseInt(req.query.priority_min as string) : undefined,
        priorityMax: req.query.priority_max ? parseInt(req.query.priority_max as string) : undefined
      };

      const rules = await ruleEngineService.getRules(organizationId, filters);

      res.json({
        success: true,
        data: rules,
        meta: {
          total: rules.length,
          filters_applied: Object.keys(filters).filter(key => filters[key] !== undefined)
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to fetch rules',
        message: error.message
      });
    }
  }
);

/**
 * GET /api/rules/:id
 * Get a specific rule with full details and statistics
 */
router.get('/:id',
  validateRequest([
    param('id').isUUID()
  ]),
  requirePermissions(['read_rules']),
  async (req, res) => {
    try {
      const ruleId = req.params.id;
      const organizationId = req.user.organization_id;

      const rule = await ruleEngineService.getRuleById(ruleId, organizationId);
      
      if (!rule) {
        return res.status(404).json({
          success: false,
          error: 'Rule not found'
        });
      }

      res.json({
        success: true,
        data: rule
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to fetch rule',
        message: error.message
      });
    }
  }
);

/**
 * POST /api/rules
 * Create a new categorization or automation rule
 */
router.post('/',
  validateRequest([
    body('name').isLength({ min: 1, max: 255 }).trim(),
    body('description').optional().isLength({ max: 1000 }).trim(),
    body('rule_type').isIn(['categorization', 'policy', 'automation']),
    body('conditions').isObject(),
    body('actions').isObject(),
    body('priority').optional().isInt({ min: 0, max: 1000 }),
    body('active').optional().isBoolean()
  ]),
  requirePermissions(['write_rules']),
  async (req, res) => {
    try {
      const organizationId = req.user.organization_id;
      const userId = req.user.id;

      const ruleData = {
        ...req.body,
        organizationId,
        createdBy: userId,
        updatedBy: userId
      };

      // Validate rule structure
      const validation = await ruleEngineService.validateRule(ruleData);
      if (!validation.isValid) {
        return res.status(400).json({
          success: false,
          error: 'Invalid rule structure',
          details: validation.errors
        });
      }

      const rule = await ruleEngineService.createRule(ruleData);

      res.status(201).json({
        success: true,
        data: rule,
        message: 'Rule created successfully'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to create rule',
        message: error.message
      });
    }
  }
);

/**
 * PUT /api/rules/:id
 * Update an existing rule
 */
router.put('/:id',
  validateRequest([
    param('id').isUUID(),
    body('name').optional().isLength({ min: 1, max: 255 }).trim(),
    body('description').optional().isLength({ max: 1000 }).trim(),
    body('rule_type').optional().isIn(['categorization', 'policy', 'automation']),
    body('conditions').optional().isObject(),
    body('actions').optional().isObject(),
    body('priority').optional().isInt({ min: 0, max: 1000 }),
    body('active').optional().isBoolean()
  ]),
  requirePermissions(['write_rules']),
  async (req, res) => {
    try {
      const ruleId = req.params.id;
      const organizationId = req.user.organization_id;
      const userId = req.user.id;

      const updateData = {
        ...req.body,
        updatedBy: userId
      };

      // Validate rule structure if conditions or actions are being updated
      if (updateData.conditions || updateData.actions) {
        const existingRule = await ruleEngineService.getRuleById(ruleId, organizationId);
        if (!existingRule) {
          return res.status(404).json({
            success: false,
            error: 'Rule not found'
          });
        }

        const mergedRule = {
          ...existingRule,
          ...updateData
        };

        const validation = await ruleEngineService.validateRule(mergedRule);
        if (!validation.isValid) {
          return res.status(400).json({
            success: false,
            error: 'Invalid rule structure',
            details: validation.errors
          });
        }
      }

      const rule = await ruleEngineService.updateRule(ruleId, organizationId, updateData);

      if (!rule) {
        return res.status(404).json({
          success: false,
          error: 'Rule not found'
        });
      }

      res.json({
        success: true,
        data: rule,
        message: 'Rule updated successfully'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to update rule',
        message: error.message
      });
    }
  }
);

/**
 * DELETE /api/rules/:id
 * Delete a rule (soft delete)
 */
router.delete('/:id',
  validateRequest([
    param('id').isUUID()
  ]),
  requirePermissions(['delete_rules']),
  async (req, res) => {
    try {
      const ruleId = req.params.id;
      const organizationId = req.user.organization_id;

      const success = await ruleEngineService.deleteRule(ruleId, organizationId);

      if (!success) {
        return res.status(404).json({
          success: false,
          error: 'Rule not found'
        });
      }

      res.json({
        success: true,
        message: 'Rule deleted successfully'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to delete rule',
        message: error.message
      });
    }
  }
);

/**
 * POST /api/rules/test
 * Test a rule against sample transaction data
 */
router.post('/test',
  validateRequest([
    body('rule').isObject(),
    body('test_transactions').isArray(),
    body('dry_run').optional().isBoolean()
  ]),
  requirePermissions(['write_rules']),
  async (req, res) => {
    try {
      const organizationId = req.user.organization_id;
      const { rule, test_transactions, dry_run } = req.body;

      // Validate rule structure
      const validation = await ruleEngineService.validateRule({
        ...rule,
        organizationId
      });

      if (!validation.isValid) {
        return res.status(400).json({
          success: false,
          error: 'Invalid rule structure',
          details: validation.errors
        });
      }

      const testResults = await ruleEngineService.testRule({
        rule: { ...rule, organizationId },
        transactions: test_transactions,
        dryRun: dry_run !== false
      });

      res.json({
        success: true,
        data: testResults,
        message: `Rule test completed. ${testResults.matches} out of ${test_transactions.length} transactions matched.`
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to test rule',
        message: error.message
      });
    }
  }
);

/**
 * POST /api/rules/:id/apply
 * Apply a rule to existing transactions (backfill)
 */
router.post('/:id/apply',
  validateRequest([
    param('id').isUUID(),
    body('transaction_ids').optional().isArray(),
    body('date_range').optional().isObject(),
    body('dry_run').optional().isBoolean()
  ]),
  requirePermissions(['write_transactions', 'write_rules']),
  async (req, res) => {
    try {
      const ruleId = req.params.id;
      const organizationId = req.user.organization_id;
      const userId = req.user.id;
      const { transaction_ids, date_range, dry_run } = req.body;

      const result = await ruleEngineService.applyRuleToTransactions({
        ruleId,
        organizationId,
        userId,
        transactionIds: transaction_ids,
        dateRange: date_range,
        dryRun: dry_run !== false
      });

      res.json({
        success: true,
        data: result,
        message: dry_run !== false 
          ? `Rule would affect ${result.affected_count} transactions`
          : `Rule applied to ${result.affected_count} transactions`
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to apply rule',
        message: error.message
      });
    }
  }
);

/**
 * GET /api/rules/analytics/performance
 * Get rule performance analytics
 */
router.get('/analytics/performance',
  validateRequest([
    query('rule_id').optional().isUUID(),
    query('start_date').optional().isISO8601(),
    query('end_date').optional().isISO8601()
  ]),
  requirePermissions(['read_analytics']),
  async (req, res) => {
    try {
      const organizationId = req.user.organization_id;
      const { rule_id, start_date, end_date } = req.query;

      const analytics = await ruleEngineService.getRuleAnalytics({
        organizationId,
        ruleId: rule_id as string,
        startDate: start_date as string,
        endDate: end_date as string
      });

      res.json({
        success: true,
        data: analytics
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to fetch rule analytics',
        message: error.message
      });
    }
  }
);

/**
 * POST /api/rules/learn
 * Submit learning feedback to improve rule accuracy
 */
router.post('/learn',
  validateRequest([
    body('transaction_id').isUUID(),
    body('expected_category_id').isUUID(),
    body('applied_rule_id').optional().isUUID(),
    body('correction_type').isIn(['category', 'policy', 'merchant']),
    body('feedback').optional().isLength({ max: 1000 })
  ]),
  requirePermissions(['write_transactions']),
  async (req, res) => {
    try {
      const organizationId = req.user.organization_id;
      const userId = req.user.id;

      const learningData = {
        ...req.body,
        organizationId,
        userId
      };

      const result = await ruleEngineService.submitLearningFeedback(learningData);

      res.json({
        success: true,
        data: result,
        message: 'Learning feedback submitted successfully'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to submit learning feedback',
        message: error.message
      });
    }
  }
);

export default router;
