package local.localserve.sensors;
import android.service.quicksettings.TileService;
/** User-added tile sends only while the user-started streamer is active. */
public final class ManualTile extends TileService {
    @Override public void onClick(){super.onClick();PhoneEvents.emit("button",PhoneEvents.fields("name","Quick Settings"));}
}
