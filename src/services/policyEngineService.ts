/**
 * Policy Engine Service
 * Expense policy enforcement and compliance monitoring
 */

import { knex } from '../utils/database';
import { auditLogger } from '../utils/audit';

export interface PolicyRule {
  id: string;
  organization_id: string;
  name: string;
  description?: string;
  policy_type: 'spending_limit' | 'receipt_requirement' | 'approval_workflow' | 'time_restriction' | 'merchant_restriction';
  conditions: PolicyConditions;
  enforcement: PolicyEnforcement;
  severity: 'low' | 'medium' | 'high' | 'critical';
  active: boolean;
  violation_count: number;
  created_by: string;
  updated_by: string;
  created_at: Date;
  updated_at: Date;
}

export interface PolicyConditions {
  // User and role conditions
  user_ids?: any[];
  roles?: any[];
  departments?: any[];
  
  // Category conditions
  category_ids?: any[];
  category_types?: any[];
  
  // Amount conditions
  amount_limits?: {
    daily?: number;
    weekly?: number;
    monthly?: number;
    per_transaction?: number;
  };
  
  // Time conditions
  time_restrictions?: {
    business_hours_only?: boolean;
    weekdays_only?: boolean;
    blocked_dates?: any[];
    allowed_time_range?: {
      start: string; // HH:MM
      end: string;   // HH:MM
    };
  };
  
  // Merchant conditions
  merchant_restrictions?: {
    blocked_merchants?: any[];
    allowed_merchants?: any[];
    blocked_categories?: any[];
    require_pre_approval?: any[];
  };
  
  // Receipt conditions
  receipt_requirements?: {
    threshold_amount?: number;
    always_required?: boolean;
    categories_requiring_receipt?: any[];
    max_days_to_submit?: number;
  };
  
  // Location conditions
  location_restrictions?: {
    allowed_countries?: any[];
    blocked_countries?: any[];
    require_justification?: any[];
  };
  
  // Frequency conditions
  frequency_limits?: {
    max_per_day?: number;
    max_per_week?: number;
    max_per_month?: number;
    same_merchant_limit?: number;
  };
}

export interface PolicyEnforcement {
  // Immediate actions
  block_transaction?: boolean;
  require_approval?: boolean;
  require_justification?: boolean;
  require_receipt?: boolean;
  
  // Notification actions
  notify_manager?: boolean;
  notify_compliance?: boolean;
  notify_users?: any[];
  escalate_to?: any[];
  
  // Workflow actions
  auto_flag?: boolean;
  create_violation?: boolean;
  require_review?: boolean;
  
  // Grace period
  grace_period_hours?: number;
  allow_override?: boolean;
  override_roles?: any[];
}

export interface PolicyViolation {
  id: string;
  organization_id: string;
  transaction_id: string;
  policy_rule_id: string;
  violation_type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  violation_details: any;
  status: 'open' | 'acknowledged' | 'resolved' | 'false_positive';
  assigned_to?: string;
  resolution_notes?: string;
  resolved_at?: Date;
  created_at: Date;
  updated_at: Date;
}

export interface ComplianceReport {
  organization_id: string;
  report_period: {
    start_date: string;
    end_date: string;
  };
  summary: {
    total_transactions: number;
    policy_violations: number;
    compliance_rate: number;
    blocked_transactions: number;
    pending_approvals: number;
    missing_receipts: number;
  };
  violation_breakdown: Array<{
    policy_type: string;
    violation_count: number;
    severity_distribution: Record<string, number>;
    trend: 'increasing' | 'decreasing' | 'stable';
  }>;
  top_violators: Array<{
    user_id: string;
    user_name: string;
    violation_count: number;
    most_common_violation: string;
  }>;
  policy_effectiveness: Array<{
    policy_id: string;
    policy_name: string;
    violations_prevented: number;
    false_positives: number;
    effectiveness_score: number;
  }>;
}

