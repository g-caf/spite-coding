import express, { Application } from 'express';
import session from 'express-session';
import cookieParser from 'cookie-parser';
import path from 'path';
import { appConfig } from '../config/app';
import logger from '../config/logger';
import {
  securityHeaders,
  rateLimiter,
  corsMiddleware,
  requestLogger,
  errorHandler,
} from './middleware/security';
import routes from './routes';

class ExpenseApp {
  public app: Application;

  constructor() {
    this.app = express();
    this.initializeMiddleware();
    this.initializeRoutes();
    this.initializeErrorHandling();
  }

  private initializeMiddleware(): void {
    // Security middleware (applied first)
    this.app.use(securityHeaders);
    this.app.use(corsMiddleware);
    this.app.use(rateLimiter);

    // Basic Express middleware
    this.app.use(express.json({ 
      limit: '10mb',
      strict: true,
    }));
    this.app.use(express.urlencoded({ 
      extended: true, 
      limit: '10mb' 
    }));
    
    // Cookie parsing with security
    this.app.use(cookieParser(appConfig.cookieSecret));

    // Session configuration
    this.app.use(session({
      secret: appConfig.sessionSecret,
      name: 'expense.sid',
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        secure: appConfig.nodeEnv === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        sameSite: 'strict',
      },
    }));

    // Static files
    this.app.use(express.static(path.join(__dirname, '../public'), {
      maxAge: appConfig.nodeEnv === 'production' ? '7d' : '0',
      etag: true,
      lastModified: true,
    }));

    // View engine setup
    this.app.set('view engine', 'ejs');
    this.app.set('views', path.join(__dirname, '../views'));

    // Request logging
    this.app.use(requestLogger);
  }

  private initializeRoutes(): void {
    // Health check endpoint (before routes)
    this.app.get('/health', (req, res) => {
      res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: process.env.npm_package_version || '1.0.0'
      });
    });

    this.app.use('/api', routes);
    
    // Catch 404 and forward to error handler
    this.app.use('*', (req, res) => {
      logger.warn(`404 - Route not found: ${req.originalUrl}`, { ip: req.ip });
      res.status(404).json({
        error: 'Route not found',
        path: req.originalUrl,
      });
    });
  }

  private initializeErrorHandling(): void {
    this.app.use(errorHandler);
  }

  public listen(): void {
    this.app.listen(appConfig.port, appConfig.host, () => {
      logger.info(`Server running on http://${appConfig.host}:${appConfig.port}`);
      logger.info(`Environment: ${appConfig.nodeEnv}`);
    });
  }
}

export default ExpenseApp;