#!/usr/bin/env node

import { config } from 'dotenv';
import http from 'http';
import Redis from 'redis';
import knex from 'knex';
import knexfile from '../../knexfile.js';

// Load environment variables
config();

const PORT = process.env.PORT || 3000;
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const environment = process.env.NODE_ENV || 'development';

interface HealthStatus {
  status: 'healthy' | 'unhealthy';
  timestamp: string;
  services: {
    database: 'connected' | 'disconnected';
    redis: 'connected' | 'disconnected';
    server: 'running' | 'stopped';
  };
  version: string;
  uptime: number;
}

async function checkDatabase(): Promise<'connected' | 'disconnected'> {
  let db: any = null;
  try {
    db = knex(knexfile[environment]);
    await db.raw('SELECT 1');
    return 'connected';
  } catch (error) {
    console.error('Database health check failed:', error);
    return 'disconnected';
  } finally {
    if (db) {
      await db.destroy();
    }
  }
}

async function checkRedis(): Promise<'connected' | 'disconnected'> {
  let client: any = null;
  try {
    client = Redis.createClient({ url: REDIS_URL });
    await client.connect();
    await client.ping();
    return 'connected';
  } catch (error) {
    console.error('Redis health check failed:', error);
    return 'disconnected';
  } finally {
    if (client) {
      await client.disconnect();
    }
  }
}

async function checkServer(): Promise<'running' | 'stopped'> {
  return new Promise((resolve) => {
    const request = http.get(`http://localhost:${PORT}/health`, (res) => {
      resolve(res.statusCode === 200 ? 'running' : 'stopped');
    });

    request.on('error', () => {
      resolve('stopped');
    });

    request.setTimeout(5000, () => {
      request.destroy();
      resolve('stopped');
    });
  });
}

async function getHealthStatus(): Promise<HealthStatus> {
  const startTime = Date.now();
  
  const [database, redis, server] = await Promise.all([
    checkDatabase(),
    checkRedis(),
    checkServer()
  ]);

  const services = { database, redis, server };
  const allHealthy = Object.values(services).every(status => 
    status === 'connected' || status === 'running'
  );

  return {
    status: allHealthy ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    services,
    version: process.env.npm_package_version || '1.0.0',
    uptime: process.uptime()
  };
}

async function runHealthCheck(): Promise<void> {
  try {
    const health = await getHealthStatus();
    console.log(JSON.stringify(health, null, 2));
    
    if (health.status === 'unhealthy') {
      process.exit(1);
    }
  } catch (error) {
    console.error('Health check failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  runHealthCheck();
}

export { getHealthStatus, runHealthCheck };
