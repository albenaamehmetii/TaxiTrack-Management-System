import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getCurrentCoordinates } from './gps.js'

test('location permission denial returns a clear message without simulating a position', async () => {
  const geolocation = {
    getCurrentPosition(_success, failure) {
      failure({ code: 1 })
    },
  }
  await assert.rejects(getCurrentCoordinates(geolocation), /Allow location access/i)
})

test('a browser without geolocation returns a clear error', async () => {
  await assert.rejects(getCurrentCoordinates(null), /Location is not available/i)
})

test('a browser fix includes its accuracy, optional speed and timestamp', async () => {
  const timestamp = Date.UTC(2026, 0, 1, 12, 0, 0)
  const geolocation = {
    getCurrentPosition(success) {
      success({
        coords: { latitude: 42.66, longitude: 21.16, accuracy: 4.5, speed: null },
        timestamp,
      })
    },
  }
  const position = await getCurrentCoordinates(geolocation)
  assert.equal(position.latitude, 42.66)
  assert.equal(position.accuracyM, 4.5)
  assert.equal(position.speedMps, null)
  assert.equal(position.recordedAt, new Date(timestamp).toISOString())
})
