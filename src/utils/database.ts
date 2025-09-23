/**
 * Database connection and utilities
 */

import knex, { Knex } from 'knex';
import knexConfig from '../../knexfile.js';

const environment = process.env.NODE_ENV || 'development';
const config = knexConfig[environment];

export const db = knex(config);

// Database transaction helper
export async function withTransaction<T>(
  fn: (trx: Knex.Transaction) => Promise<T>
): Promise<T> {
  return db.transaction(fn);
}

// Query builder helpers
export const queryBuilder = {
  /**
   * Apply organization isolation to any query
   */
  withOrganization(query: Knex.QueryBuilder, organizationId: string) {
    return query.where('organization_id', organizationId);
  },

  /**
   * Apply date range filtering
   */
  withDateRange(
    query: Knex.QueryBuilder, 
    startDate?: string, 
    endDate?: string,
    dateColumn = 'created_at'
  ) {
    if (startDate) query.where(dateColumn, '>=', startDate);
    if (endDate) query.where(dateColumn, '<=', endDate);
    return query;
  },

  /**
   * Apply pagination
   */
  withPagination(query: Knex.QueryBuilder, limit = 20, offset = 0) {
    return query.limit(limit).offset(offset);
  },

  /**
   * Apply active filter
   */
  onlyActive(query: Knex.QueryBuilder) {
    return query.where('active', true);
  }
};

// Export the database instance as both named and default exports
export { db as knex };
export default db;
