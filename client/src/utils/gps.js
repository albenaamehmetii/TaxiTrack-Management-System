export function getCurrentCoordinates(geolocation = globalThis.navigator?.geolocation) {
  return new Promise((resolve, reject) => {
    if (!geolocation?.getCurrentPosition) {
      reject(new Error('Location is not available in this browser.'))
      return
    }

    geolocation.getCurrentPosition(
      ({ coords, timestamp }) => resolve({
        latitude: coords.latitude,
        longitude: coords.longitude,
        accuracyM: coords.accuracy,
        speedMps: Number.isFinite(coords.speed) ? Math.max(0, coords.speed) : null,
        recordedAt: new Date(timestamp).toISOString(),
      }),
      (error) => {
        if (error.code === 1) {
          reject(new Error('Allow location access in your browser to start or end a trip.'))
        } else {
          reject(new Error('Could not get your location. Check your connection and try again.'))
        }
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    )
  })
}
