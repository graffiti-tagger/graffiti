import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { jsonResponse } from '../../__tests__/helpers.js'
import {
  lookupAcoustID,
  submitAcoustID,
  batchSubmitAcoustID,
  getSubmissionStatus,
  listAcoustIDsByMbid,
} from '../acoustid.js'

let originalFetch: typeof globalThis.fetch
let mockResponses: Response[] = []

before(() => {
  originalFetch = globalThis.fetch
  globalThis.fetch = async () => {
    const r = mockResponses.shift()
    if (!r) throw new Error('No more mock responses queued')
    return r
  }
})

after(() => { globalThis.fetch = originalFetch })

function queue(...responses: Response[]) {
  mockResponses = [...responses]
}

describe('lookupAcoustID', () => {
  test('returns sorted matches with correct shape', async () => {
    queue(jsonResponse({
      status: 'ok',
      results: [
        { id: 'acid-1', score: 0.92, recordings: [{ id: 'rec-1' }] },
        { id: 'acid-2', score: 0.75, recordings: [{ id: 'rec-2' }] },
      ],
    }))
    const matches = await lookupAcoustID('fp123', 180, 'appkey')
    assert.equal(matches.length, 2)
    assert.equal(matches[0].acoustidId, 'acid-1')
    assert.equal(matches[0].confidence, 0.92)
    assert.equal(matches[0].recordingId, 'rec-1')
    assert.equal(matches[1].acoustidId, 'acid-2')
  })

  test('sorts by confidence descending', async () => {
    queue(jsonResponse({
      status: 'ok',
      results: [
        { id: 'low',  score: 0.5,  recordings: [] },
        { id: 'high', score: 0.95, recordings: [{ id: 'r' }] },
      ],
    }))
    const matches = await lookupAcoustID('fp', 60, 'appkey')
    assert.equal(matches[0].acoustidId, 'high')
  })

  test('returns recordingId null when recordings array is empty', async () => {
    queue(jsonResponse({
      status: 'ok',
      results: [{ id: 'acid-x', score: 0.8, recordings: [] }],
    }))
    const matches = await lookupAcoustID('fp', 60, 'appkey')
    assert.equal(matches[0].recordingId, null)
  })

  test('returns empty array when results is empty', async () => {
    queue(jsonResponse({ status: 'ok', results: [] }))
    const matches = await lookupAcoustID('fp', 60, 'appkey')
    assert.deepEqual(matches, [])
  })

  test('throws on API error status', async () => {
    queue(jsonResponse({ status: 'error', error: { code: 3, message: 'Invalid fingerprint' } }))
    await assert.rejects(() => lookupAcoustID('bad', 60, 'key'), /Invalid fingerprint/)
  })

  test('retries on non-JSON response and eventually throws', async () => {
    // 3 attempts, all return garbage
    queue(
      new Response('upstream connect error', { status: 200, headers: { 'Content-Type': 'text/plain' } }),
      new Response('upstream connect error', { status: 200, headers: { 'Content-Type': 'text/plain' } }),
      new Response('upstream connect error', { status: 200, headers: { 'Content-Type': 'text/plain' } }),
    )
    await assert.rejects(() => lookupAcoustID('fp', 60, 'key', 3), /AcoustID/)
  })

  test('succeeds on second attempt after transient failure', async () => {
    queue(
      new Response('bad gateway', { status: 200, headers: { 'Content-Type': 'text/plain' } }),
      jsonResponse({ status: 'ok', results: [{ id: 'acid-ok', score: 0.9, recordings: [{ id: 'rec-ok' }] }] }),
    )
    const matches = await lookupAcoustID('fp', 60, 'key', 2)
    assert.equal(matches[0].acoustidId, 'acid-ok')
  })
})

