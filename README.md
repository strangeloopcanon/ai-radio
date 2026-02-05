# AI Radio (local)

Generate short tracks with AI music and create a station mix from one prompt.

## Frontend

![AI Radio frontend](docs/frontend.png)

## What this app does

- Clean station-first UI: station name, station vibe prompt, track length, track count.
- Generates a multi-track mix (`2-12` variations) from one station prompt.
- Builds prompt variations automatically so each track is different.
- Local playback queue with per-track download links.

## Quick start

1. Install dependencies

```bash
npm install
```

2. Create local env file

```bash
cp .env.example .env
```

3. Set your default backend in `.env` (recommended: `MUSIC_PROVIDER=acestep`)

4. Start dev server

```bash
npm run dev
```

5. Open [http://localhost:3000](http://localhost:3000)

## Provider setup

### ACE-Step (preferred local backend)

- Clone ACE-Step into `vendor/acestep`.
- On first generation, model assets are downloaded/cached by ACE-Step.
- On Apple Silicon, use `ACESTEP_DEVICE=mps` in `.env`.
- Used via `scripts/acestep_generate.py`.

### ElevenLabs (optional API fallback)

- Set `ELEVENLABS_API_KEY` in `.env`.
- Set `MUSIC_PROVIDER=elevenlabs` when you want to use it.

### HeartMuLa (optional local fallback)

- Supported by backend only; not the preferred path.
- Requires `vendor/heartlib` + checkpoints and `MUSIC_PROVIDER=heartmula`.

## Station flow

1. Enter a station name and station vibe prompt.
2. Choose track length (seconds) and number of tracks.
3. Click `Generate Mix`.
4. The backend generates multiple prompt variations and composes one track per variation.

## API endpoints

- `GET /api/health` returns active provider + readiness.
- `POST /api/station/generate` generates a full station mix.
- `POST /api/music/compose` generates one track (API supported, not exposed in current UI).
- `GET /api/tracks` lists saved tracks.
- `POST /api/tracks/clear` clears generated files/metadata.
- `GET /api/tracks/:id/download` downloads one generated track.

## Storage

- Generated audio and metadata are written to `generated/`.
- `generated/` is gitignored.

## Notes

- This project is local-first for experimentation.
- Downloaded tracks can be shared from the UI.
