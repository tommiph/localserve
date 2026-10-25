package org.localserve.go;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.KeyEvent;
import android.view.Surface;
import android.view.SurfaceHolder;
import android.view.SurfaceView;
import android.view.View;
import android.view.WindowManager;
import android.widget.TextView;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Native Oculus Go library client. Package effects require explicit confirmation. */
public class MainActivity extends Activity implements SurfaceHolder.Callback {
    static { System.loadLibrary("vrapi"); System.loadLibrary("localserve_go"); }
    native void nativeStart(Surface surface);
    native void nativeStop();
    native void nativeBitmap(Bitmap bitmap);
    native void nativeRecenter();
    native int nativeFrames();

    final Handler main = new Handler(Looper.getMainLooper());
    final ExecutorService network = Executors.newFixedThreadPool(3);
    final NetApi api = new NetApi();
    final List<LibraryItem> apps = new ArrayList<>();
    final Map<String, Integer> installed = new HashMap<>();
    final Set<String> pendingArt = Collections.synchronizedSet(new HashSet<>());
    final Set<String> missingArt = new HashSet<>();
    final android.util.LruCache<String, Bitmap> art = new android.util.LruCache<String, Bitmap>(24 * 1024 * 1024) {
        @Override protected int sizeOf(String key, Bitmap value) { return value.getByteCount(); }
    };
    ConnectionSettings connectionSettings;
    volatile NetApi.Session session;
    GoScreen screen;
    Surface surface;
    volatile boolean destroyed;
    boolean resumed, vrRunning, loading, online, pollBusy, requestPending;
    volatile int connectionGeneration;
    int page, versionIndex, menuPage;
    float pointerX = -1, pointerY = -1;
    String tab = "Library", filter = "Installed", query = "", genre = "All genres", sort = "A–Z";
    String favoriteFilter = "All";
    String message = "Connect to Sormus to load your collection.";
    String inputMode = "", menu = "", addressDraft = "", codeDraft = "";
    LibraryItem selected;
    Confirmation confirmation;
    JSONObject job;

    static final class Confirmation {
        final String operation, title, packageName;
        final LibraryItem.Version version;
        final NetApi.Session session;
        String token = "";
        boolean checking, submitted;
        Confirmation(String operation, LibraryItem app, LibraryItem.Version version, NetApi.Session session) {
            this.operation = operation; title = app.title; packageName = app.packageName;
            this.version = version; this.session = session;
        }
    }

    final Runnable poll = new Runnable() {
        @Override public void run() {
            if (destroyed || !resumed) return;
            pollJob();
            main.postDelayed(this, 3000);
        }
    };

