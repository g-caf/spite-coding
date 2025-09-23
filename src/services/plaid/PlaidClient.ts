import { PlaidApi, PlaidEnvironments, Configuration, Products } from 'plaid';
import winston from 'winston';

interface PlaidConfig {
  clientId: string;
  secret: string;
  environment: string;
  products: Products[];
  countryCodes: string[];
  webhookUrl?: string;
}

interface LinkTokenOptions {
  userId: string;
  clientName: string;
  language?: string;
  countryCodes?: string[];
  user?: {
    client_user_id: string;
    legal_name?: string;
    email_address?: string;
  };
  accountFilters?: any;
  redirectUri?: string;
  webhook?: string;
}

export class PlaidClient {
  private client: PlaidApi;
  private config: PlaidConfig;
  private logger: winston.Logger;

  constructor(config: PlaidConfig, logger: winston.Logger) {
    this.config = config;
    this.logger = logger;
    this.client = this.initializeClient();
  }

  private initializeClient(): PlaidApi {
    try {
      const configuration = new Configuration({
        basePath: PlaidEnvironments[this.config.environment as keyof typeof PlaidEnvironments],
        baseOptions: {
          headers: {
            'PLAID-CLIENT-ID': this.config.clientId,
            'PLAID-SECRET': this.config.secret,
            'User-Agent': 'ExpensePlatform/1.0.0'
          },
        },
      });

      this.logger.info('Plaid client initialized', {
        environment: this.config.environment,
        products: this.config.products
      });

      return new PlaidApi(configuration);
    } catch (error) {
      this.logger.error('Failed to initialize Plaid client', { error: (error as Error).message });
      throw error;
    }
  }

  async createLinkToken(options: LinkTokenOptions) {
    try {
      const request = {
        user: {
          client_user_id: options.userId,
          ...options.user
        },
        client_name: options.clientName,
        products: this.config.products,
        country_codes: options.countryCodes || this.config.countryCodes,
        language: options.language || 'en',
        webhook: options.webhook || this.config.webhookUrl,
        account_filters: options.accountFilters,
        redirect_uri: options.redirectUri
      };

      this.logger.info('Creating link token', { 
        userId: options.userId,
        products: request.products 
      });

      const response = await this.client.linkTokenCreate(request);
      
      this.logger.info('Link token created successfully', { 
        userId: options.userId,
        tokenId: response.data.link_token.substring(0, 10) + '...',
        expiration: response.data.expiration
      });

      return response.data;
    } catch (error) {
      this.logger.error('Failed to create link token', {
        userId: options.userId,
        error: (error as any).message,
        plaidError: (error as any).response?.data
      });
      throw this.handlePlaidError(error);
    }
  }

  async exchangePublicToken(publicToken: string) {
    try {
      this.logger.info('Exchanging public token', {
        publicTokenPrefix: publicToken.substring(0, 10) + '...'
      });

      const response = await this.client.itemPublicTokenExchange({
        public_token: publicToken,
      });

      this.logger.info('Public token exchanged successfully', {
        itemId: response.data.item_id,
        accessTokenPrefix: response.data.access_token.substring(0, 10) + '...'
      });

      return response.data;
    } catch (error) {
      this.logger.error('Failed to exchange public token', {
        error: (error as any).message,
        plaidError: (error as any).response?.data
      });
      throw this.handlePlaidError(error);
    }
  }

  async getAccounts(accessToken: string) {
    try {
      const response = await this.client.accountsGet({
        access_token: accessToken,
      });

      this.logger.info('Retrieved accounts', {
        accountCount: response.data.accounts.length,
        itemId: response.data.item.item_id
      });

      return response.data;
    } catch (error) {
      this.logger.error('Failed to get accounts', {
        error: (error as any).message,
        plaidError: (error as any).response?.data
      });
      throw this.handlePlaidError(error);
    }
  }

  async getAuthData(accessToken: string) {
    try {
      const response = await this.client.authGet({
        access_token: accessToken,
      });

      this.logger.info('Retrieved auth data', {
        accountCount: response.data.accounts.length,
        itemId: response.data.item.item_id
      });

      return response.data;
    } catch (error) {
      this.logger.error('Failed to get auth data', {
        error: (error as any).message,
        plaidError: (error as any).response?.data
      });
      throw this.handlePlaidError(error);
    }
  }

  async syncTransactions(accessToken: string, cursor?: string) {
    try {
      const request: any = {
        access_token: accessToken,
      };

      if (cursor) {
        request.cursor = cursor;
      }

      this.logger.info('Syncing transactions', {
        hasCursor: !!cursor,
        cursorPrefix: cursor ? cursor.substring(0, 10) + '...' : null
      });

      const response = await this.client.transactionsSync(request);

      this.logger.info('Transactions synced', {
        addedCount: response.data.added.length,
        modifiedCount: response.data.modified.length,
        removedCount: response.data.removed.length,
        hasMore: response.data.has_more,
        nextCursor: response.data.next_cursor ? 
          response.data.next_cursor.substring(0, 10) + '...' : null
      });

      return response.data;
    } catch (error) {
      this.logger.error('Failed to sync transactions', {
        error: (error as any).message,
        plaidError: (error as any).response?.data
      });
      throw this.handlePlaidError(error);
    }
  }

  async refreshTransactions(accessToken: string) {
    try {
      this.logger.info('Refreshing transactions');

      const response = await this.client.transactionsRefresh({
        access_token: accessToken,
      });

      this.logger.info('Transactions refresh initiated', {
        requestId: response.data.request_id
      });

      return response.data;
    } catch (error) {
      this.logger.error('Failed to refresh transactions', {
        error: (error as any).message,
        plaidError: (error as any).response?.data
      });
      throw this.handlePlaidError(error);
    }
  }

  async getItem(accessToken: string) {
    try {
      const response = await this.client.itemGet({
        access_token: accessToken,
      });

      return response.data;
    } catch (error) {
      this.logger.error('Failed to get item', {
        error: (error as any).message,
        plaidError: (error as any).response?.data
      });
      throw this.handlePlaidError(error);
    }
  }

  async removeItem(accessToken: string) {
    try {
      this.logger.info('Removing item');

      const response = await this.client.itemRemove({
        access_token: accessToken,
      });

      this.logger.info('Item removed successfully', {
        requestId: response.data.request_id
      });

      return response.data;
    } catch (error) {
      this.logger.error('Failed to remove item', {
        error: (error as any).message,
        plaidError: (error as any).response?.data
      });
      throw this.handlePlaidError(error);
    }
  }

  async getInstitution(institutionId: string, countryCodes?: string[]) {
    try {
      const response = await this.client.institutionsGetById({
        institution_id: institutionId,
        country_codes: countryCodes || this.config.countryCodes,
      });

      return response.data.institution;
    } catch (error) {
      this.logger.error('Failed to get institution', {
        institutionId,
        error: (error as any).message,
        plaidError: (error as any).response?.data
      });
      throw this.handlePlaidError(error);
    }
  }

  private handlePlaidError(error: any): Error {
    if (error.response?.data?.error_code) {
      const plaidError = error.response.data;
      const message = `Plaid Error: ${plaidError.error_code} - ${plaidError.error_message}`;
      const customError = new Error(message);
      (customError as any).plaidErrorCode = plaidError.error_code;
      (customError as any).plaidErrorType = plaidError.error_type;
      return customError;
    }
    return error;
  }
}