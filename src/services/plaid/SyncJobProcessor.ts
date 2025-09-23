import { Knex } from 'knex';
import winston from 'winston';
import { PlaidService } from './PlaidService';

interface SyncJob {
  id: string;
  organization_id: string;
  plaid_item_id: string;
  job_type: 'initial_sync' | 'incremental_sync' | 'full_refresh' | 'webhook_triggered';
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  scheduled_at: Date;
  job_data: any;
  retry_count: number;
  next_retry_at?: Date;
}

export class SyncJobProcessor {
  private db: Knex;
  private logger: winston.Logger;
  private plaidService: PlaidService;
  private isProcessing = false;
  private processingInterval?: NodeJS.Timeout;
  private maxRetries = 3;
  private retryDelays = [5 * 60 * 1000, 15 * 60 * 1000, 60 * 60 * 1000]; // 5min, 15min, 1hr

  constructor(db: Knex, logger: winston.Logger, plaidService: PlaidService) {
    this.db = db;
    this.logger = logger;
    this.plaidService = plaidService;
  }

  start(intervalMs = 30000) {
    if (this.processingInterval) {
      this.logger.warn('Sync job processor already started');
      return;
    }

    this.logger.info('Starting sync job processor', { intervalMs });
    
    this.processingInterval = setInterval(() => {
      this.processJobs().catch(error => {
        this.logger.error('Error in job processing loop', { error: error.message });
      });
    }, intervalMs);

    // Process immediately on start
    this.processJobs().catch(error => {
      this.logger.error('Error in initial job processing', { error: error.message });
    });
  }

