const express = require('express');
const cors = require('cors');
require('dotenv').config();

// Import authentication system
const { authSystem } = require('./auth');
const { PERMISSIONS } = require('./auth/rbac/permissions');

// Import middleware
const AuthenticationMiddleware = require('./auth/middleware/authentication');
const AuthorizationMiddleware = require('./auth/middleware/authorization');

const app = express();
const PORT = process.env.PORT || 3000;

// Basic middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// CORS configuration
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000', 'http://localhost:3001'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Requested-With'],
}));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
  });
});

// Initialize authentication system
async function initializeAuth() {
  try {
    await authSystem.initialize(app);
    console.log('✅ Authentication system initialized');
  } catch (error) {
    console.error('❌ Failed to initialize authentication system:', error);
    process.exit(1);
  }
}

// Example protected routes demonstrating the auth system
function setupExampleRoutes() {
  // Public route (no authentication required)
  app.get('/api/public', (req, res) => {
    res.json({ message: 'This is a public endpoint' });
  });

  // Protected route requiring authentication
  app.get('/api/protected', 
    AuthenticationMiddleware.requireAuth(),
    (req, res) => {
      res.json({ 
        message: 'This is a protected endpoint', 
        user: req.user 
      });
    }
  );

  // Admin-only route
  app.get('/api/admin',
    AuthenticationMiddleware.requireAuth(),
    AuthorizationMiddleware.requireRole('SYSTEM_ADMIN'),
    (req, res) => {
      res.json({ message: 'Admin access granted' });
    }
  );

  // Route requiring specific permission
  app.get('/api/expenses',
    AuthenticationMiddleware.requireAuth(),
    AuthorizationMiddleware.requirePermission(PERMISSIONS.EXPENSE_READ),
    AuthorizationMiddleware.requireOrganizationScope(),
    (req, res) => {
      res.json({ 
        message: 'Expenses data',
        organizationScope: req.organizationScope,
        userPermissions: req.user.expandedPermissions,
      });
    }
  );

  // Route requiring MFA
  app.get('/api/sensitive',
    AuthenticationMiddleware.requireAuth(),
    AuthenticationMiddleware.requireMFA(),
    AuthorizationMiddleware.requirePermission(PERMISSIONS.ADMIN_AUDIT_LOGS),
    (req, res) => {
      res.json({ message: 'Sensitive data requiring MFA' });
    }
  );

  // Route with resource-based access control
  app.get('/api/expenses/:id',
    AuthenticationMiddleware.requireAuth(),
    AuthorizationMiddleware.requireResourceAccess('expense', 'read'),
    (req, res) => {
      res.json({ 
        message: 'Expense details',
        expense: req.resource,
        userCan: {
          edit: AuthorizationMiddleware.canPerformAction(req, 'expense', 'update'),
          delete: AuthorizationMiddleware.canPerformAction(req, 'expense', 'delete'),
          approve: AuthorizationMiddleware.canPerformAction(req, 'expense', 'approve'),
        }
      });
    }
  );

  // Multiple permission example (any of these permissions)
  app.get('/api/reports',
    AuthenticationMiddleware.requireAuth(),
    AuthorizationMiddleware.requireAnyPermission([
      PERMISSIONS.REPORT_READ,
      PERMISSIONS.EXPENSE_READ,
    ]),
    (req, res) => {
      res.json({ message: 'Reports data' });
    }
  );

  // Multiple role example
  app.get('/api/management',
    AuthenticationMiddleware.requireAuth(),
    AuthorizationMiddleware.requireAnyRole(['MANAGER', 'TEAM_LEAD', 'ORG_ADMIN']),
    (req, res) => {
      res.json({ message: 'Management dashboard data' });
    }
  );

  // Dynamic permission check
  app.get('/api/dynamic/:resourceType/:action',
    AuthenticationMiddleware.requireAuth(),
    AuthorizationMiddleware.checkResourcePermission(
      req => req.params.resourceType,
      req => req.params.action
    ),
    (req, res) => {
      res.json({ 
        message: `Access granted to ${req.params.resourceType}:${req.params.action}` 
      });
    }
  );

  console.log('✅ Example routes configured');
}

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Application Error:', error);
  
  if (error.code === 'EBADCSRFTOKEN') {
    return res.status(403).json({
      error: 'CSRF token validation failed',
      code: 'CSRF_VALIDATION_FAILED',
    });
  }

  res.status(500).json({
    error: 'Internal server error',
    code: 'INTERNAL_ERROR',
    ...(process.env.NODE_ENV === 'development' && { stack: error.stack }),
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
    code: 'NOT_FOUND',
    path: req.path,
  });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');
  await authSystem.shutdown();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully');
  await authSystem.shutdown();
  process.exit(0);
});

// Start server
async function startServer() {
  try {
    // Initialize authentication system
    await initializeAuth();
    
    // Setup example routes
    setupExampleRoutes();
    
    // Start listening
    app.listen(PORT, () => {
      console.log(`🚀 Expense Platform Server running on port ${PORT}`);
      console.log(`📋 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🔐 Authentication system: Active`);
      console.log(`📊 Health check: http://localhost:${PORT}/health`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server
startServer();

module.exports = app;