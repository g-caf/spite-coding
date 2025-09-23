import { Knex } from 'knex';
import winston from 'winston';
import crypto from 'crypto';
import { PlaidService } from '../plaid/PlaidService';

interface WebhookPayload {
  webhook_type: string;
  webhook_code: string;
  item_id: string;
  error?: any;
  new_transactions?: number;
  removed_transactions?: string[];
}

export class PlaidWebhookHandler {
  private db: Knex;
  private logger: winston.Logger;
  private plaidService: PlaidService;
  private webhookSecret: string;

  constructor(
    db: Knex,
    logger: winston.Logger,
    plaidService: PlaidService,
    webhookSecret: string
  ) {
    this.db = db;
    this.logger = logger;
    this.plaidService = plaidService;
    this.webhookSecret = webhookSecret;
  }

  async handleWebhook(payload: WebhookPayload, signature?: string): Promise<any> {
    try {
      // Validate webhook signature if provided
      if (signature && !this.validateSignature(JSON.stringify(payload), signature)) {
        throw new Error('Invalid webhook signature');
      }

      this.logger.info('Processing Plaid webhook', {
        webhookType: payload.webhook_type,
        webhookCode: payload.webhook_code,
        itemId: payload.item_id
      });

      // Log webhook for audit trail
      await this.logWebhook(payload);

      // Find organization for this item
      const plaidItem = await this.db('plaid_items')
        .where('item_id', payload.item_id)
        .first();

      if (!plaidItem) {
        this.logger.warn('Webhook received for unknown item', { itemId: payload.item_id });
        return { status: 'ignored', reason: 'item_not_found' };
      }

      // Process webhook based on type
      const result = await this.processWebhook(plaidItem, payload);

      // Mark webhook as processed
      await this.db('plaid_webhooks')
        .where('item_id', payload.item_id)
        .where('webhook_type', payload.webhook_type)
        .where('webhook_code', payload.webhook_code)
        .orderBy('created_at', 'desc')
        .first()
        .then(webhook => {
          if (webhook) {
            return this.db('plaid_webhooks')
              .where('id', webhook.id)
              .update({
                processed: true,
                processed_at: new Date(),
                processing_result: result
              });
          }
        });

      this.logger.info('Webhook processed successfully', {
        webhookType: payload.webhook_type,
        webhookCode: payload.webhook_code,
        itemId: payload.item_id,
        result
      });

      return result;
    } catch (error) {
      this.logger.error('Webhook processing failed', {
        webhookType: payload.webhook_type,
        webhookCode: payload.webhook_code,
        itemId: payload.item_id,
        error: (error as Error).message
      });

      // Update webhook log with error
      await this.db('plaid_webhooks')
        .where('item_id', payload.item_id)
        .where('webhook_type', payload.webhook_type)
        .where('webhook_code', payload.webhook_code)
        .orderBy('created_at', 'desc')
        .first()
        .then(webhook => {
          if (webhook) {
            return this.db('plaid_webhooks')
              .where('id', webhook.id)
              .update({
                processed: true,
                processed_at: new Date(),
                processing_result: {
                  status: 'error',
                  error: (error as Error).message
                }
              });
          }
        });

      throw error;
    }
  }

  private async processWebhook(plaidItem: any, payload: WebhookPayload): Promise<any> {
    const { webhook_type, webhook_code } = payload;

    switch (webhook_type) {
      case 'TRANSACTIONS':
        return this.handleTransactionsWebhook(plaidItem, payload);
      
      case 'ITEM':
        return this.handleItemWebhook(plaidItem, payload);
      
      case 'ERROR':
        return this.handleErrorWebhook(plaidItem, payload);
      
      case 'ASSETS':
        return this.handleAssetsWebhook(plaidItem, payload);
      
      default:
        this.logger.warn('Unknown webhook type', { webhook_type });
        return { status: 'ignored', reason: 'unknown_webhook_type' };
    }
  }

  private async handleTransactionsWebhook(plaidItem: any, payload: WebhookPayload) {
    const { webhook_code } = payload;

    switch (webhook_code) {
      case 'DEFAULT_UPDATE':
      case 'INITIAL_UPDATE':
        // New transactions available
        await this.scheduleTransactionSync(plaidItem, 'webhook_triggered');
        return { 
          status: 'processed', 
          action: 'sync_scheduled',
          new_transactions: payload.new_transactions
        };

      case 'HISTORICAL_UPDATE':
        // Historical transactions updated
        await this.scheduleTransactionSync(plaidItem, 'full_refresh');
        return { 
          status: 'processed', 
          action: 'full_refresh_scheduled' 
        };

      case 'TRANSACTIONS_REMOVED':
        // Transactions were removed
        if (payload.removed_transactions?.length) {
          await this.handleRemovedTransactions(plaidItem, payload.removed_transactions);
        }
        return { 
          status: 'processed', 
          action: 'transactions_removed',
          removed_count: payload.removed_transactions?.length || 0
        };

      default:
        this.logger.warn('Unknown transactions webhook code', { webhook_code });
        return { status: 'ignored', reason: 'unknown_webhook_code' };
    }
  }

