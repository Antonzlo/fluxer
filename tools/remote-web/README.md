# Run the local web build against a remote server

Develop `fluxer_app` locally while signed in to a deployed Fluxer server, without running the whole backend.

The web app needs `window.__FLUXER_BOOTSTRAP__`, which `fluxer_app_proxy` injects into `index.html`. Pointing the
local page straight at a remote API does not work, because the server only sends CORS headers for its own origin and
its allowed-headers list does not cover the headers the client sends (`x-captcha-type`, `x-fluxer-sudo-mode-jwt` and
others). `edge.mjs` keeps everything same-origin instead.

```
desktop / browser -> localhost:8773 (edge.mjs) --/api, /gateway, /media--> https://<server>
                                               --everything else-------> localhost:8774 (fluxer_app_proxy)
                                                                          \--/assets, index--> localhost:3000 (rspack)
```

The edge rewrites the discovery document so `api`, `gateway` and `media` point at `localhost:8773`, and rewrites the
`Host` and `Origin` headers on the way to the server. No server configuration change is needed.

## Run it (Windows, PowerShell)

Needs Node, pnpm, Rust with the `wasm32-unknown-unknown` target, `wasm-bindgen`, and an LLVM `clang` with a wasm32
backend.

1. Web dev server, from `fluxer_app`. The first command runs the generation steps (wasm, colours, CSS types, lingui) and
   then fails launching the Unix `tcm` shim, which is expected on Windows. The second serves the app.

   ```powershell
   $env:pnpm_config_script_shell = 'C:\Program Files\Git\bin\bash.exe'
   $env:CC_wasm32_unknown_unknown = 'C:\Program Files\LLVM\bin\clang.exe'
   $env:AR_wasm32_unknown_unknown = 'C:\Program Files\LLVM\bin\llvm-ar.exe'
   cargo run --manifest-path ../tools/ci/Cargo.toml -- app-dev-server
   $env:FLUXER_APP_DEV_PORT = '3000'
   pnpm exec rspack serve --mode development
   ```

   On macOS and Linux, `pnpm dev` in `fluxer_app` does both.

2. App proxy, from the repo root. `FLUXER_CSP_EXTRA_CONNECT_SRC` must list wherever LiveKit is served, or the CSP blocks
   voice. An `https://` source does not cover `wss://` requests, so list `wss://` entries explicitly. That includes
   `wss://<server>` when LiveKit sits behind the server's own host under `/livekit`.

   ```powershell
   $env:DISCOVERY_UPSTREAM_URL = 'http://127.0.0.1:8773/api/.well-known/fluxer'
   $env:PUBLIC_BOOTSTRAP_API_ENDPOINT = '/api'
   $env:PUBLIC_BOOTSTRAP_API_PUBLIC_ENDPOINT = 'http://localhost:8773/api'
   $env:FLUXER_APP_PROXY_INDEX_UPSTREAM_URL = 'http://127.0.0.1:3000/'
   $env:FLUXER_APP_PROXY_HOST = '127.0.0.1'
   $env:FLUXER_APP_PROXY_PORT = '8774'
   $env:FLUXER_STATIC_CDN_ENDPOINT = 'http://127.0.0.1:3000'
   $env:FLUXER_STATIC_DIR = 'fluxer_static'
   $env:RELEASE_CHANNEL = 'canary'
   $env:FLUXER_CSP_EXTRA_CONNECT_SRC = 'wss://<server> wss://<livekit-host> https://<livekit-host>'
   cargo run -p fluxer_app_proxy
   ```

3. Edge:

   ```powershell
   $env:REMOTE_HOST = '<server hostname>'
   node tools/remote-web/edge.mjs
   ```

   `EDGE_PORT` (default 8773) and `APP_PROXY_PORT` (default 8774) are optional.

4. Open `http://localhost:8773` in a browser, or run the desktop app against it. Build the canary channel once, with
   the native addons skipped if they are already built. The canary channel uses its own `fluxercanary` profile, so it does
   not collide with an installed stable app on the single-instance lock.

   ```powershell
   cd fluxer_desktop
   $env:BUILD_CHANNEL = 'canary'
   $env:FLUXER_SKIP_NATIVE = 'true'
   $env:PUBLIC_BUILD_VERSION = 'dev'
   $env:PUBLIC_RELEASE_CHANNEL = 'canary'
   pnpm build
   pnpm exec electron . --fluxer-app-url=http://localhost:8773 --fluxer-log-renderer-console
   ```

## Notes

- HMR and live reload are off in the rspack config. After an edit, wait for the rebuild and reload the window.
- The `.module.css` typings watcher (`tcm`) is not started on Windows, so those typings only regenerate when step 1's
  first command runs again.
- The edge listens on loopback only and forwards to the single host in `REMOTE_HOST`.
