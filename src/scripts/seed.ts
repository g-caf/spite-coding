#!/usr/bin/env node

import { config } from 'dotenv';
import knex from 'knex';
import knexfile from '../../knexfile.js';

// Load environment variables
config();

const environment = process.env.NODE_ENV || 'development';
const db = knex(knexfile[environment]);

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