export class PolicyEngineService {
  /**
   * Evaluate a transaction against all active policies
   */
  async evaluateTransaction(transaction: any, organization_id: string, userId: string): Promise<{
    violations: PolicyViolation[];
    warnings: any[];
    actions_required: any[];
    blocked: boolean;
    requires_approval: boolean;
  }> {
    const violations: PolicyViolation[] = [];
    const warnings: any[] = [];
    const actionsRequired: any[] = [];
    let blocked = false;
    let requiresApproval = false;

    // Get active policies for the organization
    const activePolicies = await knex('policy_rules')
      .where('organization_id', organizationId)
      .where('active', true)
      .orderBy('severity', 'desc'); // Process critical policies first

    for (const policy of activePolicies) {
      const policyRule: PolicyRule = {
        ...policy,
        conditions: JSON.parse(policy.conditions),
        enforcement: JSON.parse(policy.enforcement)
      };

      const evaluation = await this.evaluatePolicyRule(policyRule, transaction, organization_id, userId);
      
      if (evaluation.violates) {
        const violation = await this.createPolicyViolation({
          organization_id,
          transactionId: transaction.id,
          policyRuleId: policy.id,
          violationType: evaluation.violation_type,
          severity: policy.severity,
          description: evaluation.description,
          violationDetails: evaluation.details
        });

        violations.push(violation);

        // Apply enforcement actions
        if (policyRule.enforcement.block_transaction) {
          blocked = true;
        }
        
        if (policyRule.enforcement.require_approval) {
          requiresApproval = true;
        }

        if (policyRule.enforcement.require_justification) {
          actionsRequired.push('Justification required');
        }

        if (policyRule.enforcement.require_receipt) {
          actionsRequired.push('Receipt required');
        }

        // Handle notifications
        await this.triggerPolicyNotifications(policyRule, transaction, violation);
      } else if (evaluation.warning) {
        warnings.push(evaluation.warning);
      }
    }

    return {
      violations,
      warnings,
      actions_required: actionsRequired,
      blocked,
      requires_approval: requiresApproval
    };
  }

  /**
   * Create a new policy rule
   */
  async createPolicyRule(policyData: Partial<PolicyRule>): Promise<PolicyRule> {
    const [policy] = await knex('policy_rules')
      .insert({
        organization_id: policyData.organization_id,
        name: policyData.name,
        description: policyData.description,
        policy_type: policyData.policy_type,
        conditions: JSON.stringify(policyData.conditions),
        enforcement: JSON.stringify(policyData.enforcement),
        severity: policyData.severity,
        active: policyData.active !== false,
        violation_count: 0,
        created_by: policyData.created_by,
        updated_by: policyData.updated_by,
        created_at: knex.fn.now(),
        updated_at: knex.fn.now()
      })
      .returning('*');

    await auditLogger.log({
      action: 'CREATE_POLICY_RULE',
      resource_type: 'PolicyRule',
      resource_id: policy.id,
      organization_id: policyData.organization_id,
      user_id: policyData.created_by,
      details: {
        policy_name: policy.name,
        policy_type: policy.policy_type,
        severity: policy.severity
      }
    });

    return {
      ...policy,
      conditions: JSON.parse(policy.conditions),
      enforcement: JSON.parse(policy.enforcement)
    };
  }

