package local.localserve.sensors;

import android.webkit.*;
import android.net.Uri;
import android.app.Activity;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Handler;
import android.widget.*;
import org.json.*;
import local.localserve.relay.RelayClient;
import java.io.*;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Offline Controller document. Native code validates every selection against
 * its scoped catalogue and keeps credentials and durable requests private. */
final class RelayScenes {
    private final Activity activity;
    private final FrameLayout root;
    private final SharedPreferences preferences;
    private final Runnable settings;
    private final Handler ui=new Handler();
    private final ExecutorService network=Executors.newSingleThreadExecutor();
    private volatile RelayClient active;
    private volatile boolean paused=true,closed;
    private int epoch;
    private boolean reading,sending,dark;
    private String pending="",pendingName="",status="Connecting…";
    private long pendingAt;
    private JSONObject catalog;
    private WebView document;
    private boolean documentReady,online;
    private String result="";
    RelayScenes(Activity activity,FrameLayout root,SharedPreferences preferences,Runnable settings){
        this.activity=activity;this.root=root;this.preferences=preferences;this.settings=settings;dark=preferences.getBoolean("relayDark",true);
        pending=preferences.getString("relayPending","");pendingName=preferences.getString("relayPendingName","");pendingAt=preferences.getLong("relayPendingAt",0);
        document=new WebView(activity);document.setBackgroundColor(Color.BLACK);
        WebSettings options=document.getSettings();options.setJavaScriptEnabled(true);options.setAllowFileAccess(false);options.setAllowContentAccess(false);options.setDomStorageEnabled(false);options.setJavaScriptCanOpenWindowsAutomatically(false);options.setSupportMultipleWindows(false);options.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        document.setWebViewClient(new WebViewClient(){
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){
                Uri uri=request.getUrl();if(!closed&&request.isForMainFrame()&&"https".equals(uri.getScheme())&&"controller.local".equals(uri.getHost())&&uri.getPort()==-1&&uri.getUserInfo()==null){
                    if(uri.getPath().equals("/command/settings"))settings.run();
                    else if(uri.getPath().equals("/command/dismiss")&&!pending.isEmpty()&&System.currentTimeMillis()-pendingAt>120000)clearPending();
                    else if(uri.getPath().equals("/command/run"))select(uri.getQueryParameter("key"));
                }return true;
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){
                String url=request.getUrl().toString(),asset=null,mime="text/plain";
                if(url.equals("https://controller.local/")){asset="index.html";mime="text/html";}
                else if(url.matches("https://controller[.]local/scene-selector[.]css(?:[?]v=3)?")){asset="scene-selector.css";mime="text/css";}
                else if(url.equals("https://controller.local/assets/material-symbols/material-symbols.css")){asset="material-symbols.css";mime="text/css";}
                else if(url.equals("https://controller.local/assets/material-symbols/material-symbols-outlined.ttf")){asset="material-symbols.ttf";mime="font/ttf";}
                else if(url.equals("https://controller.local/controller-relay.js")){asset="controller-relay.js";mime="application/javascript";}
                try{if(asset!=null)return new WebResourceResponse(mime,"UTF-8",activity.getAssets().open("relay/"+asset));}catch(IOException ignored){}
                return new WebResourceResponse("text/plain","UTF-8",403,"Blocked",null,new ByteArrayInputStream(new byte[0]));
            }
            @Override public void onPageFinished(WebView view,String url){if(!closed&&url.equals("https://controller.local/")){documentReady=true;paint();}}
            @Override public void onReceivedSslError(WebView view,SslErrorHandler handler,android.net.http.SslError error){handler.cancel();}
        });root.addView(document,new FrameLayout.LayoutParams(-1,-1));document.loadUrl("https://controller.local/");
    }
    private void select(String key){
        if(!online||catalog==null||catalog.optBoolean("paused")||key==null)return;
        for(String group:new String[]{"scenes","tasks"}){JSONArray entries=catalog.optJSONArray(group);if(entries==null)continue;for(int i=0;i<entries.length();i++){JSONObject item=entries.optJSONObject(i);if(item!=null&&key.equals(item.optString("key"))&&item.optBoolean("available")){run(item);return;}}}
    }
    private void paint(){
        if(closed||!documentReady)return;
        try{JSONObject model=new JSONObject().put("dark",dark).put("online",online&&!paused).put("catalog",catalog).put("pending",!pending.isEmpty()).put("pendingName",pendingName).put("pendingKey",preferences.getString("relayPendingKey","")).put("status",pending.isEmpty()&&!result.isEmpty()?"Completed":status).put("result",result).put("dismissible",!pending.isEmpty()&&System.currentTimeMillis()-pendingAt>120000);
            document.evaluateJavascript("window.ControllerRelay&&ControllerRelay.render("+JSONObject.quote(model.toString())+")",null);
        }catch(JSONException ignored){}
    }
    private void clearPending(){pending="";pendingName="";preferences.edit().remove("relayPending").remove("relayPendingName").remove("relayPendingAt").remove("relayPendingKey").apply();status="Ready";paint();}
    private void run(JSONObject item){
        if(paused||closed||sending||!pending.isEmpty())return;
        result="";
        pending=UUID.randomUUID().toString();pendingName=item.optString("name");pendingAt=System.currentTimeMillis();
        // Retain only the uncertain request identity before attempting its POST.
        if(!preferences.edit().putString("relayPending",pending).putString("relayPendingName",pendingName).putLong("relayPendingAt",pendingAt).putString("relayPendingKey",item.optString("key")).commit()){pending="";status="Request could not be saved; nothing sent";paint();return;}
        final String id=pending;final int current=epoch;sending=true;status="Sending…";paint();
        network.execute(()->{
            try {RelayClient client=new RelayClient(preferences.getString("scenesRelayProfile",""));active=client;
                try{client.call("run",new JSONObject().put("id",id).put("type",item.getString("type")).put("key",item.getString("key")).put("revision",item.getInt("revision")));}
                finally{client.close();active=null;}
                ui.post(()->{if(current!=epoch||closed)return;sending=false;status="Queued · waiting for Sormus";paint();schedule(5000);});
            }catch(Exception error){ui.post(()->{if(current!=epoch||closed)return;sending=false;status="Not confirmed · check result before running again";paint();schedule(5000);});}
        });
    }
    private final Runnable tick=()->refresh();
    private void schedule(long delay){ui.removeCallbacks(tick);if(!paused&&!closed)ui.postDelayed(tick,delay);}
    private void refresh(){
        if(paused||closed||reading||sending)return;reading=true;final int current=epoch;final String id=pending;
        network.execute(()->{
            try {
                RelayClient client=new RelayClient(preferences.getString("scenesRelayProfile",""));active=client;JSONObject response,receipt=null;
                try{response=client.call("catalog",new JSONObject());if(!id.isEmpty())receipt=client.call("receipt",new JSONObject().put("id",id)).optJSONObject("receipt");}
                finally{client.close();active=null;}
                final JSONObject result=receipt;ui.post(()->{
                    if(current!=epoch||closed)return;reading=false;catalog=response.optJSONObject("catalog");online=true;preferences.edit().putLong("controllerRelaySuccess",System.currentTimeMillis()).apply();
                    status=catalog==null?"Server has not synchronized recently":catalog.optBoolean("paused")?"Server paused":"Connected";
                    if(!pending.isEmpty()){
                        String outcome=result==null?"queued":result.optString("status");status=outcome.equals("queued")?"Queued · waiting for Sormus":outcome;
                        if(outcome.equals("completed")){this.result=pendingName;clearPending();status="Completed";}
                        else if(!outcome.equals("accepted")&&!outcome.equals("running")&&!outcome.equals("queued")){
                            pendingAt=0;preferences.edit().putLong("relayPendingAt",0).apply();status=outcome+" · "+(result==null?"check Task or remote history":result.optString("reason","check Task or remote history").replace('-',' '));
                        }else if(System.currentTimeMillis()-pendingAt>120000)status="Not confirmed · check Task or remote history";
                    }
                    paint();schedule(pending.isEmpty()?30000:5000);
                });
            }catch(Exception error){ui.post(()->{if(current!=epoch||closed)return;reading=false;online=false;status="Unable to connect · check your internet connection or your server";paint();schedule(30000);});}
        });
    }
    void resume(){if(closed||!paused)return;paused=false;epoch++;reading=false;sending=false;document.onResume();paint();refresh();}
    boolean canLeave(){return pending.isEmpty()&&!sending;}
    void appearance(){dark=preferences.getBoolean("relayDark",true);paint();}
    void pause(){document.onPause();paused=true;online=false;epoch++;reading=false;sending=false;ui.removeCallbacks(tick);RelayClient client=active;if(client!=null)client.close();}
    void close(){closed=true;pause();document.stopLoading();document.destroy();network.shutdownNow();ui.removeCallbacksAndMessages(null);}
    boolean connected(){return online&&!paused;}
}
