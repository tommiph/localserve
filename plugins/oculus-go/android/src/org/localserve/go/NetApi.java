package org.localserve.go;

import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;

/** Fixed same-server HTTP requests; no redirects, UDP discovery or token URLs. */
final class NetApi {
    static final class Session {
        final String base;
        final String token;
        Session(String base, String token) { this.base = base; this.token = token; }
    }
    private final Set<HttpURLConnection> connections = Collections.synchronizedSet(new HashSet<>());

    private HttpURLConnection open(Session session, String route) throws Exception {
        if (session == null) throw new IOException("Connect to Localserve first.");
        if (!route.matches("/api/(catalog|device/install(/cancel)?|device/uninstall(/prepare)?|vr-client/enroll|art/[A-Za-z][A-Za-z0-9_.]{1,199})")) throw new IOException("Unsupported server route.");
        HttpURLConnection connection = (HttpURLConnection) new URL(session.base + route).openConnection();
        connection.setConnectTimeout(8000);
        connection.setReadTimeout(route.equals("/api/device/uninstall") ? 150000 : 30000);
        connection.setInstanceFollowRedirects(false);
        if (!route.equals("/api/vr-client/enroll")) connection.setRequestProperty("Authorization", "Bearer " + session.token);
        connections.add(connection);
        return connection;
    }

    static byte[] read(InputStream stream, int limit) throws IOException {
        if (stream == null) throw new IOException("Server returned an empty response.");
        try (InputStream input = stream; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[16384];
            int length;
            while ((length = input.read(buffer)) != -1) {
                if (output.size() + length > limit) throw new IOException("Server response exceeds its limit.");
                output.write(buffer, 0, length);
            }
            return output.toByteArray();
        }
    }

    JSONObject json(Session session, String route, JSONObject body) throws Exception {
        HttpURLConnection connection = open(session, route);
        try {
            if (body != null) {
                connection.setRequestMethod("POST");
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/json");
                byte[] bytes = body.toString().getBytes("UTF-8");
                connection.setFixedLengthStreamingMode(bytes.length);
                try (OutputStream output = connection.getOutputStream()) { output.write(bytes); }
            }
            int status = connection.getResponseCode();
            InputStream stream = status < 400 ? connection.getInputStream() : connection.getErrorStream();
            JSONObject result = new JSONObject(new String(read(stream, 8 * 1024 * 1024), "UTF-8"));
            if (status < 200 || status >= 300) throw new IOException(result.optString("error", "Server returned HTTP " + status));
            return result;
        } finally { connections.remove(connection); connection.disconnect(); }
    }

    byte[] image(Session session, String route) throws Exception {
        HttpURLConnection connection = open(session, route);
        try {
            if (connection.getResponseCode() != 200) throw new IOException("Artwork unavailable.");
            return read(connection.getInputStream(), 2 * 1024 * 1024);
        } finally { connections.remove(connection); connection.disconnect(); }
    }

    void cancelReads() {
        synchronized (connections) {
            for (HttpURLConnection connection : connections) connection.disconnect();
            connections.clear();
        }
    }
}
