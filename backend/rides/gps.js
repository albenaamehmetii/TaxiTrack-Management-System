const EARTH_RADIUS_METERS = 6371000;
const MAX_ACCURACY_METERS = 50;
const MAX_SPEED_METERS_PER_SECOND = 55;
const MAX_GAP_SECONDS = 90;

function haversineMeters(a, b) {
  const radians = (degrees) => (degrees * Math.PI) / 180;
  const lat1 = radians(Number(a.latitude));
  const lat2 = radians(Number(b.latitude));
  const deltaLat = lat2 - lat1;
  const deltaLon = radians(Number(b.longitude) - Number(a.longitude));
  const h = Math.sin(deltaLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(Math.min(1, h)));
}

function calculateTrace(points) {
  const ordered = [...points].sort((a, b) => new Date(a.recorded_at) - new Date(b.recorded_at));
  const valid = ordered.filter((point) => {
    const latitude = Number(point.latitude);
    const longitude = Number(point.longitude);
    const accuracy = Number(point.accuracy_m);
    return Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
      && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180
      && Number.isFinite(accuracy) && accuracy >= 0 && accuracy <= MAX_ACCURACY_METERS
      && Number.isFinite(new Date(point.recorded_at).getTime());
  });

  let distanceMeters = 0;
  let previous = null;
  let acceptedPoints = 0;
  let hasLongGap = false;
  for (const point of valid) {
    if (!previous) {
      previous = point;
      acceptedPoints += 1;
      continue;
    }
    const elapsedSeconds = (new Date(point.recorded_at) - new Date(previous.recorded_at)) / 1000;
    if (elapsedSeconds <= 0) continue;
    const gap = elapsedSeconds > MAX_GAP_SECONDS;
    if (gap) hasLongGap = true;

    const segmentMeters = haversineMeters(previous, point);
    const reportedSpeed = point.speed_mps == null ? null : Number(point.speed_mps);
    const tooFast = segmentMeters / elapsedSeconds > MAX_SPEED_METERS_PER_SECOND
      || (reportedSpeed != null && Number.isFinite(reportedSpeed)
        && reportedSpeed > MAX_SPEED_METERS_PER_SECOND);
    if (tooFast) continue;

    if (!gap && segmentMeters > 1) distanceMeters += segmentMeters;
    previous = point;
    acceptedPoints += 1;
  }

  return {
    distanceMeters,
    distanceKm: distanceMeters / 1000,
    pointCount: acceptedPoints,
    hasLongGap,
  };
}

module.exports = { calculateTrace, haversineMeters };
