/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> } 
 */
exports.seed = async function(knex) {
  // Skip seeding in production
  if (process.env.NODE_ENV === 'production') {
    return;
  }

  // Deletes ALL existing entries
  await knex('users').del();
  await knex('organizations').del();

  // Insert default organization
  const [organization] = await knex('organizations').insert([
    {
      name: 'Default Organization',
      slug: 'default',
      description: 'Default organization for development',
      active: true
    }
  ]).returning('*');

  // Insert default admin user
  const bcrypt = require('bcrypt');
  const passwordHash = await bcrypt.hash('admin123', 10);

  await knex('users').insert([
    {
      organization_id: organization.id,
      email: 'admin@example.com',
      password_hash: passwordHash,
      first_name: 'Admin',
      last_name: 'User',
      role: 'admin',
      active: true
    }
  ]);
};
