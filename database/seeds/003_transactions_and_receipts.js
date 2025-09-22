/**
 * Transactions and Receipts Seed
 * Sample transaction data, receipts, and matches for testing
 */

exports.seed = async function(knex) {
  // Clear existing entries
  await knex('matches').del();
  await knex('extracted_fields').del();
  await knex('receipt_images').del();
  await knex('receipts').del();
  await knex('transaction_line_items').del();
  await knex('transactions').del();
  await knex('authorizations').del();

  // Insert Authorizations
  const authorizations = [
    {
      id: '00000000-0000-0000-0000-000000001101',
      organization_id: '00000000-0000-0000-0000-000000000001',
      account_id: '00000000-0000-0000-0000-000000000902', // Corporate Credit Card
      merchant_id: '00000000-0000-0000-0000-000000000801', // Starbucks
      authorization_code: 'AUTH123456',
      amount: 12.50,
      currency: 'USD',
      status: 'approved',
      authorized_at: knex.raw("NOW() - INTERVAL '2 days'"),
      expires_at: knex.raw("NOW() + INTERVAL '5 days'"),
      metadata: {
        card_last_four: '1111',
        merchant_location: 'New York, NY'
      },
      created_by: '00000000-0000-0000-0000-000000000103',
      created_at: knex.raw("NOW() - INTERVAL '2 days'"),
      updated_at: knex.raw("NOW() - INTERVAL '2 days'")
    },
    {
      id: '00000000-0000-0000-0000-000000001102',
      organization_id: '00000000-0000-0000-0000-000000000001',
      account_id: '00000000-0000-0000-0000-000000000902',
      merchant_id: '00000000-0000-0000-0000-000000000802', // Amazon
      authorization_code: 'AUTH789012',
      amount: 89.99,
      currency: 'USD',
      status: 'approved',
      authorized_at: knex.raw("NOW() - INTERVAL '1 day'"),
      expires_at: knex.raw("NOW() + INTERVAL '6 days'"),
      metadata: {
        card_last_four: '1111'
      },
      created_by: '00000000-0000-0000-0000-000000000102',
      created_at: knex.raw("NOW() - INTERVAL '1 day'"),
      updated_at: knex.raw("NOW() - INTERVAL '1 day'")
    }
  ];

  await knex('authorizations').insert(authorizations);

  // Insert Transactions
  const transactions = [
    {
      id: '00000000-0000-0000-0000-000000001201',
      organization_id: '00000000-0000-0000-0000-000000000001',
      account_id: '00000000-0000-0000-0000-000000000902',
      authorization_id: '00000000-0000-0000-0000-000000001101',
      merchant_id: '00000000-0000-0000-0000-000000000801',
      category_id: '00000000-0000-0000-0000-000000000602', // Business Meals
      transaction_id: 'TXN001',
      type: 'debit',
      amount: 12.50,
      currency: 'USD',
      description: 'Coffee meeting with client',
      memo: 'Business meeting at Starbucks',
      status: 'processed',
      transaction_date: knex.raw("NOW() - INTERVAL '2 days'"),
      posted_date: knex.raw("NOW() - INTERVAL '1 day'"),
      metadata: {
        card_present: true,
        mcc_code: '5814' // Fast Food Restaurants
      },
      is_recurring: false,
      created_by: '00000000-0000-0000-0000-000000000103',
      created_at: knex.raw("NOW() - INTERVAL '2 days'"),
      updated_at: knex.raw("NOW() - INTERVAL '1 day'")
    },
    {
      id: '00000000-0000-0000-0000-000000001202',
      organization_id: '00000000-0000-0000-0000-000000000001',
      account_id: '00000000-0000-0000-0000-000000000902',
      authorization_id: '00000000-0000-0000-0000-000000001102',
      merchant_id: '00000000-0000-0000-0000-000000000802',
      category_id: '00000000-0000-0000-0000-000000000601', // Office Supplies
      transaction_id: 'TXN002',
      type: 'debit',
      amount: 89.99,
      currency: 'USD',
      description: 'Office supplies purchase',
      memo: 'Printer paper, pens, and desk organizers',
      status: 'processed',
      transaction_date: knex.raw("NOW() - INTERVAL '1 day'"),
      posted_date: knex.raw("NOW()"),
      metadata: {
        card_present: false,
        mcc_code: '5943' // Stationery Stores
      },
      is_recurring: false,
      created_by: '00000000-0000-0000-0000-000000000102',
      created_at: knex.raw("NOW() - INTERVAL '1 day'"),
      updated_at: knex.raw("NOW()")
    },
    // TechStart Inc transaction
    {
      id: '00000000-0000-0000-0000-000000001301',
      organization_id: '00000000-0000-0000-0000-000000000002',
      account_id: '00000000-0000-0000-0000-000000001001',
      merchant_id: '00000000-0000-0000-0000-000000000803', // GitHub
      category_id: '00000000-0000-0000-0000-000000000701', // Software Licenses
      transaction_id: 'TXN003',
      type: 'debit',
      amount: 50.00,
      currency: 'USD',
      description: 'GitHub Team subscription',
      memo: 'Monthly GitHub Team plan',
      status: 'processed',
      transaction_date: knex.raw("NOW() - INTERVAL '3 days'"),
      posted_date: knex.raw("NOW() - INTERVAL '3 days'"),
      metadata: {
        subscription: true,
        billing_cycle: 'monthly'
      },
      is_recurring: true,
      created_by: '00000000-0000-0000-0000-000000000201',
      created_at: knex.raw("NOW() - INTERVAL '3 days'"),
      updated_at: knex.raw("NOW() - INTERVAL '3 days'")
    }
  ];

  await knex('transactions').insert(transactions);

  // Insert Receipts
  const receipts = [
    {
      id: '00000000-0000-0000-0000-000000001401',
      organization_id: '00000000-0000-0000-0000-000000000001',
      uploaded_by: '00000000-0000-0000-0000-000000000103',
      original_filename: 'starbucks_receipt_20240201.jpg',
      file_path: '/uploads/receipts/2024/02/01/starbucks_receipt_20240201.jpg',
      file_type: 'image/jpeg',
      file_size: 1024768,
      file_hash: 'sha256:abc123def456ghi789',
      status: 'processed',
      processed_at: knex.raw("NOW() - INTERVAL '1 day'"),
      total_amount: 12.50,
      currency: 'USD',
      receipt_date: knex.raw("NOW() - INTERVAL '2 days'"),
      merchant_id: '00000000-0000-0000-0000-000000000801',
      merchant_name: 'Starbucks Coffee #1234',
      metadata: {
        ocr_confidence: 0.95,
        processing_time_ms: 2500
      },
      created_at: knex.raw("NOW() - INTERVAL '2 days'"),
      updated_at: knex.raw("NOW() - INTERVAL '1 day'")
    },
    {
      id: '00000000-0000-0000-0000-000000001402',
      organization_id: '00000000-0000-0000-0000-000000000001',
      uploaded_by: '00000000-0000-0000-0000-000000000102',
      original_filename: 'amazon_receipt_office_supplies.pdf',
      file_path: '/uploads/receipts/2024/02/01/amazon_receipt_office_supplies.pdf',
      file_type: 'application/pdf',
      file_size: 245760,
      file_hash: 'sha256:xyz789abc123def456',
      status: 'processed',
      processed_at: knex.raw("NOW()"),
      total_amount: 89.99,
      currency: 'USD',
      receipt_date: knex.raw("NOW() - INTERVAL '1 day'"),
      merchant_id: '00000000-0000-0000-0000-000000000802',
      merchant_name: 'Amazon Business',
      metadata: {
        ocr_confidence: 0.88,
        processing_time_ms: 4200
      },
      created_at: knex.raw("NOW() - INTERVAL '1 day'"),
      updated_at: knex.raw("NOW()")
    }
  ];

  await knex('receipts').insert(receipts);

  // Insert Receipt Images
  const receiptImages = [
    {
      id: '00000000-0000-0000-0000-000000001501',
      organization_id: '00000000-0000-0000-0000-000000000001',
      receipt_id: '00000000-0000-0000-0000-000000001401',
      file_path: '/uploads/receipts/2024/02/01/starbucks_receipt_20240201.jpg',
      file_type: 'image/jpeg',
      file_size: 1024768,
      sequence_number: 1,
      ocr_data: {
        text_regions: [
          {
            text: 'STARBUCKS STORE #1234',
            confidence: 0.98,
            bounding_box: { x: 100, y: 50, width: 200, height: 30 }
          },
          {
            text: 'GRANDE LATTE',
            confidence: 0.95,
            bounding_box: { x: 80, y: 150, width: 150, height: 25 }
          },
          {
            text: '$12.50',
            confidence: 0.99,
            bounding_box: { x: 250, y: 150, width: 80, height: 25 }
          }
        ]
      },
      confidence_score: 0.95,
      created_at: knex.raw("NOW() - INTERVAL '2 days'"),
      updated_at: knex.raw("NOW() - INTERVAL '1 day'")
    }
  ];

  await knex('receipt_images').insert(receiptImages);

  // Insert Extracted Fields
  const extractedFields = [
    {
      id: '00000000-0000-0000-0000-000000001601',
      organization_id: '00000000-0000-0000-0000-000000000001',
      receipt_id: '00000000-0000-0000-0000-000000001401',
      field_name: 'total',
      field_value: '12.50',
      field_type: 'amount',
      confidence_score: 0.99,
      bounding_box: { x: 250, y: 150, width: 80, height: 25 },
      verified: true,
      verified_by: '00000000-0000-0000-0000-000000000103',
      verified_at: knex.raw("NOW() - INTERVAL '1 day'"),
      created_at: knex.raw("NOW() - INTERVAL '2 days'"),
      updated_at: knex.raw("NOW() - INTERVAL '1 day'")
    },
    {
      id: '00000000-0000-0000-0000-000000001602',
      organization_id: '00000000-0000-0000-0000-000000000001',
      receipt_id: '00000000-0000-0000-0000-000000001401',
      field_name: 'merchant_name',
      field_value: 'Starbucks Coffee #1234',
      field_type: 'text',
      confidence_score: 0.98,
      bounding_box: { x: 100, y: 50, width: 200, height: 30 },
      verified: true,
      verified_by: '00000000-0000-0000-0000-000000000103',
      verified_at: knex.raw("NOW() - INTERVAL '1 day'"),
      created_at: knex.raw("NOW() - INTERVAL '2 days'"),
      updated_at: knex.raw("NOW() - INTERVAL '1 day'")
    },
    {
      id: '00000000-0000-0000-0000-000000001603',
      organization_id: '00000000-0000-0000-0000-000000000001',
      receipt_id: '00000000-0000-0000-0000-000000001401',
      field_name: 'date',
      field_value: knex.raw("(NOW() - INTERVAL '2 days')::text"),
      field_type: 'date',
      confidence_score: 0.92,
      bounding_box: { x: 100, y: 300, width: 120, height: 20 },
      verified: true,
      verified_by: '00000000-0000-0000-0000-000000000103',
      verified_at: knex.raw("NOW() - INTERVAL '1 day'"),
      created_at: knex.raw("NOW() - INTERVAL '2 days'"),
      updated_at: knex.raw("NOW() - INTERVAL '1 day'")
    }
  ];

  await knex('extracted_fields').insert(extractedFields);

  // Insert Matches
  const matches = [
    {
      id: '00000000-0000-0000-0000-000000001701',
      organization_id: '00000000-0000-0000-0000-000000000001',
      transaction_id: '00000000-0000-0000-0000-000000001201',
      receipt_id: '00000000-0000-0000-0000-000000001401',
      match_type: 'auto',
      confidence_score: 0.95,
      matching_criteria: {
        amount_match: true,
        date_range_match: true,
        merchant_match: true,
        confidence: 0.95
      },
      matched_by: null, // Auto-matched
      matched_at: knex.raw("NOW() - INTERVAL '1 day'"),
      active: true,
      notes: 'Automatically matched based on amount, date, and merchant',
      created_at: knex.raw("NOW() - INTERVAL '1 day'"),
      updated_at: knex.raw("NOW() - INTERVAL '1 day'")
    },
    {
      id: '00000000-0000-0000-0000-000000001702',
      organization_id: '00000000-0000-0000-0000-000000000001',
      transaction_id: '00000000-0000-0000-0000-000000001202',
      receipt_id: '00000000-0000-0000-0000-000000001402',
      match_type: 'manual',
      confidence_score: 0.88,
      matching_criteria: {
        amount_match: true,
        date_range_match: true,
        merchant_match: true,
        manual_review: true
      },
      matched_by: '00000000-0000-0000-0000-000000000102',
      matched_at: knex.raw("NOW()"),
      active: true,
      notes: 'Manually matched by manager after review',
      created_at: knex.raw("NOW()"),
      updated_at: knex.raw("NOW()")
    }
  ];

  await knex('matches').insert(matches);

  console.log('Seeded transactions, receipts, extracted fields, and matches');
};