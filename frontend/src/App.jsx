import { useEffect, useState } from 'react'
import './App.css'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000'
const ROLE_LABELS = { client: 'Client', driver: 'Driver', admin: 'Administrator' }

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
