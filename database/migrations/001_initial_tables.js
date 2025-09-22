/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema
    .createTable('organizations', function(table) {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.string('name').notNullable();
      table.string('slug').unique().notNullable();
      table.text('description');
      table.jsonb('settings').defaultTo('{}');
      table.boolean('active').defaultTo(true);
      table.timestamps(true, true);
    })
    .createTable('users', function(table) {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('organization_id').references('id').inTable('organizations').onDelete('CASCADE');
      table.string('email').notNullable();
      table.string('password_hash');
      table.string('first_name').notNullable();
      table.string('last_name').notNullable();
      table.string('role').defaultTo('employee');
      table.boolean('active').defaultTo(true);
      table.timestamp('last_login');
      table.jsonb('preferences').defaultTo('{}');
      table.timestamps(true, true);
      
      table.unique(['organization_id', 'email']);
      table.index(['organization_id', 'active']);
    })
    .createTable('sessions', function(table) {
      table.string('sid').primary();
      table.jsonb('sess').notNullable();
      table.timestamp('expire').notNullable();
      
      table.index('expire');
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema
    .dropTableIfExists('sessions')
    .dropTableIfExists('users')
    .dropTableIfExists('organizations');
};
