/**
 * File Upload Middleware with S3 Integration
 * Handles receipt file uploads with validation and cloud storage
 */

import multer from 'multer';
import multerS3 from 'multer-s3';
import { S3Client } from '@aws-sdk/client-s3';
import { Request } from 'express';
import crypto from 'crypto';
import path from 'path';
import mime from 'mime-types';
import sharp from 'sharp';

// Configure S3 client
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

// File type validation
const allowedMimeTypes = [
  'image/jpeg',
  'image/png', 
  'image/gif',
  'image/webp',
  'application/pdf',
  'image/tiff',
  'image/bmp'
];

const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf', '.tiff', '.tif', '.bmp'];

// File size limits (10MB for images, 50MB for PDFs)
const getMaxFileSize = (mimetype: string): number => {
  if (mimetype === 'application/pdf') return 50 * 1024 * 1024; // 50MB
  return 10 * 1024 * 1024; // 10MB for images
};

// Generate secure filename
const generateFileName = (originalname: string): string => {
  const timestamp = Date.now();
  const randomBytes = crypto.randomBytes(16).toString('hex');
  const extension = path.extname(originalname).toLowerCase();
  return `${timestamp}_${randomBytes}${extension}`;
};

// Generate S3 key path
const generateS3Key = (organizationId: string, filename: string): string => {
  const year = new Date().getFullYear();
  const month = String(new Date().getMonth() + 1).padStart(2, '0');
  const day = String(new Date().getDate()).padStart(2, '0');
  return `receipts/${organizationId}/${year}/${month}/${day}/${filename}`;
};

// File filter with comprehensive validation
const fileFilter = (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  // Check MIME type
  if (!allowedMimeTypes.includes(file.mimetype)) {
    return cb(new Error(`Invalid file type: ${file.mimetype}. Allowed types: ${allowedMimeTypes.join(', ')}`));
  }

  // Check file extension
  const extension = path.extname(file.originalname).toLowerCase();
  if (!allowedExtensions.includes(extension)) {
    return cb(new Error(`Invalid file extension: ${extension}. Allowed extensions: ${allowedExtensions.join(', ')}`));
  }

  // Additional security check: verify MIME type matches extension
  const expectedMime = mime.lookup(file.originalname);
  if (expectedMime && expectedMime !== file.mimetype) {
    return cb(new Error('File extension does not match MIME type'));
  }

  cb(null, true);
};

// S3 upload configuration
const s3Upload = multerS3({
  s3: s3Client,
  bucket: process.env.S3_BUCKET_NAME!,
  acl: 'private', // Files are private by default
  contentType: multerS3.AUTO_CONTENT_TYPE,
  metadata: (req, file, cb) => {
    cb(null, {
      uploadedBy: (req as any).user?.id || 'anonymous',
      organizationId: (req as any).user?.organizationId || 'unknown',
      originalName: file.originalname,
      uploadedAt: new Date().toISOString(),
    });
  },
  key: (req, file, cb) => {
    const organizationId = (req as any).user?.organizationId || 'unknown';
    const filename = generateFileName(file.originalname);
    const s3Key = generateS3Key(organizationId, filename);
    cb(null, s3Key);
  },
});

// Local storage fallback (development)
const localStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const organizationId = (req as any).user?.organizationId || 'unknown';
    const year = new Date().getFullYear();
    const month = String(new Date().getMonth() + 1).padStart(2, '0');
    const uploadDir = path.join(process.cwd(), 'uploads', 'receipts', organizationId, String(year), month);
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const filename = generateFileName(file.originalname);
    cb(null, filename);
  },
});

// Dynamic file size limit based on file type
const limits = {
  fileSize: (req: Request, file: Express.Multer.File): number => {
    return getMaxFileSize(file.mimetype);
  },
  files: 10, // Maximum 10 files per request
};

// Main upload configuration
const uploadConfig = {
  storage: process.env.NODE_ENV === 'production' ? s3Upload : localStorage,
  fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB maximum (will be checked per-file)
    files: 10,
  },
};

// Create multer instance
export const upload = multer(uploadConfig);

// Middleware for single file upload
export const uploadSingle = upload.single('receipt');

// Middleware for multiple file upload
export const uploadMultiple = upload.array('receipts', 10);

// Middleware for email attachment processing
export const uploadEmailAttachments = upload.array('attachments', 20);

// File processing middleware (thumbnail generation, virus scanning)
export const processUploadedFiles = async (req: Request, res: any, next: any) => {
  try {
    if (!req.files && !req.file) {
      return next();
    }

    const files = req.files ? (Array.isArray(req.files) ? req.files : [req.file]) : [req.file];
    
    for (const file of files) {
      if (!file) continue;

      // Generate thumbnail for images
      if (file.mimetype.startsWith('image/')) {
        await generateThumbnail(file);
      }

      // Calculate file hash for deduplication
      (file as any).hash = await calculateFileHash(file);

      // Virus scanning placeholder (integrate with ClamAV or similar)
      const scanResult = await performVirusScan(file);
      if (!scanResult.clean) {
        throw new Error(`Virus detected in file: ${file.originalname}`);
      }
    }

    next();
  } catch (error) {
    next(error);
  }
};

