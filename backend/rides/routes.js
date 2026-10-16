const express = require('express');
const { pool } = require('../db/pool');
const { requireAuth, requireRole } = require('../auth/middleware');
const { getRoadEstimate } = require('./estimate');

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

function validGpsMetadata(accuracyM, speedMps) {
  return Number.isFinite(accuracyM) && accuracyM >= 0 && accuracyM <= 10000
    && (speedMps == null || (Number.isFinite(speedMps) && speedMps >= 0 && speedMps <= 1000));
}

function gpsPointBody(body) {
  const latitude = body?.latitude;
  const longitude = body?.longitude;
  const accuracyM = body?.accuracyM;
  const speedMps = body?.speedMps == null ? null : body.speedMps;
  if (!validCoordinate(latitude, longitude) || !validGpsMetadata(accuracyM, speedMps)) return null;
  const recordedAt = body?.recordedAt == null ? null : new Date(body.recordedAt);
  if (recordedAt && (!Number.isFinite(recordedAt.getTime())
    || recordedAt.getTime() > Date.now() + 30000
    || recordedAt.getTime() < Date.now() - (24 * 60 * 60 * 1000))) return null;
  return { latitude, longitude, accuracyM, speedMps, recordedAt };
}

async function insertGpsPoint(client, rideId, point) {
  const result = await client.query(
    `INSERT INTO ride_locations (ride_id, latitude, longitude, accuracy_m, speed_mps, recorded_at)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, NOW()))
     RETURNING latitude, longitude, accuracy_m, speed_mps, recorded_at`,
    [rideId, point.latitude, point.longitude, point.accuracyM, point.speedMps, point.recordedAt],
  );
  return result.rows[0];
}

function readFareSetting(name, fallback) {
  const configured = process.env[name];
  if (configured !== undefined && configured.trim() === '') return null;
  const value = Number(configured ?? fallback);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function publicRide(row) {
  return {
    id: String(row.id),
    clientId: String(row.client_id),
    driverId: row.driver_id == null ? null : String(row.driver_id),
    clientName: row.client_name,
    driverName: row.driver_name,
    driverLocation: row.driver_latitude == null ? null : {
      latitude: Number(row.driver_latitude), longitude: Number(row.driver_longitude),
    },
    pickup: {
      address: row.pickup_address || null,
      latitude: row.pickup_latitude,
      longitude: row.pickup_longitude,
    },
    destination: {
      address: row.destination_address || null,
      latitude: row.destination_latitude,
      longitude: row.destination_longitude,
    },
    start: row.start_latitude == null ? null : { latitude: row.start_latitude, longitude: row.start_longitude },
    end: row.end_latitude == null ? null : { latitude: row.end_latitude, longitude: row.end_longitude },
    status: row.status,
    requestedAt: row.requested_at,
    startedAt: row.started_at || null,
    endedAt: row.ended_at || null,
    distanceKm: row.distance_km == null ? null : Number(row.distance_km),
    distanceSource: row.distance_source || null,
    durationMinutes: row.duration_minutes == null ? null : Number(row.duration_minutes),
    estimatedDistanceKm: row.estimated_distance_km == null
      ? (row.distance_source === 'osrm' && row.distance_km != null ? Number(row.distance_km) : null)
      : Number(row.estimated_distance_km),
    estimatedDurationMinutes: row.estimated_duration_minutes == null
      ? null : Number(row.estimated_duration_minutes),
    estimatedFare: row.distance_source === 'osrm' && row.price != null ? Number(row.price) : null,
    estimateUnavailable: row.estimated_distance_km == null && row.distance_source !== 'osrm',
    actualElapsedDurationMinutes: row.duration_minutes == null ? null : Number(row.duration_minutes),
    basePrice: row.base_price == null ? null : Number(row.base_price),
    pricePerKm: row.price_per_km == null ? null : Number(row.price_per_km),
    price: row.price == null ? null : Number(row.price),
    completionNote: row.status === 'completed' && row.estimated_distance_km == null
      && row.distance_source !== 'osrm'
      ? 'An estimate was not saved for this older trip.'
      : null,
    updatedAt: row.updated_at,
  };
}

async function getFreeDriverCount() {
  try {
    const result = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM users u
       WHERE u.role = 'driver'
         AND COALESCE((SELECT a.status FROM driver_applications a WHERE a.driver_id = u.id), 'approved') = 'approved'
         AND EXISTS (SELECT 1 FROM driver_presence p WHERE p.driver_id = u.id AND p.is_online = TRUE)
         AND NOT EXISTS (
           SELECT 1 FROM rides r
           WHERE r.driver_id = u.id AND r.status IN ('accepted', 'in_progress')
         )`,
    );
    return Number(result.rows[0]?.count || 0);
  } catch {
    return null;
  }
}

router.get('/presence', requireAuth, requireRole('driver'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT is_online, latitude, longitude, updated_at FROM driver_presence WHERE driver_id = $1`,
      [req.user.id],
    );
    const row = result.rows[0];
    return res.json({ presence: row ? {
      isOnline: row.is_online,
      location: row.latitude == null ? null : { latitude: Number(row.latitude), longitude: Number(row.longitude) },
      updatedAt: row.updated_at,
    } : { isOnline: false, location: null, updatedAt: null } });
  } catch (error) {
    console.error('Driver presence load failed:', error.code || error.name);
    return res.status(500).json({ message: 'Unable to load your availability.' });
  }
});

