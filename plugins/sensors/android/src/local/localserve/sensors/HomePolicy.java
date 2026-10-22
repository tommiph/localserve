package local.localserve.sensors;

import java.net.URI;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

/** Exact-origin, fixed-route access for the phone WebView. No administrator API,
 * arbitrary page, file access or external navigation belongs in this surface. */
public final class HomePolicy {
    private static final Set<String> FILES = new HashSet<>(Arrays.asList(
        "/phone-home.js", "/phone-home.css", "/card-renderer.js", "/styles.css", "/browser-compat.js",
        "/controls-renderer.js", "/lighting-controls.js", "/television-controls.js", "/controls-viewer.js", "/control-app.js",
        "/assets/logo.svg", "/assets/logo-dark.svg", "/assets/material-symbols/material-symbols.css",
        "/assets/material-symbols/material-symbols-outlined.ttf", "/assets/controls/app-icon.svg",
        "/assets/controls/app-icon-192.png", "/assets/controls/app-icon-512.png", "/assets/controls/lighting.css",
        "/assets/controls/television.css", "/assets/controls/app.css"));
    public static boolean allows(String origin, String address, boolean navigation) {
        try {
            URI base = new URI(origin), uri = new URI(address);
            if (!"http".equals(uri.getScheme()) || !base.getScheme().equals(uri.getScheme())
                || !base.getRawAuthority().equals(uri.getRawAuthority()) || uri.getUserInfo() != null || uri.getFragment() != null) return false;
            String path = uri.getRawPath();
            if (!path.equals(uri.getPath()) || path.contains("..") || path.contains("//")) return false;
            boolean page = path.equals("/home") || path.equals("/controls") || path.matches("/controls/[a-z0-9-]+/[a-z0-9-]+");
            if (page) return uri.getQuery() == null;
            if (navigation) return false;
            if (FILES.contains(path)) return uri.getQuery() == null || uri.getQuery().matches("v=[0-9]+");
            if (uri.getQuery() != null) return false;
            return path.equals("/api/phone-home") || path.equals("/api/phone-home/run")
                || path.matches("/api/phone-home/cards/[a-z0-9-]{1,80}/[a-z0-9-]{1,80}/[a-z0-9-]{1,80}")
                || path.matches("/plugin-card-assets/[a-z0-9-]+/[a-z0-9-]+/(?:[a-z0-9-]+/)*[a-z0-9-]+\\.(?:html|css|svg|png|webp)")
                || path.matches("/api/phone-home/receipts/[a-f0-9-]{36}") || path.equals("/api/control-view")
                || path.matches("/api/control-view/[a-z0-9-]+/[a-z0-9-]+(?:/(?:run|cancel|scene))?")
                || path.matches("/controls/[a-z0-9-]+/[a-z0-9-]+/app.webmanifest");
        } catch (Exception error) { return false; }
    }
    /** A subframe may open only an installed, script-free Card document.
     * Resource access never grants top-level navigation to APIs or assets. */
    public static boolean allowsFrame(String origin, String address) {
        try {
            return allows(origin, address, false) && new URI(address).getPath().matches(
                "/plugin-card-assets/[a-z0-9-]+/[a-z0-9-]+/(?:[a-z0-9-]+/)*[a-z0-9-]+\\.html");
        } catch (Exception error) { return false; }
    }
    private HomePolicy() {}
}
