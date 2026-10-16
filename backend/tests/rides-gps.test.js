const assert = require('node:assert/strict');
const { after, test } = require('node:test');
const express = require('express');
const jwt = require('jsonwebtoken');
const { pool } = require('../db/pool');
const { COOKIE_NAME, TOKEN_ISSUER, TOKEN_AUDIENCE } = require('../auth/config');
const { calculateTrace } = require('../rides/gps');

process.env.JWT_SECRET = 'test-only-secret-that-is-not-used-outside-this-test';
process.env.RIDE_BASE_FARE = '2.00';
process.env.RIDE_PRICE_PER_KM = '0.75';

const realPoolQuery = pool.query.bind(pool);
const realPoolConnect = pool.connect.bind(pool);
const realFetch = global.fetch;
const servers = new Set();

after(async () => {
  global.fetch = realFetch;
  pool.query = realPoolQuery;
  pool.connect = realPoolConnect;
  await Promise.all([...servers].map((server) => new Promise((resolve) => server.close(resolve))));
});

function point(longitude, seconds, extra = {}) {
  return {
    latitude: 42.66, longitude, accuracy_m: 5, speed_mps: 10,
    recorded_at: new Date(Date.UTC(2026, 0, 1, 0, 0, seconds)), ...extra,
  };
}

test('GPS trace sums consecutive segments and filters inaccurate or impossible fixes', () => {
  const trace = calculateTrace([
    point(21.16, 0),
    point(21.161, 10),
    point(21.162, 20),
    point(21.163, 30, { accuracy_m: 90 }),
  ]);
  assert.ok(trace.distanceKm > 0.15 && trace.distanceKm < 0.2);
  assert.equal(trace.pointCount, 3);
  assert.equal(trace.hasLongGap, false);

  const badJump = calculateTrace([
    point(21.16, 0),
    point(22.16, 1),
    point(21.161, 10),
  ]);
  assert.ok(badJump.distanceKm > 0.07 && badJump.distanceKm < 0.1);
  assert.equal(badJump.pointCount, 2);

  const gap = calculateTrace([point(21.16, 0), point(21.161, 100)]);
  assert.equal(gap.hasLongGap, true);

  const drift = calculateTrace([
    point(21.16, 0), point(21.160005, 4), point(21.160001, 8), point(21.160004, 12),
  ]);
  assert.equal(drift.distanceMeters, 0);
});

test('Road estimate helper converts OSRM meters and seconds to km and rounded-up minutes', async () => {
  const { getRoadEstimate } = require('../rides/estimate');
  let requestUrl = '';
  const estimate = await getRoadEstimate(
    { latitude: 42.66, longitude: 21.16 },
    { latitude: 42.67, longitude: 21.18 },
    async (url) => {
      requestUrl = url;
      return { ok: true, async json() {
        return { code: 'Ok', routes: [{ distance: 12345.67, duration: 601 }] };
      } };
    },
  );
  assert.match(requestUrl, /21\.16,42\.66;21\.18,42\.67\?overview=false/);
  assert.deepEqual(estimate, { estimatedDistanceKm: 12.346, estimatedDurationMinutes: 11 });
});

test('Road estimate helper fails clearly when OSRM cannot find a route', async () => {
  const { getRoadEstimate } = require('../rides/estimate');
  await assert.rejects(
    getRoadEstimate(
      { latitude: 42.66, longitude: 21.16 },
      { latitude: 42.67, longitude: 21.18 },
      async () => ({ ok: true, async json() { return { code: 'NoRoute' }; } }),
    ),
    /road estimate is unavailable/i,
  );
});

