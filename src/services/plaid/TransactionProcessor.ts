import { Knex } from 'knex';
import winston from 'winston';

interface PlaidTransaction {
  transaction_id: string;
  account_id: string;
  amount: number;
  iso_currency_code: string;
  unofficial_currency_code?: string;
  merchant_name?: string;
  name: string;
  original_description?: string;
  date: string;
  authorized_date?: string;
  datetime?: string;
  pending: boolean;
  pending_transaction_id?: string;
  category?: string[];
  category_id?: string;
  merchant_data?: any;
  payment_meta?: any;
  location?: any;
  personal_finance_category?: any;
  logo_url?: string;
  website?: string;
}

interface SyncData {
  added: PlaidTransaction[];
  modified: PlaidTransaction[];
  removed: { transaction_id: string }[];
  next_cursor: string;
  has_more: boolean;
}

interface ProcessingResult {
  processedCount: number;
  errorCount: number;
  duplicateCount: number;
  createdTransactionCount: number;
  updatedTransactionCount: number;
  errors: any[];
}

export class TransactionProcessor {
  private db: Knex;
  private logger: winston.Logger;

  constructor(db: Knex, logger: winston.Logger) {
    this.db = db;
    this.logger = logger;
  }

  async processPlaidTransactions(
    organizationId: string,
    plaidItemId: string,
    syncData: SyncData
  ): Promise<ProcessingResult> {
    const result: ProcessingResult = {
      processedCount: 0,
      errorCount: 0,
      duplicateCount: 0,
      createdTransactionCount: 0,
      updatedTransactionCount: 0,
      errors: []
    };

    const trx = await this.db.transaction();

    try {
      // Process added transactions
      for (const transaction of syncData.added) {
        try {
          await this.processTransaction(
            trx,
            organizationId,
            plaidItemId,
            transaction,
            'added',
            result
          );
        } catch (error) {
          result.errorCount++;
          result.errors.push({
            transaction_id: transaction.transaction_id,
            operation: 'added',
            error: (error as Error).message
          });
          this.logger.warn('Failed to process added transaction', {
            transactionId: transaction.transaction_id,
            error: (error as Error).message
          });
        }
      }

      // Process modified transactions
      for (const transaction of syncData.modified) {
        try {
          await this.processTransaction(
            trx,
            organizationId,
            plaidItemId,
            transaction,
            'modified',
            result
          );
        } catch (error) {
          result.errorCount++;
          result.errors.push({
            transaction_id: transaction.transaction_id,
            operation: 'modified',
            error: (error as Error).message
          });
          this.logger.warn('Failed to process modified transaction', {
            transactionId: transaction.transaction_id,
            error: (error as Error).message
          });
        }
      }

      // Process removed transactions
      for (const removedTxn of syncData.removed) {
        try {
          await this.processRemovedTransaction(
            trx,
            organizationId,
            removedTxn.transaction_id,
            result
          );
        } catch (error) {
          result.errorCount++;
          result.errors.push({
            transaction_id: removedTxn.transaction_id,
            operation: 'removed',
            error: (error as Error).message
          });
          this.logger.warn('Failed to process removed transaction', {
            transactionId: removedTxn.transaction_id,
            error: (error as Error).message
          });
        }
      }

      await trx.commit();

      this.logger.info('Transaction processing completed', {
        organizationId,
        plaidItemId,
        result
      });

      return result;
    } catch (error) {
      await trx.rollback();
      this.logger.error('Transaction processing failed', {
        organizationId,
        plaidItemId,
        error: (error as Error).message
      });
      throw error;
    }
  }

