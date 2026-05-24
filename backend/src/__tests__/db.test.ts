import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { makeTestDb } from './helpers.js'
import {
  upsertTrack, getTrackByPath, getAllTracks,
  removeOrphanedTracks, removeTracksByPaths,
  getTagPrefs, upsertTagPrefs, deleteTagPrefs,
  insertPendingSubmissions, getPendingSubmissions, hasPathInQueue,
  resolveSubmissions, updateSubmissionsChecked, removeStaleSubmissions,
  getLibraryTree, trackToApiRow,
} from '../db.js'
import type { Database } from 'better-sqlite3'

function makeTrack(overrides: Partial<Parameters<typeof upsertTrack>[1]> = {}): Parameters<typeof upsertTrack>[1] {
  return {
    path: '/music/artist/album/01 - Track.flac',
    format: 'flac',
    file_size: 12345,
    file_mtime: 1700000000,
    file_birthtime: 1700000000,
    title: 'Track One',
    artist: 'Artist',
    albumartist: 'Artist',
    album: 'Album',
    tracknumber: '1',
    discnumber: '1',
    date: '2023',
    genre: 'Rock',
    duration: '3:45',
    tags_json: '{"title":"Track One","artist":"Artist"}',
    health_score: null,
    has_cover_art: null,
    ...overrides,
  }
}

let db: ReturnType<typeof makeTestDb>

describe('db — upsertTrack / getTrackByPath', () => {
  beforeEach(() => { db = makeTestDb() })

  test('inserts a new track and retrieves it by path', () => {
    const track = makeTrack()
    upsertTrack(db, track)
    const row = getTrackByPath(db, track.path)
    assert.ok(row, 'track should exist after insert')
    assert.equal(row.title, 'Track One')
    assert.equal(row.artist, 'Artist')
    assert.equal(row.format, 'flac')
  })

  test('updates an existing track on conflict', () => {
    upsertTrack(db, makeTrack())
    upsertTrack(db, makeTrack({ title: 'Updated Title', file_mtime: 1700000001 }))
    const row = getTrackByPath(db, makeTrack().path)!
    assert.equal(row.title, 'Updated Title')
    assert.equal(row.file_mtime, 1700000001)
  })

  test('returns undefined for unknown path', () => {
    assert.equal(getTrackByPath(db, '/nonexistent'), undefined)
  })

  test('preserves tags_json on upsert', () => {
    const json = '{"album":"Test","musicbrainz_recordingid":"abc-123"}'
    upsertTrack(db, makeTrack({ tags_json: json }))
    const row = getTrackByPath(db, makeTrack().path)!
    assert.equal(row.tags_json, json)
  })

  test('handles null optional fields', () => {
    upsertTrack(db, makeTrack({ title: null, artist: null, albumartist: null, album: null }))
    const row = getTrackByPath(db, makeTrack().path)!
    assert.equal(row.title, null)
    assert.equal(row.artist, null)
  })
})

describe('db — getAllTracks ordering', () => {
  beforeEach(() => { db = makeTestDb() })

  test('orders by albumartist → album → tracknumber numerically', () => {
    upsertTrack(db, makeTrack({ path: '/a', albumartist: 'Zebra', album: 'Z', tracknumber: '1' }))
    upsertTrack(db, makeTrack({ path: '/b', albumartist: 'Apple', album: 'A', tracknumber: '1' }))
    upsertTrack(db, makeTrack({ path: '/c', albumartist: 'Apple', album: 'A', tracknumber: '10' }))
    upsertTrack(db, makeTrack({ path: '/d', albumartist: 'Apple', album: 'A', tracknumber: '2' }))

    const rows = getAllTracks(db)
    assert.equal(rows[0].albumartist, 'Apple')
    assert.equal(rows[0].tracknumber, '1')
    assert.equal(rows[1].tracknumber, '2')   // numeric: 2 < 10
    assert.equal(rows[2].tracknumber, '10')
    assert.equal(rows[3].albumartist, 'Zebra')
  })

  test('handles tracknumber in "N/total" format', () => {
    upsertTrack(db, makeTrack({ path: '/a', tracknumber: '3/10' }))
    upsertTrack(db, makeTrack({ path: '/b', tracknumber: '1/10' }))
    const rows = getAllTracks(db)
    assert.equal(rows[0].path, '/b')
    assert.equal(rows[1].path, '/a')
  })

  test('returns empty array when no tracks', () => {
    assert.deepEqual(getAllTracks(db), [])
  })
})

