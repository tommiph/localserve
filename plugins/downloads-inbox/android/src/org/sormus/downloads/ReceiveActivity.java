package org.sormus.downloads;
import android.app.Activity;import android.os.Bundle;import android.content.Intent;import android.widget.Toast;
/** No content view: hand off while resumed, then return to the originating app. */
public final class ReceiveActivity extends Activity {
 private boolean dispatched;
 @Override public void onCreate(Bundle state){super.onCreate(state);dispatched=state!=null&&state.getBoolean("dispatched",false);if(dispatched)finish();}
 @Override public void onResume(){super.onResume();if(dispatched){finish();return;}dispatched=true;try{IncomingTransfer incoming=IncomingTransfer.read(getIntent());if(incoming==null)throw new Exception("Share a file or torrent to Downloads.");if(IncomingTransfer.paired(this))incoming.start(this);else{Intent setup=new Intent(getIntent());setup.setClass(this,DownloadsActivity.class);setup.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);startActivity(setup);}}catch(Exception e){Toast.makeText(this,e.getMessage()==null?"Could not start transfer. Open Downloads to check your connection.":e.getMessage(),Toast.LENGTH_LONG).show();}finally{finish();}}
 @Override public void onSaveInstanceState(Bundle state){state.putBoolean("dispatched",dispatched);super.onSaveInstanceState(state);}
}
