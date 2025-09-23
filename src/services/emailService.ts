/**
 * Email Service for Receipt Processing
 * Handles email receipt forwarding and notifications
 */

import nodemailer from 'nodemailer';
import { SESClient, SendEmailCommand, SendRawEmailCommand } from '@aws-sdk/client-ses';
import winston from 'winston';
import { ProcessingResult } from './receiptService';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/email.log' })
  ]
});

export interface EmailConfig {
  provider: 'ses' | 'smtp';
  sesClient?: SESClient;
  smtpConfig?: {
    host: string;
    port: number;
    secure: boolean;
    auth: {
      user: string;
      pass: string;
    };
  };
  fromEmail: string;
  fromName: string;
}

export interface EmailTemplate {
  subject: string;
  textBody: string;
  htmlBody: string;
}

export class EmailService {
  private config: EmailConfig;
  private transporter?: nodemailer.Transporter;
  private sesClient?: SESClient;

  constructor() {
    this.config = this.loadConfig();
    this.initialize();
  }

  private loadConfig(): EmailConfig {
    if (process.env.NODE_ENV === 'production' && process.env.AWS_SES_ENABLED === 'true') {
      return {
        provider: 'ses',
        sesClient: new SESClient({
          region: process.env.AWS_REGION || 'us-east-1',
          credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
          },
        }),
        fromEmail: process.env.FROM_EMAIL || 'receipts@company.com',
        fromName: process.env.FROM_NAME || 'Expense Platform'
      };
    } else {
      return {
        provider: 'smtp',
        smtpConfig: {
          host: process.env.SMTP_HOST || 'localhost',
          port: parseInt(process.env.SMTP_PORT || '587'),
          secure: process.env.SMTP_SECURE === 'true',
          auth: {
            user: process.env.SMTP_USER || '',
            pass: process.env.SMTP_PASS || ''
          }
        },
        fromEmail: process.env.FROM_EMAIL || 'receipts@company.com',
        fromName: process.env.FROM_NAME || 'Expense Platform'
      };
    }
  }

  private initialize(): void {
    if (this.config.provider === 'ses') {
      this.sesClient = this.config.sesClient;
    } else if (this.config.smtpConfig) {
      this.transporter = nodemailer.createTransport(this.config.smtpConfig);
    }
  }

  /**
   * Send receipt processed confirmation email
   */
  async sendReceiptProcessedEmail(
    toEmail: string,
    results: ProcessingResult[]
  ): Promise<void> {
    try {
      const successful = results.filter(r => r.status === 'success');
      const failed = results.filter(r => r.status === 'failed');
      const duplicates = results.filter(r => r.status === 'duplicate');

      const template = this.generateReceiptProcessedTemplate(successful, failed, duplicates);
      
      await this.sendEmail({
        to: toEmail,
        subject: template.subject,
        textBody: template.textBody,
        htmlBody: template.htmlBody
      });

      logger.info('Receipt processed email sent', {
        toEmail,
        successCount: successful.length,
        failedCount: failed.length,
        duplicateCount: duplicates.length
      });

    } catch (error) {
      logger.error('Failed to send receipt processed email', {
        toEmail,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Send receipt processing error email
   */
  async sendReceiptErrorEmail(
    toEmail: string,
    filename: string,
    error: string
  ): Promise<void> {
    try {
      const template = this.generateErrorTemplate(filename, error);
      
      await this.sendEmail({
        to: toEmail,
        subject: template.subject,
        textBody: template.textBody,
        htmlBody: template.htmlBody
      });

      logger.info('Receipt error email sent', { toEmail, filename, error });

    } catch (emailError) {
      logger.error('Failed to send receipt error email', {
        toEmail,
        filename,
        originalError: error,
        emailError: emailError instanceof Error ? emailError.message : 'Unknown error'
      });
    }
  }

  /**
   * Send duplicate receipt notification
   */
  async sendDuplicateNotification(
    toEmail: string,
    filename: string,
    existingReceiptId: string,
    confidence: number
  ): Promise<void> {
    try {
      const template = this.generateDuplicateTemplate(filename, existingReceiptId, confidence);
      
      await this.sendEmail({
        to: toEmail,
        subject: template.subject,
        textBody: template.textBody,
        htmlBody: template.htmlBody
      });

      logger.info('Duplicate notification sent', {
        toEmail,
        filename,
        existingReceiptId,
        confidence
      });

    } catch (error) {
      logger.error('Failed to send duplicate notification', {
        toEmail,
        filename,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Send low confidence extraction alert
   */
  async sendLowConfidenceAlert(
    toEmail: string,
    receiptId: string,
    confidence: number,
    extractedFields: any[]
  ): Promise<void> {
    try {
      const template = this.generateLowConfidenceTemplate(receiptId, confidence, extractedFields);
      
      await this.sendEmail({
        to: toEmail,
        subject: template.subject,
        textBody: template.textBody,
        htmlBody: template.htmlBody
      });

      logger.info('Low confidence alert sent', {
        toEmail,
        receiptId,
        confidence
      });

    } catch (error) {
      logger.error('Failed to send low confidence alert', {
        toEmail,
        receiptId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Send weekly receipt processing summary
   */
  async sendWeeklySummary(
    toEmail: string,
    organizationId: string,
    summary: {
      totalProcessed: number;
      successfullyProcessed: number;
      failed: number;
      duplicates: number;
      averageProcessingTime: number;
      topMerchants: Array<{ name: string; count: number; total: number }>;
      categoryBreakdown: Array<{ category: string; count: number; total: number }>;
    }
  ): Promise<void> {
    try {
      const template = this.generateWeeklySummaryTemplate(summary);
      
      await this.sendEmail({
        to: toEmail,
        subject: template.subject,
        textBody: template.textBody,
        htmlBody: template.htmlBody
      });

      logger.info('Weekly summary sent', { toEmail, organizationId });

    } catch (error) {
      logger.error('Failed to send weekly summary', {
        toEmail,
        organizationId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Core email sending function
   */
  private async sendEmail({
    to,
    subject,
    textBody,
    htmlBody,
    attachments
  }: {
    to: string;
    subject: string;
    textBody: string;
    htmlBody: string;
    attachments?: Array<{
      filename: string;
      content: Buffer;
      contentType: string;
    }>;
  }): Promise<void> {
    if (this.config.provider === 'ses' && this.sesClient) {
      await this.sendViaSES({ to, subject, textBody, htmlBody, attachments });
    } else if (this.transporter) {
      await this.sendViaSMTP({ to, subject, textBody, htmlBody, attachments });
    } else {
      throw new Error('No email transport configured');
    }
  }

  /**
   * Send email via AWS SES
   */
  private async sendViaSES({
    to,
    subject,
    textBody,
    htmlBody,
    attachments
  }: {
    to: string;
    subject: string;
    textBody: string;
    htmlBody: string;
    attachments?: Array<{
      filename: string;
      content: Buffer;
      contentType: string;
    }>;
  }): Promise<void> {
    if (!this.sesClient) {
      throw new Error('SES client not configured');
    }

    if (attachments && attachments.length > 0) {
      // For attachments, use raw email
      const rawEmail = this.buildRawEmail({
        from: `${this.config.fromName} <${this.config.fromEmail}>`,
        to,
        subject,
        textBody,
        htmlBody,
        attachments
      });

      const command = new SendRawEmailCommand({
        Source: this.config.fromEmail,
        Destinations: [to],
        RawMessage: {
          Data: new Uint8Array(Buffer.from(rawEmail))
        }
      });

      await this.sesClient.send(command);
    } else {
      // Simple email without attachments
      const command = new SendEmailCommand({
        Source: this.config.fromEmail,
        Destination: {
          ToAddresses: [to]
        },
        Message: {
          Subject: {
            Data: subject,
            Charset: 'UTF-8'
          },
          Body: {
            Text: {
              Data: textBody,
              Charset: 'UTF-8'
            },
            Html: {
              Data: htmlBody,
              Charset: 'UTF-8'
            }
          }
        }
      });

      await this.sesClient.send(command);
    }
  }

  /**
   * Send email via SMTP
   */
  private async sendViaSMTP({
    to,
    subject,
    textBody,
    htmlBody,
    attachments
  }: {
    to: string;
    subject: string;
    textBody: string;
    htmlBody: string;
    attachments?: Array<{
      filename: string;
      content: Buffer;
      contentType: string;
    }>;
  }): Promise<void> {
    if (!this.transporter) {
      throw new Error('SMTP transporter not configured');
    }

    const mailOptions: nodemailer.SendMailOptions = {
      from: `${this.config.fromName} <${this.config.fromEmail}>`,
      to,
      subject,
      text: textBody,
      html: htmlBody
    };

    if (attachments && attachments.length > 0) {
      mailOptions.attachments = attachments.map(attachment => ({
        filename: attachment.filename,
        content: attachment.content,
        contentType: attachment.contentType
      }));
    }

    await this.transporter.sendMail(mailOptions);
  }

  /**
   * Build raw email for SES with attachments
   */
  private buildRawEmail({
    from,
    to,
    subject,
    textBody,
    htmlBody,
    attachments
  }: {
    from: string;
    to: string;
    subject: string;
    textBody: string;
    htmlBody: string;
    attachments?: Array<{
      filename: string;
      content: Buffer;
      contentType: string;
    }>;
  }): string {
    const boundary = `----=_NextPart_${Date.now()}_${Math.random().toString(36)}`;
    
    let rawEmail = `From: ${from}\r\n`;
    rawEmail += `To: ${to}\r\n`;
    rawEmail += `Subject: ${subject}\r\n`;
    rawEmail += `MIME-Version: 1.0\r\n`;
    rawEmail += `Content-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n`;

    // Text and HTML parts
    rawEmail += `--${boundary}\r\n`;
    rawEmail += `Content-Type: multipart/alternative; boundary="${boundary}-alt"\r\n\r\n`;
    
    rawEmail += `--${boundary}-alt\r\n`;
    rawEmail += `Content-Type: text/plain; charset=UTF-8\r\n\r\n`;
    rawEmail += `${textBody}\r\n\r\n`;
    
    rawEmail += `--${boundary}-alt\r\n`;
    rawEmail += `Content-Type: text/html; charset=UTF-8\r\n\r\n`;
    rawEmail += `${htmlBody}\r\n\r\n`;
    
    rawEmail += `--${boundary}-alt--\r\n`;

    // Attachments
    if (attachments) {
      for (const attachment of attachments) {
        rawEmail += `--${boundary}\r\n`;
        rawEmail += `Content-Type: ${attachment.contentType}\r\n`;
        rawEmail += `Content-Disposition: attachment; filename="${attachment.filename}"\r\n`;
        rawEmail += `Content-Transfer-Encoding: base64\r\n\r\n`;
        rawEmail += attachment.content.toString('base64') + '\r\n\r\n';
      }
    }

    rawEmail += `--${boundary}--\r\n`;
    
    return rawEmail;
  }

  /**
   * Template generators
   */
  private generateReceiptProcessedTemplate(
    successful: ProcessingResult[],
    failed: ProcessingResult[],
    duplicates: ProcessingResult[]
  ): EmailTemplate {
    const totalCount = successful.length + failed.length + duplicates.length;
    
    const subject = `Receipt Processing Complete - ${successful.length}/${totalCount} processed successfully`;
    
    let textBody = `Receipt Processing Summary\n\n`;
    textBody += `Total receipts: ${totalCount}\n`;
    textBody += `Successfully processed: ${successful.length}\n`;
    textBody += `Failed: ${failed.length}\n`;
    textBody += `Duplicates detected: ${duplicates.length}\n\n`;

    if (successful.length > 0) {
      textBody += `Successfully Processed:\n`;
      successful.forEach(result => {
        textBody += `- Receipt ID: ${result.receiptId}\n`;
      });
      textBody += `\n`;
    }

    if (failed.length > 0) {
      textBody += `Failed to Process:\n`;
      failed.forEach(result => {
        textBody += `- Receipt ID: ${result.receiptId} - Error: ${result.error}\n`;
      });
      textBody += `\n`;
    }

    if (duplicates.length > 0) {
      textBody += `Duplicate Receipts:\n`;
      duplicates.forEach(result => {
        textBody += `- Receipt ID: ${result.receiptId} - Duplicate of: ${result.duplicateOf}\n`;
      });
    }

    const htmlBody = `
      <html>
      <body>
        <h2>Receipt Processing Summary</h2>
        <p><strong>Total receipts:</strong> ${totalCount}</p>
        <p><strong>Successfully processed:</strong> ${successful.length}</p>
        <p><strong>Failed:</strong> ${failed.length}</p>
        <p><strong>Duplicates detected:</strong> ${duplicates.length}</p>
        
        ${successful.length > 0 ? `
          <h3>Successfully Processed</h3>
          <ul>
            ${successful.map(result => `<li>Receipt ID: ${result.receiptId}</li>`).join('')}
          </ul>
        ` : ''}
        
        ${failed.length > 0 ? `
          <h3>Failed to Process</h3>
          <ul>
            ${failed.map(result => `<li>Receipt ID: ${result.receiptId} - Error: ${result.error}</li>`).join('')}
          </ul>
        ` : ''}
        
        ${duplicates.length > 0 ? `
          <h3>Duplicate Receipts</h3>
          <ul>
            ${duplicates.map(result => `<li>Receipt ID: ${result.receiptId} - Duplicate of: ${result.duplicateOf}</li>`).join('')}
          </ul>
        ` : ''}
        
        <p>You can view and manage your receipts in the expense platform.</p>
      </body>
      </html>
    `;

    return { subject, textBody, htmlBody };
  }

  private generateErrorTemplate(filename: string, error: string): EmailTemplate {
    const subject = `Receipt Processing Error - ${filename}`;
    
    const textBody = `
Receipt Processing Error

File: ${filename}
Error: ${error}

Please check the file format and try uploading again. Supported formats include:
- JPEG, PNG, GIF images
- PDF documents

If you continue to experience issues, please contact support.
    `.trim();

    const htmlBody = `
      <html>
      <body>
        <h2>Receipt Processing Error</h2>
        <p><strong>File:</strong> ${filename}</p>
        <p><strong>Error:</strong> ${error}</p>
        
        <h3>Supported Formats</h3>
        <ul>
          <li>JPEG, PNG, GIF images</li>
          <li>PDF documents</li>
        </ul>
        
        <p>Please check the file format and try uploading again. If you continue to experience issues, please contact support.</p>
      </body>
      </html>
    `;

    return { subject, textBody, htmlBody };
  }

  private generateDuplicateTemplate(
    filename: string,
    existingReceiptId: string,
    confidence: number
  ): EmailTemplate {
    const subject = `Duplicate Receipt Detected - ${filename}`;
    
    const textBody = `
Duplicate Receipt Detected

File: ${filename}
Existing Receipt ID: ${existingReceiptId}
Match Confidence: ${Math.round(confidence * 100)}%

The uploaded receipt appears to be a duplicate of an existing receipt. The duplicate has been rejected to prevent double-counting expenses.

If this is not a duplicate, please contact support.
    `.trim();

    const htmlBody = `
      <html>
      <body>
        <h2>Duplicate Receipt Detected</h2>
        <p><strong>File:</strong> ${filename}</p>
        <p><strong>Existing Receipt ID:</strong> ${existingReceiptId}</p>
        <p><strong>Match Confidence:</strong> ${Math.round(confidence * 100)}%</p>
        
        <p>The uploaded receipt appears to be a duplicate of an existing receipt. The duplicate has been rejected to prevent double-counting expenses.</p>
        
        <p>If this is not a duplicate, please contact support.</p>
      </body>
      </html>
    `;

    return { subject, textBody, htmlBody };
  }

  private generateLowConfidenceTemplate(
    receiptId: string,
    confidence: number,
    extractedFields: any[]
  ): EmailTemplate {
    const subject = `Receipt Requires Review - Low Confidence`;
    
    const textBody = `
Receipt Processing Complete - Review Required

Receipt ID: ${receiptId}
Processing Confidence: ${Math.round(confidence * 100)}%

The receipt has been processed, but some extracted information has low confidence and may need verification:

${extractedFields.filter(f => f.confidence < 0.8).map(f => 
  `- ${f.fieldName}: ${f.fieldValue} (${Math.round(f.confidence * 100)}% confidence)`
).join('\n')}

Please review and verify the extracted information in the expense platform.
    `.trim();

    const htmlBody = `
      <html>
      <body>
        <h2>Receipt Processing Complete - Review Required</h2>
        <p><strong>Receipt ID:</strong> ${receiptId}</p>
        <p><strong>Processing Confidence:</strong> ${Math.round(confidence * 100)}%</p>
        
        <p>The receipt has been processed, but some extracted information has low confidence and may need verification:</p>
        
        <ul>
          ${extractedFields.filter(f => f.confidence < 0.8).map(f => 
            `<li>${f.fieldName}: ${f.fieldValue} (${Math.round(f.confidence * 100)}% confidence)</li>`
          ).join('')}
        </ul>
        
        <p>Please review and verify the extracted information in the expense platform.</p>
      </body>
      </html>
    `;

    return { subject, textBody, htmlBody };
  }

  private generateWeeklySummaryTemplate(summary: any): EmailTemplate {
    const subject = `Weekly Receipt Processing Summary`;
    
    const textBody = `
Weekly Receipt Processing Summary

Total Receipts Processed: ${summary.totalProcessed}
Successfully Processed: ${summary.successfullyProcessed}
Failed: ${summary.failed}
Duplicates Detected: ${summary.duplicates}
Average Processing Time: ${summary.averageProcessingTime}ms

Top Merchants:
${summary.topMerchants.map((m: any) => `- ${m.name}: ${m.count} receipts, $${m.total}`).join('\n')}

Category Breakdown:
${summary.categoryBreakdown.map((c: any) => `- ${c.category}: ${c.count} receipts, $${c.total}`).join('\n')}
    `.trim();

    const htmlBody = `
      <html>
      <body>
        <h2>Weekly Receipt Processing Summary</h2>
        
        <table border="1" cellpadding="5" cellspacing="0">
          <tr><td>Total Receipts Processed</td><td>${summary.totalProcessed}</td></tr>
          <tr><td>Successfully Processed</td><td>${summary.successfullyProcessed}</td></tr>
          <tr><td>Failed</td><td>${summary.failed}</td></tr>
          <tr><td>Duplicates Detected</td><td>${summary.duplicates}</td></tr>
          <tr><td>Average Processing Time</td><td>${summary.averageProcessingTime}ms</td></tr>
        </table>
        
        <h3>Top Merchants</h3>
        <ul>
          ${summary.topMerchants.map((m: any) => `<li>${m.name}: ${m.count} receipts, $${m.total}</li>`).join('')}
        </ul>
        
        <h3>Category Breakdown</h3>
        <ul>
          ${summary.categoryBreakdown.map((c: any) => `<li>${c.category}: ${c.count} receipts, $${c.total}</li>`).join('')}
        </ul>
      </body>
      </html>
    `;

    return { subject, textBody, htmlBody };
  }
}