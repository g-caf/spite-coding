// Enhanced Inbox Manager for Wireframe UI
class WireframeInboxManager {
    constructor() {
        this.selectedTransactions = new Set();
        this.currentTransactionIndex = -1;
        this.transactionCards = [];
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.setupDragDrop();
        this.setupKeyboardNavigation();
        this.updateTransactionCards();
    }

    setupEventListeners() {
        // Select all checkbox
        const selectAll = document.getElementById('select-all');
        if (selectAll) {
            selectAll.addEventListener('change', (e) => {
                this.toggleSelectAll(e.target.checked);
            });
        }

        // Individual transaction checkboxes
        document.addEventListener('change', (e) => {
            if (e.target.classList.contains('transaction-checkbox')) {
                this.toggleTransaction(e.target.dataset.transactionId, e.target.checked);
            }
        });

        // HTMX events for smooth transitions
        document.addEventListener('htmx:beforeRequest', (e) => {
            this.showLoadingState(e.target);
        });

        document.addEventListener('htmx:afterRequest', (e) => {
            this.hideLoadingState(e.target);
        });

        document.addEventListener('htmx:afterSwap', (e) => {
            if (e.target.id === 'transaction-list') {
                this.updateTransactionCards();
                this.updateBulkActions();
            }
            if (e.target.id === 'transaction-details-content') {
                this.showTransactionDetails();
            }
        });

        // Close details when clicking outside
        document.addEventListener('click', (e) => {
            const detailsPanel = document.getElementById('transaction-details');
            if (!detailsPanel?.classList.contains('hidden') && 
                !detailsPanel.contains(e.target) && 
                !e.target.closest('.transaction-card') &&
                !e.target.closest('button')) {
                this.hideTransactionDetails();
            }
        });

        // Smooth scroll behavior for better UX
        document.documentElement.style.scrollBehavior = 'smooth';
    }

    setupDragDrop() {
        // Drag and drop now handled inline at each transaction level
        // No central modal drag zone needed
    }

