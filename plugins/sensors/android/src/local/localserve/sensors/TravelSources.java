package local.localserve.sensors;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.location.*;
import android.os.*;
import com.google.android.gms.common.*;
import com.google.android.gms.location.ActivityRecognition;
import com.google.android.gms.location.ActivityRecognitionClient;
import com.google.android.gms.location.ActivityTransition;
import com.google.android.gms.location.ActivityTransitionEvent;
import com.google.android.gms.location.ActivityTransitionRequest;
import com.google.android.gms.location.ActivityTransitionResult;
import com.google.android.gms.location.DetectedActivity;
import org.json.*;
import java.util.*;

/** User-started foreground location and provider-reported activity transitions.
 * No background-location grant, last-known fix, track log, radio analysis,
 * account/login, automatic service start or unavailable-provider inference. */
public final class TravelSources implements LocationListener {
    public static volatile String locationStatus="Location off",regionStatus="Regions off",activityStatus="Activity off";
    private static volatile TravelSources active;
    private final Context context;
    private final Set<String> selected;
    private final List<RegionRules.Region> regions;
    private final RegionRules tracker=new RegionRules();
    private final String generation=UUID.randomUUID().toString();
    private final Handler handler=new Handler(Looper.getMainLooper());
    private final Set<String> providers=new HashSet<>();
    private LocationManager locations;
    private ActivityRecognitionClient recognition;
    private PendingIntent activityIntent;
    private volatile boolean stopped;
    private long registeredAt;
    private long lastFix;

    TravelSources(Context context,Set<String> selected) throws JSONException {
        this.context=context;this.selected=new HashSet<>(selected);
        regions=selected.contains("geofence")?RegionSettings.read(context.getSharedPreferences("sender",Context.MODE_PRIVATE)):Collections.emptyList();
    }
    public static boolean locationSelected(Set<String> selected){return selected.contains("location")||selected.contains("geofence");}
    private boolean permitted(String permission){return context.checkSelfPermission(permission)==PackageManager.PERMISSION_GRANTED;}
    public void start() {
        active=this;locationStatus="Location off";regionStatus=selected.contains("geofence")?"Regions waiting for a fresh fix":"Regions off";activityStatus="Activity off";
        if(locationSelected(selected))startLocation();
        if(selected.contains("activity"))startActivity();
    }
    private void startLocation() {
        if(!permitted(Manifest.permission.ACCESS_COARSE_LOCATION) && !permitted(Manifest.permission.ACCESS_FINE_LOCATION)){
            locationStatus="Location permission required";regionStatus=selected.contains("geofence")?"Regions: location permission required":"Regions off";return;
        }
        locations=(LocationManager)context.getSystemService(Context.LOCATION_SERVICE);
        int interval=context.getSharedPreferences("sender",Context.MODE_PRIVATE).getInt("locationMs",30000);
        if(!Arrays.asList(5000,15000,30000,60000,120000).contains(interval))interval=30000;
        // Only documented Android providers; no scanning or provider enablement.
        for(String provider:Arrays.asList(LocationManager.GPS_PROVIDER,LocationManager.NETWORK_PROVIDER)) {
            if(provider.equals(LocationManager.GPS_PROVIDER) && !permitted(Manifest.permission.ACCESS_FINE_LOCATION))continue;
            try {if(locations.isProviderEnabled(provider)){locations.requestLocationUpdates(provider,interval,0,this,Looper.getMainLooper());providers.add(provider);}}
            catch(SecurityException error){locationStatus="Location permission required";}
            catch(IllegalArgumentException ignored){ /* Provider not supplied by this device. */ }
        }
        if(providers.isEmpty())locationStatus="Location unavailable: enable a location provider";
        else locationStatus="Waiting for a fresh location";
    }
    @Override public void onLocationChanged(Location fix) {
        if(stopped || active!=this || !fix.hasAccuracy())return;
        long now=SystemClock.elapsedRealtimeNanos(),stamp=fix.getElapsedRealtimeNanos();
        long age=stamp<=now?(now-stamp)/1000000:Long.MAX_VALUE;
        double latitude=fix.getLatitude(),longitude=fix.getLongitude(),accuracy=fix.getAccuracy();
        if(stamp<=lastFix || age>120000 || !Double.isFinite(latitude)||Math.abs(latitude)>90 || !Double.isFinite(longitude)||Math.abs(longitude)>180 || !Double.isFinite(accuracy)||accuracy<0 || accuracy>1000000)return;
        lastFix=stamp;
        locationStatus="Location: "+fix.getProvider()+" · accuracy "+Math.round(accuracy)+" m";
        JSONObject values=PhoneEvents.fields("latitude",latitude,"longitude",longitude,"accuracy-m",accuracy,"provider",fix.getProvider(),"fix-at",fix.getTime(),"age-ms",age,"mock",fix.isFromMockProvider());
        try {if(fix.hasAltitude() && Double.isFinite(fix.getAltitude()))values.put("altitude-m",fix.getAltitude());if(fix.hasSpeed() && Float.isFinite(fix.getSpeed()) && fix.getSpeed()>=0)values.put("speed-mps",fix.getSpeed());}catch(JSONException ignored){ }
        PhoneEvents.emitAt("location",values,stamp);
        if(selected.contains("geofence")) {
            int known=0;
            for(RegionRules.Region region:regions)if(region.enabled){
                double distance=RegionRules.distance(latitude,longitude,region);
                Boolean classification=RegionRules.classify(distance,accuracy,region.radius);if(classification!=null)known++;
                Boolean changed=tracker.observe(region,distance,accuracy,stamp/1000000);
                if(changed!=null)PhoneEvents.emitAt("geofence",PhoneEvents.fields("region-id",region.id,"region-name",region.name,"inside",changed,"distance-m",distance,"accuracy-m",accuracy),stamp);
            }
            regionStatus="Regions: "+known+" classified; first fixes establish a baseline";
        }
    }
    @Override public void onProviderDisabled(String provider){if(!stopped){locationStatus="Location provider disabled: "+provider;tracker.clear();}}
    @Override public void onProviderEnabled(String provider){if(!stopped)locationStatus="Location enabled; restart streaming to refresh providers";}
    @Override public void onStatusChanged(String provider,int status,Bundle extras){ }

