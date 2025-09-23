# Receipt Processing Pipeline

This document provides a comprehensive overview of the receipt processing system built for the expense platform.

## Overview

The receipt processing pipeline is a complete end-to-end solution that handles:

1. **File Upload System** - Drag & drop web interface, email processing, and mobile preparation
2. **OCR Integration** - AWS Textract for receipt data extraction
3. **Receipt Management** - Duplicate detection, versioning, and metadata handling
4. **API Endpoints** - RESTful API for all receipt operations
5. **Database Integration** - Full database schema with audit trails
6. **Security & Compliance** - Encrypted storage, access logging, and GDPR compliance

## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Web Frontend  │    │  Email Gateway  │    │  Mobile App     │
└─────────┬───────┘    └─────────┬───────┘    └─────────┬───────┘
          │                      │                      │
          └──────────────────────┼──────────────────────┘
                                 │
                    ┌─────────────▼───────────────┐
                    │       Upload API            │
                    │   - File validation        │
                    │   - Virus scanning         │
                    │   - S3/Local storage       │
                    └─────────────┬───────────────┘
                                 │
                    ┌─────────────▼───────────────┐
                    │    OCR Processing           │
                    │   - AWS Textract          │
                    │   - Field extraction       │
                    │   - Confidence scoring     │
                    └─────────────┬───────────────┘
                                 │
                    ┌─────────────▼───────────────┐
                    │   Receipt Management        │
                    │   - Duplicate detection     │
                    │   - Database storage        │
                    │   - Transaction matching    │
                    └─────────────┬───────────────┘
                                 │
                    ┌─────────────▼───────────────┐
                    │     Notifications           │
                    │   - Email confirmations     │
                    │   - Error alerts           │
                    │   - Weekly summaries       │
                    └─────────────────────────────┘
```

## Features

### 1. File Upload System

- **Drag & Drop Interface**: Modern web UI with real-time preview
- **Multiple File Support**: Upload up to 10 files simultaneously (PDF, JPG, PNG, GIF, TIFF, BMP)
- **Email Integration**: Forward receipts via email for automatic processing
- **Mobile Ready**: Prepared for camera capture integration
- **Secure Storage**: AWS S3 with encryption or local storage for development
- **Virus Scanning**: Built-in virus detection with ClamAV integration preparation

### 2. OCR Integration

- **AWS Textract**: Advanced receipt parsing with ML-powered field extraction
- **Field Extraction**: Automatic detection of amount, date, merchant, tax, line items
- **Confidence Scoring**: Quality metrics for extracted data
- **Manual Correction**: Interface for reviewing and correcting low-confidence extractions
- **Multiple Formats**: Support for US and international receipt formats
- **Retry Logic**: Automatic retry for failed processing

### 3. Receipt Management

- **Duplicate Detection**: Multi-strategy approach using file hashing, content similarity, and metadata matching
- **Receipt Versioning**: Complete edit history and audit trail
- **Thumbnail Generation**: Quick preview images with multiple sizes
- **Full-Resolution Storage**: Compliance-ready archival storage
- **Metadata Tagging**: Custom tags and categories for organization
- **Advanced Search**: Full-text search across all extracted content

### 4. API Endpoints

```
POST   /api/receipts/upload            - Single file upload
POST   /api/receipts/upload/multiple   - Multiple file upload  
POST   /api/receipts/email             - Email receipt processing
GET    /api/receipts                   - List and search receipts
GET    /api/receipts/:id               - Get receipt details
PUT    /api/receipts/:id/fields        - Update extracted fields
GET    /api/receipts/:id/status        - Get processing status
DELETE /api/receipts/:id               - Delete receipt
GET    /api/receipts/search            - Advanced search
```

### 5. Database Schema

The system uses the existing receipt tables from the expense platform schema:

- **receipts**: Main receipt records with status tracking
- **receipt_images**: Multiple images per receipt with OCR data
- **extracted_fields**: Structured field data with confidence scores
- **matches**: Transaction-to-receipt matching records
- **rules**: Automatic categorization and processing rules

### 6. Security & Compliance

- **Encrypted Storage**: All receipt images encrypted at rest
- **Access Logging**: Comprehensive audit trail for all operations
- **Permission System**: Role-based access control integration
- **Data Retention**: Configurable retention policies
- **GDPR Compliance**: Full data deletion and export capabilities
- **Virus Scanning**: Multi-layer security validation

## Installation & Setup

### Prerequisites

- Node.js 20.10.0+
- PostgreSQL 12+
- Redis (for sessions)
- AWS Account (for production) with S3, Textract, and SES access

### Environment Variables

Create a `.env` file with:

```env
# Database
DATABASE_URL=postgresql://user:password@localhost/expense_platform

