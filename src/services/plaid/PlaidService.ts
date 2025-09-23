import { Knex } from 'knex';
import winston from 'winston';
import crypto from 'crypto';
import { PlaidClient } from './PlaidClient';
import { TransactionProcessor } from './TransactionProcessor';
import { Products } from 'plaid';

interface PlaidItem {
  id: string;
  organization_id: string;
  item_id: string;
  encrypted_access_token: string;
  institution_id: string;
  institution_name: string;
  cursor?: string;
  sync_status: 'active' | 'error' | 'disabled';
  last_sync_at?: Date;
  consecutive_failures: number;
}

interface PlaidAccount {
  id: string;
  organization_id: string;
  plaid_item_id: string;
  account_id: string;
  name: string;
  type: string;
  subtype: string;
  balances: any;
  mask?: string;
  enabled: boolean;
}

export class PlaidService {
  private db: Knex;
  private logger: winston.Logger;
  private plaidClient: PlaidClient;
  private transactionProcessor: TransactionProcessor;
  private encryptionKey: string;

  constructor(
    db: Knex,
    logger: winston.Logger,
    plaidConfig: {
      clientId: string;
      secret: string;
      environment: string;
      products: Products[];
      countryCodes: string[];
      webhookUrl?: string;
    },
    encryptionKey: string
  ) {
    this.db = db;
    this.logger = logger;
    this.encryptionKey = encryptionKey;
    this.plaidClient = new PlaidClient(plaidConfig, logger);
    this.transactionProcessor = new TransactionProcessor(db, logger);
  }

  async createLinkToken(organizationId: string, userId: string, options: any = {}) {
    try {
      this.logger.info('Creating Plaid Link token', { organizationId, userId });

      const linkTokenData = await this.plaidClient.createLinkToken({
        userId: `${organizationId}_${userId}`,
        clientName: 'Expense Platform',
        language: options.language || 'en',
        user: {
          client_user_id: `${organizationId}_${userId}`,
          legal_name: options.userLegalName,
          email_address: options.userEmail
        },
        accountFilters: options.accountFilters,
        webhook: options.webhook
      });

      return {
        link_token: linkTokenData.link_token,
        expiration: linkTokenData.expiration,
        request_id: linkTokenData.request_id
      };
    } catch (error) {
      this.logger.error('Failed to create link token', { 
        organizationId, 
        userId, 
        error: (error as Error).message 
      });
      throw error;
    }
  }

  async connectAccount(
    organizationId: string, 
    userId: string, 
    publicToken: string,
    metadata: any = {}
  ) {
    const trx = await this.db.transaction();
    
    try {
      this.logger.info('Connecting Plaid account', { organizationId, userId });

      // Exchange public token for access token
      const exchangeResponse = await this.plaidClient.exchangePublicToken(publicToken);
      const { access_token, item_id } = exchangeResponse;

      // Get item details
      const itemData = await this.plaidClient.getItem(access_token);
      const institution = await this.plaidClient.getInstitution(itemData.item.institution_id!);

      // Encrypt access token
      const encryptedAccessToken = this.encryptAccessToken(access_token);

      // Store Plaid item
      const [plaidItem] = await trx('plaid_items')
        .insert({
          organization_id: organizationId,
          connected_by_user_id: userId,
          item_id,
          encrypted_access_token: encryptedAccessToken,
          institution_id: itemData.item.institution_id,
          institution_name: institution.name,
          institution_metadata: {
            logo: institution.logo,
            primary_color: institution.primary_color,
            url: institution.url,
            products: itemData.item.available_products
          },
          sync_status: 'active',
          webhook_enabled: true,
          created_by: userId,
          updated_by: userId
        })
        .returning('*');

      // Get accounts from Plaid
      const accountsData = await this.plaidClient.getAccounts(access_token);

      const plaidAccounts = [];
      const localAccounts = [];

      for (const account of accountsData.accounts) {
        // Store Plaid account record
        const [plaidAccount] = await trx('plaid_accounts')
          .insert({
            organization_id: organizationId,
            plaid_item_id: plaidItem.id,
            account_id: account.account_id,
            persistent_account_id: account.persistent_account_id,
            name: account.name,
            official_name: account.official_name,
            type: account.type,
            subtype: account.subtype,
            balances: account.balances,
            mask: account.mask,
            verification_status: account.verification_status || {},
            enabled: true,
            created_by: userId,
            updated_by: userId
          })
          .returning('*');

        plaidAccounts.push(plaidAccount);

        // Create corresponding local account
        const [localAccount] = await trx('accounts')
          .insert({
            organization_id: organizationId,
            name: account.official_name || account.name,
            account_type: this.mapPlaidAccountType(account.type, account.subtype),
            current_balance: account.balances.current || 0,
            currency: account.balances.iso_currency_code || 'USD',
            plaid_account_id: plaidAccount.id,
            plaid_managed: true,
            plaid_metadata: {
              account_id: account.account_id,
              mask: account.mask,
              type: account.type,
              subtype: account.subtype
            },
            metadata: {
              institution_name: institution.name,
              connected_via: 'plaid',
              connection_date: new Date().toISOString()
            },
            active: true,
            created_by: userId,
            updated_by: userId
          })
          .returning('*');

        localAccounts.push(localAccount);

        // Link the accounts
        await trx('plaid_accounts')
          .where('id', plaidAccount.id)
          .update({ local_account_id: localAccount.id });
      }

      // Schedule initial sync job
      await this.scheduleSync(trx, plaidItem.id, 'initial_sync', {
        organization_id: organizationId,
        plaid_item_id: plaidItem.id
      });

      await trx.commit();

      this.logger.info('Account connected successfully', {
        organizationId,
        userId,
        itemId: item_id,
        institutionName: institution.name,
        accountCount: accountsData.accounts.length
      });

      return {
        plaid_item: plaidItem,
        plaid_accounts: plaidAccounts,
        local_accounts: localAccounts,
        institution: {
          id: institution.institution_id,
          name: institution.name,
          logo: institution.logo,
          primary_color: institution.primary_color
        }
      };
    } catch (error) {
      await trx.rollback();
      this.logger.error('Failed to connect account', {
        organizationId,
        userId,
        error: (error as Error).message
      });
      throw error;
    }
  }

