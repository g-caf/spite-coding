/**
 * Image Processing Utilities
 * Handles image optimization, thumbnail generation, and format conversion
 */

import sharp from 'sharp';
import path from 'path';
import crypto from 'crypto';
import winston from 'winston';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/image-processing.log' })
  ]
});

export interface ImageProcessingOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  format?: 'jpeg' | 'png' | 'webp';
  progressive?: boolean;
  stripMetadata?: boolean;
}

export interface ThumbnailOptions {
  width: number;
  height: number;
  fit: 'cover' | 'contain' | 'fill' | 'inside' | 'outside';
  quality?: number;
  format?: 'jpeg' | 'png' | 'webp';
}

export interface ImageMetadata {
  width: number;
  height: number;
  format: string;
  size: number;
  hasAlpha: boolean;
  channels: number;
  colorSpace: string;
}

export interface ProcessingResult {
  buffer: Buffer;
  metadata: ImageMetadata;
  originalSize: number;
  processedSize: number;
  compressionRatio: number;
}

export class ImageProcessor {
  private static readonly DEFAULT_OPTIONS: ImageProcessingOptions = {
    maxWidth: 2048,
    maxHeight: 2048,
    quality: 85,
    format: 'jpeg',
    progressive: true,
    stripMetadata: true
  };

  private static readonly THUMBNAIL_PRESETS = {
    small: { width: 150, height: 150, fit: 'cover' as const },
    medium: { width: 300, height: 300, fit: 'cover' as const },
    large: { width: 600, height: 600, fit: 'inside' as const }
  };

