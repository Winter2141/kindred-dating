/** How far away someone is, in words. The server already rounds to whole kilometres. */
export function formatDistance(km: number | null | undefined): string | null {
  if (km === null || km === undefined) return null
  if (km <= 2) return 'Very close by'
  return `${km} km away`
}

export const DISTANCE_MIN = 5
export const DISTANCE_MAX = 300

/** Slider steps get coarser further out: 5 km near home, 25 km beyond 100 km. */
export function snapDistance(km: number): number {
  const clamped = Math.min(DISTANCE_MAX, Math.max(DISTANCE_MIN, km))
  const step = clamped <= 50 ? 5 : clamped <= 100 ? 10 : 25
  return Math.round(clamped / step) * step
}

export type LocationResult = { latitude: number; longitude: number }

/** The browser's position, rounded to ~1 km so we never store more precision than needed. */
export function currentPosition(geolocation: Geolocation | undefined = navigator.geolocation): Promise<LocationResult> {
  return new Promise((resolve, reject) => {
    if (!geolocation) {
      reject(new Error("This browser can't share a location"))
      return
    }
    geolocation.getCurrentPosition(
      ({ coords }) =>
        resolve({
          latitude: Math.round(coords.latitude * 100) / 100,
          longitude: Math.round(coords.longitude * 100) / 100,
        }),
      (error) =>
        reject(
          new Error(
            error.code === error.PERMISSION_DENIED
              ? 'Location permission was denied'
              : "Couldn't get your location",
          ),
        ),
      { maximumAge: 10 * 60 * 1000, timeout: 10_000 },
    )
  })
}