describe('db — removeOrphanedTracks', () => {
  beforeEach(() => { db = makeTestDb() })

  test('removes tracks not in the known-paths list', () => {
    upsertTrack(db, makeTrack({ path: '/keep' }))
    upsertTrack(db, makeTrack({ path: '/remove' }))
    const removed = removeOrphanedTracks(db, ['/keep'])
    assert.equal(removed, 1)
    assert.ok(getTrackByPath(db, '/keep'))
    assert.equal(getTrackByPath(db, '/remove'), undefined)
  })

  test('removes all tracks when knownPaths is empty', () => {
    upsertTrack(db, makeTrack({ path: '/a' }))
    upsertTrack(db, makeTrack({ path: '/b' }))
    const removed = removeOrphanedTracks(db, [])
    assert.equal(removed, 2)
    assert.equal(getAllTracks(db).length, 0)
  })

  test('removes nothing when all paths are known', () => {
    upsertTrack(db, makeTrack({ path: '/a' }))
    const removed = removeOrphanedTracks(db, ['/a'])
    assert.equal(removed, 0)
  })
})

describe('db — removeTracksByPaths', () => {
  beforeEach(() => { db = makeTestDb() })

  test('removes only the specified paths', () => {
    upsertTrack(db, makeTrack({ path: '/a' }))
    upsertTrack(db, makeTrack({ path: '/b' }))
    upsertTrack(db, makeTrack({ path: '/c' }))
    const removed = removeTracksByPaths(db, ['/a', '/c'])
    assert.equal(removed, 2)
    assert.equal(getAllTracks(db).length, 1)
    assert.ok(getTrackByPath(db, '/b'))
  })

  test('returns 0 for empty paths list', () => {
    upsertTrack(db, makeTrack())
    assert.equal(removeTracksByPaths(db, []), 0)
  })

  test('returns 0 when path does not exist', () => {
    assert.equal(removeTracksByPaths(db, ['/nonexistent']), 0)
  })
})

describe('db — tag preferences', () => {
  beforeEach(() => { db = makeTestDb() })

  test('upsertTagPrefs stores preferences and getTagPrefs retrieves them', () => {
    upsertTagPrefs(db, [
      { path: '/a.flac', tagKey: 'title' },
      { path: '/a.flac', tagKey: 'artist' },
      { path: '/b.flac', tagKey: 'album' },
    ])
    const prefs = getTagPrefs(db, ['/a.flac', '/b.flac'])
    assert.deepEqual([...prefs.get('/a.flac')!].sort(), ['artist', 'title'])
    assert.deepEqual([...prefs.get('/b.flac')!], ['album'])
  })

  test('returns empty map for empty paths list', () => {
    const prefs = getTagPrefs(db, [])
    assert.equal(prefs.size, 0)
  })

  test('upsertTagPrefs is idempotent (OR IGNORE)', () => {
    upsertTagPrefs(db, [{ path: '/a.flac', tagKey: 'title' }])
    upsertTagPrefs(db, [{ path: '/a.flac', tagKey: 'title' }])
    const prefs = getTagPrefs(db, ['/a.flac'])
    assert.equal(prefs.get('/a.flac')!.size, 1)
  })

  test('deleteTagPrefs removes specific key for path', () => {
    upsertTagPrefs(db, [
      { path: '/a.flac', tagKey: 'title' },
      { path: '/a.flac', tagKey: 'artist' },
    ])
    deleteTagPrefs(db, [{ path: '/a.flac', tagKey: 'title' }])
    const prefs = getTagPrefs(db, ['/a.flac'])
    assert.ok(!prefs.get('/a.flac')!.has('title'))
    assert.ok(prefs.get('/a.flac')!.has('artist'))
  })

  test('deleteTagPrefs on empty list does nothing', () => {
    upsertTagPrefs(db, [{ path: '/a.flac', tagKey: 'title' }])
    deleteTagPrefs(db, [])
    const prefs = getTagPrefs(db, ['/a.flac'])
    assert.equal(prefs.get('/a.flac')!.size, 1)
  })
})

