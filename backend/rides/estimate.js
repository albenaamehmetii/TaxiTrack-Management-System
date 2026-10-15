const OSRM_ROUTE_URL = 'https://router.project-osrm.org/route/v1/driving';

async function getRoadEstimate(pickup, destination, fetchImpl = global.fetch) {
  const coordinates = `${pickup.longitude},${pickup.latitude};${destination.longitude},${destination.latitude}`;
  const url = `${OSRM_ROUTE_URL}/${coordinates}?overview=false&steps=false`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) throw new Error('route service returned an error');

    const data = await response.json();
    const route = data?.routes?.[0];
    if (data?.code !== 'Ok' || !Number.isFinite(route?.distance)
      || route.distance <= 0 || !Number.isFinite(route?.duration) || route.duration < 0) {
      throw new Error('route service did not return a valid estimate');
    }

    return {
      estimatedDistanceKm: Number((route.distance / 1000).toFixed(3)),
      estimatedDurationMinutes: Math.ceil(route.duration / 60),
    };
  } catch {
    throw new Error('A road estimate is unavailable right now. Please check the locations and try again.');
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { getRoadEstimate };
