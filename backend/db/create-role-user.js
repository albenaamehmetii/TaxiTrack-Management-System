require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool } = require('./pool');

async function createRoleUser() {
  const fullName = (process.env.SEED_USER_FULL_NAME || '').trim();
  const email = (process.env.SEED_USER_EMAIL || '').trim().toLowerCase();
  const password = process.env.SEED_USER_PASSWORD || '';
  const role = (process.env.SEED_USER_ROLE || '').trim().toLowerCase();

  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL must be set in backend/.env.');
  if (fullName.length < 2 || fullName.length > 160) throw new Error('SEED_USER_FULL_NAME must contain 2 to 160 characters.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error('SEED_USER_EMAIL must be a valid email.');
  if (password.length < 12 || Buffer.byteLength(password, 'utf8') > 72) throw new Error('SEED_USER_PASSWORD must contain 12 to 72 bytes.');
  if (!['admin', 'driver'].includes(role)) throw new Error('SEED_USER_ROLE must be admin or driver.');

  const passwordHash = await bcrypt.hash(password, 12);
  try {
    await pool.query(
      'INSERT INTO users (full_name, email, password_hash, role) VALUES ($1, $2, $3, $4)',
      [fullName, email, passwordHash, role],
    );
    console.log(`Created ${role} account for ${email}.`);
  } catch (error) {
    if (error.code === '23505') throw new Error('That email already has an account; no changes were made. Use npm run auth:set-role with exact email confirmation to change an existing role.');
    throw error;
  }
}

createRoleUser()
  .catch((error) => {
    console.error('Role account creation failed:', error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
