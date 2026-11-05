# Graffiti Tagger

![Graffiti Tagger Logo](graffiti-tagger.png)

**Self-hosted music library management with automatic metadata tagging.**

Add music, fingerprint it, pull accurate tags from MusicBrainz, review anything ambiguous, and commit clean files to your library. All in one workflow. Has a very modern web-based user interface.

---

## What it does

Most music taggers make you do the work. Graffiti Tagger runs an automated pipeline that handles the tedious parts and only asks for your input when it genuinely needs it.

Drop in a file, a ZIP, or a Bandcamp link. The pipeline checks file integrity, identifies tracks by acoustic fingerprint, looks up metadata from MusicBrainz, flags duplicates, and embeds cover art. If there's only one confident match, it applies tags automatically. If there are multiple candidates or gaps in the data, it surfaces a review screen so you can pick the right release and adjust anything before it touches your files.

The dashboard gives you library health at a glance — incomplete metadata, suspicious tags, format breakdown, genre distribution, catalog timeline, with one-click fixes for common issues.

---

## Features

- **Three ways to add music** — paste a URL (Bandcamp, direct CDN links, ZIP archives), upload from your machine, or browse a server-side inbox folder
- **Acoustic fingerprinting** via Chromaprint/AcoustID — identifies tracks even without any existing tags
- **MusicBrainz lookup** — pulls authoritative artist, album, release, and track metadata
- **Cover art detection and embedding**
- **Duplicate detection** — flags tracks already in your library before tagging
- **Per-track tag editing** — review and override any field before writing
- **Tag policy configuration** — mark fields as mandatory, optional, or ignored to match your standards
- **Library browser** — tree view (artist → album → track) and grid view with cover art
- **Library health reports** — albums with missing or suspect metadata, with suggested fixes
- **Format support** — FLAC, MP3, M4A, OGG, WAV, AIFF, AAC
- **Graffiti-inspired UI** — customizable visual intensity, accent colors, and density

---

## Requirements