  /**
   * Get compliance report for an organization
   */
  async generateComplianceReport(params: {
    organization_id: string;
    startDate: string;
    endDate: string;
  }): Promise<ComplianceReport> {
    const { organization_id, startDate, endDate } = params;

    // Summary statistics
    const summary = await knex.raw(`
      SELECT 
        COUNT(t.id) as total_transactions,
        COUNT(pv.id) as policy_violations,
        ROUND(
          (COUNT(t.id) - COUNT(pv.id)) * 100.0 / NULLIF(COUNT(t.id), 0), 2
        ) as compliance_rate,
        COUNT(CASE WHEN t.status = 'blocked' THEN 1 END) as blocked_transactions,
        COUNT(CASE WHEN t.status = 'pending_approval' THEN 1 END) as pending_approvals,
        COUNT(CASE WHEN r.id IS NULL AND t.amount > 25 THEN 1 END) as missing_receipts
      FROM transactions t
      LEFT JOIN policy_violations pv ON t.id = pv.transaction_id
      LEFT JOIN matches m ON t.id = m.transaction_id AND m.active = true
      LEFT JOIN receipts r ON m.receipt_id = r.id
      WHERE t.organization_id = ?
      AND t.transaction_date BETWEEN ? AND ?
    `, [organization_id, startDate, endDate]);

    // Violation breakdown
    const violationBreakdown = await knex.raw(`
      SELECT 
        pr.policy_type,
        COUNT(pv.id) as violation_count,
        jsonb_object_agg(pv.severity, severity_counts.count) as severity_distribution
      FROM policy_rules pr
      LEFT JOIN policy_violations pv ON pr.id = pv.policy_rule_id 
        AND pv.created_at BETWEEN ? AND ?
      LEFT JOIN (
        SELECT policy_rule_id, severity, COUNT(*) as count
        FROM policy_violations
        WHERE organization_id = ? AND created_at BETWEEN ? AND ?
        GROUP BY policy_rule_id, severity
      ) severity_counts ON pr.id = severity_counts.policy_rule_id
      WHERE pr.organization_id = ?
      GROUP BY pr.policy_type
      ORDER BY violation_count DESC
    `, [startDate, endDate, organization_id, startDate, endDate, organizationId]);

    // Top violators
    const topViolators = await knex.raw(`
      SELECT 
        u.id as user_id,
        CONCAT(u.first_name, ' ', u.last_name) as user_name,
        COUNT(pv.id) as violation_count,
        MODE() WITHIN GROUP (ORDER BY pr.policy_type) as most_common_violation
      FROM users u
      LEFT JOIN transactions t ON u.id = t.created_by
      LEFT JOIN policy_violations pv ON t.id = pv.transaction_id
      LEFT JOIN policy_rules pr ON pv.policy_rule_id = pr.id
      WHERE u.organization_id = ?
      AND pv.created_at BETWEEN ? AND ?
      GROUP BY u.id, u.first_name, u.last_name
      HAVING COUNT(pv.id) > 0
      ORDER BY violation_count DESC
      LIMIT 10
    `, [organization_id, startDate, endDate]);

    // Policy effectiveness
    const policyEffectiveness = await knex.raw(`
      SELECT 
        pr.id as policy_id,
        pr.name as policy_name,
        COUNT(pv.id) as violations_prevented,
        COUNT(CASE WHEN pv.status = 'false_positive' THEN 1 END) as false_positives,
        ROUND(
          100.0 - (COUNT(CASE WHEN pv.status = 'false_positive' THEN 1 END) * 100.0 / 
                   NULLIF(COUNT(pv.id), 0)), 2
        ) as effectiveness_score
      FROM policy_rules pr
      LEFT JOIN policy_violations pv ON pr.id = pv.policy_rule_id
        AND pv.created_at BETWEEN ? AND ?
      WHERE pr.organization_id = ?
      AND pr.active = true
      GROUP BY pr.id, pr.name
      ORDER BY effectiveness_score DESC
    `, [startDate, endDate, organizationId]);

    return {
      organization_id: organization_id,
      report_period: {
        start_date: startDate,
        end_date: endDate
      },
      summary: summary.rows[0],
      violation_breakdown: violationBreakdown.rows,
      top_violators: topViolators.rows,
      policy_effectiveness: policyEffectiveness.rows
    };
  }

  /**
   * Resolve a policy violation
   */
  async resolvePolicyViolation(params: {
    violationId: string;
    organization_id: string;
    userId: string;
    resolution: 'resolved' | 'false_positive';
    notes?: string;
  }): Promise<PolicyViolation> {
    const { violationId, organization_id, userId, resolution, notes } = params;

    const [violation] = await knex('policy_violations')
      .where('id', violationId)
      .where('organization_id', organizationId)
      .update({
        status: resolution,
        assigned_to: userId,
        resolution_notes: notes,
        resolved_at: knex.fn.now(),
        updated_at: knex.fn.now()
      })
      .returning('*');

    if (!violation) {
      throw new Error('Policy violation not found');
    }

    await auditLogger.log({
      action: 'RESOLVE_POLICY_VIOLATION',
      resource_type: 'PolicyViolation',
      resource_id: violationId,
      organization_id: organization_id,
      user_id: userId,
      details: {
        resolution,
        notes
      }
    });

    return violation;
  }

