/**
 * Category Management Service
 * Hierarchical expense categories with GL mapping and analytics
 */

import { knex } from '../utils/database';
import { auditLogger } from '../utils/audit';

export interface Category {
  id: string;
  organization_id: string;
  name: string;
  code?: string;
  parent_id?: string;
  gl_account_id?: string;
  description?: string;
  tax_settings?: {
    taxable: boolean;
    tax_code?: string;
    tax_rate?: number;
  };
  department_settings?: {
    allowed_departments?: string[];
    required_approval_departments?: string[];
  };
  policy_settings?: {
    receipt_required: boolean;
    approval_required: boolean;
    spending_limit?: number;
    allowed_users?: string[];
  };
  active: boolean;
  usage_stats?: {
    transaction_count: number;
    total_amount: number;
    last_used?: Date;
  };
  children?: Category[];
  parent?: Category;
  gl_account?: {
    account_code: string;
    account_name: string;
    account_type: string;
  };
  created_at: Date;
  updated_at: Date;
  created_by: string;
  updated_by: string;
}

export interface CategoryFilters {
  organizationId: string;
  includeHierarchy?: boolean;
  parentId?: string;
  activeOnly?: boolean;
}

export interface CategoryAnalytics {
  category_usage: Array<{
    category_id: string;
    category_name: string;
    transaction_count: number;
    total_amount: number;
    percentage_of_total: number;
  }>;
  time_series: Array<{
    period: string;
    category_breakdowns: Array<{
      category_id: string;
      category_name: string;
      amount: number;
    }>;
  }>;
  spending_trends: {
    top_growing: Array<{
      category_id: string;
      category_name: string;
      growth_rate: number;
    }>;
    top_declining: Array<{
      category_id: string;
      category_name: string;
      decline_rate: number;
    }>;
  };
}

export class CategoryService {
  /**
   * Get categories with optional hierarchical structure
   */
  async getCategories(filters: CategoryFilters): Promise<Category[]> {
    const query = knex('categories as c')
      .select(
        'c.*',
        'gl.account_code',
        'gl.account_name', 
        'gl.account_type',
        'parent.name as parent_name'
      )
      .leftJoin('gl_accounts as gl', 'c.gl_account_id', 'gl.id')
      .leftJoin('categories as parent', 'c.parent_id', 'parent.id')
      .where('c.organization_id', filters.organizationId);

    if (filters.activeOnly) {
      query.where('c.active', true);
    }

    if (filters.parentId) {
      query.where('c.parent_id', filters.parentId);
    } else if (filters.includeHierarchy) {
      // Only get root categories if building hierarchy
      query.whereNull('c.parent_id');
    }

    query.orderBy('c.name');

    const categories = await query;

    // Add usage statistics
    const categoriesWithStats = await this.addUsageStats(categories, filters.organizationId);

    if (filters.includeHierarchy && !filters.parentId) {
      return this.buildHierarchy(categoriesWithStats, filters.organizationId);
    }

    return categoriesWithStats;
  }

  /**
   * Get a specific category by ID
   */
  async getCategoryById(categoryId: string, organizationId: string): Promise<Category | null> {
    const category = await knex('categories as c')
      .select(
        'c.*',
        'gl.account_code',
        'gl.account_name',
        'gl.account_type',
        'parent.name as parent_name'
      )
      .leftJoin('gl_accounts as gl', 'c.gl_account_id', 'gl.id')
      .leftJoin('categories as parent', 'c.parent_id', 'parent.id')
      .where('c.id', categoryId)
      .where('c.organization_id', organizationId)
      .first();

    if (!category) return null;

    // Add usage statistics
    const [categoryWithStats] = await this.addUsageStats([category], organizationId);

    // Get children if this is a parent category
    const children = await knex('categories')
      .where('parent_id', categoryId)
      .where('organization_id', organizationId)
      .where('active', true)
      .orderBy('name');

    if (children.length > 0) {
      categoryWithStats.children = await this.addUsageStats(children, organizationId);
    }

    return categoryWithStats;
  }

