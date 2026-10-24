package local.localserve.relay;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/** The cloud profile grants only relay operations, never a public LAN address. */
public final class RelayProtocol {
    public static String normalize(String value) throws Exception {
        URI url = new URI(value.trim());
        if (!"https".equals(url.getScheme()) || !"script.google.com".equals(url.getHost()) || url.getPort() != -1
            || url.getUserInfo() != null || url.getQuery() != null || url.getFragment() != null
            || !url.getRawPath().matches("/macros/s/[A-Za-z0-9_-]{16,256}/exec")) throw new Exception("Use the deployed Google Apps Script HTTPS /exec URL.");
        return url.toString();
    }
    public static boolean contentRedirect(String address) {
        try { URI url = new URI(address);return "https".equals(url.getScheme()) && "script.googleusercontent.com".equals(url.getHost())
            && url.getPort() == -1 && url.getUserInfo() == null && url.getFragment() == null && "/macros/echo".equals(url.getRawPath()); }
        catch (Exception error) { return false; }
    }
    public static String signature(String client, String op, long at, String nonce, String payload, String key) throws Exception {
        if (!client.matches("[a-z][a-z0-9-]{0,31}") || !key.matches("[a-f0-9]{64}")) throw new Exception("Invalid relay profile.");
        Mac hmac = Mac.getInstance("HmacSHA256");hmac.init(new SecretKeySpec(key.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        byte[] digest = hmac.doFinal(("1\n" + client + "\n" + op + "\n" + at + "\n" + nonce + "\n" + payload).getBytes(StandardCharsets.UTF_8));
        StringBuilder text = new StringBuilder();for (byte item : digest) text.append(String.format(java.util.Locale.ROOT,"%02x",item & 255));return text.toString();
    }
    public static boolean same(String left, String right) {
        int diff=left.length()^right.length();for(int index=0;index<64;index++)diff|=(index<left.length()?left.charAt(index):0)^(index<right.length()?right.charAt(index):0);return diff==0;
    }
    private RelayProtocol() {}
}
