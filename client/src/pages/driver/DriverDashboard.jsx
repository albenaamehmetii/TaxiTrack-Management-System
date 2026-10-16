import { useEffect, useRef, useState } from 'react'
import { API_URL } from '../../api/config.js'
import LocationMap from '../../components/maps/LocationMap.jsx'
import TripSummary from '../../components/TripSummary.jsx'
import { fetchSuggestedRoute } from '../../utils/routing.js'
import { formatCoordinates, formatRideTime } from '../../utils/rideFormatters.js'

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

export default function DriverDashboard({ user, onLogout }) {
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
          {ride.status === 'completed' && <details className="past-request-details"><summary>More trip details</summary><TripSummary ride={ride} /></details>}
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
