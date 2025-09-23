#!/usr/bin/env node

console.log('🚀 Starting Expense Platform Unified Inbox...\n');

// Import the minimal app
const app = require('./src/app-minimal.js');

console.log('✅ Server is running on http://localhost:3000');
console.log('📧 Access the Unified Inbox at: http://localhost:3000/inbox');
console.log('🔍 Health check at: http://localhost:3000/health');
console.log('\nKeyboard shortcuts:');
console.log('  J/K     - Navigate transactions');
console.log('  E       - Edit selected transaction');
console.log('  R       - Upload receipt');
console.log('  /       - Search transactions');
console.log('  ?       - Show help');
console.log('\nPress Ctrl+C to stop the server.');
