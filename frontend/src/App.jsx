import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './App.css'
import { fetchSuggestedRoute } from './routing.js'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000'
const ROLE_LABELS = { client: 'Client', driver: 'Driver', admin: 'Administrator' }
const DEFAULT_CENTER = [42.6629, 21.1655]

function LocationMap({ activeLocation, pickup, destination, onSelect, driverLocation = null, rideTrace = [], suggestedRoute = [] }) {
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

    if (onSelect) {
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
  }, [pickup, destination, activeLocation, driverLocation, rideTrace, suggestedRoute, onSelect])

  return <div className="location-map" ref={mapElement} aria-label={onSelect ? 'Map for selecting pickup and destination' : 'Map showing pickup, destination, suggested route, and recorded GPS trace'} />
}

function formatCoordinates(location) {
  if (!location) return 'Not selected'
  return `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}`
}


function formatRideTime(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Time unavailable'

  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Belgrade',
  }).format(date)
}

function TripSummary({ ride }) {
  return (
    <section className="trip-summary" aria-label={`Trip summary for request ${ride.id}`}>
      <h4>Trip summary</h4>
      {ride.completionNote && <p className="trip-summary-note" role="note">{ride.completionNote}</p>}
      <div className="trip-summary-grid">
        <p><span>Estimated road distance</span><strong>{ride.estimatedDistanceKm == null ? 'Unavailable' : `${Number(ride.estimatedDistanceKm).toFixed(3)} km`}</strong><small>OSRM route estimate</small></p>
        <p><span>Estimated travel time</span><strong>{ride.estimatedDurationMinutes == null ? 'Unavailable' : `${ride.estimatedDurationMinutes} min`}</strong><small>OSRM route estimate</small></p>
        <p className="trip-total"><span>Estimated fare</span><strong>{ride.estimatedFare == null ? 'Unavailable' : `€${Number(ride.estimatedFare).toFixed(2)}`}</strong><small>{ride.basePrice == null || ride.pricePerKm == null ? 'Pricing unavailable' : `€${Number(ride.basePrice).toFixed(2)} base + €${Number(ride.pricePerKm).toFixed(2)} per km`}</small></p>
        <p><span>Actual elapsed time</span><strong>{ride.actualElapsedDurationMinutes == null ? (ride.status === 'completed' ? 'Unavailable' : 'Not completed') : `${ride.actualElapsedDurationMinutes} min`}</strong><small>From Start Trip to End Trip</small></p>
      </div>
    </section>
  )
}

