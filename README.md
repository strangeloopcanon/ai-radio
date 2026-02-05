# AI Radio (local)

Generate short AI music tracks locally, and build a mini radio station by generating multiple variations from one station prompt.

## What this app does

- Single-track generation from a prompt.
- Station generation (`N` variations) from one station prompt.
- Local playback queue with download links.
- Provider switch in UI:
  - `acestep` (default, local)
  - `elevenlabs` (API, optional)
  - `heartmula` (local, optional)

## Quick start

1. Install dependencies

```bash
npm install
```

2. Create local env file

```bash
cp .env.example .env
```

3. Review `.env` and choose a provider (`MUSIC_PROVIDER=acestep` is default)

4. Start app

```bash
npm run dev
```

5. Open [http://localhost:3000](http://localhost:3000)

## Provider setup

### ACE-Step (preferred local backend)

- Clone ACE-Step-1.5 into `vendor/acestep`.
- First run downloads checkpoints into `vendor/acestep/checkpoints/`.
- On Apple Silicon, set `ACESTEP_DEVICE=mps`.

Used by this project through `scripts/acestep_generate.py`.

### ElevenLabs (optional API backend)

- Set `ELEVENLABS_API_KEY` in `.env`.
- Choose `ElevenLabs (API)` in the UI provider dropdown, or set `MUSIC_PROVIDER=elevenlabs`.

### HeartMuLa (optional local backend)

- Clone `heartlib` into `vendor/heartlib` and install its dependencies/checkpoints.
- Set `MUSIC_PROVIDER=heartmula`.

## API endpoints

- `GET /api/health`
  - Returns default provider status and readiness for all providers.
- `POST /api/music/compose`
  - Body: `{ prompt, provider?, tags?, lyrics?, musicLengthMs, forceInstrumental, ...providerControls }`
- `POST /api/station/generate`
  - Body: `{ stationPrompt, stationName?, variationCount, provider?, tags?, lyrics?, musicLengthMs, forceInstrumental, ...providerControls }`
- `GET /api/tracks`
- `POST /api/tracks/clear`
- `GET /api/tracks/:id/download`

## Storage

- Generated audio and index are written to `generated/`.
- `generated/` is gitignored.

## Notes

- This project is designed for local experimentation first.
- Generated tracks can be shared by using the download links from the UI.