  /**
   * Get policy dashboard data
   */
  async getPolicyDashboard(organization_id: string): Promise<{
    active_policies: number;
    recent_violations: PolicyViolation[];
    compliance_trends: Array<{
      date: string;
      compliance_rate: number;
      violation_count: number;
    }>;
    high_risk_users: Array<{
      user_id: string;
      user_name: string;
      risk_score: number;
      recent_violations: number;
    }>;
  }> {
    // Active policies count
    const activePoliciesCount! = await knex('policy_rules')
      .where('organization_id', organizationId)
      .where('active', true)
      .count('id as count')
      .first();

    // Recent violations
    const recentViolations = await knex('policy_violations as pv')
      .select(
        'pv.*',
        'pr.name as policy_name',
        'pr.policy_type',
        'u.first_name',
        'u.last_name'
      )
      .join('policy_rules as pr', 'pv.policy_rule_id', 'pr.id')
      .join('transactions as t', 'pv.transaction_id', 't.id')
      .join('users as u', 't.created_by', 'u.id')
      .where('pv.organization_id', organizationId)
      .where('pv.status', 'open')
      .orderBy('pv.created_at', 'desc')
      .limit(10);

    // Compliance trends (last 30 days)
    const complianceTrends = await knex.raw(`
      SELECT 
        DATE_TRUNC('day', t.transaction_date) as date,
        COUNT(t.id) as total_transactions,
        COUNT(pv.id) as violations,
        ROUND(
          (COUNT(t.id) - COUNT(pv.id)) * 100.0 / NULLIF(COUNT(t.id), 0), 2
        ) as compliance_rate
      FROM transactions t
      LEFT JOIN policy_violations pv ON t.id = pv.transaction_id
      WHERE t.organization_id = ?
      AND t.transaction_date >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY DATE_TRUNC('day', t.transaction_date)
      ORDER BY date DESC
    `, [organizationId]);

    // High risk users (based on recent violations)
    const highRiskUsers = await knex.raw(`
      SELECT 
        u.id as user_id,
        CONCAT(u.first_name, ' ', u.last_name) as user_name,
        COUNT(pv.id) as recent_violations,
        ROUND(
          COUNT(pv.id) * 10.0 + 
          COUNT(CASE WHEN pv.severity = 'critical' THEN 5
               WHEN pv.severity = 'high' THEN 3
               WHEN pv.severity = 'medium' THEN 2
               ELSE 1 END), 0
        ) as risk_score
      FROM users u
      LEFT JOIN transactions t ON u.id = t.created_by
      LEFT JOIN policy_violations pv ON t.id = pv.transaction_id
        AND pv.created_at >= CURRENT_DATE - INTERVAL '30 days'
      WHERE u.organization_id = ?
      GROUP BY u.id, u.first_name, u.last_name
      HAVING COUNT(pv.id) > 0
      ORDER BY risk_score DESC
      LIMIT 10
    `, [organizationId]);

    return {
      active_policies: parseInt((activePoliciesCount! as any)?.count || "0"),
      recent_violations: recentViolations,
      compliance_trends: complianceTrends.rows.map(row => ({
        date: row.date,
        compliance_rate: parseFloat(row.compliance_rate) || 0,
        violation_count: parseInt(row.violations)
      })),
      high_risk_users: highRiskUsers.rows
    };
  }

  /**
   * Private helper methods
   */

  private async evaluatePolicyRule(
    policyRule: PolicyRule,
    transaction: any,
    organization_id: string,
    userId: string
  ): Promise<{
    violates: boolean;
    violation_type?: string;
    description?: string;
    details?: any;
    warning?: string;
  }> {
    const { conditions } = policyRule;

    // Check user/role conditions
    if (conditions.user_ids && !conditions.user_ids.includes(userId)) {
      return { violates: false };
    }

    if (conditions.roles) {
      const user = await knex('users').where('id', userId).first();
      if (!conditions.roles.includes(user.role)) {
        return { violates: false };
      }
    }

    // Check spending limits
    if (conditions.amount_limits) {
      const violation = await this.checkSpendingLimits(conditions.amount_limits, transaction, userId, organizationId);
      if (violation.violates) {
        return {
          violates: true,
          violation_type: 'spending_limit_exceeded',
          description: violation.description,
          details: violation.details
        };
      }
    }

    // Check time restrictions
    if (conditions.time_restrictions) {
      const violation = await this.checkTimeRestrictions(conditions.time_restrictions, transaction);
      if (violation.violates) {
        return {
          violates: true,
          violation_type: 'time_restriction_violated',
          description: violation.description,
          details: violation.details
        };
      }
    }

    // Check merchant restrictions
    if (conditions.merchant_restrictions) {
      const violation = await this.checkMerchantRestrictions(conditions.merchant_restrictions, transaction);
      if (violation.violates) {
        return {
          violates: true,
          violation_type: 'merchant_restriction_violated',
          description: violation.description,
          details: violation.details
        };
      }
    }

    // Check receipt requirements
    if (conditions.receipt_requirements) {
      const violation = await this.checkReceiptRequirements(conditions.receipt_requirements, transaction);
      if (violation.violates) {
        return {
          violates: true,
          violation_type: 'receipt_requirement_violated',
          description: violation.description,
          details: violation.details
        };
      }
    }

    return { violates: false };
  }

