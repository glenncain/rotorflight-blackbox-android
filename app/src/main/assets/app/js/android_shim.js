/**
 * Android WebView compatibility shim for Rotorflight Blackbox Explorer.
 *
 * The desktop app runs under NW.js, which provides require('nw.gui'),
 * chrome.storage.local, chrome.i18n, and chrome.runtime. None of these exist
 * in an Android WebView, so this file emulates the subset the app uses.
 * It must be loaded before every other script in index.html.
 */
(function () {
    'use strict';

    /* ------------------------------------------------------------------ *
     * Viewport. index.html ships "width=740" so the desktop layout fits a
     * phone screen. On a tablet that forced width gets scaled UP to fill
     * the display (e.g. 1280dp / 740 = 1.7x), which is why every bar and
     * label looks oversized there. Tablets have room for the real layout,
     * so use their native width instead — no magnification, more graph,
     * and upstream's own >1020px styles apply.
     * ------------------------------------------------------------------ */
    (function adaptViewport() {
        var meta = document.querySelector('meta[name="viewport"]');
        if (!meta || !window.screen) {
            return;
        }
        var shortEdge = Math.min(screen.width || 0, screen.height || 0);
        if (shortEdge >= 600) { // Android's own tablet threshold (sw600dp)
            meta.setAttribute('content', 'width=device-width');
        }
    })();

    /* ------------------------------------------------------------------ *
     * require('nw.gui') stub — multi-window and file-association features
     * do not apply on Android, but the calls must not throw.
     * ------------------------------------------------------------------ */
    var nwWindowStub = {
        on: function () {},
        maximize: function () {},
        minimize: function () {},
        restore: function () {},
        focus: function () {},
        close: function () {},
        zoomLevel: 0,
    };

    var nwGuiStub = {
        App: {
            argv: [],
            on: function () {},
            quit: function () {},
        },
        Window: {
            open: function () {},
            get: function () { return nwWindowStub; },
        },
        Shell: {
            openExternal: function (url) { openExternally(url); },
            openItem: function () {},
        },
    };

    window.require = window.require || function (name) {
        if (name === 'nw.gui') {
            return nwGuiStub;
        }
        throw new Error('Module not available in Android WebView: ' + name);
    };

    /* ------------------------------------------------------------------ *
     * chrome.* emulation
     * ------------------------------------------------------------------ */
    window.chrome = window.chrome || {};

    // chrome.storage.local backed by localStorage. Note: chrome.fileSystem is
    // deliberately NOT defined so the app takes its in-memory blob fallbacks.
    //
    // Callbacks are deferred until after DOMContentLoaded: with real
    // chrome.storage the IPC round-trip means callbacks always arrive after
    // the app's $(document).ready initialization, and main.js relies on that
    // ordering (e.g. workspaceSelection must exist before onSwitchWorkspace
    // runs). Firing callbacks too early breaks startup.
    var STORAGE_PREFIX = 'chrome_storage.';

    var domReady = false;
    var readyQueue = [];
    document.addEventListener('DOMContentLoaded', function () {
        // One extra tick so jQuery's own ready handlers run first.
        setTimeout(function () {
            domReady = true;
            var queue = readyQueue;
            readyQueue = [];
            queue.forEach(function (fn) { fn(); });
        }, 0);
    });

    function deferCallback(fn) {
        if (domReady) {
            setTimeout(fn, 0);
        } else {
            readyQueue.push(fn);
        }
    }

    function storageGet(keys, callback) {
        var result = {};
        var names;
        if (typeof keys === 'string') {
            names = [keys];
        } else if (Array.isArray(keys)) {
            names = keys;
        } else if (keys && typeof keys === 'object') {
            names = Object.keys(keys);
            names.forEach(function (name) {
                if (keys[name] !== undefined) {
                    result[name] = keys[name]; // defaults
                }
            });
        } else {
            names = [];
            for (var i = 0; i < localStorage.length; i++) {
                var k = localStorage.key(i);
                if (k.indexOf(STORAGE_PREFIX) === 0) {
                    names.push(k.substring(STORAGE_PREFIX.length));
                }
            }
        }
        names.forEach(function (name) {
            var raw = localStorage.getItem(STORAGE_PREFIX + name);
            if (raw !== null) {
                try {
                    result[name] = JSON.parse(raw);
                } catch (e) { /* ignore corrupt entry */ }
            }
        });
        if (callback) {
            deferCallback(function () { callback(result); });
        }
    }

    function storageSet(items, callback) {
        Object.keys(items).forEach(function (name) {
            localStorage.setItem(STORAGE_PREFIX + name, JSON.stringify(items[name]));
        });
        if (callback) {
            deferCallback(callback);
        }
    }

    function storageRemove(keys, callback) {
        (typeof keys === 'string' ? [keys] : keys).forEach(function (name) {
            localStorage.removeItem(STORAGE_PREFIX + name);
        });
        if (callback) {
            deferCallback(callback);
        }
    }

    window.chrome.storage = window.chrome.storage || {
        local: {
            get: storageGet,
            set: storageSet,
            remove: storageRemove,
            clear: function (callback) {
                for (var i = localStorage.length - 1; i >= 0; i--) {
                    var k = localStorage.key(i);
                    if (k.indexOf(STORAGE_PREFIX) === 0) {
                        localStorage.removeItem(k);
                    }
                }
                if (callback) {
                    deferCallback(callback);
                }
            },
        },
    };

    // chrome.runtime — getManifest() feeds the version shown in the UI and
    // the update checker.
    window.chrome.runtime = window.chrome.runtime || {
        getManifest: function () {
            return {
                name: 'Rotorflight Blackbox',
                version: '2.3.0',
                version_name: '2.3.0',
            };
        },
    };

    // chrome.i18n — messages are embedded at build time by
    // js/android_i18n_messages.js (window.__i18nMessages).
    function getMessage(messageID, substitutions) {
        var messages = window.__i18nMessages || {};
        var entry = messages[messageID];
        if (!entry || typeof entry.message !== 'string') {
            return messageID;
        }
        var text = entry.message;
        var subs = substitutions == null ? [] :
            (Array.isArray(substitutions) ? substitutions : [substitutions]);

        function expand(content) {
            return String(content).replace(/\$(\d)/g, function (m, n) {
                var v = subs[parseInt(n, 10) - 1];
                return v == null ? '' : String(v);
            });
        }

        if (entry.placeholders) {
            Object.keys(entry.placeholders).forEach(function (key) {
                var value = expand(entry.placeholders[key].content);
                text = text.split('$' + key.toUpperCase() + '$').join(value);
            });
        }
        return expand(text);
    }

    window.chrome.i18n = window.chrome.i18n || { getMessage: getMessage };

    /* ------------------------------------------------------------------ *
     * External links — open in the system browser via the Android bridge.
     * ------------------------------------------------------------------ */
    function openExternally(url) {
        if (window.Android && window.Android.openExternal) {
            window.Android.openExternal(String(url));
        }
    }

    var originalWindowOpen = window.open;
    window.open = function (url) {
        if (url && /^https?:/i.test(url) &&
                String(url).indexOf('appassets.androidplatform.net') === -1) {
            openExternally(url);
            return null;
        }
        return originalWindowOpen ? originalWindowOpen.apply(window, arguments) : null;
    };

    /* ------------------------------------------------------------------ *
     * Saving files. Two separate paths in the app both end up here:
     *
     *  1. saveAs() — FileSaver.js defers to a pre-existing saveAs, and the
     *     video renderer calls window.saveAs directly.
     *  2. A detached "<a download href='blob:|data:'>" that gets a synthetic
     *     click (CSV export, workspace save, screenshots). Android WebView
     *     drops those downloads silently — there is no DownloadListener for
     *     blob: URLs — so they are intercepted below.
     *
     * Everything lands in the phone's Downloads folder via Android.saveFile.
     * ------------------------------------------------------------------ */
    function saveBlob(blob, filename) {
        if (!(window.Android && window.Android.saveFile)) {
            return;
        }
        var reader = new FileReader();
        reader.onloadend = function () {
            var result = String(reader.result);
            var base64 = result.substring(result.indexOf(',') + 1);
            window.Android.saveFile(
                filename || 'download.bin',
                blob.type || 'application/octet-stream',
                base64
            );
        };
        reader.readAsDataURL(blob);
    }

    window.saveAs = saveBlob;

    // Anchor-download interception. The anchors are never added to the
    // document, so a listener on document/body would never see the event —
    // it has to be attached to the element itself, hence wrapping
    // createElement. Note the app's synthetic click is created with
    // cancelable=false, so preventDefault() is not an option; we simply do
    // the save ourselves and let the (no-op) native attempt fail quietly.
    var nativeCreateElement = document.createElement;
    document.createElement = function (tagName) {
        var el = nativeCreateElement.apply(document, arguments);
        try {
            if (String(tagName).toLowerCase() === 'a') {
                el.addEventListener('click', function () {
                    var name = el.download;
                    var href = el.getAttribute('href') || '';
                    if (!name || !/^(blob|data):/i.test(href)) {
                        return;
                    }
                    fetch(href)
                        .then(function (r) { return r.blob(); })
                        .then(function (b) { saveBlob(b, name); })
                        .catch(function (e) {
                            console.log('Download interception failed: ' + e);
                        });
                }, true);
            }
        } catch (e) { /* never let this break element creation */ }
        return el;
    };
})();
