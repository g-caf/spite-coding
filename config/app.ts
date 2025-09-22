import { config } from 'dotenv';

config();

export interface AppConfig {
  nodeEnv: string;
  port: number;
  host: string;
  sessionSecret: string;
  cookieSecret: string;
  allowedOrigins: string[];
  rateLimitWindowMs: number;
  rateLimitMax: number;
}

export const appConfig: AppConfig = {
  nodeEnv: process.env['NODE_ENV'] || 'development',
  port: parseInt(process.env['PORT'] || '3000', 10),
  host: process.env['HOST'] || (process.env['NODE_ENV'] === 'production' ? '0.0.0.0' : 'localhost'),
  sessionSecret: process.env['SESSION_SECRET'] || 'fallback-session-secret-change-in-production',
  cookieSecret: process.env['COOKIE_SECRET'] || process.env['SESSION_SECRET'] || 'fallback-cookie-secret-change-in-production',
  allowedOrigins: process.env['ALLOWED_ORIGINS']?.split(',') || ['http://localhost:3000'],
  rateLimitWindowMs: parseInt(process.env['RATE_LIMIT_WINDOW_MS'] || '900000', 10), // 15 minutes
  rateLimitMax: parseInt(process.env['RATE_LIMIT_MAX'] || '100', 10),
};