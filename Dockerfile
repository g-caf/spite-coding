FROM node:20-alpine

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create app directory and user
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001
WORKDIR /app

# Copy package files and tsconfig
COPY package*.json ./
COPY tsconfig.json ./

# Install only production dependencies (includes ts-node and tsconfig-paths)
RUN npm ci --omit=dev && npm cache clean --force

# Copy application sources and assets
COPY --chown=nextjs:nodejs src ./src
COPY --chown=nextjs:nodejs config ./config
COPY --chown=nextjs:nodejs views ./views
COPY --chown=nextjs:nodejs public ./public
COPY --chown=nextjs:nodejs database ./database
COPY --chown=nextjs:nodejs knexfile.js ./

# Create logs directory
RUN mkdir -p logs && chown -R nextjs:nodejs /app

# Switch to non-root user
USER nextjs

# Expose port
EXPOSE 3000

# Health check using ts-node at runtime
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -r ts-node/register/transpile-only -r tsconfig-paths/register src/scripts/health-check.ts || exit 1

# Use dumb-init
ENTRYPOINT ["dumb-init", "--"]

# Start the application
CMD ["npm", "start"]
