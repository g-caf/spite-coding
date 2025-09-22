import { Router, Request, Response } from 'express';
import healthRouter from './health';

const router = Router();

// Mount health check routes
router.use('/health', healthRouter);

// Root route
router.get('/', (_req: Request, res: Response) => {
  res.json({
    message: 'Expense Platform API',
    version: '1.0.0',
    documentation: '/api/docs',
  });
});

export default router;