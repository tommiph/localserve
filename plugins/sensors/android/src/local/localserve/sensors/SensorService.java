package local.localserve.sensors;

import android.app.*;
import android.content.*;
import android.content.pm.ServiceInfo;
import android.hardware.*;
import android.location.LocationManager;
import android.Manifest;
import android.content.pm.PackageManager;
import android.os.*;
import org.json.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;

/** Explicit foreground streaming with one serial network operation. Sensor
 * callbacks only copy raw values; there is no sample history/offline queue. */
public final class SensorService extends Service implements SensorEventListener {
    public static volatile boolean running;
    public static volatile String status = "Stopped";
    private static final String STOP = "local.localserve.sensors.STOP";
    private final Object samplesLock = new Object();
    private final Map<String, Sample> latest = new HashMap<>();
    private final Map<String, String> sensorStatus = new ConcurrentHashMap<>();
    private final Map<Sensor, String> identities = new ConcurrentHashMap<>();
    private LinkedHashMap<String, Sensor> sensors;
    private SensorManager manager;
    private HandlerThread samplingThread;
    private ScheduledExecutorService network;
    private PhoneEvents phoneEvents;
    private PowerManager.WakeLock wakeLock;
    private volatile HttpURLConnection connection;
    private volatile boolean stopped;
    private String endpoint, deviceId, deviceName, sessionId;
    private Set<String> selected;
    private int sampleMicros, userInterval, serverInterval = 0, failures = 0;
    private long sequence = 0, sent = 0, wakeRenewedAt = 0;

