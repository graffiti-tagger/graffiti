import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import { execFile } from 'child_process'
import { promisify } from 'util'
import NodeID3 from 'node-id3'

const execFileP = promisify(execFile)

export interface ArtImage {
  data: Buffer
  mimeType: string
  pictureType: number
}

export const PICTURE_TYPE_LABELS: Record<number, string> = {
  0: 'Other', 1: 'File icon', 2: 'Other file icon', 3: 'Front cover',
  4: 'Back cover', 5: 'Leaflet', 6: 'Media', 7: 'Lead artist',
  8: 'Artist', 9: 'Conductor', 10: 'Band', 11: 'Composer',
  12: 'Lyricist', 13: 'Recording location', 14: 'During recording',
  15: 'During performance', 16: 'Screen capture', 17: 'Bright fish',
  18: 'Illustration', 19: 'Band logo', 20: 'Publisher logo',
}

export function pictureTypeLabel(n: number): string {
  return PICTURE_TYPE_LABELS[n] ?? `Type ${n}`
}

function synchsafeToInt(buf: Buffer, offset: number): number {
  return ((buf[offset]   & 0x7f) << 21) |
         ((buf[offset+1] & 0x7f) << 14) |
         ((buf[offset+2] & 0x7f) <<  7) |
          (buf[offset+3] & 0x7f)
}

function normaliseMime(raw: string): string {
  const lower = raw.toLowerCase()
  if (lower === 'image/jpg' || lower === 'jpg' || lower === 'jpeg') return 'image/jpeg'
  if (lower === 'png') return 'image/png'
  if (lower === 'webp') return 'image/webp'
  return lower || 'image/jpeg'
}

// --- FLAC binary parser ---

export async function extractAllFlacArt(filePath: string): Promise<ArtImage[]> {
  let handle: fs.FileHandle | null = null
  try {
    handle = await fs.open(filePath, 'r')
    const marker = Buffer.alloc(4)
    if ((await handle.read(marker, 0, 4, 0)).bytesRead < 4) return []
    if (marker.toString('ascii') !== 'fLaC') return []

    const results: ArtImage[] = []
    let pos = 4
    let iterations = 0

    while (iterations++ < 100) {
      const hdr = Buffer.alloc(4)
      const { bytesRead } = await handle.read(hdr, 0, 4, pos)
      if (bytesRead < 4) break

      const isLast = !!(hdr[0] & 0x80)
      const blockType = hdr[0] & 0x7f
      const blockLen = (hdr[1] << 16) | (hdr[2] << 8) | hdr[3]
      pos += 4

      if (blockType === 6 && blockLen > 24) {
        const body = Buffer.alloc(blockLen)
        const { bytesRead: n } = await handle.read(body, 0, blockLen, pos)
        if (n > 24) {
          const img = parseFlacPicture(body)
          if (img) results.push(img)
        }
      }

      pos += blockLen
      if (isLast) break
    }

    return results
  } catch {
    return []
  } finally {
    await handle?.close()
  }
}

function parseFlacPicture(body: Buffer): ArtImage | null {
  try {
    let i = 0
    const pictureType = body.readUInt32BE(i); i += 4
    const mimeLen = body.readUInt32BE(i); i += 4
    const mimeType = normaliseMime(body.toString('ascii', i, i + mimeLen)); i += mimeLen
    const descLen = body.readUInt32BE(i); i += 4
    i += descLen
    i += 16 // width, height, depth, colorCount
    const dataLen = body.readUInt32BE(i); i += 4
    if (i + dataLen > body.length) return null
    return { data: Buffer.from(body.subarray(i, i + dataLen)), mimeType, pictureType }
  } catch {
    return null
  }
}

// --- MP3 (ID3v2) parser ---

function parseApicFrame(frame: Buffer, v22: boolean): ArtImage | null {
  let i = 0
  const encoding = frame[i++]

  let mimeType: string
  if (v22) {
    mimeType = normaliseMime(frame.toString('ascii', i, i + 3))
    i += 3
  } else {
    const mimeEnd = frame.indexOf(0, i)
    if (mimeEnd === -1) return null
    mimeType = normaliseMime(frame.toString('ascii', i, mimeEnd))
    i = mimeEnd + 1
  }

  const pictureType = frame[i++]

  if (encoding === 1 || encoding === 2) {
    while (i + 1 < frame.length && !(frame[i] === 0 && frame[i + 1] === 0)) i += 2
    i += 2
  } else {
    while (i < frame.length && frame[i] !== 0) i++
    i++
  }

  if (i >= frame.length) return null
  return { data: Buffer.from(frame.subarray(i)), mimeType, pictureType }
}

