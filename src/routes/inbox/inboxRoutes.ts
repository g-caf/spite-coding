import express from 'express';
import multer from 'multer';
import path from 'path';

const router = express.Router();

// Configure multer for receipt uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'public/uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `receipt-${uniqueSuffix}${path.extname(file.originalname)}`);
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'application/pdf'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, GIF, and PDF files are allowed.'));
    }
  }
});

// Transaction service with mock data
class TransactionService {
  static async getTransactions(organizationId, filters = {}) {
    const mockTransactions = [
      {
        id: '1',
        organization_id: 'org1',
        user_id: 'user1',
        amount: 2500,
        description: 'Office Supplies - Staples',
        date: new Date('2024-01-15'),
        category_id: 'cat1',
        status: 'unmatched',
        merchant: 'Staples',
        payment_method: 'Corporate Card',
        created_at: new Date('2024-01-15'),
        updated_at: new Date('2024-01-15')
      },
      {
        id: '2',
        organization_id: 'org1',
        user_id: 'user1',
        amount: 8750,
        description: 'Team Lunch - Chipotle',
        date: new Date('2024-01-14'),
        category_id: 'cat2',
        status: 'categorized',
        receipt_url: '/uploads/receipt-2.jpg',
        merchant: 'Chipotle',
        payment_method: 'Corporate Card',
        created_at: new Date('2024-01-14'),
        updated_at: new Date('2024-01-14')
      },
      {
        id: '3',
        organization_id: 'org1',
        user_id: 'user1',
        amount: 15000,
        description: 'Software License - Adobe',
        date: new Date('2024-01-13'),
        category_id: 'cat3',
        status: 'approved',
        receipt_url: '/uploads/receipt-3.pdf',
        merchant: 'Adobe',
        payment_method: 'ACH',
        created_at: new Date('2024-01-13'),
        updated_at: new Date('2024-01-13')
      }
    ];

    let filtered = mockTransactions.filter(t => t.organization_id === organizationId);

    // Apply filters
    if (filters.search) {
      const search = filters.search.toLowerCase();
      filtered = filtered.filter(t => 
        t.description.toLowerCase().includes(search) ||
        (t.merchant && t.merchant.toLowerCase().includes(search))
      );
    }

    if (filters.status && filters.status.length > 0) {
      filtered = filtered.filter(t => filters.status.includes(t.status));
    }

    if (filters.category_id && filters.category_id.length > 0) {
      filtered = filtered.filter(t => t.category_id && filters.category_id.includes(t.category_id));
    }

    // Pagination
    const page = filters.page || 1;
    const limit = filters.limit || 20;
    const offset = (page - 1) * limit;
    const totalPages = Math.ceil(filtered.length / limit);

    const transactions = filtered
      .sort((a, b) => b.date.getTime() - a.date.getTime())
      .slice(offset, offset + limit);

    return {
      transactions,
      total: filtered.length,
      page,
      totalPages
    };
  }

  static async getTransaction(id, organizationId) {
    const result = await this.getTransactions(organizationId);
    return result.transactions.find(t => t.id === id) || null;
  }

  static async updateTransaction(id, organizationId, updates) {
    // In a real app, this would update the database
    const transaction = await this.getTransaction(id, organizationId);
    if (transaction) {
      Object.assign(transaction, updates, { updated_at: new Date() });
      return transaction;
    }
    return null;
  }

  static async getCategories(organizationId) {
    return [
      { id: 'cat1', organization_id: 'org1', name: 'Office Supplies', color: '#3B82F6', icon: '', created_at: new Date() },
{ id: 'cat2', organization_id: 'org1', name: 'Meals & Entertainment', color: '#EF4444', icon: '', created_at: new Date() },
{ id: 'cat3', organization_id: 'org1', name: 'Software & Tools', color: '#10B981', icon: '', created_at: new Date() },
      { id: 'cat4', organization_id: 'org1', name: 'Travel', color: '#F59E0B', icon: '', created_at: new Date() },
      { id: 'cat5', organization_id: 'org1', name: 'Marketing', color: '#8B5CF6', icon: '', created_at: new Date() }
    ];
  }

