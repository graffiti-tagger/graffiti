import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { jsonResponse } from '../../__tests__/helpers.js'
import { lookupRecording } from '../musicbrainz.js'

// Minimal MB recording response for one track on one release
function mbRecordingFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'recording-uuid-1',
    title: 'Bohemian Rhapsody',
    length: 354000,
    'artist-credit': [
      { artist: { id: 'artist-uuid-1', name: 'Queen' } },
    ],
    releases: [
      {
        id: 'release-uuid-1',
        title: 'A Night at the Opera',
        date: '1975-11-21',
        status: 'Official',
        country: 'GB',
        disambiguation: '',
        'release-group': { id: 'rg-uuid-1' },
        'label-info': [
          { label: { name: 'EMI' }, 'catalog-number': 'EMA 790' },
        ],
        media: [
          {
            format: 'Vinyl',
            'track-count': 11,
            tracks: [
              { id: 'release-track-uuid-1', number: 'A4', position: 4 },
            ],
          },
        ],
      },
    ],
    ...overrides,
  }
}

let originalFetch: typeof globalThis.fetch
let fetchCalls: Array<{ url: string; opts: RequestInit | undefined }> = []
let nextResponse: Response

before(() => {
  originalFetch = globalThis.fetch
  globalThis.fetch = async (url: RequestInfo, opts?: RequestInit) => {
    fetchCalls.push({ url: String(url), opts })
    return nextResponse
  }
})

after(() => { globalThis.fetch = originalFetch })

function resetFetch(response: Response) {
  fetchCalls = []
  nextResponse = response
}

describe('lookupRecording — happy path', () => {
  test('returns correct recording id, title, artist, duration', async () => {
    resetFetch(jsonResponse(mbRecordingFixture()))
    const rec = await lookupRecording('recording-uuid-1')
    assert.equal(rec.id, 'recording-uuid-1')
    assert.equal(rec.title, 'Bohemian Rhapsody')
    assert.equal(rec.artist, 'Queen')
    assert.equal(rec.artistId, 'artist-uuid-1')
    assert.equal(rec.durationMs, 354000)
  })

  test('maps the first release correctly', async () => {
    resetFetch(jsonResponse(mbRecordingFixture()))
    const rec = await lookupRecording('recording-uuid-1')
    assert.equal(rec.releases.length, 1)
    const rel = rec.releases[0]
    assert.equal(rel.id, 'release-uuid-1')
    assert.equal(rel.title, 'A Night at the Opera')
    assert.equal(rel.date, '1975-11-21')
    assert.equal(rel.status, 'Official')
    assert.equal(rel.country, 'GB')
    assert.equal(rel.labelName, 'EMI')
    assert.equal(rel.labelCatalogNo, 'EMA 790')
    assert.equal(rel.format, 'Vinyl')
    assert.equal(rel.releaseGroupId, 'rg-uuid-1')
    assert.equal(rel.releaseTrackId, 'release-track-uuid-1')
    assert.equal(rel.trackNumber, 'A4')
    assert.equal(rel.trackCount, 11)
    assert.equal(rel.totalTracks, 11)
    assert.equal(rel.discCount, 1)
  })

  test('sends the correct inc parameters in the URL', async () => {
    resetFetch(jsonResponse(mbRecordingFixture()))
    await lookupRecording('recording-uuid-1')
    const url = fetchCalls[0].url
    assert.ok(url.includes('artists'), 'should include artists')
    assert.ok(url.includes('releases'), 'should include releases')
    assert.ok(url.includes('release-groups'), 'should include release-groups')
    assert.ok(!url.includes('labels'), '"labels" is not valid on recording endpoint')
  })

  test('sends Authorization header when credentials provided', async () => {
    resetFetch(jsonResponse(mbRecordingFixture()))
    await lookupRecording('recording-uuid-1', { username: 'user', password: 'pass' })
    const headers = fetchCalls[0].opts?.headers as Record<string, string>
    assert.ok(headers?.['Authorization']?.startsWith('Basic '))
  })

  test('does not send Authorization when credentials absent', async () => {
    resetFetch(jsonResponse(mbRecordingFixture()))
    await lookupRecording('recording-uuid-1')
    const headers = fetchCalls[0].opts?.headers as Record<string, string> | undefined
    assert.ok(!headers?.['Authorization'])
  })
})

describe('lookupRecording — edge cases', () => {
  test('handles missing artist-credit gracefully', async () => {
    const fixture = mbRecordingFixture({ 'artist-credit': [] })
    resetFetch(jsonResponse(fixture))
    const rec = await lookupRecording('recording-uuid-1')
    assert.equal(rec.artist, '')
    assert.equal(rec.artistId, '')
  })

  test('handles missing releases', async () => {
    const fixture = mbRecordingFixture({ releases: [] })
    resetFetch(jsonResponse(fixture))
    const rec = await lookupRecording('recording-uuid-1')
    assert.equal(rec.releases.length, 0)
  })

  test('handles missing length (durationMs = null)', async () => {
    const fixture = { ...mbRecordingFixture() }
    delete (fixture as Record<string, unknown>).length
    resetFetch(jsonResponse(fixture))
    const rec = await lookupRecording('recording-uuid-1')
    assert.equal(rec.durationMs, null)
  })

  test('handles multi-disc release correctly', async () => {
    const fixture = mbRecordingFixture({
      releases: [{
        id: 'rel-2',
        title: 'Live Album',
        date: '2001',
        status: 'Official',
        country: 'US',
        disambiguation: '',
        'release-group': { id: 'rg-2' },
        'label-info': [],
        media: [
          { format: 'CD', 'track-count': 10, tracks: [] },           // disc 1, no match
          { format: 'CD', 'track-count': 8,  tracks: [{ id: 'rt-2', number: '3', position: 3 }] }, // disc 2, match
        ],
      }],
    })
    resetFetch(jsonResponse(fixture))
    const rec = await lookupRecording('recording-uuid-1')
    const rel = rec.releases[0]
    assert.equal(rel.discNumber, '2')     // found in disc 2
    assert.equal(rel.discCount, 2)
    assert.equal(rel.totalTracks, 18)     // 10 + 8
    assert.equal(rel.trackNumber, '3')
  })

  test('disambiguation is null when empty string', async () => {
    resetFetch(jsonResponse(mbRecordingFixture()))
    const rec = await lookupRecording('recording-uuid-1')
    assert.equal(rec.releases[0].disambiguation, null)
  })

  test('throws on non-2xx HTTP response', async () => {
    resetFetch(new Response('{"error":"Not Found"}', { status: 404 }))
    await assert.rejects(() => lookupRecording('bad-id'), /MusicBrainz HTTP 404/)
  })

  test('artist-credit joining works for multi-credit strings', async () => {
    // MB encodes "Artist A & Artist B" as [{ artist: {name: 'Artist A'} }, ' & ', { artist: {name: 'Artist B'} }]
    const fixture = mbRecordingFixture({
      'artist-credit': [
        { artist: { id: 'a1', name: 'Lennon' } },
        ' & ',
        { artist: { id: 'a2', name: 'McCartney' } },
      ],
    })
    resetFetch(jsonResponse(fixture))
    const rec = await lookupRecording('recording-uuid-1')
    assert.equal(rec.artist, 'Lennon & McCartney')
    assert.equal(rec.artistId, 'a1')  // first artist id
  })
})
