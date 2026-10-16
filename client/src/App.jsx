import { useEffect, useRef, useState } from 'react'
import './App.css'
import { API_URL } from './api/config.js'
import LocationMap from './components/maps/LocationMap.jsx'
import AdminDashboard from './pages/admin/AdminDashboard.jsx'
import { ClientRideHistory, ClientRideProgress, ClientRatingsPage, RideRatingPrompt } from './pages/rider/RiderDashboard.jsx'
import DriverDashboard from './pages/driver/DriverDashboard.jsx'
import { formatCoordinates } from './utils/rideFormatters.js'


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
    try {
      const response = await fetch(`${API_URL}/api/rides/${ride.id}/rating`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stars, comment }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || 'Unable to submit this rating.')
      setClientRides((current) => current.map((item) => item.id === ride.id ? { ...item, rating: data.rating } : item))
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
    setLocallySkippedRatingIds((current) => new Set(current).add(ride.id))
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

  function handleBrandClick(event) {
    if (user?.role !== 'client') return
    event.preventDefault()
    setClientPage('dashboard')
    setRatingPromptDismissed(true)
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
        <a className="brand" href="/" aria-label="TaxiTrack home" onClick={handleBrandClick}>
          <span className="brand-icon" aria-hidden="true">T</span>
          <span>TaxiTrack</span>
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
            {clientPage === 'ratings' ? <ClientRatingsPage rides={clientRides} locallySkippedRatingIds={locallySkippedRatingIds} busyRideId={ratingBusyRideId} error={ratingError} onSubmit={submitRideRating} onSkip={skipRideRating} /> : <>
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
      {user?.role === 'client' && pendingRatingRide && <RideRatingPrompt key={pendingRatingRide.id} ride={pendingRatingRide} busy={ratingBusyRideId === pendingRatingRide.id} error={ratingError} onSubmit={submitRideRating} onSkip={skipRideRating} />}
      <footer className="footer"><span>TaxiTrack</span><span>Taxi management</span></footer>
    </main>
  )
}

export default App