  static async updateTransactionCategory(id, organizationId, categoryId) {
    return this.updateTransaction(id, organizationId, { 
      category_id: categoryId,
      status: 'categorized'
    });
  }

  static async bulkUpdateTransactions(ids, organizationId, updates) {
    const updatedTransactions = [];
    for (const id of ids) {
      const updated = await this.updateTransaction(id, organizationId, updates);
      if (updated) {
        updatedTransactions.push(updated);
      }
    }
    return updatedTransactions;
  }

  static getStatusCounts(organizationId) {
    const counts = {
      unmatched: 1,
      categorized: 1,
      approved: 1,
      rejected: 0,
      exported: 0
    };
    return counts;
  }
}

// Simple test route for receipt theme
router.get('/test-receipt', (req, res) => {
  res.send(`
    <html>
    <head><style>body { background: linear-gradient(135deg, #8FA7D9 0%, #7B92C7 50%, #6B82B8 100%); }</style></head>
    <body><h1 style="color: white; text-align: center; font-family: monospace; padding: 50px;">RECEIPT THEME TEST - WORKING!</h1></body>
    </html>
  `);
});

// Receipt theme view
router.get('/', async (req, res) => {
  try {
    const organizationId = 'org1'; // Mock org for now
    const page = parseInt(req.query.page) || 1;
    const search = req.query.search || '';
    const status = req.query.status || '';
    const category = req.query.category || '';

    const filters = { page, limit: 20 };
    if (search) filters.search = search;
    if (status) filters.status = status.split(',');
    if (category) filters.category_id = category.split(',');

    const [result, categories, statusCounts] = await Promise.all([
      TransactionService.getTransactions(organizationId, filters),
      TransactionService.getCategories(organizationId),
      TransactionService.getStatusCounts(organizationId)
    ]);

    // Format amounts for display
    const formattedTransactions = result.transactions.map(t => ({
      ...t,
      formattedAmount: `$${(t.amount / 100).toFixed(2)}`,
      formattedDate: t.date.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric', 
        year: 'numeric' 
      })
    }));

    res.render('inbox/receipt', {
      transactions: formattedTransactions,
      categories,
      statusCounts,
      pagination: {
        current: result.page,
        total: result.totalPages,
        hasNext: result.page < result.totalPages,
        hasPrev: result.page > 1
      },
      filters: { search, status, category },
      title: 'Expense Receipt'
    });
  } catch (error) {
    console.error('Inbox error:', error);
    res.status(500).render('error', { message: 'Failed to load inbox' });
  }
});

// Classic inbox view (backup)
router.get('/classic', async (req, res) => {
  try {
    const organizationId = 'org1'; // Mock org for now
    const page = parseInt(req.query.page) || 1;
    const search = req.query.search || '';
    const status = req.query.status || '';
    const category = req.query.category || '';

    const filters = { page, limit: 20 };
    if (search) filters.search = search;
    if (status) filters.status = status.split(',');
    if (category) filters.category_id = category.split(',');

    const [result, categories, statusCounts] = await Promise.all([
      TransactionService.getTransactions(organizationId, filters),
      TransactionService.getCategories(organizationId),
      TransactionService.getStatusCounts(organizationId)
    ]);

    // Format amounts for display
    const formattedTransactions = result.transactions.map(t => ({
      ...t,
      formattedAmount: `$${(t.amount / 100).toFixed(2)}`,
      formattedDate: t.date.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric', 
        year: 'numeric' 
      })
    }));

    res.render('inbox/index', {
      transactions: formattedTransactions,
      categories,
      statusCounts,
      pagination: {
        current: result.page,
        total: result.totalPages,
        hasNext: result.page < result.totalPages,
        hasPrev: result.page > 1
      },
      filters: { search, status, category },
      title: 'Expense Inbox'
    });
  } catch (error) {
    console.error('Inbox error:', error);
    res.status(500).render('error', { message: 'Failed to load inbox' });
  }
});

