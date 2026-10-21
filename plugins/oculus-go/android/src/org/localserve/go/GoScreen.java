package org.localserve.go;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.graphics.Shader;
import android.graphics.Typeface;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;

/** Event-driven cockpit texture; the native renderer supplies stereo tracking. */
final class GoScreen {
    static final int WIDTH = 1536, HEIGHT = 1024;
    static final int BG = 0xff080e1c, PANEL = 0xff121f32, BORDER = 0xff293a53;
    static final int INK = 0xffedf6ff, MUTED = 0xffa2b6ce, CYAN = 0xff78f1e3, VIOLET = 0xffbca4ff, RED = 0xffff8ba9;
    final MainActivity app;
    final Bitmap bitmap = Bitmap.createBitmap(WIDTH, HEIGHT, Bitmap.Config.ARGB_8888);
    final Canvas canvas = new Canvas(bitmap);
    final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
    final Typeface regular = Typeface.create("sans-serif", Typeface.NORMAL);
    final Typeface medium = Typeface.create("sans-serif-medium", Typeface.NORMAL);
    final List<Hit> hits = new ArrayList<>();
    Typeface symbols;
    Bitmap logo;
    String hoverLabel = "";

    static final class Hit {
        final RectF bounds;
        final String label;
        final Runnable action;
        Hit(RectF bounds, String label, Runnable action) { this.bounds = bounds; this.label = label; this.action = action; }
    }

    GoScreen(MainActivity app) {
        this.app = app;
        try { logo = BitmapFactory.decodeStream(app.getAssets().open("logo.png")); }
        catch (Exception ignored) { /* The wordmark remains usable without the image. */ }
        try { symbols = Typeface.createFromAsset(app.getAssets(), "material-symbols.ttf"); }
        catch (Exception ignored) { symbols = regular; }
    }

    Hit hit(float x, float y) {
        for (int i = hits.size() - 1; i >= 0; i--) if (hits.get(i).bounds.contains(x, y)) return hits.get(i);
        return null;
    }
    void text(String value, float x, float y, float size, int color, boolean bold) {
        paint.setShader(null); paint.setStyle(Paint.Style.FILL); paint.setColor(color);
        paint.setTypeface(bold ? medium : regular); paint.setTextSize(size);
        canvas.drawText(value == null ? "" : value, x, y, paint);
    }
    void glyph(String code, float x, float y, float size, int color) {
        paint.setShader(null); paint.setTypeface(symbols); paint.setTextSize(size); paint.setColor(color);
        canvas.drawText(code, x, y, paint);
    }
    String fit(String value, float width, float size) {
        paint.setTypeface(regular); paint.setTextSize(size);
        if (paint.measureText(value) <= width) return value;
        int end = value.length();
        while (end > 0 && paint.measureText(value.substring(0, end) + "…") > width) end--;
        return value.substring(0, end) + "…";
    }
    void box(float x, float y, float width, float height, int color, float radius) {
        paint.setStyle(Paint.Style.FILL); paint.setShader(null); paint.setColor(color);
        canvas.drawRoundRect(new RectF(x, y, x + width, y + height), radius, radius, paint);
    }
    void border(float x, float y, float width, float height, int color, float radius) {
        paint.setStyle(Paint.Style.STROKE); paint.setStrokeWidth(2); paint.setShader(null); paint.setColor(color);
        canvas.drawRoundRect(new RectF(x, y, x + width, y + height), radius, radius, paint);
        paint.setStyle(Paint.Style.FILL);
    }
    void button(String label, float x, float y, float width, float height, boolean primary, boolean enabled, Runnable action) {
        boolean hovered = new RectF(x, y, x + width, y + height).contains(app.pointerX, app.pointerY);
        int color = !enabled ? 0xff172333 : primary ? CYAN : hovered ? 0xff284658 : PANEL;
        box(x, y, width, height, color, 14);
        border(x, y, width, height, enabled && hovered ? CYAN : primary ? 0xff9bfff2 : BORDER, 14);
        text(fit(label, width - 34, 23), x + 17, y + height / 2 + 8, 23, !enabled ? 0xff657890 : primary ? BG : INK, true);
        if (enabled) hits.add(new Hit(new RectF(x, y, x + width, y + height), label, action));
    }
    void button(String label, float x, float y, float width, float height, boolean primary, Runnable action) {
        button(label, x, y, width, height, primary, true, action);
    }
    void wrap(String value, float x, float y, float width, int size, int lines, int color) {
        StringBuilder line = new StringBuilder(); int row = 0;
        for (String word : value.replace('\n', ' ').split(" +")) {
            paint.setTypeface(regular); paint.setTextSize(size);
            if (line.length() > 0 && paint.measureText(line + word) > width) {
                text(fit(line.toString(), width, size), x, y + row * (size + 11), size, color, false);
                line.setLength(0); if (++row >= lines) return;
            }
            line.append(word).append(' ');
        }
        if (row < lines) text(fit(line.toString(), width, size), x, y + row * (size + 11), size, color, false);
    }
    static String size(long bytes) {
        return bytes >= 1024L * 1024 * 1024 ? String.format(Locale.US, "%.1f GB", bytes / (1024.0 * 1024 * 1024))
            : String.format(Locale.US, "%.0f MB", bytes / (1024.0 * 1024));
    }

