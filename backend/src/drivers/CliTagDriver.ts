import { execFile, type ChildProcess } from 'child_process'
import { promisify } from 'util'
import { writeFile, unlink } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import NodeID3 from 'node-id3'
import { BaseTagDriver, TagMap, FileInfo } from './ITagDriver.js'

const execFileP = promisify(execFile)

// Tags that appear exactly once per file — seeing a second occurrence signals
// a new file has started in multi-file metaflac output.
// Artist/album tags are listed first because metaflac often outputs them before
// title/tracknumber, so they fire the boundary earlier and prevent those leading
// tags from being mis-assigned to the previous file's block.
const FLAC_BOUNDARY_ANCHORS = new Set([
  'artist', 'albumartist', 'album', 'date', 'genre',
  'title', 'tracknumber', 'musicbrainz_trackid', 'musicbrainz_releasetrackid', 'isrc',
])

// Internal key → node-id3 Tags property name
const KEY_TO_NODE_ID3: Record<string, string> = {
  title:         'title',
  artist:        'artist',
  albumartist:   'performerInfo',
  album:         'album',
  tracknumber:   'trackNumber',
  discnumber:    'partOfSet',
  date:          'year',
  genre:         'genre',
  bpm:           'bpm',
  composer:      'composer',
  isrc:          'ISRC',
  label:         'publisher',
  key:           'initialKey',
  grouping:      'contentGroup',
  lyricist:      'textWriter',
  conductor:     'conductor',
  remixedby:     'remixArtist',
  mood:          'mood',
  originalalbum: 'originalTitle',
  originalartist:'originalArtist',
}

// iTunes MP4 atom ↔ internal key
const MP4_TO_KEY: Record<string, string> = {
  '©nam': 'title',    '©ART': 'artist',    'aART': 'albumartist',
  '©alb': 'album',    'trkn': 'tracknumber', 'disk': 'discnumber',
  '©day': 'date',     '©gen': 'genre',     '©wrt': 'composer',
  '©cmt': 'comment',  'cprt': 'copyright', 'cpil': 'compilation',
  '----:com.apple.iTunes:ISRC': 'isrc',
  '----:com.apple.iTunes:LABEL': 'label',
  '----:com.apple.iTunes:REPLAYGAIN_TRACK_GAIN': 'replaygain_track_gain',
  '----:com.apple.iTunes:REPLAYGAIN_ALBUM_GAIN': 'replaygain_album_gain',
}
const KEY_TO_MP4 = Object.fromEntries(
  Object.entries(MP4_TO_KEY).map(([atom, key]) => [key, atom])
)

const ATOM_TO_FLAG: Record<string, string> = {
  '©nam': '--title',    '©ART': '--artist',   'aART': '--albumArtist',
  '©alb': '--album',    '©day': '--year',      '©gen': '--genre',
  '©wrt': '--composer', '©cmt': '--comment',  'trkn': '--tracknum',
  'disk': '--disk',     'cprt': '--copyright', 'cpil': '--compilation',
}

export interface CliBinaries {
  metaflac?: string
  vorbiscomment?: string
  AtomicParsley?: string
}

const DEFAULTS: Required<CliBinaries> = {
  metaflac: 'metaflac',
  vorbiscomment: 'vorbiscomment',
  AtomicParsley: 'AtomicParsley',
}

const MAX_BUFFER = 50 * 1024 * 1024 // 50 MB — handles large tag batches