  async getConnectedAccounts(organizationId: string) {
    try {
      const items = await this.db('plaid_items as pi')
        .select(
          'pi.*',
          'pa.id as account_id',
          'pa.account_id as plaid_account_id',
          'pa.name as account_name',
          'pa.type',
          'pa.subtype',
          'pa.balances',
          'pa.mask',
          'pa.enabled',
          'a.id as local_account_id',
          'a.name as local_account_name',
          'a.current_balance'
        )
        .leftJoin('plaid_accounts as pa', 'pi.id', 'pa.plaid_item_id')
        .leftJoin('accounts as a', 'pa.local_account_id', 'a.id')
        .where('pi.organization_id', organizationId)
        .where('pi.sync_status', '!=', 'disabled')
        .orderBy(['pi.institution_name', 'pa.name']);

      // Group by institution
      const itemsGrouped = items.reduce((acc: any, item) => {
        const itemKey = item.item_id;
        
        if (!acc[itemKey]) {
          acc[itemKey] = {
            id: item.id,
            item_id: item.item_id,
            institution_id: item.institution_id,
            institution_name: item.institution_name,
            institution_metadata: item.institution_metadata,
            sync_status: item.sync_status,
            last_sync_at: item.last_sync_at,
            consecutive_failures: item.consecutive_failures,
            accounts: []
          };
        }

        if (item.account_id) {
          acc[itemKey].accounts.push({
            id: item.account_id,
            plaid_account_id: item.plaid_account_id,
            name: item.account_name,
            type: item.type,
            subtype: item.subtype,
            balances: item.balances,
            mask: item.mask,
            enabled: item.enabled,
            local_account: item.local_account_id ? {
              id: item.local_account_id,
              name: item.local_account_name,
              current_balance: item.current_balance
            } : null
          });
        }

        return acc;
      }, {});

      return Object.values(itemsGrouped);
    } catch (error) {
      this.logger.error('Failed to get connected accounts', {
        organizationId,
        error: (error as Error).message
      });
      throw error;
    }
  }

  async disconnectAccount(organizationId: string, itemId: string, userId: string) {
    const trx = await this.db.transaction();
    
    try {
      this.logger.info('Disconnecting Plaid account', { organizationId, itemId });

      // Get the item
      const plaidItem = await trx('plaid_items')
        .where('organization_id', organizationId)
        .where('item_id', itemId)
        .first();

      if (!plaidItem) {
        throw new Error('Plaid item not found');
      }

      // Decrypt access token and remove from Plaid
      const accessToken = this.decryptAccessToken(plaidItem.encrypted_access_token);
      await this.plaidClient.removeItem(accessToken);

      // Disable sync status
      await trx('plaid_items')
        .where('id', plaidItem.id)
        .update({
          sync_status: 'disabled',
          updated_by: userId,
          updated_at: new Date()
        });

      // Disable associated accounts
      await trx('plaid_accounts')
        .where('plaid_item_id', plaidItem.id)
        .update({
          enabled: false,
          updated_by: userId,
          updated_at: new Date()
        });

      // Mark local accounts as no longer Plaid managed
      await trx('accounts')
        .where('plaid_account_id', 'in', 
          trx('plaid_accounts')
            .select('id')
            .where('plaid_item_id', plaidItem.id)
        )
        .update({
          plaid_managed: false,
          last_plaid_sync: null,
          updated_by: userId,
          updated_at: new Date()
        });

      await trx.commit();

      this.logger.info('Account disconnected successfully', {
        organizationId,
        itemId,
        institutionName: plaidItem.institution_name
      });

      return { success: true };
    } catch (error) {
      await trx.rollback();
      this.logger.error('Failed to disconnect account', {
        organizationId,
        itemId,
        error: (error as Error).message
      });
      throw error;
    }
  }

