// Inbox functionality and keyboard shortcuts
class InboxManager {
    constructor() {
        this.selectedTransactions = new Set();
        this.currentTransactionIndex = -1;
        this.transactionRows = [];
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.setupDragDrop();
        this.setupKeyboardNavigation();
        this.updateTransactionRows();
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

        // Transaction row clicks
        document.addEventListener('click', (e) => {
            const row = e.target.closest('.transaction-row');
            if (row && !e.target.classList.contains('transaction-checkbox')) {
                this.selectTransaction(row);
            }
        });

        // HTMX events
        document.addEventListener('htmx:afterSwap', (e) => {
            if (e.target.id === 'transaction-list') {
                this.updateTransactionRows();
            }
            if (e.target.id === 'transaction-details-content') {
                this.showTransactionDetails();
            }
        });
    }

    setupDragDrop() {
        const dropZone = document.getElementById('drop-zone');
        const fileInput = document.getElementById('receipt-file');

        if (dropZone && fileInput) {
            // Click to select file
            dropZone.addEventListener('click', () => fileInput.click());

            // Drag and drop events
            dropZone.addEventListener('dragover', (e) => {
                e.preventDefault();
                dropZone.classList.add('border-blue-400', 'bg-blue-50');
            });

            dropZone.addEventListener('dragleave', (e) => {
                e.preventDefault();
                dropZone.classList.remove('border-blue-400', 'bg-blue-50');
            });

            dropZone.addEventListener('drop', (e) => {
                e.preventDefault();
                dropZone.classList.remove('border-blue-400', 'bg-blue-50');
                
                const files = e.dataTransfer.files;
                if (files.length > 0) {
                    fileInput.files = files;
                    this.handleFileSelect(files[0]);
                }
            });

            // File input change
            fileInput.addEventListener('change', (e) => {
                if (e.target.files.length > 0) {
                    this.handleFileSelect(e.target.files[0]);
                }
            });
        }

        // Receipt form submission
        const receiptForm = document.getElementById('receipt-form');
        if (receiptForm) {
            receiptForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.uploadReceipt();
            });
        }
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
                        const row = this.transactionRows[this.currentTransactionIndex];
                        const transactionId = row.dataset.transactionId;
                        this.openReceiptModal(transactionId);
                    }
                    break;
                case 'enter':
                    if (this.currentTransactionIndex >= 0) {
                        e.preventDefault();
                        const row = this.transactionRows[this.currentTransactionIndex];
                        row.click();
                    }
                    break;
                case ' ':
                    if (this.currentTransactionIndex >= 0) {
                        e.preventDefault();
                        const row = this.transactionRows[this.currentTransactionIndex];
                        const checkbox = row.querySelector('.transaction-checkbox');
                        if (checkbox) {
                            checkbox.checked = !checkbox.checked;
                            checkbox.dispatchEvent(new Event('change'));
                        }
                    }
                    break;
            }
        });
    }

    updateTransactionRows() {
        this.transactionRows = Array.from(document.querySelectorAll('.transaction-row'));
        this.updateSelectedCount();
    }

    navigateTransactions(direction) {
        if (this.transactionRows.length === 0) return;

        // Remove current highlight
        if (this.currentTransactionIndex >= 0) {
            this.transactionRows[this.currentTransactionIndex].classList.remove('bg-blue-50', 'ring-2', 'ring-blue-500');
        }

        // Update index
        this.currentTransactionIndex += direction;
        if (this.currentTransactionIndex < 0) {
            this.currentTransactionIndex = this.transactionRows.length - 1;
        } else if (this.currentTransactionIndex >= this.transactionRows.length) {
            this.currentTransactionIndex = 0;
        }

        // Highlight new row
        const currentRow = this.transactionRows[this.currentTransactionIndex];
        currentRow.classList.add('bg-blue-50', 'ring-2', 'ring-blue-500');
        currentRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    selectTransaction(row) {
        const index = this.transactionRows.indexOf(row);
        if (index >= 0) {
            // Remove old highlight
            if (this.currentTransactionIndex >= 0) {
                this.transactionRows[this.currentTransactionIndex].classList.remove('bg-blue-50', 'ring-2', 'ring-blue-500');
            }
            
            // Set new selection
            this.currentTransactionIndex = index;
            row.classList.add('bg-blue-50', 'ring-2', 'ring-blue-500');
        }
    }

    editCurrentTransaction() {
        if (this.currentTransactionIndex >= 0) {
            const row = this.transactionRows[this.currentTransactionIndex];
            const transactionId = row.dataset.transactionId;
            // Trigger HTMX request to load transaction details
            htmx.ajax('GET', `/inbox/transaction/${transactionId}`, '#transaction-details-content');
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
    }

    updateSelectedCount() {
        const count = this.selectedTransactions.size;
        const bulkActions = document.getElementById('bulk-actions');
        const bulkPlaceholder = document.getElementById('bulk-actions-placeholder');
        const selectedCountEl = document.getElementById('selected-count');

        if (selectedCountEl) {
            selectedCountEl.textContent = count;
        }

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

    showTransactionDetails() {
        const detailsPanel = document.getElementById('transaction-details');
        if (detailsPanel) {
            detailsPanel.classList.remove('hidden');
        }
    }

    handleFileSelect(file) {
        const preview = document.getElementById('file-preview');
        const fileName = document.getElementById('file-name');
        const uploadBtn = document.getElementById('upload-btn');

        if (preview && fileName && uploadBtn) {
            fileName.textContent = file.name;
            preview.classList.remove('hidden');
            uploadBtn.disabled = false;
        }
    }

    async uploadReceipt() {
        const form = document.getElementById('receipt-form');
        const progressBar = document.getElementById('upload-progress');
        const uploadBtn = document.getElementById('upload-btn');

        if (!form) return;

        const formData = new FormData(form);
        progressBar?.classList.remove('hidden');
        uploadBtn.disabled = true;
        uploadBtn.textContent = 'Uploading...';

        try {
            const response = await fetch('/inbox/receipt/upload', {
                method: 'POST',
                body: formData
            });

            const result = await response.json();

            if (result.success) {
                // Update UI to show receipt uploaded
                this.showNotification('Receipt uploaded successfully', 'success');
                this.closeReceiptModal();
                
                // Refresh transaction details if open
                const detailsContent = document.getElementById('transaction-details-content');
                if (detailsContent && detailsContent.innerHTML.trim()) {
                    const transactionId = document.getElementById('receipt-transaction-id').value;
                    htmx.ajax('GET', `/inbox/transaction/${transactionId}`, '#transaction-details-content');
                }
            } else {
                this.showNotification(result.error || 'Upload failed', 'error');
            }
        } catch (error) {
            console.error('Upload error:', error);
            this.showNotification('Upload failed', 'error');
        } finally {
            progressBar?.classList.add('hidden');
            uploadBtn.disabled = false;
            uploadBtn.textContent = 'Upload Receipt';
        }
    }

    openReceiptModal(transactionId) {
        const modal = document.getElementById('receipt-modal');
        const transactionIdInput = document.getElementById('receipt-transaction-id');
        
        if (modal && transactionIdInput) {
            transactionIdInput.value = transactionId;
            modal.classList.remove('hidden');
            
            // Clear previous file selection
            this.clearFile();
        }
    }

    closeReceiptModal() {
        const modal = document.getElementById('receipt-modal');
        if (modal) {
            modal.classList.add('hidden');
            this.clearFile();
        }
    }

    clearFile() {
        const fileInput = document.getElementById('receipt-file');
        const preview = document.getElementById('file-preview');
        const uploadBtn = document.getElementById('upload-btn');

        if (fileInput) fileInput.value = '';
        if (preview) preview.classList.add('hidden');
        if (uploadBtn) uploadBtn.disabled = true;
    }

    showNotification(message, type = 'info') {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `fixed top-4 right-4 z-50 p-4 rounded-lg shadow-lg max-w-sm transition-all duration-300 ${
            type === 'success' ? 'bg-green-100 text-green-800 border border-green-200' :
            type === 'error' ? 'bg-red-100 text-red-800 border border-red-200' :
            'bg-blue-100 text-blue-800 border border-blue-200'
        }`;
        
        notification.innerHTML = `
            <div class="flex items-center">
                <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'} mr-2"></i>
                <span class="flex-1">${message}</span>
                <button onclick="this.parentElement.parentElement.remove()" class="ml-2 text-gray-400 hover:text-gray-600">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `;

        document.body.appendChild(notification);

        // Auto-remove after 5 seconds
        setTimeout(() => {
            notification.remove();
        }, 5000);
    }
}

// Bulk actions
async function applyBulkAction(action) {
    const inboxManager = window.inboxManager;
    if (!inboxManager || inboxManager.selectedTransactions.size === 0) {
        return;
    }

    const transactionIds = Array.from(inboxManager.selectedTransactions);
    let value = null;

    if (action === 'categorize') {
        const categorySelect = document.getElementById('bulk-category');
        value = categorySelect?.value;
        if (!value) {
            inboxManager.showNotification('Please select a category', 'error');
            return;
        }
    }

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
            inboxManager.showNotification(`${result.updatedCount} transactions updated`, 'success');
            
            // Refresh the transaction list
            htmx.ajax('GET', '/inbox/search', {
                target: '#transaction-list',
                values: {
                    q: document.getElementById('search-input')?.value || '',
                    status: Array.from(document.querySelectorAll('[name="status"]:checked')).map(cb => cb.value).join(','),
                    category: Array.from(document.querySelectorAll('[name="category"]:checked')).map(cb => cb.value).join(',')
                }
            });
            
            // Clear selections
            inboxManager.selectedTransactions.clear();
            inboxManager.updateSelectedCount();
            
        } else {
            inboxManager.showNotification(result.error || 'Bulk action failed', 'error');
        }
    } catch (error) {
        console.error('Bulk action error:', error);
        inboxManager.showNotification('Bulk action failed', 'error');
    }
}

// Global functions for modal management
function openReceiptModal(transactionId) {
    window.inboxManager?.openReceiptModal(transactionId);
}

function closeReceiptModal() {
    window.inboxManager?.closeReceiptModal();
}

function clearFile() {
    window.inboxManager?.clearFile();
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.inboxManager = new InboxManager();
});
