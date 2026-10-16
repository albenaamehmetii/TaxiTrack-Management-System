require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('./pool');
const MIGRATIONS_DIR = path.resolve(__dirname, '../../migrations');

async function migrate() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is missing. Copy .env.example to .env and set your local PostgreSQL connection.');
  }

  const migrationFiles = fs.readdirSync(MIGRATIONS_DIR)
    .filter((file) => /^\d+_.+\.sql$/.test(file))
    .sort();
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    for (const file of migrationFiles) {
      const migrationName = path.basename(file, '.sql');
      await client.query('BEGIN');
      try {
        const result = await client.query(
          'SELECT 1 FROM schema_migrations WHERE name = $1',
          [migrationName],
        );
        if (result.rowCount === 0) {
          const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
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
      }
    }
  } catch (error) {
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