  async triggerManualSync(organizationId: string, itemId: string) {
    try {
      this.logger.info('Triggering manual sync', { organizationId, itemId });

      const plaidItem = await this.db('plaid_items')
        .where('organization_id', organizationId)
        .where('item_id', itemId)
        .where('sync_status', 'active')
        .first();

      if (!plaidItem) {
        throw new Error('Plaid item not found or not active');
      }

      // Schedule sync job
      await this.scheduleSync(this.db, plaidItem.id, 'incremental_sync', {
        organization_id: organizationId,
        plaid_item_id: plaidItem.id,
        manual_trigger: true
      });

      return { success: true, message: 'Sync scheduled' };
    } catch (error) {
      this.logger.error('Failed to trigger manual sync', {
        organizationId,
        itemId,
        error: (error as Error).message
      });
      throw error;
    }
  }

  async processTransactionSync(itemId: string) {
    try {
      const plaidItem = await this.db('plaid_items')
        .where('id', itemId)
        .first() as PlaidItem;

      if (!plaidItem) {
        throw new Error('Plaid item not found');
      }

      const accessToken = this.decryptAccessToken(plaidItem.encrypted_access_token);
      
      // Sync transactions from Plaid
      const syncData = await this.plaidClient.syncTransactions(accessToken, plaidItem.cursor);
      
      // Process transactions
      const processingResult = await this.transactionProcessor.processPlaidTransactions(
        plaidItem.organization_id,
        plaidItem.id,
        syncData
      );

      // Update cursor and sync status
      await this.db('plaid_items')
        .where('id', itemId)
        .update({
          cursor: syncData.next_cursor,
          last_sync_at: new Date(),
          last_successful_sync_at: new Date(),
          consecutive_failures: 0,
          sync_status: 'active'
        });

      this.logger.info('Transaction sync completed', {
        itemId,
        organizationId: plaidItem.organization_id,
        addedCount: syncData.added.length,
        modifiedCount: syncData.modified.length,
        removedCount: syncData.removed.length,
        processedCount: processingResult.processedCount,
        errorCount: processingResult.errorCount
      });

      return processingResult;
    } catch (error) {
      // Update failure count
      await this.db('plaid_items')
        .where('id', itemId)
        .increment('consecutive_failures', 1)
        .update({
          last_sync_at: new Date(),
          sync_status: 'error',
          error_info: {
            message: (error as Error).message,
            timestamp: new Date().toISOString()
          }
        });

      this.logger.error('Transaction sync failed', {
        itemId,
        error: (error as Error).message
      });
      
      throw error;
    }
  }

  private async scheduleSync(
    trx: Knex | Knex.Transaction, 
    plaidItemId: string, 
    jobType: string, 
    jobData: any
  ) {
    await trx('plaid_sync_jobs').insert({
      organization_id: jobData.organization_id,
      plaid_item_id: plaidItemId,
      job_type: jobType,
      status: 'pending',
      scheduled_at: new Date(),
      job_data: jobData
    });
  }

  private mapPlaidAccountType(type: string, subtype: string): string {
    const typeMapping: Record<string, string> = {
      'depository_checking': 'checking',
      'depository_savings': 'savings',
      'credit_credit_card': 'credit_card',
      'credit_line_of_credit': 'credit_card',
      'loan_mortgage': 'loan',
      'loan_student': 'loan',
      'loan_auto': 'loan',
      'investment_401k': 'investment',
      'investment_ira': 'investment',
      'investment_brokerage': 'investment'
    };

    const key = `${type}_${subtype}`;
    return typeMapping[key] || 'checking';
  }

  private encryptAccessToken(accessToken: string): string {
    const cipher = crypto.createCipher('aes-256-cbc', this.encryptionKey);
    let encrypted = cipher.update(accessToken, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return encrypted;
  }

  private decryptAccessToken(encryptedToken: string): string {
    const decipher = crypto.createDecipher('aes-256-cbc', this.encryptionKey);
    let decrypted = decipher.update(encryptedToken, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }
}