    void draw() {
        hits.clear(); canvas.drawColor(BG);
        paint.setShader(new LinearGradient(0, 0, WIDTH, HEIGHT, new int[]{0xff071829, 0xff0a1023, 0xff1e1735}, null, Shader.TileMode.CLAMP));
        canvas.drawRect(0, 0, WIDTH, HEIGHT, paint); paint.setShader(null);
        // Static circuit traces create depth without moving the user's view.
        paint.setColor(0xff172a3e); paint.setStrokeWidth(1);
        for (int x = 48; x < WIDTH; x += 96) canvas.drawLine(x, 115, x + 180, HEIGHT, paint);
        for (int y = 120; y < HEIGHT; y += 96) canvas.drawLine(24, y, WIDTH - 24, y, paint);
        box(24, 20, 1488, 104, 0xff101b2c, 20); border(24, 20, 1488, 104, BORDER, 20);
        if (logo != null) canvas.drawBitmap(logo, null, new RectF(42, 35, 120, 113), paint);
        text("Localserve", 134, 73, 34, INK, true);
        text("OCULUS GO", 136, 100, 14, CYAN, true);
        String[] tabs = {"Library", "Favorites", "Activity", "Settings"};
        for (int i = 0; i < tabs.length; i++) {
            final String tab = tabs[i];
            button(tab, 365 + i * 196, 43, 180, 58, app.tab.equals(tab), () -> app.navigate(tab));
        }
        box(1180, 43, 308, 58, app.online ? 0xff163a3d : PANEL, 14);
        glyph("\ue2db", 1198, 82, 29, app.online ? CYAN : MUTED);
        text(app.online ? "SERVER CONNECTED" : app.session == null ? "NOT CONNECTED" : "SERVER OFFLINE", 1235, 80, 17, app.online ? CYAN : MUTED, true);

        if (app.selected != null) details();
        else if (app.tab.equals("Settings")) settings();
        else if (app.tab.equals("Activity")) activity();
        else library();

        box(24, 946, 1488, 65, 0xff0b1424, 14);
        String status = app.message;
        text(fit(status, 1200, 20), 44, 975, 20, MUTED, false);
        text("Point + trigger to select · Swipe to browse · Back to return", 44, 1000, 16, 0xff708ca7, false);
        text(size(app.getFilesDir().getUsableSpace()) + " free", 1310, 982, 18, CYAN, false);
        if (!app.menu.isEmpty()) picker();
        if (!app.inputMode.isEmpty()) keyboard();
        if (app.confirmation != null) confirmation();
    }