  /**
   * Create a new category
   */
  async createCategory(categoryData: Partial<Category>): Promise<Category> {
    // Check for duplicate names within the same parent
    const existingCategory = await knex('categories')
      .where('organization_id', categoryData.organization_id)
      .where('name', categoryData.name)
      .where('parent_id', categoryData.parent_id || null)
      .first();

    if (existingCategory) {
      throw new Error(`Category "${categoryData.name}" already exists in this hierarchy level`);
    }

    // Validate parent exists if specified
    if (categoryData.parent_id) {
      const parent = await knex('categories')
        .where('id', categoryData.parent_id)
        .where('organization_id', categoryData.organization_id)
        .first();

      if (!parent) {
        throw new Error('Parent category not found');
      }
    }

    // Validate GL account exists if specified
    if (categoryData.gl_account_id) {
      const glAccount = await knex('gl_accounts')
        .where('id', categoryData.gl_account_id)
        .where('organization_id', categoryData.organization_id)
        .first();

      if (!glAccount) {
        throw new Error('GL account not found');
      }
    }

    const [category] = await knex('categories')
      .insert({
        organization_id: categoryData.organization_id,
        name: categoryData.name,
        code: categoryData.code,
        parent_id: categoryData.parent_id,
        gl_account_id: categoryData.gl_account_id,
        description: categoryData.description,
        tax_settings: JSON.stringify(categoryData.tax_settings || {}),
        department_settings: JSON.stringify(categoryData.department_settings || {}),
        policy_settings: JSON.stringify(categoryData.policy_settings || {}),
        active: categoryData.active !== false,
        created_by: categoryData.created_by,
        updated_by: categoryData.updated_by,
        created_at: knex.fn.now(),
        updated_at: knex.fn.now()
      })
      .returning('*');

    await auditLogger.log({
      action: 'CREATE_CATEGORY',
      resource_type: 'Category',
      resource_id: category.id,
      organization_id: categoryData.organization_id,
      user_id: categoryData.created_by,
      details: {
        category_name: category.name,
        parent_id: category.parent_id
      }
    });

    return this.getCategoryById(category.id, categoryData.organization_id);
  }

  /**
   * Update an existing category
   */
  async updateCategory(
    categoryId: string, 
    organizationId: string, 
    updateData: Partial<Category>
  ): Promise<Category | null> {
    const existingCategory = await knex('categories')
      .where('id', categoryId)
      .where('organization_id', organizationId)
      .first();

    if (!existingCategory) {
      return null;
    }

    // Check for duplicate names if name is being changed
    if (updateData.name && updateData.name !== existingCategory.name) {
      const duplicateCategory = await knex('categories')
        .where('organization_id', organizationId)
        .where('name', updateData.name)
        .where('parent_id', updateData.parent_id || existingCategory.parent_id || null)
        .whereNot('id', categoryId)
        .first();

      if (duplicateCategory) {
        throw new Error(`Category "${updateData.name}" already exists in this hierarchy level`);
      }
    }

    // Validate parent exists and prevent circular references
    if (updateData.parent_id) {
      const parent = await knex('categories')
        .where('id', updateData.parent_id)
        .where('organization_id', organizationId)
        .first();

      if (!parent) {
        throw new Error('Parent category not found');
      }

      // Check for circular reference
      if (await this.wouldCreateCircularReference(categoryId, updateData.parent_id, organizationId)) {
        throw new Error('Cannot set parent: would create circular reference');
      }
    }

    const updateFields: any = {
      updated_by: updateData.updatedBy,
      updated_at: knex.fn.now()
    };

    if (updateData.name !== undefined) updateFields.name = updateData.name;
    if (updateData.code !== undefined) updateFields.code = updateData.code;
    if (updateData.parent_id !== undefined) updateFields.parent_id = updateData.parent_id;
    if (updateData.gl_account_id !== undefined) updateFields.gl_account_id = updateData.gl_account_id;
    if (updateData.description !== undefined) updateFields.description = updateData.description;
    if (updateData.tax_settings !== undefined) {
      updateFields.tax_settings = JSON.stringify(updateData.tax_settings);
    }
    if (updateData.department_settings !== undefined) {
      updateFields.department_settings = JSON.stringify(updateData.department_settings);
    }
    if (updateData.policy_settings !== undefined) {
      updateFields.policy_settings = JSON.stringify(updateData.policy_settings);
    }
    if (updateData.active !== undefined) updateFields.active = updateData.active;

    await knex('categories')
      .where('id', categoryId)
      .where('organization_id', organizationId)
      .update(updateFields);

    await auditLogger.log({
      action: 'UPDATE_CATEGORY',
      resource_type: 'Category',
      resource_id: categoryId,
      organization_id: organizationId,
      user_id: updateData.updatedBy,
      details: {
        changes: Object.keys(updateFields).filter(key => !['updated_by', 'updated_at'].includes(key))
      }
    });

    return this.getCategoryById(categoryId, organizationId);
  }

