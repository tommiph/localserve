package local.localserve.sensors;

import android.Manifest;
import android.app.*;
import android.app.usage.*;
import android.bluetooth.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.media.*;
import android.media.session.*;
import android.net.*;
import android.os.*;
import android.telephony.*;
import org.json.*;
import java.util.*;

/** Opt-in system callbacks. At most one pending value per kind; packets consume
 * them once. No history, offline replay, device control or cloud connection. */
public final class PhoneEvents {
    public static final String[] IDS={"battery","screen","unlock","network","bluetooth","audio","call","notification","media","app","nfc","button","location","geofence","activity"};
    public static final String[] LABELS={"Battery and charging","Screen and lock state","Phone unlocked","Network connectivity","Bluetooth connections","Audio device connections","Mobile call state","Notifications (selected apps)","Media playback","Foreground app","NFC tags (app open)","Manual button","Location (Android GPS/network)","Named region transitions","Activity transitions (Google Play services)"};
    private static volatile PhoneEvents active;
    private final Context context;
    private final Set<String> selected;
    private final Map<String,JSONObject> pending=new LinkedHashMap<>();
    private final Map<String,String> lastFields=new HashMap<>();
    private final Map<String,Long> lastStamps=new HashMap<>();
    private TravelSources travel;
    private final Set<String> apps;
    private BroadcastReceiver receiver;
    private ConnectivityManager connectivity;
    private ConnectivityManager.NetworkCallback network;
    private AudioManager audio;
    private AudioDeviceCallback audioCallback;
    private TelephonyManager telephony;
    private PhoneStateListener calls;
    private final Handler handler=new Handler(Looper.getMainLooper());
    private String lastPackage="";
    private boolean usageBaseline;
    private long usageSince;
    private MediaSessionManager media;
    private MediaSessionManager.OnActiveSessionsChangedListener sessions;
    private final Map<MediaController,MediaController.Callback> mediaCallbacks=new HashMap<>();

