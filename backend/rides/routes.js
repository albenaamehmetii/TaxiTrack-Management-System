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

function publicRide(row) {
  return {
    id: String(row.id),
    clientId: String(row.client_id),
    driverId: row.driver_id == null ? null : String(row.driver_id),
    clientName: row.client_name,
    driverName: row.driver_name,
    pickup: { latitude: row.pickup_latitude, longitude: row.pickup_longitude },
    destination: { latitude: row.destination_latitude, longitude: row.destination_longitude },
    status: row.status,
    requestedAt: row.requested_at,
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
        r.destination_latitude, r.destination_longitude, r.status,
        r.requested_at, r.updated_at
       FROM rides r
       JOIN users c ON c.id = r.client_id
       JOIN users d ON d.id = r.driver_id
       WHERE r.driver_id = $1 AND r.status = 'pending'
       ORDER BY r.requested_at ASC`,
      [req.user.id],
    );
    return res.json({ rides: result.rows.map(publicRide) });
  } catch (error) {
    console.error('Assigned ride list failed:', error.code || error.name);
    return res.status(500).json({ message: 'Unable to load your assigned requests.' });
  }
});

module.exports = router;