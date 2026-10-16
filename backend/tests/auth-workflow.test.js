const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../db/pool');
const authRoutes = require('../auth/routes');
const adminRoutes = require('../auth/adminRoutes');
const { requireAuth, requireRole } = require('../auth/middleware');
const { TOKEN_ISSUER, TOKEN_AUDIENCE } = require('../auth/config');

test('driver applications, role access, login throttling, and logout revocation work together', async (t) => {
  process.env.JWT_SECRET = 'auth-workflow-test-secret-with-at-least-32-characters';
  const users = new Map();
  const applications = new Map();
  let nextId = 1;
  const adminHash = await bcrypt.hash('AdministratorPass123', 4);
  users.set('900', {
    id: '900', full_name: 'Admin User', email: 'admin@example.test',
    password_hash: adminHash, role: 'admin', created_at: new Date(), session_version: 0,
  });

  pool.query = async (sql, values = []) => {
    if (sql.includes('FROM users u LEFT JOIN driver_applications da') && sql.includes('WHERE u.id = $1')) {
      const row = users.get(String(values[0]));
      const application = row && applications.get(row.id);
      return { rows: row ? [{ ...row, approval_status: application?.status || 'approved' }] : [] };
    }
    if (sql.includes('FROM users u LEFT JOIN driver_applications da') && sql.includes('WHERE lower(u.email) = $1')) {
      const row = [...users.values()].find((item) => item.email.toLowerCase() === values[0]);
      const application = row && applications.get(row.id);
      return { rows: row ? [{ ...row, approval_status: application?.status || 'approved' }] : [] };
    }
    if (sql.startsWith('UPDATE users SET session_version')) {
      const row = users.get(String(values[0]));
      if (row && row.session_version === Number(values[1])) row.session_version += 1;
      return { rows: [] };
    }
    if (sql.includes('FROM driver_applications a JOIN users u')) {
      return { rows: [...applications.values()].map((application) => ({ ...application, ...users.get(application.driver_id) })) };
    }
    throw new Error(`Unexpected auth test query: ${sql}`);
  };
  pool.connect = async () => ({
    async query(sql, values = []) {
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
      if (sql.includes('INSERT INTO users')) {
        const [fullName, email, passwordHash, role] = values;
        const id = String(++nextId);
        const row = { id, full_name: fullName, email, password_hash: passwordHash, role, created_at: new Date(), session_version: 0 };
        users.set(id, row);
        return { rows: [row] };
      }
      if (sql.includes('INSERT INTO driver_applications')) {
        const [driverId, phone, licenseNumber, vehiclePlate] = values;
        applications.set(String(driverId), {
          driver_id: String(driverId), phone, license_number: licenseNumber,
          vehicle_plate: vehiclePlate,
          status: 'pending', submitted_at: new Date(),
        });
        return { rows: [] };
      }
      if (sql.includes('UPDATE driver_applications SET status')) {
        const [status, reviewedBy, driverId] = values;
        const application = applications.get(String(driverId));
        if (!application || application.status !== 'pending') return { rows: [] };
        Object.assign(application, { status, reviewed_by: reviewedBy, reviewed_at: new Date() });
        return { rows: [{ driver_id: driverId, status }] };
      }
      if (sql.includes('UPDATE driver_presence SET is_online')) return { rows: [] };
      throw new Error(`Unexpected auth transaction query: ${sql}`);
    },
    release() {},
  });

  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.use('/api/admin', adminRoutes);
  app.get('/protected/rider', requireAuth, requireRole('client'), (_req, res) => res.json({ ok: true }));
  app.get('/protected/driver', requireAuth, requireRole('driver'), (_req, res) => res.json({ ok: true }));
  app.get('/protected/admin', requireAuth, requireRole('admin'), (_req, res) => res.json({ ok: true }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const setCookie = (response) => response.headers.get('set-cookie')?.split(';')[0];
  const post = (path, body, cookie) => fetch(`${origin}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });

  const invalidDriver = await post('/api/auth/register', { fullName: 'New Driver', email: 'driver@example.test', password: 'SecurePass123', role: 'driver' });
  assert.equal(invalidDriver.status, 400);
  const adminRegistration = await post('/api/auth/register', { fullName: 'Fake Admin', email: 'fake@example.test', password: 'SecurePass123', role: 'admin' });
  assert.equal(adminRegistration.status, 400);

  const driverRegistration = await post('/api/auth/register', {
    fullName: 'New Driver', email: 'driver@example.test', password: 'SecurePass123', role: 'driver',
    phone: '+383 44 123 456', licenseNumber: 'DL-123456', vehiclePlate: '01-ABC-23',
  });
  assert.equal(driverRegistration.status, 201);
  assert.equal(setCookie(driverRegistration), undefined);
  const driverId = [...users.values()].find((row) => row.email === 'driver@example.test').id;
  assert.equal(applications.get(driverId).status, 'pending');
  const pendingToken = jwt.sign({ sessionVersion: 0 }, process.env.JWT_SECRET, {
    subject: driverId, expiresIn: '5m', issuer: TOKEN_ISSUER, audience: TOKEN_AUDIENCE,
  });
  assert.equal((await fetch(`${origin}/protected/driver`, { headers: { Authorization: `Bearer ${pendingToken}` } })).status, 403);
  const pendingLogin = await post('/api/auth/login', { email: 'driver@example.test', password: 'SecurePass123' });
  assert.equal(pendingLogin.status, 403);

  const adminLogin = await post('/api/auth/login', { email: 'admin@example.test', password: 'AdministratorPass123' });
  assert.equal(adminLogin.status, 200);
  const adminCookie = setCookie(adminLogin);
  const list = await fetch(`${origin}/api/admin/driver-applications`, { headers: { Cookie: adminCookie } });
  assert.equal(list.status, 200);
  const applicationData = await list.json();
  assert.equal(applicationData.applications[0].licenseNumber, 'DL-123456');
  const approved = await fetch(`${origin}/api/admin/driver-applications/${driverId}/review`, {
    method: 'PATCH', headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision: 'approved' }),
  });
  assert.equal(approved.status, 200);

  const driverLogin = await post('/api/auth/login', { email: 'driver@example.test', password: 'SecurePass123' });
  assert.equal(driverLogin.status, 200);
  const driverCookie = setCookie(driverLogin);
  assert.equal((await fetch(`${origin}/protected/driver`, { headers: { Cookie: driverCookie } })).status, 200);
  assert.equal((await fetch(`${origin}/protected/admin`, { headers: { Cookie: driverCookie } })).status, 403);

  const rejectedRegistration = await post('/api/auth/register', {
    fullName: 'Rejected Driver', email: 'rejected@example.test', password: 'SecurePass123', role: 'driver',
    phone: '+383 44 123 457', licenseNumber: 'DL-789123', vehiclePlate: '02-DEF-34',
  });
  assert.equal(rejectedRegistration.status, 201);
  const rejectedId = [...users.values()].find((row) => row.email === 'rejected@example.test').id;
  const rejected = await fetch(`${origin}/api/admin/driver-applications/${rejectedId}/review`, {
    method: 'PATCH', headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision: 'rejected' }),
  });
  assert.equal(rejected.status, 200);
  const rejectedLogin = await post('/api/auth/login', { email: 'rejected@example.test', password: 'SecurePass123' });
  assert.equal(rejectedLogin.status, 403);

  const riderRegistration = await post('/api/auth/register', { fullName: 'Rider User', email: 'rider@example.test', password: 'SecurePass123', role: 'client' });
  assert.equal(riderRegistration.status, 201);
  const riderCookie = setCookie(riderRegistration);
  assert.equal((await fetch(`${origin}/protected/rider`, { headers: { Cookie: riderCookie } })).status, 200);
  assert.equal((await fetch(`${origin}/protected/driver`, { headers: { Cookie: riderCookie } })).status, 403);
  const riderLogout = await post('/api/auth/logout', {}, riderCookie);
  assert.equal(riderLogout.status, 200);
  assert.equal((await fetch(`${origin}/protected/rider`, { headers: { Cookie: riderCookie } })).status, 401);
  const newRiderLogin = await post('/api/auth/login', { email: 'rider@example.test', password: 'SecurePass123' });
  const newRiderCookie = setCookie(newRiderLogin);
  await post('/api/auth/logout', {}, riderCookie);
  assert.equal((await fetch(`${origin}/protected/rider`, { headers: { Cookie: newRiderCookie } })).status, 200);

  const rateLimitEmail = 'throttle@example.test';
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await post('/api/auth/login', { email: rateLimitEmail, password: 'wrong-password' });
    assert.equal(response.status, 401);
  }
  const throttled = await post('/api/auth/login', { email: rateLimitEmail, password: 'wrong-password' });
  assert.equal(throttled.status, 429);
});
