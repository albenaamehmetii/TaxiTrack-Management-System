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

router.get('/rides', requireAuth, requireRole('admin'), async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT r.id, r.client_id, r.driver_id, c.full_name AS client_name,
        d.full_name AS driver_name, r.pickup_address, r.pickup_latitude, r.pickup_longitude,
        r.destination_address, r.destination_latitude, r.destination_longitude, r.status,
        r.requested_at, r.started_at, r.ended_at, r.distance_km, r.distance_source,
        r.duration_minutes, r.estimated_distance_km, r.estimated_duration_minutes,
        r.base_price, r.price_per_km, r.price, r.updated_at
       FROM rides r
       JOIN users c ON c.id = r.client_id
       LEFT JOIN users d ON d.id = r.driver_id
       ORDER BY r.created_at DESC`,
    );
    return res.json({ rides: result.rows.map((row) => ({
      id: String(row.id),
      clientId: String(row.client_id),
      driverId: row.driver_id == null ? null : String(row.driver_id),
      clientName: row.client_name,
      driverName: row.driver_name,
      pickup: { address: row.pickup_address || null, latitude: row.pickup_latitude, longitude: row.pickup_longitude },
      destination: { address: row.destination_address || null, latitude: row.destination_latitude, longitude: row.destination_longitude },
      status: row.status,
      requestedAt: row.requested_at,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      distanceKm: row.distance_km == null ? null : Number(row.distance_km),
      distanceSource: row.distance_source || null,
      durationMinutes: row.duration_minutes == null ? null : Number(row.duration_minutes),
      estimatedDistanceKm: row.estimated_distance_km == null
        ? (row.distance_source === 'osrm' && row.distance_km != null ? Number(row.distance_km) : null)
        : Number(row.estimated_distance_km),
      estimatedDurationMinutes: row.estimated_duration_minutes == null
        ? null : Number(row.estimated_duration_minutes),
      estimatedFare: row.distance_source === 'osrm' && row.price != null ? Number(row.price) : null,
      actualElapsedDurationMinutes: row.duration_minutes == null ? null : Number(row.duration_minutes),
      basePrice: row.base_price == null ? null : Number(row.base_price),
      pricePerKm: row.price_per_km == null ? null : Number(row.price_per_km),
      price: row.price == null ? null : Number(row.price),
      updatedAt: row.updated_at,
    })) });
  } catch (error) {
    console.error('Admin ride list failed:', error.code || error.name);
    return res.status(500).json({ message: 'Unable to load ride requests.' });
  }
});

router.patch('/rides/:id/assign-driver', requireAuth, requireRole('admin'), async (req, res) => {
  const rideId = req.params.id;
  const driverId = req.body?.driverId;
  if (!/^[0-9]+$/.test(rideId) || BigInt(rideId) < 1n) {
    return res.status(400).json({ message: 'Ride ID is invalid.' });
  }
  if (!(typeof driverId === 'string' || typeof driverId === 'number') || !/^[0-9]+$/.test(String(driverId)) || BigInt(driverId) < 1n) {
    return res.status(400).json({ message: 'Choose a valid driver.' });
  }

  try {
    const driver = await pool.query('SELECT id FROM users WHERE id = $1 AND role = \'driver\' LIMIT 1', [String(driverId)]);
    if (!driver.rows[0]) return res.status(404).json({ message: 'Driver not found.' });

    const result = await pool.query(
      `UPDATE rides SET driver_id = $1, updated_at = NOW()
       WHERE id = $2 AND status = 'pending' AND driver_id IS NULL
       RETURNING id, client_id, driver_id, pickup_latitude, pickup_longitude,
         destination_latitude, destination_longitude, status, requested_at, updated_at`,
      [String(driverId), rideId],
    );
    if (!result.rows[0]) {
      return res.status(409).json({ message: 'This request has already been assigned or is no longer pending.' });
    }
    return res.json({ ride: {
      id: String(result.rows[0].id),
      clientId: String(result.rows[0].client_id),
      driverId: String(result.rows[0].driver_id),
      pickup: { latitude: result.rows[0].pickup_latitude, longitude: result.rows[0].pickup_longitude },
      destination: { latitude: result.rows[0].destination_latitude, longitude: result.rows[0].destination_longitude },
      status: result.rows[0].status,
      requestedAt: result.rows[0].requested_at,
      updatedAt: result.rows[0].updated_at,
    } });
  } catch (error) {
    console.error('Ride assignment failed:', error.code || error.name);
    return res.status(500).json({ message: 'Unable to assign this request right now.' });
  }
});
module.exports = router;