describe('db — AcoustID submission queue', () => {
  beforeEach(() => { db = makeTestDb() })

  test('insertPendingSubmissions adds entries and getPendingSubmissions returns them', () => {
    insertPendingSubmissions(db, [
      { submissionId: 101, path: '/a.flac' },
      { submissionId: 102, path: '/b.flac' },
    ])
    const rows = getPendingSubmissions(db)
    assert.equal(rows.length, 2)
    assert.ok(rows.some(r => r.submission_id === 101 && r.path === '/a.flac'))
    assert.ok(rows.some(r => r.submission_id === 102 && r.path === '/b.flac'))
  })

  test('hasPathInQueue returns true for existing path', () => {
    insertPendingSubmissions(db, [{ submissionId: 201, path: '/track.flac' }])
    assert.ok(hasPathInQueue(db, '/track.flac'))
  })

  test('hasPathInQueue returns false for unknown path', () => {
    assert.ok(!hasPathInQueue(db, '/unknown.flac'))
  })

  test('insertPendingSubmissions is idempotent (OR IGNORE)', () => {
    insertPendingSubmissions(db, [{ submissionId: 301, path: '/a.flac' }])
    insertPendingSubmissions(db, [{ submissionId: 301, path: '/a.flac' }])
    assert.equal(getPendingSubmissions(db).length, 1)
  })

  test('resolveSubmissions deletes specific entries', () => {
    insertPendingSubmissions(db, [
      { submissionId: 401, path: '/a.flac' },
      { submissionId: 402, path: '/b.flac' },
    ])
    resolveSubmissions(db, [401])
    const rows = getPendingSubmissions(db)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].submission_id, 402)
  })

  test('resolveSubmissions on empty list does nothing', () => {
    insertPendingSubmissions(db, [{ submissionId: 501, path: '/a.flac' }])
    resolveSubmissions(db, [])
    assert.equal(getPendingSubmissions(db).length, 1)
  })

  test('updateSubmissionsChecked sets last_checked_at', () => {
    insertPendingSubmissions(db, [{ submissionId: 601, path: '/a.flac' }])
    assert.equal(getPendingSubmissions(db)[0].last_checked_at, null)
    updateSubmissionsChecked(db, [601])
    const row = getPendingSubmissions(db)[0]
    assert.ok(row.last_checked_at != null && row.last_checked_at > 0)
  })

  test('removeStaleSubmissions deletes nothing when all entries are fresh', () => {
    insertPendingSubmissions(db, [{ submissionId: 701, path: '/a.flac' }])
    const removed = removeStaleSubmissions(db)
    assert.equal(removed, 0)
    assert.equal(getPendingSubmissions(db).length, 1)
  })
})

