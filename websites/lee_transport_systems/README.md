# lee_transport_systems

Static site + one Cloudflare Worker (`wrangler.toml`, `main` points at
`load_rates/loads_calculator/haiku/worker.js`), served via `[assets] directory = "."`.

## Running locally

### Static pages only (no worker route involved)

No dependencies needed:

```bash
cd websites/lee_transport_systems
python -m http.server 8934 &
curl -s http://localhost:8934/            # walk links with curl
```

### Worker route involved (e.g. anything touching /api/ocr or wrangler.toml)

Node isn't installed by default on this machine — check first:

```bash
node --version || echo "not installed"
```

If missing, install via winget (ask the user first — it's a system install):

```powershell
winget install --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements
```

PATH won't update in the current shell session after install. Refresh it manually
in every PowerShell call that needs node/npx:

```powershell
$machinePath = [System.Environment]::GetEnvironmentVariable('Path','Machine')
$userPath = [System.Environment]::GetEnvironmentVariable('Path','User')
$env:Path = $machinePath + ';' + $userPath
```

Then run wrangler dev — **must** pass `--persist-to` outside the site directory.
Default persistence lands in `.wrangler/state` *inside* `[assets] directory = "."`,
which the dev server also watches — its own state writes retrigger the watcher and
it loops forever on "Reloading local server...". Symptom: requests hang, log spams
reload messages. Fix:

```powershell
npx --yes wrangler@latest dev --port 8936 --local --persist-to "$env:TEMP\wrangler-persist"
```

Run in background, wait for `[wrangler:info] Ready on ...` in the output file
before curling it.

No `ANTHROPIC_API_KEY` is set locally, so `POST /api/ocr` always short-circuits to
`500 {"error":"Server is not configured with an API key."}` before reaching Anthropic
or even the content-type check. That's expected locally — it confirms the worker
loaded and the guard fires, not that OCR itself works. Confirms:
- entry point in `wrangler.toml` actually resolves and boots
- static assets still served correctly alongside the worker
- routing: `POST /api/ocr` handled, everything else 404s or falls through to assets

### Cleanup (always, after using wrangler dev)

```bash
tasklist //FI "IMAGENAME eq node.exe"     # find PIDs
taskkill //PID <pid> //F                  # kill wrangler dev
rm -rf websites/lee_transport_systems/.wrangler   # leftover cache, not part of the site
```
