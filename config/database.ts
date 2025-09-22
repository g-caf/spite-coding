import { config } from 'dotenv';

config();

interface DatabaseConfig {
  url: string;
  ssl: boolean;
  pool: {
    min: number;
    max: number;
  };
}

interface RedisConfig {
  url: string;
  ttl: number;
}

export const databaseConfig: DatabaseConfig = {
  url: process.env['DATABASE_URL'] || 'postgresql://localhost:5432/expense_platform',
  ssl: process.env['NODE_ENV'] === 'production',
  pool: {
    min: 2,
    max: 10,
  },
};

export const redisConfig: RedisConfig = {
  url: process.env['REDIS_URL'] || 'redis://localhost:6379',
  ttl: parseInt(process.env['REDIS_SESSION_TTL'] || '86400', 10),
};