# Authentication
SESSION_SECRET=your-super-secret-session-key
JWT_SECRET=your-jwt-secret-key

# AWS Services (Production)
AWS_ACCESS_KEY_ID=your-aws-access-key
AWS_SECRET_ACCESS_KEY=your-aws-secret-key
AWS_REGION=us-east-1
S3_BUCKET_NAME=your-receipt-bucket

# Email Service
SMTP_HOST=localhost
SMTP_PORT=587
SMTP_USER=your-email
SMTP_PASS=your-password
FROM_EMAIL=receipts@yourcompany.com

# Application
NODE_ENV=development
PORT=3000
UPLOAD_DIR=./uploads
LOG_LEVEL=info
```

### Installation Steps

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Run Database Migrations**
   ```bash
   npm run migrate
   ```

3. **Seed Test Data** (optional)
   ```bash
   npm run seed
   ```

4. **Build the Application**
   ```bash
   npm run build
   ```

5. **Start Development Server**
   ```bash
   npm run dev
   ```

6. **Run Tests**
   ```bash
   npm test
   npm run test:coverage
   ```

## Usage

### Web Interface

Navigate to `http://localhost:3000` to access the receipt upload interface:

1. **Upload Receipts**: Drag and drop files or click to select
2. **Configure Options**: Set category, tags, and processing options
3. **Monitor Progress**: Real-time upload and processing status
4. **Review Results**: View extracted data and make corrections

### API Usage

#### Upload a Single Receipt

```javascript
const formData = new FormData();
formData.append('receipt', file);
formData.append('metadata', JSON.stringify({
  category: 'meals',
  tags: ['client-meeting', 'urgent'],
  notes: 'Lunch with potential client'
}));

const response = await fetch('/api/receipts/upload', {
  method: 'POST',
  body: formData
});

const result = await response.json();
console.log('Receipt ID:', result.receiptId);
```

#### Search Receipts

```javascript
const params = new URLSearchParams({
  status: 'processed',
  merchant: 'Starbucks',
  dateFrom: '2024-01-01',
  amountMin: '10',
  limit: '50'
});

const response = await fetch(`/api/receipts?${params}`);
const results = await response.json();
console.log('Found receipts:', results.data);
```

#### Update Extracted Field

```javascript
const response = await fetch(`/api/receipts/${receiptId}/fields`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    fieldName: 'total',
    fieldValue: '25.99'
  })
});
```

### Email Processing

Forward receipts to the configured email address:

```
To: receipts@yourcompany.com
Subject: Expense Receipt - Client Lunch
Body: Please process this receipt for the client lunch meeting.
Attachments: receipt.jpg
```

The system will:
1. Identify the sender
2. Process attachments
3. Extract receipt data
4. Send confirmation email
5. Trigger automatic matching

## Development

### Project Structure

```
src/
├── services/           # Core business logic
│   ├── receiptService.ts      # Main receipt orchestration
│   ├── ocrService.ts          # AWS Textract integration
│   ├── emailService.ts        # Email notifications
│   └── duplicateDetectionService.ts
├── routes/             # API endpoints
│   └── receipts.ts            # Receipt API routes
├── middleware/         # Express middleware
│   └── upload.ts              # File upload handling
├── utils/              # Utilities
│   ├── imageProcessing.ts     # Image optimization
│   └── fileStorage.ts         # S3/local file storage
├── public/             # Static assets
│   └── receipt-upload.html    # Upload interface
├── tests/              # Test suites
│   ├── receiptService.test.ts
│   └── setup.ts
└── app.ts              # Main application
```

### Key Components

#### ReceiptService
Main orchestrator that coordinates all receipt processing operations:
- File upload processing
- OCR integration
- Database operations
- Error handling
- Status tracking

#### OCRService  
AWS Textract integration for intelligent receipt parsing:
- Async/sync processing modes
- Field extraction with confidence scoring
- Multi-format support (images, PDFs)
- Error handling and retry logic

