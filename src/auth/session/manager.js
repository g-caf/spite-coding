const session = require('express-session');
const RedisStore = require('connect-redis').default;
const { createClient } = require('redis');
const authConfig = require('../../../config/auth');
const { logAuditEvent } = require('../utils/audit');

class SessionManager {
  constructor() {
    this.redisClient = null;
    this.store = null;
  }

  async initialize() {
    try {
      // Create Redis client
      this.redisClient = createClient({
        socket: {
          host: authConfig.redis.host,
          port: authConfig.redis.port,
        },
        password: authConfig.redis.password,
        database: authConfig.redis.db,
      });

      // Handle Redis connection events
      this.redisClient.on('error', (err) => {
        console.error('Redis Client Error', err);
      });

      this.redisClient.on('connect', () => {
        console.log('Redis Client Connected');
      });

      this.redisClient.on('ready', () => {
        console.log('Redis Client Ready');
      });

      // Connect to Redis
      await this.redisClient.connect();

      // Create Redis store
      this.store = new RedisStore({
        client: this.redisClient,
        prefix: authConfig.redis.keyPrefix + 'sess:',
        ttl: authConfig.redis.ttl,
      });

      console.log('Session Manager initialized successfully');
    } catch (error) {
      console.error('Failed to initialize Session Manager:', error);
      throw error;
    }
  }

  getSessionMiddleware() {
    if (!this.store) {
      throw new Error('Session store not initialized. Call initialize() first.');
    }

    return session({
      store: this.store,
      secret: authConfig.session.secret,
      name: authConfig.session.name,
      resave: authConfig.session.resave,
      saveUninitialized: authConfig.session.saveUninitialized,
      cookie: authConfig.session.cookie,
      rolling: true, // Reset expiration on activity
    });
  }

  async createSession(req, user) {
    return new Promise((resolve, reject) => {
      req.session.user = {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        organizationId: user.organizationId,
        roles: user.roles,
        permissions: user.permissions,
        mfaEnabled: user.mfaEnabled,
        lastLoginAt: new Date(),
      };

      req.session.save((err) => {
        if (err) {
          reject(err);
        } else {
          resolve(req.session.id);
        }
      });
    });
  }

  async destroySession(req, res) {
    const sessionId = req.session.id;
    const userId = req.session.user?.id;

    return new Promise((resolve, reject) => {
      req.session.destroy((err) => {
        if (err) {
          reject(err);
        } else {
          // Clear session cookie
          res.clearCookie(authConfig.session.name);
          
          // Log logout event
          if (userId) {
            logAuditEvent({
              event: 'logout',
              userId,
              sessionId,
              ipAddress: req.ip,
              userAgent: req.get('User-Agent'),
              success: true,
            }).catch(console.error);
          }

          resolve();
        }
      });
    });
  }

  async getUserSessions(userId) {
    try {
      const pattern = `${authConfig.redis.keyPrefix}sess:*`;
      const keys = await this.redisClient.keys(pattern);
      const sessions = [];

      for (const key of keys) {
        const sessionData = await this.redisClient.get(key);
        if (sessionData) {
          const parsed = JSON.parse(sessionData);
          if (parsed.user && parsed.user.id === userId) {
            sessions.push({
              sessionId: key.replace(`${authConfig.redis.keyPrefix}sess:`, ''),
              lastAccess: new Date(parsed.cookie.expires),
              ipAddress: parsed.ipAddress,
              userAgent: parsed.userAgent,
            });
          }
        }
      }

      return sessions;
    } catch (error) {
      console.error('Error fetching user sessions:', error);
      return [];
    }
  }

  async revokeUserSessions(userId, excludeSessionId = null) {
    try {
      const pattern = `${authConfig.redis.keyPrefix}sess:*`;
      const keys = await this.redisClient.keys(pattern);
      let revokedCount = 0;

      for (const key of keys) {
        const sessionId = key.replace(`${authConfig.redis.keyPrefix}sess:`, '');
        
        if (excludeSessionId && sessionId === excludeSessionId) {
          continue;
        }

        const sessionData = await this.redisClient.get(key);
        if (sessionData) {
          const parsed = JSON.parse(sessionData);
          if (parsed.user && parsed.user.id === userId) {
            await this.redisClient.del(key);
            revokedCount++;
          }
        }
      }

      // Log session revocation
      await logAuditEvent({
        event: 'sessions_revoked',
        userId,
        sessionsRevoked: revokedCount,
        success: true,
      });

      return revokedCount;
    } catch (error) {
      console.error('Error revoking user sessions:', error);
      return 0;
    }
  }

  async cleanupExpiredSessions() {
    try {
      const pattern = `${authConfig.redis.keyPrefix}sess:*`;
      const keys = await this.redisClient.keys(pattern);
      let cleanedCount = 0;

      for (const key of keys) {
        const ttl = await this.redisClient.ttl(key);
        if (ttl === -2) { // Key doesn't exist (expired)
          cleanedCount++;
        }
      }

      console.log(`Cleaned up ${cleanedCount} expired sessions`);
      return cleanedCount;
    } catch (error) {
      console.error('Error cleaning up expired sessions:', error);
      return 0;
    }
  }

  async updateSessionActivity(req) {
    if (req.session && req.session.user) {
      req.session.user.lastActivity = new Date();
      req.session.ipAddress = req.ip;
      req.session.userAgent = req.get('User-Agent');
      
      return new Promise((resolve, reject) => {
        req.session.save((err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
    }
  }

  async getSessionStats() {
    try {
      const pattern = `${authConfig.redis.keyPrefix}sess:*`;
      const keys = await this.redisClient.keys(pattern);
      
      return {
        totalSessions: keys.length,
        activeUsers: new Set(),
        sessionsByOrg: {},
      };
    } catch (error) {
      console.error('Error getting session stats:', error);
      return { totalSessions: 0, activeUsers: new Set(), sessionsByOrg: {} };
    }
  }

  async close() {
    if (this.redisClient) {
      await this.redisClient.disconnect();
    }
  }
}

module.exports = new SessionManager();