    void library() {
        button(app.query.isEmpty() ? "Search collection" : "Search: " + app.query, 48, 154, 736, 62, false, () -> app.inputMode = "search");
        button("Sort: " + app.sort + "  ▾", 804, 154, 314, 62, false, () -> { app.menu = "sort"; app.menuPage = 0; });
        button(app.genre + "  ▾", 1138, 154, 350, 62, false, () -> { app.menu = "genre"; app.menuPage = 0; });
        String[] filters = {"All", "Installed", "Updates"};
        for (int i = 0; i < filters.length; i++) {
            final String value = filters[i]; button(value, 48 + i * 200, 234, 184, 44, app.currentFilter().equals(value), () -> app.setFilter(value));
        }
        button(app.loading ? "Refreshing…" : "Refresh", 1238, 234, 250, 44, false, !app.loading && app.session != null, () -> { app.refreshInstalled(); app.refresh(); });
        List<LibraryItem> values = app.visibleApps();
        int pages = Math.max(1, (values.size() + 5) / 6); app.page = Math.max(0, Math.min(pages - 1, app.page));
        text(values.size() + " titles", 950, 263, 20, MUTED, false);
        if (values.isEmpty()) {
            glyph("\uf1cf", 694, 490, 100, CYAN);
            text(app.tab.equals("Favorites") ? "No favorites match" : "No applications to show", 420, 574, 40, INK, true);
            wrap(app.session == null ? "Connect this headset from Settings to load your collection."
                : "Try All, clear your search, or refresh after the server library scan finishes.", 300, 642, 930, 27, 3, MUTED);
            button("Show all applications", 495, 746, 546, 70, true, () -> { app.tab = "Library"; app.query = ""; app.genre = "All genres"; app.setFilter("All"); });
        }
        for (int i = 0; i < 6 && app.page * 6 + i < values.size(); i++) {
            final LibraryItem item = values.get(app.page * 6 + i);
            float x = 48 + i % 3 * 488, y = 300 + i / 3 * 278;
            box(x, y, 464, 256, PANEL, 18);
            artwork(item, new RectF(x + 5, y + 5, x + 459, y + 157));
            text(fit(item.title, 422, 25), x + 18, y + 190, 25, INK, true);
            int have = app.installedVersion(item.packageName);
            String summary = have >= 0 ? have < item.versions.get(0).code ? "Update available" : "Installed" : size(item.versions.get(0).size);
            text(fit(summary, 230, 18), x + 18, y + 233, 18, have >= 0 ? CYAN : MUTED, false);
            if (app.favorites().contains(item.packageName)) glyph("\ue838", x + 421, y + 36, 26, CYAN);
            hits.add(new Hit(new RectF(x, y, x + 464, y + 256), item.title, () -> { app.selected = item; app.versionIndex = 0; }));
            if (new RectF(x, y, x + 464, y + 256).contains(app.pointerX, app.pointerY)) border(x, y, 464, 256, CYAN, 18);
            button(have >= 0 ? "Play" : "Install", x + 296, y + 205, 150, 38, have >= 0, !app.busy(),
                () -> { if (have >= 0) app.launch(item); else app.reviewInstall(item, item.versions.get(0)); });
        }
        button("‹ Previous", 48, 866, 244, 58, false, app.page > 0, () -> app.page--);
        text((app.page + 1) + " / " + pages, 720, 905, 24, VIOLET, true);
        button("Next ›", 1244, 866, 244, 58, false, app.page < pages - 1, () -> app.page++);
    }

