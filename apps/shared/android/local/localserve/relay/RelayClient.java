package local.localserve.relay;

import org.json.JSONObject;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.UUID;
import java.util.zip.GZIPOutputStream;

/** One bounded authenticated request. Mutating requests are never retried or
 * moved to another transport after an uncertain HTTP result. */
public final class RelayClient {
    private final String url, client, key;
    public final int reportIntervalMs;
    private volatile HttpURLConnection connection;
    private volatile boolean closed;
    public RelayClient(String profile) throws Exception {
        if(profile.length()>4096)throw new IOException("Relay profile too large.");
        JSONObject settings = new JSONObject(profile);reportIntervalMs=Math.max(60000,Math.min(600000,settings.optInt("reportIntervalMs",60000)));url=RelayProtocol.normalize(settings.getString("url"));client=settings.getString("clientId");key=settings.getString("key");
        if(!client.matches("[a-z][a-z0-9-]{0,31}")||client.equals("collector")||!key.matches("[a-f0-9]{64}"))throw new Exception("Invalid relay profile.");
    }
    private HttpURLConnection open(String address, String method) throws Exception {
        if(closed)throw new IOException("Relay stopped.");
        HttpURLConnection next=(HttpURLConnection)new URL(address).openConnection(Proxy.NO_PROXY);connection=next;
        next.setRequestMethod(method);next.setInstanceFollowRedirects(false);next.setConnectTimeout(10000);next.setReadTimeout(18000);next.setRequestProperty("Accept","application/json");
        if(closed){next.disconnect();throw new IOException("Relay stopped.");}return next;
    }
    public JSONObject call(String op, JSONObject payload) throws Exception {
        String nonce=UUID.randomUUID().toString(),encoded=Base64.getEncoder().encodeToString(payload.toString().getBytes(StandardCharsets.UTF_8));long at=System.currentTimeMillis();
        JSONObject envelope=new JSONObject().put("v",1).put("clientId",client).put("op",op).put("at",at).put("nonce",nonce).put("payload",encoded)
            .put("signature",RelayProtocol.signature(client,op,at,nonce,encoded,key));
        byte[] bytes=envelope.toString().getBytes(StandardCharsets.UTF_8);if(bytes.length>125000)throw new IOException("Relay report too large.");
        HttpURLConnection current=null;
        try {
            current=open(url,"POST");current.setRequestProperty("Content-Type","application/json");current.setDoOutput(true);current.setFixedLengthStreamingMode(bytes.length);
            try(OutputStream output=current.getOutputStream()){if(closed)throw new IOException("Relay stopped.");output.write(bytes);}
            int code=current.getResponseCode();
            if(code==302||code==303){String location=current.getHeaderField("Location");current.disconnect();if(!RelayProtocol.contentRedirect(location))throw new IOException("Unexpected relay redirect.");current=open(location,"GET");code=current.getResponseCode();}
            if(code!=200)throw new IOException("Relay HTTP request failed.");
            JSONObject reply=new JSONObject(read(current.getInputStream()));String data=reply.optString("payload"),signature=reply.optString("signature");long repliedAt=reply.optLong("at",0);
            if(reply.optInt("v")!=1||!client.equals(reply.optString("clientId"))||!op.equals(reply.optString("op"))||!nonce.equals(reply.optString("nonce"))
                ||Math.abs(System.currentTimeMillis()-repliedAt)>120000||data.length()>265000||data.length()%4!=0||!data.matches("[A-Za-z0-9+/]*={0,2}")
                ||!RelayProtocol.same(RelayProtocol.signature(client,op,repliedAt,nonce,data,key),signature))throw new IOException("Relay authentication failed.");
            byte[] decoded=Base64.getDecoder().decode(data);if(decoded.length>196608)throw new IOException("Relay result too large.");
            JSONObject result=new JSONObject(new String(decoded,StandardCharsets.UTF_8));if(!result.optBoolean("ok"))throw new IOException("Relay rejected request. Check permissions, expiry and quota.");
            if(closed)throw new IOException("Relay stopped.");return result;
        } finally {if(current!=null)current.disconnect();connection=null;}
    }
    public JSONObject sensor(byte[] packet,String deviceId) throws Exception {
        ByteArrayOutputStream compressed=new ByteArrayOutputStream();try(GZIPOutputStream gzip=new GZIPOutputStream(compressed)){gzip.write(packet);}
        return call("sensor",new JSONObject().put("id",UUID.randomUUID().toString()).put("deviceId",deviceId).put("packet",Base64.getEncoder().encodeToString(compressed.toByteArray())));
    }
    private String read(InputStream input) throws IOException {
        try(InputStream source=input;ByteArrayOutputStream output=new ByteArrayOutputStream()) {byte[] block=new byte[4096];int count;while((count=source.read(block))!=-1){if(closed||output.size()+count>280000)throw new IOException("Relay stopped or oversized result.");output.write(block,0,count);}return new String(output.toByteArray(),StandardCharsets.UTF_8);}
    }
    public void close(){closed=true;HttpURLConnection active=connection;if(active!=null)active.disconnect();}
}
