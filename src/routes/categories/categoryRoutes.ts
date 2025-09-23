/**
 * Category Management API Routes
 * Hierarchical expense categories with GL mapping
 */

import { Router } from 'express';
import { CategoryService } from '../../services/categoryService';
import { authenticateToken } from '../../auth/middleware/authentication';
import { requirePermissions } from '../../auth/middleware/authorization';
import { validateRequest } from '../../middleware/validation';
import { body, param, query } from 'express-validator';
import { getErrorMessage } from '../../utils/errorHandling';

const router = Router();
const categoryService = new CategoryService();

// Apply authentication to all routes
router.use(authenticateToken);

/**
 * GET /api/categories
 * List all categories with optional hierarchical structure
 */
router.get('/',
  validateRequest([
    query('include_hierarchy').optional().isBoolean(),
    query('parent_id').optional().isUUID(),
    query('active_only').optional().isBoolean().default(true)
  ]),
  requirePermissions(['read_categories']),
  async (req, res) => {
    try {
      const { include_hierarchy, parent_id, active_only } = req.query;
      const organizationId = req.user!.organization_id;

      const categories = await categoryService.getCategories({
        organization_id,
        includeHierarchy: include_hierarchy === 'true',
        parentId: parent_id as string,
        activeOnly: active_only !== 'false'
      });

      res.json({
        success: true,
        data: categories,
        meta: {
          total: categories.length,
          hierarchical: include_hierarchy === 'true'
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to fetch categories',
        message: getErrorMessage(error)
      });
    }
  }
);

/**
 * GET /api/categories/:id
 * Get a specific category with full details
 */
router.get('/:id',
  validateRequest([
    param('id').isUUID()
  ]),
  requirePermissions(['read_categories']),
  async (req, res) => {
    try {
      const categoryId = req.params.id;
      const organizationId = req.user!.organization_id;

      const category = await categoryService.getCategoryById(categoryId, organizationId);
      
      if (!category) {
        return res.status(404).json({
          success: false,
          error: 'Category not found'
        });
      }

      res.json({
        success: true,
        data: category
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to fetch category',
        message: getErrorMessage(error)
      });
    }
  }
);

/**
 * POST /api/categories
 * Create a new category
 */
router.post('/',
  validateRequest([
    body('name').isLength({ min: 1, max: 255 }).trim(),
    body('description').optional().isLength({ max: 1000 }).trim(),
    body('parent_id').optional().isUUID(),
    body('gl_account_id').optional().isUUID(),
    body('code').optional().isLength({ max: 50 }).trim(),
    body('tax_settings').optional().isObject(),
    body('department_settings').optional().isObject(),
    body('policy_settings').optional().isObject()
  ]),
  requirePermissions(['write_categories']),
  async (req, res) => {
    try {
      const organizationId = req.user!.organization_id;
      const userId = req.user!.id;

      const categoryData = {
        ...req.body,
        organization_id,
        createdBy: userId,
        updatedBy: userId
      };

      const category = await categoryService.createCategory(categoryData);

      res.status(201).json({
        success: true,
        data: category,
        message: 'Category created successfully'
      });
    } catch (error) {
      if (getErrorMessage(error).includes('already exists')) {
        return res.status(409).json({
          success: false,
          error: 'Category name already exists',
          message: getErrorMessage(error)
        });
      }

      res.status(500).json({
        success: false,
        error: 'Failed to create category',
        message: getErrorMessage(error)
      });
    }
  }
);

/**
 * PUT /api/categories/:id
 * Update an existing category
 */
router.put('/:id',
  validateRequest([
    param('id').isUUID(),
    body('name').optional().isLength({ min: 1, max: 255 }).trim(),
    body('description').optional().isLength({ max: 1000 }).trim(),
    body('parent_id').optional().isUUID(),
    body('gl_account_id').optional().isUUID(),
    body('code').optional().isLength({ max: 50 }).trim(),
    body('tax_settings').optional().isObject(),
    body('department_settings').optional().isObject(),
    body('policy_settings').optional().isObject(),
    body('active').optional().isBoolean()
  ]),
  requirePermissions(['write_categories']),
  async (req, res) => {
    try {
      const categoryId = req.params.id;
      const organizationId = req.user!.organization_id;
      const userId = req.user!.id;

      const updateData = {
        ...req.body,
        updatedBy: userId
      };

      const category = await categoryService.updateCategory(categoryId, organization_id, updateData);

      if (!category) {
        return res.status(404).json({
          success: false,
          error: 'Category not found'
        });
      }

      res.json({
        success: true,
        data: category,
        message: 'Category updated successfully'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to update category',
        message: getErrorMessage(error)
      });
    }
  }
);

/**
 * DELETE /api/categories/:id
 * Delete a category (soft delete)
 */
router.delete('/:id',
  validateRequest([
    param('id').isUUID()
  ]),
  requirePermissions(['delete_categories']),
  async (req, res) => {
    try {
      const categoryId = req.params.id;
      const organizationId = req.user!.organization_id;

      const success = await categoryService.deleteCategory(categoryId, organizationId);

      if (!success) {
        return res.status(404).json({
          success: false,
          error: 'Category not found or cannot be deleted'
        });
      }

      res.json({
        success: true,
        message: 'Category deleted successfully'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to delete category',
        message: getErrorMessage(error)
      });
    }
  }
);

/**
 * GET /api/categories/analytics/usage
 * Get category usage analytics
 */
router.get('/analytics/usage',
  validateRequest([
    query('start_date').optional().isISO8601(),
    query('end_date').optional().isISO8601(),
    query('category_id').optional().isUUID()
  ]),
  requirePermissions(['read_analytics']),
  async (req, res) => {
    try {
      const organizationId = req.user!.organization_id;
      const { start_date, end_date, category_id } = req.query;

      const analytics = await categoryService.getCategoryAnalytics({
        organization_id,
        startDate: start_date as string,
        endDate: end_date as string,
        categoryId: category_id as string
      });

      res.json({
        success: true,
        data: analytics
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to fetch category analytics',
        message: getErrorMessage(error)
      });
    }
  }
);

/**
 * POST /api/categories/bulk-categorize
 * Bulk categorization of transactions
 */
router.post('/bulk-categorize',
  validateRequest([
    body('transaction_ids').isArray().custom((value: any) => {
      return value.every((id: any) => typeof id === 'string');
    }),
    body('category_id').isUUID(),
    body('apply_rules').optional().isBoolean()
  ]),
  requirePermissions(['write_transactions']),
  async (req, res) => {
    try {
      const organizationId = req.user!.organization_id;
      const userId = req.user!.id;
      const { transaction_ids, category_id, apply_rules } = req.body;

      const result = await categoryService.bulkCategorizeTransactions({
        organization_id,
        transactionIds: transaction_ids,
        categoryId: category_id,
        userId,
        applyRules: apply_rules
      });

      res.json({
        success: true,
        data: result,
        message: `Successfully categorized ${result.updated_count} transactions`
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to bulk categorize transactions',
        message: getErrorMessage(error)
      });
    }
  }
);

export default router;