    void artwork(LibraryItem item, RectF rectangle) {
        Bitmap image = app.art.get(item.packageName);
        canvas.save(); Path clipping = new Path(); clipping.addRoundRect(rectangle, 14, 14, Path.Direction.CW); canvas.clipPath(clipping);
        if (image == null) {
            paint.setShader(new LinearGradient(rectangle.left, rectangle.top, rectangle.right, rectangle.bottom, 0xff173849, 0xff382b5a, Shader.TileMode.CLAMP));
            canvas.drawRect(rectangle, paint); paint.setShader(null);
            text(item.title.substring(0, Math.min(2, item.title.length())).toUpperCase(Locale.ROOT), rectangle.centerX() - 36, rectangle.centerY() + 20, 53, CYAN, true);
            app.fetchArt(item);
        } else {
            float scale = Math.max(rectangle.width() / image.getWidth(), rectangle.height() / image.getHeight());
            float width = image.getWidth() * scale, height = image.getHeight() * scale;
            paint.setColor(Color.WHITE); canvas.drawBitmap(image, null, new RectF(rectangle.centerX() - width / 2, rectangle.centerY() - height / 2, rectangle.centerX() + width / 2, rectangle.centerY() + height / 2), paint);
        }
        canvas.restore();
    }

    void details() {
        LibraryItem item = app.selected; LibraryItem.Version version = item.versions.get(app.versionIndex);
        button("‹ Collection", 48, 155, 214, 58, false, () -> app.selected = null);
        text(fit(item.title, 1170, 36), 290, 197, 36, INK, true);
        artwork(item, new RectF(48, 244, 698, 654));
        text(fit(android.text.TextUtils.join(" · ", item.tags), 740, 19), 738, 267, 19, CYAN, false);
        wrap(item.description.isEmpty() ? item.packageName : item.description, 738, 315, 730, 26, 6, INK);
        text("VERSION", 738, 578, 17, VIOLET, true);
        button((version.name.isEmpty() ? "Build " + version.code : version.name) + " · " + size(version.size) + "  ›", 738, 597, 750, 62, false,
            () -> { app.versionIndex = (app.versionIndex + 1) % item.versions.size(); });
        text(fit(item.packageName, 650, 19), 48, 699, 19, MUTED, false);
        int installed = app.installedVersion(item.packageName);
        button("Play", 48, 738, 330, 74, true, installed >= 0, () -> app.launch(item));
        boolean favorite = app.favorites().contains(item.packageName);
        button(favorite ? "★ Favorited" : "☆ Favorite", 398, 738, 300, 74, false, () -> app.toggleFavorite(item));
        button(installed < 0 ? "Install selected" : "Install / replace", 738, 738, 350, 74, false,
            !app.busy() && app.online && version.compatible() && !item.packageName.equals(app.getPackageName()), () -> app.reviewInstall(item, version));
        button("Uninstall", 1108, 738, 380, 74, false,
            !app.busy() && app.online && installed >= 0 && !item.packageName.equals(app.getPackageName()) && !item.packageName.equals("com.tommi.homevr"), () -> app.reviewUninstall(item));
        text(installed >= 0 ? "Installed build " + installed : "Not installed", 48, 871, 24, installed >= 0 ? CYAN : MUTED, true);
        text(version.compatible() ? "Standalone APK · Android signatures enforced" : "This version is not compatible with Oculus Go", 738, 871, 23, version.compatible() ? MUTED : RED, false);
    }

    void settings() {
        text("Connection", 48, 195, 40, INK, true);
        text("Use the same trusted LAN as your Localserve server.", 48, 237, 24, MUTED, false);
        box(48, 270, 1440, 424, PANEL, 20); border(48, 270, 1440, 424, BORDER, 20);
        text("SERVER ADDRESS", 80, 314, 18, VIOLET, true);
        button(app.addressDraft.isEmpty() ? "Enter IP:port" : app.addressDraft, 80, 336, 850, 70, false, !app.busy(), () -> app.inputMode = "address");
        text("CONNECTION CODE", 80, 458, 18, VIOLET, true);
        button(app.codeDraft.isEmpty() ? "Enter six-digit code" : app.codeDraft, 80, 481, 460, 70, false, !app.busy(), () -> app.inputMode = "code");
        button(app.requestPending ? "Connecting…" : "Connect headset", 566, 481, 364, 70, true, !app.busy(), () -> app.connect());
        wrap("In the administrator, open VR library → Connect headset. Enter its address and code here. Codes expire after five minutes and work once.", 80, 609, 1320, 25, 2, MUTED);
        glyph("\ue897", 1000, 378, 64, CYAN);
        wrap(app.session == null ? "Not connected" : "Authorization saved on this headset", 1080, 357, 345, 24, 3, INK);
        button("Recenter view", 48, 752, 384, 74, false, () -> app.nativeRecenter());
        text("Point the controller at a button and press the trigger.", 48, 871, 24, MUTED, false);
        String version = "";
        try { version = app.getPackageManager().getPackageInfo(app.getPackageName(), 0).versionName; } catch (Exception ignored) { }
        text("Localserve Go " + version, 1150, 871, 22, VIOLET, false);
    }

