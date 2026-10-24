package local.localserve.scenes;

import android.animation.ValueAnimator;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Insets;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.*;
import android.widget.*;
import java.io.ByteArrayInputStream;

/** A foreground-only, single-page client. Server capability checks authorize
 * commands; this app has no native command bridge or background service. */
public final class ScenesActivity extends Activity {
    private final Handler ui = new Handler();
    private SharedPreferences preferences;
    private FrameLayout root;
    private WebView web;
    private View splash;
    private volatile int generation;
    private volatile String origin = "";
    private boolean destroyed;

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        preferences = getSharedPreferences("connection", MODE_PRIVATE);
        getWindow().getDecorView().setSystemUiVisibility(0);
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            // Consume bars/cutouts once; the web page receives a symmetric safe viewport.
            if (Build.VERSION.SDK_INT >= 30) {
                Insets safe = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                root.setPadding(safe.left, safe.top, safe.right, safe.bottom);
                return WindowInsets.CONSUMED;
            }
            root.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets.consumeSystemWindowInsets();
        });
        setContentView(root);
        load();
    }
    private void disposePage() {
        generation++;
        ui.removeCallbacksAndMessages(null);
        if (splash != null) splash.animate().cancel();
        splash = null;
        if (web != null) { web.stopLoading();root.removeView(web);web.destroy();web = null; }
        root.removeAllViews();
    }
    private void load() {
        disposePage();
        try { origin = ServerAddress.normalize(preferences.getString("server", "")); }
        catch (Exception error) { origin = "";landing("Connect to Localserve on your Wi-Fi.");return; }
        final int current = generation;
        final String allowedOrigin = origin;
        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        web.setVerticalScrollBarEnabled(false);
        web.setHorizontalScrollBarEnabled(false);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false);settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setUserAgentString(settings.getUserAgentString() + " LocalserveScenes/1.0");
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (destroyed || current != generation) return true;
                if (request.isForMainFrame() && ScenesPolicy.connection(allowedOrigin, request.getUrl().toString())) {
                    connection();return true;
                }
                return !request.isForMainFrame() || !ScenesPolicy.allows(allowedOrigin, request.getUrl().toString(), true);
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if (!destroyed && current == generation && ScenesPolicy.allows(allowedOrigin, request.getUrl().toString(), request.isForMainFrame())) return null;
                return new WebResourceResponse("text/plain", "UTF-8", 403, "Blocked", null, new ByteArrayInputStream(new byte[0]));
            }
            @Override public void onPageFinished(WebView view, String url) {
                if (!destroyed && current == generation && view == web && ScenesPolicy.allows(allowedOrigin, url, true)) {
                    // Keep the dark cover until the themed document has a
                    // committed frame, rather than exposing an unpainted surface.
                    view.postVisualStateCallback(current, new WebView.VisualStateCallback() {
                        @Override public void onComplete(long requestId) {
                            if (destroyed || current != generation || view != web) return;
                            ui.removeCallbacksAndMessages(null);
                            if (splash != null) {
                                View cover = splash;splash = null;
                                if (ValueAnimator.areAnimatorsEnabled()) cover.animate().alpha(0).setDuration(220).withEndAction(() -> root.removeView(cover)).start();
                                else root.removeView(cover);
                            }
                        }
                    });
                }
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (!destroyed && current == generation && request.isForMainFrame()) failure();
            }
            @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (!destroyed && current == generation && request.isForMainFrame()) failure();
            }
            @Override public void onReceivedSslError(WebView view, SslErrorHandler handler, android.net.http.SslError error) { handler.cancel(); }
        });
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        splash = splash();root.addView(splash, new FrameLayout.LayoutParams(-1, -1));
        ui.postDelayed(() -> { if (!destroyed && current == generation && splash != null) failure(); }, 15000);
        web.loadUrl(origin + "/scenes");
    }
    private LinearLayout splash() {
        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);content.setGravity(Gravity.CENTER);
        content.setPadding(dp(28), dp(28), dp(28), dp(28));content.setBackgroundColor(Color.BLACK);
        ImageView logo = new ImageView(this);logo.setImageResource(R.drawable.scenes_splash);
        content.addView(logo, new LinearLayout.LayoutParams(dp(128), dp(128)));
        TextView title = new TextView(this);title.setText("Scenes");title.setTextSize(30);title.setTextColor(Color.WHITE);
        title.setPadding(0, dp(16), 0, dp(16));content.addView(title);
        return content;
    }
    private void landing(String message) {
        LinearLayout content = splash();
        TextView detail = new TextView(this);detail.setText(message);detail.setTextSize(16);
        detail.setGravity(Gravity.CENTER);detail.setTextColor(Color.rgb(166, 182, 178));
        content.addView(detail);
        Button address = new Button(this);address.setAllCaps(false);address.setText("Server connection");
        address.setOnClickListener(view -> connection());content.addView(address);
        if (!origin.isEmpty()) {
            Button retry = new Button(this);retry.setAllCaps(false);retry.setText("Try again");
            retry.setOnClickListener(view -> load());content.addView(retry);
        }
        ScrollView scroll = new ScrollView(this);scroll.setFillViewport(true);scroll.addView(content);
        root.addView(scroll, new FrameLayout.LayoutParams(-1, -1));
    }
    private void failure() {
        disposePage();landing("Server unavailable. Check Wi-Fi and your server address.");
    }
    private void connection() {
        EditText address = new EditText(this);address.setSingleLine(true);
        address.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_URI);
        address.setText(preferences.getString("server", ""));address.setHint("http://LAN-IP:port");
        address.setPadding(dp(24), dp(12), dp(24), dp(12));
        String version = "";
        try { version = getPackageManager().getPackageInfo(getPackageName(), 0).versionName; } catch (Exception ignored) {}
        AlertDialog dialog = new AlertDialog.Builder(this).setTitle("Server connection")
            .setMessage("Enter the private LAN address shown by Localserve.\n\nScenes " + version)
            .setView(address).setNegativeButton("Cancel", null).setPositiveButton("Connect", null).create();
        dialog.setOnShowListener(ignored -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(view -> {
            try {
                String next = ServerAddress.normalize(address.getText().toString());
                preferences.edit().putString("server", next).apply();dialog.dismiss();load();
            } catch (Exception error) { address.setError("Use a private LAN IP and port, without a page path."); }
        }));
        dialog.show();
    }
    @Override protected void onResume() { super.onResume();if (web != null) { web.onResume();web.resumeTimers(); } }
    @Override protected void onPause() { if (web != null) { web.onPause();web.pauseTimers(); }super.onPause(); }
    @Override protected void onDestroy() { destroyed = true;disposePage();super.onDestroy(); }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
}
