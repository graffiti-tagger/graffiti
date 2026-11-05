import { describe, test, expect, vi, afterEach } from 'vitest'
import { fetchCoverArt } from '../coverart.js'

const RID = '11111111-2222-3333-4444-555555555555'
const GID = '66666666-7777-8888-9999-aaaaaaaaaaaa'

afterEach(() => vi.unstubAllGlobals())

describe('fetchCoverArt', () => {
  test('returns release art', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(Buffer.from([1, 2, 3]), { headers: { 'content-type': 'image/png' } })))
    const r = await fetchCoverArt({ releaseId: RID })
    expect(r?.mimeType).toBe('image/png')
    expect(r?.source).toBe('release')
  })

  test('falls back to release group on 404', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response(Buffer.from([1]), { headers: { 'content-type': 'image/jpeg' } }))
    vi.stubGlobal('fetch', f)
    const r = await fetchCoverArt({ releaseId: RID, releaseGroupId: GID })
    expect(r?.source).toBe('release-group')
  })

  test('ignores invalid ids', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    expect(await fetchCoverArt({ releaseId: '../x' })).toBeNull()
    expect(f).not.toHaveBeenCalled()
  })
})
