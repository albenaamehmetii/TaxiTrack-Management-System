import assert from 'node:assert/strict'
import { test } from 'node:test'
import { distanceBetweenMeters, fetchSuggestedRoute } from './routing.js'

const origin = { latitude: 42.66, longitude: 21.16 }
const pickup = { latitude: 42.661, longitude: 21.161 }
const destination = { latitude: 42.662, longitude: 21.162 }

test('suggested route sends OSRM coordinates as longitude,latitude in waypoint order', async () => {
  let requestUrl = ''
  const route = await fetchSuggestedRoute({
    origin,
    waypoints: [pickup, destination],
    fetchImpl: async (url) => {
      requestUrl = url
      return {
        ok: true,
        async json() {
          return {
            code: 'Ok',
            routes: [{ geometry: { type: 'LineString', coordinates: [[21.16, 42.66], [21.162, 42.662]] } }],
          }
        },
      }
    },
  })

  assert.match(requestUrl, /21\.16,42\.66;21\.161,42\.661;21\.162,42\.662\?overview=full/)
  assert.deepEqual(route, [[42.66, 21.16], [42.662, 21.162]])
})

test('suggested route rejects invalid coordinates and OSRM no-route responses', async () => {
  await assert.rejects(
    fetchSuggestedRoute({ origin, waypoints: [{ latitude: 100, longitude: 21 }] }),
    /Valid coordinates/,
  )

  await assert.rejects(
    fetchSuggestedRoute({
      origin,
      waypoints: [destination],
      fetchImpl: async () => ({ ok: true, async json() { return { code: 'NoRoute' } } }),
    }),
    /did not find a drivable route/,
  )
})

test('movement distance is zero for the same point and finite for valid GPS coordinates', () => {
  assert.equal(distanceBetweenMeters(origin, origin), 0)
  assert.ok(distanceBetweenMeters(origin, pickup) > 100)
  assert.equal(distanceBetweenMeters(origin, { latitude: 91, longitude: 21 }), Number.POSITIVE_INFINITY)
})
