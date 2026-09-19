# Local Irvinwop tracker

This fork includes a self-hosted TETR.IO history and replay-analysis service.
It is preconfigured for `Irvinwop` (`678656e79f48dae00cefd822`) and stores its
state in `./data/tetrastats.sqlite`.

## Start it

### macOS

```sh
cp .env.example .env
flutter build web --release
./tracker/scripts/install-launchd.sh
```

Open <http://127.0.0.1:8080>. It is the normal TetraStats interface and opens
directly on `Irvinwop`. The background service performs an initial paginated
backfill, polls every five minutes, deduplicates records, and keeps retrying
replays that fail temporarily.

The web build keeps TetraStats-owned API, image, and data links on the local
origin. The tracker proxies the legacy bridge and beanserver routes upstream,
so browser navigation and requests stay under `127.0.0.1:8080`.

### Docker

Build the Flutter interface before building the container:

```sh
cp .env.example .env
flutter build web --release
docker compose up -d --build
```

For the most reliable replay backfill, put a TETR.IO API token in `.env`:

```dotenv
TETRIO_TOKEN=your_token_here
```

Without a token, public record summaries are still archived and replay IDs are
analyzed through MinoMuncher. With a token, replay files are downloaded from
TETR.IO and analyzed by the bundled local processor; MinoMuncher remains a
fallback. Set `MINOMUNCHER_URL=` to disable that fallback. Expired/stub replays
are recorded as unavailable rather than repeatedly failing.

## Useful commands

```sh
# Health and current worker state
curl http://127.0.0.1:8080/api/health

# Trigger an immediate poll
curl -X POST http://127.0.0.1:8080/api/sync

# Export every stored record and analysis
curl http://127.0.0.1:8080/api/export > tetrastats-export.json

# Stop the service (the SQLite data remains in ./data)
docker compose down
```

The Flutter client now tries the local processor first at
`http://127.0.0.1:8080/api/process-replay` and falls back to the original
remote bridge. Override it at build time with:

```sh
flutter run --dart-define=GAME_PROCESSOR_URL=http://host:port/api/process-replay
```

## Native Bun mode

Docker is optional:

```sh
flutter build web --release
cd tracker
bun install
TRACK_USERNAME=Irvinwop bun run start
```

Run one bounded sync pass with `bun run sync`; add `-- --drain` to keep
processing the entire currently available replay queue before exiting.

### Keep it running on macOS

The included LaunchAgent copies the runtime into
`~/Library/Application Support/TetraStats`, starts it at login, and restarts it
after a crash. This avoids macOS privacy restrictions on background access to
the Documents folder:

```sh
./tracker/scripts/install-launchd.sh
```

Logs and the SQLite database are stored under
`~/Library/Application Support/TetraStats/data`. Rerun the installer after
updating the repository. Remove the background service without deleting its
database with:

```sh
./tracker/scripts/uninstall-launchd.sh
```