  /**
   * Delete a category (soft delete)
   */
  async deleteCategory(categoryId: string, organizationId: string): Promise<boolean> {
    const category = await knex('categories')
      .where('id', categoryId)
      .where('organization_id', organizationId)
      .first();

    if (!category) {
      return false;
    }

    // Check if category has children
    const childCount = await knex('categories')
      .where('parent_id', categoryId)
      .where('active', true)
      .count('id as count')
      .first();

    if (parseInt(childCount.count) > 0) {
      throw new Error('Cannot delete category with active child categories');
    }

    // Check if category is in use
    const transactionCount = await knex('transactions')
      .where('category_id', categoryId)
      .count('id as count')
      .first();

    if (parseInt(transactionCount.count) > 0) {
      throw new Error('Cannot delete category that is in use by transactions');
    }

    await knex('categories')
      .where('id', categoryId)
      .where('organization_id', organizationId)
      .update({
        active: false,
        updated_at: knex.fn.now()
      });

    await auditLogger.log({
      action: 'DELETE_CATEGORY',
      resource_type: 'Category',
      resource_id: categoryId,
      organization_id: organizationId,
      details: {
        category_name: category.name
      }
    });

    return true;
  }

  /**
   * Get category usage analytics
   */
  async getCategoryAnalytics(params: {
    organizationId: string;
    startDate?: string;
    endDate?: string;
    categoryId?: string;
  }): Promise<CategoryAnalytics> {
    const { organizationId, startDate, endDate, categoryId } = params;

    let dateFilter = '';
    const queryParams: any[] = [organizationId];

    if (startDate || endDate) {
      dateFilter = 'AND t.transaction_date';
      if (startDate && endDate) {
        dateFilter += ' BETWEEN ? AND ?';
        queryParams.push(startDate, endDate);
      } else if (startDate) {
        dateFilter += ' >= ?';
        queryParams.push(startDate);
      } else {
        dateFilter += ' <= ?';
        queryParams.push(endDate);
      }
    }

    let categoryFilter = '';
    if (categoryId) {
      categoryFilter = 'AND t.category_id = ?';
      queryParams.push(categoryId);
    }

    // Get category usage statistics
    const categoryUsage = await knex.raw(`
      WITH total_spending AS (
        SELECT SUM(amount) as total_amount
        FROM transactions t
        WHERE t.organization_id = ? ${dateFilter} ${categoryFilter}
      )
      SELECT 
        c.id as category_id,
        c.name as category_name,
        COUNT(t.id) as transaction_count,
        COALESCE(SUM(t.amount), 0) as total_amount,
        ROUND(
          (COALESCE(SUM(t.amount), 0) / NULLIF(ts.total_amount, 0) * 100), 2
        ) as percentage_of_total
      FROM categories c
      LEFT JOIN transactions t ON c.id = t.category_id 
        AND t.organization_id = ? ${dateFilter}
      CROSS JOIN total_spending ts
      WHERE c.organization_id = ? 
        AND c.active = true
        ${categoryId ? 'AND c.id = ?' : ''}
      GROUP BY c.id, c.name, ts.total_amount
      ORDER BY total_amount DESC
    `, categoryId ? [...queryParams, organizationId, organizationId, categoryId] : [...queryParams, organizationId, organizationId]);

    // Get time series data (monthly breakdown)
    const timeSeries = await knex.raw(`
      SELECT 
        DATE_TRUNC('month', t.transaction_date) as period,
        jsonb_agg(
          jsonb_build_object(
            'category_id', c.id,
            'category_name', c.name,
            'amount', COALESCE(SUM(t.amount), 0)
          )
        ) as category_breakdowns
      FROM categories c
      LEFT JOIN transactions t ON c.id = t.category_id 
        AND t.organization_id = ? ${dateFilter}
      WHERE c.organization_id = ? 
        AND c.active = true
        ${categoryFilter}
      GROUP BY DATE_TRUNC('month', t.transaction_date)
      ORDER BY period DESC
      LIMIT 12
    `, queryParams);

    // Get spending trends (comparing last 30 days vs previous 30 days)
    const trendData = await knex.raw(`
      WITH current_period AS (
        SELECT 
          c.id,
          c.name,
          COALESCE(SUM(t.amount), 0) as current_amount
        FROM categories c
        LEFT JOIN transactions t ON c.id = t.category_id
          AND t.organization_id = ?
          AND t.transaction_date >= CURRENT_DATE - INTERVAL '30 days'
        WHERE c.organization_id = ? AND c.active = true
        GROUP BY c.id, c.name
      ),
      previous_period AS (
        SELECT 
          c.id,
          COALESCE(SUM(t.amount), 0) as previous_amount
        FROM categories c
        LEFT JOIN transactions t ON c.id = t.category_id
          AND t.organization_id = ?
          AND t.transaction_date >= CURRENT_DATE - INTERVAL '60 days'
          AND t.transaction_date < CURRENT_DATE - INTERVAL '30 days'
        WHERE c.organization_id = ? AND c.active = true
        GROUP BY c.id
      )
      SELECT 
        cp.id as category_id,
        cp.name as category_name,
        CASE 
          WHEN pp.previous_amount = 0 THEN 0
          ELSE ROUND(
            ((cp.current_amount - pp.previous_amount) / NULLIF(pp.previous_amount, 0) * 100), 2
          )
        END as growth_rate
      FROM current_period cp
      LEFT JOIN previous_period pp ON cp.id = pp.id
      WHERE cp.current_amount > 0 OR pp.previous_amount > 0
      ORDER BY growth_rate DESC
    `, [organizationId, organizationId, organizationId, organizationId]);

    const topGrowing = trendData.rows
      .filter(row => row.growth_rate > 0)
      .slice(0, 5);

    const topDeclining = trendData.rows
      .filter(row => row.growth_rate < 0)
      .sort((a, b) => a.growth_rate - b.growth_rate)
      .slice(0, 5)
      .map(row => ({
        ...row,
        decline_rate: Math.abs(row.growth_rate)
      }));

    return {
      category_usage: categoryUsage.rows,
      time_series: timeSeries.rows.map(row => ({
        period: row.period,
        category_breakdowns: row.category_breakdowns || []
      })),
      spending_trends: {
        top_growing: topGrowing,
        top_declining: topDeclining
      }
    };
  }

