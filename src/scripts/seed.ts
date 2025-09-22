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

async function runSeeds(): Promise<void> {
  try {
    console.log('Running database seeds...');
    
    // Run seeds
    await db.seed.run();
    
    console.log('Seeds completed successfully');
  } catch (error) {
    console.error('Seeding failed:', error);
    process.exit(1);
  } finally {
    await db.destroy();
  }
}

if (require.main === module) {
  runSeeds();
}

export default runSeeds;
