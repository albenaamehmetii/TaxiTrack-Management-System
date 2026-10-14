const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { pool } = require('./db/pool');
const authRoutes = require('./auth/routes');
const adminRoutes = require('./auth/adminRoutes');
const ridesRoutes = require('./rides/routes');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const frontendOrigin = process.env.FRONTEND_URL || 'http://localhost:5173';

app.use(cors({ origin: frontendOrigin, credentials: true }));
app.use(express.json({ limit: '16kb' }));

app.get('/', (_req, res) => {
  res.json({ message: 'TaxiTrack API is running!' });
});

app.get('/api/health', async (_req, res) => {
  if (!process.env.DATABASE_URL) {
    return res.status(503).json({
      status: 'error',
      message: 'Backend is running, but DATABASE_URL is not configured.',
      database: 'disconnected',
    });
  }

  try {
    await pool.query('SELECT 1');
    return res.json({
      status: 'ok',
      message: 'Backend and PostgreSQL are connected.',
      database: 'connected',
    });
  } catch (_error) {
    return res.status(503).json({
      status: 'error',
      message: 'Backend is running, but PostgreSQL is unavailable. Check DATABASE_URL and the database server.',
      database: 'disconnected',
    });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/rides', ridesRoutes);
app.use('/api/admin', adminRoutes);

app.use((error, _req, res, _next) => {
  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({ message: 'Request body must be valid JSON.' });
  }
  console.error('Unhandled API error:', error.code || error.name);
  return res.status(500).json({ message: 'An unexpected server error occurred.' });
});

app.listen(PORT, () => {
  console.log(`TaxiTrack server running at http://localhost:${PORT}`);
});
