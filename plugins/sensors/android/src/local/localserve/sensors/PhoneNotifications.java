package local.localserve.sensors;
import android.app.Notification;
import android.service.notification.*;
/** Notification access is granted by Android Settings. Only explicitly entered
 * package names can forward content; no initial notification dump or actions. */
public final class PhoneNotifications extends NotificationListenerService {
    @Override public void onNotificationPosted(StatusBarNotification item){send(item,false);}
    @Override public void onNotificationRemoved(StatusBarNotification item){send(item,true);}
    private void send(StatusBarNotification item,boolean removed){
        if(!PhoneEvents.acceptsApp(item.getPackageName()))return;
        Notification notification=item.getNotification();
        PhoneEvents.emit("notification",PhoneEvents.fields("package",item.getPackageName(),"removed",removed,
            "title",PhoneEvents.clip(notification.extras.getCharSequence(Notification.EXTRA_TITLE)),
            "text",PhoneEvents.clip(notification.extras.getCharSequence(Notification.EXTRA_TEXT))));
    }
}
