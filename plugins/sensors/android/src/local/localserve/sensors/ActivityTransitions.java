package local.localserve.sensors;
import android.content.*;
/** Private explicit PendingIntent receiver. Never starts or restores streaming. */
public final class ActivityTransitions extends BroadcastReceiver {
    @Override public void onReceive(Context context,Intent intent){if("local.localserve.sensors.ACTIVITY".equals(intent.getAction()))TravelSources.receive(intent);}
}
