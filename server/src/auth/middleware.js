const jwt = require('jsonwebtoken');
const { pool } = require('../db/pool');
const { COOKIE_NAME, TOKEN_ISSUER, TOKEN_AUDIENCE, getJwtSecret } = require('./config');

function readCookie(req, name) {
  const entry = (req.headers.cookie || '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));

  if (!entry) return null;
  try {
    return decodeURIComponent(entry.slice(name.length + 1));
  } catch {
    return null;
  }
}

async function requireAuth(req, res, next) {
  const secret = getJwtSecret();
  if (!secret) {
    return res.status(503).json({ message: 'Authentication is not configured. Set JWT_SECRET in server/.env.' });
  }

  const authorization = req.get('authorization') || '';
  const bearerToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : null;
  const token = readCookie(req, COOKIE_NAME) || bearerToken;
  if (!token) return res.status(401).json({ message: 'Please sign in to continue.' });

  let payload;
  try {
    payload = jwt.verify(token, secret, { issuer: TOKEN_ISSUER, audience: TOKEN_AUDIENCE });
  } catch {
    return res.status(401).json({ message: 'Your session has expired or is invalid.' });
  }
  if (!payload.sub) return res.status(401).json({ message: 'This session is invalid.' });

  try {
    const result = await pool.query(
      `SELECT u.id, u.full_name, u.email, u.role, u.created_at, u.session_version,
        COALESCE(da.status, 'approved') AS approval_status
       FROM users u LEFT JOIN driver_applications da ON da.driver_id = u.id
       WHERE u.id = $1 LIMIT 1`,
      [payload.sub],
    );
    const row = result.rows[0];
    if (!row || !['client', 'driver', 'admin'].includes(row.role)) {
      return res.status(401).json({ message: 'This account is unavailable or has an invalid role.' });
    }
    if (Number(payload.sessionVersion || 0) !== Number(row.session_version || 0)) {
      return res.status(401).json({ message: 'Your session has ended. Please sign in again.' });
    }
    if (row.role === 'driver' && row.approval_status !== 'approved') {
      return res.status(403).json({ message: row.approval_status === 'rejected'
        ? 'Your driver application was not approved.'
        : 'Your driver application is pending administrator approval.' });
    }

    req.user = {
      id: String(row.id),
      fullName: row.full_name,
      email: row.email,
      role: row.role,
      createdAt: row.created_at,
      approvalStatus: row.role === 'driver' ? row.approval_status : undefined,
    };
    return next();
  } catch (error) {
    console.error('Authentication lookup failed:', error.code || error.name);
    return res.status(503).json({ message: 'Unable to verify your account right now.' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ message: 'Please sign in to continue.' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: "You do not have permission to do that." });
    }
    return next();
  };
}

module.exports = { requireAuth, requireRole };
