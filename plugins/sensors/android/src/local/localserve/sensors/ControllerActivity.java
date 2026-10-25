package local.localserve.sensors;

import android.app.*;
import android.content.*;
import android.graphics.*;
import android.graphics.drawable.GradientDrawable;
import android.os.*;
import android.view.*;
import android.webkit.*;
import android.widget.*;
import android.net.*;
import java.io.ByteArrayInputStream;
import java.util.UUID;
import java.util.concurrent.*;

/** One launcher and one native connection screen. Web content cannot read
 * relay credentials, start reporting or grant Android permissions. */
public final class ControllerActivity extends Activity {
    private final Handler ui=new Handler();
    private final ExecutorService network=Executors.newSingleThreadExecutor();
    private SharedPreferences preferences;
    private FrameLayout root;
    private WebView web;
    private RelayScenes relay;
    private String origin="",connection="Disconnected";
    private int generation;
    private boolean destroyed,checking,settingsOpen,foreground,approvalRequired,approvalOpen,approvalOffered,localPageReady;
    private ControllerStyle style;
    private TextView connectionLabel,versionLabel;
    private boolean localReachable;
    private ConnectivityManager connectivity;
    private final ConnectivityManager.NetworkCallback networkChange=new ConnectivityManager.NetworkCallback(){
        @Override public void onAvailable(Network value){networkChanged();}
        @Override public void onLost(Network value){networkChanged();}
        @Override public void onCapabilitiesChanged(Network value,NetworkCapabilities capabilities){networkChanged();}
    };
    private void networkChanged(){ui.post(()->{if(!destroyed&&foreground){ui.removeCallbacks(probe);ui.postDelayed(probe,500);}});}
    private final Runnable statusTick=new Runnable(){public void run(){if(destroyed||!foreground)return;updateConnection();ui.postDelayed(this,1000);}};
    private final Runnable probe=()->{if(foreground&&(relay==null||relay.canLeave()))connect();else if(foreground)ui.postDelayed(this.probeAgain(),30000);};
    private Runnable probeAgain(){return probe;}
    @Override public void onCreate(Bundle state){
        if(!getSharedPreferences("sender",MODE_PRIVATE).getBoolean("relayDark",true))setTheme(R.style.ControllerLight);
        super.onCreate(state);preferences=getSharedPreferences("sender",MODE_PRIVATE);
        style=new ControllerStyle(this);
        if(!preferences.contains("deviceId"))preferences.edit().putString("deviceId","android-"+UUID.randomUUID()).apply();
        preferences.edit().putBoolean("automaticConnection",true).apply();
        getWindow().setStatusBarColor(Color.BLACK);getWindow().setNavigationBarColor(Color.BLACK);
        root=new FrameLayout(this);root.setBackgroundColor(Color.BLACK);setContentView(root);
        connectivity=(ConnectivityManager)getSystemService(CONNECTIVITY_SERVICE);try{connectivity.registerDefaultNetworkCallback(networkChange);}catch(SecurityException ignored){}
        root.setOnApplyWindowInsetsListener((view,insets)->{
            if(Build.VERSION.SDK_INT>=30){Insets safe=insets.getInsets(WindowInsets.Type.systemBars()|WindowInsets.Type.displayCutout());root.setPadding(safe.left,safe.top,safe.right,safe.bottom);return WindowInsets.CONSUMED;}
            root.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());return insets.consumeSystemWindowInsets();
        });
        if(!preferences.getString("relayPending","").isEmpty()&&!preferences.getString("scenesRelayProfile","").isEmpty())unavailable();else connect();
    }
    private int dp(int size){return Math.round(size*getResources().getDisplayMetrics().density);}
    private TextView text(String value,int size){return style.label(value,size);}
    private Button button(String label,Runnable action){return style.button(label,action);}
    private void dispose(){generation++;checking=false;ui.removeCallbacks(probe);if(relay!=null){relay.close();relay=null;}if(web!=null){web.stopLoading();web.destroy();web=null;}root.removeAllViews();}
    private void landing(String message){
        root.removeAllViews();LinearLayout page=new LinearLayout(this);page.setGravity(Gravity.CENTER);page.setOrientation(LinearLayout.VERTICAL);page.setPadding(dp(28),dp(28),dp(28),dp(28));page.setBackgroundColor(style.background);
        TextView logo=text("○",92);logo.setContentDescription("Controller");page.addView(logo);TextView detail=text(message,16);detail.setGravity(Gravity.CENTER);page.addView(detail);
        page.addView(button("Settings",()->settings()));page.addView(button("Try again",()->connect()));root.addView(page,new FrameLayout.LayoutParams(-1,-1));
    }
    private void connect(){
        if(destroyed||checking||approvalOpen)return;
        if(relay!=null&&!relay.canLeave()){scheduleProbe();return;}
        try{origin=MainActivity.serverOrigin(preferences.getString("server",""));}catch(Exception error){landing("Add your server in Settings to get started.");return;}
        // The local page does not depend on Google or on profile provisioning.
        // Display it immediately; refresh native grants on a separate executor.
        if(relay==null&&web==null&&!settingsOpen)showLocal();
        checking=true;final int current=generation;final String target=origin;
        network.execute(()->{
            try{org.json.JSONObject health=ControllerConnection.probe(target),grants;
                preferences.edit().putLong("controllerLocalSuccess",System.currentTimeMillis()).putString("controllerServerVersion",health.optString("serverVersion")).putString("controllerAvailableVersion",health.optString("controllerVersion","")).apply();
                try{grants=ControllerConnection.read(target,preferences,null);}catch(Exception setup){grants=null;}
                final org.json.JSONObject provisioned=grants;
                ui.post(()->{if(destroyed||current!=generation)return;checking=false;try{
                    localReachable=true;approvalRequired=provisioned!=null&&provisioned.optBoolean("approvalRequired");
                    if(provisioned!=null&&!approvalRequired)ControllerConnection.save(preferences,provisioned);
                    connection=provisioned==null?"Home network · remote setup unavailable":approvalRequired?"Home network · approval needed":"Home network";
                    if(foreground&&!settingsOpen&&web==null)showLocal();updateConnection();
                    if(approvalRequired&&foreground&&!approvalOffered&&!settingsOpen){approvalOffered=true;approval();}
                    scheduleProbe();
                }catch(Exception error){connection="Local interface · remote setup unavailable";scheduleProbe();}});
            }catch(Exception error){ui.post(()->{if(destroyed||current!=generation)return;checking=false;localReachable=false;connection="Offline";updateConnection();if(foreground)unavailable();scheduleProbe();});}
        });
    }
    private void unavailable(){
        if(settingsOpen){scheduleProbe();return;}
        if(web!=null&&!localPageReady){dispose();unavailable();return;}
        if(web!=null){final int current=generation;web.evaluateJavascript("document.documentElement.dataset.commandPending === 'true' || document.querySelector('iframe.controller-remote') !== null",pending->{if(destroyed||current!=generation)return;if("true".equals(pending)){scheduleProbe();return;}dispose();unavailable();});return;}
        if(!preferences.getString("scenesRelayProfile","").isEmpty()){
            connection="Connecting to Google relay";
            if(relay==null){dispose();relay=new RelayScenes(this,root,preferences,()->settings());if(foreground)relay.resume();}
            scheduleProbe();
        }else{connection="Disconnected";dispose();landing("Connect to your home Wi-Fi, then try again.");}
    }
    private void scheduleProbe(){ui.removeCallbacks(probe);if(foreground)ui.postDelayed(probe,10000);}
    private static String contact(long at){return at==0?"Not yet":android.text.format.DateFormat.format("EEE HH:mm:ss",at).toString();}
    private void updateConnection() {
        if (relay != null) connection = relay.connected() ? "Away from home" : "Not connected";
        if (connectionLabel != null) {
            String title = localReachable ? "At home" : relay != null && relay.connected() ? "Away from home" : checking ? "Connecting…" : "Not connected";
            String help = localReachable ? "Connected to your server." : relay != null && relay.connected() ? "Your scenes and Tasks are available." : "Check your home Wi-Fi or that your server is running.";
            connectionLabel.setText(title + "\n" + help);
        }
        if (versionLabel != null) versionLabel.setText(versionText());
    }
    private String versionText() {
        String installed = "Unknown";
        try { installed = getPackageManager().getPackageInfo(getPackageName(), 0).versionName; } catch (Exception ignored) {}
        String available = preferences.getString("controllerAvailableVersion", "");
        return "Controller " + installed + (available.isEmpty() ? "" : available.equals(installed) ? "\nYou have the version available from your server." : "\nAvailable from your server: " + available);
    }
    private void showLocal(){
        dispose();final int current=generation;final String allowed=origin;
        localPageReady=false;
        web=new WebView(this);web.setBackgroundColor(Color.BLACK);web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        WebSettings options=web.getSettings();options.setJavaScriptEnabled(true);options.setDomStorageEnabled(true);options.setAllowFileAccess(false);options.setAllowContentAccess(false);
        options.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);options.setJavaScriptCanOpenWindowsAutomatically(false);options.setSupportMultipleWindows(false);options.setMediaPlaybackRequiresUserGesture(true);
        options.setUserAgentString(options.getUserAgentString()+" LocalserveController/1.0 ControllerTheme/"+(preferences.getBoolean("relayDark",true)?"dark":"light"));CookieManager.getInstance().setAcceptThirdPartyCookies(web,false);
        web.setWebViewClient(new WebViewClient(){
            @Override public void onPageFinished(WebView view,String address){if(!destroyed&&current==generation&&address.equals(allowed+"/scenes")){localPageReady=true;connection="Home network";scheduleProbe();}}
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){
                String address=request.getUrl().toString();if(current==generation&&request.isForMainFrame()&&address.equals(allowed+"/scenes/connection")){settings();return true;}
                return current!=generation||!(request.isForMainFrame()?HomePolicy.allows(allowed,address,true):HomePolicy.allowsFrame(allowed,address));
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){
                if(current==generation&&HomePolicy.allows(allowed,request.getUrl().toString(),request.isForMainFrame()))return null;
                return new WebResourceResponse("text/plain","UTF-8",403,"Blocked",null,new ByteArrayInputStream(new byte[0]));
            }
            @Override public void onReceivedError(WebView view,WebResourceRequest request,WebResourceError error){if(!destroyed&&current==generation&&request.isForMainFrame()){dispose();unavailable();}}
            @Override public void onReceivedHttpError(WebView view,WebResourceRequest request,WebResourceResponse result){if(!destroyed&&current==generation&&request.isForMainFrame()){dispose();unavailable();}}
            @Override public void onReceivedSslError(WebView view,SslErrorHandler handler,android.net.http.SslError error){handler.cancel();}
        });root.addView(web,new FrameLayout.LayoutParams(-1,-1));web.onResume();web.loadUrl(origin+"/scenes");
        ui.postDelayed(()->{if(!destroyed&&current==generation&&web!=null&&!localPageReady){dispose();unavailable();}},6000);
    }
    private void approval(){
        if(approvalOpen||destroyed)return;approvalOpen=true;
        LinearLayout form=new LinearLayout(this);form.setOrientation(LinearLayout.VERTICAL);form.setPadding(dp(24),dp(12),dp(24),dp(20));form.setBackgroundColor(style.background);
        form.addView(text("On your server, open Controls → Controller setup and choose Connect a phone. Enter its six-character code here.",15));
        EditText code=new EditText(this);code.setSingleLine();code.setHint("Six-character code");code.setInputType(android.text.InputType.TYPE_CLASS_TEXT|android.text.InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS);code.setFilters(new android.text.InputFilter[]{new android.text.InputFilter.AllCaps(),new android.text.InputFilter.LengthFilter(6)});style.field(code);form.addView(code);
        AlertDialog dialog=ControllerStyle.dialog(this).setTitle("Approve this phone").setView(form).setNegativeButton("Later",null).setPositiveButton("Approve",null).create();
        dialog.setOnShowListener(ignored->dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(view->{
            String entered=code.getText().toString().trim();if(entered.length()!=6){code.setError("Enter all six characters");return;}
            if(checking)return;checking=true;dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(false);final int current=generation;final String target=origin;
            network.execute(()->{try{org.json.JSONObject result=ControllerConnection.read(target,preferences,entered);ui.post(()->{
                if(destroyed||current!=generation)return;checking=false;if(!dialog.isShowing())return;dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(true);
                try{if(result.optBoolean("approvalRequired")){code.setError(result.optString("reason","Generate a new code."));return;}ControllerConnection.save(preferences,result);approvalRequired=false;connection="Connected locally";dialog.dismiss();Toast.makeText(this,"This phone is connected.",Toast.LENGTH_LONG).show();}
                catch(Exception error){code.setError("Approval could not be saved. Try a new code.");}
            });}catch(Exception error){ui.post(()->{if(destroyed||current!=generation)return;checking=false;if(dialog.isShowing()){dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(true);code.setError("Server unavailable. Check the address and try again.");}});}});
        }));dialog.setOnDismissListener(ignored->{approvalOpen=false;scheduleProbe();});dialog.show();
    }
    private void settings() {
        if (settingsOpen) return;
        settingsOpen = true;
        style = new ControllerStyle(this);
        LinearLayout form = new LinearLayout(this);
        form.setOrientation(LinearLayout.VERTICAL);
        form.setPadding(dp(20), dp(12), dp(20), dp(20));
        form.setBackgroundColor(style.background);
        form.setFocusableInTouchMode(true);

        LinearLayout connectionCard = style.card(form, "Your connection");
        connectionLabel = text("", 16);
        connectionCard.addView(connectionLabel);
        connectionCard.addView(text("Scenes and Tasks work at home and away. Full remotes and Cards are available at home.", 14));
        if (approvalRequired) connectionCard.addView(button("Connect this phone", () -> approval()));

        LinearLayout serverCard = style.card(form, "Your server");
        serverCard.addView(text("Use the address shown in Controller setup on your server.", 14));
        EditText address = new EditText(this);
        address.setSingleLine();
        address.setText(preferences.getString("server", ""));
        address.setHint("Server address");
        address.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_URI);
        address.setEnabled(!SensorService.running);
        serverCard.addView(address);
        if (SensorService.running) serverCard.addView(text("Pause phone sharing before changing the server.", 14));

        LinearLayout appearanceCard = style.card(form, "Appearance");
        Switch appearance = new Switch(this);
        appearance.setText("Dark appearance");
        appearance.setChecked(preferences.getBoolean("relayDark", true));
        appearanceCard.addView(appearance);

        LinearLayout sharingCard = style.card(form, "Phone information");
        sharingCard.addView(text(SensorService.running ? "Sharing is on." : "Sharing is off. This is optional.", 15));
        sharingCard.addView(text("Choose which information this phone shares. Nothing starts until you choose Start sharing.", 14));
        sharingCard.addView(button("Choose what to share", () -> startActivity(new Intent(this, MainActivity.class))));

        LinearLayout updatesCard = style.card(form, "App updates");
        versionLabel = text(versionText(), 14);
        updatesCard.addView(versionLabel);
        updatesCard.addView(button("Get app update", () -> {
            if (!localReachable) {
                Toast.makeText(this, "Connect to your home Wi-Fi to download the update.", Toast.LENGTH_LONG).show();
                return;
            }
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(origin + "/downloads/controller.apk")));
            } catch (Exception error) {
                Toast.makeText(this, "Open Downloads on your server to get the update.", Toast.LENGTH_LONG).show();
            }
        }));

        ScrollView scroll = new ScrollView(this);
        scroll.addView(form);
        AlertDialog dialog = ControllerStyle.dialog(this).setTitle("Settings").setView(scroll)
            .setNegativeButton("Done", null).setPositiveButton("Save server", null).create();
        appearance.setOnCheckedChangeListener((button, dark) -> {
            preferences.edit().putBoolean("relayDark", dark).apply();
            style = new ControllerStyle(this);
            form.setBackgroundColor(style.background);
            style.tree(form);
            if (dialog.getWindow() != null) dialog.getWindow().setBackgroundDrawable(style.shape(style.background, 24));
            for (int which : new int[]{AlertDialog.BUTTON_POSITIVE, AlertDialog.BUTTON_NEGATIVE}) {
                Button footer = dialog.getButton(which);
                if (footer != null) footer.setTextColor(style.ink);
            }
            if (relay != null) relay.appearance();
            if (web != null) web.evaluateJavascript("window.dispatchEvent(new CustomEvent('controller-appearance',{detail:" + dark + "}))", null);
        });
        dialog.setOnShowListener(ignored -> {
            form.requestFocus();
            dialog.getWindow().setSoftInputMode(android.view.WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_HIDDEN);
            boolean permitted = !SensorService.running && (relay == null || relay.canLeave());
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(permitted && web == null);
            if (web != null && permitted) {
                web.evaluateJavascript("document.documentElement.dataset.commandPending === 'true' || document.querySelector('iframe.controller-remote') !== null", pending -> {
                    if (dialog.isShowing()) dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(!"true".equals(pending));
                });
            }
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(view -> {
                if (SensorService.running) return;
                try {
                    String next = MainActivity.serverOrigin(address.getText().toString());
                    boolean changed = !next.equals(preferences.getString("server", ""));
                    SharedPreferences.Editor edit = preferences.edit().putString("server", next);
                    if (changed) {
                        edit.remove("scenesRelayProfile").remove("relayProfile").remove("approvalToken");
                        approvalOffered = false;
                        approvalRequired = false;
                    }
                    edit.apply();
                    dispose();
                    dialog.dismiss();
                    connect();
                } catch (Exception error) {
                    address.setError("Use the server address shown in Controller setup.");
                }
            });
        });
        style.tree(form);
        dialog.setOnDismissListener(ignored -> {
            settingsOpen = false;
            connectionLabel = null;
            versionLabel = null;
            if (!localReachable) unavailable();
            connect();
        });
        dialog.show();
        updateConnection();
    }

    @Override protected void onResume(){super.onResume();foreground=true;style=new ControllerStyle(this);ui.removeCallbacks(statusTick);ui.post(statusTick);if(relay!=null)relay.resume();if(web!=null)web.onResume();connect();}
    /** Reflow the current document instead of discarding an outstanding receipt. */
    @Override public void onConfigurationChanged(android.content.res.Configuration value){super.onConfigurationChanged(value);if(relay!=null)relay.appearance();}
    @Override protected void onPause(){foreground=false;ui.removeCallbacks(probe);ui.removeCallbacks(statusTick);if(relay!=null)relay.pause();if(web!=null)web.onPause();super.onPause();}
    @Override protected void onDestroy(){destroyed=true;try{connectivity.unregisterNetworkCallback(networkChange);}catch(Exception ignored){}dispose();ui.removeCallbacksAndMessages(null);network.shutdownNow();super.onDestroy();}
    @Override public void onBackPressed(){if(web!=null){web.evaluateJavascript("(function(){var d=document.querySelector('dialog[open]');if(d){d.close();return true;}return false;})()",used->{if(!destroyed&&"false".equals(used))finish();});return;}super.onBackPressed();}
}