    setupKeyboardNavigation() {
        document.addEventListener('keydown', (e) => {
            // Skip if user is typing in an input field
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
                return;
            }

            switch (e.key.toLowerCase()) {
                case 'j':
                    e.preventDefault();
                    this.navigateTransactions(1);
                    break;
                case 'k':
                    e.preventDefault();
                    this.navigateTransactions(-1);
                    break;
                case 'e':
                    e.preventDefault();
                    if (this.currentTransactionIndex >= 0) {
                        this.editCurrentTransaction();
                    }
                    break;
                case 'r':
                    e.preventDefault();
                    if (this.currentTransactionIndex >= 0) {
                        const card = this.transactionCards[this.currentTransactionIndex];
                        // Receipt upload now handled inline - no modal needed
                        return;
                    }
                    break;
                case 'enter':
                    if (this.currentTransactionIndex >= 0) {
                        e.preventDefault();
                        const card = this.transactionCards[this.currentTransactionIndex];
                        this.selectTransactionCard(card);
                    }
                    break;
                case ' ':
                    if (this.currentTransactionIndex >= 0) {
                        e.preventDefault();
                        const card = this.transactionCards[this.currentTransactionIndex];
                        const checkbox = card.querySelector('.transaction-checkbox');
                        if (checkbox) {
                            checkbox.checked = !checkbox.checked;
                            checkbox.dispatchEvent(new Event('change'));
                        }
                    }
                    break;
                case 'c':
                    if (this.currentTransactionIndex >= 0) {
                        e.preventDefault();
                        // Quick categorize shortcut
                        this.showQuickCategorize();
                    }
                    break;
                case 'a':
                    if (this.currentTransactionIndex >= 0) {
                        e.preventDefault();
                        // Quick approve shortcut
                        this.quickApprove();
                    }
                    break;
            }
        });
    }

    updateTransactionCards() {
        this.transactionCards = Array.from(document.querySelectorAll('.transaction-card'));
        this.updateSelectedCount();
        
        // Add enhanced hover effects
        this.transactionCards.forEach(card => {
            card.addEventListener('mouseenter', () => {
                if (!card.classList.contains('selected')) {
                    card.style.transform = 'translateY(-1px)';
                    card.style.boxShadow = 'var(--shadow-sm)';
                }
            });
            
            card.addEventListener('mouseleave', () => {
                if (!card.classList.contains('selected')) {
                    card.style.transform = 'translateY(0)';
                    card.style.boxShadow = 'none';
                }
            });
        });
    }

    navigateTransactions(direction) {
        if (this.transactionCards.length === 0) return;

        // Remove current selection
        if (this.currentTransactionIndex >= 0) {
            this.transactionCards[this.currentTransactionIndex].classList.remove('selected');
        }

        // Update index with wrapping
        this.currentTransactionIndex += direction;
        if (this.currentTransactionIndex < 0) {
            this.currentTransactionIndex = this.transactionCards.length - 1;
        } else if (this.currentTransactionIndex >= this.transactionCards.length) {
            this.currentTransactionIndex = 0;
        }

        // Highlight new card with smooth animation
        const currentCard = this.transactionCards[this.currentTransactionIndex];
        currentCard.classList.add('selected');
        currentCard.scrollIntoView({ 
            behavior: 'smooth', 
            block: 'center',
            inline: 'nearest'
        });
        
        // Load transaction details
        this.loadTransactionDetails(currentCard.dataset.transactionId);
    }

    selectTransactionCard(card) {
        const index = this.transactionCards.indexOf(card);
        if (index >= 0) {
            // Remove old selection
            this.transactionCards.forEach(c => c.classList.remove('selected'));
            
            // Set new selection
            this.currentTransactionIndex = index;
            card.classList.add('selected');
            
            // Load details
            this.loadTransactionDetails(card.dataset.transactionId);
        }
    }

    loadTransactionDetails(transactionId) {
        // Trigger HTMX request to load transaction details
        htmx.ajax('GET', `/inbox/transaction/${transactionId}`, {
            target: '#transaction-details-content',
            swap: 'innerHTML'
        });
    }

    showTransactionDetails() {
        const detailsPanel = document.getElementById('transaction-details');
        if (detailsPanel) {
            detailsPanel.classList.remove('hidden');
            detailsPanel.classList.add('animate-slide-in-right');
            
            // Remove animation class after animation completes
            setTimeout(() => {
                detailsPanel.classList.remove('animate-slide-in-right');
            }, 300);
        }
    }

    hideTransactionDetails() {
        const detailsPanel = document.getElementById('transaction-details');
        if (detailsPanel && !detailsPanel.classList.contains('hidden')) {
            detailsPanel.classList.add('animate-slide-out-right');
            
            setTimeout(() => {
                detailsPanel.classList.add('hidden');
                detailsPanel.classList.remove('animate-slide-out-right');
            }, 300);
            
            // Remove selection from all cards
            this.transactionCards.forEach(card => card.classList.remove('selected'));
            this.currentTransactionIndex = -1;
        }
    }

    toggleSelectAll(checked) {
        const checkboxes = document.querySelectorAll('.transaction-checkbox');
        checkboxes.forEach(checkbox => {
            checkbox.checked = checked;
            this.toggleTransaction(checkbox.dataset.transactionId, checked);
        });
    }

    toggleTransaction(transactionId, selected) {
        if (selected) {
            this.selectedTransactions.add(transactionId);
        } else {
            this.selectedTransactions.delete(transactionId);
        }
        this.updateSelectedCount();
        this.updateSelectAllState();
        this.updateBulkActions();
    }

    updateSelectedCount() {
        const count = this.selectedTransactions.size;
        const selectedCountEl = document.getElementById('selected-count');
        if (selectedCountEl) {
            selectedCountEl.textContent = count;
        }
    }

    updateBulkActions() {
        const count = this.selectedTransactions.size;
        const bulkActions = document.getElementById('bulk-actions');
        const bulkPlaceholder = document.getElementById('bulk-actions-placeholder');

        if (count > 0) {
            bulkActions?.classList.remove('hidden');
            bulkPlaceholder?.classList.add('hidden');
        } else {
            bulkActions?.classList.add('hidden');
            bulkPlaceholder?.classList.remove('hidden');
        }
    }

    updateSelectAllState() {
        const selectAll = document.getElementById('select-all');
        const checkboxes = document.querySelectorAll('.transaction-checkbox');
        const checkedCount = document.querySelectorAll('.transaction-checkbox:checked').length;

        if (selectAll) {
            selectAll.indeterminate = checkedCount > 0 && checkedCount < checkboxes.length;
            selectAll.checked = checkedCount === checkboxes.length && checkboxes.length > 0;
        }
    }

    showLoadingState(element) {
        const btn = element.closest('button');
        if (btn && !btn.classList.contains('loading')) {
            btn.classList.add('loading');
            btn.style.position = 'relative';
            btn.disabled = true;
        }
    }

    hideLoadingState(element) {
        const btn = element.closest('button');
        if (btn) {
            btn.classList.remove('loading');
            btn.disabled = false;
        }
    }

    handleFileSelect(file) {
        const preview = document.getElementById('file-preview');
        const fileName = document.getElementById('file-name');
        const uploadBtn = document.getElementById('upload-btn');

        if (preview && fileName && uploadBtn) {
            fileName.textContent = file.name;
            preview.classList.remove('hidden');
            preview.classList.add('animate-fade-in');
            uploadBtn.disabled = false;
        }
    }

    // uploadReceipt function removed - now using inline upload functionality



    showQuickCategorize() {
        if (this.currentTransactionIndex >= 0) {
            const card = this.transactionCards[this.currentTransactionIndex];
            const transactionId = card.dataset.transactionId;
            this.loadTransactionDetails(transactionId);
            
            // Focus on category dropdown in details panel
            setTimeout(() => {
                const categorySelect = document.querySelector('#transaction-details select[name="categoryId"]');
                categorySelect?.focus();
            }, 300);
        }
    }

    quickApprove() {
        if (this.currentTransactionIndex >= 0) {
            const card = this.transactionCards[this.currentTransactionIndex];
            const transactionId = card.dataset.transactionId;
            
            htmx.ajax('POST', `/inbox/transaction/${transactionId}/approve`, {
                target: `[data-transaction-id="${transactionId}"]`,
                swap: 'outerHTML'
            });
            
            this.showNotification('Transaction approved', 'success');
        }
    }

    showNotification(message, type = 'info') {
        // Remove existing notifications
        document.querySelectorAll('.notification').forEach(n => n.remove());
        
        // Create notification element with enhanced styling
        const notification = document.createElement('div');
        notification.className = `notification fixed top-4 right-4 z-50 p-4 rounded-lg max-w-sm transition-all duration-300 animate-slide-in-right`;
        
        const styles = {
            success: 'background-color: var(--color-green-light); color: var(--color-green); border: var(--border-width) solid var(--color-green);',
            error: 'background-color: var(--color-red-light); color: var(--color-red); border: var(--border-width) solid var(--color-red);',
            info: 'background-color: var(--color-gray-50); color: var(--color-gray-700); border: var(--border-width) solid var(--border-color);'
        };
        
        notification.style.cssText = styles[type] || styles.info;
        notification.style.boxShadow = 'var(--shadow-lg)';
        
        const icons = {
            success: 'check-circle',
            error: 'exclamation-circle',
            info: 'info-circle'
        };
        
        notification.innerHTML = `
            <div style="display: flex; align-items: center; gap: var(--space-3);">
                <i class="fas fa-${icons[type] || icons.info}" style="font-size: var(--text-lg);"></i>
                <span style="flex: 1; font-weight: var(--font-medium);">${message}</span>
                <button onclick="this.parentElement.parentElement.remove()" 
                        style="color: var(--color-gray-400); padding: var(--space-1); border-radius: var(--border-radius-sm); transition: all var(--transition-fast);"
                        onmouseover="this.style.backgroundColor = 'var(--color-gray-200)'"
                        onmouseout="this.style.backgroundColor = 'transparent'">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `;

        document.body.appendChild(notification);

        // Auto-remove after 4 seconds
        setTimeout(() => {
            notification.classList.add('animate-slide-out-right');
            setTimeout(() => notification.remove(), 300);
        }, 4000);
    }
}

