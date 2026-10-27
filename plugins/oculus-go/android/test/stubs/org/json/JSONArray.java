package org.json;

import java.util.ArrayList;
import java.util.List;

/** Test-only sequence used to supply catalogue metadata to the actual model. */
public final class JSONArray {
    private final List<Object> values = new ArrayList<>();
    public JSONArray put(Object value) { values.add(value); return this; }
    public int length() { return values.size(); }
    public JSONObject optJSONObject(int index) { Object value = values.get(index); return value instanceof JSONObject ? (JSONObject) value : null; }
    public String optString(int index) { Object value = values.get(index); return value instanceof String ? (String) value : ""; }
}
