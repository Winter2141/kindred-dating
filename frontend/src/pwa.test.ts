import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const publicDir = resolve(__dirname, '../public')
const manifest = JSON.parse(readFileSync(resolve(publicDir, 'manifest.webmanifest'), 'utf-8'))

describe('web app manifest', () => {
  it('has what browsers need to offer installing Kindred', () => {
    expect(manifest).toMatchObject({ name: 'Kindred', display: 'standalone', start_url: '/app/discover' })
    const sizes = manifest.icons.map((icon: { sizes: string }) => icon.sizes)
    expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']))
    expect(manifest.icons.some((icon: { purpose: string }) => icon.purpose === 'maskable')).toBe(true)
  })

  it('points at icons that exist', () => {
    for (const icon of manifest.icons as { src: string }[]) {
      expect(existsSync(resolve(publicDir, `.${icon.src}`)), icon.src).toBe(true)
    }
  })

  it('keeps the service worker away from live traffic', () => {
    const worker = readFileSync(resolve(publicDir, 'sw.js'), 'utf-8')
    expect(worker).toContain('(api|media|ws)')
  })
})
