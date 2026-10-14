import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './App.css'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000'
const ROLE_LABELS = { client: 'Client', driver: 'Driver', admin: 'Administrator' }
const DEFAULT_CENTER = [42.6629, 21.1655]

function LocationMap({ activeLocation, pickup, destination, onSelect }) {
  const mapElement = useRef(null)
  const mapRef = useRef(null)
  const markersRef = useRef({ pickup: null, destination: null })
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
      onSelectRef.current(activeRef.current, {
        latitude: event.latlng.lat,
        longitude: event.latlng.lng,
      })
    })

    return () => {
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

    const mostRecent = activeLocation === 'pickup' ? pickup : destination
    if (mostRecent) map.flyTo([mostRecent.latitude, mostRecent.longitude], Math.max(map.getZoom(), 14), { duration: 0.4 })
  }, [pickup, destination, activeLocation])

  return <div className="location-map" ref={mapElement} aria-label="Map for selecting pickup and destination" />
}

function formatCoordinates(location) {
  if (!location) return 'Not selected'
  return `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}`
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
  const [activeLocation, setActiveLocation] = useState('pickup')
  const [locationError, setLocationError] = useState('')
  const [locating, setLocating] = useState(false)

  useEffect(() => {
    let active = true
    fetch(`${API_URL}/api/auth/me`, { credentials: 'include' })
      .then(async (response) => {
        if (response.ok) {
          const data = await response.json()
          if (active) setUser(data.user)
        } else if (response.status !== 401) {
          throw new Error('Unable to reach the backend. Make sure it is running on port 3000.')
        }
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
    if (kind === 'pickup') setPickup(location)
    else setDestination(location)
    setLocationError('')
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
        setPickup({ latitude: coords.latitude, longitude: coords.longitude })
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
                <p className="location-help">Choose a point, then click the map to place it.</p>
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
              </aside>
              <div className="map-card">
                <LocationMap activeLocation={activeLocation} pickup={pickup} destination={destination} onSelect={selectLocation} />
                <p className="map-attribution">Map data &copy; OpenStreetMap contributors</p>
              </div>
            </div>
            <p className="map-note">The map shows selected coordinates. Your browser will ask before sharing your current location.</p>
          </section>
        ) : (
          <section className="welcome-layout">
            <div className="welcome-copy">
              <p className="eyebrow">YOUR DASHBOARD</p>
              <h1>Welcome back, {user.fullName.split(' ')[0]}.</h1>
              <p className="intro">You're signed in to TaxiTrack.</p>
            </div>
            <div className="account-card">
              <div className="avatar" aria-hidden="true">{user.fullName.charAt(0).toUpperCase()}</div>
              <p className="card-eyebrow">YOUR ACCOUNT</p>
              <h2>{user.fullName}</h2>
              <p className="account-email">{user.email}</p>
              <div className="role-badge"><span /> {ROLE_LABELS[user.role] || user.role}</div>
              <button className="secondary-button" type="button" onClick={handleLogout}>Sign out</button>
              {user.role === 'admin' && <p className="role-note">Admin account</p>}
              {user.role === 'driver' && <p className="role-note">Driver account</p>}
            </div>
          </section>
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