  private async processTransaction(
    trx: Knex.Transaction,
    organizationId: string,
    plaidItemId: string,
    transaction: PlaidTransaction,
    operation: 'added' | 'modified',
    result: ProcessingResult
  ) {
    // Check if we already have this transaction
    const existingRawTransaction = await trx('plaid_transactions_raw')
      .where('transaction_id', transaction.transaction_id)
      .first();

    if (existingRawTransaction && operation === 'added') {
      result.duplicateCount++;
      return;
    }

    // Get the Plaid account
    const plaidAccount = await trx('plaid_accounts')
      .where('plaid_item_id', plaidItemId)
      .where('account_id', transaction.account_id)
      .first();

    if (!plaidAccount) {
      throw new Error(`Plaid account not found for account_id: ${transaction.account_id}`);
    }

    // Prepare raw transaction data
    const rawTransactionData = {
      organization_id: organizationId,
      plaid_item_id: plaidItemId,
      plaid_account_id: plaidAccount.id,
      transaction_id: transaction.transaction_id,
      account_id: transaction.account_id,
      amount: Math.abs(transaction.amount), // Store as positive, determine type separately
      iso_currency_code: transaction.iso_currency_code || 'USD',
      unofficial_currency_code: transaction.unofficial_currency_code,
      merchant_name: transaction.merchant_name,
      name: transaction.name,
      original_description: transaction.original_description,
      date: transaction.date,
      authorized_date: transaction.authorized_date,
      datetime: transaction.datetime,
      pending: transaction.pending,
      pending_transaction_id: transaction.pending_transaction_id,
      category: transaction.category,
      category_id: transaction.category_id,
      merchant_data: transaction.merchant_data || {},
      payment_meta: transaction.payment_meta || {},
      location: transaction.location || {},
      personal_finance_category: transaction.personal_finance_category || {},
      logo_url: transaction.logo_url,
      website: transaction.website,
      processing_status: 'pending'
    };

    let rawTransaction;

    if (existingRawTransaction) {
      // Update existing raw transaction
      await trx('plaid_transactions_raw')
        .where('id', existingRawTransaction.id)
        .update({
          ...rawTransactionData,
          updated_at: new Date()
        });
      
      rawTransaction = { ...existingRawTransaction, ...rawTransactionData };
    } else {
      // Insert new raw transaction
      [rawTransaction] = await trx('plaid_transactions_raw')
        .insert(rawTransactionData)
        .returning('*');
    }

    // Process into local transaction if not pending
    if (!transaction.pending) {
      const processedTransaction = await this.createOrUpdateLocalTransaction(
        trx,
        organizationId,
        plaidAccount,
        rawTransaction,
        transaction
      );

      if (processedTransaction.isNew) {
        result.createdTransactionCount++;
      } else {
        result.updatedTransactionCount++;
      }

      // Mark raw transaction as processed
      await trx('plaid_transactions_raw')
        .where('id', rawTransaction.id)
        .update({
          processing_status: 'processed',
          processed_transaction_id: processedTransaction.transaction.id
        });
    }

    result.processedCount++;
  }

  private async createOrUpdateLocalTransaction(
    trx: Knex.Transaction,
    organizationId: string,
    plaidAccount: any,
    rawTransaction: any,
    plaidTransaction: PlaidTransaction
  ) {
    // Check if we already have a local transaction for this Plaid transaction
    const existingTransaction = await trx('transactions')
      .where('plaid_transaction_id_external', plaidTransaction.transaction_id)
      .first();

    // Determine transaction type (debit/credit) based on account type and amount sign
    const isDebit = this.determineTransactionType(
      plaidAccount.type,
      plaidAccount.subtype,
      plaidTransaction.amount
    );

    // Try to find or create merchant
    const merchant = await this.findOrCreateMerchant(
      trx,
      organizationId,
      plaidTransaction.merchant_name || plaidTransaction.name
    );

    // Suggest category based on Plaid categorization
    const suggestedCategory = await this.suggestCategory(
      trx,
      organizationId,
      plaidTransaction.category,
      plaidTransaction.personal_finance_category
    );

    const transactionData = {
      organization_id: organizationId,
      account_id: plaidAccount.local_account_id,
      merchant_id: merchant?.id,
      category_id: suggestedCategory?.id,
      transaction_id: `plaid_${plaidTransaction.transaction_id}`,
      type: isDebit ? 'debit' : 'credit',
      amount: Math.abs(plaidTransaction.amount),
      currency: plaidTransaction.iso_currency_code || 'USD',
      description: plaidTransaction.name,
      memo: plaidTransaction.original_description,
      status: 'processed',
      transaction_date: new Date(plaidTransaction.date),
      posted_date: plaidTransaction.authorized_date ? new Date(plaidTransaction.authorized_date) : null,
      plaid_sourced: true,
      plaid_transaction_id: rawTransaction.id,
      plaid_transaction_id_external: plaidTransaction.transaction_id,
      plaid_metadata: {
        merchant_name: plaidTransaction.merchant_name,
        category: plaidTransaction.category,
        category_id: plaidTransaction.category_id,
        personal_finance_category: plaidTransaction.personal_finance_category,
        location: plaidTransaction.location,
        payment_meta: plaidTransaction.payment_meta,
        logo_url: plaidTransaction.logo_url,
        website: plaidTransaction.website
      },
      metadata: {
        source: 'plaid',
        processed_at: new Date().toISOString(),
        pending_transaction_id: plaidTransaction.pending_transaction_id
      }
    };

    let transaction;
    let isNew = false;

    if (existingTransaction) {
      // Update existing transaction
      await trx('transactions')
        .where('id', existingTransaction.id)
        .update({
          ...transactionData,
          updated_at: new Date()
        });
      
      transaction = { ...existingTransaction, ...transactionData };
    } else {
      // Create new transaction
      [transaction] = await trx('transactions')
        .insert(transactionData)
        .returning('*');
      
      isNew = true;
    }

    return { transaction, isNew };
  }

