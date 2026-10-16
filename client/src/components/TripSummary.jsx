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

export default TripSummary
