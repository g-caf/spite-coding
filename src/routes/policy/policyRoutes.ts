/**
 * Policy Engine API Routes
 * Expense policy enforcement and compliance monitoring
 */

import { Router } from 'express';
import { PolicyEngineService } from '../../services/policyEngineService';
import { authenticateToken } from '../../auth/middleware/authentication';
import { requirePermissions } from '../../auth/middleware/authorization';
import { validateRequest } from '../../middleware/validation';
import { body, param, query } from 'express-validator';
import { knex } from '../../utils/database';

const router = Router();
const policyEngineService = new PolicyEngineService();

// Apply authentication to all routes
router.use(authenticateToken);

/**
 * GET /api/policy/rules
 * List all policy rules
 */
router.get('/rules',
  validateRequest([
    query('policy_type').optional().isIn([
      'spending_limit', 'receipt_requirement', 'approval_workflow', 
      'time_restriction', 'merchant_restriction', 'category_restriction'
    ]),
    query('active_only').optional().isBoolean().default(true),
    query('severity').optional().isIn(['low', 'medium', 'high', 'critical'])
  ]),
  requirePermissions(['read_policies']),
  async (req, res) => {
    try {
      const organizationId = req.user.organization_id;
      const { policy_type, active_only, severity } = req.query;

      const rules = await knex('policy_rules')
        .where('organization_id', organizationId)
        .modify(query => {
          if (policy_type) query.where('policy_type', policy_type);
          if (active_only !== 'false') query.where('active', true);
          if (severity) query.where('severity', severity);
        })
        .orderBy('severity', 'desc')
        .orderBy('created_at', 'desc');

      res.json({
        success: true,
        data: rules.map(rule => ({
          ...rule,
          conditions: JSON.parse(rule.conditions),
          enforcement: JSON.parse(rule.enforcement)
        }))
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to fetch policy rules',
        message: error.message
      });
    }
  }
);

/**
 * POST /api/policy/rules
 * Create a new policy rule
 */
router.post('/rules',
  validateRequest([
    body('name').isLength({ min: 1, max: 255 }).trim(),
    body('description').optional().isLength({ max: 1000 }).trim(),
    body('policy_type').isIn([
      'spending_limit', 'receipt_requirement', 'approval_workflow',
      'time_restriction', 'merchant_restriction', 'category_restriction'
    ]),
    body('conditions').isObject(),
    body('enforcement').isObject(),
    body('severity').isIn(['low', 'medium', 'high', 'critical']),
    body('active').optional().isBoolean()
  ]),
  requirePermissions(['write_policies']),
  async (req, res) => {
    try {
      const organizationId = req.user.organization_id;
      const userId = req.user.id;

      const policyRule = await policyEngineService.createPolicyRule({
        ...req.body,
        organization_id: organizationId,
        created_by: userId,
        updated_by: userId
      });

      res.status(201).json({
        success: true,
        data: policyRule,
        message: 'Policy rule created successfully'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to create policy rule',
        message: error.message
      });
    }
  }
);

/**
 * PUT /api/policy/rules/:id
 * Update a policy rule
 */
router.put('/rules/:id',
  validateRequest([
    param('id').isUUID(),
    body('name').optional().isLength({ min: 1, max: 255 }).trim(),
    body('description').optional().isLength({ max: 1000 }).trim(),
    body('conditions').optional().isObject(),
    body('enforcement').optional().isObject(),
    body('severity').optional().isIn(['low', 'medium', 'high', 'critical']),
    body('active').optional().isBoolean()
  ]),
  requirePermissions(['write_policies']),
  async (req, res) => {
    try {
      const ruleId = req.params.id;
      const organizationId = req.user.organization_id;
      const userId = req.user.id;

      const updateData = {
        ...req.body,
        updated_by: userId
      };

      const [updatedRule] = await knex('policy_rules')
        .where('id', ruleId)
        .where('organization_id', organizationId)
        .update({
          ...updateData,
          conditions: updateData.conditions ? JSON.stringify(updateData.conditions) : knex.raw('conditions'),
          enforcement: updateData.enforcement ? JSON.stringify(updateData.enforcement) : knex.raw('enforcement'),
          updated_at: knex.fn.now()
        })
        .returning('*');

      if (!updatedRule) {
        return res.status(404).json({
          success: false,
          error: 'Policy rule not found'
        });
      }

      res.json({
        success: true,
        data: {
          ...updatedRule,
          conditions: JSON.parse(updatedRule.conditions),
          enforcement: JSON.parse(updatedRule.enforcement)
        },
        message: 'Policy rule updated successfully'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to update policy rule',
        message: error.message
      });
    }
  }
);

/**
 * DELETE /api/policy/rules/:id
 * Delete a policy rule (soft delete)
 */