router.get('/notifications', requireAuth, requireRole('driver'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT n.id, n.ride_id, n.notification_type, n.created_at, n.read_at, r.status,
        rating.stars, rating.comment
       FROM driver_notifications n JOIN rides r ON r.id = n.ride_id
       LEFT JOIN ride_ratings rating ON rating.ride_id = n.rating_id
       WHERE n.driver_id = $1
       ORDER BY n.created_at DESC, n.id DESC`,
      [req.user.id],
    );
    return res.json({ notifications: result.rows.map((row) => ({
      id: String(row.id), rideId: String(row.ride_id), type: row.notification_type,
      title: ({
        new_ride_request: 'New Ride Request',
        ride_cancelled: 'Ride Cancelled',
        new_rating_received: 'New Rating Received',
      })[row.notification_type],
      message: ({
        new_ride_request: 'New ride request received. Check the details and accept or decline the request.',
        ride_cancelled: 'The customer has cancelled the ride.',
        new_rating_received: 'You received a new rating!',
      })[row.notification_type],
      createdAt: row.created_at, readAt: row.read_at, rideStatus: row.status,
      rating: row.stars == null ? null : { stars: Number(row.stars), comment: row.comment || '' },
    })) });
  } catch (error) {
    console.error('Driver notifications load failed:', error.code || error.name);
    return res.status(500).json({ message: 'Unable to load your notifications.' });
  }
});

router.patch('/notifications/read-all', requireAuth, requireRole('driver'), async (req, res) => {
  try {
    await pool.query(
      'UPDATE driver_notifications SET read_at = NOW() WHERE driver_id = $1 AND read_at IS NULL',
      [req.user.id],
    );
    return res.json({ acknowledged: true });
  } catch (error) {
    console.error('Driver notification acknowledgement failed:', error.code || error.name);
    return res.status(500).json({ message: 'Unable to mark your notifications as read.' });
  }
});

router.patch('/notifications/:id/read', requireAuth, requireRole('driver'), async (req, res) => {
  if (!validRideId(req.params.id)) return res.status(400).json({ message: 'Notification ID is invalid.' });
  try {
    await pool.query(
      `UPDATE driver_notifications SET read_at = NOW()
       WHERE id = $1 AND driver_id = $2 AND read_at IS NULL`,
      [req.params.id, req.user.id],
    );
    return res.json({ acknowledged: true });
  } catch (error) {
    console.error('Driver notification acknowledgement failed:', error.code || error.name);
    return res.status(500).json({ message: 'Unable to dismiss this notification.' });
  }
});

router.put('/presence', requireAuth, requireRole('driver'), async (req, res) => {
  const isOnline = req.body?.isOnline;
  const { latitude, longitude } = req.body || {};
  const hasLocation = latitude != null || longitude != null;
  if (typeof isOnline !== 'boolean' || (hasLocation && !validCoordinate(latitude, longitude))
    || (isOnline && !hasLocation)) {
    return res.status(400).json({ message: 'Choose a valid online status and location.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM users WHERE id = $1 AND role = \'driver\' FOR UPDATE', [req.user.id]);
    const activeRide = await client.query(
      `SELECT id FROM rides WHERE driver_id = $1 AND status IN ('accepted', 'in_progress') LIMIT 1`,
      [req.user.id],
    );
    if (!isOnline && activeRide.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'Finish or cancel your active trip before going offline.' });
    }
    const saved = await client.query(
      `INSERT INTO driver_presence (driver_id, is_online, latitude, longitude, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (driver_id) DO UPDATE SET is_online = EXCLUDED.is_online,
         latitude = COALESCE(EXCLUDED.latitude, driver_presence.latitude),
         longitude = COALESCE(EXCLUDED.longitude, driver_presence.longitude), updated_at = NOW()
       RETURNING is_online, latitude, longitude, updated_at`,
      [req.user.id, isOnline, hasLocation ? latitude : null, hasLocation ? longitude : null],
    );
    await client.query('COMMIT');
    const row = saved.rows[0];
    return res.json({ presence: {
      isOnline: row.is_online,
      location: row.latitude == null ? null : { latitude: Number(row.latitude), longitude: Number(row.longitude) },
      updatedAt: row.updated_at,
    } });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Driver presence update failed:', error.code || error.name);
    return res.status(500).json({ message: 'Unable to update your availability.' });
  } finally {
    client.release();
  }
});

router.get('/', requireAuth, requireRole('client'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT r.id, r.client_id, r.driver_id, c.full_name AS client_name,
        d.full_name AS driver_name, r.pickup_address, r.pickup_latitude, r.pickup_longitude,
        r.destination_address, r.destination_latitude, r.destination_longitude,
        r.start_latitude, r.start_longitude, r.end_latitude, r.end_longitude,
        r.status, r.requested_at, r.started_at, r.ended_at,
        r.distance_km, r.distance_source, r.duration_minutes,
        r.estimated_distance_km, r.estimated_duration_minutes,
        dp.latitude AS driver_latitude, dp.longitude AS driver_longitude,
        r.base_price, r.price_per_km, r.price, r.updated_at,
        rr.stars AS rating_stars, rr.comment AS rating_comment, rr.created_at AS rating_created_at
       FROM rides r
       JOIN users c ON c.id = r.client_id
       LEFT JOIN users d ON d.id = r.driver_id
       LEFT JOIN driver_presence dp ON dp.driver_id = r.driver_id
       LEFT JOIN ride_ratings rr ON rr.ride_id = r.id
       WHERE r.client_id = $1
       ORDER BY r.created_at DESC`,
      [req.user.id],
    );
    const freeDriverCount = await getFreeDriverCount();
    return res.json({ rides: result.rows.map((row) => ({
      ...publicRide(row),
      rating: row.rating_stars == null ? null : {
        stars: Number(row.rating_stars), comment: row.rating_comment || '', createdAt: row.rating_created_at,
      },
      ratingSkipped: false,
    })), freeDriverCount });
  } catch (error) {
    console.error('Client ride history load failed:', error.code || error.name);
    return res.status(500).json({ message: 'Unable to load your ride history.' });
  }
});

