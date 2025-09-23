import express from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { PlaidService } from '../../services/plaid/PlaidService';
import { PlaidWebhookHandler } from '../../services/webhook/PlaidWebhookHandler';
import { authMiddleware } from '../../auth/middleware';
import { organizationMiddleware } from '../../auth/organizationMiddleware';
import rateLimit from 'express-rate-limit';
import winston from 'winston';

const router = express.Router();

// Rate limiting for Plaid operations
const plaidLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // Limit each organization to 50 requests per windowMs
  keyGenerator: (req) => `plaid:${req.user?.organization_id || 'unknown'}`,
  message: { error: 'Too many Plaid requests, try again later' }
});

// Webhook rate limiting (more generous for automated calls)
const webhookLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 200,
  keyGenerator: (req) => `webhook:${req.ip}`,
  message: { error: 'Webhook rate limit exceeded' }
});

// Initialize services (these would be injected in a real implementation)
let plaidService: PlaidService;
let webhookHandler: PlaidWebhookHandler;
let logger: winston.Logger;

export const initializePlaidRoutes = (
  _plaidService: PlaidService,
  _webhookHandler: PlaidWebhookHandler,
  _logger: winston.Logger
) => {
  plaidService = _plaidService;
  webhookHandler = _webhookHandler;
  logger = _logger;
};

/**
 * @route   GET /api/plaid/link-token
 * @desc    Generate Plaid Link token for connecting accounts
 * @access  Private
 */
router.get('/link-token',
  plaidLimiter,
  authMiddleware.requireAuth(),
  organizationMiddleware,
  [
    query('language').optional().isIn(['en', 'es', 'fr']),
    query('user_legal_name').optional().isString().trim(),
    query('user_email').optional().isEmail()
  ],
  async (req: any, res: any) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { organization_id, user_id } = req.user;
      const { language, user_legal_name, user_email } = req.query;

      const linkTokenData = await plaidService.createLinkToken(
        organization_id,
        user_id,
        {
          language,
          userLegalName: user_legal_name,
          userEmail: user_email
        }
      );

      res.json({
        success: true,
        data: linkTokenData
      });
    } catch (error) {
      logger.error('Failed to create link token', {
        organizationId: req.user?.organization_id,
        userId: req.user?.user_id,
        error: (error as Error).message
      });

      res.status(500).json({
        error: 'Failed to create link token',
        message: (error as Error).message
      });
    }
  }
);

/**
 * @route   POST /api/plaid/connect
 * @desc    Exchange public token and connect account
 * @access  Private
 */
router.post('/connect',
  plaidLimiter,
  authMiddleware.requireAuth(),
  organizationMiddleware,
  [
    body('public_token').notEmpty().withMessage('Public token is required'),
    body('metadata').optional().isObject()
  ],
  async (req: any, res: any) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { organization_id, user_id } = req.user;
      const { public_token, metadata } = req.body;

      const connectionResult = await plaidService.connectAccount(
        organization_id,
        user_id,
        public_token,
        metadata
      );

      res.json({
        success: true,
        data: connectionResult
      });
    } catch (error) {
      logger.error('Failed to connect account', {
        organizationId: req.user?.organization_id,
        userId: req.user?.user_id,
        error: (error as Error).message
      });

      res.status(500).json({
        error: 'Failed to connect account',
        message: (error as Error).message
      });
    }
  }
);

/**
 * @route   GET /api/plaid/accounts
 * @desc    List connected Plaid accounts
 * @access  Private
 */
router.get('/accounts',
  plaidLimiter,
  authMiddleware.requireAuth(),
  organizationMiddleware,
  async (req: any, res: any) => {
    try {
      const { organization_id } = req.user;

      const accounts = await plaidService.getConnectedAccounts(organization_id);

      res.json({
        success: true,
        data: accounts
      });
    } catch (error) {
      logger.error('Failed to get accounts', {
        organizationId: req.user?.organization_id,
        error: (error as Error).message
      });

      res.status(500).json({
        error: 'Failed to get accounts',
        message: (error as Error).message
      });
    }
  }
);

/**
 * @route   DELETE /api/plaid/accounts/:itemId
 * @desc    Disconnect Plaid account
 * @access  Private
 */
router.delete('/accounts/:itemId',
  plaidLimiter,
  authMiddleware.requireAuth(),
  organizationMiddleware,
  [
    param('itemId').notEmpty().withMessage('Item ID is required')
  ],
  async (req: any, res: any) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { organization_id, user_id } = req.user;
      const { itemId } = req.params;

      await plaidService.disconnectAccount(organization_id, itemId, user_id);

      res.json({
        success: true,
        message: 'Account disconnected successfully'
      });
    } catch (error) {
      logger.error('Failed to disconnect account', {
        organizationId: req.user?.organization_id,
        itemId: req.params.itemId,
        error: (error as Error).message
      });

      res.status(500).json({
        error: 'Failed to disconnect account',
        message: (error as Error).message
      });
    }
  }
);

/**
 * @route   POST /api/plaid/accounts/:itemId/sync
 * @desc    Trigger manual sync for account
 * @access  Private
 */