  /**
   * Bulk categorize transactions
   */
  async bulkCategorizeTransactions(params: {
    organizationId: string;
    transactionIds: string[];
    categoryId: string;
    userId: string;
    applyRules?: boolean;
  }): Promise<{ updated_count: number; failed_count: number; errors: string[] }> {
    const { organizationId, transactionIds, categoryId, userId, applyRules } = params;

    // Validate category exists
    const category = await knex('categories')
      .where('id', categoryId)
      .where('organization_id', organizationId)
      .where('active', true)
      .first();

    if (!category) {
      throw new Error('Category not found');
    }

    let updatedCount = 0;
    let failedCount = 0;
    const errors: string[] = [];

    for (const transactionId of transactionIds) {
      try {
        // Verify transaction exists and belongs to organization
        const transaction = await knex('transactions')
          .where('id', transactionId)
          .where('organization_id', organizationId)
          .first();

        if (!transaction) {
          errors.push(`Transaction ${transactionId} not found`);
          failedCount++;
          continue;
        }

        await knex('transactions')
          .where('id', transactionId)
          .update({
            category_id: categoryId,
            updated_by: userId,
            updated_at: knex.fn.now()
          });

        updatedCount++;

        // Apply additional rules if requested
        if (applyRules) {
          // This would trigger rule engine processing
          // Implementation depends on rule engine service
        }

      } catch (error) {
        errors.push(`Failed to categorize transaction ${transactionId}: ${error.message}`);
        failedCount++;
      }
    }

    await auditLogger.log({
      action: 'BULK_CATEGORIZE_TRANSACTIONS',
      resource_type: 'Transaction',
      organization_id: organizationId,
      user_id: userId,
      details: {
        category_id: categoryId,
        category_name: category.name,
        transaction_count: transactionIds.length,
        updated_count: updatedCount,
        failed_count: failedCount
      }
    });

    return {
      updated_count: updatedCount,
      failed_count: failedCount,
      errors
    };
  }