describe('submitAcoustID', () => {
  test('returns submission id on success', async () => {
    queue(jsonResponse({
      status: 'ok',
      submissions: [{ id: 12345, index: '0', status: 'pending' }],
    }))
    const id = await submitAcoustID('fp', 180, 'appkey', 'userkey', 'rec-uuid')
    assert.equal(id, 12345)
  })

  test('returns null when submissions array is missing', async () => {
    queue(jsonResponse({ status: 'ok' }))
    const id = await submitAcoustID('fp', 180, 'appkey', 'userkey')
    assert.equal(id, null)
  })

  test('throws on HTTP error', async () => {
    queue(new Response('Unauthorized', { status: 401 }))
    await assert.rejects(() => submitAcoustID('fp', 180, 'key', 'user'), /HTTP 401/)
  })
})

describe('batchSubmitAcoustID', () => {
  test('returns mapped results', async () => {
    queue(jsonResponse({
      status: 'ok',
      submissions: [
        { index: 0, id: 1001, status: 'pending' },
        { index: 1, id: 1002, status: 'pending' },
      ],
    }))
    const results = await batchSubmitAcoustID([
      { fingerprint: 'fp1', duration: 180, trackTitle: 'T1', artist: 'A' },
      { fingerprint: 'fp2', duration: 200 },
    ], 'appkey', 'userkey')
    assert.equal(results.length, 2)
    assert.equal(results[0].id, 1001)
    assert.equal(results[1].id, 1002)
  })

  test('throws when API status is not ok', async () => {
    queue(jsonResponse({ status: 'error' }, 200))
    await assert.rejects(
      () => batchSubmitAcoustID([{ fingerprint: 'f', duration: 1 }], 'k', 'u'),
      /AcoustID submit/
    )
  })
})

describe('getSubmissionStatus', () => {
  test('returns status for each submission', async () => {
    queue(jsonResponse({
      status: 'ok',
      submissions: [
        { id: 1, status: 'imported', result: { id: 'acoustid-uuid' } },
        { id: 2, status: 'pending' },
      ],
    }))
    const statuses = await getSubmissionStatus([1, 2], 'appkey')
    assert.equal(statuses.length, 2)
    assert.equal(statuses[0].status, 'imported')
    assert.equal(statuses[0].acoustidId, 'acoustid-uuid')
    assert.equal(statuses[1].status, 'pending')
    assert.equal(statuses[1].acoustidId, undefined)
  })

  test('throws on HTTP error', async () => {
    queue(new Response('Server Error', { status: 500 }))
    await assert.rejects(() => getSubmissionStatus([1], 'key'), /HTTP 500/)
  })
})

describe('listAcoustIDsByMbid', () => {
  test('returns a map of mbid → acoustid for enabled tracks', async () => {
    queue(jsonResponse({
      status: 'ok',
      tracks: {
        'mbid-1': [{ id: 'acid-uuid-1', disabled: false }],
        'mbid-2': [{ id: 'acid-disabled', disabled: true }, { id: 'acid-enabled', disabled: false }],
      },
    }))
    const map = await listAcoustIDsByMbid(['mbid-1', 'mbid-2'], 'appkey')
    assert.equal(map.get('mbid-1'), 'acid-uuid-1')
    assert.equal(map.get('mbid-2'), 'acid-enabled')  // skips disabled
  })

  test('returns empty map on HTTP error', async () => {
    queue(new Response('error', { status: 500 }))
    const map = await listAcoustIDsByMbid(['mbid-1'], 'key')
    assert.equal(map.size, 0)
  })

  test('returns empty map when API status is not ok', async () => {
    queue(jsonResponse({ status: 'error' }))
    const map = await listAcoustIDsByMbid(['mbid-1'], 'key')
    assert.equal(map.size, 0)
  })

  test('skips mbids where all tracks are disabled', async () => {
    queue(jsonResponse({
      status: 'ok',
      tracks: { 'mbid-1': [{ id: 'acid-1', disabled: true }] },
    }))
    const map = await listAcoustIDsByMbid(['mbid-1'], 'key')
    assert.equal(map.size, 0)
  })
})
