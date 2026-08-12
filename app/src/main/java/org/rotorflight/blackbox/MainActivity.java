package org.rotorflight.blackbox;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.webkit.WebViewAssetLoader;

import org.json.JSONArray;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;

public class MainActivity extends Activity {

    private static final String ASSET_HOST = "appassets.androidplatform.net";
    // The web app is served at the URL *root* (not under /assets/app/) because
    // parts of it reference resources with absolute paths — e.g.
    // csv-exporter.js does new Worker("/js/webworkers/csv-export-worker.js")
    // and craft_3d.js loads "/resources/models/bell_cw.gltf". Under NW.js the
    // app root is "/", so mirroring that keeps those paths working and avoids
    // patching upstream files.
    private static final String START_URL =
            "https://" + ASSET_HOST + "/index.html";
    private static final int REQUEST_FILE_CHOOSER = 1;

    private WebView webView;
    private ValueCallback<Uri[]> pendingFileChooser;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Allow chrome://inspect debugging of the WebView in debuggable builds.
        if ((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            WebView.setWebContentsDebuggingEnabled(true);
        }

        webView = new WebView(this);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setSupportZoom(true);
        settings.setBuiltInZoomControls(true);
        settings.setDisplayZoomControls(false);

        // Handlers are matched in registration order, so the specific
        // "/restore/" path must come before the catch-all "/" root handler.
        final WebViewAssetLoader.AssetsPathHandler assetsHandler =
                new WebViewAssetLoader.AssetsPathHandler(this);

        final WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
                // Serves the cached "last opened log" back to the web app so
                // it can restore state after the process was killed.
                .addPathHandler("/restore/", new WebViewAssetLoader.PathHandler() {
                    @Override
                    public WebResourceResponse handle(String path) {
                        try {
                            File dir = getRestoreDir();
                            File f = new File(dir, path);
                            if (!f.getCanonicalPath().startsWith(dir.getCanonicalPath())
                                    || !f.isFile()) {
                                return null;
                            }
                            return new WebResourceResponse(
                                    "application/octet-stream", null,
                                    new FileInputStream(f));
                        } catch (Exception e) {
                            return null;
                        }
                    }
                })
                // Maps the URL root onto assets/app/, so that both relative
                // ("js/main.js") and absolute ("/js/...") references resolve.
                .addPathHandler("/", new WebViewAssetLoader.PathHandler() {
                    @Override
                    public WebResourceResponse handle(String path) {
                        return assetsHandler.handle("app/" + path);
                    }
                })
                .build();

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view,
                                                              WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (ASSET_HOST.equals(url.getHost())) {
                    return false;
                }
                openExternalUri(url);
                return true;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view,
                                             ValueCallback<Uri[]> filePathCallback,
                                             FileChooserParams fileChooserParams) {
                if (pendingFileChooser != null) {
                    pendingFileChooser.onReceiveValue(null);
                }
                pendingFileChooser = filePathCallback;

                Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                // Blackbox logs (.BBL) have no registered MIME type, so accept
                // everything and let the web app validate the contents.
                intent.setType("*/*");
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                try {
                    startActivityForResult(
                            Intent.createChooser(intent, "Select blackbox log"),
                            REQUEST_FILE_CHOOSER);
                } catch (ActivityNotFoundException e) {
                    pendingFileChooser.onReceiveValue(null);
                    pendingFileChooser = null;
                    return false;
                }
                return true;
            }
        });

        webView.addJavascriptInterface(new AndroidBridge(), "Android");
        webView.loadUrl(START_URL);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode != REQUEST_FILE_CHOOSER) {
            super.onActivityResult(requestCode, resultCode, data);
            return;
        }
        if (pendingFileChooser == null) {
            return;
        }
        Uri[] results = null;
        if (resultCode == RESULT_OK && data != null) {
            if (data.getClipData() != null) {
                int count = data.getClipData().getItemCount();
                results = new Uri[count];
                for (int i = 0; i < count; i++) {
                    results[i] = data.getClipData().getItemAt(i).getUri();
                }
            } else if (data.getData() != null) {
                results = new Uri[]{data.getData()};
            }
        }
        pendingFileChooser.onReceiveValue(results);
        pendingFileChooser = null;

        if (results != null) {
            final Uri[] chosen = results;
            new Thread(new Runnable() {
                @Override
                public void run() {
                    cacheLogsForRestore(chosen);
                }
            }).start();
        }
    }

    /* ------------------------------------------------------------------ *
     * Last-log persistence: copies the log files the user opens into the
     * app cache so the web app can reload them after process death.
     * ------------------------------------------------------------------ */

    private static final List<String> RESTORABLE_EXTENSIONS = Arrays.asList(
            "bbl", "bfl", "cfl", "txt", "log", "json");
    private static final long MAX_RESTORE_FILE_BYTES = 256L * 1024 * 1024;

    private File getRestoreDir() {
        File dir = new File(getCacheDir(), "restore");
        if (!dir.exists()) {
            dir.mkdirs();
        }
        return dir;
    }

    private String queryDisplayName(Uri uri) {
        try (android.database.Cursor c = getContentResolver().query(uri,
                new String[]{android.provider.OpenableColumns.DISPLAY_NAME},
                null, null, null)) {
            if (c != null && c.moveToFirst()) {
                String name = c.getString(0);
                if (name != null && !name.isEmpty()) {
                    return name;
                }
            }
        } catch (Exception ignored) {
        }
        String last = uri.getLastPathSegment();
        return last == null ? "log.bbl" : last;
    }

    private void cacheLogsForRestore(Uri[] uris) {
        try {
            File dir = getRestoreDir();
            File[] old = dir.listFiles();
            if (old != null) {
                for (File f : old) {
                    f.delete();
                }
            }

            List<String> saved = new ArrayList<>();
            for (Uri uri : uris) {
                String name = queryDisplayName(uri)
                        .replaceAll("[\\\\/:*?\"<>|]", "_");
                int dot = name.lastIndexOf('.');
                String ext = dot < 0 ? ""
                        : name.substring(dot + 1).toLowerCase(Locale.ROOT);
                if (!RESTORABLE_EXTENSIONS.contains(ext)) {
                    continue; // skip videos and other large media
                }
                File out = new File(dir, name);
                long total = 0;
                try (InputStream in = getContentResolver().openInputStream(uri);
                     FileOutputStream os = new FileOutputStream(out)) {
                    byte[] buf = new byte[65536];
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        total += n;
                        if (total > MAX_RESTORE_FILE_BYTES) {
                            throw new IllegalStateException("file too large");
                        }
                        os.write(buf, 0, n);
                    }
                    saved.add(name);
                } catch (Exception e) {
                    out.delete();
                }
            }

            JSONArray json = new JSONArray();
            for (String name : saved) {
                json.put(name);
            }
            getSharedPreferences("restore", MODE_PRIVATE).edit()
                    .putString("names", json.toString()).apply();
        } catch (Exception ignored) {
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    private void openExternalUri(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException ignored) {
        }
    }

    private class AndroidBridge {

        @JavascriptInterface
        public void openExternal(String url) {
            openExternalUri(Uri.parse(url));
        }

        /**
         * Returns a JSON array of cached log file names available for
         * restore, e.g. ["05-04-2026.BBL"]. The web app fetches each one
         * from https://appassets.androidplatform.net/restore/<name>.
         */
        @JavascriptInterface
        public String getRestoreManifest() {
            try {
                String raw = getSharedPreferences("restore", MODE_PRIVATE)
                        .getString("names", "[]");
                JSONArray stored = new JSONArray(raw);
                JSONArray existing = new JSONArray();
                File dir = getRestoreDir();
                for (int i = 0; i < stored.length(); i++) {
                    String name = stored.getString(i);
                    if (new File(dir, name).isFile()) {
                        existing.put(name);
                    }
                }
                return existing.toString();
            } catch (Exception e) {
                return "[]";
            }
        }

        @JavascriptInterface
        public void saveFile(String filename, String mimeType, String base64Data) {
            final String safeName = filename == null ? "download.bin"
                    : filename.replaceAll("[\\\\/:*?\"<>|]", "_");
            try {
                byte[] bytes = Base64.decode(base64Data, Base64.DEFAULT);

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.Downloads.DISPLAY_NAME, safeName);
                    values.put(MediaStore.Downloads.MIME_TYPE,
                            mimeType == null || mimeType.isEmpty()
                                    ? "application/octet-stream" : mimeType);
                    Uri uri = getContentResolver().insert(
                            MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                    if (uri == null) {
                        throw new IllegalStateException("MediaStore insert failed");
                    }
                    try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                        out.write(bytes);
                    }
                    toast("Saved " + safeName + " to Downloads");
                } else {
                    File dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                    File outFile = new File(dir, safeName);
                    try (FileOutputStream out = new FileOutputStream(outFile)) {
                        out.write(bytes);
                    }
                    toast("Saved to " + outFile.getAbsolutePath());
                }
            } catch (Exception e) {
                toast("Save failed: " + e.getMessage());
            }
        }

        private void toast(final String message) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    Toast.makeText(MainActivity.this, message, Toast.LENGTH_LONG).show();
                }
            });
        }
    }
}
