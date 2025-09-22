#!/usr/bin/env node

import { config } from 'dotenv';
import knex from 'knex';
import knexfile from '../../knexfile.js';

// Load environment variables
config();

const environment = process.env.NODE_ENV || 'development';
const db = knex(knexfile[environment]);

async function runMigrations(): Promise<void> {
  try {
    console.log('Running database migrations...');
    
    // Run migrations
    const [batchNo, log] = await db.migrate.latest();
    
    if (log.length === 0) {
      console.log('Database is already up to date');
    } else {
      console.log(`Batch ${batchNo} run: ${log.length} migrations`);
      log.forEach(migration => console.log(`  - ${migration}`));
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
