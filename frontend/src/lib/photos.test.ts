import { describe, expect, it } from 'vitest'
import { MAX_PHOTO_BYTES, photoProblem, previewText } from './photos'

const file = (type: string, size = 1000) => new File([new Uint8Array(size)], 'f', { type })

describe('photoProblem', () => {
  it('accepts images within the size limit', () => {
    expect(photoProblem(file('image/jpeg'))).toBeNull()
    expect(photoProblem(file('application/pdf'))).toBe('Pick an image file')
    expect(photoProblem(file('image/png', MAX_PHOTO_BYTES + 1))).toBe('Photos can be up to 8 MB')
  })
})

describe('previewText', () => {
  it('labels photos in chat previews', () => {
    expect(previewText({ body: 'hi' })).toBe('hi')
    expect(previewText({ body: '', image_url: '/media/a.webp' })).toBe('📷 Photo')
    expect(previewText({ body: 'the view', image_url: '/media/a.webp' })).toBe('📷 the view')
  })
})
