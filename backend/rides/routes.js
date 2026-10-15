const express = require('express');
const { pool } = require('../db/pool');
const { requireAuth, requireRole } = require('../auth/middleware');

const router = express.Router();

function validCoordinate(latitude, longitude) {
  return Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && latitude >= -90 && latitude <= 90
    && longitude >= -180 && longitude <= 180;
}

function validRideId(id) {
  return /^[0-9]+$/.test(id) && BigInt(id) > 0n;
}

function publicRide(row) {
  return {
    id: String(row.id),
    clientId: String(row.client_id),
    driverId: row.driver_id == null ? null : String(row.driver_id),
    clientName: row.client_name,
    driverName: row.driver_name,
    pickup: { latitude: row.pickup_latitude, longitude: row.pickup_longitude },
    destination: { latitude: row.destination_latitude, longitude: row.destination_longitude },
    start: row.start_latitude == null ? null : { latitude: row.start_latitude, longitude: row.start_longitude },
    end: row.end_latitude == null ? null : { latitude: row.end_latitude, longitude: row.end_longitude },
    status: row.status,
    requestedAt: row.requested_at,
    startedAt: row.started_at || null,
    endedAt: row.ended_at || null,
    updatedAt: row.updated_at,
  };
}

router.post('/', requireAuth, requireRole('client'), async (req, res) => {
  const { pickupLatitude, pickupLongitude, destinationLatitude, destinationLongitude } = req.body || {};
  if (!validCoordinate(pickupLatitude, pickupLongitude)
    || !validCoordinate(destinationLatitude, destinationLongitude)) {
    return res.status(400).json({ message: 'Choose valid pickup and destination points on the map.' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO rides (
        client_id, pickup_latitude, pickup_longitude,
        destination_latitude, destination_longitude
      ) VALUES ($1, $2, $3, $4, $5)
      RETURNING id, client_id, driver_id, pickup_latitude, pickup_longitude,
        destination_latitude, destination_longitude, status, requested_at, updated_at`,
      [req.user.id, pickupLatitude, pickupLongitude, destinationLatitude, destinationLongitude],
    );
    return res.status(201).json({ ride: publicRide(result.rows[0]) });
  } catch (error) {
    console.error('Ride request creation failed:', error.code || error.name);
    return res.status(500).json({ message: 'Unable to create your ride request right now.' });
  }
});

router.get('/assigned', requireAuth, requireRole('driver'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT r.id, r.client_id, r.driver_id, c.full_name AS client_name,
        d.full_name AS driver_name, r.pickup_latitude, r.pickup_longitude,
        r.destination_latitude, r.destination_longitude,
        r.start_latitude, r.start_longitude, r.end_latitude, r.end_longitude,
        r.status, r.requested_at, r.started_at, r.ended_at, r.updated_at
       FROM rides r
       JOIN users c ON c.id = r.client_id
       JOIN users d ON d.id = r.driver_id
       WHERE r.driver_id = $1 AND r.status IN ('pending', 'accepted', 'in_progress')
       ORDER BY r.requested_at ASC`,
      [req.user.id],
    );
    return res.json({ rides: result.rows.map(publicRide) });
  } catch (error) {
    console.error('Assigned ride list failed:', error.code || error.name);
    return res.status(500).json({ message: 'Unable to load your assigned requests.' });
  }
});

router.patch('/:id/accept', requireAuth, requireRole('driver'), async (req, res) => {
  const rideId = req.params.id;
  if (!validRideId(rideId)) return res.status(400).json({ message: 'Ride ID is invalid.' });

  try {
    const result = await pool.query(
      `UPDATE rides SET status = 'accepted', updated_at = NOW()
       WHERE id = $1 AND driver_id = $2 AND status = 'pending'
       RETURNING id, status, updated_at`,
      [rideId, req.user.id],
    );
    if (!result.rows[0]) {
      return res.status(409).json({ message: 'This request is not assigned to you or is no longer pending.' });
    }
    return res.json({ ride: { id: String(result.rows[0].id), status: result.rows[0].status, updatedAt: result.rows[0].updated_at } });
  } catch (error) {
    console.error('Ride acceptance failed:', error.code || error.name);
    return res.status(500).json({ message: 'Unable to accept this request right now.' });
  }
});

router.patch('/:id/start', requireAuth, requireRole('driver'), async (req, res) => {
  const rideId = req.params.id;
  const { latitude, longitude } = req.body || {};
  if (!validRideId(rideId)) return res.status(400).json({ message: 'Ride ID is invalid.' });
  if (!validCoordinate(latitude, longitude)) {
    return res.status(400).json({ message: 'Current coordinates are required to start the trip.' });
  }

  try {
    const result = await pool.query(
      `UPDATE rides SET status = 'in_progress', start_latitude = $1,
        start_longitude = $2, started_at = NOW(), updated_at = NOW()
       WHERE id = $3 AND driver_id = $4 AND status = 'accepted' AND started_at IS NULL
       RETURNING id, status, start_latitude, start_longitude, started_at, updated_at`,
      [latitude, longitude, rideId, req.user.id],
    );
    if (!result.rows[0]) {
      return res.status(409).json({ message: 'This request is not assigned to you or is not ready to start.' });
    }
    const row = result.rows[0];
    return res.json({ ride: {
      id: String(row.id), status: row.status,
      start: { latitude: row.start_latitude, longitude: row.start_longitude },
      startedAt: row.started_at, updatedAt: row.updated_at,
    } });
  } catch (error) {
    console.error('Trip start failed:', error.code || error.name);
    return res.status(500).json({ message: 'Unable to start this trip right now.' });
  }
});

router.patch('/:id/end', requireAuth, requireRole('driver'), async (req, res) => {
  const rideId = req.params.id;
  const { latitude, longitude } = req.body || {};
  if (!validRideId(rideId)) return res.status(400).json({ message: 'Ride ID is invalid.' });
  if (!validCoordinate(latitude, longitude)) {
    return res.status(400).json({ message: 'Current coordinates are required to end the trip.' });
  }

  try {
    const result = await pool.query(
      `UPDATE rides SET status = 'completed', end_latitude = $1,
        end_longitude = $2, ended_at = NOW(), updated_at = NOW()
       WHERE id = $3 AND driver_id = $4 AND status = 'in_progress'
         AND started_at IS NOT NULL AND ended_at IS NULL
       RETURNING id, status, end_latitude, end_longitude, ended_at, updated_at`,
      [latitude, longitude, rideId, req.user.id],
    );
    if (!result.rows[0]) {
      return res.status(409).json({ message: 'This request is not assigned to you or is not in progress.' });
    }
    const row = result.rows[0];
    return res.json({ ride: {
      id: String(row.id), status: row.status,
      end: { latitude: row.end_latitude, longitude: row.end_longitude },
      endedAt: row.ended_at, updatedAt: row.updated_at,
    } });
  } catch (error) {
    console.error('Trip end failed:', error.code || error.name);
    return res.status(500).json({ message: 'Unable to end this trip right now.' });
  }
});

module.exports = router;