    void activity() {
        text("Package activity", 48, 198, 40, INK, true);
        text("Latest operation on the configured headset", 48, 240, 24, MUTED, false);
        box(48, 280, 1440, 540, PANEL, 22); border(48, 280, 1440, 540, BORDER, 22);
        JSONObject job = app.job;
        if (job == null) {
            glyph("\ue889", 98, 398, 70, CYAN);
            text("No package operation reported", 208, 387, 34, INK, true);
            wrap(app.message, 98, 487, 1300, 28, 4, MUTED); return;
        }
        String state = job.optString("state");
        text(state.toUpperCase(Locale.ROOT), 98, 349, 21, state.equals("Failed") ? RED : CYAN, true);
        text(fit(job.optString("title"), 1300, 42), 98, 420, 42, INK, true);
        text(fit(job.optString("packageName"), 1300, 23), 98, 469, 23, MUTED, false);
        String explanation = job.optString("error");
        if (explanation.isEmpty()) explanation = app.busy()
            ? "Keep the headset awake and connected. Android confirms the package operation before completion."
            : "The package operation was verified by the server.";
        wrap(explanation, 98, 548, 1300, 27, 4, state.equals("Failed") ? RED : MUTED);
        if (app.busy()) button("Stop remaining work", 98, 704, 510, 72, false, !app.requestPending, () -> app.cancelOperation());
        text("Cancellation cannot undo a package change already applied.", 48, 892, 22, MUTED, false);
    }

    void picker() {
        boolean genres = app.menu.equals("genre");
        List<String> choices = genres ? app.genres() : Arrays.asList("A–Z", "Newest", "Size");
        hits.clear(); hits.add(new Hit(new RectF(0, 0, WIDTH, HEIGHT), "Close menu", () -> app.menu = ""));
        int pages = Math.max(1, (choices.size() + 7) / 8); app.menuPage = Math.max(0, Math.min(app.menuPage, pages - 1));
        box(862, 224, 626, 694, 0xff17253c, 20); border(862, 224, 626, 694, VIOLET, 20);
        text(genres ? "Genre" : "Sort", 888, 274, 28, INK, true);
        for (int i = 0; i < 8 && app.menuPage * 8 + i < choices.size(); i++) {
            final String choice = choices.get(app.menuPage * 8 + i);
            button(choice, 886, 300 + i * 61, 578, 52, choice.equals(genres ? app.genre : app.sort), () -> {
                if (genres) app.genre = choice;
                else { app.sort = choice; app.connectionSettings.preferences().edit().putString("sort", choice).apply(); }
                app.page = 0; app.menu = "";
            });
        }
        if (pages > 1) {
            button("‹ Previous", 886, 827, 278, 64, false, app.menuPage > 0, () -> app.menuPage--);
            button("Next ›", 1186, 827, 278, 64, false, app.menuPage < pages - 1, () -> app.menuPage++);
        }
    }

