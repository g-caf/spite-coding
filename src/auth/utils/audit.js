const winston = require('winston');
const authConfig = require('../../../config/auth');

// Configure Winston logger for audit events
const auditLogger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'expense-platform-auth' },
  transports: [
    // Write all audit logs to audit.log
    new winston.transports.File({ 
      filename: 'logs/audit.log',
      level: 'info'
    }),
    
    // Write error logs to error.log
    new winston.transports.File({ 
      filename: 'logs/error.log', 
      level: 'error' 
    }),
  ],
});

// Add console transport in development
if (process.env.NODE_ENV !== 'production') {
  auditLogger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    )
  }));
}

class AuditLogger {
  // Log authentication and authorization events
  static async logAuditEvent(eventData) {
    if (!authConfig.audit.enabled) {
      return;
    }

    try {
      const auditEvent = {
        timestamp: new Date().toISOString(),
        event: eventData.event,
        userId: eventData.userId || null,
        email: eventData.email || null,
        organizationId: eventData.organizationId || null,
        sessionId: eventData.sessionId || null,
        ipAddress: eventData.ipAddress || null,
        userAgent: eventData.userAgent || null,
        endpoint: eventData.endpoint || null,
        method: eventData.method || null,
        resource: eventData.resource || null,
        action: eventData.action || null,
        permission: eventData.permission || null,
        role: eventData.role || null,
        provider: eventData.provider || null,
        success: eventData.success !== undefined ? eventData.success : true,
        error: eventData.error || null,
        metadata: eventData.metadata || {},
        severity: this.calculateSeverity(eventData.event, eventData.success),
      };

      // Only log events that are in the configured events list
      if (!authConfig.audit.events.includes(eventData.event)) {
        return;
      }

      auditLogger.info('AUDIT_EVENT', auditEvent);

      // Store in database if needed (implement based on your data layer)
      await this.storeAuditEvent(auditEvent);

      // Send real-time alerts for critical events
      await this.handleCriticalEvents(auditEvent);

    } catch (error) {
      console.error('Error logging audit event:', error);
    }
  }

  // Calculate severity level for the event
  static calculateSeverity(eventType, success) {
    const highSeverityEvents = [
      'login_failure',
      'account_locked',
      'authorization_denied',
      'mfa_disabled',
      'role_change',
      'password_change',
      'sessions_revoked',
    ];

    const mediumSeverityEvents = [
      'login_success',
      'logout',
      'mfa_enabled',
      'saml_login',
    ];

    if (!success) {
      return 'high';
    }

    if (highSeverityEvents.includes(eventType)) {
      return 'high';
    }

    if (mediumSeverityEvents.includes(eventType)) {
      return 'medium';
    }

    return 'low';
  }

  // Store audit event in database (implement based on your data layer)
  static async storeAuditEvent(auditEvent) {
    // This would typically store in your database
    // For now, we'll just log it
    console.log('Storing audit event:', auditEvent.event);
  }

  // Handle critical security events
  static async handleCriticalEvents(auditEvent) {
    const criticalEvents = [
      'account_locked',
      'mfa_disabled',
      'authorization_denied',
      'rate_limit_exceeded',
    ];

    if (criticalEvents.includes(auditEvent.event) || auditEvent.severity === 'high') {
      // Send alerts (email, Slack, PagerDuty, etc.)
      await this.sendSecurityAlert(auditEvent);
    }
  }

  // Send security alerts
  static async sendSecurityAlert(auditEvent) {
    try {
      // This would integrate with your alerting system
      console.log('SECURITY ALERT:', {
        event: auditEvent.event,
        severity: auditEvent.severity,
        userId: auditEvent.userId,
        ipAddress: auditEvent.ipAddress,
        timestamp: auditEvent.timestamp,
      });

      // Example: Send email alert
      // await emailService.sendSecurityAlert(auditEvent);
      
      // Example: Send Slack notification
      // await slackService.sendAlert(auditEvent);
      
    } catch (error) {
      console.error('Error sending security alert:', error);
    }
  }

