import { Knex } from 'knex';
import winston from 'winston';
import { Products } from 'plaid';
import { PlaidService } from './PlaidService';
import { PlaidClient } from './PlaidClient';
import { TransactionProcessor } from './TransactionProcessor';
import { SyncJobProcessor } from './SyncJobProcessor';
import { PlaidWebhookHandler } from '../webhook/PlaidWebhookHandler';

interface PlaidConfig {
  clientId: string;
  secret: string;
  environment: 'sandbox' | 'development' | 'production';
  products: Products[];
  countryCodes: string[];
  webhookUrl: string;
  webhookSecret: string;
}

export class PlaidIntegration {
  private db: Knex;
  private logger: winston.Logger;
  private config: PlaidConfig;
  private encryptionKey: string;

  public plaidService!: PlaidService;
  public syncJobProcessor!: SyncJobProcessor;
  public webhookHandler!: PlaidWebhookHandler;

  constructor(
    db: Knex,
    logger: winston.Logger,
    config: PlaidConfig,
    encryptionKey: string
  ) {
    this.db = db;
    this.logger = logger;
    this.config = config;
    this.encryptionKey = encryptionKey;

    this.initializeServices();
  }

  private initializeServices() {
    this.logger.info('Initializing Plaid integration services');

    // Initialize core Plaid service
    this.plaidService = new PlaidService(
      this.db,
      this.logger,
      this.config,
      this.encryptionKey
    );

    // Initialize sync job processor
    this.syncJobProcessor = new SyncJobProcessor(
      this.db,
      this.logger,
      this.plaidService
    );

    // Initialize webhook handler
    this.webhookHandler = new PlaidWebhookHandler(
      this.db,
      this.logger,
      this.plaidService,
      this.config.webhookSecret
    );

    this.logger.info('Plaid integration services initialized');
  }

  async start() {
    try {
      this.logger.info('Starting Plaid integration');

      // Start the sync job processor
      this.syncJobProcessor.start();

      // Schedule periodic cleanup
      this.schedulePeriodicTasks();

      this.logger.info('Plaid integration started successfully');
    } catch (error) {
      this.logger.error('Failed to start Plaid integration', { error: (error as Error).message });
      throw error;
    }
  }

  async stop() {
    try {
      this.logger.info('Stopping Plaid integration');

      // Stop sync job processor
      this.syncJobProcessor.stop();

      // Clear any scheduled tasks
      this.clearPeriodicTasks();

      this.logger.info('Plaid integration stopped');
    } catch (error) {
      this.logger.error('Error stopping Plaid integration', { error: (error as Error).message });
      throw error;
    }
  }

  private schedulePeriodicTasks() {
    // Clean up old data every 6 hours
    setInterval(async () => {
      try {
        await this.performMaintenance();
      } catch (error) {
        this.logger.error('Error in periodic maintenance', { error: (error as Error).message });
      }
    }, 6 * 60 * 60 * 1000); // 6 hours

    // Health check every 30 minutes
    setInterval(async () => {
      try {
        await this.performHealthCheck();
      } catch (error) {
        this.logger.error('Error in health check', { error: (error as Error).message });
      }
    }, 30 * 60 * 1000); // 30 minutes

    // Schedule regular syncs for active items
    setInterval(async () => {
      try {
        await this.scheduleRegularSyncs();
      } catch (error) {
        this.logger.error('Error scheduling regular syncs', { error: (error as Error).message });
      }
    }, 60 * 60 * 1000); // 1 hour
  }

  private clearPeriodicTasks() {
    // In a production environment, you would store the interval IDs and clear them here
  }

