/**
 * Background Job Processor for Matching Engine
 * Handles bulk operations and async processing
 */

import { matchingService } from './matchingService.js';
import { MatchingDatabaseService } from './databaseService.js';
import { logger } from '../../utils/logger.js';
import { EventEmitter } from 'events';

interface MatchingJob {
  id: string;
  organization_id: string;
  type: 'bulk_match' | 'auto_match_new' | 'reprocess_failed';
  status: 'pending' | 'running' | 'completed' | 'failed';
  priority: number;
  payload: any;
  created_at: Date;
  started_at?: Date;
  completed_at?: Date;
  error?: string;
  progress?: {
    total: number;
    completed: number;
    current_operation?: string;
  };
}

export class MatchingJobProcessor extends EventEmitter {
  private jobs: Map<string, MatchingJob> = new Map();
  private runningJobs: Set<string> = new Set();
  private maxConcurrentJobs: number = 3;
  private pollInterval: number = 5000; // 5 seconds
  private isProcessing: boolean = false;
  private dbService?: MatchingDatabaseService;

  constructor(dbService?: MatchingDatabaseService) {
    super();
    this.dbService = dbService;
  }

  /**
   * Start the job processor
   */
  start(): void {
    if (this.isProcessing) {
      logger.warn('Job processor already running');
      return;
    }

    this.isProcessing = true;
    logger.info('Starting matching job processor', {
      max_concurrent: this.maxConcurrentJobs,
      poll_interval: this.pollInterval
    });

    this.processJobs();
  }

  /**
   * Stop the job processor
   */
  stop(): void {
    this.isProcessing = false;
    logger.info('Stopping matching job processor');
  }

