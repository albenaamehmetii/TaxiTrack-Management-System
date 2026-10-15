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
) {
  let rideIsInProgress = true;
  let rideIsAccepted = true;
  let savedValues = null;
  let creationValues = null;
  let estimateRetryValues = null;
  let historyClientId = null;
  const locations = [...initialLocations];
  let transactionStartLength = locations.length;
  pool.query = async (sql, queryValues = []) => {
    if (sql.includes('SELECT id, full_name, email, role, created_at FROM users')) {
      return { rows: [{ id: driverId, full_name: 'Test User', email: 'test@example.invalid', role: userRole, created_at: new Date() }] };
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
      return { rows: [] };
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
        if (!rideIsAccepted || values[2] !== '41' || values[3] !== assignedDriverId) return { rows: [] };
        rideIsAccepted = false;
        rideIsInProgress = true;
        return { rows: [{
          id: '41', status: 'in_progress', start_latitude: values[0], start_longitude: values[1],
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
    get locationCount() { return locations.length; },
    get lastLocation() { return locations.at(-1); },
  };
}

test('End Trip preserves the OSRM estimate, stores actual elapsed duration without GPS, and blocks duplicates', async () => {
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

test('End Trip ignores absent or inaccurate GPS positions instead of waiting for tracking', async () => {
  const api = await createTestApi([]);
  const response = await realFetch(`${api.origin}/api/rides/41/end`, {
    method: 'PATCH', headers: api.headers,
    body: JSON.stringify({ latitude: 42.66, longitude: 21.162, accuracyM: 120 }),
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ride.status, 'completed');
  assert.equal(body.ride.estimatedDistanceKm, 12.5);
  assert.equal(body.ride.estimatedFare, 11.38);
  assert.equal(body.ride.end, null);
  assert.equal(body.ride.actualElapsedDurationMinutes, 4);
  assert.equal(api.locationCount, 0);
});

test('End Trip still requires the authenticated driver to own the active ride', async () => {
  const api = await createTestApi(undefined, 20, false, undefined, '999', '700');
  const response = await realFetch(`${api.origin}/api/rides/41/end`, {
    method: 'PATCH', headers: api.headers,
    body: JSON.stringify({ latitude: 42.66, longitude: 21.162, accuracyM: 120 }),
  });
  const body = await response.json();
  assert.equal(response.status, 409);
  assert.match(body.message, /not assigned to you/i);
  assert.equal(api.savedValues, null);
  assert.equal(api.locationCount, 2);
});

test('Start Trip saves the timestamp and status without a GPS position', async () => {
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