  private async performMaintenance() {
    this.logger.info('Starting periodic maintenance');

    try {
      // Clean up sync jobs
      await this.syncJobProcessor.scheduleCleanup();

      // Clean up old Plaid data using the database function
      await this.db.raw('SELECT cleanup_old_plaid_data()');

      // Remove failed items that haven't synced in 7 days
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 7);

      await this.db('plaid_items')
        .where('sync_status', 'error')
        .where('consecutive_failures', '>', 10)
        .where('last_sync_at', '<', cutoffDate)
        .update({
          sync_status: 'disabled',
          error_info: this.db.raw(`
            jsonb_set(
              COALESCE(error_info, '{}'),
              '{auto_disabled}',
              '"true"'
            ) || jsonb_build_object(
              'auto_disabled_at', '${new Date().toISOString()}',
              'reason', 'too_many_consecutive_failures'
            )
          `)
        });

      this.logger.info('Periodic maintenance completed');
    } catch (error) {
      this.logger.error('Error during maintenance', { error: (error as Error).message });
    }
  }

  private async performHealthCheck() {
    try {
      // Check for items with high failure rates
      const problemItems = await this.db('plaid_items')
        .select('id', 'item_id', 'institution_name', 'consecutive_failures', 'organization_id')
        .where('consecutive_failures', '>', 5)
        .where('sync_status', 'active');

      if (problemItems.length > 0) {
        this.logger.warn('Items with high failure rates detected', {
          count: problemItems.length,
          items: problemItems.map(item => ({
            itemId: item.item_id,
            institution: item.institution_name,
            failures: item.consecutive_failures
          }))
        });
      }

      // Check for stuck running jobs
      const stuckJobs = await this.db('plaid_sync_jobs')
        .where('status', 'running')
        .where('started_at', '<', this.db.raw('NOW() - INTERVAL \'2 hours\''));

      if (stuckJobs.length > 0) {
        this.logger.warn('Stuck sync jobs detected', {
          count: stuckJobs.length,
          jobs: stuckJobs.map(job => ({
            id: job.id,
            type: job.job_type,
            started: job.started_at
          }))
        });
      }

      // Check webhook processing health
      const recentWebhooks = await this.db('plaid_webhooks')
        .where('created_at', '>', this.db.raw('NOW() - INTERVAL \'1 hour\''))
        .where('processed', false);

      if (recentWebhooks.length > 10) {
        this.logger.warn('High number of unprocessed webhooks', {
          count: recentWebhooks.length
        });
      }

    } catch (error) {
      this.logger.error('Error during health check', { error: (error as Error).message });
    }
  }

  private async scheduleRegularSyncs() {
    try {
      // Find items that haven't synced in the last 4 hours and are due for sync
      const itemsForSync = await this.db('plaid_items')
        .select('id', 'organization_id', 'item_id', 'institution_name')
        .where('sync_status', 'active')
        .where('consecutive_failures', '<', 3)
        .where(builder => {
          builder
            .whereNull('last_sync_at')
            .orWhere('last_sync_at', '<', this.db.raw('NOW() - INTERVAL \'4 hours\''));
        })
        .whereNotExists(
          this.db('plaid_sync_jobs')
            .select(1)
            .whereRaw('plaid_item_id = plaid_items.id')
            .where('status', 'in', ['pending', 'running'])
        )
        .limit(50); // Limit to avoid overwhelming the system

      for (const item of itemsForSync) {
        await this.db('plaid_sync_jobs').insert({
          organization_id: item.organization_id,
          plaid_item_id: item.id,
          job_type: 'incremental_sync',
          status: 'pending',
          scheduled_at: new Date(),
          job_data: {
            organization_id: item.organization_id,
            plaid_item_id: item.id,
            triggered_by: 'scheduler'
          }
        });

        this.logger.debug('Scheduled regular sync', {
          itemId: item.item_id,
          institution: item.institution_name
        });
      }

      if (itemsForSync.length > 0) {
        this.logger.info('Scheduled regular syncs', { count: itemsForSync.length });
      }

    } catch (error) {
      this.logger.error('Error scheduling regular syncs', { error: (error as Error).message });
    }
  }

  async getIntegrationStatus() {
    try {
      // Get overall statistics
      const [
        totalConnections,
        activeConnections,
        errorConnections,
        recentJobs,
        unprocessedWebhooks
      ] = await Promise.all([
        this.db('plaid_items').count('* as count').first(),
        this.db('plaid_items').where('sync_status', 'active').count('* as count').first(),
        this.db('plaid_items').where('sync_status', 'error').count('* as count').first(),
        this.db('plaid_sync_jobs')
          .where('created_at', '>', this.db.raw('NOW() - INTERVAL \'24 hours\''))
          .count('* as count')
          .first(),
        this.db('plaid_webhooks').where('processed', false).count('* as count').first()
      ]);

      return {
        connections: {
          total: parseInt(totalConnections?.count as string || '0'),
          active: parseInt(activeConnections?.count as string || '0'),
          error: parseInt(errorConnections?.count as string || '0')
        },
        sync_jobs: {
          recent_24h: parseInt(recentJobs?.count as string || '0')
        },
        webhooks: {
          unprocessed: parseInt(unprocessedWebhooks?.count as string || '0')
        },
        status: 'healthy'
      };
    } catch (error) {
      this.logger.error('Error getting integration status', { error: (error as Error).message });
      throw error;
    }
  }
}

// Export types and classes
export * from './PlaidService';
export * from './PlaidClient';
export * from './TransactionProcessor';
export * from './SyncJobProcessor';
export { PlaidWebhookHandler } from '../webhook/PlaidWebhookHandler';