router.post('/', requireAuth, requireRole('client'), async (req, res) => {
  const {
    pickupAddress, pickupLatitude, pickupLongitude,
    destinationAddress, destinationLatitude, destinationLongitude,
  } = req.body || {};
  const safePickupAddress = typeof pickupAddress === 'string' ? pickupAddress.trim() : '';
  const safeDestinationAddress = typeof destinationAddress === 'string' ? destinationAddress.trim() : '';
  if (!safePickupAddress || safePickupAddress.length > 300
    || !safeDestinationAddress || safeDestinationAddress.length > 300) {
    return res.status(400).json({ message: 'Enter a pickup address and a destination address (up to 300 characters each).' });
  }
  if (!validCoordinate(pickupLatitude, pickupLongitude)
    || !validCoordinate(destinationLatitude, destinationLongitude)) {
    return res.status(400).json({ message: 'Choose valid pickup and destination points on the map.' });
  }

  let estimate = null;
  let estimateMessage = null;
  try {
    estimate = await getRoadEstimate(
      { latitude: pickupLatitude, longitude: pickupLongitude },
      { latitude: destinationLatitude, longitude: destinationLongitude },
    );
  } catch (error) {
    estimateMessage = error.message || 'The road estimate is unavailable right now. You can request it again later.';
  }

  const basePrice = readFareSetting('RIDE_BASE_FARE', '2.00');
  const pricePerKm = readFareSetting('RIDE_PRICE_PER_KM', '0.75');
  if (basePrice === null || pricePerKm === null) {
    return res.status(503).json({ message: 'Ride pricing is not configured correctly. Please try again later.' });
  }
  const roundedBasePrice = Number(basePrice.toFixed(2));
  const roundedPricePerKm = Number(pricePerKm.toFixed(2));
  const estimatedFare = estimate
    ? Number((roundedBasePrice + estimate.estimatedDistanceKm * roundedPricePerKm).toFixed(2))
    : null;

  try {
    const result = await pool.query(
      `INSERT INTO rides (
        client_id, pickup_address, pickup_latitude, pickup_longitude,
        destination_address, destination_latitude, destination_longitude,
        estimated_distance_km, estimated_duration_minutes, distance_source,
        base_price, price_per_km, price
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
        CASE WHEN $8::numeric IS NULL THEN NULL ELSE 'osrm' END, $10, $11, $12)
      RETURNING id, client_id, driver_id, pickup_address, pickup_latitude, pickup_longitude,
        destination_address, destination_latitude, destination_longitude, status,
        requested_at, started_at, ended_at, estimated_distance_km,
        estimated_duration_minutes, distance_source, base_price, price_per_km, price, updated_at`,
      [
        req.user.id, safePickupAddress, pickupLatitude, pickupLongitude,
        safeDestinationAddress, destinationLatitude, destinationLongitude,
        estimate?.estimatedDistanceKm ?? null, estimate?.estimatedDurationMinutes ?? null,
        roundedBasePrice, roundedPricePerKm, estimatedFare,
      ],
    );
    const freeDriverCount = await getFreeDriverCount();
    return res.status(201).json({
      ride: publicRide(result.rows[0]),
      estimateMessage,
      freeDriverCount,
    });
  } catch (error) {
    console.error('Ride request creation failed:', error.code || error.name);
    return res.status(500).json({ message: 'Unable to create your ride request right now.' });
  }
});

