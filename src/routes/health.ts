import { Router, Request, Response } from 'express';
import logger from '../../config/logger';

const router = Router();

interface HealthResponse {
  status: string;
  timestamp: string;
  uptime: number;
  environment: string;
  version: string;
}

// Health check endpoint
router.get('/', (req: Request, res: Response) => {
  const healthData: HealthResponse = {
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env['NODE_ENV'] || 'development',
    version: process.env['npm_package_version'] || '1.0.0',
  };

  logger.info('Health check requested', { ip: req.ip });
  
  res.status(200).json(healthData);
});

// Detailed health check with system info
router.get('/detailed', (req: Request, res: Response) => {
  const detailedHealth = {
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env['NODE_ENV'] || 'development',
    version: process.env['npm_package_version'] || '1.0.0',
    system: {
      platform: process.platform,
      nodeVersion: process.version,
      memory: process.memoryUsage(),
      cpuUsage: process.cpuUsage(),
    },
  };

  logger.info('Detailed health check requested', { ip: req.ip });
  
  res.status(200).json(detailedHealth);
});

export default router;