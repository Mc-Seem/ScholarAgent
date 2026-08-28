vm: template-vm

## Before the demo (on the host)

The VM runs only the Theia browser frontend. The backend and Postgres must
already be running on the host and publishing port 8000. Either flavor works:

    docker compose up -d                      # published images: Postgres + backend + LaTeXML

or, to demo the current working-tree backend:

    docker compose up -d postgres
    uv run uvicorn backend.app.api.main:app --port 8000

## Running inside the VM

Forward localhost:8000 to the backend on the host, then build and start the
Theia browser app:

    socat TCP-LISTEN:8000,fork,reuseaddr TCP:host.docker.internal:8000 &
    curl -sf http://localhost:8000/health   # preflight: host backend must answer, fail fast otherwise

    cd /workspace/frontend
    export ELECTRON_SKIP_BINARY_DOWNLOAD=1
    npm ci
    npm run dev:theia:browser &
    # ready when http://localhost:3000 responds 200

## Known quirks

- The frontend resolves the API base at runtime as http://<window hostname>:8000,
  and compiled paper HTML embeds absolute http://localhost:8000 asset URLs — the
  socat forward must be running before the app is used, or every API call and
  image will fail.
- The first `npm ci` + Theia webpack build takes several minutes; wait for the
  ready signal before interacting with the app.
- LaTeX compilation of newly uploaded papers happens on the host backend (which
  has Docker/LaTeXML); the demo is most reliable against papers already present
  in the host database.
