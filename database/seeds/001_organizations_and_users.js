/**
 * Organizations and Users Seed Data
 * Development and testing seed data
 */

const bcrypt = require('bcrypt');

exports.seed = async function(knex) {
  // Clear existing entries (in reverse order due to foreign keys)
  await knex('role_assignments').del();
  await knex('users').del();
  await knex('organizations').del();

  const saltRounds = 10;
  const passwordHash = await bcrypt.hash('password123', saltRounds);

  // Insert organizations
  const organizations = [
    {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'Acme Corporation',
      slug: 'acme-corp',
      description: 'A sample enterprise organization',
      settings: {
        currency: 'USD',
        timezone: 'America/New_York',
        fiscal_year_start: 'January'
      },
      subscription_info: {
        plan: 'enterprise',
        max_users: 100,
        features: ['advanced_reporting', 'api_access', 'sso']
      },
      active: true,
      created_at: knex.fn.now(),
      updated_at: knex.fn.now()
    },
    {
      id: '00000000-0000-0000-0000-000000000002',
      name: 'TechStart Inc',
      slug: 'techstart-inc',
      description: 'A growing technology startup',
      settings: {
        currency: 'USD',
        timezone: 'America/Los_Angeles',
        fiscal_year_start: 'January'
      },
      subscription_info: {
        plan: 'professional',
        max_users: 25,
        features: ['basic_reporting', 'mobile_app']
      },
      active: true,
      created_at: knex.fn.now(),
      updated_at: knex.fn.now()
    }
  ];

  await knex('organizations').insert(organizations);

  // Insert users
  const users = [
    // Acme Corporation users
    {
      id: '00000000-0000-0000-0000-000000000101',
      organization_id: '00000000-0000-0000-0000-000000000001',
      email: 'admin@acme.com',
      password_hash: passwordHash,
      first_name: 'Alice',
      last_name: 'Anderson',
      phone: '+1-555-0101',
      preferences: {
        theme: 'light',
        notifications: true,
        language: 'en'
      },
      email_verified: true,
      active: true,
      created_at: knex.fn.now(),
      updated_at: knex.fn.now()
    },
    {
      id: '00000000-0000-0000-0000-000000000102',
      organization_id: '00000000-0000-0000-0000-000000000001',
      email: 'manager@acme.com',
      password_hash: passwordHash,
      first_name: 'Bob',
      last_name: 'Brown',
      phone: '+1-555-0102',
      preferences: {
        theme: 'dark',
        notifications: true,
        language: 'en'
      },
      email_verified: true,
      active: true,
      created_at: knex.fn.now(),
      updated_at: knex.fn.now()
    },
    {
      id: '00000000-0000-0000-0000-000000000103',
      organization_id: '00000000-0000-0000-0000-000000000001',
      email: 'employee@acme.com',
      password_hash: passwordHash,
      first_name: 'Carol',
      last_name: 'Chen',
      phone: '+1-555-0103',
      preferences: {
        theme: 'light',
        notifications: false,
        language: 'en'
      },
      email_verified: true,
      active: true,
      created_at: knex.fn.now(),
      updated_at: knex.fn.now()
    },
    // TechStart Inc users
    {
      id: '00000000-0000-0000-0000-000000000201',
      organization_id: '00000000-0000-0000-0000-000000000002',
      email: 'founder@techstart.com',
      password_hash: passwordHash,
      first_name: 'David',
      last_name: 'Davis',
      phone: '+1-555-0201',
      preferences: {
        theme: 'dark',
        notifications: true,
        language: 'en'
      },
      email_verified: true,
      active: true,
      created_at: knex.fn.now(),
      updated_at: knex.fn.now()
    },
    {
      id: '00000000-0000-0000-0000-000000000202',
      organization_id: '00000000-0000-0000-0000-000000000002',
      email: 'employee@techstart.com',
      password_hash: passwordHash,
      first_name: 'Eve',
      last_name: 'Evans',
      phone: '+1-555-0202',
      preferences: {
        theme: 'light',
        notifications: true,
        language: 'en'
      },
      email_verified: true,
      active: true,
      created_at: knex.fn.now(),
      updated_at: knex.fn.now()
    }
  ];

  await knex('users').insert(users);

  // Insert role assignments
  const roleAssignments = [
    // Acme Corporation roles
    {
      id: '00000000-0000-0000-0000-000000000301',
      organization_id: '00000000-0000-0000-0000-000000000001',
      user_id: '00000000-0000-0000-0000-000000000101',
      role: 'admin',
      permissions: {
        users: ['create', 'read', 'update', 'delete'],
        accounts: ['create', 'read', 'update', 'delete'],
        transactions: ['create', 'read', 'update', 'delete'],
        receipts: ['create', 'read', 'update', 'delete'],
        reports: ['create', 'read', 'update', 'delete']
      },
      active: true,
      created_by: '00000000-0000-0000-0000-000000000101',
      created_at: knex.fn.now(),
      updated_at: knex.fn.now()
    },
    {
      id: '00000000-0000-0000-0000-000000000302',
      organization_id: '00000000-0000-0000-0000-000000000001',
      user_id: '00000000-0000-0000-0000-000000000102',
      role: 'manager',
      permissions: {
        users: ['read'],
        accounts: ['read', 'update'],
        transactions: ['create', 'read', 'update'],
        receipts: ['create', 'read', 'update'],
        reports: ['create', 'read']
      },
      active: true,
      created_by: '00000000-0000-0000-0000-000000000101',
      created_at: knex.fn.now(),
      updated_at: knex.fn.now()
    },
    {
      id: '00000000-0000-0000-0000-000000000303',
      organization_id: '00000000-0000-0000-0000-000000000001',
      user_id: '00000000-0000-0000-0000-000000000103',
      role: 'employee',
      permissions: {
        accounts: ['read'],
        transactions: ['read'],
        receipts: ['create', 'read', 'update'],
        reports: ['read']
      },
      active: true,
      created_by: '00000000-0000-0000-0000-000000000101',
      created_at: knex.fn.now(),
      updated_at: knex.fn.now()
    },
    // TechStart Inc roles
    {
      id: '00000000-0000-0000-0000-000000000304',
      organization_id: '00000000-0000-0000-0000-000000000002',
      user_id: '00000000-0000-0000-0000-000000000201',
      role: 'admin',
      permissions: {
        users: ['create', 'read', 'update', 'delete'],
        accounts: ['create', 'read', 'update', 'delete'],
        transactions: ['create', 'read', 'update', 'delete'],
        receipts: ['create', 'read', 'update', 'delete'],
        reports: ['create', 'read', 'update', 'delete']
      },
      active: true,
      created_by: '00000000-0000-0000-0000-000000000201',
      created_at: knex.fn.now(),
      updated_at: knex.fn.now()
    },
    {
      id: '00000000-0000-0000-0000-000000000305',
      organization_id: '00000000-0000-0000-0000-000000000002',
      user_id: '00000000-0000-0000-0000-000000000202',
      role: 'employee',
      permissions: {
        accounts: ['read'],
        transactions: ['read'],
        receipts: ['create', 'read', 'update'],
        reports: ['read']
      },
      active: true,
      created_by: '00000000-0000-0000-0000-000000000201',
      created_at: knex.fn.now(),
      updated_at: knex.fn.now()
    }
  ];

  await knex('role_assignments').insert(roleAssignments);

  console.log('Seeded organizations, users, and role assignments');
};