// Transaction details (HTMX partial)
router.get('/transaction/:id', async (req, res) => {
  try {
    const organizationId = 'org1';
    const [transaction, categories] = await Promise.all([
      TransactionService.getTransaction(req.params.id, organizationId),
      TransactionService.getCategories(organizationId)
    ]);

    if (!transaction) {
      return res.status(404).send('Transaction not found');
    }

    const formattedTransaction = {
      ...transaction,
      formattedAmount: `$${(transaction.amount / 100).toFixed(2)}`,
      formattedDate: transaction.date.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })
    };

    res.render('partials/transaction-details', {
      transaction: formattedTransaction,
      categories
    });
  } catch (error) {
    console.error('Transaction details error:', error);
    res.status(500).send('Failed to load transaction details');
  }
});

// Update transaction category (HTMX)
router.post('/transaction/:id/category', async (req, res) => {
  try {
    const organizationId = 'org1';
    const { categoryId } = req.body;

    const updatedTransaction = await TransactionService.updateTransactionCategory(
      req.params.id,
      organizationId,
      categoryId
    );

    if (!updatedTransaction) {
      return res.status(404).send('Transaction not found');
    }

    // Return updated transaction row
    const formattedTransaction = {
      ...updatedTransaction,
      formattedAmount: `$${(updatedTransaction.amount / 100).toFixed(2)}`,
      formattedDate: updatedTransaction.date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      })
    };

    const categories = await TransactionService.getCategories(organizationId);
    const category = categories.find(c => c.id === categoryId);

    res.render('partials/transaction-row', {
      transaction: formattedTransaction,
      category
    });
  } catch (error) {
    console.error('Update category error:', error);
    res.status(500).send('Failed to update category');
  }
});

// Live search (HTMX)
router.get('/search', async (req, res) => {
  try {
    const organizationId = 'org1';
    const search = req.query.q || '';
    const status = req.query.status || '';
    const category = req.query.category || '';
    const page = parseInt(req.query.page) || 1;

    const filters = { page, limit: 20, search };
    if (status) filters.status = status.split(',');
    if (category) filters.category_id = category.split(',');

    const [result, categories] = await Promise.all([
      TransactionService.getTransactions(organizationId, filters),
      TransactionService.getCategories(organizationId)
    ]);

    const formattedTransactions = result.transactions.map(t => ({
      ...t,
      formattedAmount: `$${(t.amount / 100).toFixed(2)}`,
      formattedDate: t.date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      })
    }));

    res.render('partials/transaction-list', {
      transactions: formattedTransactions,
      categories
    });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).send('Search failed');
  }
});

// Receipt upload
router.post('/receipt/upload', upload.single('receipt'), async (req, res) => {
  try {
    const { transactionId } = req.body;
    const organizationId = 'org1';

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const receiptUrl = `/uploads/${req.file.filename}`;

    const updatedTransaction = await TransactionService.updateTransaction(
      transactionId,
      organizationId,
      { receipt_url: receiptUrl }
    );

    if (!updatedTransaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    res.json({
      success: true,
      receiptUrl,
      filename: req.file.originalname
    });
  } catch (error) {
    console.error('Receipt upload error:', error);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// Bulk actions
router.post('/bulk-action', async (req, res) => {
  try {
    const organizationId = 'org1';
    const { transactionIds, action, value } = req.body;

    if (!transactionIds || !Array.isArray(transactionIds)) {
      return res.status(400).json({ error: 'Invalid transaction IDs' });
    }

    let updates = {};
    
    switch (action) {
      case 'categorize':
        updates = { category_id: value, status: 'categorized' };
        break;
      case 'approve':
        updates = { status: 'approved' };
        break;
      case 'reject':
        updates = { status: 'rejected' };
        break;
      default:
        return res.status(400).json({ error: 'Invalid action' });
    }

    const updatedTransactions = await TransactionService.bulkUpdateTransactions(
      transactionIds,
      organizationId,
      updates
    );

    res.json({
      success: true,
      updatedCount: updatedTransactions.length
    });
  } catch (error) {
    console.error('Bulk action error:', error);
    res.status(500).json({ error: 'Bulk action failed' });
  }
});

export default router;
