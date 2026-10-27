# Rotorflight Blackbox — Android port

An Android WebView wrapper around the Rotorflight Blackbox Explorer 2.3.0 web app
(the same HTML/JS app that runs inside NW.js on Windows).

## Layout

- `app/src/main/assets/app/` — the web app, copied from the official
  [rotorflight-blackbox](https://github.com/rotorflight/rotorflight-blackbox)
  repo at tag `release/2.3.0` = commit `b9635a975e95159faf1bf7b5efc4ce7cd93a2b37`
  (source clone lives in `..\app-src`), plus:
  - `js/android_shim.js` — emulates the NW.js/Chrome APIs the app expects
    (`require('nw.gui')`, `chrome.storage.local`, `chrome.i18n`,
    `chrome.runtime.getManifest`) and routes `saveAs`/external links through
    the Android bridge.
  - `js/android_i18n_messages.js` — the `_locales/en/messages.json` strings
    embedded as a JS global (generated at build prep time).
  - `index.html` — two lines added to load the shims first; viewport changed
    to `width=740` so the desktop layout scales to fit a phone screen.
  - `node_modules/` — the four runtime deps (bootstrap 3.4.1, lodash 4.17.21,
    html2canvas 1.4.1, webm-writer 0.3.0) extracted from npm tarballs and
    **trimmed to the files the app actually loads** — 13 files plus each
    package's licence, 752 KB. The complete packages are 1,570 files / 9.8 MB
    of `dist/lib`, `dist/types`, `__tests__` and per-module builds that nothing
    references; they were also nested deeply enough that a `git clone` on
    Windows failed with "Filename too long" (260-char `MAX_PATH`). If you
    re-extract from tarballs during an upstream sync, trim again — the
    referenced set is:

    ```
    bootstrap/dist/css/bootstrap.min.css        bootstrap/dist/js/bootstrap.min.js
    bootstrap/dist/css/bootstrap-theme.min.css  bootstrap/dist/fonts/glyphicons-halflings-regular.*
    html2canvas/dist/html2canvas.min.js         lodash/lodash.min.js
    webm-writer/{ArrayBufferDataStream,BlobBuffer,WebMWriter}.js
    ```

    Trimming also nearly halved the app: the APK went **4.48 MB → 2.44 MB**.
    Note that Gradle's incremental asset merge keeps deleted files around, so
    measure a slimming change with `./gradlew clean assembleDebug` — an
    incremental build reported 4.33 MB for the same source.
- `app/src/main/java/.../MainActivity.java` — full-screen WebView served by
  `WebViewAssetLoader`, a file chooser for opening `.BBL` logs (any file type,
  multi-select), and a `saveFile` bridge that writes exports (CSV, PNG, WebM,
  JSON) to the phone's Downloads folder.

  The web app is served at the **URL root** (`https://appassets.androidplatform.net/index.html`),
  with a root path handler mapping `/` onto `assets/app/`. This matters: parts
  of the app use absolute resource paths — `csv-exporter.js` does
  `new Worker("/js/webworkers/csv-export-worker.js")` and `craft_3d.js` loads
  `"/resources/models/bell_cw.gltf"`. Serving from a subpath silently broke
  both (CSV export and the 3D craft model). Under NW.js the app root is `/`,
  so mirroring that keeps them working without patching upstream files.
  Handlers are matched in registration order, so `/restore/` is registered
  before the catch-all `/`.

## Building from source (standalone)

This is a self-contained Gradle project. All you need is a **JDK 17** and the
**Android SDK** (compileSdk 34, build-tools 34.0.0); the Gradle wrapper fetches
Gradle 8.7 itself. There are no npm/CocoaPods steps — the web app and its four
JS dependencies are checked in under `app/src/main/assets/app/`.

1. Point the build at your Android SDK, either by setting `ANDROID_HOME`, or by
   copying `local.properties.example` to `local.properties` and editing
   `sdk.dir`.
2. Build:

   ```sh
   # macOS / Linux
   ./gradlew assembleDebug

   # Windows
   gradlew.bat assembleDebug
   ```

APK output: `app/build/outputs/apk/debug/app-debug.apk`

For a release (unsigned) build use `assembleRelease`; sign it with your own
keystore via `apksigner`.

### Building on GitHub

`.github/workflows/release.yml` runs `clean assembleDebug` on a GitHub runner
and publishes the APK as a GitHub release (tag `v<versionName>-build<versionCode>`).
Start it from the Actions tab with **Run workflow**, or push a `v*` tag. The
runner signs with its own throwaway debug key, so its APK will not install over
one built locally: uninstall the existing app first.

### Alternative: the portable toolchain used to develop this

A pinned, offline JDK 17 + Android SDK 34 + Gradle 8.7 lives in `..\buildtools`
(not part of the source tree). To build with it instead of the wrapper:

```
set JAVA_HOME=%LOCALAPPDATA%\rotorflight-blackbox\buildtools\jdk-17.0.19+10
cd %LOCALAPPDATA%\rotorflight-blackbox\android
..\buildtools\gradle-8.7\bin\gradle.bat assembleDebug
```

## Source tree

```
android/
├── settings.gradle          Gradle settings + repositories
├── build.gradle             root project (AGP 8.5.2)
├── gradle.properties        AndroidX + JVM args
├── gradlew / gradlew.bat    Gradle wrapper (fetches Gradle 8.7)
├── gradle/wrapper/          wrapper jar + properties
├── local.properties.example template for sdk.dir
├── .gitignore
└── app/
    ├── build.gradle         module config (applicationId, sdk levels, deps)
    └── src/main/
        ├── AndroidManifest.xml
        ├── java/org/rotorflight/blackbox/MainActivity.java
        ├── res/                         launcher icon + strings
        └── assets/app/                  the Rotorflight Blackbox web app
            ├── index.html               (patched: loads shims, mobile layer)
            ├── index.js
            ├── js/                       app scripts + android_*.js
            ├── css/                      app styles + android_mobile.css
            ├── images/, resources/, _locales/
            └── node_modules/            bootstrap, lodash, html2canvas,
                                         webm-writer (runtime dist only)
```

## Analyser menu entry and touch frequency marker (versionCode 7)

Both are upstream behaviours that only bite without a keyboard; the vendored
files stay untouched and the fixes live in the mobile layer.

- **"Analyser" missing from the View menu.** Upstream `main.css` has
  `html:not(.has-analyser) a.view-analyser { display: none }`, so the menu
  entry exists only while the analyser is already on — it can switch it off
  but never on. (With no video loaded "Video" is hidden too, which leaves
  Craft and Sticks.) Desktop users don't notice: wide windows show toolbar
  buttons instead of the menu, and the `A` key toggles it. The View menu
  appears below 887 CSS px (1151 with a video), e.g. a phone or a tablet in
  portrait. `android_mobile.css` keeps the entry visible; its colour still
  shows the on/off state.
- **Frequency/RPM marker line would not move.** `graph_spectrum.js`
  `trackFrequency()` only moves the green marker (and its 2×–4× harmonics)
  while **Shift** is held, and its `touchmove` binding goes through the same
  check — reading `clientX` off the TouchEvent, which has none. On a
  touchscreen the line can never be placed. `android_mobile.js` sets the
  marker from the touch position (tap, or drag one finger across the
  analyser) and redraws via `graph.getAnalyser().refresh()`. It does not
  `preventDefault()` the `touchstart`, because the analyser's toolbar is
  revealed by `.analyser:hover`, which on touch comes from the emulated mouse
  events of a tap.

Both are candidates to report upstream.

## Seek bar width and touch tooltips (versionCode 5)

**Seek bar.** Its activity waveform only covered ~28% of the window. The cause
was not the canvas: measurement showed the bitmap was 1290px wide with ink
drawn right across it (`lastInkX: 1284`), but the `.log-seek-bar` *container*
was only 373px. Upstream declares that bar `position: fixed` with a `bottom`
but no `width` and no `left`/`right`, so it shrink-to-fits. On a desktop at
dpr 1 that happens to land near the window width; at dpr 2 it collapsed.
Fixed by pinning `left: 0; right: 0` — coverage went 28% → 99%.

Note on seeking accuracy: taps were **always** mapped correctly, even while
the bar was drawn narrow. `seekToDOMPixel()` normalises the touch x by
`getBoundingClientRect()` before scaling to the bitmap, so display width and
bitmap width can differ without affecting the resulting time. (An earlier
guess that this could mis-seek was wrong.)

**Tooltips.** Upstream initialises them with `trigger: "hover"`. A touchscreen
delivers the synthetic mouse-enter but never the matching mouse-out, so a
tapped button left its tooltip parked over the graph indefinitely.
`android_mobile.js` now hides a tooltip 1.8s after it appears
(`shown.bs.tooltip`) and drops any that are still up on the next touch
anywhere (capture-phase `touchstart`, so the tooltip for the element actually
being touched still appears normally).

Verified on-device: seek bar 800px of an 800px viewport (99%); tooltip count
1 → 0 after the linger timeout, and 1 → 0 after a synthesized touch elsewhere.

## Compact UI for phones and tablets (versionCode 4)

- **Tablet viewport.** `index.html` ships `width=740` so the desktop layout
  fits a phone. On a tablet that forced width is scaled *up* to fill the
  display (1280dp / 740 ≈ 1.7×) — which is why every bar and label looked
  oversized there. `android_shim.js` now switches tablets (short screen edge
  ≥ 600dp, Android's own sw600dp rule) to `width=device-width`: native scale,
  proportionally smaller chrome, and much more graph. Phones keep 740.
- **Compact chrome.** Title bar, control toolbar, seek bar, status bar and the
  legend all get smaller padding and fonts. An extra squeeze applies under
  `@media (max-height: 430px)`, i.e. a phone in landscape, which has only
  ~320 CSS px of height to spend.
- **Full-screen now means full-screen.** The ⛶ button also hides the legend /
  side panel; previously it only hid the bars, so the sidebar stayed. It also
  moved to the bottom-left, where it no longer covers "Graph setup".
- **Graph offsets are measured at runtime.** Upstream pins `.graph-row` with
  `top: 100px / bottom: 80px` (and `86px !important` inside a media query),
  numbers that assume desktop-sized bars. `android_mobile.js` measures the
  bars that are actually visible and sets the offsets to match, so the graph
  gets exactly the leftover space in either state and any orientation. It also
  zeroes upstream's `margin-top: 1em` on that row.
- **Two upstream layout quirks worked around.** The "Blackbox Explorer"
  caption and the filename are positioned with hand-tuned offsets keyed to the
  35px logo (`.navbar-logo span { left: -160px; top: 30px }`), so resizing the
  image alone makes them overlap. The whole logo block is scaled instead
  (`transform: scale(.72)`), the caption is hidden (a short bar clips it), and
  the filename is pinned clear of the logo.

Measured on the emulator, log loaded:

| | before | after |
|---|---|---|
| Tablet landscape (1280×800dp), chrome height | 166px of ~460 (≈36%) | 120px of 716 (17%) |
| Tablet title bar | 51px | 30px |
| Phone landscape, chrome height | 119px of 318 (37%) | 108px (34%) |
| Collapsed via ⛶ | bars hidden, sidebar remained | all hidden, graph 100% of viewport |

Known cosmetic issue, pre-existing and unrelated to these changes: the seek
bar's waveform does not span the full window width (its bitmap is sized from
the graph canvas, which excludes the legend). Visible in every version so far.

## Export/download fixes (versionCode 3)

The app saves files two different ways, and only one of them worked at first:

- `window.saveAs()` — used by the video renderer. Shimmed in
  `android_shim.js` → `Android.saveFile`. Worked from the start.
- A **detached `<a download href="blob:|data:">` given a synthetic click** —
  used by CSV export, workspace export and screenshots. Android WebView has no
  `DownloadListener` for `blob:` URLs, so all three silently did nothing.

`android_shim.js` now intercepts that pattern. Because those anchors are never
inserted into the document, a listener on `document` would never see the event,
so `document.createElement` is wrapped to attach a click listener to any `<a>`
it creates; blob:/data: downloads are fetched and routed to `Android.saveFile`.
The app's synthetic click is built with `cancelable=false`, so
`preventDefault()` is not possible — the save is simply performed in parallel
and WebView's own (no-op) attempt is ignored.

## Mobile UX layer (versionCode 2)

- `js/android_mobile.js` + `css/android_mobile.css` — phone-focused layer:
  - **Log persistence**: files picked in the chooser are copied into the app
    cache (`MainActivity.cacheLogsForRestore`); after process death the web
    app re-fetches them from the `/restore/` asset-loader path and reloads
    automatically.
  - **Pinch zoom** on the main graph, anchored at the pinch point (continuous,
    beyond the discrete Zoom control). One-finger drag seek is upstream.
  - **Collapsible chrome**: floating ⛶ button hides title bar, toolbar, seek
    bar and status bar; graph reclaims the fixed offsets of
    `html.has-log .graph-row`.
  - Dropdown menus capped at 70vh and scrollable; Bootstrap modals constrained
    to the viewport and pannable; legend panel scrollable.
- `js/main.js` — added `this.androidApi` (graph/time/loadFiles accessors) for
  the mobile layer.

## Local patches to the web app (beyond the shims)

- `js/graph_config.js` `getExampleGraphConfigs()` — added an early return when
  `flightLog` is null. Still unfixed upstream as of `master` `ad74f616`
  (2026-08-12 check), so the patch is still required. Fixes a pre-existing
  upstream crash on a fresh profile:
  at startup `prefs.get('graphConfig', …)` (main.js:857) calls this with no log
  loaded, throwing `Cannot read properties of undefined (reading
  'isFieldEnabled')`. On desktop it's masked by a previously-stored config.

## Upstream sync status

**Last checked: 2026-08-12 — the port is on the newest upstream code.**

| Upstream ref | Commit | Relationship to this port |
|---|---|---|
| `release/2.3.0` (newest release) | `b9635a97` | **the port's base** |
| `RF-2.3.x` (release branch) | `b9635a97` | identical to base |
| `master` (default branch) | `ad74f616` | code identical; base additionally has release notes |

Findings from the check:

- There is **no release newer than 2.3.0** (no 2.4.x tag or branch exists).
- `master` is *not* ahead in code. Its two unique commits ("Fix workspace
  selection list extending off the screen", "Make workspace selection list
  adapt to window height") were cherry-picked onto the release branch as
  `1e5f985` / `a66823e`. `git diff release/2.3.0 master` touches only
  `Releases.md` (89 lines of release notes) — **zero functional difference**.
- All 2.3.0 headline features are present and working in the port: firmware
  4.6.0 support, preset workspaces, seekbar PID-profile colour bands, and the
  battery cell-count fix (#68, an ancestor of the base).
- Fidelity audit of the vendored web app vs upstream: **105 files
  byte-identical, 3 modified** (exactly the documented patches below), and 35
  upstream files intentionally not vendored (CI workflows, `.idea/`, gulp build
  scripts, `library/` desktop ffmpeg binaries, docs, screenshots, tests,
  `package.json`/`yarn.lock`).

### Re-checking against upstream later

```sh
cd ..\app-src
git fetch --depth 300 origin master RF-2.3.x
git ls-remote --tags origin | grep -v '\^{}' | grep refs/tags/release   # newer release?
git diff --stat release/2.3.0 origin/master                             # code drift?
```

If a newer release appears, check out that tag in `..\app-src`, re-copy the
runtime directories into `app/src/main/assets/app/`, then re-apply the three
patches listed below (and re-generate `js/android_i18n_messages.js` from
`_locales/en/messages.json`). The `android_*.js` / `android_mobile.css` files
are additive and carry over untouched.

## Verified on-device

All on an Android 14 (API 34) emulator with the real `05-04-2026.BBL`.

Round 1 (versionCode 1–2): log parses (header: Omphobby M7 / Rotorflight
4.6.0-RC1 / STM32F7X2 / 4kHz-2kHz-SYNCED), gyro waveforms render in portrait
and landscape, fresh-profile startup is clean, pinch zoom / chrome collapse /
restore-after-process-death all exercised via CDP.

Round 2 (versionCode 3) — the paths that had never been exercised end-to-end:

| Path | How it was driven | Result |
|---|---|---|
| File chooser → restore cache | trusted CDP tap on the open button, then real DocumentsUI navigated with `uiautomator dump` + `input tap` | picker opened, log loaded, `cache/restore/05-04-2026.BBL` (876,800 B) + manifest written |
| Restore after process death | `am force-stop`, relaunch | `Restored last log: 05-04-2026.BBL` |
| CSV export | `.btn-csv-export` | `05-04-2026.BBL.csv`, 3,775,637 B / 12,469 lines, correct header block |
| Screenshot export | `makeScreenshot()` | `…-20260812-141911.png`, 225,889 B |
| Workspace export | `.btn-workspaces-export` | `workspaces.json`, 31,197 B |
| 3D craft model | device `screencap` | helicopter renders (previously an empty grey box) |

Note: exported screenshots show the craft panel blank — html2canvas cannot
capture a WebGL canvas. That is a limitation of the upstream screenshot
feature, not of the model rendering.

## Known differences vs the Windows app

- "Open in new window" does nothing (single-activity app).
- Update-check dialog links open in the phone browser.
- Video export renders in-memory (no streaming file writer); very long
  exports may hit memory limits.
- Debug builds enable `WebView.setWebContentsDebuggingEnabled` so the WebView
  is reachable from `chrome://inspect` (guarded to debuggable builds only).
