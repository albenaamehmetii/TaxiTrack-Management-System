import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './App.css'
import { fetchSuggestedRoute } from './routing.js'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000'
const DEFAULT_CENTER = [42.6629, 21.1655]
const ADMIN_PAGE_SIZE = 20

function LocationMap({ activeLocation, pickup, destination, onSelect, driverLocation = null, rideTrace = [], suggestedRoute = [], focusSequence = 0 }) {
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

function formatRideAge(value) {
  const timestamp = new Date(value).getTime()
  if (Number.isNaN(timestamp)) return 'Time unavailable'
  const hours = Math.max(0, Math.floor((Date.now() - timestamp) / 3600000))
  if (hours < 1) return 'less than an hour ago'
  return `about ${hours} ${hours === 1 ? 'hour' : 'hours'} ago`
}

function rideDateForFilter(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Belgrade', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date).map(({ type, value: partValue }) => [type, partValue]))
  return `${parts.year}-${parts.month}-${parts.day}`
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

function AdminPagination({ page, pageCount, onPageChange }) {
  if (pageCount <= 1) return null
  return (
    <nav className="admin-pagination" aria-label="Request pages">
      <button type="button" className="secondary-button" onClick={() => onPageChange((current) => Math.max(0, current - 1))} disabled={page === 0}>Previous</button>
      <span>Page {page + 1} of {pageCount}</span>
      <button type="button" className="secondary-button" onClick={() => onPageChange((current) => Math.min(pageCount - 1, current + 1))} disabled={page >= pageCount - 1}>Next</button>
    </nav>
  )
}

function AdminRatingsSection() {
  const [drivers, setDrivers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let active = true
    async function loadRatings() {
      setLoading(true)
      setError('')
      try {
        const response = await fetch(`${API_URL}/api/admin/ratings`, { credentials: 'include' })
        const data = await response.json()
        if (!response.ok) throw new Error(data.message || 'Unable to load driver ratings.')
        if (active) setDrivers(data.drivers || [])
      } catch (loadError) {
        if (active) setError(loadError.message || 'Unable to load driver ratings.')
      } finally {
        if (active) setLoading(false)
      }
    }
    loadRatings()
    return () => { active = false }
  }, [reloadKey])

  const shownDrivers = drivers.filter((driver) => !filter || driver.driverId === filter)
  return (
    <section className="request-section admin-ratings-section">
        <div className="request-section-heading"><div><h2>Driver ratings</h2><p>Ratings are based on completed rides.</p></div><button type="button" className="secondary-button" onClick={() => setReloadKey((value) => value + 1)} disabled={loading}>{loading ? 'Loading…' : 'Refresh ratings'}</button></div>
        <div className="admin-ratings-content">
          {drivers.length > 0 && <label className="rating-filter"><span>Filter by driver</span><select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="">All drivers</option>{drivers.map((driver) => <option key={driver.driverId} value={driver.driverId}>{driver.driverName}</option>)}</select></label>}
          {error && <div className="notice error" role="alert">{error}</div>}
          {loading && <p className="empty-state">Loading ratings…</p>}
          {!loading && !error && shownDrivers.length === 0 && <p className="empty-state">No drivers found.</p>}
          <div className="admin-rating-list">{shownDrivers.map((driver) => (
            <article className="admin-rating-card" key={driver.driverId}>
              <div className="admin-rating-top"><h3>{driver.driverName}</h3><strong>{driver.totalRatings ? `${driver.averageRating.toFixed(1)} / 5` : 'No ratings yet'}</strong></div>
              <p>Total ratings: {driver.totalRatings}</p>
              <div className="rating-distribution">{[5, 4, 3, 2, 1].map((stars) => <span key={stars}>{stars}★ {driver.distribution[stars]}</span>)}</div>
              {driver.ratings.length > 0 && <details className="rating-review-details"><summary>View individual ratings</summary><ul>{driver.ratings.map((rating) => <li key={rating.rideId}><strong>{'★'.repeat(rating.stars)}{'☆'.repeat(5 - rating.stars)}</strong><span>Ride #{rating.rideId} · {formatRideTime(rating.createdAt)}</span>{rating.comment && <p>{rating.comment}</p>}</li>)}</ul></details>}
            </article>
          ))}</div>
        </div>
    </section>
  )
}

function AdminDashboard({ user, onLogout }) {
  const [rides, setRides] = useState([])
  const [drivers, setDrivers] = useState([])
  const [driverApplications, setDriverApplications] = useState([])
  const [selectedDrivers, setSelectedDrivers] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [assigningRide, setAssigningRide] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [clientFilter, setClientFilter] = useState('')
  const [driverFilter, setDriverFilter] = useState('')
  const [currentPage, setCurrentPage] = useState(0)
  const [pastPage, setPastPage] = useState(0)
  const [adminPage, setAdminPage] = useState('requests')
  const busyDriverIds = useMemo(() => new Set(rides
    .filter((ride) => ['accepted', 'in_progress'].includes(ride.status) && ride.driverId)
    .map((ride) => ride.driverId)), [rides])
  const availableDrivers = useMemo(() => drivers.filter((driver) => driver.isOnline && driver.approvalStatus === 'approved' && !busyDriverIds.has(driver.id)), [drivers, busyDriverIds])
  const clients = useMemo(() => [...new Map(rides.map((ride) => [ride.clientId, ride.clientName])).entries()], [rides])
  const currentRides = useMemo(() => rides.filter((ride) => !['completed', 'cancelled'].includes(ride.status)), [rides])
  const pastRides = useMemo(() => rides.filter((ride) => ['completed', 'cancelled'].includes(ride.status)), [rides])
  const filteredPastRides = useMemo(() => pastRides.filter((ride) => {
    const rideDate = rideDateForFilter(ride.createdAt || ride.requestedAt)
    return (!dateFrom || rideDate >= dateFrom)
      && (!dateTo || rideDate <= dateTo)
      && (!clientFilter || ride.clientId === clientFilter)
      && (!driverFilter || (driverFilter === 'unassigned'
        ? !ride.driverId
        : ride.driverId === driverFilter))
  }), [pastRides, dateFrom, dateTo, clientFilter, driverFilter])
  const currentPageCount = Math.max(1, Math.ceil(currentRides.length / ADMIN_PAGE_SIZE))
  const pastPageCount = Math.max(1, Math.ceil(filteredPastRides.length / ADMIN_PAGE_SIZE))
  const visibleCurrentRides = currentRides.slice(Math.min(currentPage, currentPageCount - 1) * ADMIN_PAGE_SIZE, (Math.min(currentPage, currentPageCount - 1) + 1) * ADMIN_PAGE_SIZE)
  const visiblePastRides = filteredPastRides.slice(Math.min(pastPage, pastPageCount - 1) * ADMIN_PAGE_SIZE, (Math.min(pastPage, pastPageCount - 1) + 1) * ADMIN_PAGE_SIZE)

  useEffect(() => {
    let active = true
    let inFlight = false
    async function loadData(showLoading = false) {
      if (inFlight) return
      inFlight = true
      if (showLoading) setLoading(true)
      setError('')
      try {
        const [ridesResponse, usersResponse, applicationsResponse] = await Promise.all([
          fetch(`${API_URL}/api/admin/rides`, { credentials: 'include' }),
          fetch(`${API_URL}/api/admin/users`, { credentials: 'include' }),
          fetch(`${API_URL}/api/admin/driver-applications`, { credentials: 'include' }),
        ])
        const [ridesData, usersData, applicationsData] = await Promise.all([ridesResponse.json(), usersResponse.json(), applicationsResponse.json()])
        if (!ridesResponse.ok) throw new Error(ridesData.message || 'Unable to load ride requests.')
        if (!usersResponse.ok) throw new Error(usersData.message || 'Unable to load drivers.')
        if (!applicationsResponse.ok) throw new Error(applicationsData.message || 'Unable to load driver applications.')
        if (active) {
          setRides(ridesData.rides || [])
          setDrivers((usersData.users || []).filter((item) => item.role === 'driver'))
          setDriverApplications(applicationsData.applications || [])
        }
      } catch (loadError) {
        if (active) setError(loadError.message || 'Unable to load the admin dashboard.')
      } finally {
        inFlight = false
        if (active && showLoading) setLoading(false)
      }
    }
    loadData(reloadKey === 0)
    const refreshTimer = window.setInterval(loadData, 5000)
    return () => { active = false; window.clearInterval(refreshTimer) }
  }, [reloadKey])

  async function assignDriver(rideId) {
    const driverId = selectedDrivers[rideId]
    if (!driverId || !availableDrivers.some((driver) => driver.id === driverId)) {
      setError(driverId ? 'This driver is no longer available. Choose another driver.' : 'Choose a driver first.')
      return
    }
    setAssigningRide(rideId)
    setError('')
    try {
      const response = await fetch(`${API_URL}/api/admin/rides/${rideId}/assign-driver`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ driverId }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || 'Unable to assign this request.')
      setReloadKey((value) => value + 1)
    } catch (assignError) {
      setError(assignError.message || 'Unable to assign this request.')
    } finally {
      setAssigningRide(null)
    }
  }

  async function reviewDriverApplication(driverId, decision) {
    setError('')
    try {
      const response = await fetch(`${API_URL}/api/admin/driver-applications/${driverId}/review`, {
        method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || 'Unable to review this application.')
      setReloadKey((value) => value + 1)
    } catch (reviewError) {
      setError(reviewError.message || 'Unable to review this application.')
    }
  }

  function renderRideRequest(ride) {
    const isPast = ['completed', 'cancelled'].includes(ride.status)
    if (isPast) {
      return (
        <article className="request-card past-request-card" key={ride.id}>
          <div className="request-card-top">
            <div><p className="card-eyebrow">REQUEST #{ride.id}</p><h3>{ride.clientName}</h3><p className="request-time">{formatRideTime(ride.createdAt || ride.requestedAt)}</p></div>
            <span className={`status-badge status-${ride.status}`}>{ride.status.replace('_', ' ')}</span>
          </div>
          <div className="request-coordinates">
            <p><strong>Pickup</strong><span>Map point ({formatCoordinates(ride.pickup)})</span></p>
            <p><strong>Destination</strong><span>Map point ({formatCoordinates(ride.destination)})</span></p>
          </div>
          <p className="assigned-driver">Assigned to {ride.driverName || '—'}</p>
          {ride.status === 'completed' && <details className="past-request-details"><summary>More trip details</summary><TripSummary ride={ride} /></details>}
        </article>
      )
    }
    return (
      <article className="request-card" key={ride.id}>
        <div className="request-card-top">
          <div><p className="card-eyebrow">REQUEST #{ride.id}</p><h3>{ride.clientName}</h3><p className="request-time">{formatRideTime(ride.createdAt || ride.requestedAt)}</p></div>
          <span className={`status-badge status-${ride.status}`}>{ride.status.replace('_', ' ')}</span>
        </div>
        <div className="request-coordinates">
          <p><strong>Pickup</strong><span>{ride.pickup.address || 'Address not recorded'}</span><small>{formatCoordinates(ride.pickup)}</small></p>
          <p><strong>Destination</strong><span>{ride.destination.address || 'Address not recorded'}</span><small>{formatCoordinates(ride.destination)}</small></p>
        </div>
        {ride.driverId ? <p className="assigned-driver">Assigned to {ride.driverName || 'a driver'}</p> : ride.status === 'pending' ? (
          <div className="assignment-controls">
            <select aria-label={`Choose a driver for request ${ride.id}`} value={availableDrivers.some((driver) => driver.id === selectedDrivers[ride.id]) ? selectedDrivers[ride.id] : ''} onChange={(event) => setSelectedDrivers((current) => ({ ...current, [ride.id]: event.target.value }))}>
              <option value="">Choose a driver</option>
              {availableDrivers.map((driver) => <option key={driver.id} value={driver.id}>{driver.fullName}</option>)}
            </select>
            <button className="primary-button" type="button" onClick={() => assignDriver(ride.id)} disabled={assigningRide === ride.id || availableDrivers.length === 0}>
              {assigningRide === ride.id ? 'Assigning…' : 'Assign driver'}
            </button>
            {availableDrivers.length === 0 && <small>Nuk ka taksist të lirë për momentin.</small>}
          </div>
        ) : null}
        {ride.status === 'completed' && <TripSummary ride={ride} />}
      </article>
    )
  }

  return (
    <section className="role-dashboard admin-dashboard">
      <div className="role-dashboard-heading">
        <div className="welcome-copy">
          <p className="eyebrow">ADMIN DASHBOARD</p>
          <h1>{adminPage === 'ratings' ? 'Driver ratings.' : adminPage === 'drivers' ? 'Driver applications.' : 'Ride requests.'}</h1>
          <p className="intro">{adminPage === 'ratings' ? 'Review driver ratings and rider feedback.' : adminPage === 'drivers' ? 'Review driver details and approve or reject applications.' : 'Review new requests and assign each one to a driver.'}</p>
        </div>
        <div className="client-account">
          <span className="avatar" aria-hidden="true">{user.fullName.charAt(0).toUpperCase()}</span>
          <span className="client-account-info"><strong>{user.fullName}</strong><span>Administrator</span></span>
          <button className="secondary-button" type="button" onClick={onLogout}>Sign out</button>
        </div>
      </div>
      <nav className="admin-page-nav" aria-label="Administrator pages">
        <button type="button" className={adminPage === 'requests' ? 'active' : ''} aria-current={adminPage === 'requests' ? 'page' : undefined} onClick={() => setAdminPage('requests')}>Past Requests</button>
        <button type="button" className={adminPage === 'drivers' ? 'active' : ''} aria-current={adminPage === 'drivers' ? 'page' : undefined} onClick={() => setAdminPage('drivers')}>Driver applications{driverApplications.filter((item) => item.status === 'pending').length > 0 && ` (${driverApplications.filter((item) => item.status === 'pending').length})`}</button>
        <button type="button" className={adminPage === 'ratings' ? 'active' : ''} aria-current={adminPage === 'ratings' ? 'page' : undefined} onClick={() => setAdminPage('ratings')}>Ratings</button>
      </nav>
      {error && <div className="notice error" role="alert">{error}</div>}
      {adminPage === 'requests' ? <div className="request-section">
        <div className="request-section-heading">
          <div><h2>All requests</h2><p>New requests are listed first.</p></div>
          <button className="secondary-button refresh-button" type="button" onClick={() => setReloadKey((value) => value + 1)} disabled={loading}>Refresh</button>
        </div>
        {loading ? <p className="empty-state">Loading requests…</p> : rides.length === 0 ? <p className="empty-state">There are no ride requests yet.</p> : (
          <div className="admin-request-groups">
            {availableDrivers.length === 0 && currentRides.some((ride) => ride.status === 'pending') && (
              <div className="availability-notice" role="status">
                Nuk ka taksist të lirë për momentin. Mund të prisni derisa të lirohet një taksist ose ta anuloni kërkesën.
              </div>
            )}
            {currentRides.length > 0 && <section className="admin-request-group">
              <div className="admin-group-heading"><h3>Current requests</h3><span>{currentRides.length}</span></div>
              <div className="request-list">{visibleCurrentRides.map(renderRideRequest)}</div>
              <AdminPagination page={Math.min(currentPage, currentPageCount - 1)} pageCount={currentPageCount} onPageChange={setCurrentPage} />
            </section>}
            <section className="admin-request-group past-requests">
              <div className="admin-group-heading"><h3>Past requests</h3><span>{filteredPastRides.length}</span></div>
              <div className="ride-filters" aria-label="Filter past requests">
                <label><span>From date</span><input type="date" value={dateFrom} onChange={(event) => { setDateFrom(event.target.value); setPastPage(0) }} /></label>
                <label><span>To date</span><input type="date" value={dateTo} onChange={(event) => { setDateTo(event.target.value); setPastPage(0) }} /></label>
                <label><span>Client</span><select value={clientFilter} onChange={(event) => { setClientFilter(event.target.value); setPastPage(0) }}>
                  <option value="">All clients</option>
                  {clients.map(([clientId, clientName]) => <option key={clientId} value={clientId}>{clientName}</option>)}
                </select></label>
                <label><span>Driver</span><select value={driverFilter} onChange={(event) => { setDriverFilter(event.target.value); setPastPage(0) }}>
                  <option value="">All drivers</option>
                  <option value="unassigned">Unassigned</option>
                  {drivers.map((driver) => <option key={driver.id} value={driver.id}>{driver.fullName}</option>)}
                </select></label>
                <button className="secondary-button clear-filters-button" type="button" onClick={() => {
                  setDateFrom('')
                  setDateTo('')
                  setClientFilter('')
                  setDriverFilter('')
                  setPastPage(0)
                }}>Clear filters</button>
              </div>
              <p className="filter-count">Showing {filteredPastRides.length === 0 ? 0 : Math.min(filteredPastRides.length, Math.min(pastPage, pastPageCount - 1) * ADMIN_PAGE_SIZE + 1)}–{Math.min(filteredPastRides.length, (Math.min(pastPage, pastPageCount - 1) + 1) * ADMIN_PAGE_SIZE)} of {filteredPastRides.length} matching past requests ({pastRides.length} total)</p>
              {filteredPastRides.length === 0 ? (
                <p className="empty-state">{pastRides.length === 0 ? 'No past requests yet.' : 'No past requests match these filters.'}</p>
              ) : <div className="request-list">{visiblePastRides.map(renderRideRequest)}</div>}
              <AdminPagination page={Math.min(pastPage, pastPageCount - 1)} pageCount={pastPageCount} onPageChange={setPastPage} />
            </section>
          </div>
        )}
      </div> : adminPage === 'drivers' ? <section className="driver-application-list" aria-label="Driver applications">
        {loading && <p className="empty-state">Loading applications…</p>}
        {!loading && driverApplications.length === 0 && <p className="empty-state">There are no driver applications yet.</p>}
        {driverApplications.map((application) => <article className="driver-application-card" key={application.driverId}>
          <div className="admin-group-heading"><h3>{application.fullName}</h3><span className={`status-badge status-${application.status}`}>{application.status}</span></div>
          <p>{application.email} · {application.phone}</p>
          <p><strong>Driver license:</strong> {application.licenseNumber}</p>
          <p><strong>Vehicle registration number:</strong> {application.vehiclePlate}</p>
          <small>Submitted {formatRideTime(application.submittedAt)}</small>
          {application.status === 'pending' && <div className="driver-application-actions">
            <button className="primary-button" type="button" onClick={() => reviewDriverApplication(application.driverId, 'approved')}>Approve</button>
            <button className="secondary-button" type="button" onClick={() => reviewDriverApplication(application.driverId, 'rejected')}>Reject</button>
          </div>}
        </article>)}
      </section> : <AdminRatingsSection />}
    </section>
  )
}

function DriverStatusPage() {
  const [presence, setPresence] = useState({ isOnline: false, location: null })
  const [error, setError] = useState('')
  const [presenceBusy, setPresenceBusy] = useState(false)
  const [locating, setLocating] = useState(false)
  const [locationFocusSequence, setLocationFocusSequence] = useState(0)

  useEffect(() => {
    let active = true
    fetch(`${API_URL}/api/rides/presence`, { credentials: 'include' })
      .then(async (response) => {
        const data = await response.json()
        if (!response.ok) throw new Error(data.message || 'Unable to load availability.')
        if (active) setPresence(data.presence)
      })
      .catch((loadError) => { if (active) setError(loadError.message) })
    return () => { active = false }
  }, [])

  async function savePresence(nextOnline, location = presence.location) {
    setPresenceBusy(true)
    setError('')
    try {
      if (nextOnline && !location) throw new Error('Choose your current location or set it on the map before going online.')
      const response = await fetch(`${API_URL}/api/rides/presence`, {
        method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isOnline: nextOnline, ...(location || {}) }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || 'Unable to update availability.')
      setPresence(data.presence)
    } catch (saveError) { setError(saveError.message || 'Unable to update availability.') }
    finally { setPresenceBusy(false) }
  }

  function useCurrentLocation() {
    setError('')
    if (!navigator.geolocation) { setError('Location access is not supported by this browser.'); return }
    setLocating(true)
    navigator.geolocation.getCurrentPosition((position) => {
      const location = { latitude: position.coords.latitude, longitude: position.coords.longitude }
      setPresence((current) => ({ ...current, location }))
      setLocationFocusSequence((current) => current + 1)
      setLocating(false)
    }, () => {
      setError('Could not access your location. Allow location permission or choose a point on the map.')
      setLocating(false)
    }, { enableHighAccuracy: true, timeout: 12000 })
  }

  return (
    <section className="driver-presence-card driver-status-page">
      <div className="driver-presence-copy"><p className="card-eyebrow">DRIVER STATUS</p><h2>{presence.isOnline ? 'You’re online' : 'You’re offline'}</h2><p>{presence.isOnline ? 'Your account can receive new ride assignments while you are free.' : 'Go online when you are ready to receive ride assignments.'}</p></div>
      <button className="driver-status-switch" type="button" role="switch" aria-checked={presence.isOnline} aria-label="Driver availability" onClick={() => savePresence(!presence.isOnline)} disabled={presenceBusy || (!presence.isOnline && !presence.location)}>
        <span className="driver-status-switch-track" aria-hidden="true"><span /></span>
        <span>{presenceBusy ? 'Saving…' : presence.isOnline ? 'Online' : 'Offline'}</span>
      </button>
      <div className="driver-location-controls"><button className="secondary-button" type="button" onClick={useCurrentLocation} disabled={presenceBusy || locating}>{locating ? 'Locating…' : 'Use current location'}</button><span>{presence.location ? `Selected: ${formatCoordinates(presence.location)}` : 'Choose your location with GPS or on the map.'}</span></div>
      <div className="driver-presence-map"><LocationMap activeLocation="driver" pickup={null} destination={null} driverLocation={presence.location} focusSequence={locationFocusSequence} onSelect={(_active, point) => { setPresence((current) => ({ ...current, location: point })) }} /></div>
      {presence.location && <button className="secondary-button driver-save-location" type="button" onClick={() => savePresence(presence.isOnline, presence.location)} disabled={presenceBusy}>Confirm location</button>}
      {error && <div className="notice error" role="alert">{error}</div>}
    </section>
  )
}

function DriverDashboard({ user, onLogout }) {
  const [dashboardPage, setDashboardPage] = useState('rides')
  const [rides, setRides] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notifications, setNotifications] = useState([])
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [notificationAlerts, setNotificationAlerts] = useState([])
  const seenNotificationIdsRef = useRef(new Set())
  const notificationsInitializedRef = useRef(false)
  const dashboardPageRef = useRef(dashboardPage)
  const notificationToast = notificationAlerts[0] || null

  useEffect(() => { dashboardPageRef.current = dashboardPage }, [dashboardPage])
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
    let inFlight = false
    async function loadRides(showLoading = false) {
      if (inFlight) return
      inFlight = true
      if (showLoading) setLoading(true)
      setError('')
      try {
        const response = await fetch(`${API_URL}/api/rides/assigned`, { credentials: 'include' })
        const data = await response.json()
        if (!response.ok) throw new Error(data.message || 'Unable to load assigned requests.')
        if (active) setRides(data.rides || [])
      } catch (loadError) {
        if (active) setError(loadError.message || 'Unable to load assigned requests.')
      } finally {
        inFlight = false
        if (active && showLoading) setLoading(false)
      }
    }
    loadRides(true)
    const refreshTimer = window.setInterval(() => loadRides(), 5000)
    return () => { active = false; window.clearInterval(refreshTimer) }
  }, [reloadKey])

  useEffect(() => {
    let active = true
    let inFlight = false
    async function loadNotifications() {
      if (inFlight) return
      inFlight = true
      try {
        const response = await fetch(`${API_URL}/api/rides/notifications`, { credentials: 'include' })
        const data = await response.json()
        if (!response.ok) throw new Error(data.message || 'Unable to load ride notifications.')
        const nextNotifications = data.notifications || []
        const freshNotifications = nextNotifications.filter((item) => !seenNotificationIdsRef.current.has(item.id))
        if (active && notificationsInitializedRef.current) {
          const alertNotifications = freshNotifications.filter((item) => (
            ['new_ride_request', 'ride_cancelled'].includes(item.type)
            && !(item.type === 'new_ride_request' && dashboardPageRef.current === 'rides')
          ))
          if (alertNotifications.length) setNotificationAlerts((current) => {
            const queuedIds = new Set(current.map((item) => item.id))
            return [...current, ...alertNotifications.filter((item) => !queuedIds.has(item.id))]
          })
        }
        nextNotifications.forEach((item) => seenNotificationIdsRef.current.add(item.id))
        notificationsInitializedRef.current = true
        if (active) setNotifications(nextNotifications)
      } catch (notificationError) {
        if (active) setError(notificationError.message || 'Unable to load ride notifications.')
      } finally { inFlight = false }
    }
    loadNotifications()
    const timer = window.setInterval(loadNotifications, 5000)
    return () => { active = false; window.clearInterval(timer) }
  }, [])

  useEffect(() => {
    if (!notificationToast) return undefined
    const timer = window.setTimeout(() => setNotificationAlerts((current) => current.filter((item) => item.id !== notificationToast.id)), 10000)
    return () => window.clearTimeout(timer)
  }, [notificationToast])

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
    try {
      const options = { method: 'PATCH', credentials: 'include' }
      if (action === 'start' || action === 'end') {
        options.headers = { 'Content-Type': 'application/json' }
        options.body = JSON.stringify({})
      }
      const response = await fetch(`${API_URL}/api/rides/${ride.id}/${action}`, options)
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || 'Unable to update this request.')

      if (action === 'end') {
        setRides((current) => current.map((item) => (
          item.id === ride.id ? { ...item, ...data.ride } : item
        )))
      }
      setReloadKey((value) => value + 1)
    } catch (actionError) {
      setError(actionError.message || 'Unable to complete this action.')
    } finally {
      setWorkingRide(null)
    }
  }

  const unreadNotificationCount = notifications.filter((notification) => !notification.readAt).length

  async function markAllNotificationsRead() {
    if (unreadNotificationCount === 0) return
    try {
      const response = await fetch(`${API_URL}/api/rides/notifications/read-all`, { method: 'PATCH', credentials: 'include' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || 'Unable to mark your notifications as read.')
      const readAt = new Date().toISOString()
      setNotifications((current) => current.map((notification) => notification.readAt ? notification : { ...notification, readAt }))
    } catch (notificationError) {
      setError(notificationError.message || 'Unable to mark your notifications as read.')
    }
  }

  async function openDriverNotification(notification) {
    if (!notification.readAt) {
      try {
        const response = await fetch(`${API_URL}/api/rides/notifications/${notification.id}/read`, { method: 'PATCH', credentials: 'include' })
        const data = await response.json()
        if (!response.ok) throw new Error(data.message || 'Unable to mark this notification as read.')
        setNotifications((current) => current.map((item) => item.id === notification.id ? { ...item, readAt: new Date().toISOString() } : item))
      } catch (notificationError) {
        setError(notificationError.message || 'Unable to mark this notification as read.')
        return false
      }
    }
    setNotificationsOpen(false)
    setDashboardPage('rides')
    setReloadKey((value) => value + 1)
    return true
  }

  async function viewNotificationAlert(notification) {
    if (await openDriverNotification(notification)) {
      setNotificationAlerts((current) => current.filter((item) => item.id !== notification.id))
    }
  }

  function dismissNotificationAlert(notification) {
    setNotificationAlerts((current) => current.filter((item) => item.id !== notification.id))
  }

  return (
    <section className="role-dashboard">
      <div className="role-dashboard-heading driver-dashboard-heading">
        <div className="welcome-copy">
          <p className="eyebrow">DRIVER DASHBOARD</p>
          <h1>{dashboardPage === 'status' ? 'Driver status.' : 'Your rides.'}</h1>
          <p className="intro">{dashboardPage === 'status' ? 'Manage your availability and confirm your current location.' : 'Your assignments and completed trips. Route estimates are saved with each request; Start Trip and End Trip record the actual elapsed time.'}</p>
        </div>
        <div className="client-account">
          <span className="avatar" aria-hidden="true">{user.fullName.charAt(0).toUpperCase()}</span>
          <span className="client-account-info"><strong>{user.fullName}</strong><span>Driver</span></span>
          <button className="secondary-button" type="button" aria-current={dashboardPage === 'rides' ? 'page' : undefined} onClick={() => setDashboardPage('rides')}>Your rides</button>
          <button className="secondary-button" type="button" aria-current={dashboardPage === 'status' ? 'page' : undefined} onClick={() => setDashboardPage('status')}>Driver Status</button>
          <div className="driver-notification-control">
            <button className="driver-notification-bell" type="button" aria-label={`Notifications${unreadNotificationCount ? `, ${unreadNotificationCount} unread` : ''}`} aria-expanded={notificationsOpen} onClick={() => setNotificationsOpen((open) => !open)}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg>
              {unreadNotificationCount > 0 && <span className="driver-notification-count">{unreadNotificationCount > 99 ? '99+' : unreadNotificationCount}</span>}
            </button>
            {notificationsOpen && <div className="driver-notification-panel" role="region" aria-label="Driver notifications">
              <div className="driver-notification-panel-heading"><strong>Notifications</strong><button type="button" onClick={markAllNotificationsRead} disabled={unreadNotificationCount === 0}>Mark all as read</button></div>
              {notifications.length === 0 ? <p className="driver-notification-empty">No notifications yet.</p> : <div className="driver-notification-list">
                {notifications.map((notification) => <button type="button" className={`driver-notification-item is-${notification.type}${notification.readAt ? ' is-read' : ' is-unread'}`} key={notification.id} onClick={() => openDriverNotification(notification)}>
                  <span className="driver-notification-item-heading"><strong><span aria-hidden="true">{notification.type === 'ride_cancelled' ? '✕' : notification.type === 'new_ride_request' ? '🚕' : notification.type === 'new_rating_received' ? '★' : '•'}</span> {notification.title}</strong><small>{notification.readAt ? 'Read' : 'Unread'}</small></span>
                  <span className="driver-notification-message">{notification.message}</span>
                  {notification.rating && <span className="driver-notification-rating"><strong>{'★'.repeat(notification.rating.stars)}{'☆'.repeat(5 - notification.rating.stars)}</strong>{notification.rating.comment && <span>{notification.rating.comment}</span>}</span>}
                  <time dateTime={notification.createdAt}>{formatRideTime(notification.createdAt)}</time>
                </button>)}
              </div>}
            </div>}
          </div>
          <button className="secondary-button" type="button" onClick={onLogout}>Sign out</button>
        </div>
      </div>
      {error && <div className="notice error" role="alert">{error}</div>}
      {notificationToast && <div className={`driver-notification-toast is-${notificationToast.type}`} role="alert" aria-live="assertive">
        <span className="driver-notification-toast-icon" aria-hidden="true">{notificationToast.type === 'ride_cancelled' ? '✕' : '🚕'}</span>
        <div className="driver-notification-toast-content">
          <strong>{notificationToast.type === 'ride_cancelled' ? 'RIDE CANCELLED' : 'NEW RIDE REQUEST'}</strong>
          <span>{notificationToast.type === 'ride_cancelled' ? 'The customer has cancelled the ride.' : 'New ride request received. Check the details and accept or decline the request.'}</span>
          <button type="button" className="driver-notification-toast-action" onClick={() => viewNotificationAlert(notificationToast)}>{notificationToast.type === 'ride_cancelled' ? 'View Details' : 'View Request'}</button>
        </div>
        <button type="button" className="driver-notification-toast-close" aria-label="Dismiss notification" onClick={() => dismissNotificationAlert(notificationToast)}>×</button>
      </div>}
      {dashboardPage === 'status' ? <DriverStatusPage /> : <div className="request-section">
        <div className="request-section-heading">
          <div><h2>All requests</h2><p>Current assignments and completed trips for your account.</p></div>
          <button className="secondary-button refresh-button" type="button" onClick={() => setReloadKey((value) => value + 1)} disabled={loading}>Refresh</button>
        </div>
        {loading ? <p className="empty-state">Loading requests…</p> : rides.length === 0 ? <p className="empty-state">You have no assigned requests.</p> : (
          <div className="request-list driver-request-list">
            {rides.map((ride) => (
              <article className="request-card past-request-card driver-request-card" key={ride.id}>
                <div className="request-card-top">
                  <div><p className="card-eyebrow">REQUEST #{ride.id}</p><h3>{ride.clientName}</h3><p className="request-time">{formatRideTime(ride.requestedAt)}</p></div>
                  <span className={`status-badge status-${ride.status}`}>{ride.status.replace('_', ' ')}</span>
                </div>
                <div className="request-coordinates">
                  <p><strong>Pickup</strong><span>Map point ({formatCoordinates(ride.pickup)})</span></p>
                  <p><strong>Destination</strong><span>Map point ({formatCoordinates(ride.destination)})</span></p>
                </div>
                <p className="assigned-driver">Assigned to you</p>
                {ride.status === 'completed' && <details className="past-request-details"><summary>More trip details</summary>
                  {(ride.start || ride.end) && <div className="trip-saved-details">
                    {ride.start && <p><strong>Started:</strong> {formatRideTime(ride.startedAt)} · {ride.start.latitude.toFixed(5)}, {ride.start.longitude.toFixed(5)}</p>}
                    {ride.end && <p><strong>Ended:</strong> {formatRideTime(ride.endedAt)} · {ride.end.latitude.toFixed(5)}, {ride.end.longitude.toFixed(5)}</p>}
                  </div>}
                  <TripSummary ride={ride} />
                </details>}
                {!['completed', 'cancelled'].includes(ride.status) && <div className="driver-map-card">
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
      </div>}
    </section>
  )
}

function ClientRideHistory({ rides, loading, error, onRetryEstimate, estimateBusyId }) {
  return (
    <section className="rider-history-panel">
      <h2>Past trips</h2>
      {error && <div className="notice error" role="alert">{error}</div>}
      {loading ? <p className="empty-state">Loading your rides…</p> : rides.length === 0 ? (
        <p className="empty-state">No rides yet.</p>
      ) : (
        <div className="rider-history-list">
          {rides.map((ride) => (
            <article className="rider-history-card" key={ride.id}>
              <div className="rider-history-top">
                <strong>{ride.pickup.address?.startsWith('Map point') ? 'Current location' : ride.pickup.address || 'Current location'} → {formatCoordinates(ride.destination)}</strong>
                <span className={`status-badge status-${ride.status}`}>{ride.status.replace('_', ' ')}</span>
              </div>
              <div className="rider-history-meta">
                <span>{formatRideAge(ride.requestedAt)}</span>
                <span>{ride.estimatedFare == null && ride.price == null ? '—' : `€${Number(ride.estimatedFare ?? ride.price).toFixed(2)}`}</span>
              </div>
              {(ride.driverName || ride.status === 'completed') && <details className="rider-history-details">
                <summary>Ride details</summary>
                {ride.driverName && <p>Driver: {ride.driverName}</p>}
                <TripSummary ride={ride} />
              </details>}
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

function ClientRatingsPage({ rides, locallySkippedRatingIds, busyRideId, error, notice, onSubmit, onSkip }) {
  const completedRides = rides.filter((ride) => ride.status === 'completed' && ride.driverId)
  return (
    <div className="client-ratings-page">
      <div className="client-dashboard-heading">
        <div className="welcome-copy"><p className="eyebrow">YOUR RIDES</p><h1>Ratings</h1><p className="intro">Share feedback about your completed rides.</p></div>
      </div>
      {notice && <div className="notice success" role="status">{notice}</div>}
      {error && <div className="notice error" role="alert">{error}</div>}
      {completedRides.length === 0 ? <p className="empty-state">Completed rides will appear here.</p> : (
        <div className="client-rating-list">
          {completedRides.map((ride) => <ClientRideRatingCard key={ride.id} ride={ride} skippedLocally={locallySkippedRatingIds.has(ride.id)} busy={busyRideId === ride.id} onSubmit={onSubmit} onSkip={onSkip} />)}
        </div>
      )}
    </div>
  )
}

function RideRatingPrompt({ ride, busy, error, notice, onSubmit, onSkip }) {
  return (
    <div className="modal-backdrop rating-modal-backdrop" role="presentation">
      <section className="action-modal rating-modal" role="dialog" aria-modal="true" aria-labelledby="ride-rating-prompt-title">
        <p className="card-eyebrow">RIDE #{ride.id} · COMPLETED</p>
        <h2 id="ride-rating-prompt-title">Would you like to rate the driver?</h2>
        <p>Your trip has ended. Submit a rating or choose Skip.</p>
        <ClientRideRatingCard ride={ride} busy={busy} onSubmit={onSubmit} onSkip={onSkip} />
        {error && <div className="notice error" role="alert">{error}</div>}
        {notice && <div className="notice success" role="status">{notice}</div>}
      </section>
    </div>
  )
}

function ClientRideRatingCard({ ride, skippedLocally = false, busy, onSubmit, onSkip }) {
  const [stars, setStars] = useState(0)
  const [comment, setComment] = useState('')
  const alreadyRated = Boolean(ride.rating)
  const alreadySkipped = skippedLocally
  const descriptions = ['', 'Very poor experience', 'Poor experience', 'Average experience', 'Good experience', 'Excellent experience']
  return (
    <article className="client-rating-card">
      <div className="client-rating-card-heading"><div><p className="card-eyebrow">RIDE #{ride.id}</p><h2>{ride.driverName || 'Completed ride'}</h2></div><span>{ride.requestedAt ? formatRideTime(ride.requestedAt) : 'Completed'}</span></div>
      {alreadyRated ? <p className="client-rating-result" role="status">Your rating: <strong>{'★'.repeat(ride.rating.stars)}{'☆'.repeat(5 - ride.rating.stars)}</strong>{ride.rating.comment && <span> · {ride.rating.comment}</span>}</p>
        : alreadySkipped ? <p className="client-rating-result">Rating skipped</p>
          : <>
            <p>How was your ride with {ride.driverName || 'the driver'}?</p>
            <div className="rating-stars" role="radiogroup" aria-label={`Rate ride ${ride.id} from 1 to 5 stars`}>
              {[1, 2, 3, 4, 5].map((value) => <button key={value} type="button" role="radio" tabIndex={stars === value || (stars === 0 && value === 1) ? 0 : -1} aria-checked={stars === value} aria-label={`${value} ${value === 1 ? 'star' : 'stars'}: ${descriptions[value]}`} className={value <= stars ? 'is-selected' : ''} onClick={() => setStars(value)} disabled={busy}>★</button>)}
            </div>
            <p className="rating-description">{descriptions[stars] || 'Choose from 1 to 5 stars'}</p>
            <label className="rating-comment"><span>Comment (optional)</span><textarea value={comment} onChange={(event) => setComment(event.target.value)} maxLength={500} rows={3} disabled={busy} /></label>
            <div className="rating-modal-actions"><button type="button" className="secondary-button" onClick={() => onSkip(ride)} disabled={busy}>{busy ? 'Saving…' : 'Skip'}</button><button type="button" className="primary-button" onClick={() => onSubmit(ride, stars, comment)} disabled={busy || stars < 1}>{busy ? 'Saving…' : 'Submit Rating'}</button></div>
          </>}
    </article>
  )
}

function ClientRideStateScreen({ ride, state, onReturn }) {
  const isCancelled = state === 'cancelled'
  const pickupCoordinates = formatCoordinates(ride.pickup)

  return (
    <section className={`rider-state-screen ${isCancelled ? 'is-cancelled' : 'is-on-way'}`} aria-live="polite">
      <span className="rider-state-icon" aria-hidden="true">{isCancelled ? '×' : '↗'}</span>
      <p className="rider-state-eyebrow">{isCancelled ? 'CANCELLED' : state === 'completed' ? 'ARRIVED' : 'TRIP IN PROGRESS'}</p>
      <h1>{isCancelled ? 'CANCELLED' : state === 'completed' ? 'You have arrived' : 'You are in the taxi'}</h1>
      <p className="rider-state-message">{isCancelled ? 'This request was cancelled' : state === 'completed' ? 'Your driver has completed the trip.' : `${ride.driverName || 'Your driver'} started the trip.`}</p>
      <p className="rider-state-location">Current location - {pickupCoordinates}</p>
      <button className="primary-button" type="button" onClick={onReturn}>Back to dashboard</button>
    </section>
  )
}

function ClientRideProgress({ ride, cancelling, cancelError, freeDriverCount, onCancel, onReturn }) {
  const [confirmingCancel, setConfirmingCancel] = useState(false)
  const [approachEstimate, setApproachEstimate] = useState(null)
  const isCancelled = ride.status === 'cancelled'
  const isCompleted = ride.status === 'completed'
  const isAccepted = ride.status === 'accepted'
  const driverLatitude = ride.driverLocation?.latitude
  const driverLongitude = ride.driverLocation?.longitude
  const canCancel = ['pending', 'accepted'].includes(ride.status)

  useEffect(() => {
    if (ride.status !== 'accepted' || driverLatitude == null || driverLongitude == null) return undefined
    let active = true
    const controller = new AbortController()
    const loadEstimate = async () => {
      try {
        const response = await fetch(`${API_URL}/api/rides/${ride.id}/approach-estimate`, { credentials: 'include', signal: controller.signal })
        const data = await response.json()
        if (!response.ok) throw new Error(data.message || 'ETA unavailable')
        if (active) setApproachEstimate({ rideId: ride.id, minutes: data.estimatedDurationMinutes })
      } catch { if (active && !controller.signal.aborted) setApproachEstimate({ rideId: ride.id, unavailable: true }) }
    }
    loadEstimate()
    const timer = window.setInterval(loadEstimate, 15000)
    return () => { active = false; controller.abort(); window.clearInterval(timer) }
  }, [ride.id, ride.status, driverLatitude, driverLongitude])

  if (isCancelled || ride.status === 'in_progress' || isCompleted) {
    return <ClientRideStateScreen ride={ride} state={ride.status} onReturn={onReturn} />
  }

  return (
    <section className="client-ride-progress" aria-live="polite">
      <div className="client-ride-progress-heading">
        <div>
          <p className="card-eyebrow">REQUEST #{ride.id}</p>
          <h2>{isCompleted ? 'Ride completed' : isAccepted ? 'Taxi on the way' : 'Ride request sent'}</h2>
          <p>{isAccepted ? `Accepted by ${ride.driverName || 'your driver'}.` : ride.driverName ? `${ride.driverName} has your request and has not accepted it yet.` : 'Waiting for a driver to accept your request.'}</p>
        </div>
        <span className={`status-badge status-${ride.status}`}>{ride.status.replace('_', ' ')}</span>
      </div>
      <div className="client-ride-facts">
        <div><span>Estimated price</span><strong>{ride.estimatedFare == null ? 'Unavailable' : `€${Number(ride.estimatedFare).toFixed(2)}`}</strong></div>
        <div><span>{isAccepted ? 'Driver ETA' : 'Estimated time'}</span><strong>{isAccepted ? (approachEstimate?.rideId === ride.id && approachEstimate.minutes != null ? `${approachEstimate.minutes} min` : !ride.driverLocation || (approachEstimate?.rideId === ride.id && approachEstimate.unavailable) ? 'Unavailable' : 'Calculating…') : ride.estimatedDurationMinutes == null ? 'Unavailable' : `${ride.estimatedDurationMinutes} min`}</strong></div>
      </div>
      {isAccepted && <div className="driver-approach-map"><LocationMap activeLocation="driver" pickup={ride.pickup} destination={null} driverLocation={ride.driverLocation} /><p>{ride.driverLocation ? `Driver location: ${formatCoordinates(ride.driverLocation)}` : 'Driver location is unavailable.'} · ETA is calculated from the road route when available.</p></div>}
      <div className="client-ride-locations">
        <p><span>Pickup</span><strong>{ride.pickup.address || `Map point (${formatCoordinates(ride.pickup)})`}</strong></p>
        <p><span>Destination</span><strong>{ride.destination.address || `Map point (${formatCoordinates(ride.destination)})`}</strong></p>
      </div>
      {ride.status === 'pending' && freeDriverCount === 0 && <div className="availability-notice" role="status">
        Nuk ka taksist të lirë për momentin. Mund të prisni derisa të lirohet një taksist ose ta anuloni kërkesën.
      </div>}
      {cancelError && <div className="notice error" role="alert">{cancelError}</div>}
      <div className="client-ride-actions">
        {canCancel && !confirmingCancel && <button className="cancel-ride-button" type="button" onClick={() => setConfirmingCancel(true)} disabled={cancelling}>Cancel request</button>}
        {isCompleted && <button className="primary-button" type="button" onClick={onReturn}>Back to dashboard</button>}
      </div>
      {canCancel && confirmingCancel && <div className="cancel-confirmation" role="alertdialog" aria-modal="true" aria-labelledby="cancel-confirm-title">
        <div><h3 id="cancel-confirm-title">Are you sure you want to cancel this ride?</h3><p>Your driver will be notified that this request was cancelled.</p></div>
        <div className="cancel-confirm-actions">
          <button className="keep-ride-button" type="button" onClick={() => setConfirmingCancel(false)} disabled={cancelling}>Keep ride</button>
          <button className="confirm-cancel-button" type="button" onClick={() => onCancel(ride)} disabled={cancelling}>{cancelling ? 'Cancelling…' : 'Yes, cancel ride'}</button>
        </div>
      </div>}
      <p className="client-ride-updated">Status updates automatically while waiting for your driver.</p>
    </section>
  )
}

function App() {
  const [user, setUser] = useState(null)
  const [mode, setMode] = useState('login')
  const [fullName, setFullName] = useState('')
  const [registrationRole, setRegistrationRole] = useState('client')
  const [driverPhone, setDriverPhone] = useState('')
  const [driverLicenseNumber, setDriverLicenseNumber] = useState('')
  const [vehiclePlate, setVehiclePlate] = useState('')
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
  const [freeDriverCount, setFreeDriverCount] = useState(null)
  const [focusedClientRideId, setFocusedClientRideId] = useState(null)
  const [hideClientRideProgress, setHideClientRideProgress] = useState(false)
  const [cancellingClientRideId, setCancellingClientRideId] = useState(null)
  const [clientCancelError, setClientCancelError] = useState('')
  const [estimateBusyId, setEstimateBusyId] = useState(null)
  const [ratingBusyRideId, setRatingBusyRideId] = useState(null)
  const [ratingError, setRatingError] = useState('')
  const [ratingNotice, setRatingNotice] = useState('')
  const [locallySkippedRatingIds, setLocallySkippedRatingIds] = useState(() => new Set())
  const [ratingPromptDismissed, setRatingPromptDismissed] = useState(false)
  const knownCompletedRideIdsRef = useRef(null)
  const [clientPage, setClientPage] = useState('dashboard')
  const clientRidesAwaitingDriver = clientRides.some((ride) => ['pending', 'accepted', 'in_progress'].includes(ride.status))
  const pendingRatingRide = ratingPromptDismissed ? null : clientRides.find((ride) => ride.status === 'completed' && ride.driverId && !ride.rating && !locallySkippedRatingIds.has(ride.id))
  const pendingRatingCount = clientRides.filter((ride) => ride.status === 'completed' && ride.driverId && !ride.rating && !locallySkippedRatingIds.has(ride.id)).length
  const focusedClientRide = clientRides.find((ride) => ride.id === focusedClientRideId)
  const activeClientRide = hideClientRideProgress
    ? null
    : focusedClientRide || clientRides.find((ride) => ['pending', 'accepted', 'in_progress'].includes(ride.status))

  useEffect(() => {
    const completedRideIds = new Set(clientRides.filter((ride) => ride.status === 'completed' && ride.driverId).map((ride) => ride.id))
    if (knownCompletedRideIdsRef.current !== null
      && [...completedRideIds].some((rideId) => !knownCompletedRideIdsRef.current.has(rideId))) {
      setRatingPromptDismissed(false)
    }
    knownCompletedRideIdsRef.current = completedRideIds
  }, [clientRides])

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
    async function loadClientRides(showLoading = false) {
      if (showLoading) setClientRidesLoading(true)
      setClientRidesError('')
      try {
        const response = await fetch(`${API_URL}/api/rides`, { credentials: 'include' })
        const data = await response.json()
        if (!response.ok) throw new Error(data.message || 'Unable to load your ride history.')
        if (active) {
          setClientRides(data.rides || [])
          setFreeDriverCount(Number.isInteger(data.freeDriverCount) ? data.freeDriverCount : null)
        }
      } catch (error) {
        if (active) setClientRidesError(error.message || 'Unable to load your ride history.')
      } finally {
        if (active) setClientRidesLoading(false)
      }
    }
    loadClientRides(true)
    const refreshTimer = clientRidesAwaitingDriver
      ? window.setInterval(() => loadClientRides(), 5000)
      : null
    return () => {
      active = false
      if (refreshTimer) window.clearInterval(refreshTimer)
    }
  }, [user?.id, user?.role, clientRidesReloadKey, clientRidesAwaitingDriver])

  async function cancelClientRide(ride) {
    setCancellingClientRideId(ride.id)
    setClientCancelError('')
    try {
      const response = await fetch(`${API_URL}/api/rides/${ride.id}/cancel`, {
        method: 'PATCH', credentials: 'include',
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || 'Unable to cancel this request.')
      setClientRides((current) => current.map((item) => (
        item.id === ride.id ? { ...item, ...data.ride } : item
      )))
      setFocusedClientRideId(ride.id)
    } catch (error) {
      setClientCancelError(error.message || 'Unable to cancel this request.')
    } finally {
      setCancellingClientRideId(null)
    }
  }

  async function submitRideRating(ride, stars, comment) {
    if (ratingBusyRideId !== null || !Number.isInteger(stars) || stars < 1 || stars > 5) return
    setRatingBusyRideId(ride.id)
    setRatingError('')
    setRatingNotice('')
    try {
      const response = await fetch(`${API_URL}/api/rides/${ride.id}/rating`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stars, comment }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || 'Unable to submit this rating.')
      setClientRides((current) => current.map((item) => item.id === ride.id ? { ...item, rating: data.rating } : item))
      setRatingNotice(`Rating for ride #${ride.id} submitted successfully.`)
      setRatingPromptDismissed(true)
    } catch (error) {
      setRatingError(error.message || 'Unable to submit this rating.')
    } finally {
      setRatingBusyRideId(null)
    }
  }

  async function skipRideRating(ride) {
    if (ratingBusyRideId !== null) return
    setRatingError('')
    setRatingNotice('')
    setLocallySkippedRatingIds((current) => new Set(current).add(ride.id))
    setRatingNotice(`Rating for ride #${ride.id} skipped for this visit.`)
    setRatingPromptDismissed(true)
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setBusy(true)
    setNotice('')

    try {
      const endpoint = mode === 'register' ? 'register' : 'login'
      const payload = mode === 'register' ? {
        fullName, email, password, role: registrationRole,
        ...(registrationRole === 'driver' ? {
          phone: driverPhone, licenseNumber: driverLicenseNumber,
          vehiclePlate,
        } : {}),
      } : { email, password }
      const response = await fetch(`${API_URL}/api/auth/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || 'Request failed.')
      if (data.applicationSubmitted) {
        setMode('login')
        setNotice(data.message || 'Your driver application is pending administrator approval.')
        setNoticeType('success')
        setPassword('')
        return
      }
      setUser(data.user)
      setPassword('')
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
      setNotice('')
      setNoticeType('error')
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
      setFreeDriverCount(Number.isInteger(data.freeDriverCount) ? data.freeDriverCount : null)
      setClientRides((current) => [data.ride, ...current.filter((ride) => ride.id !== data.ride.id)])
      setFocusedClientRideId(data.ride.id)
      setHideClientRideProgress(false)
      setClientCancelError('')
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
    <main className={`page-shell ${user ? 'app-page' : 'auth-page'}${user?.role === 'client' ? ' rider-page' : ''}`}>
      <header className="topbar">
        <a className="brand" href="/" aria-label="TaxiTrack home">
          <span className="brand-icon" aria-hidden="true">T</span>
          <span>{user?.role === 'client' ? 'Ride Bidding' : 'TaxiTrack'}</span>
        </a>
        {user?.role === 'client' ? (
          <div className="rider-topbar-tools">
            <span className="rider-live"><i /> Live</span>
            <span className="rider-notification" aria-label="Notifications"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg></span>
            <nav className="rider-page-nav" aria-label="Rider pages">
              <button type="button" className={clientPage === 'dashboard' ? 'active' : ''} onClick={() => setClientPage('dashboard')}>Dashboard</button>
              <button type="button" className={clientPage === 'ratings' ? 'active' : ''} onClick={() => setClientPage('ratings')}>Ratings{pendingRatingCount > 0 && <span className="rating-nav-count">{pendingRatingCount}</span>}</button>
            </nav>
            <span className="rider-identity"><strong>{user.fullName}</strong><small>Rider</small></span>
            <button className="rider-logout" type="button" onClick={handleLogout}>Log out</button>
          </div>
        ) : <span className="topbar-note">Simple ride management</span>}
      </header>

      {user ? (
        user.role === 'client' ? (
          <section className="client-dashboard">
            {clientPage === 'ratings' ? <ClientRatingsPage rides={clientRides} locallySkippedRatingIds={locallySkippedRatingIds} busyRideId={ratingBusyRideId} error={ratingError} notice={ratingNotice} onSubmit={submitRideRating} onSkip={skipRideRating} /> : <>
            {ratingNotice && !pendingRatingRide && <div className="notice success" role="status">{ratingNotice}</div>}
            {activeClientRide ? (
              <ClientRideProgress
                ride={activeClientRide}
                cancelling={cancellingClientRideId === activeClientRide.id}
                cancelError={clientCancelError}
                freeDriverCount={freeDriverCount}
                onCancel={cancelClientRide}
                onReturn={() => {
                  setFocusedClientRideId(null)
                  setHideClientRideProgress(true)
                  setClientCancelError('')
                }}
              />
            ) : <>
            <div className="rider-dashboard-grid">
              <section className="rider-booking-card">
                <h1>Where are you headed?</h1>
                <p className="rider-map-instruction">Tap the map to set your dropoff. Your current location is the pickup point.</p>
                <div className="rider-map-frame">
                  <LocationMap activeLocation={activeLocation} pickup={pickup} destination={destination} onSelect={selectLocation} />
                  <p className="map-attribution">Map data &copy; OpenStreetMap contributors</p>
                </div>
                {locationError && <p className="location-error" role="alert">{locationError}</p>}
                <div className="rider-booking-fields">
                  <label className="field">
                    <span>Pickup <button className="rider-use-location" type="button" onClick={useMyLocation} disabled={locating}>{locating ? 'Locating…' : 'Use my location'}</button></span>
                    <input value={pickupAddress} placeholder="Current location" onFocus={() => setActiveLocation('pickup')} onChange={(event) => setPickupAddress(event.target.value)} maxLength={300} required aria-label="Pickup address" />
                    <small>{formatCoordinates(pickup)}</small>
                  </label>
                  <label className="field">
                    <span>Dropoff</span>
                    <input value={destinationAddress} onFocus={() => setActiveLocation('destination')} onChange={(event) => setDestinationAddress(event.target.value)} maxLength={300} required placeholder="Choose on map" />
                    <small>{formatCoordinates(destination)}</small>
                  </label>
                </div>
                {rideFeedback && rideFeedbackType === 'error' && <div className="notice error" role="alert">{rideFeedback}</div>}
                <button className="primary-button create-ride-button" type="button" onClick={submitRideRequest} disabled={!pickup || !destination || !pickupAddress.trim() || !destinationAddress.trim() || rideBusy}>
                  {rideBusy ? 'Sending request…' : 'Request ride'}
                </button>
              </section>
              <ClientRideHistory rides={clientRides} loading={clientRidesLoading} error={clientRidesError} onRetryEstimate={retryRideEstimate} estimateBusyId={estimateBusyId} />
            </div>
            </>}
            </>}
          </section>
        ) : user.role === 'admin' ? (
          <AdminDashboard user={user} onLogout={handleLogout} />
        ) : (
          <DriverDashboard user={user} onLogout={handleLogout} />
        )
      ) : (
        <section className="auth-layout">
          <div className="welcome-copy">
            <p className="eyebrow">{mode === 'register' ? 'JOIN THE MARKETPLACE' : 'WELCOME BACK'}</p>
            <h1>Manage your taxi rides.</h1>
            <p className="intro">{mode === 'register' ? 'Create an account to join the marketplace.' : 'Log in to your account.'}</p>
          </div>

          <div className="auth-card">
            <div className="form-heading">
              <h2>{mode === 'register' ? 'Create an account' : 'Log in'}</h2>
            </div>
            {notice && <div className={`notice ${noticeType}`} role={noticeType === 'error' ? 'alert' : 'status'}>{notice}</div>}
            <form onSubmit={handleSubmit}>
              {mode === 'register' && (
                <fieldset className="field role-picker">
                  <legend>I am a ...</legend>
                  <div className="role-choice-list">
                    <label><input type="radio" name="registrationRole" value="client" checked={registrationRole === 'client'} onChange={() => setRegistrationRole('client')} /> Rider</label>
                    <label><input type="radio" name="registrationRole" value="driver" checked={registrationRole === 'driver'} onChange={() => setRegistrationRole('driver')} /> Driver</label>
                  </div>
                </fieldset>
              )}
              {mode === 'register' && (
                <label className="field">
                  <span>Full name</span>
                  <input autoComplete="name" value={fullName} onChange={(event) => setFullName(event.target.value)} minLength={2} maxLength={160} required placeholder="e.g. Alex Smith" />
                </label>
              )}
              {mode === 'register' && registrationRole === 'driver' && <>
                <label className="field"><span>Phone number</span><input type="tel" autoComplete="tel" value={driverPhone} onChange={(event) => setDriverPhone(event.target.value)} minLength={7} maxLength={30} required placeholder="+383 44 123 456" /></label>
                <label className="field"><span>Driver license number</span><input autoComplete="off" value={driverLicenseNumber} onChange={(event) => setDriverLicenseNumber(event.target.value)} minLength={3} maxLength={80} required /></label>
                <label className="field"><span>Vehicle registration number</span><input autoComplete="off" value={vehiclePlate} onChange={(event) => setVehiclePlate(event.target.value)} minLength={2} maxLength={20} required /></label>
                <p className="role-note">Your driver account will be pending until an administrator reviews your application.</p>
              </>}
              <label className="field">
                <span>Email</span>
                <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={254} required placeholder="name@example.com" />
              </label>
              <label className="field">
                <span>Password</span>
                <input type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} value={password} onChange={(event) => setPassword(event.target.value)} minLength={mode === 'register' ? 8 : undefined} maxLength={72} required placeholder={mode === 'register' ? 'At least 8 characters' : 'Enter your password'} />
              </label>
              <button className="primary-button" type="submit" disabled={busy}>
                {busy ? 'Please wait…' : mode === 'register' ? 'Create account' : 'Log in'}
                {!busy && <span aria-hidden="true">→</span>}
              </button>
            </form>
            <p className="security-note">{mode === 'register' ? <>Already have an account? <button type="button" onClick={() => { setMode('login'); setNotice('') }}>Log in</button></> : <>New here? <button type="button" onClick={() => { setMode('register'); setNotice('') }}>Create an account</button></>}</p>
          </div>
        </section>
      )}
      {user?.role === 'client' && pendingRatingRide && <RideRatingPrompt key={pendingRatingRide.id} ride={pendingRatingRide} busy={ratingBusyRideId === pendingRatingRide.id} error={ratingError} notice={ratingNotice} onSubmit={submitRideRating} onSkip={skipRideRating} />}
      <footer className="footer"><span>TaxiTrack</span><span>Taxi management</span></footer>
    </main>
  )
}

export default App
