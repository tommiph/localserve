package local.localserve.scenes;

import java.net.URI;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

/** Resource admission is independent of navigation. The only document is Scenes. */
public final class ScenesPolicy {
    private static final Set<String> FILES = new HashSet<>(Arrays.asList(
        "/scene-selector.js", "/scene-selector.css", "/assets/scenes/app-icon.svg",
        "/assets/scenes/app-icon-192.png", "/assets/scenes/app-icon-512.png",
        "/assets/material-symbols/material-symbols.css", "/assets/material-symbols/material-symbols-outlined.ttf"));
    private static URI scoped(String origin, String address) throws Exception {
        URI base = new URI(ServerAddress.normalize(origin)), uri = new URI(address);
        if (!base.getScheme().equals(uri.getScheme()) || !base.getRawAuthority().equals(uri.getRawAuthority())
            || uri.getUserInfo() != null || uri.getFragment() != null || !uri.getRawPath().equals(uri.getPath())
            || uri.getPath().contains("..") || uri.getPath().contains("//")) throw new Exception("Blocked URL.");
        return uri;
    }
    public static boolean connection(String origin, String address) {
        try { URI uri = scoped(origin, address); return uri.getPath().equals("/scenes/connection") && uri.getQuery() == null; }
        catch (Exception error) { return false; }
    }
    public static boolean allows(String origin, String address, boolean navigation) {
        try {
            URI uri = scoped(origin, address);
            String path = uri.getPath();
            if (path.equals("/scenes")) return uri.getQuery() == null;
            if (navigation) return false;
            if (FILES.contains(path)) return uri.getQuery() == null || uri.getQuery().matches("v=[0-9]+");
            if (uri.getQuery() != null) return false;
            return path.equals("/scenes/app.webmanifest") || path.equals("/api/scene-selector")
                || path.equals("/api/phone-home/run") || path.matches("/api/phone-home/receipts/[a-f0-9-]{36}")
                || path.matches("/api/control-view/[a-z0-9-]+/[a-z0-9-]+(?:/run)?");
        } catch (Exception error) { return false; }
    }
    private ScenesPolicy() {}
}
