import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const DEFAULT_CENTER = [42.6629, 21.1655]

export default function LocationMap({ activeLocation, pickup, destination, onSelect, driverLocation = null, rideTrace = [], suggestedRoute = [], focusSequence = 0 }) {
  const mapElement = useRef(null)
  const mapRef = useRef(null)
  const markersRef = useRef({ pickup: null, destination: null, driver: null, trace: null, suggestedRoute: null })
  const viewportKeyRef = useRef('')
  const activeRef = useRef(activeLocation)
  const onSelectRef = useRef(onSelect)

  useEffect(() => { activeRef.current = activeLocation }, [activeLocation])
  useEffect(() => { onSelectRef.current = onSelect }, [onSelect])

  useEffect(() => {
    const map = L.map(mapElement.current).setView(DEFAULT_CENTER, 13)
    mapRef.current = map
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map)
    map.on('click', (event) => {
      if (!onSelectRef.current) return
      onSelectRef.current(activeRef.current, {
        latitude: event.latlng.lat,
        longitude: event.latlng.lng,
      })
    })

    return () => {
      map.stop()
      map.remove()
      mapRef.current = null
      markersRef.current = { pickup: null, destination: null, driver: null, trace: null, suggestedRoute: null }
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    for (const [key, location, color, label] of [
      ['pickup', pickup, '#df7049', 'Pickup'],
      ['destination', destination, '#39845a', 'Destination'],
    ]) {
      const existingMarker = markersRef.current[key]
      if (!location) {
        if (existingMarker) map.removeLayer(existingMarker)
        markersRef.current[key] = null
        continue
      }

      if (existingMarker) {
        existingMarker.setLatLng([location.latitude, location.longitude])
      } else {
        markersRef.current[key] = L.circleMarker([location.latitude, location.longitude], {
          radius: 9,
          color,
          weight: 3,
          fillColor: '#ffffff',
          fillOpacity: 1,
        }).addTo(map).bindTooltip(label)
      }
    }

    if (driverLocation) {
      const driverPoint = [driverLocation.latitude, driverLocation.longitude]
      if (markersRef.current.driver) markersRef.current.driver.setLatLng(driverPoint)
      else markersRef.current.driver = L.circleMarker(driverPoint, {
        radius: 8, color: '#315f9b', weight: 3, fillColor: '#ffffff', fillOpacity: 1,
      }).addTo(map).bindTooltip('Driver')
    }

    const traceCoordinates = rideTrace.map((point) => [point.latitude, point.longitude])
    if (traceCoordinates.length >= 2) {
      if (markersRef.current.trace) markersRef.current.trace.setLatLngs(traceCoordinates)
      else markersRef.current.trace = L.polyline(traceCoordinates, { color: '#315f9b', weight: 5, opacity: 0.8 }).addTo(map)
    }

    if (suggestedRoute.length >= 2) {
      if (markersRef.current.suggestedRoute) markersRef.current.suggestedRoute.setLatLngs(suggestedRoute)
      else {
        markersRef.current.suggestedRoute = L.polyline(suggestedRoute, {
          color: '#687887', weight: 4, opacity: 0.8, dashArray: '8 8',
        }).addTo(map)
      }
    } else if (markersRef.current.suggestedRoute) {
      map.removeLayer(markersRef.current.suggestedRoute)
      markersRef.current.suggestedRoute = null
    }

    if (focusSequence > 0 && driverLocation) {
      const nextViewportKey = `driver-focus:${focusSequence}:${driverLocation.latitude}:${driverLocation.longitude}`
      if (nextViewportKey !== viewportKeyRef.current) {
        viewportKeyRef.current = nextViewportKey
        map.stop()
        map.flyTo([driverLocation.latitude, driverLocation.longitude], Math.max(map.getZoom(), 15), { duration: 0.4 })
        mapElement.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    } else if (onSelect) {
      const mostRecent = activeLocation === 'pickup' ? pickup : destination
      const nextViewportKey = mostRecent
        ? `selection:${activeLocation}:${mostRecent.latitude}:${mostRecent.longitude}`
        : ''
      if (mostRecent && nextViewportKey !== viewportKeyRef.current) {
        map.stop()
        map.flyTo([mostRecent.latitude, mostRecent.longitude], Math.max(map.getZoom(), 14), { duration: 0.4 })
        viewportKeyRef.current = nextViewportKey
      }
    } else if (suggestedRoute.length >= 2) {
      const firstPoint = suggestedRoute[0]
      const lastPoint = suggestedRoute[suggestedRoute.length - 1]
      const nextViewportKey = `suggested:${firstPoint.join(',')}:${lastPoint.join(',')}:${suggestedRoute.length}`
      if (nextViewportKey !== viewportKeyRef.current) {
        viewportKeyRef.current = nextViewportKey
        map.stop()
        map.fitBounds(suggestedRoute, { padding: [30, 30], maxZoom: 15, animate: false })
      }
    } else if (rideTrace.length >= 2) {
      const firstPoint = rideTrace[0]
      const nextViewportKey = `gps-trace:${firstPoint.latitude}:${firstPoint.longitude}`
      if (nextViewportKey !== viewportKeyRef.current) {
        viewportKeyRef.current = nextViewportKey
        map.stop()
        map.fitBounds(traceCoordinates, { padding: [30, 30], maxZoom: 15, animate: false })
      }
    } else {
      const visibleLocations = [pickup, destination, driverLocation].filter(Boolean)
      const nextViewportKey = `markers:${pickup?.latitude}:${pickup?.longitude}:${destination?.latitude}:${destination?.longitude}:${Boolean(driverLocation)}`
      if (visibleLocations.length && nextViewportKey !== viewportKeyRef.current) {
        viewportKeyRef.current = nextViewportKey
        map.stop()
        map.fitBounds(visibleLocations.map((location) => [location.latitude, location.longitude]), {
          padding: [30, 30], maxZoom: 15, animate: false,
        })
      }
    }
  }, [pickup, destination, activeLocation, driverLocation, rideTrace, suggestedRoute, onSelect, focusSequence])

  return <div className="location-map" ref={mapElement} aria-label={onSelect ? 'Map for selecting pickup and destination' : 'Map showing pickup, destination, suggested route, and recorded GPS trace'} />
}