async function createTestApi(
  initialLocations = [point(21.16, 0), point(21.161, 10)],
  finalSecond = 20,
  failGpsSave = false,
  startedAt = new Date(Date.UTC(2026, 0, 1, 0, 0, 0)),
  driverId = '700',
  assignedDriverId = '700',
  userRole = 'driver',
  clientRideRows = [],
) {
  let rideIsInProgress = true;
  let rideIsAccepted = true;
  let savedValues = null;
  let creationValues = null;
  let estimateRetryValues = null;
  let historyClientId = null;
  let historySql = null;
  const locations = [...initialLocations];
  let transactionStartLength = locations.length;
  pool.query = async (sql, queryValues = []) => {
    if (sql.includes('FROM users u LEFT JOIN driver_applications')) {
      return { rows: [{ id: driverId, full_name: 'Test User', email: 'test@example.invalid', role: userRole, created_at: new Date(), session_version: 0, approval_status: 'approved' }] };
    }
    if (sql.includes('INSERT INTO rides')) {
      creationValues = queryValues;
      return { rows: [{
        id: '41', client_id: driverId, driver_id: null,
        pickup_address: creationValues[1], pickup_latitude: creationValues[2], pickup_longitude: creationValues[3],
        destination_address: creationValues[4], destination_latitude: creationValues[5], destination_longitude: creationValues[6],
        status: 'pending', requested_at: new Date(), started_at: null, ended_at: null,
        estimated_distance_km: creationValues[7], estimated_duration_minutes: creationValues[8],
        distance_source: creationValues[7] == null ? null : 'osrm', base_price: creationValues[9], price_per_km: creationValues[10],
        price: creationValues[11], updated_at: new Date(),
      }] };
    }
    if (sql.includes('FROM rides WHERE id = $1 AND client_id = $2')) {
      if (queryValues[0] !== '41' || queryValues[1] !== driverId || !creationValues) return { rows: [] };
      return { rows: [{
        id: '41', pickup_latitude: creationValues[2], pickup_longitude: creationValues[3],
        destination_latitude: creationValues[5], destination_longitude: creationValues[6], status: 'pending',
        estimated_distance_km: creationValues[7], estimated_duration_minutes: creationValues[8],
        distance_source: creationValues[7] == null ? null : 'osrm',
        base_price: creationValues[9], price_per_km: creationValues[10], price: creationValues[11],
      }] };
    }
    if (sql.includes('UPDATE rides SET estimated_distance_km')) {
      estimateRetryValues = queryValues;
      return { rows: [{
        estimated_distance_km: queryValues[0], estimated_duration_minutes: queryValues[1],
        distance_source: 'osrm', base_price: queryValues[2], price_per_km: queryValues[3], price: queryValues[4],
      }] };
    }
    if (sql.includes('FROM rides r') && sql.includes('WHERE r.client_id = $1')) {
      historyClientId = queryValues[0];
      historySql = sql;
      return { rows: clientRideRows.filter((row) => String(row.client_id) === String(queryValues[0])) };
    }
    throw new Error('Unexpected pool query in GPS test');
  };
  pool.connect = async () => ({
    async query(sql, values = []) {
      if (sql === 'BEGIN') { transactionStartLength = locations.length; return { rows: [] }; }
      if (sql === 'COMMIT') return { rows: [] };
      if (sql === 'ROLLBACK') { locations.length = transactionStartLength; return { rows: [] }; }
      if (sql.includes('SELECT id, started_at FROM rides') && sql.includes('FOR UPDATE')) {
        return rideIsInProgress && values[0] === '41' && values[1] === assignedDriverId
          ? { rows: [{ id: '41', started_at: startedAt }] }
          : { rows: [] };
      }
      if (sql.includes("UPDATE rides SET status = 'in_progress'")) {
        if (!rideIsAccepted || values[0] !== '41' || values[1] !== assignedDriverId) return { rows: [] };
        rideIsAccepted = false;
        rideIsInProgress = true;
        return { rows: [{
          id: '41', status: 'in_progress', start_latitude: null, start_longitude: null,
          started_at: startedAt, updated_at: new Date(),
        }] };
      }
      if (sql.includes('INSERT INTO ride_locations')) {
        if (failGpsSave) {
          const error = new Error('Simulated database connection failure');
          error.code = 'ECONNRESET';
          throw error;
        }
        const location = {
          latitude: values[1], longitude: values[2], accuracy_m: values[3], speed_mps: values[4],
          recorded_at: new Date(Date.UTC(2026, 0, 1, 0, 0, finalSecond)),
        };
        locations.push(location);
        return { rows: [location] };
      }
      if (sql.startsWith('DELETE FROM ride_locations')) {
        locations.length = 0;
        return { rows: [] };
      }
      if (sql.includes('FROM ride_locations')) return { rows: locations };
      if (sql.includes("UPDATE rides SET status = 'completed'")) {
        if (!rideIsInProgress || values[0] !== '41' || values[1] !== assignedDriverId) return { rows: [] };
        savedValues = values;
        assert.match(sql, /driver_id = \$2/);
        assert.match(sql, /status = 'in_progress'/);
        assert.match(sql, /ended_at IS NULL/);
        assert.match(sql, /NOW\(\) - started_at/);
        rideIsInProgress = false;
        return { rows: [{
          id: '41', status: 'completed', end_latitude: null, end_longitude: null,
          ended_at: new Date(), updated_at: new Date(), distance_km: null,
          distance_source: 'osrm', duration_minutes: 4,
          estimated_distance_km: 12.5, estimated_duration_minutes: 18,
          base_price: 2, price_per_km: 0.75, price: 11.38,
        }] };
      }
      throw new Error(`Unexpected client query in GPS test: ${sql}`);
    },
    release() {},
  });

  const app = express();
  app.use(express.json());
  app.use('/api/rides', require('../rides/routes'));
  const server = app.listen(0, '127.0.0.1');
  servers.add(server);
  await new Promise((resolve) => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const token = jwt.sign({}, process.env.JWT_SECRET, {
    subject: driverId, expiresIn: '5m', issuer: TOKEN_ISSUER, audience: TOKEN_AUDIENCE,
  });
  return {
    origin,
    headers: { Cookie: `${COOKIE_NAME}=${encodeURIComponent(token)}`, 'Content-Type': 'application/json' },
    get savedValues() { return savedValues; },
    get creationValues() { return creationValues; },
    get estimateRetryValues() { return estimateRetryValues; },
    get historyClientId() { return historyClientId; },
    get historySql() { return historySql; },
    get locationCount() { return locations.length; },
    get lastLocation() { return locations.at(-1); },
  };
}

test('End Trip preserves the OSRM estimate and actual elapsed duration without requiring device GPS', async () => {
  const api = await createTestApi();
  const response = await realFetch(`${api.origin}/api/rides/41/end`, {
    method: 'PATCH', headers: api.headers,
    body: JSON.stringify({}),
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ride.status, 'completed');
  assert.equal(body.message, 'The driver has arrived. The trip is complete.');
  assert.equal(body.ride.distanceKm, null);
  assert.equal(body.ride.estimatedDistanceKm, 12.5);
  assert.equal(body.ride.estimatedDurationMinutes, 18);
  assert.equal(body.ride.estimatedFare, 11.38);
  assert.equal(body.ride.actualElapsedDurationMinutes, 4);
  assert.equal(body.ride.durationMinutes, 4);
  assert.equal(body.ride.price, 11.38);
  assert.equal(api.savedValues[0], '41');
  assert.equal(api.savedValues[1], '700');
  assert.equal(body.ride.end, null);
  assert.equal(api.locationCount, 2);

  const duplicate = await realFetch(`${api.origin}/api/rides/41/end`, {
    method: 'PATCH', headers: api.headers,
    body: JSON.stringify({ latitude: 42.66, longitude: 21.162, accuracyM: 5 }),
  });
  assert.equal(duplicate.status, 409);
});

test('Client ride request stores addresses, coordinates, OSRM estimate, and calculated fare', async () => {
  const api = await createTestApi([], 20, false, undefined, '700', '700', 'client');
  let routeUrl = '';
  global.fetch = async (url) => {
    routeUrl = url;
    return { ok: true, async json() {
      return { code: 'Ok', routes: [{ distance: 10000, duration: 600 }] };
    } };
  };

  const response = await realFetch(`${api.origin}/api/rides`, {
    method: 'POST', headers: api.headers,
    body: JSON.stringify({
      pickupAddress: 'Pickup Street 1', pickupLatitude: 42.66, pickupLongitude: 21.16,
      destinationAddress: 'Destination Street 2', destinationLatitude: 42.67, destinationLongitude: 21.18,
    }),
  });
  const body = await response.json();
  assert.equal(response.status, 201);
  assert.match(routeUrl, /21\.16,42\.66;21\.18,42\.67/);
  assert.deepEqual(api.creationValues, [
    '700', 'Pickup Street 1', 42.66, 21.16,
    'Destination Street 2', 42.67, 21.18, 10, 10, 2, 0.75, 9.5,
  ]);
  assert.equal(body.ride.pickup.address, 'Pickup Street 1');
  assert.equal(body.ride.destination.address, 'Destination Street 2');
  assert.equal(body.ride.estimatedDistanceKm, 10);
  assert.equal(body.ride.estimatedDurationMinutes, 10);
  assert.equal(body.ride.estimatedFare, 9.5);
});

test('Client ride request is still saved with no invented estimate when OSRM is unavailable', async () => {
  const api = await createTestApi([], 20, false, undefined, '700', '700', 'client');
  global.fetch = async () => ({ ok: true, async json() { return { code: 'NoRoute' }; } });
  const response = await realFetch(`${api.origin}/api/rides`, {
    method: 'POST', headers: api.headers,
    body: JSON.stringify({
      pickupAddress: 'Pickup Street 1', pickupLatitude: 42.66, pickupLongitude: 21.16,
      destinationAddress: 'Destination Street 2', destinationLatitude: 42.67, destinationLongitude: 21.18,
    }),
  });
  const body = await response.json();
  assert.equal(response.status, 201);
  assert.match(body.estimateMessage, /road estimate is unavailable/i);
  assert.equal(body.ride.estimateUnavailable, true);
  assert.equal(body.ride.estimatedDistanceKm, null);
  assert.equal(body.ride.estimatedDurationMinutes, null);
  assert.equal(body.ride.estimatedFare, null);
  assert.equal(body.ride.price, null);
  assert.equal(api.creationValues[7], null);
  assert.equal(api.creationValues[8], null);
  assert.equal(api.creationValues[11], null);
});

test('Client can retry an unavailable estimate for their own pending ride', async () => {
  const api = await createTestApi([], 20, false, undefined, '700', '700', 'client');
  global.fetch = async () => ({ ok: true, async json() { return { code: 'NoRoute' }; } });
  await realFetch(`${api.origin}/api/rides`, {
    method: 'POST', headers: api.headers,
    body: JSON.stringify({ pickupAddress: 'Pickup', pickupLatitude: 42.66, pickupLongitude: 21.16,
      destinationAddress: 'Destination', destinationLatitude: 42.67, destinationLongitude: 21.18 }),
  });
  global.fetch = async () => ({ ok: true, async json() {
    return { code: 'Ok', routes: [{ distance: 10000, duration: 600 }] };
  } });
  const response = await realFetch(`${api.origin}/api/rides/41/estimate`, {
    method: 'POST', headers: api.headers,
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ride.estimatedDistanceKm, 10);
  assert.equal(body.ride.estimatedDurationMinutes, 10);
  assert.equal(body.ride.estimatedFare, 9.5);
  assert.deepEqual(api.estimateRetryValues, [10, 10, 2, 0.75, 9.5, '41', '700']);
});

test('Client ride history query is scoped to the authenticated client', async () => {
  const api = await createTestApi([], 20, false, undefined, '733', '733', 'client');
  const response = await realFetch(`${api.origin}/api/rides`, { headers: api.headers });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(body.rides, []);
  assert.equal(api.historyClientId, '733');
});

test('client ride history returns only the assigned driver phone for that client ride', async () => {
  const ownRide = {
    id: '51', client_id: '733', driver_id: '800', client_name: 'Rider', driver_name: 'Assigned Driver',
    driver_phone: '+383 44 123 456', pickup_address: 'Pickup', pickup_latitude: 42.66, pickup_longitude: 21.16,
    destination_address: 'Destination', destination_latitude: 42.67, destination_longitude: 21.18,
    status: 'accepted', requested_at: new Date(), started_at: null, ended_at: null,
    distance_km: null, distance_source: null, duration_minutes: null,
    estimated_distance_km: 4, estimated_duration_minutes: 12, base_price: 2, price_per_km: 0.75,
    price: 5, updated_at: new Date(), start_latitude: null, start_longitude: null,
    end_latitude: null, end_longitude: null,
  };
  const otherClientRide = { ...ownRide, id: '52', client_id: '734', driver_id: '801', driver_phone: '+383 44 987 654' };
  const rideWithoutDriverPhone = { ...ownRide, id: '53', driver_id: '802', driver_name: 'Legacy Driver', driver_phone: null };
  const api = await createTestApi([], 20, false, undefined, '733', '733', 'client', [ownRide, otherClientRide, rideWithoutDriverPhone]);
  const response = await realFetch(`${api.origin}/api/rides`, { headers: api.headers });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.match(api.historySql, /LEFT JOIN driver_applications/);
  assert.match(api.historySql, /WHERE r\.client_id = \$1/);
  assert.deepEqual(body.rides.map((ride) => ride.id), ['51', '53']);
  assert.equal(body.rides[0].driverPhone, '+383 44 123 456');
  assert.equal(body.rides[0].driverId, '800');
  assert.equal(body.rides[1].driverPhone, null);
});

test('End Trip works without a GPS fix and keeps device coordinates empty', async () => {
  const api = await createTestApi([]);
  const response = await realFetch(`${api.origin}/api/rides/41/end`, {
    method: 'PATCH', headers: api.headers,
    body: JSON.stringify({ latitude: 42.66, longitude: 21.162, accuracyM: 120 }),
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ride.status, 'completed');
  assert.equal(body.ride.end, null);
  assert.equal(api.locationCount, 0);
});

test('End Trip still requires the authenticated driver to own the active ride', async () => {
  const api = await createTestApi(undefined, 20, false, undefined, '999', '700');
  const response = await realFetch(`${api.origin}/api/rides/41/end`, {
    method: 'PATCH', headers: api.headers,
    body: JSON.stringify({ latitude: 42.66, longitude: 21.162, accuracyM: 5 }),
  });
  const body = await response.json();
  assert.equal(response.status, 409);
  assert.match(body.message, /not assigned to you/i);
  assert.equal(api.savedValues, null);
  assert.equal(api.locationCount, 2);
});

test('Start Trip saves timestamp and status without requiring device GPS', async () => {
  const api = await createTestApi([]);
  const response = await realFetch(`${api.origin}/api/rides/41/start`, {
    method: 'PATCH', headers: api.headers, body: JSON.stringify({}),
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ride.status, 'in_progress');
  assert.ok(body.ride.startedAt);
  assert.equal(body.ride.start, null);
  assert.equal(api.locationCount, 0);
});

test('Only the assigned driver can append GPS positions to an active trip', async () => {
  const api = await createTestApi();
  const response = await realFetch(`${api.origin}/api/rides/41/locations`, {
    method: 'POST', headers: api.headers,
    body: JSON.stringify({ latitude: 42.66, longitude: 21.162, accuracyM: 4.5, speedMps: 8 }),
  });
  const body = await response.json();
  assert.equal(response.status, 201);
  assert.equal(body.saved, true);
  assert.equal(body.location.latitude, 42.66);
  assert.ok(body.location.recordedAt);
  assert.equal(api.locationCount, 3);

  const otherRide = await realFetch(`${api.origin}/api/rides/999/locations`, {
    method: 'POST', headers: api.headers,
    body: JSON.stringify({ latitude: 42.66, longitude: 21.162, accuracyM: 4.5 }),
  });
  assert.equal(otherRide.status, 409);
  assert.equal(api.locationCount, 3);

  const anonymous = await realFetch(`${api.origin}/api/rides/41/locations`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ latitude: 42.66, longitude: 21.162, accuracyM: 4.5 }),
  });
  assert.equal(anonymous.status, 401);
});

test('a GPS save failure returns a controlled error and keeps earlier points', async () => {
  const api = await createTestApi(undefined, 20, true);
  const response = await realFetch(`${api.origin}/api/rides/41/locations`, {
    method: 'POST', headers: api.headers,
    body: JSON.stringify({ latitude: 42.66, longitude: 21.162, accuracyM: 5 }),
  });
  const body = await response.json();
  assert.equal(response.status, 500);
  assert.match(body.message, /Unable to save this GPS position/i);
  assert.equal(api.locationCount, 2);
});

test('available drivers exclude accepted or in-progress rides and become assignable again after completion', async () => {
  const users = new Map([
    ['100', { id: '100', full_name: 'Admin', email: 'admin@example.invalid', role: 'admin', created_at: new Date() }],
    ['200', { id: '200', full_name: 'Rider', email: 'rider@example.invalid', role: 'client', created_at: new Date() }],
    ['201', { id: '201', full_name: 'Other Rider', email: 'other@example.invalid', role: 'client', created_at: new Date() }],
    ['300', { id: '300', full_name: 'Driver', email: 'driver@example.invalid', role: 'driver', is_online: true, created_at: new Date() }],
    ['301', { id: '301', full_name: 'Offline Driver', email: 'offline@example.invalid', role: 'driver', is_online: false, created_at: new Date() }],
  ]);
  const makeRide = (id, status, driverId = null) => ({
    id: String(id), client_id: '200', driver_id: driverId, client_name: 'Rider', driver_name: driverId ? 'Driver' : null,
    pickup_address: 'Pickup', pickup_latitude: 42.66, pickup_longitude: 21.16,
    destination_address: 'Destination', destination_latitude: 42.67, destination_longitude: 21.18,
    status, created_at: new Date(), requested_at: new Date(), started_at: null, ended_at: null,
    distance_km: null, distance_source: null, duration_minutes: null,
    estimated_distance_km: null, estimated_duration_minutes: null, base_price: 2, price_per_km: 0.75,
    price: null, updated_at: new Date(), start_latitude: null, start_longitude: null, end_latitude: null, end_longitude: null,
  });
  const rides = [makeRide(1, 'pending'), makeRide(2, 'accepted', '300')];
  const notifications = [];
  const ratings = [];
  const findRide = (id) => rides.find((ride) => ride.id === String(id));
  const app = express();
  app.use(express.json());
  app.use('/api/admin', require('../auth/adminRoutes'));
  app.use('/api/rides', require('../rides/routes'));

  pool.query = async (sql, values = []) => {
    if (sql.includes('FROM driver_notifications n JOIN rides r')) {
      return { rows: notifications.filter((item) => item.driver_id === String(values[0])).map((item) => ({
        id: item.id, ride_id: item.ride_id, notification_type: item.notification_type,
        created_at: item.created_at, read_at: item.read_at, status: findRide(item.ride_id)?.status,
        stars: ratings.find((rating) => rating.ride_id === item.rating_id)?.stars ?? null,
        comment: ratings.find((rating) => rating.ride_id === item.rating_id)?.comment ?? null,
      })) };
    }
    if (sql.includes('UPDATE driver_notifications SET read_at = NOW() WHERE driver_id = $1')) {
      notifications.filter((item) => item.driver_id === String(values[0]) && !item.read_at).forEach((item) => { item.read_at = new Date(); });
      return { rows: [] };
    }
    if (sql.includes('UPDATE driver_notifications SET read_at')) {
      const notification = notifications.find((item) => item.id === String(values[0]) && item.driver_id === String(values[1]));
      if (notification) notification.read_at = new Date();
      return { rows: [] };
    }
    if (sql.includes('SELECT r.id FROM rides r') && sql.includes("r.status = 'completed'")) {
      const ride = findRide(values[0]);
      return { rows: ride && ride.client_id === String(values[1]) && ride.status === 'completed' && ride.driver_id
        && !ratings.some((rating) => rating.ride_id === ride.id) ? [{ id: ride.id }] : [] };
    }
    if (sql.includes('FROM users d LEFT JOIN ride_ratings')) {
      return { rows: [...users.values()].filter((driver) => driver.role === 'driver').map((driver) => {
        const driverRatings = ratings.filter((rating) => rating.driver_id === driver.id);
        return {
          driver_id: driver.id, driver_name: driver.full_name, total_ratings: driverRatings.length,
          average_rating: driverRatings.length ? (driverRatings.reduce((sum, rating) => sum + rating.stars, 0) / driverRatings.length).toFixed(2) : null,
          one_star: driverRatings.filter((rating) => rating.stars === 1).length,
          two_star: driverRatings.filter((rating) => rating.stars === 2).length,
          three_star: driverRatings.filter((rating) => rating.stars === 3).length,
          four_star: driverRatings.filter((rating) => rating.stars === 4).length,
          five_star: driverRatings.filter((rating) => rating.stars === 5).length,
        };
      }) };
    }
    if (sql.includes('FROM ride_ratings rating ORDER BY')) {
      return { rows: ratings.map((rating) => ({ ...rating, created_at: rating.created_at })) };
    }
    if (sql.includes('FROM users u LEFT JOIN driver_applications') && sql.includes('WHERE u.id = $1')) {
      const user = users.get(String(values[0]));
      return { rows: user ? [{ ...user, session_version: 0, approval_status: 'approved' }] : [] };
    }
    if (sql.includes('FROM users u LEFT JOIN driver_presence')) {
      return { rows: [...users.values()].map((user) => ({ ...user, approval_status: 'approved' })) };
    }
    if (sql.includes('SELECT is_online, latitude, longitude, updated_at FROM driver_presence')) {
      const user = users.get(String(values[0]));
      return { rows: user ? [{ is_online: user.is_online, latitude: user.latitude ?? null, longitude: user.longitude ?? null, updated_at: new Date() }] : [] };
    }
    if (sql.includes('FROM rides r LEFT JOIN driver_presence') && sql.includes("r.status = 'accepted'")) {
      const ride = findRide(values[0]);
      const driver = ride?.driver_id ? users.get(ride.driver_id) : null;
      return { rows: ride && ride.client_id === String(values[1]) && ride.status === 'accepted' && driver?.is_online
        ? [{ status: ride.status, pickup_latitude: ride.pickup_latitude, pickup_longitude: ride.pickup_longitude, latitude: driver.latitude, longitude: driver.longitude }]
        : [] };
    }
    if (sql.includes('COUNT(*)::int AS count')) {
      assert.match(sql, /status IN \('accepted', 'in_progress'\)/);
      assert.match(sql, /driver_presence/);
      const busyDrivers = new Set(rides.filter((ride) => ['accepted', 'in_progress'].includes(ride.status)).map((ride) => ride.driver_id));
      return { rows: [{ count: [...users.values()].filter((user) => user.role === 'driver' && user.is_online && !busyDrivers.has(user.id)).length }] };
    }
    if (sql.includes('FROM rides r') && sql.includes('WHERE r.client_id = $1')) {
      return { rows: rides.filter((ride) => ride.client_id === String(values[0])) };
    }
    if (sql.includes('FROM rides r')) return { rows: rides };
    if (sql.includes('UPDATE rides SET status = \'cancelled\'')) {
      const ride = findRide(values[0]);
      if (!ride || ride.client_id !== String(values[1]) || !['pending', 'accepted'].includes(ride.status)) return { rows: [] };
      ride.status = 'cancelled';
      if (ride.driver_id && !notifications.some((item) => item.ride_id === ride.id && item.driver_id === ride.driver_id && item.notification_type === 'ride_cancelled')) {
        notifications.push({ id: String(notifications.length + 1), ride_id: ride.id, driver_id: ride.driver_id, notification_type: 'ride_cancelled', created_at: new Date(), read_at: null });
      }
      return { rows: [{ id: ride.id, status: ride.status, updated_at: new Date() }] };
    }
    throw new Error(`Unexpected availability test query: ${sql}`);
  };
  pool.connect = async () => ({
    async query(sql, values = []) {
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
      if (sql.includes('SELECT id, driver_id, status FROM rides')) {
        const ride = findRide(values[0]);
        return { rows: ride && ride.client_id === String(values[1])
          ? [{ id: ride.id, driver_id: ride.driver_id, status: ride.status }]
          : [] };
      }
      if (sql.includes('INSERT INTO ride_ratings')) {
        const [rideId, clientId, driverId, stars, comment] = values.map((value) => String(value ?? ''));
        if (ratings.some((rating) => rating.ride_id === rideId)) return { rows: [] };
        const rating = { ride_id: rideId, client_id: clientId, driver_id: driverId, stars: Number(stars), comment: comment || null, created_at: new Date() };
        ratings.push(rating);
        return { rows: [{ stars: rating.stars, comment: rating.comment, created_at: rating.created_at }] };
      }
      if (sql.includes('INSERT INTO driver_notifications')) {
        const [driverId, rideId] = values.map(String);
        const notificationType = sql.includes('new_rating_received') ? 'new_rating_received' : 'new_ride_request';
        if (!notifications.some((item) => item.ride_id === rideId && item.driver_id === driverId && item.notification_type === notificationType)) {
          notifications.push({ id: String(notifications.length + 1), ride_id: rideId, driver_id: driverId, notification_type: notificationType, rating_id: notificationType === 'new_rating_received' ? rideId : null, created_at: new Date(), read_at: null });
        }
        return { rows: [] };
      }
      if (sql.includes('SELECT u.id, COALESCE(p.is_online, FALSE)')) {
        const user = users.get(String(values[0]));
        return { rows: user?.role === 'driver' ? [{ id: user.id, is_online: user.is_online, approval_status: 'approved' }] : [] };
      }
      if ((sql.includes('SELECT u.id FROM users u') && sql.includes("u.role = 'driver'"))
        || sql.includes("SELECT id FROM users WHERE id = $1 AND role = 'driver' FOR UPDATE")) {
        const user = users.get(String(values[0]));
        return { rows: user?.role === 'driver' ? [{ id: user.id }] : [] };
      }
      if (sql.includes('SELECT is_online FROM driver_presence')) {
        const user = users.get(String(values[0]));
        return { rows: user?.is_online ? [{ is_online: true }] : [] };
      }
      if (sql.includes('SELECT id FROM rides WHERE driver_id = $1 AND status IN')) {
        assert.match(sql, /status IN \('accepted', 'in_progress'\)/);
        const active = rides.find((ride) => ride.driver_id === String(values[0]) && ['accepted', 'in_progress'].includes(ride.status));
        return { rows: active ? [{ id: active.id }] : [] };
      }
      if (sql.includes('INSERT INTO driver_presence')) {
        const user = users.get(String(values[0]));
        user.is_online = values[1];
        if (values[2] != null) { user.latitude = values[2]; user.longitude = values[3]; }
        return { rows: [{ is_online: user.is_online, latitude: user.latitude ?? null, longitude: user.longitude ?? null, updated_at: new Date() }] };
      }
      if (sql.includes('UPDATE rides SET driver_id')) {
        assert.match(sql, /NOT EXISTS[\s\S]*active\.status IN \('accepted', 'in_progress'\)/);
        const [driverId, rideId] = values.map(String);
        const ride = findRide(rideId);
        const busy = rides.some((item) => item.driver_id === driverId && ['accepted', 'in_progress'].includes(item.status));
        if (!ride || ride.status !== 'pending' || ride.driver_id || busy) return { rows: [] };
        ride.driver_id = driverId;
        ride.driver_name = users.get(driverId).full_name;
        return { rows: [ride] };
      }
      if (sql.includes("UPDATE rides SET status = 'accepted'")) {
        const [rideId, driverId] = values.map(String);
        const ride = findRide(rideId);
        if (!ride || ride.driver_id !== driverId || ride.status !== 'pending') return { rows: [] };
        ride.status = 'accepted';
        return { rows: [{ id: ride.id, status: ride.status, updated_at: new Date() }] };
      }
      throw new Error(`Unexpected availability transaction query: ${sql}`);
    },
    release() {},
  });

  const server = app.listen(0, '127.0.0.1');
  servers.add(server);
  await new Promise((resolve) => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const makeHeaders = (id) => ({
    Authorization: `Bearer ${jwt.sign({}, process.env.JWT_SECRET, {
      subject: id, expiresIn: '5m', issuer: TOKEN_ISSUER, audience: TOKEN_AUDIENCE,
    })}`,
    'Content-Type': 'application/json',
  });

  const adminRides = await realFetch(`${origin}/api/admin/rides`, { headers: makeHeaders('100') });
  const adminRideBody = await adminRides.json();
  assert.equal(adminRides.status, 200);
  assert.equal(adminRideBody.rides.find((ride) => ride.id === '1').status, 'pending');

  const clientRides = await realFetch(`${origin}/api/rides`, { headers: makeHeaders('200') });
  const clientRideBody = await clientRides.json();
  assert.equal(clientRideBody.freeDriverCount, 0);
  assert.equal(clientRideBody.rides.find((ride) => ride.id === '1').status, 'pending');
  const pendingApproachEstimate = await realFetch(`${origin}/api/rides/1/approach-estimate`, { headers: makeHeaders('200') });
  assert.equal(pendingApproachEstimate.status, 404);

  const blockedAssignment = await realFetch(`${origin}/api/admin/rides/1/assign-driver`, {
    method: 'PATCH', headers: makeHeaders('100'), body: JSON.stringify({ driverId: '300' }),
  });
  assert.equal(blockedAssignment.status, 409);
  assert.equal(findRide(1).status, 'pending');
  assert.equal(findRide(1).driver_id, null);

  const driverPresence = await realFetch(`${origin}/api/rides/presence`, { headers: makeHeaders('300') });
  assert.equal((await driverPresence.json()).presence.isOnline, true);
  const offlineDuringActiveRide = await realFetch(`${origin}/api/rides/presence`, {
    method: 'PUT', headers: makeHeaders('300'), body: JSON.stringify({ isOnline: false }),
  });
  assert.equal(offlineDuringActiveRide.status, 409);

  const offlineAssignment = await realFetch(`${origin}/api/admin/rides/1/assign-driver`, {
    method: 'PATCH', headers: makeHeaders('100'), body: JSON.stringify({ driverId: '301' }),
  });
  assert.equal(offlineAssignment.status, 409);
  assert.equal(findRide(1).status, 'pending');

  const cancelled = await realFetch(`${origin}/api/rides/1/cancel`, { method: 'PATCH', headers: makeHeaders('200') });
  assert.equal(cancelled.status, 200);
  assert.equal(findRide(1).status, 'cancelled');

  rides.push(makeRide(6, 'accepted', '300'));
  const assignedCancellation = await realFetch(`${origin}/api/rides/6/cancel`, { method: 'PATCH', headers: makeHeaders('200') });
  assert.equal(assignedCancellation.status, 200);
  const repeatedCancellation = await realFetch(`${origin}/api/rides/6/cancel`, { method: 'PATCH', headers: makeHeaders('200') });
  assert.equal(repeatedCancellation.status, 409);
  const driverRideList = await realFetch(`${origin}/api/rides/assigned`, { headers: makeHeaders('300') });
  assert.equal((await driverRideList.json()).rides.find((ride) => ride.id === '6').status, 'cancelled');
  const driverNotifications = await realFetch(`${origin}/api/rides/notifications`, { headers: makeHeaders('300') });
  const cancellationNotification = (await driverNotifications.json()).notifications.find((item) => item.rideId === '6' && item.type === 'ride_cancelled');
  assert.equal(cancellationNotification.title, 'Ride Cancelled');
  assert.equal(cancellationNotification.message, 'The customer has cancelled the ride.');
  const otherDriverNotifications = await realFetch(`${origin}/api/rides/notifications`, { headers: makeHeaders('301') });
  assert.equal((await otherDriverNotifications.json()).notifications.length, 0);
  const ackNotification = await realFetch(`${origin}/api/rides/notifications/${cancellationNotification.id}/read`, { method: 'PATCH', headers: makeHeaders('300') });
  assert.equal(ackNotification.status, 200);
  const notificationHistory = await realFetch(`${origin}/api/rides/notifications`, { headers: makeHeaders('300') });
  const notificationHistoryBody = await notificationHistory.json();
  assert.equal(notificationHistoryBody.notifications.some((item) => item.id === cancellationNotification.id && item.readAt), true);
  const markAllRead = await realFetch(`${origin}/api/rides/notifications/read-all`, { method: 'PATCH', headers: makeHeaders('300') });
  assert.equal(markAllRead.status, 200);
  const afterMarkAllRead = await realFetch(`${origin}/api/rides/notifications`, { headers: makeHeaders('300') });
  assert.equal((await afterMarkAllRead.json()).notifications.every((item) => item.readAt), true);

  findRide(2).status = 'completed';
  const goOffline = await realFetch(`${origin}/api/rides/presence`, {
    method: 'PUT', headers: makeHeaders('300'), body: JSON.stringify({ isOnline: false }),
  });
  assert.equal(goOffline.status, 200);
  assert.equal((await goOffline.json()).presence.isOnline, false);
  const goOnline = await realFetch(`${origin}/api/rides/presence`, {
    method: 'PUT', headers: makeHeaders('300'), body: JSON.stringify({ isOnline: true, latitude: 42.66, longitude: 21.16 }),
  });
  assert.equal(goOnline.status, 200);
  rides.push(makeRide(3, 'pending'));
  const availableClientRides = await realFetch(`${origin}/api/rides`, { headers: makeHeaders('200') });
  assert.equal((await availableClientRides.json()).freeDriverCount, 1);
  const assigned = await realFetch(`${origin}/api/admin/rides/3/assign-driver`, {
    method: 'PATCH', headers: makeHeaders('100'), body: JSON.stringify({ driverId: '300' }),
  });
  assert.equal(assigned.status, 200);
  assert.equal(findRide(3).status, 'pending');
  const assignmentNotifications = await realFetch(`${origin}/api/rides/notifications`, { headers: makeHeaders('300') });
  const assignmentNotificationBody = await assignmentNotifications.json();
  assert.equal(assignmentNotificationBody.notifications.filter((item) => item.rideId === '3' && item.type === 'new_ride_request').length, 1);
  assert.equal(assignmentNotificationBody.notifications.find((item) => item.rideId === '3').title, 'New Ride Request');
  assert.equal(assignmentNotificationBody.notifications.find((item) => item.rideId === '3').message, 'New ride request received. Check the details and accept or decline the request.');
  const duplicateAssignment = await realFetch(`${origin}/api/admin/rides/3/assign-driver`, {
    method: 'PATCH', headers: makeHeaders('100'), body: JSON.stringify({ driverId: '300' }),
  });
  assert.equal(duplicateAssignment.status, 409);
  const afterDuplicateAssignment = await realFetch(`${origin}/api/rides/notifications`, { headers: makeHeaders('300') });
  assert.equal((await afterDuplicateAssignment.json()).notifications.filter((item) => item.rideId === '3' && item.type === 'new_ride_request').length, 1);
  const assignmentNotificationIsolation = await realFetch(`${origin}/api/rides/notifications`, { headers: makeHeaders('301') });
  assert.equal((await assignmentNotificationIsolation.json()).notifications.length, 0);

  const accepted = await realFetch(`${origin}/api/rides/3/accept`, { method: 'PATCH', headers: makeHeaders('300') });
  assert.equal(accepted.status, 200);
  rides.push(makeRide(4, 'pending', '300'));
  const blockedAccept = await realFetch(`${origin}/api/rides/4/accept`, { method: 'PATCH', headers: makeHeaders('300') });
  assert.equal(blockedAccept.status, 409);
  assert.equal(findRide(4).status, 'pending');

  findRide(3).status = 'completed';
  const lateCancel = await realFetch(`${origin}/api/rides/3/cancel`, { method: 'PATCH', headers: makeHeaders('200') });
  assert.equal(lateCancel.status, 409);
  const invalidRating = await realFetch(`${origin}/api/rides/3/rating`, { method: 'POST', headers: makeHeaders('200'), body: JSON.stringify({ stars: 6 }) });
  assert.equal(invalidRating.status, 400);
  const ratingNotificationsBeforeSave = await realFetch(`${origin}/api/rides/notifications`, { headers: makeHeaders('300') });
  assert.equal((await ratingNotificationsBeforeSave.json()).notifications.some((item) => item.rideId === '3' && item.type === 'new_rating_received'), false);
  const cancelledRideRating = await realFetch(`${origin}/api/rides/6/rating`, { method: 'POST', headers: makeHeaders('200'), body: JSON.stringify({ stars: 5 }) });
  assert.equal(cancelledRideRating.status, 409);
  const unauthorizedRating = await realFetch(`${origin}/api/rides/3/rating`, { method: 'POST', headers: makeHeaders('201'), body: JSON.stringify({ stars: 5 }) });
  assert.equal(unauthorizedRating.status, 409);
  const savedRating = await realFetch(`${origin}/api/rides/3/rating`, { method: 'POST', headers: makeHeaders('200'), body: JSON.stringify({ stars: 4, comment: 'Good ride' }) });
  assert.equal(savedRating.status, 201);
  const ratingNotificationResponse = await realFetch(`${origin}/api/rides/notifications`, { headers: makeHeaders('300') });
  const ratingNotification = (await ratingNotificationResponse.json()).notifications.find((item) => item.rideId === '3' && item.type === 'new_rating_received');
  assert.equal(ratingNotification.title, 'New Rating Received');
  assert.equal(ratingNotification.message, 'You received a new rating!');
  assert.deepEqual(ratingNotification.rating, { stars: 4, comment: 'Good ride' });
  const duplicateRating = await realFetch(`${origin}/api/rides/3/rating`, { method: 'POST', headers: makeHeaders('200'), body: JSON.stringify({ stars: 5 }) });
  assert.equal(duplicateRating.status, 409);
  const afterDuplicateRating = await realFetch(`${origin}/api/rides/notifications`, { headers: makeHeaders('300') });
  assert.equal((await afterDuplicateRating.json()).notifications.filter((item) => item.rideId === '3' && item.type === 'new_rating_received').length, 1);
  const otherDriverRatingNotifications = await realFetch(`${origin}/api/rides/notifications`, { headers: makeHeaders('301') });
  assert.equal((await otherDriverRatingNotifications.json()).notifications.some((item) => item.rideId === '3'), false);
  const adminRatings = await realFetch(`${origin}/api/admin/ratings`, { headers: makeHeaders('100') });
  const adminRatingBody = await adminRatings.json();
  assert.equal(adminRatings.status, 200);
  assert.equal(adminRatingBody.drivers.find((driver) => driver.driverId === '300').averageRating, 4);
  assert.equal(adminRatingBody.drivers.find((driver) => driver.driverId === '301').averageRating, null);
  const pendingRideRating = await realFetch(`${origin}/api/rides/5/rating`, { method: 'POST', headers: makeHeaders('200'), body: JSON.stringify({ stars: 3 }) });
  assert.equal(pendingRideRating.status, 409);
  const acceptedAfterCompletion = await realFetch(`${origin}/api/rides/4/accept`, { method: 'PATCH', headers: makeHeaders('300') });
  assert.equal(acceptedAfterCompletion.status, 200);
  rides.push(makeRide(5, 'pending'));
  const stillBusy = await realFetch(`${origin}/api/admin/rides/5/assign-driver`, {
    method: 'PATCH', headers: makeHeaders('100'), body: JSON.stringify({ driverId: '300' }),
  });
  assert.equal(stillBusy.status, 409);
  findRide(4).status = 'completed';
  const skippedRating = await realFetch(`${origin}/api/rides/4/rating/skip`, { method: 'POST', headers: makeHeaders('200') });
  assert.equal(skippedRating.status, 200);
  const repeatedSkip = await realFetch(`${origin}/api/rides/4/rating/skip`, { method: 'POST', headers: makeHeaders('200') });
  assert.equal(repeatedSkip.status, 200);
  assert.equal(findRide(4).rating_skipped_at, undefined);
  const ratingAfterSkip = await realFetch(`${origin}/api/rides/4/rating`, { method: 'POST', headers: makeHeaders('200'), body: JSON.stringify({ stars: 5 }) });
  assert.equal(ratingAfterSkip.status, 201);
  const afterCompletion = await realFetch(`${origin}/api/admin/rides/5/assign-driver`, {
    method: 'PATCH', headers: makeHeaders('100'), body: JSON.stringify({ driverId: '300' }),
  });
  assert.equal(afterCompletion.status, 200);
  assert.equal(findRide(5).status, 'pending');
});
