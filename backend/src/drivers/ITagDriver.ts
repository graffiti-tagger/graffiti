export type TagValue = string | string[]
export type TagMap = Record<string, TagValue>

export interface FileInfo {
  path: string
  format: 'flac' | 'mp3' | 'ogg' | 'm4a' | 'unknown'
  duration?: string
  bitrate?: number
  sampleRate?: number
  channels?: number
}

export interface ITagDriver {
  readonly name: string
  canHandle(filePath: string): boolean
  readTags(filePath: string): Promise<TagMap>
  writeTags(filePath: string, tags: TagMap): Promise<void>
  readFileInfo(filePath: string): Promise<FileInfo>
  readTagsBatch(filePaths: string[]): Promise<Map<string, TagMap>>
  writeTagsBatch(filePaths: string[], tags: TagMap): Promise<void>
  readDurationsBatch(filePaths: string[]): Promise<Map<string, string | null>>
}

// Base class with default batch implementations — drivers override where they
// can do better (e.g. FLAC's metaflac multi-file support).
export abstract class BaseTagDriver implements ITagDriver {
  abstract readonly name: string
  abstract canHandle(filePath: string): boolean
  abstract readTags(filePath: string): Promise<TagMap>
  abstract writeTags(filePath: string, tags: TagMap): Promise<void>
  abstract readFileInfo(filePath: string): Promise<FileInfo>

  async readTagsBatch(filePaths: string[]): Promise<Map<string, TagMap>> {
    const CONCURRENCY = 8
    const result = new Map<string, TagMap>()
    for (let i = 0; i < filePaths.length; i += CONCURRENCY) {
      const chunk = filePaths.slice(i, i + CONCURRENCY)
      const maps = await Promise.all(
        chunk.map(p => this.readTags(p).catch(() => ({}) as TagMap))
      )
      chunk.forEach((p, j) => result.set(p, maps[j]))
    }
    return result
  }

  async writeTagsBatch(filePaths: string[], tags: TagMap): Promise<void> {
    await Promise.all(filePaths.map(p => this.writeTags(p, tags)))
  }

  async readDurationsBatch(filePaths: string[]): Promise<Map<string, string | null>> {
    const CONCURRENCY = 8
    const result = new Map<string, string | null>()
    for (let i = 0; i < filePaths.length; i += CONCURRENCY) {
      const chunk = filePaths.slice(i, i + CONCURRENCY)
      const infos = await Promise.all(chunk.map(p => this.readFileInfo(p).catch(() => null)))
      chunk.forEach((p, j) => result.set(p, infos[j]?.duration ?? null))
    }
    return result
  }
}