router.delete('/rules/:id',
  validateRequest([
    param('id').isUUID()
  ]),
  requirePermissions(['delete_policies']),
  async (req, res) => {
    try {
      const ruleId = req.params.id;
      const organizationId = req.user.organization_id;

      const updated = await knex('policy_rules')
        .where('id', ruleId)
        .where('organization_id', organizationId)
        .update({
          active: false,
          updated_at: knex.fn.now()
        });

      if (updated === 0) {
        return res.status(404).json({
          success: false,
          error: 'Policy rule not found'
        });
      }

      res.json({
        success: true,
        message: 'Policy rule deleted successfully'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to delete policy rule',
        message: error.message
      });
    }
  }
);

/**
 * GET /api/policy/violations
 * List policy violations with filtering
 */
router.get('/violations',
  validateRequest([
    query('status').optional().isIn(['open', 'acknowledged', 'resolved', 'false_positive']),
    query('severity').optional().isIn(['low', 'medium', 'high', 'critical']),
    query('violation_type').optional().isString(),
    query('start_date').optional().isISO8601(),
    query('end_date').optional().isISO8601(),
    query('limit').optional().isInt({ min: 1, max: 100 }).default(50),
    query('offset').optional().isInt({ min: 0 }).default(0)
  ]),
  requirePermissions(['read_policies']),
  async (req, res) => {
    try {
      const organizationId = req.user.organization_id;
      const { status, severity, violation_type, start_date, end_date, limit, offset } = req.query;

      let query = knex('policy_violations as pv')
        .select(
          'pv.*',
          'pr.name as policy_name',
          'pr.policy_type',
          't.amount as transaction_amount',
          't.description as transaction_description',
          'u.first_name',
          'u.last_name'
        )
        .leftJoin('policy_rules as pr', 'pv.policy_rule_id', 'pr.id')
        .leftJoin('transactions as t', 'pv.transaction_id', 't.id')
        .leftJoin('users as u', 't.created_by', 'u.id')
        .where('pv.organization_id', organizationId);

      if (status) query = query.where('pv.status', status);
      if (severity) query = query.where('pv.severity', severity);
      if (violation_type) query = query.where('pv.violation_type', violation_type);
      if (start_date) query = query.where('pv.created_at', '>=', start_date);
      if (end_date) query = query.where('pv.created_at', '<=', end_date);

      const violations = await query
        .orderBy('pv.created_at', 'desc')
        .limit(parseInt(limit as string))
        .offset(parseInt(offset as string));

      // Get total count
      const totalQuery = knex('policy_violations')
        .where('organization_id', organizationId)
        .modify(q => {
          if (status) q.where('status', status);
          if (severity) q.where('severity', severity);
          if (violation_type) q.where('violation_type', violation_type);
          if (start_date) q.where('created_at', '>=', start_date);
          if (end_date) q.where('created_at', '<=', end_date);
        })
        .count('id as count')
        .first();

      const total = await totalQuery;

      res.json({
        success: true,
        data: violations.map(violation => ({
          ...violation,
          violation_details: JSON.parse(violation.violation_details || '{}')
        })),
        meta: {
          total: parseInt(total.count),
          limit: parseInt(limit as string),
          offset: parseInt(offset as string),
          has_more: parseInt(offset as string) + violations.length < parseInt(total.count)
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to fetch policy violations',
        message: error.message
      });
    }
  }
);

/**
 * PUT /api/policy/violations/:id/resolve
 * Resolve a policy violation
 */
router.put('/violations/:id/resolve',
  validateRequest([
    param('id').isUUID(),
    body('resolution').isIn(['resolved', 'false_positive']),
    body('notes').optional().isLength({ max: 1000 }).trim()
  ]),
  requirePermissions(['write_policies']),
  async (req, res) => {
    try {
      const violationId = req.params.id;
      const organizationId = req.user.organization_id;
      const userId = req.user.id;
      const { resolution, notes } = req.body;

      const violation = await policyEngineService.resolvePolicyViolation({
        violationId,
        organizationId,
        userId,
        resolution,
        notes
      });

      res.json({
        success: true,
        data: violation,
        message: `Policy violation marked as ${resolution}`
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to resolve policy violation',
        message: error.message
      });
    }
  }
);

/**
 * GET /api/policy/compliance/report
 * Generate compliance report
 */
router.get('/compliance/report',
  validateRequest([
    query('start_date').isISO8601(),
    query('end_date').isISO8601()
  ]),
  requirePermissions(['read_analytics']),
  async (req, res) => {
    try {
      const organizationId = req.user.organization_id;
      const { start_date, end_date } = req.query;

      const report = await policyEngineService.generateComplianceReport({
        organizationId,
        startDate: start_date as string,
        endDate: end_date as string
      });

      res.json({
        success: true,
        data: report
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to generate compliance report',
        message: error.message
      });
    }
  }
);

/**
 * GET /api/policy/dashboard
 * Get policy enforcement dashboard data
 */
router.get('/dashboard',
  requirePermissions(['read_policies']),
  async (req, res) => {
    try {
      const organizationId = req.user.organization_id;

      const dashboard = await policyEngineService.getPolicyDashboard(organizationId);

      res.json({
        success: true,
        data: dashboard
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to fetch policy dashboard',
        message: error.message
      });
    }
  }
);

/**
 * POST /api/policy/evaluate
 * Evaluate a transaction against policies (for testing)
 */
router.post('/evaluate',
  validateRequest([
    body('transaction_id').isUUID()
  ]),
  requirePermissions(['read_policies']),
  async (req, res) => {
    try {
      const organizationId = req.user.organization_id;
      const userId = req.user.id;
      const { transaction_id } = req.body;

      // Get transaction
      const transaction = await knex('transactions')
        .where('id', transaction_id)
        .where('organization_id', organizationId)
        .first();

      if (!transaction) {
        return res.status(404).json({
          success: false,
          error: 'Transaction not found'
        });
      }

      const evaluation = await policyEngineService.evaluateTransaction(
        transaction,
        organizationId,
        userId
      );

      res.json({
        success: true,
        data: evaluation
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to evaluate transaction',
        message: error.message
      });
    }
  }
);

/**
 * GET /api/policy/spending-limits
 * Get spending limits for current user or organization
 */
router.get('/spending-limits',
  validateRequest([
    query('user_id').optional().isUUID(),
    query('limit_type').optional().isIn(['daily', 'weekly', 'monthly', 'quarterly', 'yearly'])
  ]),
  requirePermissions(['read_policies']),
  async (req, res) => {
    try {
      const organizationId = req.user.organization_id;
      const { user_id, limit_type } = req.query;
      const targetUserId = user_id || req.user.id;

      let query = knex('spending_limits as sl')
        .select(
          'sl.*',
          'c.name as category_name',
          'd.name as department_name',
          'u.first_name',
          'u.last_name'
        )
        .leftJoin('categories as c', 'sl.category_id', 'c.id')
        .leftJoin('departments as d', 'sl.department_id', 'd.id')
        .leftJoin('users as u', 'sl.user_id', 'u.id')
        .where('sl.organization_id', organizationId)
        .where('sl.user_id', targetUserId);

      if (limit_type) {
        query = query.where('sl.limit_type', limit_type);
      }

      const spendingLimits = await query.orderBy('sl.limit_type');

      res.json({
        success: true,
        data: spendingLimits.map(limit => ({
          ...limit,
          metadata: JSON.parse(limit.metadata || '{}'),
          usage_percentage: limit.limit_amount > 0 ? 
            (limit.current_usage / limit.limit_amount * 100) : 0
        }))
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to fetch spending limits',
        message: error.message
      });
    }
  }
);

/**
 * POST /api/policy/spending-limits
 * Create or update spending limits
 */
router.post('/spending-limits',
  validateRequest([
    body('user_id').optional().isUUID(),
    body('category_id').optional().isUUID(),
    body('department_id').optional().isUUID(),
    body('limit_type').isIn(['daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'per_transaction']),
    body('limit_amount').isNumeric().isFloat({ min: 0 }),
    body('period_start').optional().isISO8601(),
    body('period_end').optional().isISO8601(),
    body('auto_reset').optional().isBoolean()
  ]),
  requirePermissions(['write_policies']),
  async (req, res) => {
    try {
      const organizationId = req.user.organization_id;
      const userId = req.user.id;
      const {
        user_id,
        category_id,
        department_id,
        limit_type,
        limit_amount,
        period_start,
        period_end,
        auto_reset
      } = req.body;

      // Calculate period dates if not provided
      let periodStart = period_start;
      let periodEnd = period_end;

      if (!periodStart || !periodEnd) {
        const now = new Date();
        switch (limit_type) {
          case 'daily':
            periodStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            periodEnd = new Date(periodStart.getTime() + 24 * 60 * 60 * 1000);
            break;
          case 'weekly':
            const startOfWeek = new Date(now);
            startOfWeek.setDate(now.getDate() - now.getDay());
            periodStart = startOfWeek;
            periodEnd = new Date(startOfWeek.getTime() + 7 * 24 * 60 * 60 * 1000);
            break;
          case 'monthly':
            periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
            periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
            break;
          default:
            periodStart = now;
            periodEnd = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());
        }
      }

      const [spendingLimit] = await knex('spending_limits')
        .insert({
          organization_id: organizationId,
          user_id: user_id || userId,
          category_id,
          department_id,
          limit_type,
          limit_amount,
          current_usage: 0,
          period_start: periodStart,
          period_end: periodEnd,
          auto_reset: auto_reset !== false,
          created_by: userId,
          updated_by: userId,
          created_at: knex.fn.now(),
          updated_at: knex.fn.now()
        })
        .returning('*');

      res.status(201).json({
        success: true,
        data: spendingLimit,
        message: 'Spending limit created successfully'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to create spending limit',
        message: error.message
      });
    }
  }
);

export default router;
