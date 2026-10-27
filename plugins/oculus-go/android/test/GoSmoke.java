package org.localserve.go;

import android.app.Activity;
import android.app.Application;
import android.app.Instrumentation;
import android.content.ComponentName;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.SurfaceTexture;
import android.os.Bundle;
import android.view.Surface;
import java.io.File;
import java.io.FileOutputStream;
import java.util.Set;
import java.util.ArrayList;
import java.util.List;

/** Opt-in device checks. No library package installation, removal or launch. */
public final class GoSmoke extends Instrumentation {
    private Bundle arguments;
    private MainActivity activity;

    @Override public void onCreate(Bundle values) { super.onCreate(values); arguments = values; start(); }

    @Override public void onStart() {
        Bundle result = new Bundle();
        try {
            final String name = "org.localserve.go";
            Intent intent = new Intent(Intent.ACTION_MAIN).setClassName(name, name + ".MainActivity");
            runOnMainSync(() -> {
                try {
                    activity = (MainActivity) newActivity(MainActivity.class, getTargetContext(), null,
                        new Application(), intent, getTargetContext().getPackageManager().getActivityInfo(
                            new ComponentName(name, name + ".MainActivity"), 0), "# Sormus #", null, "check", null);
                    callActivityOnCreate(activity, null);
                    activity.addressDraft = arguments.getString("server", "");
                    activity.codeDraft = arguments.getString("code", "");
                    activity.connect();
                } catch (Exception error) { throw new RuntimeException(error); }
            });
            long deadline = System.currentTimeMillis() + 45000;
            final boolean[] ready = {false};
            while (!ready[0] && System.currentTimeMillis() < deadline) {
                runOnMainSync(() -> ready[0] = activity.online && !activity.apps.isEmpty());
                Thread.sleep(100);
            }
            if (!ready[0]) throw new Exception("Collection did not become available: " + activity.message);
            NetApi.Session restored = activity.connectionSettings.load();
            if (restored == null || !restored.token.equals(activity.session.token)) throw new Exception("Keystore round trip failed.");
            runOnMainSync(() -> { activity.navigate("Library"); activity.setFilter("All"); });
            Thread.sleep(5000);
            runOnMainSync(() -> {
                activity.render(); save("library");
                LibraryItem first = activity.visibleApps().get(0);
                Set<String> original = activity.favorites();
                activity.toggleFavorite(first); activity.navigate("Favorites");
                if (!original.contains(first.packageName) && activity.visibleApps().isEmpty()) throw new RuntimeException("Favorite not visible.");
                activity.connectionSettings.preferences().edit().putStringSet("favorites", original).commit();
                activity.navigate("Library"); activity.selected = first; activity.render(); save("details");
                LibraryItem.Version latest = first.latestVersion();
                if (latest != null) activity.reviewInstall(first, latest);
                if (latest != null && latest.compatible() && activity.confirmation == null) throw new RuntimeException("Install review missing.");
                if (activity.confirmation != null) { save("review"); activity.back(); }
                // Drop all PC catalogue data while retaining real headset apps.
                // Inspecting and rendering local entries never launches them.
                List<LibraryItem> catalog = new ArrayList<>(activity.catalogApps);
                activity.selected = null; activity.online = false; activity.catalogApps.clear();
                activity.refreshInstalled(); activity.query = ""; activity.genre = "All genres";
                activity.setFilter("Installed");
                if (activity.visibleApps().size() != activity.localApps.size()) throw new RuntimeException("Offline headset apps disappeared.");
                for (LibraryItem local : activity.visibleApps()) if (local.latestVersion() != null) throw new RuntimeException("Local entry invented an APK.");
                activity.render(); save("offline-library");
                if (!activity.visibleApps().isEmpty()) {
                    activity.selected = activity.visibleApps().get(0); activity.render(); save("offline-details");
                }
                activity.selected = null; activity.catalogApps.addAll(catalog); activity.online = true; activity.refreshInstalled();
                activity.selected = null; activity.navigate("Settings"); save("settings");
                activity.inputMode = "address"; activity.render(); save("keyboard");
                activity.back(); activity.navigate("Activity"); save("activity");
                activity.navigate("Library"); activity.setFilter("Installed");
            });
            SurfaceTexture texture = new SurfaceTexture(0);
            texture.setDefaultBufferSize(2560, 1440);
            Surface surface = new Surface(texture);
            int frames;
            try {
                activity.nativeStart(surface);
                activity.nativeBitmap(activity.screen.bitmap);
                Thread.sleep(3000);
                frames = activity.nativeFrames();
            } finally { activity.nativeStop(); surface.release(); texture.release(); }
            if (frames < 10) throw new Exception("VR frame submission failed: " + frames);
            result.putString("stream", "Sormus Go passed: " + activity.apps.size() + " titles, "
                + activity.art.snapshot().size() + " artworks, encrypted connection, favorites, review and menus; "
                + frames + " stereo frames. No library package effects.\n");
            finish(Activity.RESULT_OK, result);
        } catch (Exception error) {
            result.putString("stream", "Sormus Go check failed: " + error + "\n");
            finish(Activity.RESULT_CANCELED, result);
        } finally {
            if (activity != null) runOnMainSync(() -> callActivityOnDestroy(activity));
        }
    }

    private void save(String name) {
        try (FileOutputStream output = new FileOutputStream(new File(activity.getExternalFilesDir(null), "qa-" + name + ".png"))) {
            activity.screen.bitmap.compress(Bitmap.CompressFormat.PNG, 100, output);
        } catch (Exception error) { throw new RuntimeException(error); }
    }
}