  private async handleItemWebhook(plaidItem: any, payload: WebhookPayload) {
    const { webhook_code } = payload;

    switch (webhook_code) {
      case 'ERROR':
        // Item is in error state
        await this.db('plaid_items')
          .where('id', plaidItem.id)
          .update({
            sync_status: 'error',
            error_info: {
              webhook_error: payload.error,
              timestamp: new Date().toISOString()
            },
            updated_at: new Date()
          });

        return { 
          status: 'processed', 
          action: 'item_error_recorded',
          error: payload.error 
        };

      case 'PENDING_EXPIRATION':
        // Item access will expire soon
        this.logger.warn('Plaid item pending expiration', {
          itemId: payload.item_id,
          organizationId: plaidItem.organization_id
        });
        
        // Could trigger notification to user to re-authenticate
        return { 
          status: 'processed', 
          action: 'expiration_warning_logged' 
        };

      case 'USER_PERMISSION_REVOKED':
        // User revoked access
        await this.db('plaid_items')
          .where('id', plaidItem.id)
          .update({
            sync_status: 'disabled',
            error_info: {
              reason: 'user_permission_revoked',
              timestamp: new Date().toISOString()
            },
            updated_at: new Date()
          });

        return { 
          status: 'processed', 
          action: 'item_disabled' 
        };

      case 'WEBHOOK_UPDATE_ACKNOWLEDGED':
        // Webhook URL update acknowledged
        return { 
          status: 'processed', 
          action: 'webhook_update_acknowledged' 
        };

      default:
        this.logger.warn('Unknown item webhook code', { webhook_code });
        return { status: 'ignored', reason: 'unknown_webhook_code' };
    }
  }

  private async handleErrorWebhook(plaidItem: any, payload: WebhookPayload) {
    // Handle error webhooks
    await this.db('plaid_items')
      .where('id', plaidItem.id)
      .update({
        sync_status: 'error',
        error_info: {
          webhook_error: payload.error,
          timestamp: new Date().toISOString()
        },
        updated_at: new Date()
      });

    return { 
      status: 'processed', 
      action: 'error_logged',
      error: payload.error 
    };
  }

  private async handleAssetsWebhook(plaidItem: any, payload: WebhookPayload) {
    // Handle assets webhooks (if using Assets product)
    this.logger.info('Assets webhook received', {
      itemId: payload.item_id,
      webhookCode: payload.webhook_code
    });

    // Assets webhooks would be handled differently based on your needs
    return { 
      status: 'processed', 
      action: 'assets_webhook_logged' 
    };
  }

  private async scheduleTransactionSync(plaidItem: any, jobType: string) {
    await this.db('plaid_sync_jobs').insert({
      organization_id: plaidItem.organization_id,
      plaid_item_id: plaidItem.id,
      job_type: jobType,
      status: 'pending',
      scheduled_at: new Date(),
      job_data: {
        organization_id: plaidItem.organization_id,
        plaid_item_id: plaidItem.id,
        triggered_by: 'webhook'
      }
    });
  }

  private async handleRemovedTransactions(plaidItem: any, removedTransactionIds: string[]) {
    const trx = await this.db.transaction();

    try {
      for (const transactionId of removedTransactionIds) {
        // Mark raw transaction as removed
        await trx('plaid_transactions_raw')
          .where('organization_id', plaidItem.organization_id)
          .where('transaction_id', transactionId)
          .update({
            processing_status: 'removed',
            updated_at: new Date()
          });

        // Cancel local transaction if it exists
        await trx('transactions')
          .where('organization_id', plaidItem.organization_id)
          .where('plaid_transaction_id_external', transactionId)
          .update({
            status: 'cancelled',
            updated_at: new Date()
          });
      }

      await trx.commit();
    } catch (error) {
      await trx.rollback();
      throw error;
    }
  }

  private async logWebhook(payload: WebhookPayload) {
    await this.db('plaid_webhooks').insert({
      item_id: payload.item_id,
      webhook_type: payload.webhook_type,
      webhook_code: payload.webhook_code,
      webhook_data: payload,
      processed: false
    });
  }

  private validateSignature(payload: string, signature: string): boolean {
    if (!this.webhookSecret) {
      this.logger.warn('Webhook secret not configured, skipping signature validation');
      return true;
    }

    const expectedSignature = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(payload)
      .digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  }
}