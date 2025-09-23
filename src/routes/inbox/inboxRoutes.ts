import express from 'express';
import multer from 'multer';
import path from 'path';
import { TransactionService } from '../../services/transactionService.js';
import { TransactionStatus } from '../../models/expense/transaction.js';

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

// Main inbox view
router.get('/', async (req, res) => {
  try {
    const organizationId = 'org1'; // Mock org for now
    const page = parseInt(req.query.page as string) || 1;
    const search = req.query.search as string || '';
    const status = req.query.status as string || '';
    const category = req.query.category as string || '';

    const filters: any = { page, limit: 20 };
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
    const search = req.query.q as string || '';
    const status = req.query.status as string || '';
    const category = req.query.category as string || '';
    const page = parseInt(req.query.page as string) || 1;

    const filters: any = { page, limit: 20, search };
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

    let updates: any = {};
    
    switch (action) {
      case 'categorize':
        updates = { category_id: value, status: TransactionStatus.CATEGORIZED };
        break;
      case 'approve':
        updates = { status: TransactionStatus.APPROVED };
        break;
      case 'reject':
        updates = { status: TransactionStatus.REJECTED };
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
