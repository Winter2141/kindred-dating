import { describe, expect, it, vi } from 'vitest'
import { currentPosition, formatDistance, snapDistance } from './distance'

describe('formatDistance', () => {
  it('reads naturally', () => {
    expect(formatDistance(null)).toBeNull()
    expect(formatDistance(undefined)).toBeNull()
    expect(formatDistance(1)).toBe('Very close by')
    expect(formatDistance(12)).toBe('12 km away')
  })
})

describe('snapDistance', () => {
  it('uses finer steps close to home', () => {
    expect(snapDistance(1)).toBe(5)
    expect(snapDistance(23)).toBe(25)
    expect(snapDistance(64)).toBe(60)
    expect(snapDistance(140)).toBe(150)
    expect(snapDistance(999)).toBe(300)
  })
})

describe('currentPosition', () => {
  const geolocation = (impl: Geolocation['getCurrentPosition']) =>
    ({ getCurrentPosition: vi.fn(impl) }) as unknown as Geolocation

  it('rounds coordinates to about a kilometre', async () => {
    const located = geolocation((success) =>
      success({ coords: { latitude: 40.712776, longitude: -74.005974 } } as GeolocationPosition),
    )
    await expect(currentPosition(located)).resolves.toEqual({ latitude: 40.71, longitude: -74.01 })
  })

  it('explains a denied permission', async () => {
    const denied = geolocation((_, failure) =>
      failure?.({ code: 1, PERMISSION_DENIED: 1 } as GeolocationPositionError),
    )
    await expect(currentPosition(denied)).rejects.toThrow('Location permission was denied')
  })
})
