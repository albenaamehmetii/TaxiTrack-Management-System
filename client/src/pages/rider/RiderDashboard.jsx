import { useEffect, useState } from 'react'
import { API_URL } from '../../api/config.js'
import LocationMap from '../../components/maps/LocationMap.jsx'
import TripSummary from '../../components/TripSummary.jsx'
import { formatCoordinates, formatRideAge, formatRideTime } from '../../utils/rideFormatters.js'

export function ClientRideHistory({ rides, loading, error, onRetryEstimate, estimateBusyId }) {
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

export function ClientRatingsPage({ rides, locallySkippedRatingIds, busyRideId, error, onSubmit, onSkip }) {
  const completedRides = rides.filter((ride) => ride.status === 'completed' && ride.driverId)
  return (
    <div className="client-ratings-page">
      <div className="client-dashboard-heading">
        <div className="welcome-copy"><p className="eyebrow">YOUR RIDES</p><h1>Ratings</h1><p className="intro">Share feedback about your completed rides.</p></div>
      </div>
      {error && <div className="notice error" role="alert">{error}</div>}
      {completedRides.length === 0 ? <p className="empty-state">Completed rides will appear here.</p> : (
        <div className="client-rating-list">
          {completedRides.map((ride) => <ClientRideRatingCard key={ride.id} ride={ride} skippedLocally={locallySkippedRatingIds.has(ride.id)} busy={busyRideId === ride.id} onSubmit={onSubmit} onSkip={onSkip} />)}
        </div>
      )}
    </div>
  )
}

export function RideRatingPrompt({ ride, busy, error, onSubmit, onSkip }) {
  return (
    <div className="modal-backdrop rating-modal-backdrop" role="presentation">
      <section className="action-modal rating-modal" role="dialog" aria-modal="true" aria-labelledby="ride-rating-prompt-title">
        <p className="card-eyebrow">RIDE #{ride.id} · COMPLETED</p>
        <h2 id="ride-rating-prompt-title">Would you like to rate the driver?</h2>
        <p>Your trip has ended. Submit a rating or choose Skip.</p>
        <ClientRideRatingCard ride={ride} busy={busy} onSubmit={onSubmit} onSkip={onSkip} />
        {error && <div className="notice error" role="alert">{error}</div>}
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

export function ClientRideProgress({ ride, cancelling, cancelError, freeDriverCount, onCancel, onReturn }) {
  const [confirmingCancel, setConfirmingCancel] = useState(false)
  const [approachEstimate, setApproachEstimate] = useState(null)
  const isCancelled = ride.status === 'cancelled'
  const isCompleted = ride.status === 'completed'
  const isAccepted = ride.status === 'accepted'
  const driverLatitude = ride.driverLocation?.latitude
  const driverLongitude = ride.driverLocation?.longitude
  const driverPhoneDigits = typeof ride.driverPhone === 'string' ? ride.driverPhone.replace(/\D/g, '') : ''
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
      {ride.driverId && <div className="client-driver-contact">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h3l1.5 4-2 1.5a14 14 0 0 0 6 6l1.5-2 4 1.5v3a2 2 0 0 1-2.2 2A17 17 0 0 1 5 5.2 2 2 0 0 1 7 3Z" /></svg>
        <div><span>Contact Info</span><strong>{driverPhoneDigits.length >= 7 ? ride.driverPhone : 'Contact information unavailable'}</strong></div>
      </div>}
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
