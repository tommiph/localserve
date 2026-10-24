package local.localserve.sensors;

import android.animation.ValueAnimator;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.res.ColorStateList;
import android.graphics.*;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.view.*;
import android.webkit.*;
import android.widget.*;
import java.io.ByteArrayInputStream;

/** Native launch and connection settings around the server-owned phone remote.
 * Sensor reporting keeps its independent, explicit native Start/Stop lifecycle. */
public final class HomeActivity extends Activity {
    private final Handler ui = new Handler();
    private SharedPreferences preferences;
    private LinearLayout root;
    private FrameLayout frame;
    private WebView web;
    private Splash splash;
    private volatile String origin = "";
    private boolean destroyed;
    private volatile int generation;
    private static final int BACKGROUND = Color.rgb(20,26,29);

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        preferences = getSharedPreferences("sender", MODE_PRIVATE);
        getWindow().setStatusBarColor(BACKGROUND); getWindow().setNavigationBarColor(BACKGROUND);
        root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL); root.setBackgroundColor(BACKGROUND);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            // Consume bars/cutouts once at the native boundary. The WebView's
            // workspace and navigation then receive the same usable rectangle.
            if (Build.VERSION.SDK_INT >= 30) {
                Insets safe = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                root.setPadding(safe.left, safe.top, safe.right, safe.bottom);
                return WindowInsets.CONSUMED;
            }
            root.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());
            return insets.consumeSystemWindowInsets();
        });
        LinearLayout bar = new LinearLayout(this);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(dp(20), dp(12), dp(20), dp(8));
        Button home = button("Home"); home.setOnClickListener(view -> loadHome());
        Button sensors = button("Sensors"); sensors.setOnClickListener(view -> startActivity(new Intent(this,MainActivity.class)));
        Button settings = button("Connection"); settings.setOnClickListener(view -> connection());
        bar.addView(home, toolbarSlot(false));
        bar.addView(sensors, toolbarSlot(true));
        bar.addView(settings, toolbarSlot(true));
        FrameLayout toolbar = new FrameLayout(this);
        toolbar.addView(bar, new FrameLayout.LayoutParams(-1, -2, Gravity.CENTER_HORIZONTAL));
        // Match the web shell's maximum width and narrow-phone gutter after
        // the root has removed system insets, including landscape cutouts.
        toolbar.addOnLayoutChangeListener((view, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom) -> {
            int width = Math.min(dp(560), right - left);
            int gutter = width <= dp(350) ? dp(16) : dp(20);
            FrameLayout.LayoutParams layout = (FrameLayout.LayoutParams) bar.getLayoutParams();
            if (layout.width != width) { layout.width = width; bar.setLayoutParams(layout); }
            if (bar.getPaddingLeft() != gutter) bar.setPadding(gutter, dp(12), gutter, dp(8));
        });
        root.addView(toolbar);
        frame = new FrameLayout(this);root.addView(frame,new LinearLayout.LayoutParams(-1,0,1));setContentView(root);
        connect();
    }
    private Button button(String text) {
        Button button = new Button(this);
        button.setText(text);
        button.setAllCaps(false);
        button.setTextSize(13);
        button.setTextColor(Color.rgb(168,226,197));
        button.setGravity(Gravity.CENTER);
        button.setIncludeFontPadding(false);
        button.setMinimumWidth(0);
        button.setMinWidth(0);
        button.setMinimumHeight(dp(44));
        button.setMinHeight(0);
        button.setPadding(dp(8), 0, dp(8), 0);
        button.setStateListAnimator(null);
        GradientDrawable surface = new GradientDrawable();
        surface.setColor(Color.rgb(32,41,44));
        surface.setCornerRadius(dp(12));
        button.setBackground(new RippleDrawable(ColorStateList.valueOf(0x26a8e2c5), surface, null));
        return button;
    }
    private LinearLayout.LayoutParams toolbarSlot(boolean spaced) {
        LinearLayout.LayoutParams slot = new LinearLayout.LayoutParams(0, dp(44), 1);
        if (spaced) slot.setMarginStart(dp(8));
        return slot;
    }
    private void connect() {
        String next = preferences.getString("server", "");
        try { next = MainActivity.serverOrigin(next); } catch (Exception error) { next = ""; }
        if (web != null && next.equals(origin)) return;
        generation++; origin = next;
        if (web != null) { web.stopLoading();frame.removeView(web);web.destroy();web = null; }
        frame.removeAllViews();
        if (origin.isEmpty()) { landing("Connect to your Localserve server on the same Wi-Fi.");return; }
        final int current = generation;
        final String allowedOrigin = origin;
        web = new WebView(this);
        web.setVerticalScrollBarEnabled(false);
        web.setHorizontalScrollBarEnabled(false);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        WebSettings settings = web.getSettings();settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);settings.setAllowContentAccess(false);settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);settings.setSupportMultipleWindows(false);settings.setMediaPlaybackRequiresUserGesture(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web,false);
        web.setBackgroundColor(BACKGROUND);web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if(current == generation && request.isForMainFrame() && request.hasGesture()
                    && "GET".equals(request.getMethod()) && HomePolicy.isScenesDownload(allowedOrigin,request.getUrl().toString())) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW,request.getUrl()).addCategory(Intent.CATEGORY_BROWSABLE)); }
                    catch(android.content.ActivityNotFoundException error) { Toast.makeText(HomeActivity.this,"Install a browser to download Scenes.",Toast.LENGTH_LONG).show(); }
                    return true;
                }
                return current != generation || !(request.isForMainFrame()
                    ? HomePolicy.allows(allowedOrigin,request.getUrl().toString(),true)
                    : HomePolicy.allowsFrame(allowedOrigin,request.getUrl().toString()));
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if (current == generation && HomePolicy.allows(allowedOrigin,request.getUrl().toString(),request.isForMainFrame())) return null;
                return new WebResourceResponse("text/plain","UTF-8",403,"Blocked",null,new ByteArrayInputStream(new byte[0]));
            }
            @Override public void onPageFinished(WebView view,String url) { if (!destroyed && current == generation && view == web && HomePolicy.allows(allowedOrigin,url,true)) dismissSplash(); }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (!destroyed && current == generation && view == web && request.isForMainFrame()) showFailure();
            }
            @Override public void onReceivedHttpError(WebView view,WebResourceRequest request,WebResourceResponse response) {
                if (!destroyed && current == generation && view == web && request.isForMainFrame()) showFailure();
            }
            @Override public void onReceivedSslError(WebView view,android.webkit.SslErrorHandler handler,android.net.http.SslError error) { handler.cancel(); }
        });
        frame.addView(web,new FrameLayout.LayoutParams(-1,-1));
        splash = new Splash();frame.addView(splash,new FrameLayout.LayoutParams(-1,-1));
        ui.postDelayed(() -> { if (!destroyed && current == generation && splash != null) showFailure(); },15000);
        web.loadUrl(origin + "/home");
    }
    private void dismissSplash() {
        if(splash == null)return;
        final Splash current = splash;splash = null;
        if(ValueAnimator.areAnimatorsEnabled()) current.animate().alpha(0).setDuration(260).withEndAction(() -> {current.stop();frame.removeView(current);}).start();
        else { current.stop();frame.removeView(current); }
    }
    private void landing(String message) {
        LinearLayout content = new LinearLayout(this);content.setOrientation(LinearLayout.VERTICAL);content.setGravity(Gravity.CENTER);content.setPadding(dp(32),dp(32),dp(32),dp(32));
        ImageView image = new ImageView(this);image.setImageResource(R.drawable.app_icon);content.addView(image,new LinearLayout.LayoutParams(dp(112),dp(112)));
        TextView title = new TextView(this);title.setText("Localserve");title.setTextColor(Color.WHITE);title.setTextSize(30);title.setPadding(0,dp(20),0,dp(14));content.addView(title);
        TextView detail = new TextView(this);detail.setText(message);detail.setTextColor(Color.rgb(166,182,178));detail.setTextSize(16);detail.setGravity(Gravity.CENTER);content.addView(detail);
        Button address = button("Server address");address.setOnClickListener(view -> connection());content.addView(address);
        if(!origin.isEmpty()){Button retry = button("Try again");retry.setOnClickListener(view -> loadHome());content.addView(retry);}
        frame.addView(content,new FrameLayout.LayoutParams(-1,-1));
    }
    private void showFailure() {
        dismissSplash();if(web != null)web.setVisibility(View.GONE);
        if(frame.getChildCount()>1)frame.removeViews(1,frame.getChildCount()-1);
        landing("Server unavailable. Check your Wi-Fi and the saved server address.");
    }
    private void loadHome() {
        if(origin.isEmpty()){connection();return;}
        generation++;if(web != null){web.stopLoading();web.destroy();web = null;}frame.removeAllViews();connect();
    }
    private void connection() {
        String version="Unknown";
        try {version=getPackageManager().getPackageInfo(getPackageName(),0).versionName;} catch(Exception ignored) {}
        String guidance=SensorService.running?"Stop reporting in Sensors before changing its server address.":"Enter the private LAN address shown by Localserve. Sensor reporting uses this same address.";
        guidance+="\n\nApp version "+version+". Home reloads the server interface. Updating the server does not install an APK update.";
        EditText address = new EditText(this);address.setSingleLine(true);address.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_URI);
        address.setText(preferences.getString("server",""));address.setHint("http://LAN-IP:port");address.setPadding(dp(24),dp(14),dp(24),dp(14));
        AlertDialog dialog = new AlertDialog.Builder(this).setTitle("Localserve server").setMessage(guidance)
            .setView(address).setNegativeButton("Cancel",null).setPositiveButton("Connect",null).create();
        dialog.setOnShowListener(ignored -> {
            address.setEnabled(!SensorService.running);dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(!SensorService.running);
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(view -> {
                if(SensorService.running)return;
                try {String next = MainActivity.serverOrigin(address.getText().toString());preferences.edit().putString("server",next).apply();dialog.dismiss();connect();}
                catch(Exception error){address.setError("Use a private LAN HTTP address without a path.");}
            });
        });dialog.show();
    }
    @Override protected void onResume(){super.onResume();if(web!=null){web.onResume();web.resumeTimers();}if(frame!=null)connect();}
    @Override protected void onPause(){if(web!=null){web.onPause();web.pauseTimers();}super.onPause();}
    @Override protected void onDestroy(){destroyed=true;generation++;ui.removeCallbacksAndMessages(null);if(splash!=null)splash.stop();if(web!=null){web.stopLoading();web.destroy();web=null;}super.onDestroy();}
    @Override public void onBackPressed(){
        if(web!=null&&web.getUrl()!=null){
            if(!web.getUrl().equals(origin+"/home")){web.loadUrl(origin+"/home");return;}
            // Send the normal cancellable dialog event so a pending submission
            // keeps its sheet. Only this fixed Home document receives the code.
            web.evaluateJavascript("(function(){var d=document.querySelector('dialog[open]');if(!d)return false;var e=new Event('cancel',{cancelable:true});if(d.dispatchEvent(e))d.close();return true;})()",
                consumed -> {if(!destroyed&&"false".equals(consumed))finish();});return;
        }
        super.onBackPressed();
    }
    private int dp(int value){return Math.round(value*getResources().getDisplayMetrics().density);}

    /** Short native logo pulse while the server document loads. OS animation
     * preferences disable motion, and networking never depends on the effect. */
    private final class Splash extends View {
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Bitmap logo = BitmapFactory.decodeResource(getResources(),R.drawable.app_icon);
        private final long started = android.os.SystemClock.uptimeMillis();
        Splash(){super(HomeActivity.this);setBackgroundColor(BACKGROUND);setContentDescription("Localserve connecting");}
        @Override protected void onDraw(Canvas canvas){
            super.onDraw(canvas);float cx=getWidth()/2f,cy=getHeight()/2f-dp(24),size=dp(94);
            float phase = ValueAnimator.areAnimatorsEnabled()?((android.os.SystemClock.uptimeMillis()-started)%1800)/1800f:0;
            paint.setColor(Color.rgb(168,226,197));paint.setStyle(Paint.Style.STROKE);paint.setStrokeWidth(dp(1));paint.setAlpha((int)(80*(1-phase)));
            canvas.drawCircle(cx,cy,dp(74)+phase*dp(45),paint);paint.setAlpha(90);canvas.drawCircle(cx,cy,dp(70),paint);
            paint.setAlpha(255);paint.setStyle(Paint.Style.FILL);canvas.drawBitmap(logo,null,new RectF(cx-size/2,cy-size/2,cx+size/2,cy+size/2),paint);
            paint.setColor(Color.WHITE);paint.setTextSize(dp(28));paint.setTextAlign(Paint.Align.CENTER);canvas.drawText("Localserve",cx,cy+dp(112),paint);
            paint.setColor(Color.rgb(166,182,178));paint.setTextSize(dp(11));canvas.drawText("CONNECTING",cx,cy+dp(141),paint);
            if(ValueAnimator.areAnimatorsEnabled())postInvalidateDelayed(32);
        }
        void stop(){clearAnimation();}
    }
}