  /**
   * Optimize image for storage and display
   */
  static async optimizeImage(
    inputBuffer: Buffer,
    options: ImageProcessingOptions = {}
  ): Promise<ProcessingResult> {
    const startTime = Date.now();
    const mergedOptions = { ...this.DEFAULT_OPTIONS, ...options };

    try {
      const originalSize = inputBuffer.length;
      
      // Get original metadata
      const originalMetadata = await sharp(inputBuffer).metadata();
      
      let processor = sharp(inputBuffer);

      // Resize if needed
      if (originalMetadata.width && originalMetadata.height) {
        const needsResize = 
          (mergedOptions.maxWidth && originalMetadata.width > mergedOptions.maxWidth) ||
          (mergedOptions.maxHeight && originalMetadata.height > mergedOptions.maxHeight);

        if (needsResize) {
          processor = processor.resize(mergedOptions.maxWidth, mergedOptions.maxHeight, {
            fit: 'inside',
            withoutEnlargement: true
          });
        }
      }

      // Strip metadata for privacy and size reduction
      if (mergedOptions.stripMetadata) {
        processor = processor.withMetadata({
          // Keep only essential metadata
          orientation: originalMetadata.orientation
        });
      }

      // Apply format-specific optimizations
      switch (mergedOptions.format) {
        case 'jpeg':
          processor = processor.jpeg({
            quality: mergedOptions.quality,
            progressive: mergedOptions.progressive,
            mozjpeg: true // Use Mozilla JPEG encoder for better compression
          });
          break;
        case 'png':
          processor = processor.png({
            compressionLevel: 9,
            adaptiveFiltering: true,
            palette: originalMetadata.channels === 1 || originalMetadata.channels === 3
          });
          break;
        case 'webp':
          processor = processor.webp({
            quality: mergedOptions.quality,
            effort: 6 // High effort for better compression
          });
          break;
        default:
          throw new Error(`Unsupported format: ${mergedOptions.format}`);
      }

      const processedBuffer = await processor.toBuffer();
      const processedMetadata = await sharp(processedBuffer).metadata();

      const result: ProcessingResult = {
        buffer: processedBuffer,
        metadata: {
          width: processedMetadata.width || 0,
          height: processedMetadata.height || 0,
          format: processedMetadata.format || 'unknown',
          size: processedBuffer.length,
          hasAlpha: (processedMetadata.channels || 0) > 3,
          channels: processedMetadata.channels || 0,
          colorSpace: processedMetadata.space || 'unknown'
        },
        originalSize,
        processedSize: processedBuffer.length,
        compressionRatio: originalSize / processedBuffer.length
      };

      logger.info('Image optimization completed', {
        originalSize,
        processedSize: processedBuffer.length,
        compressionRatio: result.compressionRatio,
        processingTime: Date.now() - startTime,
        format: mergedOptions.format
      });

      return result;

    } catch (error) {
      logger.error('Image optimization failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        originalSize: inputBuffer.length,
        processingTime: Date.now() - startTime
      });
      throw error;
    }
  }

  /**
   * Generate thumbnails in multiple sizes
   */
  static async generateThumbnails(
    inputBuffer: Buffer,
    presets: Array<keyof typeof this.THUMBNAIL_PRESETS | ThumbnailOptions> = ['small', 'medium']
  ): Promise<Map<string, Buffer>> {
    const thumbnails = new Map<string, Buffer>();

    try {
      for (const preset of presets) {
        let options: ThumbnailOptions;
        let name: string;

        if (typeof preset === 'string') {
          options = { ...this.THUMBNAIL_PRESETS[preset], quality: 80, format: 'jpeg' };
          name = preset;
        } else {
          options = { quality: 80, format: 'jpeg', ...preset };
          name = `${options.width}x${options.height}`;
        }

        const thumbnailBuffer = await sharp(inputBuffer)
          .resize(options.width, options.height, {
            fit: options.fit,
            withoutEnlargement: true
          })
          .jpeg({ quality: options.quality })
          .toBuffer();

        thumbnails.set(name, thumbnailBuffer);
      }

      logger.info('Thumbnails generated', {
        count: thumbnails.size,
        presets: presets.map(p => typeof p === 'string' ? p : `${p.width}x${p.height}`)
      });

      return thumbnails;

    } catch (error) {
      logger.error('Thumbnail generation failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Extract text regions from image for better OCR
   */
  static async prepareForOCR(inputBuffer: Buffer): Promise<Buffer> {
    try {
      // Enhance image for OCR processing
      const processedBuffer = await sharp(inputBuffer)
        // Convert to grayscale for better text detection
        .grayscale()
        // Increase contrast
        .normalize()
        // Sharpen for better edge detection
        .sharpen({ sigma: 1.0, m1: 1.0, m2: 2.0 })
        // Resize to optimal resolution for OCR (300 DPI equivalent)
        .resize({
          width: 2480, // Approx 8.27" at 300 DPI
          height: 3508, // Approx 11.69" at 300 DPI
          fit: 'inside',
          withoutEnlargement: false
        })
        .png({ compressionLevel: 0 }) // No compression for OCR
        .toBuffer();

      logger.info('Image prepared for OCR', {
        originalSize: inputBuffer.length,
        processedSize: processedBuffer.length
      });

      return processedBuffer;

    } catch (error) {
      logger.error('OCR preparation failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Detect if image contains meaningful content (not blank/corrupted)
   */
  static async validateImageContent(inputBuffer: Buffer): Promise<{
    isValid: boolean;
    confidence: number;
    issues: string[];
  }> {
    const issues: string[] = [];
    let confidence = 1.0;

    try {
      const metadata = await sharp(inputBuffer).metadata();
      
      if (!metadata.width || !metadata.height) {
        issues.push('Invalid dimensions');
        confidence -= 0.5;
      }

      if (metadata.width && metadata.height) {
        // Check if image is too small to be useful
        if (metadata.width < 100 || metadata.height < 100) {
          issues.push('Image too small');
          confidence -= 0.3;
        }

        // Check aspect ratio for typical receipt dimensions
        const aspectRatio = metadata.width / metadata.height;
        if (aspectRatio > 5 || aspectRatio < 0.2) {
          issues.push('Unusual aspect ratio');
          confidence -= 0.2;
        }
      }

      // Calculate image statistics to detect blank images
      const stats = await sharp(inputBuffer)
        .greyscale()
        .stats();

      // Check if image is mostly uniform (blank/solid color)
      if (stats.channels && stats.channels.length > 0) {
        const channel = stats.channels[0];
        const variance = Math.pow(channel.stdev, 2);
        
        if (variance < 100) { // Very low variance indicates uniform image
          issues.push('Image appears blank or uniform');
          confidence -= 0.4;
        }
      }

      const isValid = confidence > 0.3 && issues.length < 3;

      logger.info('Image validation completed', {
        isValid,
        confidence,
        issues: issues.length,
        dimensions: `${metadata.width}x${metadata.height}`
      });

      return { isValid, confidence, issues };

    } catch (error) {
      logger.error('Image validation failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      return {
        isValid: false,
        confidence: 0,
        issues: ['Failed to process image']
      };
    }
  }

  /**
   * Generate perceptual hash for duplicate detection
   */
  static async generatePerceptualHash(inputBuffer: Buffer): Promise<string> {
    try {
      // Generate a perceptual hash using DCT (Discrete Cosine Transform)
      const hashBuffer = await sharp(inputBuffer)
        .resize(32, 32, { fit: 'fill' })
        .greyscale()
        .raw()
        .toBuffer();

      // Simple averaging hash implementation
      const average = hashBuffer.reduce((sum, value) => sum + value, 0) / hashBuffer.length;
      
      let hash = '';
      for (let i = 0; i < hashBuffer.length; i++) {
        hash += hashBuffer[i] > average ? '1' : '0';
      }

      // Convert binary string to hex
      const hexHash = parseInt(hash.slice(0, 32), 2).toString(16).padStart(8, '0') +
                      parseInt(hash.slice(32, 64), 2).toString(16).padStart(8, '0');

      logger.debug('Perceptual hash generated', { hash: hexHash });

      return hexHash;

    } catch (error) {
      logger.error('Perceptual hash generation failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      // Fallback: generate hash from image metadata and size
      const fallbackHash = crypto
        .createHash('md5')
        .update(inputBuffer.slice(0, Math.min(1024, inputBuffer.length)))
        .digest('hex')
        .slice(0, 16);
        
      return fallbackHash;
    }
  }

  /**
   * Calculate Hamming distance between two perceptual hashes
   */
  static calculateHashDistance(hash1: string, hash2: string): number {
    if (hash1.length !== hash2.length) {
      return Infinity;
    }

    let distance = 0;
    for (let i = 0; i < hash1.length; i++) {
      if (hash1[i] !== hash2[i]) {
        distance++;
      }
    }

    return distance;
  }

  /**
   * Determine if two images are similar based on perceptual hashes
   */
  static areImagesSimilar(hash1: string, hash2: string, threshold = 10): boolean {
    const distance = this.calculateHashDistance(hash1, hash2);
    return distance <= threshold;
  }

  /**
   * Extract EXIF data safely
   */
  static async extractMetadata(inputBuffer: Buffer): Promise<{
    camera?: string;
    timestamp?: Date;
    gps?: { latitude: number; longitude: number };
    orientation?: number;
    dimensions: { width: number; height: number };
  }> {
    try {
      const metadata = await sharp(inputBuffer).metadata();
      
      const result = {
        dimensions: {
          width: metadata.width || 0,
          height: metadata.height || 0
        },
        orientation: metadata.orientation
      } as any;

      // Extract EXIF data if available
      if (metadata.exif) {
        // Parse EXIF buffer (simplified extraction)
        // In production, use a proper EXIF parser like exif-reader
        try {
          const exifString = metadata.exif.toString('utf8');
          
          // Look for timestamp
          const timestampMatch = exifString.match(/(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
          if (timestampMatch) {
            result.timestamp = new Date(
              `${timestampMatch[1]}-${timestampMatch[2]}-${timestampMatch[3]}T${timestampMatch[4]}:${timestampMatch[5]}:${timestampMatch[6]}`
            );
          }
        } catch (exifError) {
          logger.debug('EXIF parsing failed', { error: exifError });
        }
      }

      return result;

    } catch (error) {
      logger.error('Metadata extraction failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      return {
        dimensions: { width: 0, height: 0 }
      };
    }
  }

  /**
   * Convert image to PDF for archival
   */
  static async convertToPDF(inputBuffer: Buffer, filename: string): Promise<Buffer> {
    try {
      // This is a simplified implementation
      // In production, use a library like pdf-lib or jsPDF
      
      // For now, we'll optimize the image and embed it in a PDF-like structure
      const optimizedImage = await this.optimizeImage(inputBuffer, {
        maxWidth: 1600,
        maxHeight: 2000,
        quality: 90,
        format: 'jpeg'
      });

      // In a real implementation, this would create a proper PDF
      // For now, return the optimized image
      return optimizedImage.buffer;

    } catch (error) {
      logger.error('PDF conversion failed', {
        filename,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }
}