#### DuplicateDetectionService
Advanced duplicate detection using multiple strategies:
- Exact file hash matching
- Content similarity analysis
- Metadata-based matching
- Configurable thresholds

#### EmailService
Comprehensive email handling:
- Receipt processing confirmations
- Error notifications
- Weekly summaries
- Template management

### Testing

The project includes comprehensive test coverage:

- **Unit Tests**: Individual service and utility testing
- **Integration Tests**: End-to-end API testing
- **Mock Services**: AWS services and external dependencies
- **Test Utilities**: Helper functions and custom matchers

Run tests:
```bash
npm test                 # Run all tests
npm run test:coverage    # Generate coverage report
npm run test:watch       # Watch mode for development
```

### Performance Considerations

- **Async Processing**: OCR operations run asynchronously
- **Rate Limiting**: API endpoints protected against abuse
- **Image Optimization**: Automatic compression and thumbnails
- **Caching**: Strategic caching for frequently accessed data
- **Connection Pooling**: Efficient database connections

### Monitoring & Logging

- **Winston Logging**: Structured JSON logs with levels
- **Error Tracking**: Comprehensive error capture and reporting
- **Performance Metrics**: Processing time and success rates
- **Health Checks**: System status monitoring
- **Audit Trail**: Complete user action tracking

## Deployment

### Production Deployment

1. **Configure AWS Resources**
   ```bash
   # Create S3 bucket
   aws s3 mb s3://your-receipt-bucket
   
   # Configure Textract permissions
   aws iam attach-role-policy --role-name YourRole --policy-arn arn:aws:iam::aws:policy/AmazonTextractFullAccess
   ```

2. **Build for Production**
   ```bash
   npm run build
   npm run migrate
   ```

3. **Deploy to Your Platform**
   - Docker: Use provided Dockerfile
   - AWS ECS/Fargate: Configure task definitions
   - Kubernetes: Apply provided manifests
   - Traditional servers: Use PM2 or similar

### Docker Deployment

```dockerfile
# Build stage
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

# Production stage  
FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY dist ./dist
EXPOSE 3000
CMD ["node", "dist/src/app.js"]
```

### Kubernetes Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: receipt-processor
spec:
  replicas: 3
  selector:
    matchLabels:
      app: receipt-processor
  template:
    metadata:
      labels:
        app: receipt-processor
    spec:
      containers:
      - name: receipt-processor
        image: your-registry/receipt-processor:latest
        ports:
        - containerPort: 3000
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: db-secret
              key: url
```

## Integration

### Transaction Matching

The system integrates with your existing transaction matching:

```javascript
// Automatic matching triggers after OCR processing
await receiptService.processUpload(organizationId, userId, file);
// -> Triggers automatic matching via database triggers
```

### Permission System

Integrates with existing RBAC system:

```javascript
// Check permissions before operations
const requirePermission = (resource: string, action: string) => {
  return (req, res, next) => {
    if (!req.user.permissions[resource]?.includes(action)) {
      return res.status(403).json({ error: 'Permission denied' });
    }
    next();
  };
};
```

### Audit System

All operations logged for compliance:

```javascript
// Automatic audit trail via database triggers
INSERT INTO audit_log (
  table_name, operation, user_id, 
  organization_id, changes, timestamp
);
```

## Troubleshooting

### Common Issues

1. **OCR Processing Fails**
   - Check AWS credentials and permissions
   - Verify image quality and format
   - Check Textract service limits

2. **File Upload Errors**
   - Verify file size limits
   - Check virus scanning configuration
   - Validate S3 bucket permissions

3. **Duplicate Detection Issues**
   - Review similarity thresholds
   - Check hash calculation accuracy
   - Verify metadata matching logic

4. **Email Processing Problems**
   - Confirm SMTP configuration
   - Check email authentication
   - Verify attachment processing

### Debug Mode

Enable detailed logging:

```bash
export LOG_LEVEL=debug
npm run dev
```

### Health Checks

Monitor system health:

```bash
curl http://localhost:3000/health
```

## Support

For issues and questions:

1. Check the troubleshooting section
2. Review error logs in `logs/`
3. Run health checks
4. Consult API documentation at `/api`

## Contributing

1. Follow TypeScript best practices
2. Write comprehensive tests
3. Update documentation
4. Follow security guidelines
5. Test with various receipt formats

## License

This receipt processing system is part of the Expense Platform and follows the same licensing terms.