// metaflac uses the process locale to encode/decode tag values. Without an
// explicit UTF-8 locale, non-ASCII characters are corrupted (replaced with #
// on write, transliterated on read). Always force UTF-8 for all metaflac calls.
// C.UTF-8 is a glibc built-in on Linux (no locale-gen needed) and works on macOS.
// Plain C locale replaces each non-ASCII byte with '#', corrupting tags like "Leftöver Crack".
const METAFLAC_ENV = { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' }



function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export class CliTagDriver extends BaseTagDriver {
  readonly name = 'cli'
  private bins: Required<CliBinaries>
  private batchFlac: boolean

  constructor(bins: CliBinaries = {}, opts: { batchFlac?: boolean } = {}) {
    super()
    this.bins = { ...DEFAULTS, ...bins }
    this.batchFlac = opts.batchFlac ?? true
  }

  canHandle(filePath: string): boolean {
    return ['.flac', '.mp3', '.ogg', '.m4a'].includes(this.ext(filePath))
  }

  async readTags(filePath: string): Promise<TagMap> {
    switch (this.ext(filePath)) {
      case '.flac': return this.readFlac(filePath)
      case '.ogg':  return this.readOgg(filePath)
      case '.mp3':  return this.readMp3(filePath)
      case '.m4a':  return this.readM4a(filePath)
      default: throw new Error(`Unsupported format: ${filePath}`)
    }
  }

  async writeTags(filePath: string, tags: TagMap): Promise<void> {
    switch (this.ext(filePath)) {
      case '.flac': return this.writeFlac(filePath, tags)
      case '.ogg':  return this.writeOgg(filePath, tags)
      case '.mp3':  return this.writeMp3(filePath, tags)
      case '.m4a':  return this.writeM4a(filePath, tags)
      default: throw new Error(`Unsupported format: ${filePath}`)
    }
  }

  async readFileInfo(filePath: string): Promise<FileInfo> {
    const ext = this.ext(filePath)
    const format = ext === '.flac' ? 'flac' : ext === '.mp3' ? 'mp3'
      : ext === '.ogg' ? 'ogg' : ext === '.m4a' ? 'm4a' : 'unknown'
    let duration: string | undefined
    if (ext === '.flac') {
      try {
        const [samplesOut, rateOut] = await Promise.all([
          execFileP(this.bins.metaflac, ['--show-total-samples', filePath]),
          execFileP(this.bins.metaflac, ['--show-sample-rate', filePath]),
        ])
        const totalSamples = parseInt(samplesOut.stdout.trim())
        const sampleRate = parseInt(rateOut.stdout.trim())
        if (totalSamples > 0 && sampleRate > 0) {
          duration = formatDuration(Math.round(totalSamples / sampleRate))
        }
      } catch { /* leave duration undefined */ }
    }
    return { path: filePath, format, duration }
  }

  // --- Batch overrides ---

  override async readTagsBatch(filePaths: string[]): Promise<Map<string, TagMap>> {
    if (!this.batchFlac) return super.readTagsBatch(filePaths)
    const result = new Map<string, TagMap>()

    // FLAC: group by directory so each dir is one metaflac call
    const flacFiles = filePaths.filter(p => this.ext(p) === '.flac')
    const otherFiles = filePaths.filter(p => this.ext(p) !== '.flac')

    if (flacFiles.length > 0) {
      const byDir = new Map<string, string[]>()
      for (const f of flacFiles) {
        const dir = path.dirname(f)
        if (!byDir.has(dir)) byDir.set(dir, [])
        byDir.get(dir)!.push(f)
      }
      for (const [, files] of byDir) {
        const { stdout } = await execFileP(
          this.bins.metaflac, ['--export-tags-to=-', ...files],
          { maxBuffer: MAX_BUFFER, encoding: 'utf8', env: METAFLAC_ENV }
        )
        const tagMaps = this.parseMultiFlacOutput(stdout, files.length)

        if (tagMaps.length !== files.length) {
          // Boundary detection yielded the wrong number of blocks — fall back to
          // individual reads so no file silently gets an empty tag map.
          console.warn(`metaflac batch parse mismatch in ${path.dirname(files[0])}: expected ${files.length}, got ${tagMaps.length}. Falling back to per-file reads.`)
          const fallback = await Promise.all(
            files.map(f => this.readFlac(f).catch(() => ({}) as TagMap))
          )
          files.forEach((f, i) => result.set(f, fallback[i]))
        } else {
          files.forEach((f, i) => result.set(f, tagMaps[i]))
        }
      }
    }

    // Other formats: concurrent per-file reads
    const CONCURRENCY = 8
    for (let i = 0; i < otherFiles.length; i += CONCURRENCY) {
      const chunk = otherFiles.slice(i, i + CONCURRENCY)
      const maps = await Promise.all(
        chunk.map(p => this.readTags(p).catch(() => ({}) as TagMap))
      )
      chunk.forEach((p, j) => result.set(p, maps[j]))
    }

    return result
  }

  override async readDurationsBatch(filePaths: string[]): Promise<Map<string, string | null>> {
    if (!this.batchFlac) return super.readDurationsBatch(filePaths)
    const result = new Map<string, string | null>()

    const flacFiles = filePaths.filter(p => this.ext(p) === '.flac')
    const otherFiles = filePaths.filter(p => this.ext(p) !== '.flac')

    if (flacFiles.length > 0) {
      const byDir = new Map<string, string[]>()
      for (const f of flacFiles) {
        const dir = path.dirname(f)
        if (!byDir.has(dir)) byDir.set(dir, [])
        byDir.get(dir)!.push(f)
      }
      for (const [, files] of byDir) {
        try {
          const [samplesOut, rateOut] = await Promise.all([
            execFileP(this.bins.metaflac, ['--show-total-samples', ...files], { maxBuffer: MAX_BUFFER }),
            execFileP(this.bins.metaflac, ['--show-sample-rate', ...files], { maxBuffer: MAX_BUFFER }),
          ])
          const samplesLines = samplesOut.stdout.trim().split('\n')
          const rateLines = rateOut.stdout.trim().split('\n')
          files.forEach((f, i) => {
            // metaflac outputs "path:value" for multi-file calls, just "value" for single-file.
            // Use lastIndexOf so colons inside the path don't trip us up.
            const parseMflac = (line: string) => parseInt(line.slice(line.lastIndexOf(':') + 1), 10)
            const totalSamples = parseMflac(samplesLines[i] ?? '')
            const sampleRate = parseMflac(rateLines[i] ?? '')
            result.set(f, totalSamples > 0 && sampleRate > 0
              ? formatDuration(Math.round(totalSamples / sampleRate))
              : null)
          })
        } catch {
          files.forEach(f => result.set(f, null))
        }
      }
    }

    for (const f of otherFiles) result.set(f, null)
    return result
  }

  override async writeTagsBatch(filePaths: string[], tags: TagMap): Promise<void> {
    const flacFiles = filePaths.filter(p => this.ext(p) === '.flac')
    const otherFiles = filePaths.filter(p => this.ext(p) !== '.flac')

    if (flacFiles.length > 0) {
      const removeArgs = Object.keys(tags).map(k => `--remove-tag=${k.toUpperCase()}`)
      const tagLines = Object.entries(tags).flatMap(([k, v]) =>
        (Array.isArray(v) ? v : [v]).map(val => `${k.toUpperCase()}=${val}`)
      ).join('\n') + '\n'
      // --import-tags-from=- (stdin) only accepts one file. Write to a temp file so
      // metaflac can apply the same tags to multiple FLAC files in a single call.
      const tmpFile = path.join(tmpdir(), `gt-tags-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`)
      await writeFile(tmpFile, tagLines, 'utf8')
      try {
        await execFileP(
          this.bins.metaflac,
          [...removeArgs, `--import-tags-from=${tmpFile}`, ...flacFiles],
          { maxBuffer: MAX_BUFFER, env: METAFLAC_ENV }
        )
      } finally {
        await unlink(tmpFile).catch(() => {})
      }
    }

    if (otherFiles.length > 0) {
      await Promise.all(otherFiles.map(p => this.writeTags(p, tags)))
    }
  }

  // --- FLAC (metaflac) ---

  private metaflacImportStdin(args: string[], tagLines: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const child: ChildProcess = execFile(
        this.bins.metaflac, args, { maxBuffer: MAX_BUFFER, env: METAFLAC_ENV },
        (err) => (err ? reject(err) : resolve())
      )
      child.stdin!.setDefaultEncoding('utf8')
      child.stdin!.write(tagLines)
      child.stdin!.end()
    })
  }

  private async readFlac(filePath: string): Promise<TagMap> {
    const { stdout } = await execFileP(
      this.bins.metaflac, ['--export-tags-to=-', filePath],
      { maxBuffer: MAX_BUFFER, encoding: 'utf8', env: METAFLAC_ENV }
    )
    return this.parseVorbisComments(stdout)
  }

  private async writeFlac(filePath: string, tags: TagMap): Promise<void> {
    const removeArgs = Object.keys(tags).map(k => `--remove-tag=${k.toUpperCase()}`)
    // Write tags via stdin (--import-tags-from=-) so non-ASCII values are sent as
    // UTF-8 bytes directly, avoiding locale-dependent command-line argument encoding.
    const tagLines = Object.entries(tags).flatMap(([k, v]) =>
      (Array.isArray(v) ? v : [v]).map(val => `${k.toUpperCase()}=${val}`)
    ).join('\n') + '\n'
    await this.metaflacImportStdin([...removeArgs, '--import-tags-from=-', filePath], tagLines)
  }

  // --- OGG (vorbiscomment) ---

  private async readOgg(filePath: string): Promise<TagMap> {
    const { stdout } = await execFileP(this.bins.vorbiscomment, ['-l', filePath], { maxBuffer: MAX_BUFFER })
    return this.parseVorbisComments(stdout)
  }

  private async writeOgg(filePath: string, tags: TagMap): Promise<void> {
    // vorbiscomment -w replaces ALL tags — read existing first and merge so we
    // don't wipe fields the caller didn't include.
    const existing = await this.readOgg(filePath).catch(() => ({}) as TagMap)
    const merged: TagMap = { ...existing, ...tags }
    const tagArgs = Object.entries(merged).flatMap(([k, v]) =>
      (Array.isArray(v) ? v : [v]).flatMap(val => ['-t', `${k.toUpperCase()}=${val}`])
    )
    await execFileP(this.bins.vorbiscomment, ['-w', ...tagArgs, filePath], { maxBuffer: MAX_BUFFER })
  }

  // --- MP3 (id3v2) ---

  private async readMp3(filePath: string): Promise<TagMap> {
    // node-id3 handles both ID3v2.3 and ID3v2.4; the id3v2 CLI only understands
    // v2.3 and silently falls back to ID3v1 on v2.4 files, losing all v2 data.
    const tag = NodeID3.read(filePath)
    const tags: TagMap = {}

    const set = (key: string, value: string | undefined | null) => {
      if (value != null && value !== '') tags[key] = value
    }

    set('title',          tag.title)
    set('artist',         tag.artist)
    set('albumartist',    tag.performerInfo)
    set('album',          tag.album)
    set('tracknumber',    tag.trackNumber)
    set('discnumber',     tag.partOfSet)
    set('date',           (tag as Record<string, unknown>).recordingTime as string ?? tag.year)
    set('genre',          tag.genre)
    set('bpm',            tag.bpm)
    set('composer',       tag.composer)
    set('isrc',           tag.ISRC)
    set('label',          tag.publisher)
    set('compilation',    (tag as Record<string, unknown>).compilation as string)
    set('key',            tag.initialKey)
    set('grouping',       tag.contentGroup)
    set('lyricist',       tag.textWriter)
    set('conductor',      tag.conductor)
    set('remixedby',      tag.remixArtist)
    set('mood',           tag.mood)
    set('originalalbum',  tag.originalTitle)
    set('originalartist', tag.originalArtist)

    if (tag.comment) {
      const c = tag.comment as unknown
      set('comment', typeof c === 'object' && c !== null && 'text' in c
        ? (c as { text: string }).text
        : c as string)
    }

    // TXXX frames (replaygain, MusicBrainz IDs, etc.)
    const txxx = tag.userDefinedText
    if (txxx) {
      for (const frame of (Array.isArray(txxx) ? txxx : [txxx])) {
        if (frame.description != null && frame.value != null) {
          tags[frame.description.toLowerCase()] = frame.value
        }
      }
    }

    return tags
  }

  private async writeMp3(filePath: string, tags: TagMap): Promise<void> {
    const nodeTags: Record<string, unknown> = {}
    const txxxFrames: Array<{ description: string; value: string }> = []

    for (const [key, value] of Object.entries(tags)) {
      const val = Array.isArray(value) ? value[0] : value
      if (key === 'comment') {
        nodeTags['comment'] = { language: 'eng', shortText: '', text: val }
        continue
      }
      const nodeKey = KEY_TO_NODE_ID3[key]
      if (nodeKey) {
        nodeTags[nodeKey] = val
      } else {
        txxxFrames.push({ description: key.toUpperCase(), value: val })
      }
    }

    if (txxxFrames.length > 0) nodeTags['userDefinedText'] = txxxFrames
    NodeID3.update(nodeTags as Parameters<typeof NodeID3.update>[0], filePath)
  }

  // --- M4A (AtomicParsley) ---

  private async readM4a(filePath: string): Promise<TagMap> {
    const { stdout } = await execFileP(this.bins.AtomicParsley, [filePath, '-t'], { maxBuffer: MAX_BUFFER })
    const tags: TagMap = {}
    for (const line of stdout.split('\n')) {
      const match = line.match(/Atom "([^"]+)" contains: (.+)/)
      if (!match) continue
      const key = MP4_TO_KEY[match[1]]
      if (key) tags[key] = match[2].trim()
    }
    // Freeform atoms print as: Atom "----" [com.apple.iTunes;NAME] contains: value
    for (const line of stdout.split('\n')) {
      const m = line.match(/Atom "----" \[[^;\]]*;([^\]]+)\] contains: (.+)/)
      if (!m) continue
      const key = m[1].toLowerCase()
      if (!(key in tags)) tags[key] = m[2].trim()
    }
    return tags
  }

  private async writeM4a(filePath: string, tags: TagMap): Promise<void> {
    const args: string[] = [filePath]
    for (const [key, value] of Object.entries(tags)) {
      const val = Array.isArray(value) ? value[0] : value
      const atom = KEY_TO_MP4[key]
      const flag = atom ? ATOM_TO_FLAG[atom] : null
      if (flag) {
        args.push(flag, val)
      } else if (/^(musicbrainz_|acoustid_)/.test(key) && val) {
        args.push('--rDNSatom', val, `name=${key.toUpperCase()}`, 'domain=com.apple.iTunes')
      }
    }
    if (args.length === 1) return
    args.push('--overWrite')
    await execFileP(this.bins.AtomicParsley, args, { maxBuffer: MAX_BUFFER })
  }

  // --- Parsers ---

  // Parse concatenated multi-file metaflac output. Detects file boundaries by
  // watching for a second occurrence of any single-value anchor tag.
  private parseMultiFlacOutput(output: string, expectedCount: number): TagMap[] {
    const blocks: TagMap[] = []
    let current: TagMap = {}

    for (const line of output.split('\n')) {
      const eq = line.indexOf('=')
      if (eq === -1) continue
      const key = line.slice(0, eq).toLowerCase().trim()
      const value = line.slice(eq + 1)
      if (!key) continue

      if (FLAC_BOUNDARY_ANCHORS.has(key) && key in current) {
        blocks.push(current)
        current = {}
      }

      const existing = current[key]
      if (existing !== undefined) {
        current[key] = Array.isArray(existing) ? [...existing, value] : [existing as string, value]
      } else {
        current[key] = value
      }
    }

    if (Object.keys(current).length > 0) blocks.push(current)

    // Safety: if boundary detection yielded the wrong count, fall back to what we have
    if (blocks.length !== expectedCount) {
      console.warn(`metaflac batch parse: expected ${expectedCount} blocks, got ${blocks.length}`)
    }

    return blocks
  }

  private parseVorbisComments(output: string): TagMap {
    const tags: TagMap = {}
    for (const line of output.split('\n')) {
      const eq = line.indexOf('=')
      if (eq === -1) continue
      const key = line.slice(0, eq).toLowerCase().trim()
      const value = line.slice(eq + 1)
      if (!key) continue
      const existing = tags[key]
      if (existing !== undefined) {
        tags[key] = Array.isArray(existing) ? [...existing, value] : [existing as string, value]
      } else {
        tags[key] = value
      }
    }
    return tags
  }

  private ext(filePath: string): string {
    return path.extname(filePath).toLowerCase()
  }
}