  /**
   * Add a new job to the queue
   */
  async addJob(
    organizationId: string,
    type: MatchingJob['type'],
    payload: any,
    priority: number = 100
  ): Promise<string> {
    const jobId = `job-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const job: MatchingJob = {
      id: jobId,
      organization_id: organizationId,
      type,
      status: 'pending',
      priority,
      payload,
      created_at: new Date()
    };

    this.jobs.set(jobId, job);
    
    logger.info('Job added to queue', {
      job_id: jobId,
      organization_id: organizationId,
      type,
      priority
    });

    this.emit('job_queued', job);
    return jobId;
  }

  /**
   * Get job status
   */
  getJob(jobId: string): MatchingJob | undefined {
    return this.jobs.get(jobId);
  }

  /**
   * Get all jobs for an organization
   */
  getJobsForOrganization(organizationId: string): MatchingJob[] {
    return Array.from(this.jobs.values())
      .filter(job => job.organization_id === organizationId)
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
  }

  /**
   * Cancel a pending job
   */
  cancelJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;

    if (job.status === 'pending') {
      job.status = 'failed';
      job.error = 'Cancelled by user';
      job.completed_at = new Date();
      
      logger.info('Job cancelled', { job_id: jobId });
      this.emit('job_cancelled', job);
      return true;
    }

    return false;
  }

  /**
   * Main job processing loop
   */
  private async processJobs(): Promise<void> {
    while (this.isProcessing) {
      try {
        if (this.runningJobs.size < this.maxConcurrentJobs) {
          const nextJob = this.getNextJob();
          if (nextJob) {
            this.runJob(nextJob);
          }
        }

        await new Promise(resolve => setTimeout(resolve, this.pollInterval));
      } catch (error) {
        logger.error('Error in job processing loop', {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  /**
   * Get the next job to process (highest priority, oldest first)
   */
  private getNextJob(): MatchingJob | undefined {
    const pendingJobs = Array.from(this.jobs.values())
      .filter(job => job.status === 'pending')
      .sort((a, b) => {
        // Higher priority first, then older jobs first
        if (a.priority !== b.priority) {
          return b.priority - a.priority;
        }
        return a.created_at.getTime() - b.created_at.getTime();
      });

    return pendingJobs[0];
  }

  /**
   * Run a specific job
   */
  private async runJob(job: MatchingJob): Promise<void> {
    this.runningJobs.add(job.id);
    job.status = 'running';
    job.started_at = new Date();

    logger.info('Starting job execution', {
      job_id: job.id,
      organization_id: job.organization_id,
      type: job.type
    });

    this.emit('job_started', job);

    try {
      switch (job.type) {
        case 'bulk_match':
          await this.processBulkMatch(job);
          break;
        case 'auto_match_new':
          await this.processAutoMatchNew(job);
          break;
        case 'reprocess_failed':
          await this.processReprocessFailed(job);
          break;
        default:
          throw new Error(`Unknown job type: ${job.type}`);
      }

      job.status = 'completed';
      job.completed_at = new Date();

      logger.info('Job completed successfully', {
        job_id: job.id,
        duration_ms: job.completed_at.getTime() - job.started_at!.getTime()
      });

      this.emit('job_completed', job);

    } catch (error) {
      job.status = 'failed';
      job.error = error instanceof Error ? error.message : String(error);
      job.completed_at = new Date();

      logger.error('Job failed', {
        job_id: job.id,
        error: job.error
      });

      this.emit('job_failed', job);
    } finally {
      this.runningJobs.delete(job.id);
    }
  }

  /**
   * Process bulk matching job
   */
  private async processBulkMatch(job: MatchingJob): Promise<void> {
    const { batch_size = 100, config } = job.payload;

    job.progress = {
      total: 0,
      completed: 0,
      current_operation: 'Initializing bulk match'
    };

    const result = await matchingService.performBulkMatching(
      job.organization_id,
      batch_size,
      config
    );

    job.payload.result = result;
  }

  /**
   * Process auto-match for new items
   */
  private async processAutoMatchNew(job: MatchingJob): Promise<void> {
    const { transactions, receipts, config } = job.payload;

    job.progress = {
      total: transactions.length + receipts.length,
      completed: 0,
      current_operation: 'Auto-matching new items'
    };

    const result = await matchingService.performAutoMatching(
      job.organization_id,
      transactions,
      receipts,
      config
    );

    job.payload.result = result;
    job.progress.completed = job.progress.total;
  }

  /**
   * Reprocess failed matches
   */
  private async processReprocessFailed(job: MatchingJob): Promise<void> {
    // Implementation would reprocess previously failed matching attempts
    // with updated algorithms or configurations
    
    job.progress = {
      total: 1,
      completed: 0,
      current_operation: 'Reprocessing failed matches'
    };

    // Placeholder implementation
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    job.progress.completed = 1;
  }

  /**
   * Clean up old completed jobs
   */
  cleanupOldJobs(maxAge: number = 7 * 24 * 60 * 60 * 1000): number { // 7 days default
    const cutoff = new Date(Date.now() - maxAge);
    let cleanedCount = 0;

    for (const [jobId, job] of Array.from(this.jobs.entries())) {
      if (job.status !== 'running' && job.created_at < cutoff) {
        this.jobs.delete(jobId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      logger.info('Cleaned up old jobs', { 
        cleaned_count: cleanedCount,
        cutoff_date: cutoff 
      });
    }

    return cleanedCount;
  }

  /**
   * Get processing statistics
   */
  getStats(): {
    total_jobs: number;
    pending: number;
    running: number;
    completed: number;
    failed: number;
    queue_size: number;
  } {
    const jobs = Array.from(this.jobs.values());
    
    return {
      total_jobs: jobs.length,
      pending: jobs.filter(j => j.status === 'pending').length,
      running: jobs.filter(j => j.status === 'running').length,
      completed: jobs.filter(j => j.status === 'completed').length,
      failed: jobs.filter(j => j.status === 'failed').length,
      queue_size: this.runningJobs.size
    };
  }
}

// Singleton instance
export const jobProcessor = new MatchingJobProcessor();
