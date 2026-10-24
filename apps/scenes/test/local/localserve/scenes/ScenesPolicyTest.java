package local.localserve.scenes;

/** Pure Java checks do not connect to a server or execute a lighting command. */
public final class ScenesPolicyTest {
    private static final String ORIGIN = "http://192.168.1.5:7041";
    private static void check(boolean condition, String message) { if (!condition) throw new AssertionError(message); }
    public static void main(String[] args) throws Exception {
        check(ServerAddress.normalize("192.168.1.5:7041/").equals(ORIGIN), "Address normalization");
        check(ServerAddress.normalize("http://10.1.2.3:80").equals("http://10.1.2.3"), "Default port normalization");
        for (String address : new String[]{"https://192.168.1.5", "http://example.com", "http://8.8.8.8", "http://127.0.0.1", "http://192.168.01.5", "http://192.168.1.5:0", "http://192.168.1.5/scenes", "http://user@192.168.1.5", "http://192.168.1.5?x=1", "http://192.168.1.5#x"}) {
            boolean rejected = false;try { ServerAddress.normalize(address); } catch (Exception expected) { rejected = true; }
            check(rejected, "Reject non-LAN/ambiguous origin: " + address);
        }
        check(ScenesPolicy.allows(ORIGIN, ORIGIN + "/scenes", true), "Initial page");
        check(ScenesPolicy.connection(ORIGIN, ORIGIN + "/scenes/connection"), "Native connection affordance");
        for (String route : new String[]{"/scene-selector.js?v=2", "/scene-selector.css?v=2", "/assets/scenes/app-icon.svg", "/assets/scenes/app-icon-192.png", "/assets/material-symbols/material-symbols-outlined.ttf", "/api/scene-selector", "/api/phone-home/run", "/api/phone-home/receipts/12345678-1234-1234-1234-123456789abc", "/api/control-view/tradfri/lights", "/api/control-view/tradfri/lights/run", "/scenes/app.webmanifest"}) {
            check(ScenesPolicy.allows(ORIGIN, ORIGIN + route, false), "Required resource: " + route);
            check(!ScenesPolicy.allows(ORIGIN, ORIGIN + route, true), "Resource cannot navigate: " + route);
        }
        for (String route : new String[]{"/", "/home", "/api/state", "/api/tasks", "/scenes?redirect=x", "/scenes#x", "/api/scene-selector?x=1", "/assets/../config.json", "/assets/%2e%2e/config.json", "/api/control-view/tradfri/lights/scene", "/scene-selector.js?v=x", "/scenes/connection"})
            check(!ScenesPolicy.allows(ORIGIN, ORIGIN + route, false), "Block unneeded route: " + route);
        for (String address : new String[]{"http://192.168.1.6:7041/scenes", "https://192.168.1.5:7041/scenes", "file:///scenes", "javascript:alert(1)", "http://192.168.1.5:7041.evil.test/scenes", "http://user@192.168.1.5:7041/scenes"}) {
            check(!ScenesPolicy.allows(ORIGIN, address, false), "Block foreign origin");
            check(!ScenesPolicy.connection(ORIGIN, address), "Block foreign connection navigation");
        }
        System.out.println("Scenes LAN address, navigation, resource and connection policy checks passed.");
    }
}
