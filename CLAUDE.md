# Rotorflight Blackbox — Android port

An Android WebView wrapper around the Rotorflight Blackbox Explorer 2.3.0 web
app. `README.md` is the full reference (layout, build, upstream sync, every
fix and why). This file is the short version plus the traps.

## Build

JDK 17 + Android SDK 34 are all that's needed; the Gradle wrapper fetches
Gradle 8.7. Set `ANDROID_HOME`, or copy `local.properties.example` to
`local.properties`.

```sh
./gradlew assembleDebug      # gradlew.bat on Windows
```

A pinned offline toolchain (JDK 17, SDK 34, Gradle 8.7) lives outside this
repo in `..\buildtools` on the development machine.

## Non-obvious constraints — read before changing things

- **The web app is served at the URL root**, not a subpath. Parts of it use
  absolute paths (`new Worker("/js/webworkers/…")`, `"/resources/models/…"`),
  which silently break under `/assets/app/`. `MainActivity` maps `/` onto
  `assets/app/` and registers `/restore/` *before* it (handlers match in
  registration order).
- **Two different save paths exist.** `window.saveAs()` (video export) and a
  detached `<a download href="blob:|data:">` + synthetic click (CSV, workspace,
  screenshot). WebView silently drops the latter — `android_shim.js` intercepts
  it by wrapping `document.createElement`, because those anchors are never in
  the DOM and the synthetic click is `cancelable: false`.
- **`.graph-row` offsets are measured at runtime** in `android_mobile.js`.
  Upstream hard-codes `top: 100px / bottom: 80px` (plus an `!important` media
  rule) assuming desktop-sized bars. Do not reintroduce fixed offsets.
- **The navbar logo's caption and filename use hand-tuned pixel offsets keyed
  to the 35px logo.** Resizing the image alone makes them overlap; scale the
  whole `.navbar-logo` block instead.
- **Upstream `position: fixed` bars may have no width.** `.log-seek-bar` had
  none, so it shrink-to-fit — near-full-width at dpr 1, collapsed to ~28% at
  dpr 2. If a bar looks short on a HiDPI screen, check for this.
- Tablets (short screen edge ≥ 600dp) switch the viewport to `device-width`;
  phones keep `width=740`. Forcing 740 on a tablet magnifies everything ~1.7x.

## Testing

Emulator AVDs `testphone` and `testtablet` (1280x800dp) live in
`..\buildtools\avd`. Debug builds enable WebView debugging, so drive the page
over CDP via `adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>`
— **trust CDP measurements over screenshots**, since the software renderer
often yields partially-painted frames. Planting `cache/restore/<log>.BBL` plus
`shared_prefs/restore.xml` with `run-as` makes a launch auto-load a log.

Emulator quirk: Play Services' persistent process dies under software GPU and
takes the app down with it (`depends on provider …FontsProvider`). Not an app
bug — relaunch.

## Conventions

- Commit as Glenn Cain <glenncain009@gmail.com>; **no `Co-Authored-By`
  trailers**.
- Vendored web app files stay byte-identical to upstream wherever possible.
  Every deliberate deviation is listed in `README.md` — keep that list current,
  since upstream syncs depend on re-applying exactly those patches.
