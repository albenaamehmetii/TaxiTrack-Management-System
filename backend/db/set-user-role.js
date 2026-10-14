require('dotenv').config();
const { pool } = require('./pool');

async function setRole() {
  const email = (process.env.ROLE_CHANGE_EMAIL || '').trim().toLowerCase();
  const confirmedEmail = (process.env.ROLE_CHANGE_CONFIRM_EMAIL || '').trim().toLowerCase();
  const role = (process.env.ROLE_CHANGE_TO || '').trim().toLowerCase();

  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL must be set in backend/.env.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new Error('ROLE_CHANGE_EMAIL must be a valid account email.');
  }
  if (!['admin', 'driver', 'client'].includes(role)) {
    throw new Error('ROLE_CHANGE_TO must be admin, driver, or client.');
  }
  if (!confirmedEmail || confirmedEmail !== email) {
    throw new Error('No changes made. Set ROLE_CHANGE_CONFIRM_EMAIL to the exact ROLE_CHANGE_EMAIL to confirm this role change.');
  }

  const result = await pool.query(
    `UPDATE users
     SET role = $1
     WHERE lower(email) = $2
     RETURNING id, email, role`,
    [role, email],
  );

  if (result.rowCount === 0) throw new Error('No account found for that email; no changes were made.');
  console.log(`Role for ${result.rows[0].email} is now ${result.rows[0].role}.`);
}

setRole()
  .catch((error) => {
    console.error('Role change failed:', error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
