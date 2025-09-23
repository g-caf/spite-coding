/**
 * Receipt Processing Application Entry Point
 * Focused server for receipt processing functionality
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import path from 'path';
import knex from 'knex';
import winston from 'winston';
import { createReceiptRoutes } from './routes/receipts';

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
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' })
  ]
});

// Load environment variables
const requiredEnvVars = [
  'DATABASE_URL',
  'SESSION_SECRET',
  'JWT_SECRET'
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    logger.error(`Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
}

// Configure database
const db = knex({
  client: 'pg',
  connection: process.env.DATABASE_URL,
  pool: {
    min: 2,
    max: 10
  },
  migrations: {
    directory: './database/migrations'
  }
});

// Test database connection
db.raw('SELECT 1+1 as result')
  .then(() => {
    logger.info('Database connection established');
  })
  .catch((error) => {
    logger.error('Database connection failed:', error);
    process.exit(1);
  });

// Create Express app
const app = express();

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
}));

// CORS configuration
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Compression
app.use(compression());

// Request logging
app.use(morgan('combined', {
  stream: {
    write: (message) => logger.info(message.trim())
  }
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // Limit each IP to 1000 requests per windowMs
  message: {
    error: 'Too many requests',
    message: 'Rate limit exceeded. Please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

app.use('/api/', limiter);

// Stricter rate limiting for upload endpoints
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit uploads to 100 per 15 minutes
  message: {
    error: 'Upload rate limit exceeded',
    message: 'Too many upload requests. Please try again later.'
  }
});

app.use('/api/receipts/upload', uploadLimiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static file serving
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Authentication middleware (placeholder - integrate with your auth system)
app.use((req: any, res, next) => {
  // Mock user for development
  if (process.env.NODE_ENV === 'development') {
    req.user = {
      id: 'dev-user-1',
      organizationId: 'dev-org-1',
      email: 'dev@example.com',
      name: 'Development User',
      permissions: {
        receipts: ['create', 'read', 'update', 'delete'],
        transactions: ['read'],
        reports: ['read']
      }
    };
  }
  next();
});

// API Routes
app.use('/api/receipts', createReceiptRoutes(db));

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    // Check database connection
    await db.raw('SELECT 1');
    
    // Check AWS services availability (simplified)
    const awsHealthy = process.env.AWS_ACCESS_KEY_ID && 
                      process.env.AWS_SECRET_ACCESS_KEY && 
                      process.env.S3_BUCKET_NAME;

    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      services: {
        database: 'healthy',
        aws: awsHealthy ? 'healthy' : 'degraded',
        ocr: 'healthy',
        storage: 'healthy'
      },
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      cpu: process.cpuUsage()
    };

    res.status(200).json(health);
  } catch (error) {
    logger.error('Health check failed:', error);
    res.status(503).json({
      status: 'unhealthy',
      error: 'Service temporarily unavailable'
    });
  }
});

// Serve upload interface
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'receipt-upload.html'));
});

// API documentation endpoint
app.get('/api', (req, res) => {
  res.json({
    name: 'Receipt Processing API',
    version: '1.0.0',
    description: 'RESTful API for expense receipt processing',
    endpoints: {
      'POST /api/receipts/upload': 'Upload single receipt file',
      'POST /api/receipts/upload/multiple': 'Upload multiple receipt files',
      'POST /api/receipts/email': 'Process receipt from email',
      'GET /api/receipts': 'Search and list receipts',
      'GET /api/receipts/:id': 'Get receipt details',
      'PUT /api/receipts/:id/fields': 'Update extracted fields',
      'GET /api/receipts/:id/status': 'Get processing status',
      'DELETE /api/receipts/:id': 'Delete receipt',
      'GET /api/receipts/search': 'Advanced search'
    },
    documentation: {
      readme: '/RECEIPT_PROCESSING_README.md'
    }
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: 'The requested resource was not found',
    path: req.originalUrl
  });
});

// Global error handler
app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  // Log error with context
  logger.error('Unhandled error:', {
    error: error.message,
    stack: error.stack,
    url: req.url,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    userId: (req as any).user?.id,
    organizationId: (req as any).user?.organizationId
  });

  // Don't expose sensitive error details in production
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  res.status(error.status || 500).json({
    success: false,
    error: isDevelopment ? error.message : 'Internal Server Error',
    ...(isDevelopment && { stack: error.stack }),
    timestamp: new Date().toISOString(),
    requestId: req.get('X-Request-ID') || 'unknown'
  });
});

// Graceful shutdown handling
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  
  try {
    await db.destroy();
    logger.info('Database connections closed');
  } catch (error) {
    logger.error('Error closing database connections:', error);
  }
  
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');
  
  try {
    await db.destroy();
    logger.info('Database connections closed');
  } catch (error) {
    logger.error('Error closing database connections:', error);
  }
  
  process.exit(0);
});

// Unhandled promise rejection handler
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Uncaught exception handler
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';

app.listen(PORT, HOST, () => {
  logger.info(`Receipt Processing API server running on ${HOST}:${PORT}`, {
    environment: process.env.NODE_ENV || 'development',
    port: PORT,
    host: HOST
  });
});

export default app;