- [Docker](https://www.docker.com/) and Docker Compose

The Docker image bundles everything it needs (`ffmpeg`/`ffprobe`, `fpcalc`, `metaflac`, `vorbiscomment`, `AtomicParsley`, `rsgain`; MP3 tags are written in Node). Nothing has to be installed on the host. Only when running outside Docker do you need those tools on your `$PATH` (or set their paths under Settings → Backend Tools).

---

## Quick start

**1. Clone and configure**

```bash
git clone https://github.com/poaudet/graffiti.git
cd graffiti
cp .env.example .env
```

Edit `.env` to set your library path, inbox directory and port:

```env
MUSIC_LIBRARY_PATH=/path/to/your/music
INBOX_PATH=/path/to/staging/folder
PORT=3001
```

They are mounted in the container at `/music` and `/inbox`, which are the defaults for the library and inbox paths.

**2. Start the app**

```bash
docker compose up -d
```

**3. Open the UI**

```
http://localhost:3001
```

---

## How to use it

### Adding music

Go to the **Inbox** tab. You have three options:

- **URL** — paste a direct link to an audio file, ZIP archive, or Bandcamp page and hit Download
- **Upload** — drag and drop files or archives from your computer
- **Server inbox** — if your server already has files staged in the configured inbox folder, browse and select them here. Use **Add all** on any folder (or **Add all in this folder (recursive)**) to import every audio file beneath it, subfolders included, in one click

Tick **Run in background** (or use **Process all in background** in the Inbox view) to hand a batch to the server: it identifies and tags, scans ReplayGain per album, and promotes to the library without the UI open. Tracks needing review stay in the inbox. Otherwise files are queued and processed interactively. A progress indicator shows each pipeline stage as it runs.

### Reviewing results

When the pipeline completes cleanly, tracks are tagged and moved to your library automatically.

When it needs your input — multiple MusicBrainz matches, missing release info, low-confidence fingerprint — the track appears in the **review queue**. You'll see ranked candidates with confidence scores. Pick the right one, adjust any fields, and confirm. Bulk actions let you apply the same release to all tracks in an album at once.

### Browsing your library

The **Library** tab offers two views:

- **Tree view** — hierarchical artist → album → track browser with search, filter by format or health score
- **Grid view** — visual album browsing with cover art

Click any album to see its tags, health status, and available actions. Selecting an artist or album edits tags in bulk.

### Library health

The **Dashboard** surfaces albums with incomplete or inconsistent metadata. Each flagged item shows what's wrong and offers a quick-fix action. **Fix all** runs the fix flow across every flagged album in one batch. More serious issues link through to the full review flow.

### Settings

Under **Settings** you can:

- Configure paths to your CLI tools (if not on `$PATH`)
- Set tag policies — which fields are mandatory vs. optional
- Adjust library and inbox paths
- Tune the visual theme (intensity, accent color, density)

---

## Configuration

Settings (tag policies, tool paths, library and inbox paths) are stored in `config.json` in the `/config` volume and are editable through the UI. The library index (SQLite) lives in the `/data` volume. Environment variables `GT_LIBRARY_PATH`, `GT_INBOX_PATH` and `GT_BACKUP_PATH` set the initial path defaults. `PUID`/`PGID` (and optional `UMASK`) make the app run as that user/group so files written to `/music` and `/inbox` have the right ownership for other services; `/config` and `/data` are chowned to match on start.

---

## HTTP API (scripting and automation)

The backend is a plain JSON HTTP API under `/api/*`, the same one the UI uses, so you can drive it from `curl`, cron jobs or other tools. There is **no authentication**: only expose the port on a trusted network. Paths are paths *inside the container* (e.g. `/inbox/Album/01.flac`, `/music/...`). Errors return `{ "error": "..." }` with a 4xx/5xx status.

The examples below assume `http://localhost:3001`.

### Use case 1: Hands-off ingest (upload → process → promote)

Fire-and-forget pipeline that survives closing the client.

```bash
# 1. Put files in the inbox (audio files or .zip, multipart) ...
curl -F "file=@album.zip" http://localhost:3001/api/inbox/upload
# ... or let the backend download a URL (streams progress as SSE)
curl -N -X POST -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com/album.zip"}' http://localhost:3001/api/inbox/add-url

# 2. List what is in the inbox
curl http://localhost:3001/api/inbox

# 3. Start a batch job (tag lookup, ReplayGain, promote to library) -> 202 + job
curl -X POST -H 'Content-Type: application/json' \
  -d '{"paths":["/inbox/Album"],"replaygain":true,"promote":true}' \
  http://localhost:3001/api/inbox/batch

# 4. Poll it until stage is "done" or "error"
curl http://localhost:3001/api/inbox/batch/<id>
```

A job exposes `stage` (`queued`, `processing`, `replaygain`, `promoting`, `done`, `error`), `total`, `processed`, `ready`, `promoted`, `needsReview` (tracks left in the inbox for manual review) and `failed`. `GET /api/inbox/batch` lists jobs; `DELETE /api/inbox/batch/<id>` dismisses a finished one.

### Use case 2: Step-by-step inbox processing

Each step streams progress as Server-Sent Events (`data: {json}` lines); use `curl -N`.

| Endpoint | Purpose |
|---|---|
| `POST /api/inbox/process` `{paths, autoProcess?}` | Run the processing pipeline (SSE) |
| `POST /api/inbox/apply-tags` `{path, tags}` | Write tags to an inbox file |
| `POST /api/inbox/replaygain` `{paths}` | Compute ReplayGain |
| `POST /api/inbox/promote` `{paths}` | Move files into the library |
| `POST /api/inbox/cluster` `{paths, folderName}` | Group files into a folder |

### Use case 3: Keep the library index and quality up to date

```bash
curl -X POST http://localhost:3001/api/library/scan        # incremental index refresh
curl -X POST http://localhost:3001/api/library/rebuild     # full rebuild (202, async)
curl http://localhost:3001/api/library/rebuild/status
curl -N -X POST -H 'Content-Type: application/json' \
  -d '{"paths":["/music/Artist/Album"]}' http://localhost:3001/api/library/fix   # re-run pipeline (SSE)
curl -X POST http://localhost:3001/api/library/recompute-health
curl -X POST -H 'Content-Type: application/json' \
  -d '{"paths":["/music/Artist/Album"]}' http://localhost:3001/api/library/health-issues
```

### Use case 4: Read library data and tags (export, reporting)

```bash
curl http://localhost:3001/api/library/tracks              # every indexed track
curl http://localhost:3001/api/library/tree                # artist → album → tracks
curl "http://localhost:3001/api/tags?path=/music/A/B/01.flac"
curl -X PUT -H 'Content-Type: application/json' -d '{"title":"New title"}' \
  "http://localhost:3001/api/tags?path=/music/A/B/01.flac"
curl -X POST -H 'Content-Type: application/json' \
  -d '{"paths":["/music/A/B/01.flac"]}' http://localhost:3001/api/library/tag-status
```

### Use case 5: Metadata lookups and cover art

| Endpoint | Purpose |
|---|---|
| `POST /api/library/identify` `{paths}` | Identify tracks by AcoustID fingerprint |
| `POST /api/library/musicbrainz/search` `{artist?, album?}` | Search MusicBrainz releases |
| `POST /api/library/musicbrainz/release-tracklist` `{releaseId}` | Fetch a release tracklist |
| `POST /api/library/musicbrainz/apply-from-release` `{paths, releaseId}` | Apply a release's tags |
| `GET /api/fingerprint?path=` / `POST /api/fingerprint/batch` `{paths}` | Chromaprint fingerprints |
| `GET /api/art?path=` / `GET /api/art/list?folder=` | Read embedded or folder cover art |
| `GET /api/art/fetch?releaseId=&releaseGroupId=&size=` | Fetch front cover from the Cover Art Archive (release, then release group); returns the image. Embed it via `POST /api/art/embed` |
| `POST /api/art/embed`, `DELETE /api/art/embed` `{trackPaths}` | Embed or remove cover art |

### Use case 6: Configuration and health checks

```bash
curl http://localhost:3001/api/tools/status    # are ffmpeg, fpcalc, etc. available?
curl http://localhost:3001/api/settings        # read config
curl -X PUT -H 'Content-Type: application/json' -d @config.json http://localhost:3001/api/settings
curl "http://localhost:3001/api/fs/ls?path=/music"   # browse folders
```

Destructive endpoints: `POST /api/library/delete`, `POST /api/library/remove-ignored-tags`, `DELETE /api/art/file`. Double-check `paths` before scripting them.

---

## License

MIT