    private static final class Sample {
        final float[] values; final int accuracy; final long timestamp;
        Sample(float[] values, int accuracy, long timestamp) {
            this.values = Arrays.copyOf(values, Math.min(16, values.length)); this.accuracy = accuracy; this.timestamp = timestamp;
        }
    }
    private final TriggerEventListener trigger = new TriggerEventListener() {
        @Override public void onTrigger(TriggerEvent event) {
            record(event.sensor, event.values, -1, event.timestamp);
            if (!stopped) manager.requestTriggerSensor(this, event.sensor);
        }
    };

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && STOP.equals(intent.getAction())) { stopSelf(); return START_NOT_STICKY; }
        if (running) return START_NOT_STICKY;
        SharedPreferences preferences = getSharedPreferences("sender", MODE_PRIVATE);
        try { endpoint = MainActivity.serverOrigin(preferences.getString("server", "")) + "/api/sensors/report"; }
        catch (Exception error) { status = "Set a private LAN server address first"; stopSelf(); return START_NOT_STICKY; }
        deviceId = preferences.getString("deviceId", ""); deviceName = preferences.getString("name", "Android");
        sessionId = UUID.randomUUID().toString();
        selected = new HashSet<>(preferences.getStringSet("selected", Collections.emptySet()));
        sampleMicros = Math.max(5000, preferences.getInt("samplingMs", 50) * 1000);
        userInterval = Math.max(250, preferences.getInt("reportingMs", 1000));
        try {
            NotificationManager notifications = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            notifications.createNotificationChannel(new NotificationChannel("stream", "Sensor streaming", NotificationManager.IMPORTANCE_LOW));
            PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            PendingIntent stop = PendingIntent.getService(this, 1, new Intent(this, SensorService.class).setAction(STOP), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            Notification notice = new Notification.Builder(this, "stream").setSmallIcon(android.R.drawable.ic_menu_compass)
                .setContentTitle("Localserve Sensors").setContentText("Sending selected sources · " + deviceName)
                .setContentIntent(open).setOngoing(true).addAction(new Notification.Action.Builder(null, "Stop", stop).build()).build();
            Set<String> phoneSources=preferences.getStringSet("phoneEvents",Collections.emptySet());
            boolean locationPermitted=checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)==PackageManager.PERMISSION_GRANTED
                || checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED;
            LocationManager locations=(LocationManager)getSystemService(LOCATION_SERVICE);
            boolean locationEnabled=Build.VERSION.SDK_INT>=28?locations.isLocationEnabled():!locations.getProviders(true).isEmpty();
            int foregroundTypes=Build.VERSION.SDK_INT>=34?ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE:0;
            if(Build.VERSION.SDK_INT>=29 && TravelSources.locationSelected(phoneSources) && locationPermitted && locationEnabled)foregroundTypes|=ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION;
            if(Build.VERSION.SDK_INT>=29 && foregroundTypes!=0)startForeground(1,notice,foregroundTypes);else startForeground(1,notice);
            stopped = false; running = true; status = "Starting sensors";
            manager = (SensorManager) getSystemService(SENSOR_SERVICE); sensors = SensorCatalog.available(this);
            for (Map.Entry<String, Sensor> entry : sensors.entrySet()) identities.put(entry.getValue(), entry.getKey());
            samplingThread = new HandlerThread("Localserve sensor sampling"); samplingThread.start();
            Handler handler = new Handler(samplingThread.getLooper());
            for (Map.Entry<String, Sensor> entry : sensors.entrySet()) {
                String id = entry.getKey(); Sensor sensor = entry.getValue();
                if (!selected.contains(id)) { sensorStatus.put(id, "Not selected"); continue; }
                if (!SensorCatalog.permitted(this, sensor)) { sensorStatus.put(id, "Permission required"); continue; }
                try {
                    boolean registered = sensor.getReportingMode() == Sensor.REPORTING_MODE_ONE_SHOT
                        ? manager.requestTriggerSensor(trigger, sensor)
                        : manager.registerListener(this, sensor, sampleMicros, 0, handler);
                    sensorStatus.put(id, registered ? "Streaming" : "Unavailable");
                } catch (SecurityException error) { sensorStatus.put(id, "Permission required"); }
                catch (RuntimeException error) { sensorStatus.put(id, "Unavailable"); }
            }
            if (preferences.getBoolean("keepAwake", false)) {
                PowerManager power = (PowerManager) getSystemService(POWER_SERVICE);
                wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "localserve:sensors");
                renewWakeLock();
            }
            phoneEvents = new PhoneEvents(this,new HashSet<>(preferences.getStringSet("phoneEvents",Collections.emptySet())));
            phoneEvents.start();
            network = Executors.newSingleThreadScheduledExecutor(); network.execute(this::report);
        } catch (RuntimeException error) { status = "Unable to start streaming: " + error.getClass().getSimpleName(); stopSelf(); }
        return START_NOT_STICKY;
    }

    private void renewWakeLock() {
        if (wakeLock != null && (SystemClock.elapsedRealtime() - wakeRenewedAt >= 240000 || !wakeLock.isHeld())) {
            // Reference counting is disabled; renew the bounded owned lock only.
            wakeLock.setReferenceCounted(false); wakeLock.acquire(600000); wakeRenewedAt = SystemClock.elapsedRealtime();
        }
    }
    @Override public void onSensorChanged(SensorEvent event) { record(event.sensor, event.values, event.accuracy, event.timestamp); }
    @Override public void onAccuracyChanged(Sensor sensor, int accuracy) { /* Accuracy travels with each actual sample. */ }
    private void record(Sensor sensor, float[] values, int accuracy, long timestamp) {
        if (stopped || values.length == 0 || timestamp < 0) return;
        String id = identities.get(sensor);
        if (id == null) return;
        for (float value : values) if (Float.isNaN(value) || Float.isInfinite(value)) return;
        synchronized (samplesLock) { latest.put(id, new Sample(values, accuracy, timestamp)); }
    }

    private JSONObject packet() throws JSONException {
        Map<String, Sample> snapshot; synchronized (samplesLock) { snapshot = new HashMap<>(latest); }
        JSONArray catalog = new JSONArray(), readings = new JSONArray(); long at = SystemClock.elapsedRealtimeNanos();
        for (Map.Entry<String, Sensor> entry : sensors.entrySet()) {
            String id = entry.getKey(); Sensor sensor = entry.getValue();
            JSONObject description = new JSONObject();
            description.put("id", id).put("type", sensor.getType()).put("stringType", SensorCatalog.clip(sensor.getStringType(), 100))
                .put("name", SensorCatalog.clip(sensor.getName(), 80)).put("vendor", SensorCatalog.clip(sensor.getVendor(), 64))
                .put("unit", SensorCatalog.unit(sensor.getType())).put("selected", selected.contains(id))
                .put("status", sensorStatus.get(id)).put("reportingMode", sensor.getReportingMode())
                .put("resolution", sensor.getResolution()).put("maximumRange", sensor.getMaximumRange())
                .put("powerMa", sensor.getPower()).put("minDelayUs", Math.max(0, sensor.getMinDelay()));
            catalog.put(description);
            Sample sample = snapshot.get(id);
            if (sample == null) continue;
            long age = Math.max(0, (at - sample.timestamp) / 1000000);
            if (age > 120000) continue;
            JSONArray values = new JSONArray(); for (float value : sample.values) values.put((double) value);
            readings.put(new JSONObject().put("sensorId", id).put("values", values).put("accuracy", sample.accuracy)
                .put("timestampNanos", Long.toString(sample.timestamp)).put("ageMs", age));
        }
        return new JSONObject().put("version", 1).put("deviceId", deviceId).put("deviceName", deviceName)
            .put("sessionId", sessionId).put("sequence", ++sequence).put("sentAt", System.currentTimeMillis()).put("catalog", catalog).put("readings", readings)
            .put("phoneEvents",phoneEvents==null?new JSONArray():phoneEvents.drain());
    }

    private void report() {
        if (stopped) return;
        int delay = Math.max(userInterval, serverInterval);
        try {
            renewWakeLock(); byte[] data = packet().toString().getBytes(StandardCharsets.UTF_8);
            if (data.length > 65536) throw new IOException("Select fewer sensors (report exceeds 64 KiB)");
            HttpURLConnection current = (HttpURLConnection) new URL(endpoint).openConnection(Proxy.NO_PROXY); connection = current;
            current.setRequestMethod("POST"); current.setInstanceFollowRedirects(false); current.setConnectTimeout(3000); current.setReadTimeout(3000);
            current.setRequestProperty("Content-Type", "application/json"); current.setRequestProperty("X-Localserve-Sensors", "1");
            current.setDoOutput(true); current.setFixedLengthStreamingMode(data.length);
            try (OutputStream out = current.getOutputStream()) { if (stopped) return; out.write(data); }
            int code = current.getResponseCode();
            InputStream body = code < 400 ? current.getInputStream() : current.getErrorStream();
            String text = readBounded(body);
            if (code == 200) {
                JSONObject response = new JSONObject(text);
                serverInterval = Math.max(250, Math.min(60000, response.optInt("reportIntervalMs", 1000)));
                delay = Math.max(userInterval, serverInterval); failures = 0;
                status = "Streaming · " + (++sent) + " reports sent";
            } else {
                failures = Math.min(5, failures + 1); delay = Math.max(delay, Math.min(30000, 1000 << failures));
                status = "Server " + code + " · " + new JSONObject(text).optString("error", "Waiting for next fresh report");
            }
        } catch (Exception error) {
            failures = Math.min(5, failures + 1); delay = Math.max(delay, Math.min(30000, 1000 << failures));
            if (!stopped) status = "Waiting for server · " + error.getClass().getSimpleName();
        } finally {
            HttpURLConnection current = connection; connection = null; if (current != null) current.disconnect();
            // Schedule after completion. Never queue/retry the failed packet;
            // the next tick takes a new snapshot and advances sequence once.
            if (!stopped && network != null && !network.isShutdown()) network.schedule(this::report, delay, TimeUnit.MILLISECONDS);
        }
    }
    private static String readBounded(InputStream input) throws IOException {
        if (input == null) return "{}";
        try (InputStream source = input; ByteArrayOutputStream target = new ByteArrayOutputStream()) {
            byte[] bytes = new byte[1024]; int count;
            while ((count = source.read(bytes)) != -1) { if (target.size() + count > 4096) throw new IOException("Oversized server response"); target.write(bytes, 0, count); }
            return new String(target.toByteArray(), StandardCharsets.UTF_8);
        }
    }
    @Override public void onDestroy() {
        stopped = true; running = false;
        if(phoneEvents!=null)phoneEvents.stop();
        if (manager != null) { manager.unregisterListener(this); if (sensors != null) for (Sensor sensor : sensors.values()) manager.cancelTriggerSensor(trigger, sensor); }
        HttpURLConnection current = connection; if (current != null) current.disconnect();
        if (network != null) network.shutdownNow();
        if (samplingThread != null) samplingThread.quitSafely();
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        synchronized (samplesLock) { latest.clear(); }
        status = "Stopped"; stopForeground(STOP_FOREGROUND_REMOVE); super.onDestroy();
    }
    @Override public IBinder onBind(Intent intent) { return null; }
}