    private void startActivity() {
        if(Build.VERSION.SDK_INT>=29 && !permitted(Manifest.permission.ACTIVITY_RECOGNITION)){activityStatus="Physical activity permission required";return;}
        try {
            if(GoogleApiAvailabilityLight.getInstance().isGooglePlayServicesAvailable(context)!=ConnectionResult.SUCCESS){activityStatus="Activity unavailable: Google Play services required";return;}
            registeredAt=SystemClock.elapsedRealtimeNanos();
            Intent target=new Intent(context,ActivityTransitions.class).setAction("local.localserve.sensors.ACTIVITY").putExtra("generation",generation);
            int flags=PendingIntent.FLAG_CANCEL_CURRENT;if(Build.VERSION.SDK_INT>=31)flags|=PendingIntent.FLAG_MUTABLE;
            activityIntent=PendingIntent.getBroadcast(context,91,target,flags);
            List<ActivityTransition> transitions=new ArrayList<>();
            for(int type:new int[]{DetectedActivity.WALKING,DetectedActivity.RUNNING,DetectedActivity.ON_BICYCLE,DetectedActivity.IN_VEHICLE,DetectedActivity.STILL})
                for(int transition:new int[]{ActivityTransition.ACTIVITY_TRANSITION_ENTER,ActivityTransition.ACTIVITY_TRANSITION_EXIT})transitions.add(new ActivityTransition.Builder().setActivityType(type).setActivityTransition(transition).build());
            recognition=ActivityRecognition.getClient(context);activityStatus="Registering activity transitions";
            recognition.requestActivityTransitionUpdates(new ActivityTransitionRequest(transitions),activityIntent)
                .addOnSuccessListener(ignored->{if(stopped)removeActivity();else activityStatus="Activity transitions enabled (Google Play services)";})
                .addOnFailureListener(error->{if(!stopped)activityStatus="Activity unavailable: "+error.getClass().getSimpleName();});
            // No retry loop, resolution popup, account flow or service restart.
        }catch(RuntimeException error){activityStatus="Activity unavailable: "+error.getClass().getSimpleName();}
    }
    public static void receive(Intent intent) {
        TravelSources owner=active;
        if(owner==null || owner.stopped || !owner.generation.equals(intent.getStringExtra("generation")))return;
        try {
            if(!ActivityTransitionResult.hasResult(intent))return;
            ActivityTransitionResult result=ActivityTransitionResult.extractResult(intent);if(result==null)return;
            long now=SystemClock.elapsedRealtimeNanos();List<ActivityTransitionEvent> events=result.getTransitionEvents();
            for(int i=Math.max(0,events.size()-32);i<events.size();i++) {
                ActivityTransitionEvent event=events.get(i);long stamp=event.getElapsedRealTimeNanos();
                if(stamp<owner.registeredAt || stamp>now || now-stamp>120000000000L)continue;
                String activity=activityName(event.getActivityType());if(activity==null)continue;
                int transition=event.getTransitionType();if(transition!=ActivityTransition.ACTIVITY_TRANSITION_ENTER && transition!=ActivityTransition.ACTIVITY_TRANSITION_EXIT)continue;
                PhoneEvents.emitAt("activity",PhoneEvents.fields("activity",activity,"transition",transition==ActivityTransition.ACTIVITY_TRANSITION_ENTER?"Enter":"Exit"),stamp);
                activityStatus="Reported "+activity+" · "+(transition==ActivityTransition.ACTIVITY_TRANSITION_ENTER?"Enter":"Exit");
            }
        }catch(RuntimeException ignored){ /* Reject malformed/expired provider results. */ }
    }
    private static String activityName(int type){switch(type){case DetectedActivity.WALKING:return "Walking";case DetectedActivity.RUNNING:return "Running";case DetectedActivity.ON_BICYCLE:return "Cycling";case DetectedActivity.IN_VEHICLE:return "In vehicle";case DetectedActivity.STILL:return "Still";default:return null;}}
    private void removeActivity(){if(recognition!=null && activityIntent!=null){PendingIntent pending=activityIntent;try{recognition.removeActivityTransitionUpdates(pending).addOnCompleteListener(task->pending.cancel());}catch(RuntimeException ignored){pending.cancel();}}}
    public void stop(){
        stopped=true;if(active==this)active=null;handler.removeCallbacksAndMessages(null);
        if(locations!=null)try{locations.removeUpdates(this);}catch(RuntimeException ignored){ }tracker.clear();removeActivity();
        if(activityIntent!=null)activityIntent.cancel();
        locationStatus="Location off";regionStatus="Regions off";activityStatus="Activity off";
    }
}
