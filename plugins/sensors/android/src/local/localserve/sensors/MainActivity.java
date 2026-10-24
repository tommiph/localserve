package local.localserve.sensors;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.hardware.Sensor;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.view.View;
import android.widget.*;
import java.net.URI;
import java.util.*;

/** Native reporting setup: sampling, selected sources and explicit Start/Stop.
 * User settings remain local and reporting starts only through explicit input. */
public final class MainActivity extends Activity {
    private final Handler ui = new Handler();
    private final Map<String, CheckBox> choices = new LinkedHashMap<>();
    private SharedPreferences preferences;
    private EditText server, name;
    private Spinner sampling, reporting;
    private CheckBox keepAwake;
    private final Map<String,CheckBox> eventChoices=new LinkedHashMap<>();
    private EditText eventApps;
    private Spinner locationInterval;
    private RegionSettings regions;
    private TextView status;
    private Button start, stop;
    private boolean startAfterPermissions;
    private ControllerStyle style;
    private final int[] samplingMs = {5, 10, 20, 50, 100, 200, 1000};
    private final int[] reportingMs = {250, 500, 1000, 2000, 5000, 10000, 30000, 60000};
    private final Runnable update = new Runnable() {
        public void run() {
            boolean running = SensorService.running;
            status.setText(SensorService.status+"\n"+TravelSources.locationStatus+"\n"+TravelSources.regionStatus+"\n"+TravelSources.activityStatus);
            start.setEnabled(!running); stop.setEnabled(running);
            server.setEnabled(!running); name.setEnabled(!running);
            sampling.setEnabled(!running); reporting.setEnabled(!running); keepAwake.setEnabled(!running);
            for (CheckBox choice : choices.values()) choice.setEnabled(!running);
            for (CheckBox choice : eventChoices.values()) choice.setEnabled(!running);
            eventApps.setEnabled(!running);
            locationInterval.setEnabled(!running);regions.setEditable(!running);
            ui.postDelayed(this, 1000);
        }
    };