export async function extractAllMp3Art(filePath: string): Promise<ArtImage[]> {
  let handle: fs.FileHandle | null = null
  try {
    handle = await fs.open(filePath, 'r')
    const hdr = Buffer.alloc(10)
    if ((await handle.read(hdr, 0, 10, 0)).bytesRead < 10) return []
    if (hdr.toString('ascii', 0, 3) !== 'ID3') return []

    const major = hdr[3]
    const flags = hdr[5]
    const tagSize = synchsafeToInt(hdr, 6)

    const tag = Buffer.alloc(tagSize)
    await handle.read(tag, 0, tagSize, 10)

    let pos = 0
    if (flags & 0x40) {
      pos += major === 4 ? synchsafeToInt(tag, 0) : tag.readUInt32BE(0)
    }

    const idLen  = major === 2 ? 3 : 4
    const hdrLen = idLen + (major === 2 ? 3 : 4) + (major === 2 ? 0 : 2)
    const results: ArtImage[] = []

    while (pos + hdrLen <= tagSize) {
      const frameId = tag.toString('ascii', pos, pos + idLen)
      if (!frameId || frameId[0] === '\0') break

      const frameSize = major === 2
        ? (tag[pos + 3] << 16) | (tag[pos + 4] << 8) | tag[pos + 5]
        : major === 4
          ? synchsafeToInt(tag, pos + 4)
          : tag.readUInt32BE(pos + 4)

      pos += hdrLen

      if ((frameId === 'APIC' || frameId === 'PIC') && frameSize > 0) {
        const img = parseApicFrame(tag.subarray(pos, pos + frameSize), frameId === 'PIC')
        if (img) results.push(img)
      }

      pos += frameSize
    }

    return results
  } catch {
    return []
  } finally {
    await handle?.close()
  }
}

export async function extractMp3Art(filePath: string): Promise<{ data: Buffer; mimeType: string } | null> {
  const all = await extractAllMp3Art(filePath)
  return all.find(a => a.pictureType === 3) ?? all[0] ?? null
}

// --- Folder images ---

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'])

export interface FolderImage {
  filePath: string
  name: string
  mimeType: string
}

function mimeFromExt(ext: string): string {
  if (ext === '.png') return 'image/png'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.gif') return 'image/gif'
  if (ext === '.bmp') return 'image/bmp'
  return 'image/jpeg'
}

export async function listFolderImages(dirPath: string): Promise<FolderImage[]> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true })
    return entries
      .filter(e => e.isFile() && IMAGE_EXTS.has(path.extname(e.name).toLowerCase()))
      .map(e => ({
        filePath: path.join(dirPath, e.name),
        name: e.name,
        mimeType: mimeFromExt(path.extname(e.name).toLowerCase()),
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  } catch {
    return []
  }
}

// --- Folder cover fallback ---

const COVER_STEMS = ['cover', 'folder']

export async function findFolderCover(dirPath: string): Promise<{ filePath: string; mimeType: string } | null> {
  for (const stem of COVER_STEMS) {
    for (const ext of ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp']) {
      const filePath = path.join(dirPath, stem + ext)
      try {
        await fs.access(filePath)
        return { filePath, mimeType: mimeFromExt(ext) }
      } catch { /* not found, try next */ }
    }
  }
  return null
}

// --- Write operations ---

export async function removeEmbeddedArt(
  filePath: string,
  bins: { metaflac: string }
): Promise<void> {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.flac') {
    await execFileP(bins.metaflac, ['--remove', '--block-type=PICTURE', '--dont-use-padding', filePath])
  } else if (ext === '.mp3') {
    const tags = NodeID3.read(filePath)
    delete tags.image
    NodeID3.write(tags, filePath)
  } else {
    throw new Error(`Removing embedded art not supported for ${ext} files`)
  }
}

