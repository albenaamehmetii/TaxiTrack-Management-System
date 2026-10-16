import { useEffect, useMemo, useState } from 'react'
import { API_URL } from '../../api/config.js'
import TripSummary from '../../components/TripSummary.jsx'
import { formatCoordinates, formatRideTime, rideDateForFilter } from '../../utils/rideFormatters.js'

const ADMIN_PAGE_SIZE = 20

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

export default function AdminDashboard({ user, onLogout }) {
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
