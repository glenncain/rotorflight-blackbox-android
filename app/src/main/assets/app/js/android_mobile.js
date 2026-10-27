/**
 * Android mobile UX layer for Rotorflight Blackbox Explorer.
 *
 * Loaded last from index.html. Uses window.blackboxLogViewer.androidApi
 * (added as a local patch in js/main.js) and the native `Android` bridge.
 *
 * Features:
 *  - Restores the last opened log after the app process is recreated.
 *  - Floating button that collapses/restores all UI chrome around the graph.
 *  - Two-finger pinch zoom on the main graph, anchored at the pinch point.
 *  - Touch placement of the analyser's frequency/RPM marker line.
 *  - IN / OUT buttons for the I / O keyboard marks.
 */
(function () {
    'use strict';

    // Mirror of WINDOW_WIDTH_MICROS_DEFAULT in grapher.js: windowWidthMicros
    // = DEFAULT / zoom, so zoom = DEFAULT / windowWidthMicros.
    var WINDOW_WIDTH_MICROS_DEFAULT = 1000000;
    var ZOOM_MIN = 0.1;   // matches the 10% end of the zoom control
    var ZOOM_MAX = 10.0;  // matches the 1000% end of the zoom control

    function api() {
        return window.blackboxLogViewer && window.blackboxLogViewer.androidApi;
    }

    /* ------------------------------------------------------------------ *
     * 1) Restore the last opened log after process death.
     * ------------------------------------------------------------------ */
    function tryRestoreLastLog() {
        var a = api();
        if (!a || a.hasLog()) {
            return;
        }
        if (!(window.Android && window.Android.getRestoreManifest)) {
            return;
        }
        var names;
        try {
            names = JSON.parse(window.Android.getRestoreManifest() || '[]');
        } catch (e) {
            names = [];
        }
        if (!names.length) {
            return;
        }
        Promise.all(names.map(function (name) {
            return fetch('/restore/' + encodeURIComponent(name))
                .then(function (r) {
                    if (!r.ok) {
                        throw new Error('restore fetch ' + r.status);
                    }
                    return r.arrayBuffer();
                })
                .then(function (buf) {
                    return new File([buf], name);
                });
        })).then(function (files) {
            var a2 = api();
            if (a2 && !a2.hasLog() && files.length) {
                a2.loadFiles(files);
                console.log('Restored last log: ' + files.map(function (f) {
                    return f.name;
                }).join(', '));
            }
        }).catch(function (e) {
            console.log('Log restore failed: ' + e);
        });
    }

    /* ------------------------------------------------------------------ *
     * 4) Collapsible chrome.
     * ------------------------------------------------------------------ */
    var toggleButton = null;

    /* ------------------------------------------------------------------ *
     * Graph area sizing. Upstream pins .graph-row with hard-coded offsets
     * (top: 100px / bottom: 80px, and 86px via an !important media rule)
     * that assume desktop-sized bars. Since the bars are now compact — and
     * vanish entirely in collapsed mode — measure what is actually on
     * screen and set the offsets to match, rather than guessing in CSS.
     * ------------------------------------------------------------------ */
    var lastOffsets = '';

    function visibleHeight(selector) {
        var el = document.querySelector(selector);
        if (!el || getComputedStyle(el).display === 'none') {
            return 0;
        }
        return el.getBoundingClientRect().height;
    }

    function layoutGraphRow() {
        var row = document.querySelector('.graph-row');
        if (!row || getComputedStyle(row).display === 'none') {
            return;
        }
        var top = visibleHeight('nav.navbar') + visibleHeight('.video-top-controls');
        var bottom = visibleHeight('.log-seek-bar') + visibleHeight('#status-bar');

        top = Math.round(top);
        bottom = Math.round(bottom);
        var key = top + ':' + bottom;
        if (key === lastOffsets) {
            return; // nothing changed; avoid a resize feedback loop
        }
        lastOffsets = key;

        row.style.setProperty('top', top + 'px', 'important');
        row.style.setProperty('bottom', bottom + 'px', 'important');
        row.style.setProperty('left', '0', 'important');
        row.style.setProperty('width', '100%', 'important');

        // The app only recomputes canvas sizes on window resize.
        window.dispatchEvent(new Event('resize'));
    }

    function setupChromeToggle() {
        toggleButton = document.createElement('div');
        toggleButton.id = 'mobileChromeToggle';
        toggleButton.textContent = '⛶'; // ⛶ square four corners
        toggleButton.setAttribute('title', 'Toggle full-screen graph');
        toggleButton.addEventListener('click', function () {
            var collapsed = document.body.classList.toggle('chrome-collapsed');
            toggleButton.setAttribute('title', collapsed
                ? 'Show controls and legend' : 'Full-screen graph');
            // Let the class take effect, then re-measure.
            setTimeout(layoutGraphRow, 60);
        });
        document.body.appendChild(toggleButton);

        // Only meaningful once a log view is active; poll cheaply. The poll
        // also keeps the graph offsets correct if the app changes the bars
        // (e.g. a log with video shows extra controls).
        setInterval(function () {
            var a = api();
            var show = !!(a && a.hasLog());
            toggleButton.style.display = show ? 'block' : 'none';
            if (!show && document.body.classList.contains('chrome-collapsed')) {
                document.body.classList.remove('chrome-collapsed');
            }
            layoutGraphRow();
        }, 1000);

        window.addEventListener('resize', function () {
            setTimeout(layoutGraphRow, 0);
        });
        window.addEventListener('orientationchange', function () {
            setTimeout(layoutGraphRow, 250);
        });
    }

    /* ------------------------------------------------------------------ *
     * Tooltips. Upstream initialises them with trigger:"hover", and a
     * touchscreen delivers the synthetic mouse-enter but never the matching
     * mouse-out — so a tapped button leaves its tooltip parked over the
     * graph. Auto-hide them, and drop any that are still up on the next
     * touch anywhere.
     * ------------------------------------------------------------------ */
    var TOOLTIP_LINGER_MS = 1800;

    function hideAllTooltips() {
        if (!window.jQuery) {
            return;
        }
        try {
            jQuery('[data-toggle="tooltip"]').tooltip('hide');
        } catch (e) { /* tooltips may not be initialised yet */ }
    }

    function setupTooltipDismiss() {
        if (!window.jQuery) {
            return;
        }
        jQuery(document).on('shown.bs.tooltip', function (e) {
            var el = e.target;
            setTimeout(function () {
                try {
                    jQuery(el).tooltip('hide');
                } catch (err) { /* element may be gone */ }
            }, TOOLTIP_LINGER_MS);
        });

        // Capture phase: runs before Bootstrap re-shows one for the element
        // actually being touched, so that tooltip still appears normally.
        document.addEventListener('touchstart', hideAllTooltips, true);
    }

    /* ------------------------------------------------------------------ *
     * 6) Pinch zoom on the main graph, anchored at the pinch centroid.
     *
     * grapher.js already implements one-finger touch seeking. We claim the
     * gesture as soon as a second finger lands: capture-phase listeners on
     * .log-graph stop the event from reaching grapher's handlers, and a
     * synthetic touchend releases its document-level move tracking.
     * ------------------------------------------------------------------ */
    var pinch = null;

    function touchDist(touches) {
        var dx = touches[0].clientX - touches[1].clientX;
        var dy = touches[0].clientY - touches[1].clientY;
        return Math.sqrt(dx * dx + dy * dy) || 1;
    }

    function touchCentroidX(touches) {
        return (touches[0].clientX + touches[1].clientX) / 2;
    }

    function setupPinchZoom() {
        var logGraph = document.querySelector('.log-graph');
        var canvas = document.getElementById('graphCanvas');
        if (!logGraph || !canvas) {
            return;
        }

        logGraph.addEventListener('touchstart', function (e) {
            var a = api();
            if (e.touches.length !== 2 || !a || !a.hasLog() || !a.getGraph()) {
                return;
            }
            e.stopPropagation();
            e.preventDefault();

            // Release grapher.js's one-finger seek tracking.
            document.dispatchEvent(new Event('touchend'));

            var graph = a.getGraph();
            var rect = canvas.getBoundingClientRect();
            var w0 = graph.getWindowWidthTime();
            var cx = touchCentroidX(e.touches);
            var centerX = rect.left + rect.width / 2;

            pinch = {
                dist0: touchDist(e.touches),
                w0: w0,
                rect: rect,
                // Blackbox time currently under the pinch centroid; kept
                // stationary while zooming.
                tCentroid: a.getCurrentTime() + (cx - centerX) / rect.width * w0,
            };
        }, true);

        logGraph.addEventListener('touchmove', function (e) {
            if (!pinch || e.touches.length !== 2) {
                return;
            }
            e.stopPropagation();
            e.preventDefault();

            var a = api();
            if (!a || !a.getGraph()) {
                pinch = null;
                return;
            }

            var scale = touchDist(e.touches) / pinch.dist0;
            var zoom = WINDOW_WIDTH_MICROS_DEFAULT / (pinch.w0 / scale);
            zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
            var newWindow = WINDOW_WIDTH_MICROS_DEFAULT / zoom;

            a.getGraph().setGraphZoom(zoom);

            var cx = touchCentroidX(e.touches);
            var centerX = pinch.rect.left + pinch.rect.width / 2;
            var newTime = pinch.tCentroid - (cx - centerX) / pinch.rect.width * newWindow;
            a.setCurrentTime(newTime);
        }, true);

        function endPinch(e) {
            if (pinch && e.touches.length < 2) {
                pinch = null;
                e.stopPropagation();
            }
        }
        logGraph.addEventListener('touchend', endPinch, true);
        logGraph.addEventListener('touchcancel', endPinch, true);
    }

    /* ------------------------------------------------------------------ *
     * Analyser frequency marker. Upstream draws the movable green
     * frequency/RPM line (plus its 2x-4x harmonics) only while Shift is held
     * during a mouse move (graph_spectrum.js trackFrequency). Its touchmove
     * binding goes through the same Shift check, and would read clientX off
     * the TouchEvent itself, so on a touchscreen the line can never be
     * placed. Drive it from the touch position instead: tap or drag a finger
     * across the analyser.
     *
     * No preventDefault on touchstart: the analyser's toolbar (spectrum type,
     * filters, enlarge) is revealed by .analyser:hover, which on a
     * touchscreen comes from the emulated mouse events a tap produces.
     *
     * That toolbar sits over the top of the plot, exactly where the marker's
     * "Hz (rpm)" readout and the filter labels are drawn. Upstream hides it
     * while Shift is held; here placing the marker hides it (class
     * .android-marker-mode), and it stays hidden so the readout can be read
     * after lifting the finger. A touch in the top strip, where the toolbar
     * lives, brings it back instead of moving the marker.
     * ------------------------------------------------------------------ */
    var ANALYSER_TOOLBAR_STRIP_PX = 24;

    function setupAnalyserTouch() {
        var canvas = document.getElementById('analyserCanvas');
        var analyserElem = document.getElementById('analyser');
        if (!canvas || !analyserElem || !window.GraphSpectrumPlot) {
            return;
        }
        var toolbarGesture = false;

        function placeMarker(e) {
            if (e.touches.length !== 1) {
                return false;
            }
            var a = api();
            var graph = a && a.getGraph();
            var analyser = graph && graph.getAnalyser && graph.getAnalyser();
            if (!analyser) {
                return false;
            }
            var rect = canvas.getBoundingClientRect();
            GraphSpectrumPlot.setMousePosition(
                e.touches[0].clientX - rect.left,
                e.touches[0].clientY - rect.top);
            analyser.refresh();
            return true;
        }

        canvas.addEventListener('touchstart', function (e) {
            var rect = canvas.getBoundingClientRect();
            toolbarGesture = e.touches.length === 1 &&
                e.touches[0].clientY - rect.top < ANALYSER_TOOLBAR_STRIP_PX;
            if (toolbarGesture) {
                analyserElem.classList.remove('android-marker-mode');
            } else if (placeMarker(e)) {
                analyserElem.classList.add('android-marker-mode');
            }
        });
        canvas.addEventListener('touchmove', function (e) {
            if (!toolbarGesture && placeMarker(e)) {
                e.preventDefault();
            }
        });
    }

    /* ------------------------------------------------------------------ *
     * In / Out marks. Upstream sets them only with the I and O keys; they
     * bound the analyser's sample window and the video export range.
     * Add IN / OUT buttons to the Playback group for touch.
     * ------------------------------------------------------------------ */
    function setupInOutButtons() {
        var group = document.querySelector('.log-playback-panel .btn-group');
        if (!group) {
            return;
        }
        var marks = document.createElement('div');
        marks.className = 'btn-group android-inout';
        marks.setAttribute('role', 'group');
        [['IN', 'toggleInTime', 'Mark the start (IN) of the analyser / video export range here; tap again at the same time to clear (key I)'],
         ['OUT', 'toggleOutTime', 'Mark the end (OUT) of the analyser / video export range here; tap again at the same time to clear (key O)']]
            .forEach(function (def) {
                var btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'btn btn-default';
                btn.textContent = def[0];
                btn.title = def[2];
                btn.addEventListener('click', function () {
                    var a = api();
                    if (a && a.hasLog() && a[def[1]]) {
                        a[def[1]]();
                    }
                });
                marks.appendChild(btn);
            });
        group.parentNode.appendChild(marks);
    }

    /* ------------------------------------------------------------------ */
    document.addEventListener('DOMContentLoaded', function () {
        setupChromeToggle();
        setupPinchZoom();
        setupTooltipDismiss();
        setupAnalyserTouch();
        setupInOutButtons();
    });

    window.addEventListener('load', function () {
        // Give the app's own deferred startup (storage callbacks, workspace
        // restore) a moment to settle before re-injecting the last log.
        setTimeout(tryRestoreLastLog, 700);
    });
})();
