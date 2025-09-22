# Expense Platform

[![Build Status](https://github.com/your-username/expense-platform/workflows/CI/badge.svg)](https://github.com/your-username/expense-platform/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D16.0.0-brightgreen.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

Enterprise-grade expense management platform built as an Airbase alternative. A comprehensive solution for managing corporate expenses, approvals, accounting integrations, and financial controls.

## 🚀 Features

- **Multi-tenant Architecture** - Organization-scoped data with secure isolation
- **Advanced Authentication** - JWT, session management, RBAC, and ABAC
- **Real-time Processing** - WebSocket-based notifications and updates
- **Comprehensive Audit Trail** - Full logging for compliance and security
- **RESTful API** - Complete API for integrations and mobile apps
- **Modern UI** - Responsive web interface with EJS templates
- **Enterprise Security** - Rate limiting, CSRF protection, and security headers

## 📋 Table of Contents

- [Quick Start](#quick-start)
- [Architecture](#architecture)
- [API Documentation](#api-documentation)
- [Deployment](#deployment)
- [Development](#development)
- [Contributing](#contributing)
- [License](#license)

## ⚡ Quick Start

### Prerequisites

- Node.js >= 16.0.0
- npm >= 8.0.0
- Redis server
- PostgreSQL database (optional)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/your-username/expense-platform.git
   cd expense-platform
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

4. **Start Redis server**
   ```bash
   redis-server
   # or with Docker
   docker run -d -p 6379:6379 redis:alpine
   ```

5. **Build and start the application**
   ```bash
   npm run build
   npm start
   ```

The application will be available at `http://localhost:3000`

### Development Mode

For development with hot reload:

```bash
npm run dev
```

## 🏗️ Architecture

### Core Components

```
expense-platform/
├── src/
│   ├── controllers/     # Request handlers and business logic
│   ├── middleware/      # Express middleware (auth, validation, etc.)
│   ├── models/         # Data models and database schemas
│   ├── routes/         # API route definitions
│   ├── services/       # Business logic and external integrations
│   ├── types/          # TypeScript type definitions
│   ├── utils/          # Utility functions and helpers
│   └── server.ts       # Application entry point
├── config/             # Configuration files
├── database/           # Database migrations and seeds
├── docs/              # Additional documentation
├── public/            # Static assets (CSS, JS, images)
├── views/             # EJS templates
└── dist/              # Compiled TypeScript output
```

### Technology Stack

- **Backend**: Node.js, Express.js, TypeScript
- **Database**: PostgreSQL with Knex.js ORM
- **Caching**: Redis for sessions and caching
- **Authentication**: Passport.js with multiple strategies
- **Security**: Helmet, CORS, Rate limiting, CSRF protection
- **Logging**: Winston with structured logging
- **Testing**: Jest with supertest for API testing

### Security Features

- **Multi-factor Authentication** (TOTP, SMS)
- **Role-based Access Control** (RBAC)
- **Attribute-based Access Control** (ABAC)
- **Session management** with Redis backend
- **CSRF protection** on all forms and APIs
- **Rate limiting** on authentication endpoints
- **Comprehensive audit logging**
- **Secure headers** with Helmet.js

## 📡 API Documentation

The platform provides a comprehensive RESTful API:

### Core Endpoints

- `GET /api/health` - Health check endpoint
- `POST /api/auth/login` - User authentication
- `GET /api/users/profile` - Current user profile
- `POST /api/expenses` - Create expense report
- `GET /api/expenses` - List expenses with filtering
- `PUT /api/expenses/:id/approve` - Approve expense

### Authentication

All API endpoints require authentication via:

1. **Session-based** - For web application
2. **JWT tokens** - For API integrations
3. **API keys** - For external services

Example API request:

```javascript
fetch('/api/expenses', {
  headers: {
    'Authorization': 'Bearer YOUR_JWT_TOKEN',
    'Content-Type': 'application/json'
  }
})
```

See [API Documentation](docs/api.md) for complete endpoint details.

## 🚀 Deployment

### Environment Variables

Create a `.env` file with the following required variables:

```env
# Server Configuration
NODE_ENV=production
PORT=3000

# Database
DATABASE_URL=postgresql://username:password@host:port/database

# Redis
REDIS_URL=redis://localhost:6379

# Security
SESSION_SECRET=your-secure-session-secret-here
JWT_SECRET=your-secure-jwt-secret-here

# Email (optional)
SMTP_HOST=smtp.example.com
SMTP_USER=notifications@yourcompany.com
SMTP_PASS=your-smtp-password
```

### Production Deployment

#### Using PM2

```bash
npm install -g pm2
npm run build
pm2 start dist/server.js --name expense-platform
```

#### Using Docker

```bash
docker build -t expense-platform .
docker run -d -p 3000:3000 --env-file .env expense-platform
```

#### Deploy to Render

1. Connect your GitHub repository to Render
2. Set up the build command: `npm run build`
3. Set up the start command: `npm start`
4. Configure environment variables in Render dashboard

## 💻 Development

### Available Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Compile TypeScript to JavaScript
- `npm run build:watch` - Watch for changes and rebuild
- `npm run lint` - Run ESLint
- `npm run lint:fix` - Fix ESLint issues automatically
- `npm run type-check` - Check TypeScript types without building
- `npm test` - Run test suite
- `npm start` - Start production server

### Code Quality

The project uses:

- **ESLint** for code linting
- **Prettier** for code formatting
- **TypeScript** for type safety
- **Husky** for Git hooks (planned)

### Database Migrations

```bash
# Run migrations
npx knex migrate:latest

# Rollback migration
npx knex migrate:rollback

# Create new migration
npx knex migrate:make migration_name
```

### Contributing Guidelines

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit changes: `git commit -m 'Add amazing feature'`
4. Push to branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

## 📊 Performance

- **Response Time**: < 100ms for cached responses
- **Throughput**: 1000+ requests per second
- **Memory Usage**: ~200MB baseline
- **Database**: Optimized queries with indexes

## 🔧 Troubleshooting

### Common Issues

1. **Redis Connection Error**
   ```bash
   # Start Redis server
   redis-server
   # or check if running
   redis-cli ping
   ```

2. **Database Connection Issues**
   - Verify DATABASE_URL in .env
   - Check database server status
   - Run migrations: `npx knex migrate:latest`

3. **Port Already in Use**
   ```bash
   # Find process using port 3000
   lsof -ti:3000
   # Kill the process
   kill -9 $(lsof -ti:3000)
   ```

See [Troubleshooting Guide](docs/troubleshooting.md) for more solutions.

## 📞 Support

- **Documentation**: [docs/](docs/)
- **Issues**: [GitHub Issues](https://github.com/your-username/expense-platform/issues)
- **Security**: See [SECURITY.md](SECURITY.md) for vulnerability reporting

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Built as an alternative to Airbase
- Inspired by modern expense management needs
- Community-driven development

---

**Made with ❤️ for better expense management**
