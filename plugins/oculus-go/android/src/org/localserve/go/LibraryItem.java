package org.localserve.go;

import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.List;

/** Public catalogue fields only; files stay on the server until installation. */
final class LibraryItem {
    final String packageName, title, description, image;
    final List<String> tags = new ArrayList<>();
    final List<Version> versions = new ArrayList<>();
    final long added;

    static final class Version {
        final String id, name, abi;
        final long size;
        final int code, minSdk;
        Version(JSONObject value) {
            id = value.optString("id"); name = value.optString("versionName");
            abi = value.optString("nativeCode"); size = value.optLong("size");
            code = value.optInt("versionCode"); minSdk = value.optInt("minSdk", 1);
        }
        boolean compatible() { return minSdk <= 25 && (abi.isEmpty() || abi.contains("armeabi")); }
    }

    LibraryItem(JSONObject value) {
        packageName = value.optString("packageName"); title = value.optString("title", packageName);
        description = value.optString("description"); image = value.optString("image"); added = value.optLong("added");
        JSONArray labels = value.optJSONArray("tags"), files = value.optJSONArray("versions");
        if (labels != null) for (int i = 0; i < Math.min(20, labels.length()); i++) tags.add(labels.optString(i));
        if (files != null) for (int i = 0; i < Math.min(100, files.length()); i++) {
            JSONObject file = files.optJSONObject(i);
            if (file != null && file.optString("id").matches("[a-f0-9]{24}")) versions.add(new Version(file));
        }
    }
}
