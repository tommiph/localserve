package org.localserve.go;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.net.URI;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** The bearer token is encrypted with an app-owned Android Keystore key. */
final class ConnectionSettings {
    private static final String KEY_ALIAS = "org.localserve.go.connection";
    private final SharedPreferences preferences;

    ConnectionSettings(Context context) {
        preferences = context.getSharedPreferences("localserve-go", Context.MODE_PRIVATE);
    }

    static String serverAddress(String input) throws Exception {
        String value = input.trim();
        if (!value.startsWith("http://")) value = "http://" + value;
        URI uri = new URI(value);
        if (!"http".equals(uri.getScheme()) || uri.getUserInfo() != null
            || uri.getQuery() != null || uri.getFragment() != null
            || uri.getPath() != null && !uri.getPath().isEmpty()
            || uri.getPort() < 1 || uri.getPort() > 65535) {
            throw new Exception("Enter a private LAN IPv4 address and port.");
        }
        String host = uri.getHost();
        if (host == null || !host.matches("[0-9]+\\.[0-9]+\\.[0-9]+\\.[0-9]+")) throw new Exception("Use a private IPv4 address.");
        String[] parts = host.split("\\.");
        int[] numbers = new int[4];
        for (int i = 0; i < 4; i++) {
            numbers[i] = Integer.parseInt(parts[i]);
            if (numbers[i] < 0 || numbers[i] > 255 || !parts[i].equals(String.valueOf(numbers[i]))) throw new Exception("Invalid IPv4 address.");
        }
        boolean local = numbers[0] == 10 || numbers[0] == 192 && numbers[1] == 168
            || numbers[0] == 172 && numbers[1] >= 16 && numbers[1] <= 31;
        if (!local || numbers[3] == 0 || numbers[3] == 255) throw new Exception("Choose a private LAN device address.");
        return "http://" + host + ":" + uri.getPort();
    }

    private SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (!store.containsAlias(KEY_ALIAS)) {
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
            generator.generateKey();
        }
        return (SecretKey) store.getKey(KEY_ALIAS, null);
    }

    synchronized NetApi.Session load() throws Exception {
        String address = preferences.getString("server", "");
        String protectedToken = preferences.getString("credential", "");
        if (address.isEmpty() || protectedToken.isEmpty()) return null;
        String[] pieces = protectedToken.split(":");
        if (pieces.length != 2) throw new Exception("Connect this headset again.");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(pieces[0], Base64.NO_WRAP)));
        String token = new String(cipher.doFinal(Base64.decode(pieces[1], Base64.NO_WRAP)), "UTF-8");
        return new NetApi.Session(serverAddress(address), token);
    }

    synchronized void save(String address, String token) throws Exception {
        address = serverAddress(address);
        if (!token.matches("[^\\s]{16,512}")) throw new Exception("Server returned invalid authorization.");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key());
        String encrypted = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":"
            + Base64.encodeToString(cipher.doFinal(token.getBytes("UTF-8")), Base64.NO_WRAP);
        if (!preferences.edit().putString("server", address).putString("credential", encrypted).commit()) throw new Exception("Could not save the connection.");
    }

    SharedPreferences preferences() { return preferences; }
}