// Enhanced bulk actions with better UX
async function applyBulkAction(action) {
    const inboxManager = window.inboxManager;
    if (!inboxManager || inboxManager.selectedTransactions.size === 0) {
        inboxManager?.showNotification('No transactions selected', 'error');
        return;
    }

    const transactionIds = Array.from(inboxManager.selectedTransactions);
    let value = null;

    if (action === 'categorize') {
        const categorySelect = document.getElementById('bulk-category');
        value = categorySelect?.value;
        if (!value) {
            inboxManager.showNotification('Please select a category first', 'error');
            categorySelect?.focus();
            return;
        }
    }

    // Show loading state
    const actionButtons = document.querySelectorAll('#bulk-actions button');
    actionButtons.forEach(btn => {
        btn.disabled = true;
        btn.classList.add('loading');
    });

    try {
        const response = await fetch('/inbox/bulk-action', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                transactionIds,
                action,
                value
            })
        });

        const result = await response.json();

        if (result.success) {
            const actionText = {
                categorize: 'categorized',
                approve: 'approved',
                reject: 'rejected'
            }[action] || 'updated';
            
            inboxManager.showNotification(
                `${result.updatedCount} transactions ${actionText}`, 
                'success'
            );
            
            // Refresh the transaction list with current filters
            const searchParams = new URLSearchParams();
            searchParams.set('search', document.getElementById('search-input')?.value || '');
            
            // Add status filters
            document.querySelectorAll('[name="status"]:checked').forEach(cb => {
                searchParams.append('status', cb.value);
            });
            
            // Add category filters
            document.querySelectorAll('[name="category"]:checked').forEach(cb => {
                searchParams.append('category', cb.value);
            });
            
            htmx.ajax('GET', `/inbox/search?${searchParams.toString()}`, {
                target: '#transaction-list',
                swap: 'innerHTML'
            });
            
            // Clear selections
            inboxManager.selectedTransactions.clear();
            inboxManager.updateSelectedCount();
            inboxManager.updateBulkActions();
            
            // Reset category selector
            if (action === 'categorize') {
                document.getElementById('bulk-category').value = '';
            }
            
        } else {
            inboxManager.showNotification(result.error || 'Bulk action failed', 'error');
        }
    } catch (error) {
        console.error('Bulk action error:', error);
        inboxManager.showNotification('Connection error. Please try again.', 'error');
    } finally {
        // Remove loading state
        actionButtons.forEach(btn => {
            btn.disabled = false;
            btn.classList.remove('loading');
        });
    }
}