  /**
   * Add usage statistics to categories
   */
  private async addUsageStats(categories: any[], organizationId: string): Promise<Category[]> {
    if (categories.length === 0) return [];

    const categoryIds = categories.map(c => c.id);

    const stats = await knex('transactions')
      .select('category_id')
      .count('id as transaction_count')
      .sum('amount as total_amount')
      .max('transaction_date as last_used')
      .whereIn('category_id', categoryIds)
      .where('organization_id', organizationId)
      .groupBy('category_id');

    const statsMap = stats.reduce((acc, stat) => {
      acc[stat.category_id] = {
        transaction_count: parseInt(stat.transaction_count),
        total_amount: parseFloat(stat.total_amount) || 0,
        last_used: stat.last_used
      };
      return acc;
    }, {});

    return categories.map(category => ({
      ...category,
      usage_stats: statsMap[category.id] || {
        transaction_count: 0,
        total_amount: 0,
        last_used: null
      }
    }));
  }

  /**
   * Build hierarchical category structure
   */
  private async buildHierarchy(rootCategories: Category[], organizationId: string): Promise<Category[]> {
    for (const category of rootCategories) {
      const children = await knex('categories')
        .where('parent_id', category.id)
        .where('organization_id', organizationId)
        .where('active', true)
        .orderBy('name');

      if (children.length > 0) {
        const childrenWithStats = await this.addUsageStats(children, organizationId);
        category.children = await this.buildHierarchy(childrenWithStats, organizationId);
      }
    }

    return rootCategories;
  }

  /**
   * Check if setting a parent would create a circular reference
   */
  private async wouldCreateCircularReference(
    categoryId: string, 
    parentId: string, 
    organizationId: string
  ): Promise<boolean> {
    let currentParentId = parentId;
    
    while (currentParentId) {
      if (currentParentId === categoryId) {
        return true;
      }

      const parent = await knex('categories')
        .select('parent_id')
        .where('id', currentParentId)
        .where('organization_id', organizationId)
        .first();

      currentParentId = parent?.parent_id;
    }

    return false;
  }
}
