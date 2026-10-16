INSERT INTO driver_notifications (driver_id, ride_id, notification_type, rating_id)
SELECT rating.driver_id, rating.ride_id, 'new_rating_received', rating.ride_id
FROM ride_ratings rating
ON CONFLICT (ride_id, driver_id, notification_type)
DO UPDATE SET rating_id = COALESCE(driver_notifications.rating_id, EXCLUDED.rating_id);
