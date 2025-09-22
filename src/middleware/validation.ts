import { Request, Response, NextFunction } from 'express';
import { validationResult, ValidationChain } from 'express-validator';
import logger from '../../config/logger';

// Validation result handler
export const handleValidationErrors = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const errors = validationResult(req);
  
  if (!errors.isEmpty()) {
    logger.warn({
      message: 'Validation failed',
      errors: errors.array(),
      method: req.method,
      url: req.originalUrl,
      ip: req.ip,
    });
    
    res.status(400).json({
      error: 'Validation failed',
      details: errors.array(),
    });
    return;
  }
  
  next();
};

// Validation middleware factory
export const validate = (validations: ValidationChain[]) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    await Promise.all(validations.map(validation => validation.run(req)));
    handleValidationErrors(req, res, next);
  };
};