export async function addEmbeddedArt(
  filePath: string,
  imageData: Buffer,
  mimeType: string,
  pictureType: number,
  bins: { metaflac: string }
): Promise<void> {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.flac') {
    const imgExt = mimeType === 'image/png' ? '.png' : '.jpg'
    const tmpFile = path.join(
      os.tmpdir(),
      `gt-art-${Date.now()}-${Math.random().toString(36).slice(2)}${imgExt}`
    )
    try {
      await fs.writeFile(tmpFile, imageData)
      // Simple filename form: metaflac auto-detects MIME/dimensions, defaults to type 3 (front cover)
      await execFileP(bins.metaflac, [`--import-picture-from=${tmpFile}`, filePath])
    } finally {
      await fs.unlink(tmpFile).catch(() => {})
    }
  } else if (ext === '.mp3') {
    await addMp3ApicFrame(filePath, imageData, mimeType, pictureType)
  } else {
    throw new Error(`Adding embedded art not supported for ${ext} files`)
  }
}

// Write an APIC frame directly into the MP3's ID3v2 tag.
// id3v2 CLI can't reliably encode binary frames, so we do it in Node.js.
async function addMp3ApicFrame(
  filePath: string,
  imageData: Buffer,
  mimeType: string,
  pictureType: number
): Promise<void> {
  const original = await fs.readFile(filePath)

  // Find the ID3v2 tag
  if (original.length < 10 || original.toString('ascii', 0, 3) !== 'ID3') {
    throw new Error('No ID3v2 tag found in MP3 — cannot embed art')
  }
  const major = original[3]
  if (major < 3) throw new Error(`ID3v2.${major} is too old to embed art`)

  const tagSize = synchsafeToInt(original, 6)
  const tagEnd = 10 + tagSize
  const audioData = original.subarray(tagEnd)

  // Collect all existing frames, stripping any APIC frames
  const frames: Buffer[] = []
  let pos = 0
  const flags = original[5]
  if (flags & 0x40) {
    // Skip extended header
    const extSize = major === 4 ? synchsafeToInt(original, 10) : original.readUInt32BE(10)
    pos = extSize
  }

  while (pos + 10 <= tagSize) {
    const frameId = original.toString('ascii', 10 + pos, 10 + pos + 4)
    if (!frameId || frameId[0] === '\0') break
    const frameSize = major === 4
      ? synchsafeToInt(original, 10 + pos + 4)
      : original.readUInt32BE(10 + pos + 4)
    const frameTotal = 10 + frameSize
    if (frameId !== 'APIC') {
      frames.push(Buffer.from(original.subarray(10 + pos, 10 + pos + frameTotal)))
    }
    pos += frameTotal
  }

  // Build new APIC frame body
  const mimeBytes = Buffer.from(mimeType + '\0', 'latin1')
  const descBytes = Buffer.from('\0', 'latin1') // empty description, null terminator
  const apicBody = Buffer.concat([
    Buffer.from([0x00]),  // encoding: ISO-8859-1
    mimeBytes,
    Buffer.from([pictureType]),
    descBytes,
    imageData,
  ])

  // Build APIC frame header (ID3v2.3/2.4 format)
  const apicFrameSize = major === 4 ? intToSynchsafe(apicBody.length) : uint32BE(apicBody.length)
  const apicFrame = Buffer.concat([
    Buffer.from('APIC', 'ascii'),
    apicFrameSize,
    Buffer.from([0x00, 0x00]), // frame flags
    apicBody,
  ])
  frames.push(apicFrame)

  // Assemble new tag (no extended header, no padding)
  const newFramesBuffer = Buffer.concat(frames)
  const newTagSize = newFramesBuffer.length
  const newHeader = Buffer.from([
    0x49, 0x44, 0x33,        // "ID3"
    major, original[4],       // version
    0x00,                     // flags (clear extended header flag)
    ...intToSynchsafeArray(newTagSize),
  ])
  const newTag = Buffer.concat([newHeader, newFramesBuffer])
  await fs.writeFile(filePath, Buffer.concat([newTag, audioData]))
}

function intToSynchsafe(n: number): Buffer {
  return Buffer.from(intToSynchsafeArray(n))
}

function intToSynchsafeArray(n: number): number[] {
  return [
    (n >> 21) & 0x7f,
    (n >> 14) & 0x7f,
    (n >> 7)  & 0x7f,
    n         & 0x7f,
  ]
}

function uint32BE(n: number): Buffer {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(n, 0)
  return b
}