    void confirmation() {
        MainActivity.Confirmation review = app.confirmation; boolean uninstall = review.operation.equals("uninstall");
        box(24, 138, 1488, 800, 0xff091426, 20); border(24, 138, 1488, 800, uninstall ? RED : CYAN, 20); hits.clear();
        glyph(uninstall ? "\ue872" : "\uf090", 100, 262, 62, uninstall ? RED : CYAN);
        text(uninstall ? "Uninstall application?" : "Install application?", 190, 250, 40, INK, true);
        text(fit(review.title, 1310, 38), 100, 342, 38, uninstall ? RED : CYAN, true);
        wrap(uninstall ? "This removes the application and its saved data from your Go. Your original APK stays on the PC. This cannot be undone."
            : "Send this APK from Localserve to your Go. An installed version may be replaced. Android signature checks remain enabled; no downgrade is requested.", 100, 423, 1300, 30, 4, INK);
        if (!uninstall) text((review.version.name.isEmpty() ? "Build " + review.version.code : review.version.name) + " · " + size(review.version.size), 100, 625, 27, VIOLET, true);
        text(review.checking ? "Checking the configured headset…" : review.submitted ? "Request sent. Do not submit again." : "Keep the server and headset connected until the operation finishes.", 100, 697, 24, MUTED, false);
        button(review.submitted ? "View activity" : uninstall ? "Keep application" : "Cancel", 100, 778, 570, 84, false, () -> { app.confirmation = null; if (review.submitted) app.tab = "Activity"; });
        button(uninstall ? "Uninstall + delete saved data" : "Install selected version", 698, 778, 738, 84, true,
            !review.submitted && !review.checking && (!uninstall || !review.token.isEmpty()), () -> app.confirmOperation());
    }

    void keyboard() {
        boolean address = app.inputMode.equals("address"), code = app.inputMode.equals("code");
        box(24, 138, 1488, 800, 0xff0b1629, 20); border(24, 138, 1488, 800, VIOLET, 20); hits.clear();
        text(address ? "Server address · IP:port" : code ? "Six-digit connection code" : "Search collection", 90, 222, 35, INK, true);
        String value = address ? app.addressDraft : code ? app.codeDraft : app.query;
        box(90, 252, 1356, 82, PANEL, 14); border(90, 252, 1356, 82, CYAN, 14);
        text(value.isEmpty() ? "Point and select characters" : fit(value, 1280, 31), 116, 306, 31, value.isEmpty() ? MUTED : INK, false);
        String[] rows = address ? new String[]{"1234567890", ".:"} : code ? new String[]{"1234567890"} : new String[]{"1234567890", "QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"};
        for (int row = 0; row < rows.length; row++) {
            String keys = rows[row]; float left = (WIDTH - keys.length() * 114) / 2f;
            for (int col = 0; col < keys.length(); col++) {
                final String letter = keys.substring(col, col + 1);
                button(letter, left + col * 114, 366 + row * 104, 100, 88, false, () -> {
                    if (address && app.addressDraft.length() < 40) app.addressDraft += letter;
                    else if (code && app.codeDraft.length() < 6) app.codeDraft += letter;
                    else if (!address && !code && app.query.length() < 80) { app.query += letter; app.page = 0; }
                });
            }
        }
        button("Clear", 90, 820, 232, 74, false, () -> { if (address) app.addressDraft = ""; else if (code) app.codeDraft = ""; else app.query = ""; });
        button("Backspace", 342, 820, 300, 74, false, () -> {
            if (address && !app.addressDraft.isEmpty()) app.addressDraft = app.addressDraft.substring(0, app.addressDraft.length() - 1);
            else if (code && !app.codeDraft.isEmpty()) app.codeDraft = app.codeDraft.substring(0, app.codeDraft.length() - 1);
            else if (!address && !code && !app.query.isEmpty()) app.query = app.query.substring(0, app.query.length() - 1);
        });
        button("Space", 662, 820, 240, 74, false, !address && !code, () -> { if (app.query.length() < 80) app.query += " "; });
        button("Done", 922, 820, 524, 74, true, () -> { app.inputMode = ""; app.page = 0; });
    }
}
