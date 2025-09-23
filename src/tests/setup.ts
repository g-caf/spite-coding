/**
 * Jest Test Setup
 * Global test configuration and mocks
 */

// Mock environment variables
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'sqlite::memory:';
process.env.SESSION_SECRET = 'test-session-secret';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.AWS_ACCESS_KEY_ID = 'test-access-key';
process.env.AWS_SECRET_ACCESS_KEY = 'test-secret-key';
process.env.S3_BUCKET_NAME = 'test-bucket';
process.env.AWS_REGION = 'us-east-1';

// Global test timeout
jest.setTimeout(30000);

// Mock Winston logger to avoid console spam during tests
jest.mock('winston', () => {
  const mFormat = {
    combine: jest.fn(),
    timestamp: jest.fn(),
    json: jest.fn(),
    colorize: jest.fn(),
    simple: jest.fn(),
    errors: jest.fn()
  };

  return {
    format: mFormat,
    createLogger: jest.fn().mockReturnValue({
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn()
    }),
    transports: {
      Console: jest.fn(),
      File: jest.fn()
    }
  };
});

// Mock AWS SDK clients
jest.mock('@aws-sdk/client-textract', () => ({
  TextractClient: jest.fn().mockImplementation(() => ({
    send: jest.fn()
  })),
  AnalyzeExpenseCommand: jest.fn(),
  AnalyzeDocumentCommand: jest.fn(),
  StartDocumentAnalysisCommand: jest.fn(),
  GetDocumentAnalysisCommand: jest.fn()
}));

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({
    send: jest.fn()
  })),
  PutObjectCommand: jest.fn(),
  GetObjectCommand: jest.fn(),
  DeleteObjectCommand: jest.fn(),
  HeadObjectCommand: jest.fn()
}));

jest.mock('@aws-sdk/client-ses', () => ({
  SESClient: jest.fn().mockImplementation(() => ({
    send: jest.fn()
  })),
  SendEmailCommand: jest.fn(),
  SendRawEmailCommand: jest.fn()
}));

// Mock Sharp for image processing
jest.mock('sharp', () => {
  const sharp = jest.fn().mockReturnValue({
    resize: jest.fn().mockReturnThis(),
    jpeg: jest.fn().mockReturnThis(),
    png: jest.fn().mockReturnThis(),
    webp: jest.fn().mockReturnThis(),
    grayscale: jest.fn().mockReturnThis(),
    normalize: jest.fn().mockReturnThis(),
    sharpen: jest.fn().mockReturnThis(),
    withMetadata: jest.fn().mockReturnThis(),
    greyscale: jest.fn().mockReturnThis(),
    raw: jest.fn().mockReturnThis(),
    toBuffer: jest.fn().mockResolvedValue(Buffer.from('test')),
    toFile: jest.fn().mockResolvedValue({}),
    metadata: jest.fn().mockResolvedValue({
      width: 800,
      height: 600,
      format: 'jpeg',
      channels: 3,
      space: 'srgb'
    }),
    stats: jest.fn().mockResolvedValue({
      channels: [{
        min: 0,
        max: 255,
        sum: 12750,
        squaresSum: 3187500,
        mean: 127.5,
        stdev: 73.9,
        minX: 0,
        minY: 0,
        maxX: 99,
        maxY: 99
      }]
    })
  });

  return sharp;
});

// Mock file system operations
jest.mock('fs/promises', () => ({
  mkdir: jest.fn().mockResolvedValue(undefined),
  writeFile: jest.fn().mockResolvedValue(undefined),
  readFile: jest.fn().mockResolvedValue(Buffer.from('test')),
  unlink: jest.fn().mockResolvedValue(undefined),
  stat: jest.fn().mockResolvedValue({
    size: 1024,
    mtime: new Date()
  }),
  readdir: jest.fn().mockResolvedValue([]),
  copyFile: jest.fn().mockResolvedValue(undefined)
}));

// Mock nodemailer
jest.mock('nodemailer', () => ({
  createTransporter: jest.fn().mockReturnValue({
    sendMail: jest.fn().mockResolvedValue({
      messageId: 'test-message-id'
    })
  })
}));

// Global test utilities
global.testUtils = {
  createMockFile: (name: string, type: string, size: number) => ({
    fieldname: 'file',
    originalname: name,
    encoding: '7bit',
    mimetype: type,
    size,
    buffer: Buffer.alloc(size),
    destination: '/tmp',
    filename: name,
    path: `/tmp/${name}`,
    stream: {} as any,
    hash: 'test-hash-' + Math.random().toString(36).substring(7)
  }),

  createMockUser: (overrides: any = {}) => ({
    id: 'test-user-id',
    organizationId: 'test-org-id',
    email: 'test@example.com',
    name: 'Test User',
    permissions: {
      receipts: ['create', 'read', 'update', 'delete'],
      transactions: ['read']
    },
    ...overrides
  }),

  sleep: (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
};

// Extend Jest matchers
declare global {
  namespace jest {
    interface Matchers<R> {
      toBeValidUUID(): R;
      toBeValidDate(): R;
      toBePositiveNumber(): R;
    }
  }

  var testUtils: {
    createMockFile: (name: string, type: string, size: number) => any;
    createMockUser: (overrides?: any) => any;
    sleep: (ms: number) => Promise<void>;
  };
}

// Custom Jest matchers
expect.extend({
  toBeValidUUID(received: any) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const pass = typeof received === 'string' && uuidRegex.test(received);
    
    return {
      message: () => `expected ${received} to be a valid UUID`,
      pass
    };
  },

  toBeValidDate(received: any) {
    const pass = received instanceof Date && !isNaN(received.getTime());
    
    return {
      message: () => `expected ${received} to be a valid Date`,
      pass
    };
  },

  toBePositiveNumber(received: any) {
    const pass = typeof received === 'number' && received > 0;
    
    return {
      message: () => `expected ${received} to be a positive number`,
      pass
    };
  }
});