  private async checkSpendingLimits(
    limits: any,
    transaction: any,
    userId: string,
    organization_id: string
  ): Promise<{ violates: boolean; description?: string; details?: any }> {
    const amount = Math.abs(transaction.amount);

    // Check per-transaction limit
    if (limits.per_transaction && amount > limits.per_transaction) {
      return {
        violates: true,
        description: `Transaction amount $${amount} exceeds per-transaction limit of $${limits.per_transaction}`,
        details: { limit_type: 'per_transaction', amount, limit: limits.per_transaction }
      };
    }

    // Check daily limit
    if (limits.daily) {
      const todaySpending! = await knex('transactions')
        .where('organization_id', organizationId)
        .where('created_by', userId)
        .where('transaction_date', '>=', knex.raw('CURRENT_DATE'))
        .sum('amount as total')
        .first();

      const totalToday = Math.abs(parseFloat(todaySpending!.total) || 0) + amount;
      if (totalToday > limits.daily) {
        return {
          violates: true,
          description: `Daily spending limit of $${limits.daily} would be exceeded (current: $${totalToday})`,
          details: { limit_type: 'daily', current_spending: totalToday, limit: limits.daily }
        };
      }
    }

    // Check weekly limit
    if (limits.weekly) {
      const weekSpending! = await knex('transactions')
        .where('organization_id', organizationId)
        .where('created_by', userId)
        .where('transaction_date', '>=', knex.raw('DATE_TRUNC(\'week\', CURRENT_DATE)'))
        .sum('amount as total')
        .first();

      const totalWeek = Math.abs(parseFloat(weekSpending!.total) || 0) + amount;
      if (totalWeek > limits.weekly) {
        return {
          violates: true,
          description: `Weekly spending limit of $${limits.weekly} would be exceeded (current: $${totalWeek})`,
          details: { limit_type: 'weekly', current_spending: totalWeek, limit: limits.weekly }
        };
      }
    }

    // Check monthly limit
    if (limits.monthly) {
      const monthSpending! = await knex('transactions')
        .where('organization_id', organizationId)
        .where('created_by', userId)
        .where('transaction_date', '>=', knex.raw('DATE_TRUNC(\'month\', CURRENT_DATE)'))
        .sum('amount as total')
        .first();

      const totalMonth = Math.abs(parseFloat(monthSpending!.total) || 0) + amount;
      if (totalMonth > limits.monthly) {
        return {
          violates: true,
          description: `Monthly spending limit of $${limits.monthly} would be exceeded (current: $${totalMonth})`,
          details: { limit_type: 'monthly', current_spending: totalMonth, limit: limits.monthly }
        };
      }
    }

    return { violates: false };
  }

  private async checkTimeRestrictions(
    restrictions: any,
    transaction: any
  ): Promise<{ violates: boolean; description?: string; details?: any }> {
    const transactionDate = new Date(transaction.transaction_date);
    
    // Check business hours
    if (restrictions.business_hours_only) {
      const hour = transactionDate.getHours();
      if (hour < 9 || hour > 17) {
        return {
          violates: true,
          description: 'Transaction occurred outside business hours (9 AM - 5 PM)',
          details: { transaction_time: transactionDate.toISOString(), restriction: 'business_hours_only' }
        };
      }
    }

    // Check weekdays only
    if (restrictions.weekdays_only) {
      const day = transactionDate.getDay();
      if (day === 0 || day === 6) { // Sunday = 0, Saturday = 6
        return {
          violates: true,
          description: 'Transaction occurred on weekend (weekdays only policy)',
          details: { transaction_date: transactionDate.toISOString(), restriction: 'weekdays_only' }
        };
      }
    }

    // Check blocked dates
    if (restrictions.blocked_dates && restrictions.blocked_dates.length > 0) {
      const transactionDateStr = transactionDate.toISOString().split('T')[0];
      if (restrictions.blocked_dates.includes(transactionDateStr)) {
        return {
          violates: true,
          description: 'Transaction occurred on a blocked date',
          details: { transaction_date: transactionDateStr, restriction: 'blocked_dates' }
        };
      }
    }

    return { violates: false };
  }

