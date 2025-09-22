/**
 * Financial Data Seed
 * GL accounts, categories, merchants, and financial accounts
 */

exports.seed = async function(knex) {
  // Clear existing entries
  await knex('categories').del();
  await knex('merchants').del();
  await knex('accounts').del();
  await knex('gl_accounts').del();

  // Insert GL Accounts for both organizations
  const glAccounts = [
    // Acme Corporation GL Accounts
    {
      id: '00000000-0000-0000-0000-000000000401',
      organization_id: '00000000-0000-0000-0000-000000000001',
      account_code: '1100',
      account_name: 'Cash - Operating Account',
      account_type: 'asset',
      description: 'Primary operating cash account',
      active: true,
      created_by: '00000000-0000-0000-0000-000000000101',
      created_at: knex.fn.now(),
      updated_at: knex.fn.now()
    },
    {
      id: '00000000-0000-0000-0000-000000000402',
      organization_id: '00000000-0000-0000-0000-000000000001',
      account_code: '2100',
      account_name: 'Accounts Payable',
      account_type: 'liability',
      description: 'Outstanding vendor payments',
      active: true,
      created_by: '00000000-0000-0000-0000-000000000101',
      created_at: knex.fn.now(),
      updated_at: knex.fn.now()
    },
    {
      id: '00000000-0000-0000-0000-000000000403',
      organization_id: '00000000-0000-0000-0000-000000000001',
      account_code: '5100',
      account_name: 'Office Supplies',
      account_type: 'expense',
      description: 'Office supplies and materials',
      active: true,
      created_by: '00000000-0000-0000-0000-000000000101',
      created_at: knex.fn.now(),
      updated_at: knex.fn.now()
    },
    {
      id: '00000000-0000-0000-0000-000000000404',
      organization_id: '00000000-0000-0000-0000-000000000001',
      account_code: '5200',
      account_name: 'Travel & Entertainment',
      account_type: 'expense',
      description: 'Business travel and entertainment expenses',
      active: true,
      created_by: '00000000-0000-0000-0000-000000000101',
      created_at: knex.fn.now(),
      updated_at: knex.fn.now()
    },
    // TechStart Inc GL Accounts
    {
      id: '00000000-0000-0000-0000-000000000501',
      organization_id: '00000000-0000-0000-0000-000000000002',
      account_code: '1100',
      account_name: 'Cash - Operating Account',
      account_type: 'asset',
      description: 'Primary operating cash account',
      active: true,
      created_by: '00000000-0000-0000-0000-000000000201',
      created_at: knex.fn.now(),
      updated_at: knex.fn.now()
    },
    {
      id: '00000000-0000-0000-0000-000000000502',
      organization_id: '00000000-0000-0000-0000-000000000002',
      account_code: '5300',
      account_name: 'Software & Technology',
      account_type: 'expense',
      description: 'Software licenses and technology expenses',
      active: true,
      created_by: '00000000-0000-0000-0000-000000000201',
      created_at: knex.fn.now(),
      updated_at: knex.fn.now()
    }
  ];

  await knex('gl_accounts').insert(glAccounts);

  // Insert Categories
  const categories = [
    // Acme Corporation Categories
    {
      id: '00000000-0000-0000-0000-000000000601',
      organization_id: '00000000-0000-0000-0000-000000000001',
      name: 'Office Supplies',
      code: 'OFF',
      gl_account_id: '00000000-0000-0000-0000-000000000403',
      description: 'General office supplies and materials',
      rules: {
        keywords: ['office', 'supplies', 'paper', 'pens', 'stapler'],
        merchants: []
      },
      active: true,
      created_by: '00000000-0000-0000-0000-000000000101',
      created_at: knex.fn.now(),
      updated_at: knex.fn.now()
    },
    {
      id: '00000000-0000-0000-0000-000000000602',
      organization_id: '00000000-0000-0000-0000-000000000001',
      name: 'Business Meals',
      code: 'MEAL',
      parent_id: null,
      gl_account_id: '00000000-0000-0000-0000-000000000404',
      description: 'Business meal expenses',
      rules: {
        keywords: ['restaurant', 'cafe', 'meal', 'lunch', 'dinner'],
        merchants: []
      },
      active: true,
      created_by: '00000000-0000-0000-0000-000000000101',
      created_at: knex.fn.now(),
      updated_at: knex.fn.now()
    },
    {
      id: '00000000-0000-0000-0000-000000000603',
      organization_id: '00000000-0000-0000-0000-000000000001',
      name: 'Travel',
      code: 'TRVL',
      gl_account_id: '00000000-0000-0000-0000-000000000404',
      description: 'Business travel expenses',
      rules: {
        keywords: ['hotel', 'airline', 'uber', 'taxi', 'rental car'],
        merchants: []
      },
      active: true,
      created_by: '00000000-0000-0000-0000-000000000101',
      created_at: knex.fn.now(),
      updated_at: knex.fn.now()
    },
    // TechStart Inc Categories
    {
      id: '00000000-0000-0000-0000-000000000701',
      organization_id: '00000000-0000-0000-0000-000000000002',
      name: 'Software Licenses',
      code: 'SOFT',
      gl_account_id: '00000000-0000-0000-0000-000000000502',
      description: 'Software and SaaS subscriptions',
      rules: {
        keywords: ['software', 'saas', 'subscription', 'license'],
        merchants: ['github', 'aws', 'google', 'microsoft']
      },
      active: true,
      created_by: '00000000-0000-0000-0000-000000000201',
      created_at: knex.fn.now(),
      updated_at: knex.fn.now()
    }
  ];

  await knex('categories').insert(categories);

  // Insert Merchants
  const merchants = [
    // Common merchants for both organizations
    {
      id: '00000000-0000-0000-0000-000000000801',
      organization_id: '00000000-0000-0000-0000-000000000001',
      name: 'Starbucks Coffee',
      normalized_name: 'starbucks',
      aliases: ['starbucks', 'sbux', 'starbucks coffee'],
      default_category_id: '00000000-0000-0000-0000-000000000602',
      address: {
        street: '123 Main St',
        city: 'New York',
        state: 'NY',
        zip: '10001'
      },
      contact_info: {
        phone: '+1-800-782-7282',
        website: 'starbucks.com'
      },
      active: true,
      created_by: '00000000-0000-0000-0000-000000000101',
      created_at: knex.fn.now(),
      updated_at: knex.fn.now()
    },
    {
      id: '00000000-0000-0000-0000-000000000802',
      organization_id: '00000000-0000-0000-0000-000000000001',
      name: 'Amazon Business',
      normalized_name: 'amazon',
      aliases: ['amazon', 'amazon business', 'amzn'],
      default_category_id: '00000000-0000-0000-0000-000000000601',
      address: {
        street: '410 Terry Ave N',
        city: 'Seattle',
        state: 'WA',
        zip: '98109'
      },
      contact_info: {
        phone: '+1-888-280-4331',
        website: 'amazon.com'
      },
      active: true,
      created_by: '00000000-0000-0000-0000-000000000101',
      created_at: knex.fn.now(),
      updated_at: knex.fn.now()
    },
    {
      id: '00000000-0000-0000-0000-000000000803',
      organization_id: '00000000-0000-0000-0000-000000000002',
      name: 'GitHub',
      normalized_name: 'github',
      aliases: ['github', 'github inc'],
      default_category_id: '00000000-0000-0000-0000-000000000701',
      address: {
        street: '88 Colin P Kelly Jr St',
        city: 'San Francisco',
        state: 'CA',
        zip: '94107'
      },
      contact_info: {
        website: 'github.com'
      },
      active: true,
      created_by: '00000000-0000-0000-0000-000000000201',
      created_at: knex.fn.now(),
      updated_at: knex.fn.now()
    }
  ];

  await knex('merchants').insert(merchants);

  // Insert Financial Accounts
  const accounts = [
    // Acme Corporation Accounts
    {
      id: '00000000-0000-0000-0000-000000000901',
      organization_id: '00000000-0000-0000-0000-000000000001',
      name: 'Business Checking',
      account_type: 'checking',
      encrypted_account_number: 'encrypted_1234567890', // In production, use proper encryption
      bank_name: 'First National Bank',
      routing_number: '123456789',
      current_balance: 50000.00,
      currency: 'USD',
      default_gl_account_id: '00000000-0000-0000-0000-000000000401',
      metadata: {
        account_nickname: 'Main Operating',
        last_statement_date': '2024-01-31'
      },
      active: true,
      created_by: '00000000-0000-0000-0000-000000000101',
      created_at: knex.fn.now(),
      updated_at: knex.fn.now()
    },
    {
      id: '00000000-0000-0000-0000-000000000902',
      organization_id: '00000000-0000-0000-0000-000000000001',
      name: 'Corporate Credit Card',
      account_type: 'credit_card',
      encrypted_account_number: 'encrypted_4111111111111111',
      bank_name: 'Chase Bank',
      current_balance: -2500.00, // Negative for credit card
      currency: 'USD',
      metadata: {
        credit_limit: 25000,
        statement_date: 15,
        due_date: 10
      },
      active: true,
      created_by: '00000000-0000-0000-0000-000000000101',
      created_at: knex.fn.now(),
      updated_at: knex.fn.now()
    },
    // TechStart Inc Accounts
    {
      id: '00000000-0000-0000-0000-000000001001',
      organization_id: '00000000-0000-0000-0000-000000000002',
      name: 'Startup Checking',
      account_type: 'checking',
      encrypted_account_number: 'encrypted_9876543210',
      bank_name: 'Silicon Valley Bank',
      routing_number: '987654321',
      current_balance: 75000.00,
      currency: 'USD',
      default_gl_account_id: '00000000-0000-0000-0000-000000000501',
      metadata: {
        account_nickname: 'Main Business'
      },
      active: true,
      created_by: '00000000-0000-0000-0000-000000000201',
      created_at: knex.fn.now(),
      updated_at: knex.fn.now()
    }
  ];

  await knex('accounts').insert(accounts);

  console.log('Seeded GL accounts, categories, merchants, and financial accounts');
};