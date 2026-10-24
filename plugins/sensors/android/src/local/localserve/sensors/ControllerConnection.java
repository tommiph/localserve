package local.localserve.sensors;

import android.content.SharedPreferences;
import org.json.JSONObject;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;

/** Native-only provisioning on the trusted LAN. Browser content cannot read
 * these grants. Android permissions and reporting remain explicit user choices. */
final class ControllerConnection {
    /** Reachability is independent of approval or Google provisioning. */
    static JSONObject probe(String origin) throws Exception {
        MainActivity.serverOrigin(origin);
        HttpURLConnection connection=(HttpURLConnection)new URL(origin+"/api/controller/status").openConnection(Proxy.NO_PROXY);
        try{connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(1500);connection.setReadTimeout(2000);connection.setRequestProperty("X-Localserve-Controller","1");connection.setRequestProperty("Connection","close");
            if(connection.getResponseCode()!=200)throw new IOException("Localserve unavailable.");
            try(InputStream input=connection.getInputStream();ByteArrayOutputStream output=new ByteArrayOutputStream()){byte[] block=new byte[512];int count;while((count=input.read(block))!=-1){if(output.size()+count>2048)throw new IOException("Invalid server status.");output.write(block,0,count);}JSONObject result=new JSONObject(new String(output.toByteArray(),StandardCharsets.UTF_8));if(!result.optString("serverVersion").matches("[0-9]+[.][0-9]+[.][0-9]+"))throw new IOException("Invalid server status.");return result;}
        }finally{connection.disconnect();}
    }
    static JSONObject read(String origin,SharedPreferences preferences,String code) throws Exception {
        MainActivity.serverOrigin(origin);
        HttpURLConnection connection=(HttpURLConnection)new URL(origin+"/api/controller/connection").openConnection(Proxy.NO_PROXY);
        try {
            connection.setRequestMethod("POST");connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(1500);connection.setReadTimeout(2000);
            connection.setRequestProperty("Connection","close");
            connection.setRequestProperty("Content-Type","application/json");connection.setRequestProperty("X-Localserve-Controller","1");connection.setDoOutput(true);
            JSONObject request=new JSONObject().put("deviceId",preferences.getString("deviceId","")).put("name",preferences.getString("name",android.os.Build.MODEL)).put("version",2);
            String token=preferences.getString("approvalToken","");if(!token.isEmpty())request.put("approvalToken",token);if(code!=null)request.put("code",code);
            byte[] body=request.toString().getBytes(StandardCharsets.UTF_8);connection.setFixedLengthStreamingMode(body.length);
            try(OutputStream out=connection.getOutputStream()){out.write(body);}
            if(connection.getResponseCode()!=200)throw new IOException("Connection approval unavailable. Check Localserve administration.");
            try(InputStream input=connection.getInputStream();ByteArrayOutputStream output=new ByteArrayOutputStream()) {
                byte[] block=new byte[1024];int count;while((count=input.read(block))!=-1){if(output.size()+count>12288)throw new IOException("Invalid connection response.");output.write(block,0,count);}
                return new JSONObject(new String(output.toByteArray(),StandardCharsets.UTF_8));
            }
        }finally{connection.disconnect();}
    }
    static void save(SharedPreferences preferences,JSONObject result) throws Exception {
        String scenes=checked(result.optJSONObject("scenes")),sensors=checked(result.optJSONObject("sensors"));
        if(!sensors.isEmpty()&&!preferences.getString("deviceId","").equals(new JSONObject(sensors).optString("deviceId")))throw new IOException("Phone connection mismatch.");
        SharedPreferences.Editor edit=preferences.edit().putString("scenesRelayProfile",scenes).putString("relayProfile",sensors).putBoolean("automaticConnection",true).putBoolean("relayMode",false).putString("connectionHelp",result.optString("reason",""));
        String token=result.optString("approvalToken","");if(!token.isEmpty()){if(!token.matches("[a-f0-9]{64}"))throw new IOException("Invalid approval response.");edit.putString("approvalToken",token);}edit.apply();
    }
    private static String checked(JSONObject value) throws Exception {
        if(value==null)return "";String text=value.toString();new local.localserve.relay.RelayClient(text).close();return text;
    }
    private ControllerConnection(){}
}
