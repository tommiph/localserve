package org.localserve.go;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/** Combine independent PC and headset inventories without manufacturing APKs.
 * Cached PC metadata enriches an installed title, but never owns its presence. */
final class LibraryCatalog {
    static List<LibraryItem> merge(List<LibraryItem> catalog, List<LibraryItem> local) {
        Map<String, LibraryItem> merged = new LinkedHashMap<>();
        for (LibraryItem item : catalog) merged.put(item.packageName, item);
        for (LibraryItem item : local) if (!merged.containsKey(item.packageName)) merged.put(item.packageName, item);
        return new ArrayList<>(merged.values());
    }

    static List<LibraryItem> visible(List<LibraryItem> apps, Map<String, Integer> installed,
            Set<String> favorites, boolean favoritesOnly, String filter, String query, String genre, String sort) {
        List<LibraryItem> values = new ArrayList<>();
        String search = query.toLowerCase(Locale.ROOT);
        for (LibraryItem item : apps) {
            Integer version = installed.get(item.packageName);
            LibraryItem.Version latest = item.latestVersion();
            if (!search.isEmpty() && !(item.title + " " + item.packageName + " " + item.tags).toLowerCase(Locale.ROOT).contains(search)) continue;
            if (!genre.equals("All genres") && !item.tags.contains(genre)) continue;
            if (favoritesOnly && !favorites.contains(item.packageName)) continue;
            if (filter.equals("Installed") && version == null) continue;
            if (filter.equals("Updates") && (version == null || latest == null || version >= latest.code)) continue;
            values.add(item);
        }
        Collections.sort(values, (a, b) -> sort.equals("Newest") ? Long.compare(b.added, a.added)
            : sort.equals("Size") ? Long.compare(downloadSize(a), downloadSize(b)) : a.title.compareToIgnoreCase(b.title));
        return values;
    }

    private static long downloadSize(LibraryItem item) {
        LibraryItem.Version version = item.latestVersion();
        return version == null ? Long.MAX_VALUE : version.size;
    }
}
