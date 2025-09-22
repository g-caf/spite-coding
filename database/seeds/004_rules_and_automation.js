/**
 * Rules and Automation Seed
 * Sample categorization rules and business logic
 */

exports.seed = async function(knex) {
  // Clear existing entries
  await knex('rules').del();

  // Insert categorization and automation rules
  const rules = [
    // Acme Corporation Rules
    {
      id: '00000000-0000-0000-0000-000000001801',
      organization_id: '00000000-0000-0000-0000-000000000001',
      name: 'Auto-categorize Starbucks as Business Meals',
      description: 'Automatically categorize all Starbucks transactions as business meals',
      conditions: {
        merchant_names: ['starbucks', 'starbucks coffee'],
        amount_range: { min: 1.00, max: 100.00 }
      },
      actions: {
        set_category: '00000000-0000-0000-0000-000000000602', // Business Meals
        set_memo: 'Auto-categorized as business meal'
      },
      priority: 100,
      active: true,
      match_count: 0,
      created_by: '00000000-0000-0000-0000-000000000101',
      created_at: knex.fn.now(),
      updated_at: knex.fn.now()
    },
    {
      id: '00000000-0000-0000-0000-000000001802',
      organization_id: '00000000-0000-0000-0000-000000000001',
      name: 'Auto-categorize Amazon Business as Office Supplies',
      description: 'Categorize Amazon Business purchases as office supplies',
      conditions: {
        merchant_names: ['amazon business', 'amazon'],
        description_keywords: ['office', 'supplies', 'paper', 'pens', 'desk']
      },
      actions: {
        set_category: '00000000-0000-0000-0000-000000000601', // Office Supplies
        require_receipt: true,
        notify_manager: true
      },
      priority: 90,
      active: true,
      match_count: 0,
      created_by: '00000000-0000-0000-0000-000000000101',
      created_at: knex.fn.now(),
      updated_at: knex.fn.now()
    },
    {
      id: '00000000-0000-0000-0000-000000001803',
      organization_id: '00000000-0000-0000-0000-000000000001',
      name: 'Flag High-Value Transactions for Review',
      description: 'Flag transactions over $500 for manager review',
      conditions: {
        amount_range: { min: 500.00 }
      },
      actions: {
        flag_for_review: true,
        notify_manager: true,
        require_receipt: true,
        require_justification: true
      },
      priority: 200,
      active: true,
      match_count: 0,
      created_by: '00000000-0000-0000-0000-000000000101',
      created_at: knex.fn.now(),
      updated_at: knex.fn.now()
    },
    {
      id: '00000000-0000-0000-0000-000000001804',
      organization_id: '00000000-0000-0000-0000-000000000001',
      name: 'Travel Expense Auto-Categorization',
      description: 'Auto-categorize travel-related expenses',
      conditions: {
        merchant_categories: ['airline', 'hotel', 'car_rental'],
        description_keywords: ['flight', 'hotel', 'rental', 'uber', 'taxi', 'airport']
      },
      actions: {
        set_category: '00000000-0000-0000-0000-000000000603', // Travel
        require_receipt: true,
        set_memo: 'Business travel expense'
      },
      priority: 80,
      active: true,
      match_count: 0,
      created_by: '00000000-0000-0000-0000-000000000101',
      created_at: knex.fn.now(),
      updated_at: knex.fn.now()
    },
    // TechStart Inc Rules
    {
      id: '00000000-0000-0000-0000-000000001901',
      organization_id: '00000000-0000-0000-0000-000000000002',
      name: 'Software Subscription Auto-Categorization',
      description: 'Automatically categorize software subscriptions',
      conditions: {
        merchant_names: ['github', 'aws', 'google', 'microsoft', 'adobe', 'slack', 'zoom'],
        is_recurring: true
      },
      actions: {
        set_category: '00000000-0000-0000-0000-000000000701', // Software Licenses
        set_memo: 'Monthly software subscription',
        auto_approve: true
      },
      priority: 100,
      active: true,
      match_count: 0,
      created_by: '00000000-0000-0000-0000-000000000201',
      created_at: knex.fn.now(),
      updated_at: knex.fn.now()
    },
    {
      id: '00000000-0000-0000-0000-000000001902',
      organization_id: '00000000-0000-0000-0000-000000000002',
      name: 'Startup Expense Approval Workflow',
      description: 'All expenses over $200 require founder approval',
      conditions: {
        amount_range: { min: 200.00 }
      },
      actions: {
        require_approval: true,
        notify_users: ['00000000-0000-0000-0000-000000000201'], // Founder
        block_auto_approval: true
      },
      priority: 300,
      active: true,
      match_count: 0,
      created_by: '00000000-0000-0000-0000-000000000201',
      created_at: knex.fn.now(),
      updated_at: knex.fn.now()
    },
    {
      id: '00000000-0000-0000-0000-000000001903',
      organization_id: '00000000-0000-0000-0000-000000000002',
      name: 'Duplicate Transaction Detection',
      description: 'Flag potential duplicate transactions',
      conditions: {
        duplicate_detection: {
          time_window_hours: 24,
          amount_tolerance: 0.01,
          same_merchant: true
        }
      },
      actions: {
        flag_as_duplicate: true,
        notify_users: ['00000000-0000-0000-0000-000000000201'],
        require_manual_review: true
      },
      priority: 400,
      active: true,
      match_count: 0,
      created_by: '00000000-0000-0000-0000-000000000201',
      created_at: knex.fn.now(),
      updated_at: knex.fn.now()
    }
  ];

  await knex('rules').insert(rules);

  console.log('Seeded automation rules and business logic');
};