router.patch('/:id/cancel', requireAuth, requireRole('client'), async (req, res) => {
  const rideId = req.params.id;
  if (!validRideId(rideId)) return res.status(400).json({ message: 'Ride ID is invalid.' });

  try {
    const result = await pool.query(
      `WITH cancelled AS (
         UPDATE rides SET status = 'cancelled', updated_at = NOW()
         WHERE id = $1 AND client_id = $2 AND status IN ('pending', 'accepted')
         RETURNING id, driver_id, status, updated_at
       ), notification AS (
         INSERT INTO driver_notifications (driver_id, ride_id, notification_type)
         SELECT driver_id, id, 'ride_cancelled' FROM cancelled WHERE driver_id IS NOT NULL
         ON CONFLICT (ride_id, driver_id, notification_type) DO NOTHING
       )
       SELECT id, driver_id, status, updated_at FROM cancelled`,
      [rideId, req.user.id],
    );
    if (!result.rows[0]) {
      return res.status(409).json({ message: 'This ride can no longer be cancelled.' });
    }
    return res.json({ ride: {
      id: String(result.rows[0].id),
      status: result.rows[0].status,
      updatedAt: result.rows[0].updated_at,
    } });
  } catch (error) {
    console.error('Ride cancellation failed:', error.code || error.name);
    return res.status(500).json({ message: 'Unable to cancel this ride right now.' });
  }
});

