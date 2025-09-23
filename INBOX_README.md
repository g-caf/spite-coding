# Unified Inbox - Expense Platform

## Overview

This is the **core unified inbox system** that replaces Airbase's scattered module approach. It provides ONE centralized view for all expense management tasks instead of jumping between multiple interfaces.

## Key Features

### 🎯 **Unified Workflow**
- **Single view** for all transactions (no more "million views" problem)
- Real-time status tracking (Unmatched → Categorized → Approved → Exported)
- Seamless receipt attachment and categorization
- Bulk actions for efficiency

### ⚡ **Technology Stack**
- **Server-rendered EJS templates** (no React complexity)
- **HTMX for dynamic interactions** (no JavaScript framework overhead)
- **Tailwind CSS** for clean, professional styling
- **Express.js** backend with modern middleware

### 🎮 **Keyboard-First Design**
- `J/K` - Navigate transactions (Gmail-style)
- `E` - Edit selected transaction
- `R` - Upload receipt to selected transaction
- `/` - Focus search box
- `Space` - Select/deselect transaction
- `Enter` - Open transaction details
- `?` - Show keyboard shortcuts help
- `Escape` - Close panels/modals

### 📱 **Responsive Design**
- Mobile-first approach
- Touch-friendly interface
- Accessible components (ARIA compliance)
- Progressive enhancement

## Quick Start

1. **Start the server:**
   ```bash
   node start-inbox.js
   ```

2. **Access the inbox:**
   - Open http://localhost:3000/inbox
   - The root URL (/) automatically redirects to the inbox

3. **Test features:**
   - Filter transactions by status/category
   - Search across descriptions and merchants
   - Upload receipts via drag & drop
   - Use keyboard shortcuts for navigation
   - Try bulk actions on multiple transactions

## Architecture

### Three-Panel Layout
```
┌─────────────┬───────────────────┬─────────────┐
│   Filters   │   Transaction     │  Details    │
│   Search    │      List         │   Panel     │
│   Actions   │                   │             │
│             │                   │             │
│   Status    │   • Unmatched     │  Receipt    │
│   ○ All     │   • Categorized   │  Category   │
│   ● Active  │   • Approved      │  Notes      │
│             │   • Exported      │  Actions    │
│             │                   │             │
│   Category  │   [Pagination]    │             │
│   □ Office  │                   │             │
│   ☑ Meals   │                   │             │
│   □ Travel  │                   │             │
│             │                   │             │
│   Bulk      │                   │             │
│   Actions   │                   │             │
└─────────────┴───────────────────┴─────────────┘
```

### Component Structure
- **Left Sidebar:** Filters, search, bulk actions
- **Center Panel:** Transaction list with infinite scroll
- **Right Panel:** Transaction details, receipt viewer, editing

### HTMX Integration
- Live search without page reloads
- Dynamic filtering and sorting
- Modal dialogs for receipt upload
- Real-time status updates
- Progressive enhancement (works without JavaScript)

## File Structure

```
expense-platform/
├── src/
│   ├── app-minimal.js              # Minimal Express app
│   └── routes/inbox/
│       └── inboxRoutes.js          # All inbox-related routes
├── views/
│   ├── layout.ejs                  # Main layout template
│   ├── inbox/
│   │   └── index.ejs              # Main inbox view
│   ├── partials/
│   │   ├── transaction-list.ejs    # Transaction list component
│   │   ├── transaction-details.ejs # Transaction details panel
│   │   └── transaction-row.ejs     # Single transaction row
│   └── error.ejs                   # Error page
├── public/
│   ├── js/inbox.js                 # Client-side interactions
│   ├── css/inbox.css              # Custom styles
│   └── uploads/                    # Receipt uploads
└── start-inbox.js                  # Startup script
```

## API Endpoints

### Main Routes
- `GET /inbox` - Main inbox interface
- `GET /inbox/transaction/:id` - Transaction details (HTMX partial)
- `POST /inbox/transaction/:id/category` - Update category (HTMX)
- `GET /inbox/search` - Live search (HTMX)
- `POST /inbox/receipt/upload` - Receipt upload with drag-drop
- `POST /inbox/bulk-action` - Bulk operations

### Data Flow
1. **Page Load:** Server renders full inbox with initial data
2. **Interactions:** HTMX sends requests for dynamic updates
3. **Search/Filter:** Real-time results without page refresh
4. **Receipt Upload:** Drag & drop with progress indication
5. **Bulk Actions:** Multi-select with confirmation

## Transaction Statuses

1. **Unmatched** 🔴 - Needs categorization and receipt
2. **Categorized** 🟡 - Has category, awaiting approval
3. **Approved** 🟢 - Ready for export
4. **Rejected** ⚪ - Declined transaction
5. **Exported** 🔵 - Sent to accounting system

## Mock Data

The system currently uses mock data that includes:
- Sample transactions from various merchants
- Multiple expense categories with icons
- Different transaction statuses
- Sample receipt attachments

## Next Steps

To extend this system:

1. **Database Integration:** Replace mock data with PostgreSQL queries
2. **Authentication:** Add user sessions and organization isolation  
3. **Real Receipts:** Implement OCR processing for receipt data extraction
4. **Export Integration:** Connect to QuickBooks, Xero, or other accounting systems
5. **Advanced Features:** Add approval workflows, spending analytics, and reporting

## Why This Approach Works

### vs. Airbase's "Million Views" Problem
- **Single source of truth:** All expense data in one interface
- **Context switching:** No jumping between modules
- **Cognitive load:** Reduced complexity, familiar patterns

### vs. React SPAs
- **Server-side rendering:** Better SEO, faster initial load
- **Progressive enhancement:** Works without JavaScript
- **Simpler deployment:** No build process, easier debugging

### vs. Complex Workflows
- **Linear process:** Clear path from transaction to approval
- **Keyboard efficiency:** Power users can work at speed
- **Visual clarity:** Status is always visible, no hidden state

This unified inbox design solves the core UX problem that makes users frustrated with existing expense platforms: **too many clicks, too many views, too much context switching.**
