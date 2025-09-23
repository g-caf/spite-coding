/**
 * Integration test starter - simplified version for testing unified app
 * without requiring full database setup
 */

const express = require('express');
const path = require('path');

// Create a minimal Express app for testing
const app = express();

// Basic middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files
app.use('/static', express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Set up view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Mock database for testing
const mockDb = {
  raw: () => Promise.resolve([{ '?column?': 1 }]),
  transaction: (fn) => fn(mockDb),
  from: () => ({ where: () => ({ first: () => null, select: () => [] }) })
};

// Add mock services to request
app.use((req, res, next) => {
  req.db = mockDb;
  req.logger = console;
  next();
});

// Test routes
app.get('/', (req, res) => {
  res.json({ 
    status: 'Integration Test Server Running',
    message: 'This is a simplified version for testing unified integration',
    availableRoutes: [
      '/',
      '/health',
      '/test-inbox',
      '/api/test'
    ]
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0-integration-test',
    database: 'mock',
    services: 'mock'
  });
});

// Test inbox route
app.get('/test-inbox', (req, res) => {
  res.json({
    message: 'Inbox integration working',
    features: [
      'Receipt upload',
      'Transaction matching',
      'Category management',
      'Policy enforcement'
    ]
  });
});

// API test endpoint
app.get('/api/test', (req, res) => {
  res.json({
    message: 'API integration working',
    endpoints: {
      plaid: '/api/plaid/*',
      receipts: '/api/receipts/*',
      matching: '/api/matching/*',
      categories: '/api/categories/*',
      rules: '/api/rules/*',
      policies: '/api/policies/*'
    }
  });
});

// Error handling
app.use((error, req, res, next) => {
  console.error('Error:', error.message);
  res.status(500).json({
    error: 'Internal server error',
    message: error.message
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Not found',
    path: req.originalUrl,
    message: 'This is the integration test server'
  });
});

// Start server
const PORT = process.env.PORT || 3002; // Different port to avoid conflicts
app.listen(PORT, () => {
  console.log(`\n🚀 Integration Test Server running on port ${PORT}`);
  console.log('📋 Available endpoints:');
  console.log(`   GET  http://localhost:${PORT}/`);
  console.log(`   GET  http://localhost:${PORT}/health`);
  console.log(`   GET  http://localhost:${PORT}/test-inbox`);
  console.log(`   GET  http://localhost:${PORT}/api/test`);
  console.log('\n✨ Integration test environment ready!');
  console.log('💡 This is a simplified version for testing the unified integration');
});