function showTransactionDetails(transactionId) {
    const card = document.querySelector(`[data-transaction-id="${transactionId}"]`);
    if (card) {
        window.inboxManager?.selectTransactionCard(card);
    }
}

function hideTransactionDetails() {
    window.inboxManager?.hideTransactionDetails();
}

// Enhanced search functionality
function setupEnhancedSearch() {
    const searchInput = document.getElementById('search-input');
    const globalSearch = document.getElementById('global-search');
    
    [searchInput, globalSearch].forEach(input => {
        if (input) {
            input.addEventListener('focus', function() {
                this.style.transform = 'scale(1.02)';
                this.style.boxShadow = 'var(--shadow)';
            });
            
            input.addEventListener('blur', function() {
                this.style.transform = 'scale(1)';
                this.style.boxShadow = 'none';
            });
        }
    });
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.inboxManager = new WireframeInboxManager();
    setupEnhancedSearch();
    
    // Add global fade-in animation
    document.body.classList.add('animate-fade-in');
    
    // Enhanced focus management
    document.addEventListener('focusin', (e) => {
        if (e.target.matches('input, select, textarea, button')) {
            e.target.style.outline = '2px solid var(--color-accent)';
            e.target.style.outlineOffset = '2px';
        }
    });
    
    document.addEventListener('focusout', (e) => {
        if (e.target.matches('input, select, textarea, button')) {
            e.target.style.outline = 'none';
        }
    });
    
    console.log('Wireframe Expense Platform loaded successfully!');
});

// Performance optimization: debounce resize events
let resizeTimeout;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        // Recalculate layout if needed
        window.inboxManager?.updateTransactionCards();
    }, 250);
});