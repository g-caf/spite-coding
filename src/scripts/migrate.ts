#!/usr/bin/env node

import { config } from 'dotenv';
import { Knex } from 'knex';

// Load environment variables
config();

// Import knexfile dynamically to avoid TypeScript issues
const knexfile = require('../../knexfile.js') as { [key: string]: Knex.Config };
const knex = require('knex') as (config: Knex.Config) => Knex;

const environment = process.env['NODE_ENV'] || 'development';
const dbConfig = knexfile[environment];
if (!dbConfig) {
  throw new Error(`No database configuration found for environment: ${environment}`);
}
const db = knex(dbConfig);

async function runMigrations(): Promise<void> {
  try {
    console.log('Running database migrations...');
    
    // Run migrations
    const [batchNo, log] = await db.migrate.latest();
    
    if (log.length === 0) {
      console.log('Database is already up to date');
    } else {
      console.log(`Batch ${batchNo} run: ${log.length} migrations`);
      log.forEach((migration: string) => console.log(`  - ${migration}`));
    }
    
    console.log('Migrations completed successfully');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await db.destroy();
  }
}

if (require.main === module) {
  runMigrations();
}

export default runMigrations;
