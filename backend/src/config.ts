import fs from 'fs/promises'
import os from 'os'
import path from 'path'

export interface Config {
  libraryPath: string
  inboxPath: string
  backupPath: string
  watchFolders: boolean
  pathTemplate: string
  sanitizeChars: boolean
  lowercaseExtension: boolean
  padTrackNumber: boolean
  musicbrainz: {
    server: string
    port: number
    username: string
    password: string
    acoustidUserKey: string
    submitFingerprints: boolean
  }
  bins: {
    metaflac: string
    vorbiscomment: string
    AtomicParsley: string
    fpcalc: string
    rsgain: string
    ffprobe: string
    ffmpeg: string
  }
  batchFlac: boolean
  autoProcess: boolean
  replaygainStandard: 'r128' | 'legacy'
  acoustidConfidenceThreshold: number
  fakeLosslessDetection: boolean
  tagSettings?: Record<string, 'mandatory' | 'optional' | 'ignored'>
}

const DEFAULTS: Config = {
  libraryPath: process.env.GT_LIBRARY_PATH || path.join(os.homedir(), 'Music'),
  inboxPath: process.env.GT_INBOX_PATH || path.join(os.homedir(), 'Music', '_inbox'),
  backupPath: process.env.GT_BACKUP_PATH || path.join(os.homedir(), 'Music', '.gt-trash'),
  watchFolders: false,
  pathTemplate: '%albumartist%/%album% (%date%)/%tracknumber% - %title%.%extension%',
  sanitizeChars: true,
  lowercaseExtension: true,
  padTrackNumber: true,
  musicbrainz: {
    server: 'musicbrainz.org',
    port: 443,
    username: '',
    password: '',
    acoustidUserKey: '',
    submitFingerprints: false,
  },
  bins: {
    metaflac: 'metaflac',
    vorbiscomment: 'vorbiscomment',
    AtomicParsley: 'AtomicParsley',
    fpcalc: 'fpcalc',
    rsgain: 'rsgain',
    ffprobe: 'ffprobe',
    ffmpeg: 'ffmpeg',
  },
  batchFlac: true,
  autoProcess: true,
  replaygainStandard: 'r128',
  acoustidConfidenceThreshold: 0.85,
  fakeLosslessDetection: true,
  tagSettings: {
    title:           'mandatory',
    artist:          'mandatory',
    albumartist:     'mandatory',
    album:           'mandatory',
    tracknumber:     'mandatory',
    date:            'mandatory',
    cover_art:       'mandatory',
    genre:           'optional',
    discnumber:      'optional',
    disctotal:       'optional',
    tracktotal:      'optional',
    composer:        'optional',
    lyricist:        'optional',
    conductor:       'optional',
    remixedby:       'optional',
    performer:       'optional',
    comment:         'optional',
    lyrics:          'optional',
    bpm:             'optional',
    key:             'optional',
    grouping:        'optional',
    label:           'optional',
    catalognumber:   'optional',
    isrc:            'optional',
    copyright:       'optional',
    compilation:     'optional',
    rg_track_gain:   'optional',
    rg_track_peak:   'optional',
    rg_album_gain:   'optional',
    rg_album_peak:   'optional',
    mb_recordingid:  'optional',
    mb_releaseid:    'optional',
    mb_artistid:     'optional',
    mb_releasegroupid: 'optional',
    mb_trackid:      'optional',
    acoustid_id:     'optional',
    acoustid_fingerprint: 'ignored',
    encoder:         'optional',
  },
}

function configPath(): string {
  const dir = process.env.GT_CONFIG_DIR
    ?? path.join(os.homedir(), '.config', 'graffiti-tagger')
  return path.join(dir, 'config.json')
}

export async function readConfig(): Promise<Config> {
  try {
    const raw = await fs.readFile(configPath(), 'utf-8')
    return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULTS }
  }
}

export async function writeConfig(config: Config): Promise<void> {
  const p = configPath()
  await fs.mkdir(path.dirname(p), { recursive: true })
  await fs.writeFile(p, JSON.stringify(config, null, 2), 'utf-8')
}
