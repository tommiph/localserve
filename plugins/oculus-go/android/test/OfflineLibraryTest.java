package org.localserve.go;

import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;

/** Execute the same merge, filtering and version selection used by the APK.
 * No Android services, network calls, package effects or device are involved. */
public final class OfflineLibraryTest {
    static void check(boolean value, String message) { if (!value) throw new AssertionError(message); }
    static LibraryItem pc(String packageName, String title, int version, long size) {
        JSONObject file = new JSONObject().put("id", "1234567890abcdef12345678")
            .put("versionCode", version).put("size", size).put("minSdk", 25);
        return new LibraryItem(new JSONObject().put("packageName", packageName).put("title", title)
            .put("tags", new JSONArray().put("Puzzle")).put("versions", new JSONArray().put(file)));
    }
    static List<LibraryItem> visible(List<LibraryItem> apps, Map<String, Integer> installed, String filter, String sort) {
        return LibraryCatalog.visible(apps, installed, Collections.emptySet(), false, filter, "", "All genres", sort);
    }
    public static void main(String[] args) {
        LibraryItem local = new LibraryItem("sample.local", "Local game", 200);
        LibraryItem shared = new LibraryItem("sample.shared", "Headset label", 100);
        Map<String, Integer> installed = new HashMap<>();
        installed.put(local.packageName, 1); installed.put(shared.packageName, 2);

        List<LibraryItem> offline = LibraryCatalog.merge(Collections.emptyList(), Arrays.asList(local, shared));
        check(visible(offline, installed, "Installed", "A–Z").size() == 2, "Cold offline library must show headset apps without a PC cache");
        check(local.latestVersion() == null && local.versionAt(20) == null, "Local app must never invent a downloadable APK");
        check(visible(offline, installed, "Updates", "A–Z").isEmpty(), "Local-only entries cannot advertise PC updates");
        check(visible(offline, installed, "All", "Size").size() == 2, "Sorting local entries must not assume a server version");

        LibraryItem enriched = pc("sample.shared", "PC artwork title", 3, 1000);
        LibraryItem download = pc("sample.download", "Download", 5, 500);
        List<LibraryItem> online = LibraryCatalog.merge(Arrays.asList(enriched, download), Arrays.asList(local, shared));
        check(online.size() == 3 && online.get(0) == enriched, "Prefer PC metadata and deduplicate installed titles");
        check(visible(online, installed, "Installed", "A–Z").size() == 2, "Installed filter uses current headset presence");
        check(visible(online, installed, "Updates", "A–Z").equals(Collections.singletonList(enriched)), "Only a newer known PC build is an update");
        check(visible(online, installed, "All", "Size").get(2) == local, "Unknown download sizes sort after real APK sizes");
        check(visible(offline, installed, "All", "Newest").get(0) == local, "Local install times support newest sorting");
        check(enriched.versionAt(99) == enriched.latestVersion(), "Version selection remains bounded after catalogue refresh");
        List<LibraryItem> favorites = LibraryCatalog.visible(offline, installed, new HashSet<>(Collections.singletonList(local.packageName)), true, "All", "LOCAL", "All genres", "A–Z");
        check(favorites.equals(Collections.singletonList(local)), "Offline favorites and case-insensitive search use local identity");
        check(LibraryCatalog.visible(online, installed, Collections.emptySet(), false, "All", "", "Puzzle", "A–Z").size() == 2, "PC genre metadata remains usable");

        installed.remove(local.packageName);
        List<LibraryItem> rescanned = LibraryCatalog.merge(Arrays.asList(enriched, download), Collections.singletonList(shared));
        check(visible(rescanned, installed, "Installed", "A–Z").equals(Collections.singletonList(enriched)), "Rescan removes uninstalled local-only titles");
        check(LibraryCatalog.merge(Collections.emptyList(), Collections.singletonList(shared)).get(0) == shared, "Empty or replaced PC library cannot hide installed apps");
        System.out.println("14 offline library checks passed; no device effects.");
    }
}
