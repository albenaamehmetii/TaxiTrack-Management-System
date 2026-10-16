const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../db/pool');
const { COOKIE_NAME, TOKEN_ISSUER, TOKEN_AUDIENCE, getJwtSecret } = require('./config');

const router = express.Router();
const oneDayMs = 24 * 60 * 60 * 1000;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const loginAttempts = new Map();
const loginWindowMs = 15 * 60 * 1000;
const maxLoginAttempts = 10;

function publicUser(row) {
  return {
    id: String(row.id),
    fullName: row.full_name,
    email: row.email,
    role: row.role,
    createdAt: row.created_at,
    ...(row.role === 'driver' ? { approvalStatus: row.approval_status || 'approved' } : {}),
  };
}

function setSessionCookie(res, user) {
  const secret = getJwtSecret();
  const token = jwt.sign(
    { email: user.email, role: user.role, sessionVersion: Number(user.session_version || user.sessionVersion || 0) },
    secret,
    { subject: String(user.id), expiresIn: '1d', issuer: TOKEN_ISSUER, audience: TOKEN_AUDIENCE },
  );

  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: oneDayMs,
  });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  });
}

router.post('/register', async (req, res) => {
  if (!getJwtSecret()) {
    return res.status(503).json({ message: 'Authentication is not configured. Set JWT_SECRET in server/.env.' });
  }

  const fullName = typeof req.body?.fullName === 'string' ? req.body.fullName.trim() : '';
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const role = typeof req.body?.role === 'string' ? req.body.role.toLowerCase() : '';
  const phone = typeof req.body?.phone === 'string' ? req.body.phone.trim() : '';
  const licenseNumber = typeof req.body?.licenseNumber === 'string' ? req.body.licenseNumber.trim() : '';
  const vehiclePlate = typeof req.body?.vehiclePlate === 'string' ? req.body.vehiclePlate.trim().toUpperCase() : '';

  if (fullName.length < 2 || fullName.length > 160) {
    return res.status(400).json({ message: 'Name must be between 2 and 160 characters.' });
  }
  if (email.length > 254 || !emailPattern.test(email)) {
    return res.status(400).json({ message: 'Enter a valid email address.' });
  }
  if (password.length < 8 || Buffer.byteLength(password, 'utf8') > 72) {
    return res.status(400).json({ message: 'Password must be at least 8 characters and no more than 72 bytes.' });
  }
  if (!['client', 'driver'].includes(role)) {
    return res.status(400).json({ message: 'Choose Rider or Driver.' });
  }
  if (role === 'driver') {
    if (phone.length < 7 || phone.length > 30 || !/^[+()\d .-]+$/.test(phone)) {
      return res.status(400).json({ message: 'Enter a valid phone number (7 to 30 characters).' });
    }
    if (licenseNumber.length < 3 || licenseNumber.length > 80) {
      return res.status(400).json({ message: 'Enter a valid driver license number (3 to 80 characters).' });
    }
    if (vehiclePlate.length < 2 || vehiclePlate.length > 20) {
      return res.status(400).json({ message: 'Enter a valid vehicle registration number (2 to 20 characters).' });
    }
  }

  let client;
  try {
    const passwordHash = await bcrypt.hash(password, 12);
    client = await pool.connect();
    await client.query('BEGIN');
    const result = await client.query(
      `INSERT INTO users (full_name, email, password_hash, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, full_name, email, role, created_at, session_version`,
      [fullName, email, passwordHash, role],
    );
    const row = result.rows[0];
    if (role === 'driver') {
      await client.query(
        `INSERT INTO driver_applications
         (driver_id, phone, license_number, vehicle_plate, status)
         VALUES ($1, $2, $3, $4, 'pending')`,
        [String(row.id), phone, licenseNumber, vehiclePlate],
      );
      await client.query('COMMIT');
      return res.status(201).json({ applicationSubmitted: true, approvalStatus: 'pending', message: 'Your driver application was submitted. You can log in after an administrator approves it.' });
    }
    await client.query('COMMIT');
    const user = publicUser({ ...row, approval_status: 'approved' });
    setSessionCookie(res, { ...user, session_version: row.session_version });
    return res.status(201).json({ user });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23505') {
      return res.status(409).json({ message: 'An account with this email already exists.' });
    }
    console.error('Registration failed:', error.code || error.name);
    return res.status(500).json({ message: "Unable to create your account. Please try again." });
  } finally {
    client?.release();
  }
});