// Generate thumbnail for images
async function generateThumbnail(file: Express.Multer.File): Promise<void> {
  try {
    if (process.env.NODE_ENV === 'production') {
      // For S3, generate thumbnail and upload separately
      const thumbnailKey = (file as any).key?.replace(/(\.[^.]+)$/, '_thumb$1');
      // Implementation would involve downloading, processing, and re-uploading
      // This is a placeholder for the full implementation
    } else {
      // For local storage, generate thumbnail file
      const thumbnailPath = file.path.replace(/(\.[^.]+)$/, '_thumb$1');
      await sharp(file.path)
        .resize(200, 200, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toFile(thumbnailPath);
    }
  } catch (error) {
    console.error('Thumbnail generation failed:', error);
    // Don't fail the upload if thumbnail generation fails
  }
}

// Calculate file hash for deduplication
async function calculateFileHash(file: Express.Multer.File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (process.env.NODE_ENV === 'production') {
      // For S3, we would need to stream the file content
      // This is a simplified implementation
      const hash = crypto.createHash('sha256');
      hash.update(file.originalname + file.size + Date.now());
      resolve(hash.digest('hex'));
    } else {
      // For local storage, read the file and hash it
      const fs = require('fs');
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(file.path);
      
      stream.on('data', (data: Buffer) => {
        hash.update(data);
      });
      
      stream.on('end', () => {
        resolve(hash.digest('hex'));
      });
      
      stream.on('error', reject);
    }
  });
}

// Virus scanning placeholder
async function performVirusScan(file: Express.Multer.File): Promise<{ clean: boolean; threat?: string }> {
  // Placeholder for virus scanning integration
  // In production, integrate with ClamAV, VirusTotal API, or AWS Lambda virus scanner
  
  // Basic file size and type checks as a starting point
  if (file.size > 100 * 1024 * 1024) { // 100MB
    return { clean: false, threat: 'File too large' };
  }
  
  // Check for suspicious file patterns
  const suspiciousPatterns = [
    /\.exe$/i,
    /\.scr$/i,
    /\.bat$/i,
    /\.com$/i,
    /\.pif$/i,
    /\.cmd$/i,
    /\.vbs$/i,
    /\.js$/i,
  ];
  
  for (const pattern of suspiciousPatterns) {
    if (pattern.test(file.originalname)) {
      return { clean: false, threat: 'Suspicious file type' };
    }
  }
  
  return { clean: true };
}

// Error handler for multer errors
export const handleUploadError = (error: any, req: Request, res: any, next: any) => {
  if (error instanceof multer.MulterError) {
    switch (error.code) {
      case 'LIMIT_FILE_SIZE':
        return res.status(400).json({
          error: 'File too large',
          message: 'Please upload files smaller than the allowed limit',
          maxSize: '50MB for PDFs, 10MB for images'
        });
      case 'LIMIT_FILE_COUNT':
        return res.status(400).json({
          error: 'Too many files',
          message: 'Maximum 10 files allowed per upload'
        });
      case 'LIMIT_UNEXPECTED_FILE':
        return res.status(400).json({
          error: 'Unexpected file field',
          message: 'Please use the correct field name for file uploads'
        });
      default:
        return res.status(400).json({
          error: 'Upload error',
          message: error.message
        });
    }
  }
  
  if (error.message?.includes('Invalid file type') || error.message?.includes('Invalid file extension')) {
    return res.status(400).json({
      error: 'Invalid file type',
      message: error.message,
      allowedTypes: allowedMimeTypes,
      allowedExtensions: allowedExtensions
    });
  }
  
  if (error.message?.includes('Virus detected')) {
    return res.status(400).json({
      error: 'Security threat detected',
      message: 'File failed security scan'
    });
  }
  
  next(error);
};

// Cleanup temporary files on error
export const cleanupTempFiles = (req: Request, res: any, next: any) => {
  const originalEnd = res.end;
  const originalSend = res.send;
  
  const cleanup = () => {
    if (process.env.NODE_ENV !== 'production' && req.files) {
      const files = Array.isArray(req.files) ? req.files : [req.file];
      files.forEach((file: any) => {
        if (file && file.path) {
          require('fs').unlink(file.path, () => {}); // Silent cleanup
        }
      });
    }
  };
  
  res.end = function(...args: any[]) {
    cleanup();
    originalEnd.apply(this, args);
  };
  
  res.send = function(...args: any[]) {
    cleanup();
    originalSend.apply(this, args);
  };
  
  next();
};