  private async processRemovedTransaction(
    trx: Knex.Transaction,
    organizationId: string,
    transactionId: string,
    result: ProcessingResult
  ) {
    // Mark raw transaction as removed
    await trx('plaid_transactions_raw')
      .where('organization_id', organizationId)
      .where('transaction_id', transactionId)
      .update({
        processing_status: 'removed',
        updated_at: new Date()
      });

    // Cancel/remove the local transaction if it exists
    const localTransaction = await trx('transactions')
      .where('organization_id', organizationId)
      .where('plaid_transaction_id_external', transactionId)
      .first();

    if (localTransaction) {
      await trx('transactions')
        .where('id', localTransaction.id)
        .update({
          status: 'cancelled',
          updated_at: new Date()
        });
    }

    result.processedCount++;
  }

  private determineTransactionType(
    accountType: string,
    accountSubtype: string,
    plaidAmount: number
  ): boolean {
    // Plaid amounts are positive for outflows (debits from user perspective)
    // and negative for inflows (credits from user perspective)
    
    // For credit cards, the logic is inverted
    if (accountType === 'credit') {
      return plaidAmount < 0; // Negative amount = payment (debit to credit card balance)
    }
    
    // For depository accounts (checking, savings)
    return plaidAmount > 0; // Positive amount = outflow (debit from account)
  }

  private async findOrCreateMerchant(
    trx: Knex.Transaction,
    organizationId: string,
    merchantName?: string
  ) {
    if (!merchantName) return null;

    const normalizedName = this.normalizeMerchantName(merchantName);

    // Try to find existing merchant
    let merchant = await trx('merchants')
      .where('organization_id', organizationId)
      .where('normalized_name', normalizedName)
      .first();

    if (!merchant) {
      // Create new merchant
      [merchant] = await trx('merchants')
        .insert({
          organization_id: organizationId,
          name: merchantName,
          normalized_name: normalizedName,
          aliases: [merchantName],
          active: true
        })
        .returning('*');
    }

    return merchant;
  }

  private async suggestCategory(
    trx: Knex.Transaction,
    organizationId: string,
    plaidCategories?: string[],
    personalFinanceCategory?: any
  ) {
    if (!plaidCategories?.length && !personalFinanceCategory?.primary) {
      return null;
    }

    // Map Plaid categories to our categories
    const categoryMappings: Record<string, string> = {
      'Food and Drink': 'Meals & Entertainment',
      'Restaurants': 'Meals & Entertainment',
      'Gas Stations': 'Fuel',
      'Transportation': 'Travel',
      'Airlines': 'Travel',
      'Hotels': 'Travel',
      'Shops': 'Office Supplies',
      'Healthcare': 'Medical',
      'Professional Services': 'Professional Services',
      'Government and Non-Profit': 'Government Fees',
      'Tax': 'Taxes'
    };

    let categoryName: string | null = null;

    // Try personal finance category first
    if (personalFinanceCategory?.primary) {
      categoryName = categoryMappings[personalFinanceCategory.primary];
    }

    // Fall back to regular categories
    if (!categoryName && plaidCategories?.length) {
      const primaryCategory = plaidCategories[0];
      categoryName = categoryMappings[primaryCategory];
    }

    if (!categoryName) return null;

    // Find the category in our system
    const category = await trx('categories')
      .where('organization_id', organizationId)
      .where('name', categoryName)
      .where('active', true)
      .first();

    return category;
  }

  private normalizeMerchantName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^\w\s]/g, '') // Remove special characters
      .replace(/\s+/g, ' ')    // Normalize whitespace
      .trim();
  }
}