router.post('/:id/rating', requireAuth, requireRole('client'), async (req, res) => {
  const rideId = req.params.id;
  const stars = req.body?.stars;
  const comment = typeof req.body?.comment === 'string' ? req.body.comment.trim() : '';
  if (!validRideId(rideId)) return res.status(400).json({ message: 'Ride ID is invalid.' });
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
    return res.status(400).json({ message: 'Choose a rating from 1 to 5 stars.' });
  }
  if (comment.length > 500) return res.status(400).json({ message: 'Comments must be 500 characters or fewer.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ride = await client.query(
      `SELECT id, driver_id, status FROM rides
       WHERE id = $1 AND client_id = $2 FOR UPDATE`,
      [rideId, req.user.id],
    );
    const row = ride.rows[0];
    if (!row || row.status !== 'completed' || !row.driver_id) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'This completed ride cannot be rated.' });
    }
    const saved = await client.query(
      `INSERT INTO ride_ratings (ride_id, client_id, driver_id, stars, comment)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (ride_id) DO NOTHING
       RETURNING stars, comment, created_at`,
      [rideId, req.user.id, row.driver_id, stars, comment || null],
    );
    if (!saved.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'This ride has already been rated.' });
    }
    await client.query(
      `INSERT INTO driver_notifications (driver_id, ride_id, notification_type, rating_id)
       VALUES ($1, $2, 'new_rating_received', $2)
       ON CONFLICT (ride_id, driver_id, notification_type) DO NOTHING`,
      [String(row.driver_id), String(rideId)],
    );
    await client.query('COMMIT');
    const rating = saved.rows[0];
    return res.status(201).json({ rating: {
      stars: Number(rating.stars), comment: rating.comment || '', createdAt: rating.created_at,
    } });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Ride rating save failed:', error.code || error.name);
    return res.status(500).json({ message: 'Unable to save this rating right now.' });
  } finally {
    client.release();
  }
});

router.post('/:id/rating/skip', requireAuth, requireRole('client'), async (req, res) => {
  const rideId = req.params.id;
  if (!validRideId(rideId)) return res.status(400).json({ message: 'Ride ID is invalid.' });
  try {
    const result = await pool.query(
      `SELECT r.id FROM rides r
       WHERE r.id = $1 AND r.client_id = $2 AND r.status = 'completed'
         AND r.driver_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM ride_ratings WHERE ride_id = r.id)
       LIMIT 1`,
      [rideId, req.user.id],
    );
    if (!result.rows[0]) return res.status(409).json({ message: 'This ride no longer has a pending rating.' });
    return res.json({ skipped: true });
  } catch (error) {
    console.error('Ride rating skip failed:', error.code || error.name);
    return res.status(500).json({ message: 'Unable to dismiss the rating right now.' });
  }
});

router.get('/:id/approach-estimate', requireAuth, requireRole('client'), async (req, res) => {
  const rideId = req.params.id;
  if (!validRideId(rideId)) return res.status(400).json({ message: 'Ride ID is invalid.' });
  try {
    const result = await pool.query(
      `SELECT r.status, r.pickup_latitude, r.pickup_longitude, dp.latitude, dp.longitude
       FROM rides r LEFT JOIN driver_presence dp ON dp.driver_id = r.driver_id
       WHERE r.id = $1 AND r.client_id = $2 AND r.status = 'accepted' AND dp.is_online = TRUE`,
      [rideId, req.user.id],
    );
    const ride = result.rows[0];
    if (!ride) return res.status(404).json({ message: 'Driver location is not available for this request.' });
    const estimate = await getRoadEstimate(
      { latitude: Number(ride.latitude), longitude: Number(ride.longitude) },
      { latitude: Number(ride.pickup_latitude), longitude: Number(ride.pickup_longitude) },
    );
    return res.json({ ...estimate });
  } catch (error) {
    return res.status(503).json({ message: error.message || 'Driver route estimate is unavailable.' });
  }
});

