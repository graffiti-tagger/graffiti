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
- **Format support** — FLAC, MP3, M4A, OGG, WAV, AIFF, AAC, M4B
- **Graffiti-inspired UI** — customizable visual intensity, accent colors, and density

---

## Requirements

- [Docker](https://www.docker.com/) and Docker Compose
- The following tools installed on the host (or inside the container):
  - `ffmpeg` / `ffprobe` — audio analysis
  - `fpcalc` (Chromaprint) — acoustic fingerprinting
  - `metaflac`, `id3v2`, `vorbiscomment`, `AtomicParsley` — tag read/write per format

---

## Quick start

**1. Clone and configure**

```bash
git clone https://github.com/yourusername/graffiti-tagger.git
cd graffiti-tagger
cp .env.example .env
```

Edit `.env` to set your library path and inbox directory:

```env
MUSIC_LIBRARY_PATH=/path/to/your/music
INBOX_PATH=/path/to/staging/folder
```

**2. Start the app**

```bash
docker compose up -d
```

**3. Open the UI**

```
http://localhost:3000
```

---

## How to use it

### Adding music

Go to the **Inbox** tab. You have three options:

- **URL** — paste a direct link to an audio file, ZIP archive, or Bandcamp page and hit Download
- **Upload** — drag and drop files or archives from your computer
- **Server inbox** — if your server already has files staged in the configured inbox folder, browse and select them here

Files are queued and processed in the background. A progress indicator shows each pipeline stage as it runs.

### Reviewing results

When the pipeline completes cleanly, tracks are tagged and moved to your library automatically.

When it needs your input — multiple MusicBrainz matches, missing release info, low-confidence fingerprint — the track appears in the **review queue**. You'll see ranked candidates with confidence scores. Pick the right one, adjust any fields, and confirm. Bulk actions let you apply the same release to all tracks in an album at once.

### Browsing your library

The **Library** tab offers two views:

- **Tree view** — hierarchical artist → album → track browser with search, filter by format or health score
- **Grid view** — visual album browsing with cover art

Click any album to see its tags, health status, and available actions.

### Library health

The **Dashboard** surfaces albums with incomplete or inconsistent metadata. Each flagged item shows what's wrong and offers a quick-fix action. More serious issues link through to the full review flow.

### Settings

Under **Settings** you can:

- Configure paths to your CLI tools (if not on `$PATH`)
- Set tag policies — which fields are mandatory vs. optional
- Adjust library and inbox paths
- Tune the visual theme (intensity, accent color, density)

---

## Configuration

All persistent configuration lives in the `data/` volume. Tag policies, tool paths, and library settings are stored in the SQLite database and editable through the UI — no config file editing required after initial setup.

---

## License

MIT