    @Override public void onCreate(Bundle savedState) {
        super.onCreate(savedState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().getDecorView().setSystemUiVisibility(5894);
        connectionSettings = new ConnectionSettings(this);
        filter = connectionSettings.preferences().getString("filter", "Installed");
        sort = connectionSettings.preferences().getString("sort", "A–Z");
        try { session = connectionSettings.load(); }
        catch (Exception error) { message = "Connection could not be unlocked. Connect again in Settings."; }
        if (session == null) tab = "Settings";
        else {
            addressDraft = session.base.replace("http://", "");
            try (FileInputStream input = new FileInputStream(new File(getFilesDir(), "catalog.json"))) {
                loadCatalog(new JSONObject(new String(NetApi.read(input, 8 * 1024 * 1024), "UTF-8")));
                message = "Saved collection · connecting to Sormus…";
            } catch (Exception ignored) { /* A missing cache leaves an empty collection. */ }
        }
        refreshInstalled();
        screen = new GoScreen(this);
        SurfaceView view = new SurfaceView(this);
        view.getHolder().addCallback(this);
        setContentView(view);
    }

    @Override protected void onResume() {
        super.onResume(); resumed = true; startVR(); refreshInstalled();
        main.removeCallbacks(poll); main.post(poll);
        render();
        if (session != null) refresh();
    }

    @Override protected void onPause() {
        resumed = false; main.removeCallbacks(poll); stopVR(); super.onPause();
    }

    @Override protected void onDestroy() {
        destroyed = true; main.removeCallbacks(poll); stopVR(); api.cancelReads(); network.shutdownNow();
        super.onDestroy();
    }

    @Override public void surfaceCreated(SurfaceHolder holder) { surface = holder.getSurface(); startVR(); }
    @Override public void surfaceChanged(SurfaceHolder holder, int format, int width, int height) { surface = holder.getSurface(); startVR(); }
    @Override public void surfaceDestroyed(SurfaceHolder holder) { stopVR(); surface = null; }
    void startVR() {
        if (resumed && surface != null && surface.isValid() && !vrRunning) { vrRunning = true; nativeStart(surface); }
    }
    void stopVR() { if (vrRunning) { nativeStop(); vrRunning = false; } }

    public void onNativeError(String error) {
        main.post(() -> {
            if (destroyed) return;
            TextView fallback = new TextView(this);
            fallback.setText("Sormus\n\n" + error);
            fallback.setTextColor(0xffe8f6ff); fallback.setBackgroundColor(0xff070d1b);
            fallback.setTextSize(24); fallback.setPadding(60, 60, 60, 60); setContentView(fallback);
        });
    }

    public void onNativeInput(float x, float y, int actions) {
        main.post(() -> {
            if (destroyed || !resumed) return;
            pointerX = x; pointerY = y;
            if ((actions & 2) != 0) { back(); return; }
            if ((actions & 4) != 0 || (actions & 8) != 0) {
                if (confirmation == null && inputMode.isEmpty() && menu.isEmpty() && selected == null) page += (actions & 4) != 0 ? 1 : -1;
                render(); return;
            }
            GoScreen.Hit hit = screen.hit(x, y);
            String identity = hit == null ? "" : hit.label;
            boolean changed = !identity.equals(screen.hoverLabel);
            screen.hoverLabel = identity;
            if ((actions & 1) != 0 && hit != null) { hit.action.run(); render(); }
            else if (changed) render();
        });
    }

    @Override public boolean onKeyDown(int key, KeyEvent event) {
        if (key == KeyEvent.KEYCODE_BACK) { back(); return true; }
        if (key == KeyEvent.KEYCODE_DPAD_CENTER || key == KeyEvent.KEYCODE_BUTTON_A) {
            if (event.getRepeatCount() == 0) { GoScreen.Hit hit = screen.hit(pointerX, pointerY); if (hit != null) hit.action.run(); render(); }
            return true;
        }
        return super.onKeyDown(key, event);
    }

    void back() {
        if (!inputMode.isEmpty()) inputMode = "";
        else if (!menu.isEmpty()) menu = "";
        else if (confirmation != null) {
            boolean submitted = confirmation.submitted; confirmation = null;
            if (submitted) tab = "Activity";
        } else if (selected != null) selected = null;
        else { tab = "Library"; page = 0; }
        render();
    }

    void navigate(String value) {
        tab = value; selected = null; menu = ""; inputMode = ""; page = 0;
        if (value.equals("Library")) refreshInstalled();
        render();
    }
    void render() { if (!destroyed && screen != null) { screen.draw(); if (vrRunning) nativeBitmap(screen.bitmap); } }
    void status(String value) { message = value; render(); }
    boolean current(NetApi.Session captured) { return !destroyed && session == captured; }
    boolean busy() {
        String state = job == null ? "" : job.optString("state");
        return requestPending || state.equals("Preparing") || state.equals("Installing") || state.equals("Removing");
    }
    int installedVersion(String packageName) { Integer value = installed.get(packageName); return value == null ? -1 : value; }
    void refreshInstalled() {
        installed.clear();
        for (PackageInfo info : getPackageManager().getInstalledPackages(0)) installed.put(info.packageName, info.versionCode);
    }
    Set<String> favorites() { return new HashSet<>(connectionSettings.preferences().getStringSet("favorites", Collections.emptySet())); }
    void toggleFavorite(LibraryItem item) {
        Set<String> values = favorites(); if (!values.remove(item.packageName)) values.add(item.packageName);
        connectionSettings.preferences().edit().putStringSet("favorites", values).apply(); render();
    }
    List<LibraryItem> visibleApps() {
        List<LibraryItem> values = new ArrayList<>(); Set<String> favorites = favorites();
        String effectiveFilter = currentFilter();
        for (LibraryItem item : apps) {
            int version = installedVersion(item.packageName);
            if (!query.isEmpty() && !(item.title + " " + item.packageName + " " + item.tags).toLowerCase(Locale.ROOT).contains(query.toLowerCase(Locale.ROOT))) continue;
            if (!genre.equals("All genres") && !item.tags.contains(genre)) continue;
            if (tab.equals("Favorites") && !favorites.contains(item.packageName)) continue;
            if (effectiveFilter.equals("Installed") && version < 0 || effectiveFilter.equals("Updates") && (version < 0 || version >= item.versions.get(0).code)) continue;
            values.add(item);
        }
        Collections.sort(values, (a, b) -> sort.equals("Newest") ? Long.compare(b.added, a.added)
            : sort.equals("Size") ? Long.compare(a.versions.get(0).size, b.versions.get(0).size) : a.title.compareToIgnoreCase(b.title));
        return values;
    }
    List<String> genres() {
        TreeSet<String> tags = new TreeSet<>(); for (LibraryItem item : apps) tags.addAll(item.tags);
        List<String> result = new ArrayList<>(); result.add("All genres"); result.addAll(tags); return result;
    }
    String currentFilter() { return tab.equals("Favorites") ? favoriteFilter : filter; }
    void setFilter(String value) {
        if (tab.equals("Favorites")) favoriteFilter = value;
        else { filter = value; connectionSettings.preferences().edit().putString("filter", value).apply(); }
        page = 0; render();
    }
    void loadCatalog(JSONObject value) {
        JSONArray entries = value.optJSONArray("apps"); if (entries == null || entries.length() > 10000) return;
        apps.clear();
        for (int i = 0; i < entries.length(); i++) {
            JSONObject entry = entries.optJSONObject(i); if (entry == null) continue;
            LibraryItem item = new LibraryItem(entry);
            if (item.packageName.matches("[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z][A-Za-z0-9_]*)+") && !item.versions.isEmpty()) apps.add(item);
        }
        if (selected != null) {
            LibraryItem replacement = null;
            for (LibraryItem item : apps) if (item.packageName.equals(selected.packageName)) replacement = item;
            selected = replacement;
            if (selected != null) versionIndex = Math.min(versionIndex, selected.versions.size() - 1);
        }
    }

    void refresh() {
        if (loading || session == null) return;
        final NetApi.Session captured = session; loading = true; status("Refreshing collection…");
        network.execute(() -> {
            try {
                JSONObject catalog = api.json(captured, "/api/catalog", null);
                // Commit cache only while the connection still belongs to this
                // server; old callback data cannot seed a different collection.
                main.post(() -> {
                    if (!current(captured)) return;
                    loadCatalog(catalog); online = true; loading = false;
                    message = catalog.optBoolean("scanning") ? "Library scan in progress. Refresh shortly." : apps.size() + " titles · collection refreshed";
                    render();
                    final String data = catalog.toString();
                    network.execute(() -> saveCatalog(captured, data));
                });
            } catch (Exception error) {
                main.post(() -> { if (current(captured)) { loading = false; online = false; status("Server unavailable: " + shortError(error) + " · Installed apps can still play."); } });
            }
        });
    }
    synchronized void saveCatalog(NetApi.Session captured, String data) {
        if (!current(captured)) return;
        File temporary = new File(getFilesDir(), "catalog.tmp");
        try {
            try (FileOutputStream output = new FileOutputStream(temporary)) { output.write(data.getBytes("UTF-8")); output.getFD().sync(); }
            if (current(captured)) temporary.renameTo(new File(getFilesDir(), "catalog.json"));
            else temporary.delete();
        } catch (Exception ignored) { /* Offline caching is optional; live data remains usable. */ }
    }

    void fetchArt(LibraryItem item) {
        final NetApi.Session captured = session;
        // Rapid page changes cannot create an unbounded artwork request queue.
        if (!online || captured == null || pendingArt.size() >= 12 || missingArt.contains(item.packageName) || art.get(item.packageName) != null || !pendingArt.add(connectionGeneration + "/" + item.packageName)) return;
        final String artKey = connectionGeneration + "/" + item.packageName;
        network.execute(() -> {
            Bitmap bitmap = null;
            try {
                byte[] bytes = api.image(captured, item.image);
                BitmapFactory.Options options = new BitmapFactory.Options(); options.inJustDecodeBounds = true;
                BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
                if (options.outWidth < 1 || options.outHeight < 1 || options.outWidth > 4096 || options.outHeight > 4096) throw new Exception("Invalid artwork size.");
                options.inSampleSize = Math.max(1, Math.max(options.outWidth / 640, options.outHeight / 360)); options.inJustDecodeBounds = false;
                bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
            } catch (Exception ignored) { /* Missing artwork uses the local initials tile. */ }
            final Bitmap result = bitmap;
            main.post(() -> {
                pendingArt.remove(artKey);
                if (!current(captured)) return;
                if (result != null) art.put(item.packageName, result); else missingArt.add(item.packageName);
                render();
            });
        });
    }

    void connect() {
        if (requestPending || busy()) return;
        final String base;
        try { base = ConnectionSettings.serverAddress(addressDraft); }
        catch (Exception error) { status(shortError(error)); return; }
        if (!codeDraft.matches("[0-9]{6}")) { status("Enter the six-digit code shown in VR library."); return; }
        final String code = codeDraft; final int generation = ++connectionGeneration;
        requestPending = true; status("Connecting to Sormus…");
        network.execute(() -> {
            try {
                JSONObject result = api.json(new NetApi.Session(base, ""), "/api/vr-client/enroll", new JSONObject().put("code", code));
                String token = result.getString("token");
                if (destroyed || generation != connectionGeneration) return;
                connectionSettings.save(base, token);
                main.post(() -> {
                    if (destroyed || generation != connectionGeneration) return;
                    synchronized (MainActivity.this) { session = new NetApi.Session(base, token); new File(getFilesDir(), "catalog.json").delete(); }
                    codeDraft = ""; requestPending = false;
                    loading = false; pollBusy = false; online = false; job = null; selected = null;
                    apps.clear(); art.evictAll(); pendingArt.clear(); missingArt.clear(); query = ""; genre = "All genres"; page = 0;
                    tab = "Library"; refresh(); pollJob();
                });
            } catch (Exception error) {
                main.post(() -> { if (!destroyed && generation == connectionGeneration) { requestPending = false; codeDraft = ""; status("Connection not completed: " + shortError(error) + " Generate a new code before retrying."); } });
            }
        });
    }

    void pollJob() {
        if (pollBusy || session == null || requestPending) return;
        final NetApi.Session captured = session; pollBusy = true;
        network.execute(() -> {
            try {
                JSONObject result = api.json(captured, "/api/device/install", null);
                main.post(() -> {
                    if (!current(captured)) return; pollBusy = false; online = true;
                    JSONObject next = result.optJSONObject("job");
                    String previous = job == null ? "" : job.optString("id") + "/" + job.optString("state");
                    job = next;
                    if (next != null && !(next.optString("id") + "/" + next.optString("state")).equals(previous)) {
                        refreshInstalled();
                        message = next.optString("state").equals("Failed") ? next.optString("error") : next.optString("title") + " · " + next.optString("state");
                    }
                    render();
                });
            } catch (Exception ignored) {
                main.post(() -> {
                    if (!current(captured)) return;
                    boolean wasOnline = online; pollBusy = false; online = false;
                    if (busy()) status("Connection lost during operation. Check the headset before retrying.");
                    else if (wasOnline) status("Server unavailable. Installed apps can still play; refresh when it returns.");
                    else render();
                });
            }
        });
    }

    void reviewInstall(LibraryItem item, LibraryItem.Version version) {
        if (busy()) { status("Wait for the current package operation."); return; }
        if (session == null || !online) { status("Connect to Sormus before installing."); return; }
        if (!version.compatible() || item.packageName.equals(getPackageName())) { status("This version cannot be installed from the headset library."); return; }
        confirmation = new Confirmation("install", item, version, session); render();
    }
    void reviewUninstall(LibraryItem item) {
        if (busy() || session == null || item.packageName.equals(getPackageName()) || item.packageName.equals("com.tommi.homevr")) return;
        final Confirmation review = new Confirmation("uninstall", item, null, session);
        review.checking = true; confirmation = review; render();
        network.execute(() -> {
            try {
                JSONObject reply = api.json(review.session, "/api/device/uninstall/prepare", new JSONObject().put("packageName", item.packageName));
                main.post(() -> { if (current(review.session) && confirmation == review) { review.checking = false; review.token = reply.optString("confirmation"); render(); } });
            } catch (Exception error) {
                main.post(() -> { if (current(review.session) && confirmation == review) { confirmation = null; status("Uninstall unavailable: " + shortError(error)); } });
            }
        });
    }
    void confirmOperation() {
        final Confirmation review = confirmation;
        if (review == null || review.submitted || review.checking || !current(review.session) || busy()) return;
        review.submitted = true; requestPending = true; status("Sending " + review.operation + " request…");
        network.execute(() -> {
            try {
                JSONObject values = new JSONObject();
                if (review.operation.equals("install")) values.put("id", review.version.id);
                else values.put("packageName", review.packageName).put("confirmation", review.token);
                JSONObject result = api.json(review.session, "/api/device/" + review.operation, values);
                main.post(() -> {
                    if (!current(review.session)) return;
                    requestPending = false; if (confirmation == review) confirmation = null;
                    job = result.optJSONObject("job"); refreshInstalled();
                    message = review.operation.equals("install") ? "Installation started. Keep the headset connected." : review.title + " removed. APK on the PC retained.";
                    tab = "Activity"; pollJob(); render();
                });
            } catch (Exception error) {
                main.post(() -> {
                    if (!current(review.session)) return;
                    requestPending = false; if (confirmation == review) confirmation = null;
                    refreshInstalled(); message = "Request not confirmed: " + shortError(error) + " Check Activity and the headset before retrying.";
                    tab = "Activity"; pollJob(); render();
                });
            }
        });
    }
    void cancelOperation() {
        if (requestPending || job == null || !busy() || session == null) return;
        final NetApi.Session captured = session; final String id = job.optString("id");
        requestPending = true; status("Requesting cancellation…");
        network.execute(() -> {
            try { api.json(captured, "/api/device/install/cancel", new JSONObject().put("id", id)); }
            catch (Exception error) { main.post(() -> { if (current(captured)) message = "Cancellation not confirmed: " + shortError(error); }); }
            finally { main.post(() -> { if (current(captured)) { requestPending = false; message += " Check the headset; applied changes cannot be undone."; pollJob(); render(); } }); }
        });
    }
    void launch(LibraryItem item) {
        try {
            Intent intent = getPackageManager().getLaunchIntentForPackage(item.packageName);
            if (intent == null) throw new Exception("Application is unavailable or has no launcher.");
            startActivity(intent);
        } catch (Exception error) { status(shortError(error)); }
    }
    static String shortError(Exception error) {
        String value = error.getMessage(); return value == null ? "Connection unavailable." : value.substring(0, Math.min(350, value.length()));
    }
}