  private async checkMerchantRestrictions(
    restrictions: any,
    transaction: any
  ): Promise<{ violates: boolean; description?: string; details?: any }> {
    const merchantName = transaction.merchant_name || transaction.description || '';

    // Check blocked merchants
    if (restrictions.blocked_merchants && restrictions.blocked_merchants.length > 0) {
      const blockedMerchant = restrictions.blocked_merchants.find((blocked: string) =>
        merchantName.toLowerCase().includes(blocked.toLowerCase())
      );
      
      if (blockedMerchant) {
        return {
          violates: true,
          description: `Transaction with blocked merchant: ${blockedMerchant}`,
          details: { merchant_name: merchantName, blocked_merchant: blockedMerchant }
        };
      }
    }

    // Check allowed merchants (if specified, transaction must be with allowed merchant)
    if (restrictions.allowed_merchants && restrictions.allowed_merchants.length > 0) {
      const isAllowed = restrictions.allowed_merchants.some((allowed: string) =>
        merchantName.toLowerCase().includes(allowed.toLowerCase())
      );
      
      if (!isAllowed) {
        return {
          violates: true,
          description: `Transaction not with approved merchant`,
          details: { merchant_name: merchantName, allowed_merchants: restrictions.allowed_merchants }
        };
      }
    }

    return { violates: false };
  }

  private async checkReceiptRequirements(
    requirements: any,
    transaction: any
  ): Promise<{ violates: boolean; description?: string; details?: any }> {
    const amount = Math.abs(transaction.amount);

    // Check if receipt is required based on amount threshold
    let receiptRequired = false;

    if (requirements.always_required) {
      receiptRequired = true;
    } else if (requirements.threshold_amount && amount >= requirements.threshold_amount) {
      receiptRequired = true;
    } else if (requirements.categories_requiring_receipt && transaction.category_id) {
      receiptRequired = requirements.categories_requiring_receipt.includes(transaction.category_id);
    }

    if (receiptRequired) {
      // Check if receipt exists
      const hasReceipt = await knex('matches')
        .join('receipts', 'matches.receipt_id', 'receipts.id')
        .where('matches.transaction_id', transaction.id)
        .where('matches.active', true)
        .first();

      if (!hasReceipt) {
        return {
          violates: true,
          description: `Receipt required for transaction of $${amount}`,
          details: { 
            amount,
            receipt_required: true,
            threshold: requirements.threshold_amount,
            max_days: requirements.max_days_to_submit || 30
          }
        };
      }
    }

    return { violates: false };
  }

  private async createPolicyViolation(params: {
    organization_id: string;
    transactionId: string;
    policyRuleId: string;
    violationType: string;
    severity: string;
    description: string;
    violationDetails: any;
  }): Promise<PolicyViolation> {
    const [violation] = await knex('policy_violations')
      .insert({
        organization_id: params.organization_id,
        transaction_id: params.transactionId,
        policy_rule_id: params.policyRuleId,
        violation_type: params.violationType,
        severity: params.severity,
        description: params.description,
        violation_details: JSON.stringify(params.violationDetails),
        status: 'open',
        created_at: knex.fn.now(),
        updated_at: knex.fn.now()
      })
      .returning('*');

    // Update policy rule violation count
    await knex('policy_rules')
      .where('id', params.policyRuleId)
      .increment('violation_count', 1);

    return {
      ...violation,
      violation_details: JSON.parse(violation.violation_details)
    };
  }

  private async triggerPolicyNotifications(
    policyRule: PolicyRule,
    transaction: any,
    violation: PolicyViolation
  ): Promise<void> {
    const notifications = [];

    if (policyRule.enforcement.notify_manager) {
      notifications.push({
        type: 'manager',
        recipient_type: 'manager'
      });
    }

    if (policyRule.enforcement.notify_compliance) {
      notifications.push({
        type: 'compliance',
        recipient_type: 'compliance'
      });
    }

    if (policyRule.enforcement.notify_users) {
      for (const userId of policyRule.enforcement.notify_users) {
        notifications.push({
          type: 'user',
          recipient_type: 'user',
          recipient_id: userId
        });
      }
    }

    // Queue notifications
    for (const notification of notifications) {
      await knex('notification_queue').insert({
        organization_id: policyRule.organization_id,
        transaction_id: transaction.id,
        notification_type: 'policy_violation',
        recipients: JSON.stringify([notification.recipient_id].filter(Boolean)),
        notify_manager: notification.recipient_type === 'manager',
        message: `Policy violation: ${violation.description}`,
        metadata: JSON.stringify({
          policy_name: policyRule.name,
          violation_id: violation.id,
          severity: violation.severity
        }),
        created_at: knex.fn.now(),
        updated_at: knex.fn.now()
      });
    }
  }
}
