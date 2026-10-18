package local.localserve.sensors;
import android.app.*;
import android.appwidget.*;
import android.content.*;
import android.widget.RemoteViews;
/** Explicit home-screen tap; no receiver starts services or queues commands. */
public final class ManualWidget extends AppWidgetProvider {
    @Override public void onUpdate(Context context,AppWidgetManager manager,int[] ids){
        for(int id:ids){RemoteViews view=new RemoteViews(context.getPackageName(),R.layout.manual_widget);
            Intent intent=new Intent(context,ManualWidget.class).setAction("local.localserve.sensors.MANUAL");
            view.setOnClickPendingIntent(R.id.manual_button,PendingIntent.getBroadcast(context,id,intent,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE));manager.updateAppWidget(id,view);}
    }
    @Override public void onReceive(Context context,Intent intent){super.onReceive(context,intent);if("local.localserve.sensors.MANUAL".equals(intent.getAction()))PhoneEvents.emit("button",PhoneEvents.fields("name","Home screen"));}
}