router.post('/login', (req, res, next) => {
  const now = Date.now();
  for (const [key, attempts] of loginAttempts) {
    if (now - attempts.startedAt >= loginWindowMs) loginAttempts.delete(key);
  }
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const key = `${req.ip || req.socket.remoteAddress || 'unknown'}:${email}`;
  const attempts = loginAttempts.get(key);
  if (attempts && attempts.count >= maxLoginAttempts && now - attempts.startedAt < loginWindowMs) {
    return res.status(429).json({ message: 'Too many sign-in attempts. Please wait 15 minutes and try again.' });
  }
  req.loginAttemptKey = key;
  return next();
}, async (req, res) => {
  if (!getJwtSecret()) {
    return res.status(503).json({ message: 'Authentication is not configured. Set JWT_SECRET in server/.env.' });
  }

  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!emailPattern.test(email) || !password) {
    return res.status(400).json({ message: 'Enter your email and password.' });
  }

  try {
    const result = await pool.query(
      `SELECT u.id, u.full_name, u.email, u.password_hash, u.role, u.created_at, u.session_version,
        COALESCE(da.status, 'approved') AS approval_status
       FROM users u LEFT JOIN driver_applications da ON da.driver_id = u.id
       WHERE lower(u.email) = $1 LIMIT 1`,
      [email],
    );
    const row = result.rows[0];
    if (!row || !(await bcrypt.compare(password, row.password_hash))) {
      const now = Date.now();
      const current = loginAttempts.get(req.loginAttemptKey);
      loginAttempts.set(req.loginAttemptKey, current && now - current.startedAt < loginWindowMs
        ? { ...current, count: current.count + 1 }
        : { startedAt: now, count: 1 });
      return res.status(401).json({ message: 'Email or password is incorrect.' });
    }
    if (row.role === 'driver' && row.approval_status !== 'approved') {
      return res.status(403).json({ message: row.approval_status === 'rejected'
        ? 'Your driver application was not approved. Contact the administrator for more information.'
        : 'Your driver application is pending administrator approval.' });
    }

    loginAttempts.delete(req.loginAttemptKey);
    const user = publicUser(row);
    setSessionCookie(res, { ...user, session_version: row.session_version });
    return res.json({ user });
  } catch (error) {
    console.error('Login failed:', error.code || error.name);
    return res.status(500).json({ message: "Unable to sign you in. Please try again." });
  }
});

router.get('/me', async (req, res) => {
  const cookieHeader = req.get('cookie') || '';
  const cookieEntry = cookieHeader.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE_NAME}=`));
  let cookieToken = null;
  if (cookieEntry) {
    try {
      cookieToken = decodeURIComponent(cookieEntry.slice(COOKIE_NAME.length + 1));
    } catch {
      clearSessionCookie(res);
      return res.status(401).json({ message: 'Your session is invalid. Please sign in again.' });
    }
  }
  const authorization = req.get('authorization') || '';
  const bearerToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : null;
  const token = cookieToken || bearerToken;

  if (!token) return res.json({ authenticated: false, user: null });

  const secret = getJwtSecret();
  if (!secret) {
    return res.status(503).json({ message: 'Authentication is not configured. Set JWT_SECRET in server/.env.' });
  }

  let payload;
  try {
    payload = jwt.verify(token, secret, { issuer: TOKEN_ISSUER, audience: TOKEN_AUDIENCE });
  } catch {
    clearSessionCookie(res);
    return res.status(401).json({ message: 'Your session has expired or is invalid. Please sign in again.' });
  }
  if (!payload.sub) {
    clearSessionCookie(res);
    return res.status(401).json({ message: 'Your session is invalid. Please sign in again.' });
  }

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
      clearSessionCookie(res);
      return res.status(401).json({ message: 'This account is unavailable. Please sign in again.' });
    }
    if (Number(payload.sessionVersion || 0) !== Number(row.session_version || 0)) {
      clearSessionCookie(res);
      return res.status(401).json({ message: 'Your session has ended. Please sign in again.' });
    }
    if (row.role === 'driver' && row.approval_status !== 'approved') {
      clearSessionCookie(res);
      return res.status(403).json({ message: row.approval_status === 'rejected'
        ? 'Your driver application was not approved.'
        : 'Your driver application is pending administrator approval.' });
    }
    return res.json({ authenticated: true, user: publicUser(row) });
  } catch (error) {
    console.error('Session lookup failed:', error.code || error.name);
    return res.status(500).json({ message: "Unable to load your session." });
  }
});

router.post('/logout', async (req, res) => {
  const cookieHeader = req.get('cookie') || '';
  const cookieEntry = cookieHeader.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE_NAME}=`));
  const authorization = req.get('authorization') || '';
  let token = authorization.startsWith('Bearer ') ? authorization.slice(7) : null;
  if (!token && cookieEntry) {
    try { token = decodeURIComponent(cookieEntry.slice(COOKIE_NAME.length + 1)); } catch { token = null; }
  }
  if (token && getJwtSecret()) {
    try {
      const payload = jwt.verify(token, getJwtSecret(), { issuer: TOKEN_ISSUER, audience: TOKEN_AUDIENCE });
      if (payload.sub) {
        await pool.query(
          'UPDATE users SET session_version = session_version + 1 WHERE id = $1 AND session_version = $2',
          [payload.sub, Number(payload.sessionVersion || 0)],
        );
      }
    } catch (error) {
      if (error.name !== 'JsonWebTokenError' && error.name !== 'TokenExpiredError' && error.name !== 'NotBeforeError') {
        console.error('Logout session revocation failed:', error.code || error.name);
        clearSessionCookie(res);
        return res.status(503).json({ message: 'Unable to end your session right now.' });
      }
    }
  }
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  });
  return res.json({ message: "You are signed out." });
});

module.exports = router;
