package local.localserve.sensors;

/** Host-side pure address validation; no Android Activity is instantiated. */
public final class ServerAddressTest {
    public static void main(String[] arguments) throws Exception {
        for (String value : new String[]{"http://10.23.42.7:1234", "http://10.0.0.1/", "http://172.16.1.2:80"}) {
            if (!MainActivity.serverOrigin(value).startsWith("http://")) throw new AssertionError("Private address rejected");
        }
        for (String value : new String[]{"https://10.23.42.7:1234", "http://127.0.0.1", "http://8.8.8.8", "http://localhost",
                "http://10.23.42.7/api/state", "http://10.23.42.7?token=x", "http://user:password@10.23.42.7",
                "http://10.23.42.7#fragment", "http://10.23.42.7:0", "http://10.23.999.7", "http://10.23.042.7"}) {
            boolean rejected = false;
            try { MainActivity.serverOrigin(value); } catch (Exception error) { rejected = true; }
            if (!rejected) throw new AssertionError("Invalid address admitted: " + value);
        }
        System.out.println("Android sender address checks passed.");
    }
}