router.post('/:id/estimate', requireAuth, requireRole('client'), async (req, res) => {
  const rideId = req.params.id;
  if (!validRideId(rideId)) return res.status(400).json({ message: 'Ride ID is invalid.' });

  try {
    const rideResult = await pool.query(
      `SELECT id, pickup_latitude, pickup_longitude, destination_latitude,
        destination_longitude, status, estimated_distance_km, estimated_duration_minutes,
        distance_source, base_price, price_per_km, price
       FROM rides WHERE id = $1 AND client_id = $2`,
      [rideId, req.user.id],
    );
    const ride = rideResult.rows[0];
    if (!ride) return res.status(404).json({ message: 'Ride not found.' });
    if (ride.status !== 'pending') {
      return res.status(409).json({ message: 'The estimate can only be updated before a driver accepts this request.' });
    }
    if (ride.estimated_distance_km != null && ride.estimated_duration_minutes != null
      && ride.distance_source === 'osrm' && ride.price != null) {
      return res.json({
        ride: {
          estimatedDistanceKm: Number(ride.estimated_distance_km),
          estimatedDurationMinutes: Number(ride.estimated_duration_minutes),
          estimatedFare: Number(ride.price),
          basePrice: ride.base_price == null ? null : Number(ride.base_price),
          pricePerKm: ride.price_per_km == null ? null : Number(ride.price_per_km),
          estimateUnavailable: false,
        },
      });
    }

    let estimate;
    try {
      estimate = await getRoadEstimate(
        { latitude: Number(ride.pickup_latitude), longitude: Number(ride.pickup_longitude) },
        { latitude: Number(ride.destination_latitude), longitude: Number(ride.destination_longitude) },
      );
    } catch (error) {
      return res.status(503).json({ message: error.message || 'The road estimate is unavailable right now. Please try again.' });
    }

    const basePrice = readFareSetting('RIDE_BASE_FARE', '2.00');
    const pricePerKm = readFareSetting('RIDE_PRICE_PER_KM', '0.75');
    if (basePrice === null || pricePerKm === null) {
      return res.status(503).json({ message: 'Ride pricing is not configured correctly. Please try again later.' });
    }
    const roundedBasePrice = Number(basePrice.toFixed(2));
    const roundedPricePerKm = Number(pricePerKm.toFixed(2));
    const estimatedFare = Number((roundedBasePrice + estimate.estimatedDistanceKm * roundedPricePerKm).toFixed(2));
    const updated = await pool.query(
      `UPDATE rides SET estimated_distance_km = $1, estimated_duration_minutes = $2,
        distance_source = 'osrm', base_price = $3, price_per_km = $4, price = $5,
        updated_at = NOW()
       WHERE id = $6 AND client_id = $7 AND status = 'pending'
         AND estimated_distance_km IS NULL
       RETURNING estimated_distance_km, estimated_duration_minutes,
         distance_source, base_price, price_per_km, price`,
      [estimate.estimatedDistanceKm, estimate.estimatedDurationMinutes,
        roundedBasePrice, roundedPricePerKm, estimatedFare, rideId, req.user.id],
    );
    if (!updated.rows[0]) {
      return res.status(409).json({ message: 'The request changed while the estimate was being calculated. Refresh your ride history and try again.' });
    }
    const row = updated.rows[0];
    return res.json({ ride: {
      estimatedDistanceKm: Number(row.estimated_distance_km),
      estimatedDurationMinutes: Number(row.estimated_duration_minutes),
      estimatedFare: Number(row.price),
      basePrice: Number(row.base_price),
      pricePerKm: Number(row.price_per_km),
      estimateUnavailable: false,
    } });
  } catch (error) {
    console.error('Ride estimate retry failed:', error.code || error.name);
    return res.status(500).json({ message: 'Unable to calculate this estimate right now.' });
  }
});

