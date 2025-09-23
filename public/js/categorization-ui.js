/**
 * Expense Categorization UI Components
 * JavaScript for interactive expense categorization
 */

class CategorizationUI {
  constructor() {
    this.apiBase = '/api';
    this.categories = [];
    this.uncategorizedTransactions = [];
    this.currentPage = 0;
    this.itemsPerPage = 20;
    
    this.init();
  }

  async init() {
    await this.loadCategories();
    await this.loadUncategorizedTransactions();
    this.bindEventHandlers();
  }

  /**
   * Load all categories for dropdown
   */
  async loadCategories() {
    try {
      const response = await fetch(`${this.apiBase}/categories?include_hierarchy=true`);
      const data = await response.json();
      
      if (data.success) {
        this.categories = data.data;
        this.renderCategoryDropdown();
      }
    } catch (error) {
      console.error('Failed to load categories:', error);
      this.showError('Failed to load categories');
    }
  }

  /**
   * Load uncategorized transactions
   */
  async loadUncategorizedTransactions() {
    try {
      const response = await fetch(
        `${this.apiBase}/transactions/uncategorized?limit=${this.itemsPerPage}&offset=${this.currentPage * this.itemsPerPage}&include_suggestions=true`
      );
      const data = await response.json();
      
      if (data.success) {
        this.uncategorizedTransactions = data.data;
        this.renderTransactionsList();
        this.updatePaginationInfo(data.meta);
      }
    } catch (error) {
      console.error('Failed to load transactions:', error);
      this.showError('Failed to load transactions');
    }
  }

  /**
   * Render category dropdown with hierarchical structure
   */
  renderCategoryDropdown() {
    const dropdowns = document.querySelectorAll('.category-select');
    
    dropdowns.forEach(select => {
      select.innerHTML = '<option value="">Select Category...</option>';
      this.addCategoriesToSelect(select, this.categories, '');
    });
  }

  addCategoriesToSelect(select, categories, prefix) {
    categories.forEach(category => {
      const option = document.createElement('option');
      option.value = category.id;
      option.textContent = prefix + category.name;
      select.appendChild(option);
      
      if (category.children && category.children.length > 0) {
        this.addCategoriesToSelect(select, category.children, prefix + '  ');
      }
    });
  }

  /**
   * Render transactions list with suggestions
   */
  renderTransactionsList() {
    const container = document.getElementById('transactions-list');
    if (!container) return;

    container.innerHTML = '';

    this.uncategorizedTransactions.forEach(transaction => {
      const transactionElement = this.createTransactionElement(transaction);
      container.appendChild(transactionElement);
    });
  }

