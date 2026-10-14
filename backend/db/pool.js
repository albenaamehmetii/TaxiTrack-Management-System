const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || undefined,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (error) => {
  console.error('Unexpected PostgreSQL connection error:', error.code || error.message);
});

module.exports = { pool };
