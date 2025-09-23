# Multi-stage Dockerfile for production optimized builds
FROM node:20-alpine AS builder

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies (including devDependencies for build)
RUN npm ci

# Copy source code
COPY src/ ./src/
COPY config/ ./config/
COPY views/ ./views/
COPY public/ ./public/
COPY database/ ./database/
COPY knexfile.js ./

# Build the application
RUN npm run build

# Production stage
FROM node:20-alpine AS production

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create app directory and user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nextjs -u 1001

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --omit=dev && npm cache clean --force

# Copy built application from builder stage
COPY --from=builder --chown=nextjs:nodejs /app/dist ./dist
COPY --from=builder --chown=nextjs:nodejs /app/database ./database
COPY --from=builder --chown=nextjs:nodejs /app/knexfile.js ./
COPY --from=builder --chown=nextjs:nodejs /app/views ./views
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Create logs directory
RUN mkdir -p logs && chown nextjs:nodejs logs

# Switch to non-root user
USER nextjs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -r ts-node/register/transpile-only -r tsconfig-paths/register src/scripts/health-check.ts || exit 1

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the application
CMD ["npm", "start"]