  createTransactionElement(transaction) {
    const div = document.createElement('div');
    div.className = 'transaction-item border rounded-lg p-4 mb-4 bg-white shadow-sm';
    div.dataset.transactionId = transaction.id;

    const suggestions = transaction.suggestions || [];
    const topSuggestion = suggestions[0];

    div.innerHTML = `
      <div class="flex justify-between items-start mb-3">
        <div class="flex-1">
          <h3 class="font-semibold text-gray-900">
            ${transaction.description || 'Unknown Transaction'}
          </h3>
          <p class="text-sm text-gray-600">
            ${transaction.merchant_name || 'Unknown Merchant'} • 
            ${new Date(transaction.transaction_date).toLocaleDateString()} •
            <span class="font-medium ${transaction.amount < 0 ? 'text-red-600' : 'text-green-600'}">
              $${Math.abs(transaction.amount).toFixed(2)}
            </span>
          </p>
        </div>
        
        ${topSuggestion ? `
          <div class="ml-4 text-right">
            <div class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
              AI Confidence: ${Math.round(topSuggestion.confidence_score * 100)}%
            </div>
          </div>
        ` : ''}
      </div>

      ${suggestions.length > 0 ? `
        <div class="mb-3">
          <h4 class="text-sm font-medium text-gray-700 mb-2">AI Suggestions:</h4>
          <div class="space-y-1">
            ${suggestions.slice(0, 3).map(suggestion => `
              <div class="flex items-center justify-between p-2 bg-gray-50 rounded border">
                <span class="text-sm">${suggestion.category_name}</span>
                <div class="flex items-center space-x-2">
                  <span class="text-xs text-gray-500">${Math.round(suggestion.confidence_score * 100)}%</span>
                  <button 
                    class="accept-suggestion-btn px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
                    data-transaction-id="${transaction.id}"
                    data-category-id="${suggestion.category_id}"
                  >
                    Accept
                  </button>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      <div class="flex items-center space-x-3">
        <select class="category-select flex-1 border border-gray-300 rounded-md px-3 py-2 text-sm">
          <option value="">Select Category...</option>
        </select>
        <button 
          class="categorize-btn px-4 py-2 bg-green-500 text-white text-sm rounded hover:bg-green-600"
          data-transaction-id="${transaction.id}"
        >
          Categorize
        </button>
        <button 
          class="skip-btn px-4 py-2 bg-gray-300 text-gray-700 text-sm rounded hover:bg-gray-400"
          data-transaction-id="${transaction.id}"
        >
          Skip
        </button>
      </div>
    `;

    // Add categories to the select dropdown
    const select = div.querySelector('.category-select');
    this.addCategoriesToSelect(select, this.categories, '');

    return div;
  }

  /**
   * Bind event handlers
   */
  bindEventHandlers() {
    // Accept suggestion buttons
    document.addEventListener('click', async (e) => {
      if (e.target.classList.contains('accept-suggestion-btn')) {
        e.preventDefault();
        const transactionId = e.target.dataset.transactionId;
        const categoryId = e.target.dataset.categoryId;
        await this.categorizeTransaction(transactionId, categoryId);
      }
    });

    // Categorize buttons
    document.addEventListener('click', async (e) => {
      if (e.target.classList.contains('categorize-btn')) {
        e.preventDefault();
        const transactionId = e.target.dataset.transactionId;
        const transactionElement = e.target.closest('.transaction-item');
        const select = transactionElement.querySelector('.category-select');
        const categoryId = select.value;
        
        if (!categoryId) {
          this.showError('Please select a category');
          return;
        }
        
        await this.categorizeTransaction(transactionId, categoryId);
      }
    });

    // Skip buttons
    document.addEventListener('click', (e) => {
      if (e.target.classList.contains('skip-btn')) {
        e.preventDefault();
        const transactionElement = e.target.closest('.transaction-item');
        transactionElement.style.opacity = '0.5';
        transactionElement.style.pointerEvents = 'none';
      }
    });

    // Auto-categorize button
    const autoCategorizeBtn = document.getElementById('auto-categorize-btn');
    if (autoCategorizeBtn) {
      autoCategorizeBtn.addEventListener('click', () => this.showAutoCategorizeModal());
    }

    // Pagination buttons
    const prevBtn = document.getElementById('prev-page-btn');
    const nextBtn = document.getElementById('next-page-btn');
    
    if (prevBtn) {
      prevBtn.addEventListener('click', () => this.previousPage());
    }
    
    if (nextBtn) {
      nextBtn.addEventListener('click', () => this.nextPage());
    }
  }

  /**
   * Categorize a transaction
   */
  async categorizeTransaction(transactionId, categoryId) {
    try {
      const response = await fetch(`${this.apiBase}/transactions/${transactionId}/categorize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          category_id: categoryId,
          apply_rules: true
        })
      });

      const data = await response.json();
      
      if (data.success) {
        // Remove transaction from UI
        const transactionElement = document.querySelector(`[data-transaction-id="${transactionId}"]`);
        if (transactionElement) {
          transactionElement.remove();
        }
        
        this.showSuccess('Transaction categorized successfully');
        
        // Update counters
        this.updateTransactionCount();
      } else {
        this.showError(data.message || 'Failed to categorize transaction');
      }
    } catch (error) {
      console.error('Failed to categorize transaction:', error);
      this.showError('Failed to categorize transaction');
    }
  }

  /**
   * Show auto-categorize modal
   */
  showAutoCategorizeModal() {
    const modal = document.getElementById('auto-categorize-modal');
    if (modal) {
      modal.classList.remove('hidden');
      modal.classList.add('flex');
    }
  }

  /**
   * Execute auto-categorization
   */
  async autoCategorizeAll() {
    const confidenceInput = document.getElementById('confidence-threshold');
    const confidenceThreshold = confidenceInput ? parseFloat(confidenceInput.value) : 0.8;
    const dryRunCheckbox = document.getElementById('dry-run-checkbox');
    const dryRun = dryRunCheckbox ? dryRunCheckbox.checked : true;

    try {
      const response = await fetch(`${this.apiBase}/transactions/auto-categorize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          confidence_threshold: confidenceThreshold,
          dry_run: dryRun
        })
      });

      const data = await response.json();
      
      if (data.success) {
        const message = dryRun 
          ? `Would categorize ${data.data.categorized_count} transactions`
          : `Categorized ${data.data.categorized_count} transactions`;
        
        this.showSuccess(message);
        
        if (!dryRun) {
          await this.loadUncategorizedTransactions();
        }
        
        this.hideModal('auto-categorize-modal');
      } else {
        this.showError(data.message || 'Auto-categorization failed');
      }
    } catch (error) {
      console.error('Auto-categorization failed:', error);
      this.showError('Auto-categorization failed');
    }
  }

  /**
   * Pagination methods
   */
  previousPage() {
    if (this.currentPage > 0) {
      this.currentPage--;
      this.loadUncategorizedTransactions();
    }
  }

  nextPage() {
    this.currentPage++;
    this.loadUncategorizedTransactions();
  }

  updatePaginationInfo(meta) {
    const info = document.getElementById('pagination-info');
    if (info && meta) {
      const start = meta.offset + 1;
      const end = Math.min(meta.offset + meta.limit, meta.total);
      info.textContent = `Showing ${start}-${end} of ${meta.total} transactions`;
    }

    // Update button states
    const prevBtn = document.getElementById('prev-page-btn');
    const nextBtn = document.getElementById('next-page-btn');
    
    if (prevBtn) {
      prevBtn.disabled = this.currentPage === 0;
    }
    
    if (nextBtn && meta) {
      nextBtn.disabled = !meta.has_more;
    }
  }

  /**
   * Utility methods
   */
  updateTransactionCount() {
    const remaining = document.querySelectorAll('.transaction-item').length;
    const counter = document.getElementById('transaction-counter');
    if (counter) {
      counter.textContent = `${remaining} transactions remaining`;
    }
  }

  hideModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    }
  }

  showSuccess(message) {
    this.showNotification(message, 'success');
  }

  showError(message) {
    this.showNotification(message, 'error');
  }

  showNotification(message, type) {
    const notification = document.createElement('div');
    notification.className = `fixed top-4 right-4 px-4 py-2 rounded shadow-lg z-50 ${
      type === 'success' 
        ? 'bg-green-500 text-white' 
        : 'bg-red-500 text-white'
    }`;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
      notification.remove();
    }, 3000);
  }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new CategorizationUI();
});

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CategorizationUI;
}
