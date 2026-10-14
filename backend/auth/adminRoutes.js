const express = require('express');
const { pool } = require('../db/pool');
const { requireAuth, requireRole } = require('../auth/middleware');

const router = express.Router();

router.get('/users', requireAuth, requireRole('admin'), async (_req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, full_name, email, role, created_at FROM users ORDER BY created_at DESC',
    );
    return res.json({ users: result.rows.map((row) => ({
      id: String(row.id),
      fullName: row.full_name,
      email: row.email,
      role: row.role,
      createdAt: row.created_at,
    })) });
  } catch (error) {
    console.error('Admin user list failed:', error.code || error.name);
    return res.status(500).json({ message: "Unable to load the user list." });
  }
});

module.exports = router;
