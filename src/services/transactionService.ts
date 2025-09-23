import { Transaction, TransactionFilter, TransactionStatus, Category, Receipt } from '../models/expense/transaction.js';

// Mock data for now - replace with actual database queries
const mockTransactions: Transaction[] = [
  {
    id: '1',
    organization_id: 'org1',
    user_id: 'user1',
    amount: 2500,
    description: 'Office Supplies - Staples',
    date: new Date('2024-01-15'),
    category_id: 'cat1',
    status: TransactionStatus.UNMATCHED,
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
    status: TransactionStatus.CATEGORIZED,
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
    status: TransactionStatus.APPROVED,
    receipt_url: '/uploads/receipt-3.pdf',
    merchant: 'Adobe',
    payment_method: 'ACH',
    created_at: new Date('2024-01-13'),
    updated_at: new Date('2024-01-13')
  }
];

const mockCategories: Category[] = [
  { id: 'cat1', organization_id: 'org1', name: 'Office Supplies', color: '#3B82F6', icon: '📝', created_at: new Date() },
  { id: 'cat2', organization_id: 'org1', name: 'Meals & Entertainment', color: '#EF4444', icon: '🍽️', created_at: new Date() },
  { id: 'cat3', organization_id: 'org1', name: 'Software & Tools', color: '#10B981', icon: '💻', created_at: new Date() },
  { id: 'cat4', organization_id: 'org1', name: 'Travel', color: '#F59E0B', icon: '✈️', created_at: new Date() },
  { id: 'cat5', organization_id: 'org1', name: 'Marketing', color: '#8B5CF6', icon: '📢', created_at: new Date() }
];

export class TransactionService {
  static async getTransactions(organizationId: string, filters: TransactionFilter = {}): Promise<{
    transactions: Transaction[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    let filtered = mockTransactions.filter(t => t.organization_id === organizationId);

    // Apply filters
    if (filters.search) {
      const search = filters.search.toLowerCase();
      filtered = filtered.filter(t => 
        t.description.toLowerCase().includes(search) ||
        t.merchant?.toLowerCase().includes(search)
      );
    }

    if (filters.status && filters.status.length > 0) {
      filtered = filtered.filter(t => filters.status!.includes(t.status));
    }

    if (filters.category_id && filters.category_id.length > 0) {
      filtered = filtered.filter(t => t.category_id && filters.category_id!.includes(t.category_id));
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

  static async getTransaction(id: string, organizationId: string): Promise<Transaction | null> {
    return mockTransactions.find(t => t.id === id && t.organization_id === organizationId) || null;
  }

  static async updateTransaction(id: string, organizationId: string, updates: Partial<Transaction>): Promise<Transaction | null> {
    const index = mockTransactions.findIndex(t => t.id === id && t.organization_id === organizationId);
    if (index === -1) return null;

    mockTransactions[index] = {
      ...mockTransactions[index],
      ...updates,
      updated_at: new Date()
    };

    return mockTransactions[index];
  }

  static async getCategories(organizationId: string): Promise<Category[]> {
    return mockCategories.filter(c => c.organization_id === organizationId);
  }

  static async updateTransactionCategory(id: string, organizationId: string, categoryId: string): Promise<Transaction | null> {
    return this.updateTransaction(id, organizationId, { 
      category_id: categoryId,
      status: TransactionStatus.CATEGORIZED
    });
  }

  static async bulkUpdateTransactions(ids: string[], organizationId: string, updates: Partial<Transaction>): Promise<Transaction[]> {
    const updatedTransactions: Transaction[] = [];
    
    for (const id of ids) {
      const updated = await this.updateTransaction(id, organizationId, updates);
      if (updated) {
        updatedTransactions.push(updated);
      }
    }

    return updatedTransactions;
  }

  static getStatusCounts(organizationId: string): Record<string, number> {
    const transactions = mockTransactions.filter(t => t.organization_id === organizationId);
    const counts: Record<string, number> = {};

    for (const status of Object.values(TransactionStatus)) {
      counts[status] = transactions.filter(t => t.status === status).length;
    }

    return counts;
  }
}
