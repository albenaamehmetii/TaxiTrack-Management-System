const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../db/pool');
const { COOKIE_NAME, TOKEN_ISSUER, TOKEN_AUDIENCE, getJwtSecret } = require('./config');

const router = express.Router();
const oneDayMs = 24 * 60 * 60 * 1000;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function publicUser(row) {
  return {
    id: String(row.id),
    fullName: row.full_name,
    email: row.email,
    role: row.role,
    createdAt: row.created_at,
  };
}

function setSessionCookie(res, user) {
  const secret = getJwtSecret();
  const token = jwt.sign(
    { email: user.email, role: user.role },
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
    return res.status(503).json({ message: 'Authentication is not configured. Set JWT_SECRET in backend/.env.' });
  }

  const fullName = typeof req.body?.fullName === 'string' ? req.body.fullName.trim() : '';
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const role = typeof req.body?.role === 'string' ? req.body.role.toLowerCase() : '';

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

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO users (full_name, email, password_hash, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, full_name, email, role, created_at`,
      [fullName, email, passwordHash, role],
    );
    const user = publicUser(result.rows[0]);
    setSessionCookie(res, user);
    return res.status(201).json({ user });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ message: 'An account with this email already exists.' });
    }
    console.error('Registration failed:', error.code || error.name);
    return res.status(500).json({ message: "Unable to create your account. Please try again." });
  }
});

router.post('/login', async (req, res) => {
  if (!getJwtSecret()) {
    return res.status(503).json({ message: 'Authentication is not configured. Set JWT_SECRET in backend/.env.' });
  }

  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!emailPattern.test(email) || !password) {
    return res.status(400).json({ message: 'Enter your email and password.' });
  }

  try {
    const result = await pool.query(
      'SELECT id, full_name, email, password_hash, role, created_at FROM users WHERE lower(email) = $1 LIMIT 1',
      [email],
    );
    const row = result.rows[0];
    if (!row || !(await bcrypt.compare(password, row.password_hash))) {
      return res.status(401).json({ message: 'Email or password is incorrect.' });
    }

    const user = publicUser(row);
    setSessionCookie(res, user);
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
    return res.status(503).json({ message: 'Authentication is not configured. Set JWT_SECRET in backend/.env.' });
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
      'SELECT id, full_name, email, role, created_at FROM users WHERE id = $1 LIMIT 1',
      [payload.sub],
    );
    const row = result.rows[0];
    if (!row || !['client', 'driver', 'admin'].includes(row.role)) {
      clearSessionCookie(res);
      return res.status(401).json({ message: 'This account is unavailable. Please sign in again.' });
    }
    return res.json({ authenticated: true, user: publicUser(row) });
  } catch (error) {
    console.error('Session lookup failed:', error.code || error.name);
    return res.status(500).json({ message: "Unable to load your session." });
  }
});

router.post('/logout', (_req, res) => {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  });
  return res.json({ message: "You are signed out." });
});

module.exports = router;
