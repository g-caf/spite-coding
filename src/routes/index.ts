import { Router, Request, Response } from 'express';
import healthRouter from './health.js';
import matchingRouter from './matching.js';
import categoryRoutes from './categories/categoryRoutes.js';
import ruleRoutes from './rules/ruleRoutes.js';
import categorizationRoutes from './transactions/categorizationRoutes.js';
import policyRoutes from './policy/policyRoutes.js';

const router = Router();

// Mount health check routes
router.use('/health', healthRouter);

// Mount matching engine routes
router.use('/matching', matchingRouter);

// Mount category management routes
router.use('/categories', categoryRoutes);

// Mount rule engine routes
router.use('/rules', ruleRoutes);

// Mount transaction categorization routes
router.use('/transactions', categorizationRoutes);

// Mount policy engine routes
router.use('/policy', policyRoutes);

// Root route
router.get('/', (_req: Request, res: Response) => {
  res.json({
    message: 'Expense Platform API',
    version: '1.0.0',
    documentation: '/api/docs',
    features: [
      'Smart expense categorization',
      'Automated rule engine',
      'Policy enforcement',
      'Receipt matching',
      'Compliance reporting',
      'ML-powered suggestions'
    ],
    endpoints: {
      categories: '/api/categories',
      rules: '/api/rules', 
      transactions: '/api/transactions',
      policy: '/api/policy',
      matching: '/api/matching',
      health: '/api/health'
    }
  });
});

export default router;