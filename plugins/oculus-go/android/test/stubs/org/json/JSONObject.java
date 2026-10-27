package org.json;

import java.util.HashMap;
import java.util.Map;

/** In-memory values for host-side model tests; not an APK JSON implementation. */
public final class JSONObject {
    private final Map<String, Object> values = new HashMap<>();
    public JSONObject put(String key, Object value) { values.put(key, value); return this; }
    public String optString(String key) { return optString(key, ""); }
    public String optString(String key, String fallback) { Object value = values.get(key); return value instanceof String ? (String) value : fallback; }
    public int optInt(String key) { return optInt(key, 0); }
    public int optInt(String key, int fallback) { Object value = values.get(key); return value instanceof Number ? ((Number) value).intValue() : fallback; }
    public long optLong(String key) { Object value = values.get(key); return value instanceof Number ? ((Number) value).longValue() : 0; }
    public JSONArray optJSONArray(String key) { Object value = values.get(key); return value instanceof JSONArray ? (JSONArray) value : null; }
}
