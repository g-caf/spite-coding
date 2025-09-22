# Deployment Guide - Render Platform

This guide walks you through deploying the Expense Platform to Render.

## Prerequisites

1. **Render Account**: Sign up at [render.com](https://render.com)
2. **GitHub Repository**: Your code should be in a GitHub repository
3. **Environment Variables**: Review `.env.example` for required variables

## Services Required

The application requires three Render services:

### 1. PostgreSQL Database
- **Type**: PostgreSQL
- **Plan**: Starter (or higher for production)
- **Database Name**: `expense_platform`
- **User**: `expense_user`

### 2. Redis Instance  
- **Type**: Redis
- **Plan**: Starter (or higher for production)
- **Memory Policy**: `allkeys-lru`

### 3. Web Service
- **Type**: Web Service
- **Environment**: Node.js
- **Plan**: Starter (or higher for production)

## Automatic Deployment (Recommended)

### Using render.yaml

1. **Fork/Clone Repository**
   ```bash
   git clone <your-repo-url>
   cd expense-platform
   ```

2. **Push render.yaml to Repository**
   The `render.yaml` file is already configured in this repository.

3. **Deploy via Render Dashboard**
   - Go to [render.com/dashboard](https://render.com/dashboard)
   - Click "New" → "Blueprint"
   - Connect your GitHub repository
   - Select the repository containing `render.yaml`
   - Click "Apply"

4. **Monitor Deployment**
   Render will automatically:
   - Create PostgreSQL database
   - Create Redis instance  
   - Deploy web service
   - Set up environment variables
   - Run health checks

## Manual Deployment

### Step 1: Create Database

1. **Create PostgreSQL Service**
   - Dashboard → "New" → "PostgreSQL"
   - Name: `expense-platform-db`
   - Database: `expense_platform`
   - User: `expense_user`
   - Plan: Starter

2. **Note Connection Details**
   Save the connection string from the database info page.

### Step 2: Create Redis

1. **Create Redis Service**
   - Dashboard → "New" → "Redis"
   - Name: `expense-platform-redis`
   - Plan: Starter
   - Max Memory Policy: `allkeys-lru`

2. **Note Connection URL**
   Save the Redis connection string.

### Step 3: Create Web Service

1. **Create Web Service**
   - Dashboard → "New" → "Web Service"
   - Connect GitHub repository
   - Name: `expense-platform`
   - Environment: Node
   - Region: Choose closest to your users
   - Branch: `main` (or your deployment branch)

2. **Configure Build & Deploy**
   - **Build Command**: `npm ci && npm run build`
   - **Start Command**: `npm start`
   - **Node Version**: 18.x or higher

3. **Environment Variables**
   Set these in the Render dashboard:

   ```bash
   NODE_ENV=production
   DATABASE_URL=<postgresql-connection-string>
   REDIS_URL=<redis-connection-string>
   SESSION_SECRET=<generate-random-32-char-string>
   JWT_SECRET=<generate-random-32-char-string>
   DB_ENCRYPTION_KEY=<generate-random-32-char-string>
   WEBHOOK_SECRET=<generate-random-32-char-string>
   PORT=3000
   ```

4. **Advanced Settings**
   - **Health Check Path**: `/health`
   - **Auto-Deploy**: Enable
   
### Step 4: Configure Domains (Optional)

1. **Custom Domain**
   - Go to service settings
   - Add custom domain
   - Configure DNS records as instructed

## Database Setup

### Initial Migration

After first deployment, run migrations:

1. **Connect to Service Shell**
   ```bash
   # Via Render shell or connect via ssh
   npm run migrate
   ```

2. **Seed Database (Development Only)**
   ```bash
   npm run seed
   ```

### Migration Commands

```bash
# Run migrations
npm run migrate

# Seed database with test data
npm run seed

# Health check
npm run health-check
```

## Environment Variables Reference

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `NODE_ENV` | Environment | `production` |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host:5432/db` |
| `REDIS_URL` | Redis connection string | `redis://user:pass@host:6379` |
| `SESSION_SECRET` | Session signing secret | 32+ character random string |
| `JWT_SECRET` | JWT signing secret | 32+ character random string |
| `DB_ENCRYPTION_KEY` | Database encryption key | 32+ character random string |
| `PORT` | Server port | `3000` |

### Optional Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `LOG_LEVEL` | Logging level | `info` |
| `WEBHOOK_SECRET` | Webhook validation secret | - |
| `SENTRY_DSN` | Error tracking | - |
| `RATE_LIMIT_MAX_REQUESTS` | Rate limit | `100` |

## Health Checks & Monitoring

### Health Check Endpoint
- **URL**: `https://your-app.onrender.com/health`
- **Method**: GET
- **Response**: JSON with service status

### Monitoring Services

The application includes:
- **Health checks**: Built-in `/health` endpoint  
- **Request logging**: Winston-based logging
- **Error tracking**: Ready for Sentry integration
- **Performance metrics**: Basic Express metrics

### Log Access

View logs in Render dashboard:
- Service → Logs tab
- Real-time log streaming
- Historical log search

## Production Optimizations

### Performance
- Gzip compression enabled
- Static file caching (7 days)
- Connection pooling configured
- Memory-efficient session storage

### Security
- Helmet security headers
- CSRF protection
- Rate limiting
- Secure session cookies
- SQL injection prevention

### Scaling Considerations

**Horizontal Scaling**:
- Web service: Scale up plan or add instances
- Database: Upgrade to higher plan
- Redis: Upgrade to higher plan with persistence

**Vertical Scaling**:
- Monitor memory and CPU usage
- Upgrade Render plans as needed
- Optimize database queries

## Troubleshooting

### Common Issues

1. **Build Failures**
   ```bash
   # Check build logs in Render dashboard
   # Verify package.json scripts
   npm run build  # Test locally
   ```

2. **Database Connection Errors**
   - Verify DATABASE_URL environment variable
   - Check database status in Render dashboard
   - Test connection: `npm run health-check`

3. **Redis Connection Errors**
   - Verify REDIS_URL environment variable
   - Check Redis instance status
   - Test Redis connectivity

4. **Health Check Failures**
   - Check `/health` endpoint response
   - Verify all services are running
   - Review application logs

### Debug Commands

```bash
# Check health status
curl https://your-app.onrender.com/health

# Test database connection
npm run health-check

# View detailed logs
# (Available in Render dashboard)
```

### Support Resources

- **Render Docs**: [render.com/docs](https://render.com/docs)
- **Community**: [community.render.com](https://community.render.com)
- **Support**: support@render.com

## Deployment Checklist

- [ ] Repository connected to Render
- [ ] `render.yaml` configuration verified
- [ ] Environment variables configured
- [ ] Database service created and accessible
- [ ] Redis service created and accessible
- [ ] Web service deployed successfully
- [ ] Health checks passing
- [ ] Database migrations run
- [ ] Custom domain configured (if applicable)
- [ ] SSL certificate active
- [ ] Monitoring and alerts set up

## Maintenance

### Regular Tasks

1. **Database Backups**: Automatic with Render PostgreSQL
2. **Log Rotation**: Handled by Render platform
3. **SSL Renewal**: Automatic with Render
4. **Security Updates**: Monitor and update dependencies

### Updates & Deployment

```bash
# Deploy new version
git push origin main  # Auto-deploys if enabled

# Manual deployment trigger
# Use Render dashboard "Manual Deploy" button
```

---

For additional help with deployment issues, contact the development team or refer to the main [README.md](./README.md) file.
