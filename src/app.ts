import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import winston from 'winston';
import knex from 'knex';
import { Products } from 'plaid';

import { PlaidIntegration } from './services/plaid';

// Safe route mounting function
function safeUseRouter(app: any, path: string, router: any, name: string) {
  try {
    if (typeof router === 'function') {
      app.use(path, router);
      logger.info(`Mounted route: ${name} at ${path}`);
    } else if (router && typeof router.default === 'function') {
      app.use(path, router.default);
      logger.info(`Mounted route: ${name} at ${path} (via default export)`);
    } else {
      logger.warn(`Skipping invalid route: ${name} - not a function`, { 
        type: typeof router, 
        keys: router ? Object.keys(router) : [] 
      });
    }
  } catch (error: any) {
    logger.warn(`Failed to mount route: ${name}`, { error: error.message, path });
  }
}

import { TransactionMatcher } from './services/matching/TransactionMatcher';
import plaidRoutes, { initializePlaidRoutes } from './routes/plaid';

// Configure logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
    new winston.transports.File({ 
      filename: 'logs/app.log',
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5
    })
  ]
});

// Database configuration
const db = knex({
  client: 'postgresql',
  connection: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'expense_platform'
  },
  pool: {
    min: 2,
    max: 20,
    acquireTimeoutMillis: 30000,
    idleTimeoutMillis: 30000
  },
  migrations: {
    directory: './database/migrations',
    tableName: 'knex_migrations'
  },
  seeds: {
    directory: './database/seeds'
  }
});

// Initialize Plaid configuration
const plaidConfig = {
  clientId: process.env.PLAID_CLIENT_ID!,
  secret: process.env.PLAID_SECRET!,
  environment: (process.env.PLAID_ENVIRONMENT || 'sandbox') as 'sandbox' | 'development' | 'production',
  products: [Products.Transactions, Products.Auth] as Products[],
  countryCodes: ['US', 'CA'],
  webhookUrl: process.env.PLAID_WEBHOOK_URL || `${process.env.BASE_URL}/webhook/plaid`,
  webhookSecret: process.env.PLAID_WEBHOOK_SECRET!
};

const encryptionKey = process.env.ENCRYPTION_KEY!;

// Validate required environment variables
const requiredVars = [
  'PLAID_CLIENT_ID',
  'PLAID_SECRET', 
  'PLAID_WEBHOOK_SECRET',
  'ENCRYPTION_KEY',
  'SESSION_SECRET',
  'JWT_SECRET'
];

const missingVars = requiredVars.filter(varName => !process.env[varName]);
if (missingVars.length > 0) {
  logger.error('Missing required environment variables', { missing: missingVars });
  process.exit(1);
}

// Initialize services
const plaidIntegration = new PlaidIntegration(db, logger, plaidConfig, encryptionKey);
const transactionMatcher = new TransactionMatcher(db, logger);

// Create Express app
const app = express();

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false // Configure as needed
}));

app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true
}));

// Body parsing middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Request logging
app.use((req, res, next) => {
  logger.info('HTTP Request', {
    method: req.method,
    url: req.url,
    userAgent: req.get('User-Agent'),
    ip: req.ip
  });
  next();
});