router.get('/assigned', requireAuth, requireRole('driver'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT r.id, r.client_id, r.driver_id, c.full_name AS client_name,
        d.full_name AS driver_name, r.pickup_address, r.pickup_latitude, r.pickup_longitude,
        r.destination_address, r.destination_latitude, r.destination_longitude,
        r.start_latitude, r.start_longitude, r.end_latitude, r.end_longitude,
        r.status, r.requested_at, r.started_at, r.ended_at,
        r.distance_km, r.distance_source, r.duration_minutes,
        r.estimated_distance_km, r.estimated_duration_minutes,
        r.base_price, r.price_per_km, r.price,
        r.updated_at
       FROM rides r
       JOIN users c ON c.id = r.client_id
       JOIN users d ON d.id = r.driver_id
       WHERE r.driver_id = $1
         AND r.status IN ('pending', 'accepted', 'in_progress', 'completed', 'cancelled')
       ORDER BY r.created_at DESC`,
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

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const driver = await client.query(
      `SELECT u.id FROM users u
       WHERE u.id = $1 AND u.role = 'driver'
         AND COALESCE((SELECT a.status FROM driver_applications a WHERE a.driver_id = u.id), 'approved') = 'approved'
       FOR UPDATE`, [req.user.id],
    );
    if (!driver.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'Your driver account is unavailable.' });
    }
    const presence = await client.query(
      `SELECT is_online FROM driver_presence WHERE driver_id = $1 FOR UPDATE`, [req.user.id],
    );
    if (!presence.rows[0]?.is_online) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'Go online before accepting a ride.' });
    }
    const activeRide = await client.query(
      `SELECT id FROM rides WHERE driver_id = $1 AND status IN ('accepted', 'in_progress') LIMIT 1`,
      [req.user.id],
    );
    if (activeRide.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'You already have an active trip. Finish it before accepting another request.' });
    }
    const result = await client.query(
      `UPDATE rides SET status = 'accepted', updated_at = NOW()
       WHERE id = $1 AND driver_id = $2 AND status = 'pending'
       RETURNING id, status, updated_at`,
      [rideId, req.user.id],
    );
    if (!result.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'This request is not assigned to you, is no longer pending, or you already have an active trip.' });
    }
    await client.query('COMMIT');
    return res.json({ ride: { id: String(result.rows[0].id), status: result.rows[0].status, updatedAt: result.rows[0].updated_at } });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('Ride acceptance failed:', error.code || error.name);
    return res.status(500).json({ message: 'Unable to accept this request right now.' });
  } finally {
    client?.release();
  }
});

router.patch('/:id/start', requireAuth, requireRole('driver'), async (req, res) => {
  const rideId = req.params.id;
  const point = gpsPointBody(req.body);
  if (!validRideId(rideId)) return res.status(400).json({ message: 'Ride ID is invalid.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE rides SET status = 'in_progress', start_latitude = $1,
        start_longitude = $2, started_at = NOW(), updated_at = NOW()
       WHERE id = $3 AND driver_id = $4 AND status = 'accepted' AND started_at IS NULL
       RETURNING id, status, start_latitude, start_longitude, started_at, updated_at`,
      [
        point && point.accuracyM <= 50 ? point.latitude : null,
        point && point.accuracyM <= 50 ? point.longitude : null,
        rideId, req.user.id,
      ],
    );
    if (!result.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'This request is not assigned to you or is not ready to start.' });
    }
    await client.query('COMMIT');
    const row = result.rows[0];
    return res.json({ ride: {
      id: String(row.id), status: row.status,
      start: row.start_latitude == null ? null : { latitude: row.start_latitude, longitude: row.start_longitude },
      startedAt: row.started_at, updatedAt: row.updated_at,
    } });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Trip start failed:', error.code || error.name);
    return res.status(500).json({ message: 'Unable to start this trip right now.' });
  } finally {
    client.release();
  }
});

router.post('/:id/locations', requireAuth, requireRole('driver'), async (req, res) => {
  const rideId = req.params.id;
  const point = gpsPointBody(req.body);
  if (!validRideId(rideId)) return res.status(400).json({ message: 'Ride ID is invalid.' });
  if (!point) return res.status(400).json({ message: 'A valid GPS position and accuracy are required.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ride = await client.query(
      `SELECT id, started_at FROM rides WHERE id = $1 AND driver_id = $2 AND status = 'in_progress'
       AND started_at IS NOT NULL AND ended_at IS NULL FOR UPDATE`,
      [rideId, req.user.id],
    );
    if (!ride.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'This trip is not assigned to you or is no longer in progress.' });
    }
    if (point.recordedAt
      && point.recordedAt.getTime() < new Date(ride.rows[0].started_at).getTime() - 30000) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'The GPS timestamp is earlier than this trip.' });
    }
    const saved = await insertGpsPoint(client, rideId, point);
    await client.query('COMMIT');
    return res.status(201).json({ saved: true, location: {
      latitude: Number(saved.latitude), longitude: Number(saved.longitude),
      accuracyM: Number(saved.accuracy_m), speedMps: saved.speed_mps == null ? null : Number(saved.speed_mps),
      recordedAt: saved.recorded_at,
    } });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('GPS point save failed:', error.code || error.name);
    return res.status(500).json({ message: 'Unable to save this GPS position. It will be retried.' });
  } finally {
    client.release();
  }
});

