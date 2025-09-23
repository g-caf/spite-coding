/**
 * Audit logging utilities
 */

import { knex } from './database';

export interface AuditLogEntry {
  action: string;
  resource_type: string;
  resource_id?: string;
  organization_id?: string;
  user_id?: string;
  details?: Record<string, any>;
  ip_address?: string;
  user_agent?: string;
}

export class AuditLogger {
  /**
   * Log an audit event
   */
  async log(entry: AuditLogEntry): Promise<void> {
    try {
      await knex('audit_events').insert({
        id: knex.raw('uuid_generate_v4()'),
        action: entry.action,
        resource_type: entry.resource_type,
        resource_id: entry.resource_id,
        organization_id: entry.organization_id,
        user_id: entry.user_id,
        details: JSON.stringify(entry.details || {}),
        ip_address: entry.ip_address,
        user_agent: entry.user_agent,
        created_at: knex.fn.now()
      });
    } catch (error) {
      console.error('Failed to log audit event:', error);
      // Don't throw - audit logging should not break the application
    }
  }

  /**
   * Log authentication events
   */
  async logAuth(action: 'LOGIN' | 'LOGOUT' | 'LOGIN_FAILED', userId?: string, details?: Record<string, any>): Promise<void> {
    await this.log({
      action,
      resource_type: 'Authentication',
      user_id: userId,
      details
    });
  }

  /**
   * Log data access events
   */
  async logDataAccess(
    action: 'READ' | 'SEARCH' | 'EXPORT',
    resourceType: string,
    resourceId: string,
    userId: string,
    organizationId: string
  ): Promise<void> {
    await this.log({
      action: `${action}_${resourceType.toUpperCase()}`,
      resource_type: resourceType,
      resource_id: resourceId,
      organization_id: organizationId,
      user_id: userId
    });
  }

  /**
   * Log security events
   */
  async logSecurity(
    event: 'PERMISSION_DENIED' | 'SUSPICIOUS_ACTIVITY' | 'POLICY_VIOLATION',
    userId?: string,
    organizationId?: string,
    details?: Record<string, any>
  ): Promise<void> {
    await this.log({
      action: event,
      resource_type: 'Security',
      user_id: userId,
      organization_id: organizationId,
      details
    });
  }

  /**
   * Get audit trail for a resource
   */
  async getAuditTrail(
    resourceType: string,
    resourceId: string,
    organizationId?: string,
    limit = 50
  ): Promise<any[]> {
    let query = knex('audit_events')
      .select(
        'audit_events.*',
        'u.first_name',
        'u.last_name',
        'u.email'
      )
      .leftJoin('users as u', 'audit_events.user_id', 'u.id')
      .where('resource_type', resourceType)
      .where('resource_id', resourceId);

    if (organizationId) {
      query = query.where('audit_events.organization_id', organizationId);
    }

    return query
      .orderBy('created_at', 'desc')
      .limit(limit);
  }

  /**
   * Get user activity summary
   */
  async getUserActivity(
    userId: string,
    organizationId: string,
    days = 30
  ): Promise<{
    total_actions: number;
    recent_actions: any[];
    action_summary: Record<string, number>;
  }> {
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [totalResult, recentActions, actionSummary] = await Promise.all([
      knex('audit_events')
        .where('user_id', userId)
        .where('organization_id', organizationId)
        .where('created_at', '>=', startDate)
        .count('id as total')
        .first(),

      knex('audit_events')
        .where('user_id', userId)
        .where('organization_id', organizationId)
        .where('created_at', '>=', startDate)
        .orderBy('created_at', 'desc')
        .limit(20),

      knex('audit_events')
        .select('action')
        .count('id as count')
        .where('user_id', userId)
        .where('organization_id', organizationId)
        .where('created_at', '>=', startDate)
        .groupBy('action')
        .orderBy('count', 'desc')
    ]);

    return {
      total_actions: parseInt(totalResult?.total || 0),
      recent_actions: recentActions,
      action_summary: actionSummary.reduce((acc, row) => {
        acc[row.action] = parseInt(row.count);
        return acc;
      }, {})
    };
  }
}

export const auditLogger = new AuditLogger();
