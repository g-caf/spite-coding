/**
 * Organizations and Users Migration
 * Core entities for multi-tenant architecture with RBAC
 */

exports.up = async function(knex) {
  // Organizations table (top-level tenant isolation)
  await knex.schema.createTable('organizations', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.string('name').notNullable();
    table.string('slug').notNullable().unique();
    table.text('description');
    table.jsonb('settings').defaultTo('{}');
    table.jsonb('subscription_info').defaultTo('{}');
    table.boolean('active').defaultTo(true);
    table.timestamps(true, true);
    table.uuid('created_by');
    table.uuid('updated_by');
    
    // Indexes
    table.index(['active']);
    table.index(['slug']);
  });

  // Users table
  await knex.schema.createTable('users', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('organization_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
    table.string('email').notNullable();
    table.string('password_hash').notNullable();
    table.string('first_name').notNullable();
    table.string('last_name').notNullable();
    table.text('encrypted_ssn'); // Encrypted PII
    table.string('phone');
    table.jsonb('preferences').defaultTo('{}');
    table.timestamp('last_login_at');
    table.timestamp('password_changed_at').defaultTo(knex.fn.now());
    table.boolean('email_verified').defaultTo(false);
    table.boolean('active').defaultTo(true);
    table.timestamps(true, true);
    table.uuid('created_by');
    table.uuid('updated_by');
    
    // Constraints and indexes
    table.unique(['organization_id', 'email']);
    table.index(['organization_id']);
    table.index(['email']);
    table.index(['active']);
    table.index(['last_login_at']);
  });

  // Role assignments table (RBAC)
  await knex.schema.createTable('role_assignments', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('organization_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
    table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.enu('role', ['admin', 'manager', 'employee', 'viewer']).notNullable();
    table.jsonb('permissions').defaultTo('{}'); // Fine-grained permissions
    table.timestamp('expires_at');
    table.boolean('active').defaultTo(true);
    table.timestamps(true, true);
    table.uuid('created_by').references('id').inTable('users');
    table.uuid('updated_by').references('id').inTable('users');
    
    // Constraints
    table.unique(['organization_id', 'user_id', 'role']);
    table.index(['organization_id']);
    table.index(['user_id']);
    table.index(['role']);
    table.index(['active']);
    table.index(['expires_at']);
  });

  // Audit events table (immutable audit trail)
  await knex.schema.createTable('audit_events', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('organization_id');
    table.enu('event_type', ['create', 'update', 'delete', 'login', 'logout', 'permission_grant', 'permission_revoke', 'data_export']).notNullable();
    table.string('table_name');
    table.uuid('record_id');
    table.uuid('user_id');
    table.string('ip_address');
    table.string('user_agent');
    table.jsonb('old_values');
    table.jsonb('new_values');
    table.jsonb('metadata').defaultTo('{}');
    table.timestamp('created_at').defaultTo(knex.fn.now());
    
    // Indexes for audit queries
    table.index(['organization_id']);
    table.index(['event_type']);
    table.index(['table_name']);
    table.index(['record_id']);
    table.index(['user_id']);
    table.index(['created_at']);
    table.index(['organization_id', 'created_at']);
  });

  // Enable Row Level Security
  await knex.raw(`
    ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
    ALTER TABLE users ENABLE ROW LEVEL SECURITY;
    ALTER TABLE role_assignments ENABLE ROW LEVEL SECURITY;
    ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
  `);

  // RLS Policies for multi-tenant isolation
  await knex.raw(`
    -- Organizations: Users can only see their own organization
    CREATE POLICY organizations_isolation ON organizations
      FOR ALL USING (id = current_setting('app.current_organization_id')::uuid);
    
    -- Users: Only see users in same organization
    CREATE POLICY users_isolation ON users
      FOR ALL USING (organization_id = current_setting('app.current_organization_id')::uuid);
    
    -- Role assignments: Only see roles in same organization
    CREATE POLICY role_assignments_isolation ON role_assignments
      FOR ALL USING (organization_id = current_setting('app.current_organization_id')::uuid);
    
    -- Audit events: Only see events in same organization
    CREATE POLICY audit_events_isolation ON audit_events
      FOR ALL USING (organization_id = current_setting('app.current_organization_id')::uuid);
  `);

  // Add audit triggers
  await knex.raw(`
    CREATE TRIGGER organizations_audit AFTER INSERT OR UPDATE OR DELETE ON organizations
      FOR EACH ROW EXECUTE FUNCTION audit_trigger();
      
    CREATE TRIGGER users_audit AFTER INSERT OR UPDATE OR DELETE ON users
      FOR EACH ROW EXECUTE FUNCTION audit_trigger();
      
    CREATE TRIGGER role_assignments_audit AFTER INSERT OR UPDATE OR DELETE ON role_assignments
      FOR EACH ROW EXECUTE FUNCTION audit_trigger();
  `);
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('audit_events');
  await knex.schema.dropTableIfExists('role_assignments');
  await knex.schema.dropTableIfExists('users');
  await knex.schema.dropTableIfExists('organizations');
};