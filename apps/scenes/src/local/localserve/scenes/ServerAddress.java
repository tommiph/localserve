package local.localserve.scenes;

import java.net.URI;

/** An explicit private IPv4 origin avoids DNS lookups and ambiguous URL syntax. */
public final class ServerAddress {
    public static String normalize(String text) throws Exception {
        String input = text.trim();
        if (!input.contains("://")) input = "http://" + input;
        URI uri = new URI(input);
        String host = uri.getHost();
        if (!"http".equals(uri.getScheme()) || host == null || uri.getUserInfo() != null
            || uri.getQuery() != null || uri.getFragment() != null || uri.getPort() == 0 || uri.getPort() > 65535
            || !(uri.getPath().isEmpty() || "/".equals(uri.getPath()))
            || !host.matches("[0-9]+\\.[0-9]+\\.[0-9]+\\.[0-9]+")) throw new Exception("Use a private LAN address.");
        String[] parts = host.split("\\.");
        int[] octets = new int[4];
        for (int i = 0; i < 4; i++) {
            octets[i] = Integer.parseInt(parts[i]);
            if (octets[i] > 255 || !parts[i].equals(Integer.toString(octets[i]))) throw new Exception("Invalid address.");
        }
        if (!(octets[0] == 10 || octets[0] == 172 && octets[1] >= 16 && octets[1] <= 31
            || octets[0] == 192 && octets[1] == 168)) throw new Exception("Use a private LAN address.");
        return "http://" + host + (uri.getPort() < 0 || uri.getPort() == 80 ? "" : ":" + uri.getPort());
    }
    private ServerAddress() {}
}