function AdminDashboard({ user, onLogout }) {
  const [rides, setRides] = useState([])
  const [drivers, setDrivers] = useState([])
  const [selectedDrivers, setSelectedDrivers] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [assigningRide, setAssigningRide] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let active = true
    async function loadData() {
      setLoading(true)
      setError('')
      try {
        const [ridesResponse, usersResponse] = await Promise.all([
          fetch(`${API_URL}/api/admin/rides`, { credentials: 'include' }),
          fetch(`${API_URL}/api/admin/users`, { credentials: 'include' }),
        ])
        const [ridesData, usersData] = await Promise.all([ridesResponse.json(), usersResponse.json()])
        if (!ridesResponse.ok) throw new Error(ridesData.message || 'Unable to load ride requests.')
        if (!usersResponse.ok) throw new Error(usersData.message || 'Unable to load drivers.')
        if (active) {
          setRides(ridesData.rides || [])
          setDrivers((usersData.users || []).filter((item) => item.role === 'driver'))
        }
      } catch (loadError) {
        if (active) setError(loadError.message || 'Unable to load the admin dashboard.')
      } finally {
        if (active) setLoading(false)
      }
    }
    loadData()
    return () => { active = false }
  }, [reloadKey])

  async function assignDriver(rideId) {
    const driverId = selectedDrivers[rideId]
    if (!driverId) {
      setError('Choose a driver first.')
      return
    }
    setAssigningRide(rideId)
    setError('')
    setNotice('')
    try {
      const response = await fetch(`${API_URL}/api/admin/rides/${rideId}/assign-driver`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ driverId }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || 'Unable to assign this request.')
      setNotice(`Ride request #${rideId} assigned to a driver.`)
      setReloadKey((value) => value + 1)
    } catch (assignError) {
      setError(assignError.message || 'Unable to assign this request.')
    } finally {
      setAssigningRide(null)
    }
  }

  return (
    <section className="role-dashboard">
      <div className="role-dashboard-heading">
        <div className="welcome-copy">
          <p className="eyebrow">ADMIN DASHBOARD</p>
          <h1>Ride requests.</h1>
          <p className="intro">Review new requests and assign each one to a driver.</p>
        </div>
        <div className="client-account">
          <span className="avatar" aria-hidden="true">{user.fullName.charAt(0).toUpperCase()}</span>
          <span className="client-account-info"><strong>{user.fullName}</strong><span>Administrator</span></span>
          <button className="secondary-button" type="button" onClick={onLogout}>Sign out</button>
        </div>
      </div>
      {error && <div className="notice error" role="alert">{error}</div>}
      {notice && <div className="notice success" role="status">{notice}</div>}
      <div className="request-section">
        <div className="request-section-heading">
          <div><h2>All requests</h2><p>New requests are listed first.</p></div>
          <button className="secondary-button refresh-button" type="button" onClick={() => setReloadKey((value) => value + 1)} disabled={loading}>Refresh</button>
        </div>
        {loading ? <p className="empty-state">Loading requests…</p> : rides.length === 0 ? <p className="empty-state">There are no ride requests yet.</p> : (
          <div className="request-list">
            {rides.map((ride) => (
              <article className="request-card" key={ride.id}>
                <div className="request-card-top">
                  <div><p className="card-eyebrow">REQUEST #{ride.id}</p><h3>{ride.clientName}</h3><p className="request-time">{formatRideTime(ride.requestedAt)}</p></div>
                  <span className={`status-badge status-${ride.status}`}>{ride.status.replace('_', ' ')}</span>
                </div>
                <div className="request-coordinates">
                  <p><strong>Pickup</strong><span>{ride.pickup.address || 'Address not recorded'}</span><small>{formatCoordinates(ride.pickup)}</small></p>
                  <p><strong>Destination</strong><span>{ride.destination.address || 'Address not recorded'}</span><small>{formatCoordinates(ride.destination)}</small></p>
                </div>
                {ride.driverId ? <p className="assigned-driver">Assigned to {ride.driverName || 'a driver'}</p> : ride.status === 'pending' ? (
                  <div className="assignment-controls">
                    <select aria-label={`Choose a driver for request ${ride.id}`} value={selectedDrivers[ride.id] || ''} onChange={(event) => setSelectedDrivers((current) => ({ ...current, [ride.id]: event.target.value }))}>
                      <option value="">Choose a driver</option>
                      {drivers.map((driver) => <option key={driver.id} value={driver.id}>{driver.fullName}</option>)}
                    </select>
                    <button className="primary-button" type="button" onClick={() => assignDriver(ride.id)} disabled={assigningRide === ride.id || drivers.length === 0}>
                      {assigningRide === ride.id ? 'Assigning…' : 'Assign driver'}
                    </button>
                    {drivers.length === 0 && <small>Create a driver account before assigning a request.</small>}
                  </div>
                ) : null}
                {ride.status === 'completed' && <TripSummary ride={ride} />}
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function DriverDashboard({ user, onLogout }) {
  const [rides, setRides] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [workingRide, setWorkingRide] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [suggestedRouteState, setSuggestedRouteState] = useState({
    rideId: null, status: null, points: [], loading: false, error: '',
  })
  const activeRide = rides.find((ride) => ride.status === 'in_progress') || null
  const routeRide = activeRide || rides.find((ride) => ride.status === 'accepted') || null
  const routeStateMatchesRide = suggestedRouteState.rideId === routeRide?.id
    && suggestedRouteState.status === routeRide?.status
  const suggestedRoute = routeStateMatchesRide ? suggestedRouteState.points : []
  const routeLoading = routeStateMatchesRide && suggestedRouteState.loading
  const routeError = routeStateMatchesRide ? suggestedRouteState.error : ''

  useEffect(() => {
    let active = true
    async function loadRides() {
      setLoading(true)
      setError('')
      try {
        const response = await fetch(`${API_URL}/api/rides/assigned`, { credentials: 'include' })
        const data = await response.json()
        if (!response.ok) throw new Error(data.message || 'Unable to load assigned requests.')
        if (active) setRides(data.rides || [])
      } catch (loadError) {
        if (active) setError(loadError.message || 'Unable to load assigned requests.')
      } finally {
        if (active) setLoading(false)
      }
    }
    loadRides()
    return () => { active = false }
  }, [reloadKey])

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    if (!routeRide) return () => { active = false }

    async function loadSuggestedRoute() {
      setSuggestedRouteState({ rideId: routeRide.id, status: routeRide.status, points: [], loading: true, error: '' })
      try {
        const route = await fetchSuggestedRoute({
          origin: routeRide.pickup,
          waypoints: [routeRide.destination],
          signal: controller.signal,
        })
        if (active) setSuggestedRouteState({
          rideId: routeRide.id, status: routeRide.status, points: route, loading: false, error: '',
        })
      } catch {
        if (active && !controller.signal.aborted) setSuggestedRouteState({
          rideId: routeRide.id,
          status: routeRide.status,
          points: [],
          loading: false,
          error: 'Suggested route is unavailable. Pickup and destination are still shown.',
        })
      }
    }

    loadSuggestedRoute()
    return () => {
      active = false
      controller.abort()
    }
  }, [routeRide])

  async function updateRide(ride, action) {
    setWorkingRide(`${ride.id}:${action}`)
    setError('')
    setNotice('')
    try {
      const options = { method: 'PATCH', credentials: 'include' }
      if (action === 'start' || action === 'end') {
        options.headers = { 'Content-Type': 'application/json' }
        options.body = JSON.stringify({})
      }
      const response = await fetch(`${API_URL}/api/rides/${ride.id}/${action}`, options)
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || 'Unable to update this request.')

      const messages = {
        accept: 'Request accepted.',
        start: 'Trip started. The start time was saved.',
      }
      if (action === 'end') {
        setRides((current) => current.map((item) => (
          item.id === ride.id ? { ...item, ...data.ride } : item
        )))
        setNotice(data.message || 'Trip completed.')
      } else {
        setNotice(messages[action])
      }
      setReloadKey((value) => value + 1)
    } catch (actionError) {
      setError(actionError.message || 'Unable to complete this action.')
    } finally {
      setWorkingRide(null)
    }
  }

  return (
    <section className="role-dashboard">
      <div className="role-dashboard-heading">
        <div className="welcome-copy">
          <p className="eyebrow">DRIVER DASHBOARD</p>
          <h1>Your rides.</h1>
          <p className="intro">Your assignments and completed trips. Route estimates are saved with each request; Start Trip and End Trip record the actual elapsed time.</p>
        </div>
        <div className="client-account">
          <span className="avatar" aria-hidden="true">{user.fullName.charAt(0).toUpperCase()}</span>
          <span className="client-account-info"><strong>{user.fullName}</strong><span>Driver</span></span>
          <button className="secondary-button" type="button" onClick={onLogout}>Sign out</button>
        </div>
      </div>
      {error && <div className="notice error" role="alert">{error}</div>}
      {notice && <div className="notice success" role="status">{notice}</div>}
      <div className="request-section">
        <div className="request-section-heading">
          <div><h2>Your requests</h2><p>Current assignments and completed trips for your account.</p></div>
          <button className="secondary-button refresh-button" type="button" onClick={() => setReloadKey((value) => value + 1)} disabled={loading}>Refresh</button>
        </div>
        {loading ? <p className="empty-state">Loading requests…</p> : rides.length === 0 ? <p className="empty-state">You have no assigned requests.</p> : (
          <div className="request-list">
            {rides.map((ride) => (
              <article className="request-card" key={ride.id}>
                <div className="request-card-top">
                  <div><p className="card-eyebrow">REQUEST #{ride.id}</p><h3>{ride.clientName}</h3><p className="request-time">{formatRideTime(ride.requestedAt)}</p></div>
                  <span className={`status-badge status-${ride.status}`}>{ride.status.replace('_', ' ')}</span>
                </div>
                <div className="request-coordinates">
                  <p><strong>Pickup</strong><span>{ride.pickup.address || 'Address not recorded'}</span><small>{formatCoordinates(ride.pickup)}</small></p>
                  <p><strong>Destination</strong><span>{ride.destination.address || 'Address not recorded'}</span><small>{formatCoordinates(ride.destination)}</small></p>
                </div>
                {(ride.start || ride.end) && <div className="trip-saved-details">
                  {ride.start && <p><strong>Started:</strong> {formatRideTime(ride.startedAt)} · {ride.start.latitude.toFixed(5)}, {ride.start.longitude.toFixed(5)}</p>}
                  {ride.end && <p><strong>Ended:</strong> {formatRideTime(ride.endedAt)} · {ride.end.latitude.toFixed(5)}, {ride.end.longitude.toFixed(5)}</p>}
                </div>}
                {ride.status === 'completed' && <TripSummary ride={ride} />}
                {ride.status !== 'completed' && <div className="driver-map-card">
                  <div className="driver-map-heading"><strong>{ride.status === 'in_progress' ? 'Trip in progress' : 'Pickup and destination'}</strong><span>{routeRide?.id === ride.id && routeLoading ? 'Loading suggested route…' : 'No GPS tracking required'}</span></div>
                  <LocationMap activeLocation="driver" pickup={ride.pickup} destination={ride.destination} suggestedRoute={routeRide?.id === ride.id ? suggestedRoute : []} />
                  {routeRide?.id === ride.id && routeError && <p className="map-attribution">{routeError}</p>}
                  <p className="map-attribution">Dashed line: suggested OSRM route, not a live GPS track. Map data &copy; OpenStreetMap contributors.</p>
                </div>}
                <div className="trip-actions">
                  {ride.status === 'pending' && <button className="primary-button" type="button" onClick={() => updateRide(ride, 'accept')} disabled={workingRide !== null}>{workingRide === `${ride.id}:accept` ? 'Accepting…' : 'Accept request'}</button>}
                  {ride.status === 'accepted' && <button className="primary-button" type="button" onClick={() => updateRide(ride, 'start')} disabled={workingRide !== null}>{workingRide === `${ride.id}:start` ? 'Starting trip…' : 'Start trip'}</button>}
                  {ride.status === 'in_progress' && <button className="primary-button" type="button" onClick={() => updateRide(ride, 'end')} disabled={workingRide !== null}>{workingRide === `${ride.id}:end` ? 'Ending trip…' : 'End trip'}</button>}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function ClientRideHistory({ rides, loading, error, onRetryEstimate, estimateBusyId }) {
  return (
    <section className="request-section client-history">
      <div className="request-section-heading">
        <div><h2>My rides</h2><p>Your ride requests and trip history.</p></div>
      </div>
      {error && <div className="notice error" role="alert">{error}</div>}
      {loading ? <p className="empty-state">Loading your rides…</p> : rides.length === 0 ? (
        <p className="empty-state">You have not requested a ride yet.</p>
      ) : (
        <div className="request-list">
          {rides.map((ride) => (
            <article className="request-card" key={ride.id}>
              <div className="request-card-top">
                <div><p className="card-eyebrow">RIDE #{ride.id}</p><p className="request-time">{formatRideTime(ride.requestedAt)}</p></div>
                <span className={`status-badge status-${ride.status}`}>{ride.status.replace('_', ' ')}</span>
              </div>
              <div className="request-coordinates">
                <p><strong>Pickup</strong><span>{ride.pickup.address || formatCoordinates(ride.pickup)}</span></p>
                <p><strong>Destination</strong><span>{ride.destination.address || formatCoordinates(ride.destination)}</span></p>
              </div>
              {ride.driverName && <p className="assigned-driver">Driver: {ride.driverName}</p>}
              <TripSummary ride={ride} />
              {ride.status === 'pending' && ride.estimateUnavailable && (
                <button className="secondary-button retry-estimate-button" type="button" onClick={() => onRetryEstimate(ride)} disabled={estimateBusyId === ride.id}>
                  {estimateBusyId === ride.id ? 'Retrying estimate…' : 'Retry route estimate'}
                </button>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

function App() {
  const [user, setUser] = useState(null)
  const [mode, setMode] = useState('login')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [notice, setNotice] = useState('')
  const [noticeType, setNoticeType] = useState('error')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [pickup, setPickup] = useState(null)
  const [destination, setDestination] = useState(null)
  const [pickupAddress, setPickupAddress] = useState('')
  const [destinationAddress, setDestinationAddress] = useState('')
  const [activeLocation, setActiveLocation] = useState('pickup')
  const [locationError, setLocationError] = useState('')
  const [locating, setLocating] = useState(false)
  const [rideBusy, setRideBusy] = useState(false)
  const [rideFeedback, setRideFeedback] = useState('')
  const [rideFeedbackType, setRideFeedbackType] = useState('success')
  const [clientRides, setClientRides] = useState([])
  const [clientRidesLoading, setClientRidesLoading] = useState(true)
  const [clientRidesError, setClientRidesError] = useState('')
  const [clientRidesReloadKey, setClientRidesReloadKey] = useState(0)
  const [estimateBusyId, setEstimateBusyId] = useState(null)

  useEffect(() => {
    let active = true
    fetch(`${API_URL}/api/auth/me`, { credentials: 'include' })
      .then(async (response) => {
        const data = await response.json()
        if (response.status === 401) {
          if (active) {
            setUser(null)
            setNotice(data.message || 'Your session has expired. Please sign in again.')
            setNoticeType('error')
          }
          return
        }
        if (!response.ok) {
          throw new Error('Unable to reach the backend. Make sure it is running on port 3000.')
        }
        if (active) setUser(data.user || null)
      })
      .catch((error) => {
        if (active) {
          setNotice(error.message)
          setNoticeType('error')
        }
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (user?.role !== 'client') return undefined
    let active = true
    async function loadClientRides() {
      setClientRidesLoading(true)
      setClientRidesError('')
      try {
        const response = await fetch(`${API_URL}/api/rides`, { credentials: 'include' })
        const data = await response.json()
        if (!response.ok) throw new Error(data.message || 'Unable to load your ride history.')
        if (active) setClientRides(data.rides || [])
      } catch (error) {
        if (active) setClientRidesError(error.message || 'Unable to load your ride history.')
      } finally {
        if (active) setClientRidesLoading(false)
      }
    }
    loadClientRides()
    return () => { active = false }
  }, [user?.id, user?.role, clientRidesReloadKey])

  async function handleSubmit(event) {
    event.preventDefault()
    setBusy(true)
    setNotice('')

    try {
      const endpoint = mode === 'register' ? 'register' : 'login'
      const payload = mode === 'register' ? { fullName, email, password } : { email, password }
      const response = await fetch(`${API_URL}/api/auth/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || 'Request failed.')
      setUser(data.user)
      setPassword('')
      setNotice(mode === 'register' ? 'Account created.' : 'You are signed in.')
      setNoticeType('success')
    } catch (error) {
      setNotice(error.message || 'Unable to connect to the server.')
      setNoticeType('error')
    } finally {
      setBusy(false)
    }
  }

  async function handleLogout() {
    try {
      await fetch(`${API_URL}/api/auth/logout`, { method: 'POST', credentials: 'include' })
    } finally {
      setUser(null)
      setMode('login')
      setNotice('You are signed out.')
      setNoticeType('success')
    }
  }

  function selectLocation(kind, location) {
    const pointAddress = `Map point (${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)})`
    if (kind === 'pickup') {
      setPickup(location)
      setPickupAddress(pointAddress)
    } else {
      setDestination(location)
      setDestinationAddress(pointAddress)
    }
    setLocationError('')
    setRideFeedback('')
  }

  async function retryRideEstimate(ride) {
    setEstimateBusyId(ride.id)
    setRideFeedback('')
    try {
      const response = await fetch(`${API_URL}/api/rides/${ride.id}/estimate`, {
        method: 'POST', credentials: 'include',
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || 'Unable to calculate the route estimate.')
      setClientRides((current) => current.map((item) => (
        item.id === ride.id ? { ...item, ...data.ride } : item
      )))
      setRideFeedback('Route estimate updated.')
      setRideFeedbackType('success')
    } catch (error) {
      setRideFeedback(error.message || 'Unable to calculate the route estimate. Try again later.')
      setRideFeedbackType('error')
    } finally {
      setEstimateBusyId(null)
    }
  }

  async function submitRideRequest() {
    if (!pickup || !destination || !pickupAddress.trim() || !destinationAddress.trim()) return
    setRideBusy(true)
    setRideFeedback('')
    try {
      const response = await fetch(`${API_URL}/api/rides`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          pickupAddress: pickupAddress.trim(),
          pickupLatitude: pickup.latitude,
          pickupLongitude: pickup.longitude,
          destinationAddress: destinationAddress.trim(),
          destinationLatitude: destination.latitude,
          destinationLongitude: destination.longitude,
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || 'Unable to create your ride request.')
      setRideFeedback(data.ride.estimateUnavailable
        ? `Request #${data.ride.id} sent. The route estimate is unavailable, so no distance, duration, or fare has been added. You can retry the estimate from My rides.`
        : `Request #${data.ride.id} sent. Estimated road distance: ${Number(data.ride.estimatedDistanceKm).toFixed(3)} km; estimated travel time: ${data.ride.estimatedDurationMinutes} min; estimated fare: €${Number(data.ride.estimatedFare).toFixed(2)}.`)
      setRideFeedbackType('success')
      setClientRidesReloadKey((value) => value + 1)
    } catch (requestError) {
      setRideFeedback(requestError.message || 'Unable to connect to the server.')
      setRideFeedbackType('error')
    } finally {
      setRideBusy(false)
    }
  }

  function useMyLocation() {
    setLocationError('')
    if (!navigator.geolocation) {
      setLocationError('Location is not available in this browser.')
      return
    }

    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const location = { latitude: coords.latitude, longitude: coords.longitude }
        setPickup(location)
        setPickupAddress(`Map point (${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)})`)
        setActiveLocation('pickup')
        setLocationError('')
        setLocating(false)
      },
      () => {
        setLocationError('Could not get your location. Check your browser permissions and try again.')
        setLocating(false)
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    )
  }

  if (loading) {
    return <main className="page-shell"><div className="loading-card">Checking your session…</div></main>
  }

  return (
    <main className="page-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="TaxiTrack home">
          <span className="brand-icon" aria-hidden="true">T</span>
          <span>TaxiTrack</span>
        </a>
        <span className="topbar-note">Simple ride management</span>
      </header>

      {user ? (
        user.role === 'client' ? (
          <section className="client-dashboard">
            <div className="client-dashboard-heading">
              <div className="welcome-copy">
                <p className="eyebrow">CLIENT DASHBOARD</p>
                <h1>Choose your locations.</h1>
                <p className="intro">Hi {user.fullName.split(' ')[0]}. Select your pickup and destination on the map.</p>
              </div>
              <div className="client-account">
                <span className="avatar" aria-hidden="true">{user.fullName.charAt(0).toUpperCase()}</span>
                <span className="client-account-info"><strong>{user.fullName}</strong><span>{ROLE_LABELS[user.role]}</span></span>
                <button className="secondary-button" type="button" onClick={handleLogout}>Sign out</button>
              </div>
            </div>
            <div className="location-layout">
              <aside className="location-panel">
                <p className="card-eyebrow">RIDE LOCATIONS</p>
                <p className="location-help">Choose Pickup or Destination, click the map, then edit the generated point label if you know the street address.</p>
                <div className="location-tabs" role="group" aria-label="Choose which location to set">
                  <button className={activeLocation === 'pickup' ? 'location-tab active' : 'location-tab'} type="button" onClick={() => setActiveLocation('pickup')}>
                    <span className="location-dot pickup-dot" /> Pickup
                  </button>
                  <button className={activeLocation === 'destination' ? 'location-tab active' : 'location-tab'} type="button" onClick={() => setActiveLocation('destination')}>
                    <span className="location-dot destination-dot" /> Destination
                  </button>
                </div>
                <button className="secondary-button location-button" type="button" onClick={useMyLocation} disabled={locating}>
                  {locating ? 'Finding your location…' : 'Use my current location'}
                </button>
                {locationError && <p className="location-error" role="alert">{locationError}</p>}
                <label className="field address-field">
                  <span>Pickup address</span>
                  <input value={pickupAddress} onFocus={() => setActiveLocation('pickup')} onChange={(event) => setPickupAddress(event.target.value)} maxLength={300} required placeholder="Street, landmark, or place" />
                </label>
                <label className="field address-field">
                  <span>Destination address</span>
                  <input value={destinationAddress} onFocus={() => setActiveLocation('destination')} onChange={(event) => setDestinationAddress(event.target.value)} maxLength={300} required placeholder="Street, landmark, or place" />
                </label>
                <div className="coordinate-list">
                  <div className="coordinate-item">
                    <span className="location-dot pickup-dot" />
                    <span><strong>Pickup</strong><small>{formatCoordinates(pickup)}</small></span>
                  </div>
                  <div className="coordinate-item">
                    <span className="location-dot destination-dot" />
                    <span><strong>Destination</strong><small>{formatCoordinates(destination)}</small></span>
                  </div>
                </div>
                {rideFeedback && <div className={`notice ${rideFeedbackType}`} role={rideFeedbackType === 'error' ? 'alert' : 'status'}>{rideFeedback}</div>}
                <button className="primary-button create-ride-button" type="button" onClick={submitRideRequest} disabled={!pickup || !destination || !pickupAddress.trim() || !destinationAddress.trim() || rideBusy}>
                  {rideBusy ? 'Sending request…' : 'Request a taxi'}
                </button>
              </aside>
              <div className="map-card">
                <LocationMap activeLocation={activeLocation} pickup={pickup} destination={destination} onSelect={selectLocation} />
                <p className="map-attribution">Map data &copy; OpenStreetMap contributors</p>
              </div>
            </div>
            <ClientRideHistory rides={clientRides} loading={clientRidesLoading} error={clientRidesError} onRetryEstimate={retryRideEstimate} estimateBusyId={estimateBusyId} />
            <p className="map-note">The map shows the selected coordinates. Route distance and travel time are estimates; actual elapsed time is recorded between Start Trip and End Trip.</p>
          </section>
        ) : user.role === 'admin' ? (
          <AdminDashboard user={user} onLogout={handleLogout} />
        ) : (
          <DriverDashboard user={user} onLogout={handleLogout} />
        )
      ) : (
        <section className="auth-layout">
          <div className="welcome-copy">
            <p className="eyebrow">WELCOME TO TAXITRACK</p>
            <h1>Manage your taxi rides.</h1>
            <p className="intro">Sign in, or create a client account to get started.</p>
            <div className="feature-list">
              <div><span className="feature-check">✓</span><span>Password-protected accounts</span></div>
              <div><span className="feature-check">✓</span><span>A dashboard for each role</span></div>
            </div>
          </div>

          <div className="auth-card">
            <div className="auth-tabs" role="tablist" aria-label="Sign in or create an account">
              <button className={mode === 'login' ? 'auth-tab active' : 'auth-tab'} type="button" onClick={() => { setMode('login'); setNotice('') }}>Sign in</button>
              <button className={mode === 'register' ? 'auth-tab active' : 'auth-tab'} type="button" onClick={() => { setMode('register'); setNotice('') }}>Create account</button>
            </div>
            <div className="form-heading">
              <h2>{mode === 'register' ? 'Create your account' : 'Welcome back'}</h2>
              <p>{mode === 'register' ? 'New accounts are for clients.' : 'Sign in with your email and password.'}</p>
            </div>
            {notice && <div className={`notice ${noticeType}`} role="status">{notice}</div>}
            <form onSubmit={handleSubmit}>
              {mode === 'register' && (
                <label className="field">
                  <span>Full name</span>
                  <input autoComplete="name" value={fullName} onChange={(event) => setFullName(event.target.value)} minLength={2} maxLength={160} required placeholder="e.g. Alex Smith" />
                </label>
              )}
              <label className="field">
                <span>Email</span>
                <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={254} required placeholder="name@example.com" />
              </label>
              <label className="field">
                <span>Password</span>
                <input type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} value={password} onChange={(event) => setPassword(event.target.value)} minLength={mode === 'register' ? 8 : undefined} maxLength={72} required placeholder={mode === 'register' ? 'At least 8 characters' : 'Enter your password'} />
              </label>
              <button className="primary-button" type="submit" disabled={busy}>
                {busy ? 'Please wait…' : mode === 'register' ? 'Create your account' : 'Sign in'}
                {!busy && <span aria-hidden="true">→</span>}
              </button>
            </form>
            <p className="security-note"><span aria-hidden="true">⌑</span> Your sign-in details are sent securely.</p>
          </div>
        </section>
      )}
      <footer className="footer"><span>TaxiTrack</span><span>Taxi management</span></footer>
    </main>
  )
}

export default App