  stop() {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = undefined;
      this.logger.info('Sync job processor stopped');
    }
  }

  private async processJobs() {
    if (this.isProcessing) {
      return; // Already processing
    }

    this.isProcessing = true;

    try {
      // Get pending jobs or jobs ready for retry
      const jobs = await this.db('plaid_sync_jobs')
        .where(builder => {
          builder
            .where('status', 'pending')
            .orWhere(subBuilder => {
              subBuilder
                .where('status', 'failed')
                .where('retry_count', '<', this.maxRetries)
                .where('next_retry_at', '<=', new Date());
            });
        })
        .where('scheduled_at', '<=', new Date())
        .orderBy('scheduled_at', 'asc')
        .limit(10); // Process up to 10 jobs at once

      if (jobs.length === 0) {
        return;
      }

      this.logger.info('Processing sync jobs', { jobCount: jobs.length });

      // Process jobs concurrently (with some limit)
      const promises = jobs.map(job => this.processJob(job));
      await Promise.allSettled(promises);

    } catch (error) {
      this.logger.error('Error processing jobs', { error: (error as Error).message });
    } finally {
      this.isProcessing = false;
    }
  }

  private async processJob(job: SyncJob) {
    const jobId = job.id;
    const startTime = new Date();

    try {
      // Mark job as running
      await this.db('plaid_sync_jobs')
        .where('id', jobId)
        .update({
          status: 'running',
          started_at: startTime
        });

      this.logger.info('Processing sync job', {
        jobId,
        jobType: job.job_type,
        itemId: job.plaid_item_id,
        organizationId: job.organization_id,
        retryCount: job.retry_count
      });

      let result: any;

      switch (job.job_type) {
        case 'initial_sync':
        case 'incremental_sync':
        case 'webhook_triggered':
          result = await this.plaidService.processTransactionSync(job.plaid_item_id);
          break;

        case 'full_refresh':
          result = await this.processFullRefresh(job);
          break;

        default:
          throw new Error(`Unknown job type: ${job.job_type}`);
      }

      // Mark job as completed
      await this.db('plaid_sync_jobs')
        .where('id', jobId)
        .update({
          status: 'completed',
          completed_at: new Date(),
          result_data: result
        });

      const duration = new Date().getTime() - startTime.getTime();

      this.logger.info('Sync job completed', {
        jobId,
        jobType: job.job_type,
        duration: `${duration}ms`,
        result
      });

    } catch (error) {
      const errorMessage = (error as Error).message;
      const duration = new Date().getTime() - startTime.getTime();

      this.logger.error('Sync job failed', {
        jobId,
        jobType: job.job_type,
        duration: `${duration}ms`,
        error: errorMessage,
        retryCount: job.retry_count
      });

      // Determine if we should retry
      const shouldRetry = job.retry_count < this.maxRetries && this.isRetryableError(error);
      const newRetryCount = job.retry_count + 1;
      const nextRetryAt = shouldRetry ? 
        new Date(Date.now() + this.retryDelays[Math.min(newRetryCount - 1, this.retryDelays.length - 1)]) : 
        null;

      await this.db('plaid_sync_jobs')
        .where('id', jobId)
        .update({
          status: shouldRetry ? 'failed' : 'failed',
          completed_at: new Date(),
          retry_count: newRetryCount,
          next_retry_at: nextRetryAt,
          error_message: errorMessage,
          result_data: {
            error: errorMessage,
            retry_count: newRetryCount,
            will_retry: shouldRetry
          }
        });

      // Don't propagate error - we've handled it
    }
  }

  private async processFullRefresh(job: SyncJob) {
    // For full refresh, we need to clear the cursor and sync from the beginning
    const plaidItem = await this.db('plaid_items')
      .where('id', job.plaid_item_id)
      .first();

    if (!plaidItem) {
      throw new Error('Plaid item not found');
    }

    // Clear cursor to start fresh sync
    await this.db('plaid_items')
      .where('id', job.plaid_item_id)
      .update({ cursor: null });

    // Process the sync
    const result = await this.plaidService.processTransactionSync(job.plaid_item_id);

    return {
      ...result,
      refresh_type: 'full'
    };
  }

  private isRetryableError(error: any): boolean {
    const retryableErrors = [
      'ITEM_LOGIN_REQUIRED',
      'PRODUCTS_NOT_READY',
      'INSTITUTION_DOWN',
      'INSTITUTION_NOT_RESPONDING',
      'INTERNAL_SERVER_ERROR',
      'PLANNED_MAINTENANCE'
    ];

    // Check if it's a Plaid error with a retryable error code
    if (error.plaidErrorCode && retryableErrors.includes(error.plaidErrorCode)) {
      return true;
    }

    // Check for network-related errors
    const errorMessage = error.message?.toLowerCase() || '';
    const networkErrors = [
      'timeout',
      'network error',
      'connection refused',
      'enotfound',
      'econnreset'
    ];

    return networkErrors.some(netError => errorMessage.includes(netError));
  }

  async scheduleCleanup() {
    try {
      // Clean up old completed/failed jobs
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 30); // Keep jobs for 30 days

      const deletedCount = await this.db('plaid_sync_jobs')
        .where('status', 'in', ['completed', 'failed'])
        .where('completed_at', '<', cutoffDate)
        .del();

      if (deletedCount > 0) {
        this.logger.info('Cleaned up old sync jobs', { deletedCount });
      }

      // Cancel jobs that have been running for too long (over 1 hour)
      const staleJobCutoff = new Date();
      staleJobCutoff.setHours(staleJobCutoff.getHours() - 1);

      const cancelledCount = await this.db('plaid_sync_jobs')
        .where('status', 'running')
        .where('started_at', '<', staleJobCutoff)
        .update({
          status: 'failed',
          completed_at: new Date(),
          error_message: 'Job cancelled due to timeout'
        });

      if (cancelledCount > 0) {
        this.logger.warn('Cancelled stale sync jobs', { cancelledCount });
      }

    } catch (error) {
      this.logger.error('Error during sync job cleanup', { error: (error as Error).message });
    }
  }

  async getJobStatistics(organizationId: string, hours = 24) {
    try {
      const cutoffTime = new Date();
      cutoffTime.setHours(cutoffTime.getHours() - hours);

      const stats = await this.db('plaid_sync_jobs')
        .select(
          this.db.raw('COUNT(*) as total_jobs'),
          this.db.raw('COUNT(CASE WHEN status = \'completed\' THEN 1 END) as completed_jobs'),
          this.db.raw('COUNT(CASE WHEN status = \'failed\' THEN 1 END) as failed_jobs'),
          this.db.raw('COUNT(CASE WHEN status = \'running\' THEN 1 END) as running_jobs'),
          this.db.raw('COUNT(CASE WHEN status = \'pending\' THEN 1 END) as pending_jobs'),
          this.db.raw('AVG(CASE WHEN completed_at IS NOT NULL THEN EXTRACT(EPOCH FROM (completed_at - started_at)) END) as avg_duration_seconds')
        )
        .where('organization_id', organizationId)
        .where('created_at', '>=', cutoffTime)
        .first();

      return stats;
    } catch (error) {
      this.logger.error('Error getting job statistics', { error: (error as Error).message });
      throw error;
    }
  }
}