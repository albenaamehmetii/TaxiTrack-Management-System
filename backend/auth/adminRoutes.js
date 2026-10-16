const express = require('express');
const { pool } = require('../db/pool');
const { requireAuth, requireRole } = require('../auth/middleware');

const router = express.Router();

router.get('/users', requireAuth, requireRole('admin'), async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.full_name, u.email, u.role, u.created_at,
        COALESCE(p.is_online, FALSE) AS is_online, p.latitude, p.longitude, p.updated_at AS presence_updated_at
       FROM users u LEFT JOIN driver_presence p ON p.driver_id = u.id ORDER BY u.created_at DESC`,
    );
    return res.json({ users: result.rows.map((row) => ({
      id: String(row.id),
      fullName: row.full_name,
      email: row.email,
      role: row.role,
      createdAt: row.created_at,
      isOnline: row.is_online,
      location: row.latitude == null ? null : { latitude: Number(row.latitude), longitude: Number(row.longitude) },
      presenceUpdatedAt: row.presence_updated_at || null,
    })) });
  } catch (error) {
    console.error('Admin user list failed:', error.code || error.name);
    return res.status(500).json({ message: "Unable to load the user list." });
  }
});

router.get('/ratings', requireAuth, requireRole('admin'), async (_req, res) => {
  try {
    const [summaryResult, detailResult] = await Promise.all([
      pool.query(
        `SELECT d.id AS driver_id, d.full_name AS driver_name,
          COUNT(rating.ride_id)::int AS total_ratings,
          AVG(rating.stars)::numeric(4, 2) AS average_rating,
          COUNT(rating.ride_id) FILTER (WHERE rating.stars = 1)::int AS one_star,
          COUNT(rating.ride_id) FILTER (WHERE rating.stars = 2)::int AS two_star,
          COUNT(rating.ride_id) FILTER (WHERE rating.stars = 3)::int AS three_star,
          COUNT(rating.ride_id) FILTER (WHERE rating.stars = 4)::int AS four_star,
          COUNT(rating.ride_id) FILTER (WHERE rating.stars = 5)::int AS five_star
         FROM users d LEFT JOIN ride_ratings rating ON rating.driver_id = d.id
         WHERE d.role = 'driver'
         GROUP BY d.id, d.full_name ORDER BY d.full_name`,
      ),
      pool.query(
        `SELECT rating.ride_id, rating.driver_id, rating.stars, rating.comment, rating.created_at
         FROM ride_ratings rating ORDER BY rating.created_at DESC, rating.ride_id DESC`,
      ),
    ]);
    const detailsByDriver = new Map();
    for (const row of detailResult.rows) {
      const list = detailsByDriver.get(String(row.driver_id)) || [];
      list.push({
        rideId: String(row.ride_id), stars: Number(row.stars),
        comment: row.comment || '', createdAt: row.created_at,
      });
      detailsByDriver.set(String(row.driver_id), list);
    }
    return res.json({ drivers: summaryResult.rows.map((row) => ({
      driverId: String(row.driver_id), driverName: row.driver_name,
      totalRatings: Number(row.total_ratings), averageRating: row.average_rating == null ? null : Number(row.average_rating),
      distribution: {
        1: Number(row.one_star), 2: Number(row.two_star), 3: Number(row.three_star),
        4: Number(row.four_star), 5: Number(row.five_star),
      },
      ratings: detailsByDriver.get(String(row.driver_id)) || [],
    })) });
  } catch (error) {
    console.error('Admin driver ratings load failed:', error.code || error.name);
    return res.status(500).json({ message: 'Unable to load driver ratings.' });
  }
});

router.get('/rides', requireAuth, requireRole('admin'), async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT r.id, r.client_id, r.driver_id, c.full_name AS client_name,
        d.full_name AS driver_name, r.pickup_address, r.pickup_latitude, r.pickup_longitude,
        r.destination_address, r.destination_latitude, r.destination_longitude, r.status,
        r.created_at, r.requested_at, r.started_at, r.ended_at, r.distance_km, r.distance_source,
        r.duration_minutes, r.estimated_distance_km, r.estimated_duration_minutes,
        dp.is_online AS driver_is_online, dp.latitude AS driver_latitude, dp.longitude AS driver_longitude,
        r.base_price, r.price_per_km, r.price, r.updated_at
       FROM rides r
       JOIN users c ON c.id = r.client_id
       LEFT JOIN users d ON d.id = r.driver_id
       LEFT JOIN driver_presence dp ON dp.driver_id = r.driver_id
       ORDER BY r.created_at DESC`,
    );
    return res.json({ rides: result.rows.map((row) => ({
      id: String(row.id),
      clientId: String(row.client_id),
      driverId: row.driver_id == null ? null : String(row.driver_id),
      clientName: row.client_name,
      driverName: row.driver_name,
      driverOnline: row.driver_is_online === true,
      driverLocation: row.driver_latitude == null ? null : { latitude: Number(row.driver_latitude), longitude: Number(row.driver_longitude) },
      pickup: { address: row.pickup_address || null, latitude: row.pickup_latitude, longitude: row.pickup_longitude },
      destination: { address: row.destination_address || null, latitude: row.destination_latitude, longitude: row.destination_longitude },
      status: row.status,
      createdAt: row.created_at,
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

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const driver = await client.query(
      `SELECT u.id, COALESCE(p.is_online, FALSE) AS is_online
       FROM users u LEFT JOIN driver_presence p ON p.driver_id = u.id
       WHERE u.id = $1 AND u.role = 'driver' FOR UPDATE OF u`, [String(driverId)],
    );
    if (!driver.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Driver not found.' });
    }
    if (!driver.rows[0].is_online) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'This driver is offline. Choose an online driver.' });
    }

    const result = await client.query(
      `UPDATE rides SET driver_id = $1, updated_at = NOW()
       WHERE id = $2 AND status = 'pending' AND driver_id IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM rides active
           WHERE active.driver_id = $1 AND active.status IN ('accepted', 'in_progress')
         )
       RETURNING id, client_id, driver_id, pickup_latitude, pickup_longitude,
         destination_latitude, destination_longitude, status, requested_at, updated_at`,
      [String(driverId), rideId],
    );
    if (!result.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'This driver is no longer available, or this request has already been assigned or is no longer pending.' });
    }
    await client.query(
      `INSERT INTO driver_notifications (driver_id, ride_id, notification_type)
       VALUES ($1, $2, 'new_ride_request')
       ON CONFLICT (ride_id, driver_id, notification_type) DO NOTHING`,
      [String(result.rows[0].driver_id), String(result.rows[0].id)],
    );
    await client.query('COMMIT');
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
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('Ride assignment failed:', error.code || error.name);
    return res.status(500).json({ message: 'Unable to assign this request right now.' });
  } finally {
    client?.release();
  }
});
module.exports = router;