// Serve static files and set up view engine
import path from 'path';
app.use('/static', express.static(path.join(__dirname, '../../public')));
app.use('/uploads', express.static(path.join(__dirname, '../../uploads')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../../views'));

// Add database and services to request object
app.use((req: any, res, next) => {
  req.db = db;
  req.logger = logger;
  req.plaidIntegration = plaidIntegration;
  req.transactionMatcher = transactionMatcher;
  next();
});

// Initialize Plaid routes
initializePlaidRoutes(
  plaidIntegration.plaidService,
  plaidIntegration.webhookHandler,
  logger
);

// Root route - Airbase Killer Welcome!
app.get('/', (req, res) => {
  res.json({
    name: '🚀 Expense Platform - Airbase Killer!',
    version: '1.0.0',
    description: 'Enterprise expense management platform that solves Airbase pain points',
    status: 'LIVE! 🎉',
    features: [
      '📧 Unified Inbox (no more scattered views)',
      '🤖 AI-powered receipt matching', 
      '📄 Smart OCR processing',
      '🏦 Real-time bank integration',
      '📊 Intelligent categorization'
    ],
    endpoints: {
      inbox: '/inbox',
      api: '/api',
      health: '/health',
      plaid: '/api/plaid'
    }
  });
});

// API Routes
app.use('/api/plaid', plaidRoutes);

// Add new integrated routes (with error handling to prevent breaking existing app)
try {
  // Import and mount inbox routes
  const inboxRoutes = require('./routes/inbox/inboxRoutes');
  app.use('/inbox', inboxRoutes.default || inboxRoutes);
  
  // Import and mount receipt routes
  const receiptRoutes = require('./routes/receipts');
  app.use('/api/receipts', receiptRoutes.default || receiptRoutes);
  
  // Import and mount matching routes
  const matchingRoutes = require('./routes/matching');
  app.use('/api/matching', matchingRoutes.default || matchingRoutes);
  
  logger.info('Successfully loaded new integrated routes');
} catch (error) {
  logger.warn('Failed to load some new routes, continuing with core functionality', { error: (error as Error).message });
}

// Health check endpoint
app.get('/health', async (req: any, res) => {
  try {
    // Check database connection
    await req.db.raw('SELECT 1');
    
    // Check Plaid integration status
    const plaidStatus = await plaidIntegration.getIntegrationStatus();
    
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
      database: 'connected',
      plaid: plaidStatus
    });
  } catch (error) {
    logger.error('Health check failed', { error: (error as Error).message });
    res.status(500).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: (error as Error).message
    });
  }
});

// Error handling middleware
app.use((error: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled error', {
    error: error.message,
    stack: error.stack,
    url: req.url,
    method: req.method
  });

  if (res.headersSent) {
    return next(error);
  }

  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'production' ? 'Something went wrong' : error.message
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Not found',
    path: req.originalUrl
  });
});

// Graceful shutdown
const gracefulShutdown = async (signal: string) => {
  logger.info('Shutting down gracefully', { signal });
  
  try {
    // Stop Plaid integration
    await plaidIntegration.stop();
    
    // Close database connections
    await db.destroy();
    
    logger.info('Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown', { error: (error as Error).message });
    process.exit(1);
  }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Unhandled promise rejection handler
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection', { reason, promise });
});

// Uncaught exception handler
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception', { error: error.message, stack: error.stack });
  process.exit(1);
});

const PORT = process.env.PORT || 3001;

async function startServer() {
  try {
    // Check bypass flags
    const asBool = (v?: string) => /^(1|true|yes)$/i.test(String(v || ''));
    const SKIP_MIGRATIONS = asBool(process.env.SKIP_MIGRATIONS);
    const ALLOW_START_WITHOUT_DB = asBool(process.env.ALLOW_START_WITHOUT_DB);
    
    logger.info('Starting server with flags', { SKIP_MIGRATIONS, ALLOW_START_WITHOUT_DB });
    
    // Run database migrations (with bypass)
    if (SKIP_MIGRATIONS) {
      logger.info('Skipping database migrations due to SKIP_MIGRATIONS=true');
    } else {
      try {
        logger.info('Running database migrations...');
        await db.migrate.latest();
        logger.info('Database migrations completed successfully');
      } catch (migrationError: any) {
        if (ALLOW_START_WITHOUT_DB) {
          logger.warn('Migration failed but ALLOW_START_WITHOUT_DB=true, continuing', { 
            error: migrationError.message, 
            stack: migrationError.stack 
          });
        } else {
          throw migrationError;
        }
      }
    }
    
    // Start Plaid integration
    logger.info('Starting Plaid integration...');
    await plaidIntegration.start();
    
    // Start server
    app.listen(PORT, () => {
      logger.info('Server started successfully', { 
        port: PORT, 
        environment: process.env.NODE_ENV || 'development',
        plaidEnvironment: plaidConfig.environment
      });
    });
    
  } catch (error) {
    logger.error('Failed to start server', { error: (error as Error).message });
    process.exit(1);
  }
}

// Start the server
startServer();

export default app;