  // Get audit logs (for admin interface)
  static async getAuditLogs(filters = {}) {
    const {
      userId,
      event,
      startDate,
      endDate,
      ipAddress,
      success,
      limit = 100,
      offset = 0,
    } = filters;

    try {
      // This would query your database
      // For now, return mock data
      return {
        logs: [],
        total: 0,
        limit,
        offset,
      };
    } catch (error) {
      console.error('Error fetching audit logs:', error);
      throw error;
    }
  }

  // Generate audit report
  static async generateAuditReport(startDate, endDate, organizationId = null) {
    try {
      // This would generate a comprehensive audit report
      const report = {
        period: { startDate, endDate },
        organizationId,
        summary: {
          totalEvents: 0,
          loginAttempts: 0,
          successfulLogins: 0,
          failedLogins: 0,
          mfaEvents: 0,
          authorizationDenials: 0,
          accountLockouts: 0,
        },
        topEvents: [],
        suspiciousActivity: [],
        userActivity: [],
        organizationStats: {},
        generatedAt: new Date().toISOString(),
      };

      return report;
    } catch (error) {
      console.error('Error generating audit report:', error);
      throw error;
    }
  }

  // Monitor for suspicious patterns
  static async detectSuspiciousActivity(userId, ipAddress, timeWindow = '1h') {
    try {
      // This would analyze recent audit logs for suspicious patterns
      const patterns = [
        'multiple_failed_logins',
        'unusual_login_location',
        'rapid_permission_changes',
        'off_hours_access',
        'multiple_mfa_failures',
      ];

      const suspiciousEvents = [];

      // Check for multiple failed logins
      // Check for unusual IP addresses
      // Check for rapid role/permission changes
      // Check for access outside business hours
      // etc.

      return {
        isSuspicious: suspiciousEvents.length > 0,
        patterns: suspiciousEvents,
        riskScore: this.calculateRiskScore(suspiciousEvents),
      };
    } catch (error) {
      console.error('Error detecting suspicious activity:', error);
      return { isSuspicious: false, patterns: [], riskScore: 0 };
    }
  }

  // Calculate risk score based on suspicious patterns
  static calculateRiskScore(suspiciousEvents) {
    const weights = {
      multiple_failed_logins: 30,
      unusual_login_location: 20,
      rapid_permission_changes: 40,
      off_hours_access: 15,
      multiple_mfa_failures: 35,
    };

    return suspiciousEvents.reduce((score, event) => {
      return score + (weights[event] || 10);
    }, 0);
  }

  // Export audit logs (for compliance)
  static async exportAuditLogs(format = 'json', filters = {}) {
    try {
      const logs = await this.getAuditLogs(filters);
      
      switch (format.toLowerCase()) {
        case 'csv':
          return this.convertToCSV(logs.logs);
        case 'json':
          return JSON.stringify(logs.logs, null, 2);
        case 'xml':
          return this.convertToXML(logs.logs);
        default:
          throw new Error(`Unsupported export format: ${format}`);
      }
    } catch (error) {
      console.error('Error exporting audit logs:', error);
      throw error;
    }
  }

  // Convert audit logs to CSV format
  static convertToCSV(logs) {
    if (!logs || logs.length === 0) {
      return 'No logs to export';
    }

    const headers = Object.keys(logs[0]).join(',');
    const rows = logs.map(log => 
      Object.values(log).map(value => 
        typeof value === 'object' ? JSON.stringify(value) : value
      ).join(',')
    );

    return [headers, ...rows].join('\n');
  }

  // Convert audit logs to XML format
  static convertToXML(logs) {
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<auditLogs>\n';
    
    logs.forEach(log => {
      xml += '  <log>\n';
      Object.entries(log).forEach(([key, value]) => {
        xml += `    <${key}>${value}</${key}>\n`;
      });
      xml += '  </log>\n';
    });
    
    xml += '</auditLogs>';
    return xml;
  }
}

// Export the logAuditEvent function for convenience
const logAuditEvent = AuditLogger.logAuditEvent.bind(AuditLogger);

module.exports = {
  AuditLogger,
  logAuditEvent,
  auditLogger,
};