router.post('/accounts/:itemId/sync',
  plaidLimiter,
  authMiddleware.requireAuth(),
  organizationMiddleware,
  [
    param('itemId').notEmpty().withMessage('Item ID is required')
  ],
  async (req: any, res: any) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { organization_id } = req.user;
      const { itemId } = req.params;

      const result = await plaidService.triggerManualSync(organization_id, itemId);

      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      logger.error('Failed to trigger sync', {
        organizationId: req.user?.organization_id,
        itemId: req.params.itemId,
        error: (error as Error).message
      });

      res.status(500).json({
        error: 'Failed to trigger sync',
        message: (error as Error).message
      });
    }
  }
);

/**
 * @route   GET /api/plaid/sync-status
 * @desc    Get sync status for all connected accounts
 * @access  Private
 */
router.get('/sync-status',
  plaidLimiter,
  authMiddleware.requireAuth(),
  organizationMiddleware,
  async (req: any, res: any) => {
    try {
      const { organization_id } = req.user;

      // Get recent sync jobs and their status
      const syncJobs = await req.db('plaid_sync_jobs as psj')
        .select(
          'psj.*',
          'pi.item_id',
          'pi.institution_name',
          'pi.sync_status as item_status'
        )
        .leftJoin('plaid_items as pi', 'psj.plaid_item_id', 'pi.id')
        .where('psj.organization_id', organization_id)
        .where('psj.created_at', '>', req.db.raw('NOW() - INTERVAL \'24 hours\''))
        .orderBy('psj.created_at', 'desc')
        .limit(50);

      // Get overall sync health
      const healthMetrics = await req.db('plaid_items')
        .select(
          req.db.raw('COUNT(*) as total_connections'),
          req.db.raw('COUNT(CASE WHEN sync_status = \'active\' THEN 1 END) as active_connections'),
          req.db.raw('COUNT(CASE WHEN sync_status = \'error\' THEN 1 END) as error_connections'),
          req.db.raw('AVG(consecutive_failures) as avg_failures')
        )
        .where('organization_id', organization_id)
        .first();

      res.json({
        success: true,
        data: {
          recent_jobs: syncJobs,
          health_metrics: healthMetrics
        }
      });
    } catch (error) {
      logger.error('Failed to get sync status', {
        organizationId: req.user?.organization_id,
        error: (error as Error).message
      });

      res.status(500).json({
        error: 'Failed to get sync status',
        message: (error as Error).message
      });
    }
  }
);

/**
 * @route   POST /webhook/plaid
 * @desc    Handle Plaid webhooks
 * @access  Public (but validated)
 */
router.post('/webhook',
  webhookLimiter,
  express.raw({ type: 'application/json' }),
  async (req: any, res: any) => {
    try {
      const payload = JSON.parse(req.body.toString());
      const signature = req.headers['plaid-verification'] as string;

      logger.info('Received Plaid webhook', {
        webhookType: payload.webhook_type,
        webhookCode: payload.webhook_code,
        itemId: payload.item_id
      });

      const result = await webhookHandler.handleWebhook(payload, signature);

      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      logger.error('Webhook processing failed', {
        error: (error as Error).message,
        body: req.body?.toString()
      });

      // Always return 200 to Plaid to avoid retries for permanent errors
      res.status(200).json({
        error: 'Webhook processing failed',
        message: (error as Error).message
      });
    }
  }
);

/**
 * @route   GET /api/plaid/transactions/recent
 * @desc    Get recent transactions from Plaid
 * @access  Private
 */
router.get('/transactions/recent',
  plaidLimiter,
  authMiddleware.requireAuth(),
  organizationMiddleware,
  [
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    query('offset').optional().isInt({ min: 0 }).toInt(),
    query('account_id').optional().isUUID()
  ],
  async (req: any, res: any) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { organization_id } = req.user;
      const { limit = 50, offset = 0, account_id } = req.query;

      let query = req.db('plaid_transactions_raw as ptr')
        .select(
          'ptr.*',
          'pa.name as account_name',
          'pa.type as account_type',
          'pa.subtype as account_subtype',
          't.id as local_transaction_id',
          't.status as local_transaction_status'
        )
        .leftJoin('plaid_accounts as pa', 'ptr.plaid_account_id', 'pa.id')
        .leftJoin('transactions as t', 'ptr.processed_transaction_id', 't.id')
        .where('ptr.organization_id', organization_id)
        .orderBy('ptr.date', 'desc')
        .limit(limit)
        .offset(offset);

      if (account_id) {
        query = query.where('pa.local_account_id', account_id);
      }

      const transactions = await query;

      res.json({
        success: true,
        data: {
          transactions,
          pagination: {
            limit,
            offset,
            total: transactions.length // This would be a separate count query in production
          }
        }
      });
    } catch (error) {
      logger.error('Failed to get recent transactions', {
        organizationId: req.user?.organization_id,
        error: (error as Error).message
      });

      res.status(500).json({
        error: 'Failed to get recent transactions',
        message: (error as Error).message
      });
    }
  }
);

export default router;