    @Override public void onCreate(Bundle saved) {
        if(!getSharedPreferences("sender",MODE_PRIVATE).getBoolean("relayDark",true))setTheme(R.style.ControllerLight);
        super.onCreate(saved);
        preferences = getSharedPreferences("sender", MODE_PRIVATE);
        style=new ControllerStyle(this);
        if (!preferences.contains("deviceId")) preferences.edit().putString("deviceId", "android-" + UUID.randomUUID()).apply();
        ScrollView scroll = new ScrollView(this);
        LinearLayout content = new LinearLayout(this); content.setOrientation(LinearLayout.VERTICAL);
        final LinearLayout page=content;
        int padding = dp(20); content.setPadding(padding, padding, padding, padding);
        content.setBackgroundColor(style.background);scroll.setBackgroundColor(style.background);scroll.addView(content);setContentView(scroll);
        // API 35 uses edge-to-edge windows. Keep controls clear of the status
        // and navigation bars while retaining compatibility with Android 8.
        scroll.setOnApplyWindowInsetsListener((view, insets) -> {
            page.setPadding(padding + insets.getSystemWindowInsetLeft(), padding + insets.getSystemWindowInsetTop(),
                padding + insets.getSystemWindowInsetRight(), padding + insets.getSystemWindowInsetBottom());
            return insets.consumeSystemWindowInsets();
        });
        scroll.requestApplyInsets();
        page.addView(style.button("‹  Settings",()->finish()));
        label(content, "Phone reporting", 26);
        label(content,"Choose what this phone shares. Reporting starts only when you tap Start.",15);
        label(content, "Device name", 17);
        name = input(content, "Device name", preferences.getString("name", SensorCatalog.clip(Build.MODEL, 32)));
        label(content, "Connection is managed in Controller Settings. Reporting uses local network first and the approved relay when away.", 14);
        server = new EditText(this);server.setText(preferences.getString("server", ""));
        server.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_URI);
        LinearLayout timing=section(page,"Reporting frequency",false);
        label(timing, "Sampling interval", 17); sampling = select(timing, samplingMs, preferences.getInt("samplingMs", 50));
        label(timing, "Report interval", 17); reporting = select(timing, reportingMs, preferences.getInt("reportingMs", 1000));
        label(timing, "Each report contains the latest raw value of each selected sensor. Remote reports use the server's lower cloud frequency.", 14);
        keepAwake = new CheckBox(this); keepAwake.setText("Keep CPU awake while streaming");
        keepAwake.setChecked(preferences.getBoolean("keepAwake", false)); timing.addView(keepAwake);
        LinearLayout buttons = new LinearLayout(this);
        start = new Button(this); start.setText("Start"); buttons.addView(start, new LinearLayout.LayoutParams(0, dp(52), 1));
        stop = new Button(this); stop.setText("Stop"); buttons.addView(stop, new LinearLayout.LayoutParams(0, dp(52), 1)); content.addView(buttons);
        status = label(content, "Stopped", 15);
        content=section(page,"Phone events",false);
        Set<String> enabledEvents=preferences.getStringSet("phoneEvents",Collections.emptySet());
        for(int i=0;i<PhoneEvents.IDS.length;i++){
            CheckBox choice=new CheckBox(this);choice.setText(PhoneEvents.LABELS[i]);choice.setChecked(enabledEvents.contains(PhoneEvents.IDS[i]));
            eventChoices.put(PhoneEvents.IDS[i],choice);content.addView(choice);
        }
        label(content,"Notification apps (comma-separated package names; blank sends none)",14);
        eventApps=input(content,"org.example.app, another.app",preferences.getString("eventApps",""));
        eventApps.setFilters(new android.text.InputFilter[]{new android.text.InputFilter.LengthFilter(2000)});
        Button access=new Button(this);access.setText("Notification / media access");content.addView(access);
        access.setOnClickListener(view->startActivity(new Intent(android.provider.Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)));
        Button usage=new Button(this);usage.setText("App usage access");content.addView(usage);
        usage.setOnClickListener(view->startActivity(new Intent(android.provider.Settings.ACTION_USAGE_ACCESS_SETTINGS)));
        label(content,"Notification/media and app usage sources require the corresponding Android access above. Restart streaming after granting access. NFC reads only while this screen is open.",14);
        Button manual=new Button(this);manual.setText("Send manual event");content.addView(manual);
        manual.setOnClickListener(view->{PhoneEvents.emit("button",PhoneEvents.fields("name","Manual button"));Toast.makeText(this,SensorService.running?"Manual event requested":"Start streaming first",Toast.LENGTH_SHORT).show();});
        content=section(page,"Location and regions",false);
        label(content,"Location interval",17);
        locationInterval=select(content,new int[]{5000,15000,30000,60000,120000},preferences.getInt("locationMs",30000));
        label(content,"Location/regions run only while you explicitly stream, with Android location enabled. Approximate permission may leave region boundaries uncertain. Region edits require Stop. New/copied regions start disabled.",14);
        regions=new RegionSettings(this,content);
        label(content,"Activity uses Google Play services' Walking, Running, Cycling, In vehicle and Still reports. Grant Physical activity access. In vehicle does not identify the driver. No radio/room analysis is performed.",14);
        Button licenses=new Button(this);licenses.setText("Third-party licenses");page.addView(licenses);
        licenses.setOnClickListener(view->{
            try(java.io.InputStream input=getAssets().open("licenses.txt")){
                java.io.ByteArrayOutputStream bytes=new java.io.ByteArrayOutputStream();byte[] buffer=new byte[4096];int count;
                while((count=input.read(buffer))!=-1){if(bytes.size()+count>3000000)throw new java.io.IOException("License text exceeds viewer limit");bytes.write(buffer,0,count);}
                TextView text=new TextView(this);text.setText(new String(bytes.toByteArray(),java.nio.charset.StandardCharsets.UTF_8));text.setPadding(dp(16),dp(8),dp(16),dp(8));
                ScrollView viewer=new ScrollView(this);viewer.addView(text);ControllerStyle.dialog(this).setTitle("Third-party licenses").setView(viewer).setPositiveButton("Close",null).show();
            }catch(java.io.IOException error){Toast.makeText(this,"License text unavailable",Toast.LENGTH_LONG).show();}
        });
        content=section(page,"Hardware sensors",false);
        label(content,"Only sensors available on this phone are listed. Turn off sources you do not need.",14);
        Set<String> selected = preferences.getStringSet("selected", null);
        for (Map.Entry<String, Sensor> entry : SensorCatalog.available(this).entrySet()) {
            Sensor sensor = entry.getValue();
            CheckBox choice = new CheckBox(this);
            choice.setText(sensor.getName() + "\n" + sensor.getStringType() + (SensorCatalog.unit(sensor.getType()).isEmpty() ? "" : " · " + SensorCatalog.unit(sensor.getType())));
            choice.setChecked(selected == null ? SensorCatalog.permission(sensor) == null : selected.contains(entry.getKey()));
            choice.setPadding(0, dp(8), 0, dp(8)); content.addView(choice); choices.put(entry.getKey(), choice);
        }
        if (choices.isEmpty()) label(content, "No sensors reported by Android.", 15);
        start.setOnClickListener(view -> prepareStart());
        stop.setOnClickListener(view -> { startAfterPermissions = false; stopService(new Intent(this, SensorService.class)); });
        style.tree(page);
    }

    /** Numeric RFC1918 destinations only: no DNS, credentials or redirects. */
    static String serverOrigin(String text) throws Exception {
        URI uri = new URI(text.trim()); String host = uri.getHost();
        if (!"http".equals(uri.getScheme()) || host == null || uri.getUserInfo() != null
            || uri.getQuery() != null || uri.getFragment() != null || uri.getPort() == 0 || uri.getPort() > 65535
            || !(uri.getPath().isEmpty() || "/".equals(uri.getPath())) || !host.matches("[0-9]+\\.[0-9]+\\.[0-9]+\\.[0-9]+")) throw new Exception();
        String[] parts = host.split("\\."); int[] octets = new int[4];
        for (int i = 0; i < 4; i++) { octets[i] = Integer.parseInt(parts[i]); if (octets[i] > 255 || !parts[i].equals(Integer.toString(octets[i]))) throw new Exception(); }
        if (!(octets[0] == 10 || octets[0] == 172 && octets[1] >= 16 && octets[1] <= 31 || octets[0] == 192 && octets[1] == 168)) throw new Exception();
        return "http://" + host + (uri.getPort() < 0 ? "" : ":" + uri.getPort());
    }

    private void prepareStart() {
        try {
            boolean manualRelay=!preferences.getBoolean("automaticConnection",false)&&preferences.getBoolean("relayMode",false);
            String origin = manualRelay?preferences.getString("server",""):serverOrigin(server.getText().toString());
            if(manualRelay)new local.localserve.relay.RelayClient(preferences.getString("relayProfile","")).close();
            String deviceName = SensorCatalog.clip(name.getText().toString(), 32);
            if (deviceName.isEmpty()) throw new Exception();
            Set<String> selected = new HashSet<>(); for (Map.Entry<String, CheckBox> entry : choices.entrySet()) if (entry.getValue().isChecked()) selected.add(entry.getKey());
            Set<String> selectedEvents=new HashSet<>();for(Map.Entry<String,CheckBox> entry:eventChoices.entrySet())if(entry.getValue().isChecked())selectedEvents.add(entry.getKey());
            if (selected.isEmpty() && selectedEvents.isEmpty()) { Toast.makeText(this, "Select at least one sensor or phone event", Toast.LENGTH_LONG).show(); return; }
            if(selectedEvents.contains("geofence") && RegionSettings.read(preferences).stream().noneMatch(region->region.enabled)){
                Toast.makeText(this,"Add and enable at least one named region",Toast.LENGTH_LONG).show();return;
            }
            preferences.edit().putString("server", origin).putString("name", deviceName).putStringSet("selected", selected)
                .putInt("samplingMs", samplingMs[sampling.getSelectedItemPosition()]).putInt("reportingMs", reportingMs[reporting.getSelectedItemPosition()])
                .putBoolean("keepAwake", keepAwake.isChecked()).putStringSet("phoneEvents",selectedEvents).putString("eventApps",eventApps.getText().toString().trim())
                .putInt("locationMs",new int[]{5000,15000,30000,60000,120000}[locationInterval.getSelectedItemPosition()]).apply();
            Set<String> permissions = new HashSet<>();
            if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) permissions.add(Manifest.permission.POST_NOTIFICATIONS);
            if(selectedEvents.contains("call") && checkSelfPermission(Manifest.permission.READ_PHONE_STATE)!=PackageManager.PERMISSION_GRANTED)permissions.add(Manifest.permission.READ_PHONE_STATE);
            if(Build.VERSION.SDK_INT>=31 && selectedEvents.contains("bluetooth") && checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT)!=PackageManager.PERMISSION_GRANTED)permissions.add(Manifest.permission.BLUETOOTH_CONNECT);
            if(TravelSources.locationSelected(selectedEvents) && checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)!=PackageManager.PERMISSION_GRANTED
                && checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)!=PackageManager.PERMISSION_GRANTED){
                // Android 12+ requires requesting coarse and fine together; the
                // user may choose approximate access and other sources continue.
                permissions.add(Manifest.permission.ACCESS_COARSE_LOCATION);permissions.add(Manifest.permission.ACCESS_FINE_LOCATION);
            }
            if(Build.VERSION.SDK_INT>=29 && selectedEvents.contains("activity") && checkSelfPermission(Manifest.permission.ACTIVITY_RECOGNITION)!=PackageManager.PERMISSION_GRANTED)permissions.add(Manifest.permission.ACTIVITY_RECOGNITION);
            for (Map.Entry<String, Sensor> entry : SensorCatalog.available(this).entrySet()) {
                String permission = SensorCatalog.permission(entry.getValue());
                if (selected.contains(entry.getKey()) && permission != null && checkSelfPermission(permission) != PackageManager.PERMISSION_GRANTED) permissions.add(permission);
            }
            if (!permissions.isEmpty()) { startAfterPermissions = true; requestPermissions(permissions.toArray(new String[0]), 10); }
            else begin();
        } catch (Exception error) { Toast.makeText(this, "Enter a device name and an HTTP private LAN server address", Toast.LENGTH_LONG).show(); }
    }
    private void begin() { startForegroundService(new Intent(this, SensorService.class));enableNfc(); }
    @Override public void onRequestPermissionsResult(int request, String[] permissions, int[] grants) {
        super.onRequestPermissionsResult(request, permissions, grants);
        if (request == 10 && startAfterPermissions) { startAfterPermissions = false; begin(); }
    }
    @Override public void onResume() {
        super.onResume();ui.post(update);enableNfc();
    }
    private void enableNfc(){
        android.nfc.NfcAdapter nfc=android.nfc.NfcAdapter.getDefaultAdapter(this);
        if(nfc!=null && preferences.getStringSet("phoneEvents",Collections.emptySet()).contains("nfc"))nfc.enableReaderMode(this,tag->{
            StringBuilder id=new StringBuilder();for(byte part:tag.getId())id.append(String.format(java.util.Locale.ROOT,"%02x",part & 255));
            PhoneEvents.emit("nfc",PhoneEvents.fields("tag",id.toString(),"technology",android.text.TextUtils.join(",",tag.getTechList())));
        },android.nfc.NfcAdapter.FLAG_READER_NFC_A|android.nfc.NfcAdapter.FLAG_READER_NFC_B|android.nfc.NfcAdapter.FLAG_READER_NFC_F|android.nfc.NfcAdapter.FLAG_READER_NFC_V,null);
    }
    @Override public void onPause() { ui.removeCallbacks(update);android.nfc.NfcAdapter nfc=android.nfc.NfcAdapter.getDefaultAdapter(this);if(nfc!=null)nfc.disableReaderMode(this);super.onPause(); }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private TextView label(LinearLayout parent, String text, int size) {
        TextView view=style.label(text,size);parent.addView(view);return view;
    }
    private EditText input(LinearLayout parent, String hint, String value) {
        EditText view = new EditText(this); view.setSingleLine(true); view.setHint(hint); view.setText(value);style.field(view);parent.addView(view);return view;
    }
    private Spinner select(LinearLayout parent, int[] values, int selected) {
        Spinner view = new Spinner(this); List<String> labels = new ArrayList<>(); int chosen = 0;
        for (int i = 0; i < values.length; i++) { labels.add(values[i] + " ms"); if (values[i] == selected) chosen = i; }
        ArrayAdapter<String> adapter = new ArrayAdapter<String>(this, android.R.layout.simple_spinner_dropdown_item, labels){
            @Override public android.view.View getView(int position,android.view.View recycled,android.view.ViewGroup container){TextView result=(TextView)super.getView(position,recycled,container);result.setTextColor(style.ink);result.setTextSize(16);return result;}
            @Override public android.view.View getDropDownView(int position,android.view.View recycled,android.view.ViewGroup container){TextView result=(TextView)super.getDropDownView(position,recycled,container);result.setTextColor(style.ink);result.setBackgroundColor(style.surface);result.setMinHeight(dp(52));return result;}
        };
        view.setAdapter(adapter); view.setSelection(chosen); parent.addView(view); return view;
    }
    private LinearLayout section(LinearLayout parent,String title,boolean expanded){
        LinearLayout box=new LinearLayout(this);box.setOrientation(LinearLayout.VERTICAL);box.setPadding(dp(12),dp(4),dp(12),dp(12));box.setBackground(style.shape(style.surface,20));LinearLayout.LayoutParams space=style.slot();space.topMargin=dp(14);parent.addView(box,space);
        LinearLayout body=new LinearLayout(this);body.setOrientation(LinearLayout.VERTICAL);body.setVisibility(expanded?View.VISIBLE:View.GONE);
        Button header=style.button(title+(expanded?"  −":"  +"),()->{});header.setContentDescription(title+(expanded?", expanded":", collapsed"));box.addView(header);box.addView(body);
        header.setOnClickListener(view->{boolean open=body.getVisibility()!=View.VISIBLE;body.setVisibility(open?View.VISIBLE:View.GONE);header.setText(title+(open?"  −":"  +"));header.setContentDescription(title+(open?", expanded":", collapsed"));if(open&&android.animation.ValueAnimator.areAnimatorsEnabled()){body.setAlpha(0);body.animate().alpha(1).setDuration(160).start();}});return body;
    }
}
