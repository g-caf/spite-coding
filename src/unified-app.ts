import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import winston from 'winston';
import path from 'path';
import compression from 'compression';
import morgan from 'morgan';

// Import the existing app setup from app.ts
import existingApp from './app';

// Import all route modules
import inboxRoutes from './routes/inbox/inboxRoutes';
import categoryRoutes from './routes/categories/categoryRoutes';
import ruleRoutes from './routes/rules/ruleRoutes';
import policyRoutes from './routes/policy/policyRoutes';
import categorizationRoutes from './routes/transactions/categorizationRoutes';
import receiptRoutes from './routes/receipts';
import matchingRoutes from './routes/matching';
import healthRoutes from './routes/health';

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
      filename: 'logs/unified-app.log',
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5
    })
  ]
});

// Create the unified Express app
const app = express();

// Copy middleware from existing app
app.use(helmet({
  contentSecurityPolicy: false // Configure as needed
}));

app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true
}));

app.use(compression());
app.use(morgan('combined'));

// Body parsing middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve static files
app.use('/static', express.static(path.join(__dirname, '../public')));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Set up view engine for inbox UI
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

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

// Mount all route modules
app.use('/inbox', inboxRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/rules', ruleRoutes);
app.use('/api/policies', policyRoutes);
app.use('/api/transactions/categorization', categorizationRoutes);
app.use('/api/receipts', receiptRoutes);
app.use('/api/matching', matchingRoutes);
app.use('/health', healthRoutes);

// Mount existing Plaid routes from the original app
app.use('/api/plaid', (req, res, next) => {
  // Forward to existing app
  existingApp(req, res, next);
});

// Default route - redirect to inbox
app.get('/', (req, res) => {
  res.redirect('/inbox');
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Not found',
    path: req.originalUrl
  });
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

export default app;