router.get('/:id/locations', requireAuth, requireRole('driver'), async (req, res) => {
  const rideId = req.params.id;
  if (!validRideId(rideId)) return res.status(400).json({ message: 'Ride ID is invalid.' });
  try {
    const ride = await pool.query(
      `SELECT id FROM rides WHERE id = $1 AND driver_id = $2
       AND status = 'in_progress'`,
      [rideId, req.user.id],
    );
    if (!ride.rows[0]) return res.status(404).json({ message: 'Ride not found.' });
    const result = await pool.query(
      `SELECT latitude, longitude, accuracy_m, speed_mps, recorded_at
       FROM ride_locations WHERE ride_id = $1 ORDER BY recorded_at, id`,
      [rideId],
    );
    return res.json({ locations: result.rows.map((row) => ({
      latitude: Number(row.latitude), longitude: Number(row.longitude),
      accuracyM: Number(row.accuracy_m), speedMps: row.speed_mps == null ? null : Number(row.speed_mps),
      recordedAt: row.recorded_at,
    })) });
  } catch (error) {
    console.error('GPS trace load failed:', error.code || error.name);
    return res.status(500).json({ message: 'Unable to load this trip’s GPS trace.' });
  }
});

router.patch('/:id/end', requireAuth, requireRole('driver'), async (req, res) => {
  const rideId = req.params.id;
  if (!validRideId(rideId)) return res.status(400).json({ message: 'Ride ID is invalid.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE rides SET status = 'completed', ended_at = NOW(), updated_at = NOW(),
        duration_minutes = GREATEST(0,
          CEIL(EXTRACT(EPOCH FROM (NOW() - started_at)) / 60.0)::INTEGER)
       WHERE id = $1 AND driver_id = $2 AND status = 'in_progress'
         AND started_at IS NOT NULL AND ended_at IS NULL
       RETURNING id, status, end_latitude, end_longitude, ended_at, updated_at,
         distance_km, distance_source, duration_minutes, estimated_distance_km,
         estimated_duration_minutes, base_price, price_per_km, price`,
      [rideId, req.user.id],
    );
    if (!result.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'This request is not assigned to you or is not in progress.' });
    }
    await client.query('COMMIT');
    const row = result.rows[0];
    return res.json({ message: 'The driver has arrived. The trip is complete.', ride: {
      id: String(row.id), status: row.status,
      end: row.end_latitude == null ? null : { latitude: row.end_latitude, longitude: row.end_longitude },
      endedAt: row.ended_at, updatedAt: row.updated_at,
      distanceKm: row.distance_km == null ? null : Number(row.distance_km),
      durationMinutes: row.duration_minutes,
      estimatedDistanceKm: row.estimated_distance_km == null ? null : Number(row.estimated_distance_km),
      estimatedDurationMinutes: row.estimated_duration_minutes == null ? null : Number(row.estimated_duration_minutes),
      distanceSource: row.distance_source,
      basePrice: row.base_price == null ? null : Number(row.base_price),
      pricePerKm: row.price_per_km == null ? null : Number(row.price_per_km),
      price: row.price == null ? null : Number(row.price),
      estimatedFare: row.distance_source === 'osrm' && row.price != null ? Number(row.price) : null,
      actualElapsedDurationMinutes: row.duration_minutes,
    } });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Trip end failed:', error.code || error.name);
    return res.status(500).json({ message: 'Unable to end this trip right now.' });
  } finally {
    client.release();
  }
});

module.exports = router;