    PhoneEvents(Context context,Set<String> selected) {
        this.context=context;this.selected=new HashSet<>(selected);
        apps=new HashSet<>();
        String configured=context.getSharedPreferences("sender",Context.MODE_PRIVATE).getString("eventApps","");
        for(String name:configured.split(","))if(apps.size()<20 && name.trim().matches("[A-Za-z0-9_]+(?:\\.[A-Za-z0-9_]+)+") && name.trim().length()<=100)apps.add(name.trim());
    }
    public static void emit(String kind,JSONObject fields) {
        emitAt(kind,fields,SystemClock.elapsedRealtimeNanos());
    }
    public static void emitAt(String kind,JSONObject fields,long timestamp) {
        PhoneEvents value=active;if(value==null || !value.selected.contains(kind))return;
        try {synchronized(value.pending){
            // Regions are independently bounded sources. Two region crossings
            // from one fix must not overwrite each other in the next report.
            String key=kind.equals("geofence")?kind+":"+fields.getString("region-id")
                :kind.equals("activity")?kind+":"+fields.getString("activity"):kind;
            if(timestamp<0 || timestamp<=value.lastStamps.getOrDefault(key,-1L))return;
            String current=fields.toString();
            if(!Arrays.asList("unlock","notification","nfc","button","geofence","activity").contains(kind) && current.equals(value.lastFields.get(key)))return;
            value.lastFields.put(key,current);value.lastStamps.put(key,timestamp);
            value.pending.put(key,new JSONObject().put("kind",kind)
            .put("timestampNanos",Long.toString(timestamp)).put("fields",fields));}}
        catch(JSONException ignored){ }
    }
    public static JSONObject fields(Object... pairs) {
        JSONObject object=new JSONObject();
        try {for(int i=0;i<pairs.length;i+=2){Object value=pairs[i+1];if(value instanceof String)value=clip((String)value);object.put((String)pairs[i],value);}}
        catch(JSONException ignored){ }return object;
    }
    static String clip(CharSequence text) {if(text==null)return "";String value=text.toString().replaceAll("[\\p{Cntrl}]"," ");return value.substring(0,Math.min(500,value.length()));}
    public static boolean acceptsApp(String name) {PhoneEvents value=active;return value!=null && value.apps.contains(name);}
    JSONArray drain() {synchronized(pending){
        JSONArray array=new JSONArray();long now=SystemClock.elapsedRealtimeNanos();
        for(JSONObject value:pending.values()) {
            long stamp=value.optLong("timestampNanos",-1);if(stamp<0 || stamp>now || now-stamp>120000000000L)continue;
            try {
                // Location age describes the fix at transmission, not just when
                // Android delivered its callback to us.
                if("location".equals(value.optString("kind")))value.getJSONObject("fields").put("age-ms",(now-stamp)/1000000);
                array.put(value);
            }catch(JSONException ignored){ }
        }
        pending.clear();return array;
    }}
    private boolean permitted(String permission){return context.checkSelfPermission(permission)==PackageManager.PERMISSION_GRANTED;}
    public void start() {
        active=this;
        receiver=new BroadcastReceiver(){public void onReceive(Context ctx,Intent intent){
            if(active!=PhoneEvents.this)return;
            String action=intent.getAction();
            if(Intent.ACTION_BATTERY_CHANGED.equals(action)) {
                int scale=intent.getIntExtra(BatteryManager.EXTRA_SCALE,-1),level=intent.getIntExtra(BatteryManager.EXTRA_LEVEL,-1);
                int state=intent.getIntExtra(BatteryManager.EXTRA_STATUS,-1),plugged=intent.getIntExtra(BatteryManager.EXTRA_PLUGGED,-1);
                JSONObject values=fields("charging",state==BatteryManager.BATTERY_STATUS_CHARGING || state==BatteryManager.BATTERY_STATUS_FULL,"plugged",plugged);
                try {if(scale>0 && level>=0)values.put("percent",100.0*level/scale);if(intent.hasExtra(BatteryManager.EXTRA_TEMPERATURE))values.put("temperature",intent.getIntExtra(BatteryManager.EXTRA_TEMPERATURE,0)/10.0);}catch(JSONException ignored){ }
                emit("battery",values);
            } else if(Intent.ACTION_SCREEN_ON.equals(action) || Intent.ACTION_SCREEN_OFF.equals(action))screen();
            else if(Intent.ACTION_USER_PRESENT.equals(action)){emit("unlock",fields());screen();}
            else if(BluetoothDevice.ACTION_ACL_CONNECTED.equals(action) || BluetoothDevice.ACTION_ACL_DISCONNECTED.equals(action)) {
                if(Build.VERSION.SDK_INT>=31 && !permitted(Manifest.permission.BLUETOOTH_CONNECT))return;
                BluetoothDevice device=intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
                try {emit("bluetooth",fields("connected",BluetoothDevice.ACTION_ACL_CONNECTED.equals(action),"name",device==null?"":device.getName()));}catch(SecurityException ignored){ }
            }
        }};
        IntentFilter filter=new IntentFilter();
        if(selected.contains("battery"))filter.addAction(Intent.ACTION_BATTERY_CHANGED);
        if(selected.contains("screen")){filter.addAction(Intent.ACTION_SCREEN_ON);filter.addAction(Intent.ACTION_SCREEN_OFF);}
        if(selected.contains("unlock") || selected.contains("screen"))filter.addAction(Intent.ACTION_USER_PRESENT);
        if(selected.contains("bluetooth")){filter.addAction(BluetoothDevice.ACTION_ACL_CONNECTED);filter.addAction(BluetoothDevice.ACTION_ACL_DISCONNECTED);}
        // Framework Bluetooth callbacks can originate outside the system UID.
        // Only protected platform actions above are accepted; no custom actions.
        if(filter.countActions()>0){if(Build.VERSION.SDK_INT>=33)context.registerReceiver(receiver,filter,Context.RECEIVER_EXPORTED);else context.registerReceiver(receiver,filter);}
        if(selected.contains("screen"))screen();
        if(selected.contains("network")) {
            connectivity=(ConnectivityManager)context.getSystemService(Context.CONNECTIVITY_SERVICE);
            network=new ConnectivityManager.NetworkCallback(){public void onAvailable(Network n){reportNetwork();}public void onLost(Network n){reportNetwork();}public void onCapabilitiesChanged(Network n,NetworkCapabilities caps){reportNetwork();}};
            connectivity.registerDefaultNetworkCallback(network);reportNetwork();
        }
        if(selected.contains("audio")) {
            audio=(AudioManager)context.getSystemService(Context.AUDIO_SERVICE);
            audioCallback=new AudioDeviceCallback(){boolean initial=true;public void onAudioDevicesAdded(AudioDeviceInfo[] devices){if(initial){initial=false;return;}for(AudioDeviceInfo device:devices)audioEvent(device,true);}public void onAudioDevicesRemoved(AudioDeviceInfo[] devices){for(AudioDeviceInfo device:devices)audioEvent(device,false);}};
            audio.registerAudioDeviceCallback(audioCallback,handler);
        }
        if(selected.contains("call") && permitted(Manifest.permission.READ_PHONE_STATE)) {
            telephony=(TelephonyManager)context.getSystemService(Context.TELEPHONY_SERVICE);
            calls=new PhoneStateListener(){public void onCallStateChanged(int state,String ignoredNumber){emit("call",fields("state",state==TelephonyManager.CALL_STATE_RINGING?"Ringing":state==TelephonyManager.CALL_STATE_OFFHOOK?"Off-hook":"Idle"));}};
            try {telephony.listen(calls,PhoneStateListener.LISTEN_CALL_STATE);}catch(RuntimeException ignored){ }
        }
        if(selected.contains("media")) {
            media=(MediaSessionManager)context.getSystemService(Context.MEDIA_SESSION_SERVICE);
            sessions=this::attachMedia;
            try {ComponentName listener=new ComponentName(context,PhoneNotifications.class);media.addOnActiveSessionsChangedListener(sessions,listener,handler);attachMedia(media.getActiveSessions(listener));}catch(SecurityException ignored){ }
        }
        if(selected.contains("app")){usageSince=System.currentTimeMillis();handler.postDelayed(usage,2000);}
        try {travel=new TravelSources(context,selected);travel.start();}
        catch(JSONException|IllegalArgumentException error){TravelSources.regionStatus="Invalid region settings; edit regions before starting";}
    }
    private void screen(){if(active!=this)return;emit("screen",fields("interactive",((PowerManager)context.getSystemService(Context.POWER_SERVICE)).isInteractive(),"locked",((KeyguardManager)context.getSystemService(Context.KEYGUARD_SERVICE)).isKeyguardLocked()));}
    private void reportNetwork(){if(active!=this)return;Network current=connectivity.getActiveNetwork();NetworkCapabilities caps=current==null?null:connectivity.getNetworkCapabilities(current);emit("network",fields("connected",caps!=null,"wifi",caps!=null && caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI),"internet",caps!=null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED),"metered",connectivity.isActiveNetworkMetered()));}
    private void audioEvent(AudioDeviceInfo device,boolean connected){if(active!=this)return;emit("audio",fields("connected",connected,"name",clip(device.getProductName()),"type",device.getType()));}
    private void mediaEvent(MediaController controller){if(active!=this)return;MediaMetadata data=controller.getMetadata();PlaybackState state=controller.getPlaybackState();JSONObject values=fields("package",controller.getPackageName());try{if(data!=null){values.put("title",clip(data.getText(MediaMetadata.METADATA_KEY_TITLE)));values.put("artist",clip(data.getText(MediaMetadata.METADATA_KEY_ARTIST)));}if(state!=null)values.put("state",state.getState());}catch(JSONException ignored){ }emit("media",values);}
    private void attachMedia(List<MediaController> controllers){
        if(active!=this)return;
        for(Map.Entry<MediaController,MediaController.Callback> entry:mediaCallbacks.entrySet())entry.getKey().unregisterCallback(entry.getValue());mediaCallbacks.clear();
        for(MediaController controller:controllers.subList(0,Math.min(8,controllers.size()))){
            MediaController.Callback callback=new MediaController.Callback(){public void onPlaybackStateChanged(PlaybackState state){mediaEvent(controller);}public void onMetadataChanged(MediaMetadata metadata){mediaEvent(controller);}};
            mediaCallbacks.put(controller,callback);controller.registerCallback(callback,handler);mediaEvent(controller);
        }
    }
    private final Runnable usage=new Runnable(){public void run(){
        if(active!=PhoneEvents.this)return;
        long at=System.currentTimeMillis();UsageStatsManager manager=(UsageStatsManager)context.getSystemService(Context.USAGE_STATS_SERVICE);
        UsageEvents events=null;try{events=manager.queryEvents(usageSince,at);}catch(RuntimeException ignored){ }usageSince=at;String current=lastPackage;
        if(events!=null){UsageEvents.Event event=new UsageEvents.Event();int count=0;while(events.hasNextEvent() && count++<1000){events.getNextEvent(event);if(event.getEventType()==UsageEvents.Event.ACTIVITY_RESUMED)current=event.getPackageName();}}
        if(usageBaseline && !current.equals(lastPackage))emit("app",fields("package",current));lastPackage=current;usageBaseline=true;handler.postDelayed(this,5000);
    }};
    public void stop(){
        if(active==this)active=null;handler.removeCallbacksAndMessages(null);
        if(travel!=null)travel.stop();
        if(receiver!=null)try{context.unregisterReceiver(receiver);}catch(IllegalArgumentException ignored){ }
        if(network!=null)connectivity.unregisterNetworkCallback(network);
        if(audioCallback!=null)audio.unregisterAudioDeviceCallback(audioCallback);
        if(calls!=null)try{telephony.listen(calls,PhoneStateListener.LISTEN_NONE);}catch(RuntimeException ignored){ }
        if(sessions!=null)try{media.removeOnActiveSessionsChangedListener(sessions);}catch(RuntimeException ignored){ }
        for(Map.Entry<MediaController,MediaController.Callback> entry:mediaCallbacks.entrySet())entry.getKey().unregisterCallback(entry.getValue());mediaCallbacks.clear();
        synchronized(pending){pending.clear();lastFields.clear();lastStamps.clear();}
    }
}
