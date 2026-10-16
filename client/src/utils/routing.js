const OSRM_ROUTE_URL = 'https://router.project-osrm.org/route/v1/driving'
const EARTH_RADIUS_METERS = 6371000

function isCoordinate(point) {
  return Number.isFinite(point?.latitude)
    && Number.isFinite(point?.longitude)
    && point.latitude >= -90 && point.latitude <= 90
    && point.longitude >= -180 && point.longitude <= 180
}

export function distanceBetweenMeters(a, b) {
  if (!isCoordinate(a) || !isCoordinate(b)) return Number.POSITIVE_INFINITY

  const radians = (degrees) => (degrees * Math.PI) / 180
  const lat1 = radians(a.latitude)
  const lat2 = radians(b.latitude)
  const deltaLat = lat2 - lat1
  const deltaLon = radians(b.longitude - a.longitude)
  const haversine = Math.sin(deltaLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2

  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(Math.min(1, haversine)))
}

export async function fetchSuggestedRoute({ origin, waypoints = [], signal, fetchImpl = globalThis.fetch }) {
  const points = [origin, ...waypoints]
  if (points.length < 2 || points.some((point) => !isCoordinate(point))) {
    throw new Error('Valid coordinates are required to request a suggested route.')
  }

  const routePoints = points.filter((point, index) => (
    index === 0 || distanceBetweenMeters(points[index - 1], point) >= 1
  ))
  if (routePoints.length < 2) {
    throw new Error('The route needs at least two different locations.')
  }

  const coordinates = routePoints
    .map((point) => `${point.longitude},${point.latitude}`)
    .join(';')
  const response = await fetchImpl(
    `${OSRM_ROUTE_URL}/${coordinates}?overview=full&geometries=geojson`,
    { signal },
  )
  if (!response.ok) throw new Error('The routing service could not return a route.')

  const data = await response.json()
  const geometry = data?.routes?.[0]?.geometry
  if (data?.code !== 'Ok' || geometry?.type !== 'LineString'
    || !Array.isArray(geometry.coordinates) || geometry.coordinates.length < 2) {
    throw new Error('The routing service did not find a drivable route.')
  }

  return geometry.coordinates.map(([longitude, latitude]) => {
    const point = { latitude, longitude }
    if (!isCoordinate(point)) throw new Error('The routing service returned invalid coordinates.')
    return [latitude, longitude]
  })
}
