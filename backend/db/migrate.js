require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('./pool');

const migrationName = '001_initial_schema';
const migrationFile = path.join(__dirname, '001_initial_schema.sql');

async function migrate() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is missing. Copy .env.example to .env and set your local PostgreSQL connection.');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const result = await client.query(
      'SELECT 1 FROM schema_migrations WHERE name = $1',
      [migrationName],
    );

    if (result.rowCount === 0) {
      const sql = fs.readFileSync(migrationFile, 'utf8');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [migrationName]);
      console.log(`Migration ${migrationName} applied successfully.`);
    } else {
      console.log(`Migration ${migrationName} was already applied.`);
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((error) => {
  console.error('Database migration failed:', error.message);
  process.exitCode = 1;
});
