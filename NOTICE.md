# Attribution

This project is an **Android WebView wrapper** around the Rotorflight Blackbox
Explorer web application.

- **Upstream:** [rotorflight/rotorflight-blackbox](https://github.com/rotorflight/rotorflight-blackbox),
  tag `release/2.3.0` (commit `b9635a975e95159faf1bf7b5efc4ce7cd93a2b37`),
  © The Rotorflight open source project. Verified current on 2026-08-12.
- **License:** GPL-3.0 (see `LICENSE`). Because the bundled web app is
  GPL-3.0, this wrapper and any redistribution of it are also GPL-3.0.

## What was added on top of upstream

The Android-specific code and the small patches to the web app are documented
in `README.md`. In summary:

- `app/src/main/java/org/rotorflight/blackbox/MainActivity.java` — the native
  Android host (WebView + file chooser + save/restore bridges).
- `app/src/main/assets/app/js/android_shim.js` — NW.js/Chrome API shims.
- `app/src/main/assets/app/js/android_mobile.js` +
  `app/src/main/assets/app/css/android_mobile.css` — mobile UX layer.
- `app/src/main/assets/app/js/android_i18n_messages.js` — embedded locale.
- Minimal edits to `index.html`, `js/main.js`, and `js/graph_config.js`.

The four vendored runtime libraries under `app/.../node_modules/` retain their
own licenses (Bootstrap: MIT; Lodash: MIT; html2canvas: MIT; webm-writer: WTFPL/
MIT). Only their runtime `dist` builds are included.
