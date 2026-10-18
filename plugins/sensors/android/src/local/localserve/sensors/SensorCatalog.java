package local.localserve.sensors;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.hardware.Sensor;
import android.hardware.SensorManager;
import android.os.Build;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;

/** Stable app-local sensor identities; hardware serials and network discovery
 * are never used. Android types and units follow the public SensorEvent API. */
public final class SensorCatalog {
    private SensorCatalog() { }

    public static LinkedHashMap<String, Sensor> available(Context context) {
        SensorManager manager = (SensorManager) context.getSystemService(Context.SENSOR_SERVICE);
        List<Sensor> sensors = new ArrayList<>(manager.getSensorList(Sensor.TYPE_ALL));
        sensors.sort(Comparator.comparingInt(Sensor::getType).thenComparing(Sensor::getName).thenComparingInt(Sensor::getId));
        LinkedHashMap<String, Sensor> result = new LinkedHashMap<>();
        for (Sensor sensor : sensors) {
            if (result.size() >= 64) break;
            if (sensor.getType() <= 0) continue;
            result.put(id(sensor), sensor);
        }
        return result;
    }

    public static String id(Sensor sensor) {
        String descriptor = sensor.getType() + "|" + sensor.getId() + "|" + sensor.getName()
            + "|" + sensor.getVendor() + "|" + sensor.getVersion();
        try {
            byte[] hash = MessageDigest.getInstance("SHA-256").digest(descriptor.getBytes(StandardCharsets.UTF_8));
            StringBuilder value = new StringBuilder("s-");
            for (int index = 0; index < 8; index++) value.append(String.format(java.util.Locale.ROOT, "%02x", hash[index] & 255));
            return value.toString();
        } catch (Exception error) { throw new IllegalStateException("Sensor identity unavailable", error); }
    }

    public static String permission(Sensor sensor) {
        if (sensor.getType() == 21 || sensor.getType() == 31) return Manifest.permission.BODY_SENSORS;
        if (Build.VERSION.SDK_INT >= 29 && (sensor.getType() == 18 || sensor.getType() == 19)) return Manifest.permission.ACTIVITY_RECOGNITION;
        return null;
    }

    public static boolean permitted(Context context, Sensor sensor) {
        String permission = permission(sensor);
        return permission == null || context.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED;
    }

    public static String unit(int type) {
        switch (type) {
            case 1: case 9: case 10: case 35: case 38: case 40: return "m/s²";
            case 2: case 14: return "µT";
            case 4: case 16: case 39: case 41: return "rad/s";
            case 3: case 36: case 42: return "°";
            case 5: return "lux";
            case 6: return "hPa";
            case 7: case 13: return "°C";
            case 8: return "cm";
            case 11: case 15: case 20: return "quaternion";
            case 12: return "%";
            case 19: return "steps";
            case 21: return "bpm";
            default: return "";
        }
    }

    public static String clip(String value, int limit) {
        if (value == null) return "";
        String clean = value.replaceAll("[\\p{Cntrl}]", " ").trim();
        return clean.substring(0, Math.min(limit, clean.length()));
    }
}
