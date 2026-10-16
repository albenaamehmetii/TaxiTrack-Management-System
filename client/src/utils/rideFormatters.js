
export function formatCoordinates(location) {
  if (!location) return 'Not selected'
  return `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}`
}


export function formatRideTime(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Time unavailable'

  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Belgrade',
  }).format(date)
}

export function formatRideAge(value) {
  const timestamp = new Date(value).getTime()
  if (Number.isNaN(timestamp)) return 'Time unavailable'
  const hours = Math.max(0, Math.floor((Date.now() - timestamp) / 3600000))
  if (hours < 1) return 'less than an hour ago'
  return `about ${hours} ${hours === 1 ? 'hour' : 'hours'} ago`
}

export function rideDateForFilter(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Belgrade', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date).map(({ type, value: partValue }) => [type, partValue]))
  return `${parts.year}-${parts.month}-${parts.day}`
}