describe('db — getLibraryTree', () => {
  beforeEach(() => { db = makeTestDb() })

  test('returns empty array when no tracks', () => {
    assert.deepEqual(getLibraryTree(db), [])
  })

  test('groups tracks by albumartist and album', () => {
    upsertTrack(db, makeTrack({ path: '/a/1.flac', albumartist: 'Artist A', album: 'Album 1', tracknumber: '1', title: 'T1', date: '2020' }))
    upsertTrack(db, makeTrack({ path: '/a/2.flac', albumartist: 'Artist A', album: 'Album 1', tracknumber: '2', title: 'T2', date: '2020' }))
    upsertTrack(db, makeTrack({ path: '/b/1.flac', albumartist: 'Artist B', album: 'Album B', tracknumber: '1', title: 'T3', date: '2019' }))

    const tree = getLibraryTree(db)
    assert.equal(tree.length, 2)

    const artistA = tree.find(a => a.artist === 'Artist A')!
    assert.ok(artistA)
    assert.equal(artistA.albums.length, 1)
    assert.equal(artistA.albums[0].tracks.length, 2)
    assert.equal(artistA.albums[0].tracks[0].n, 1)
    assert.equal(artistA.albums[0].tracks[1].n, 2)
  })

  test('sorts artists alphabetically', () => {
    upsertTrack(db, makeTrack({ path: '/z', albumartist: 'Zebra', album: 'Z' }))
    upsertTrack(db, makeTrack({ path: '/a', albumartist: 'Aardvark', album: 'A' }))
    const tree = getLibraryTree(db)
    assert.equal(tree[0].artist, 'Aardvark')
    assert.equal(tree[1].artist, 'Zebra')
  })

  test('falls back to artist when albumartist is null', () => {
    upsertTrack(db, makeTrack({ path: '/a', albumartist: null, artist: 'Solo Artist' }))
    const tree = getLibraryTree(db)
    assert.equal(tree[0].artist, 'Solo Artist')
  })

  test('sorts albums within an artist by year', () => {
    upsertTrack(db, makeTrack({ path: '/b', albumartist: 'A', album: 'Later', date: '2022', tracknumber: '1' }))
    upsertTrack(db, makeTrack({ path: '/a', albumartist: 'A', album: 'Earlier', date: '2018', tracknumber: '1' }))
    const albums = getLibraryTree(db)[0].albums
    assert.equal(albums[0].name, 'Earlier')
    assert.equal(albums[1].name, 'Later')
  })
})

describe('db — trackToApiRow', () => {
  beforeEach(() => { db = makeTestDb() })

  test('translates vorbis key aliases to logical keys', () => {
    upsertTrack(db, makeTrack({
      tags_json: JSON.stringify({
        musicbrainz_recordingid: 'rec-uuid',
        musicbrainz_releaseid: 'rel-uuid',
        replaygain_track_gain: '-5.00 dB',
        replaygain_album_gain: '-3.00 dB',
        acoustid_id: 'acid-uuid',
      }),
    }))
    const row = getTrackByPath(db, makeTrack().path)!
    const api = trackToApiRow(row)
    assert.equal(api.mb_recordingid, 'rec-uuid')
    assert.equal(api.mb_releaseid, 'rel-uuid')
    assert.equal(api.rg_track_gain, '-5.00 dB')
    assert.equal(api.rg_album_gain, '-3.00 dB')
    assert.equal(api.acoustid_id, 'acid-uuid')
  })

  test('passes unknown keys through as-is', () => {
    upsertTrack(db, makeTrack({ tags_json: JSON.stringify({ comment: 'hello' }) }))
    const row = getTrackByPath(db, makeTrack().path)!
    const api = trackToApiRow(row)
    assert.equal(api.comment, 'hello')
  })

  test('promotes core columns to top-level fields', () => {
    upsertTrack(db, makeTrack())
    const row = getTrackByPath(db, makeTrack().path)!
    const api = trackToApiRow(row)
    assert.equal(api.title, 'Track One')
    assert.equal(api.artist, 'Artist')
    assert.equal(api.fmt, 'FLAC')
    assert.ok(typeof api.id === 'number')
  })

  test('musicbrainz_albumid maps to mb_releaseid (Picard legacy alias)', () => {
    upsertTrack(db, makeTrack({ tags_json: JSON.stringify({ musicbrainz_albumid: 'legacy-uuid' }) }))
    const row = getTrackByPath(db, makeTrack().path)!
    const api = trackToApiRow(row)
    assert.equal(api.mb_releaseid, 'legacy-uuid')
  })
})
