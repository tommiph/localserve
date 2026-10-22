package local.localserve.sensors;

/** Host checks for the phone's origin and route boundary. */
public final class HomePolicyTest {
    public static void main(String[] arguments) {
        String origin="http://10.23.42.7:7041";
        for(String path:new String[]{"/home","/controls","/controls/example/remote"}) if(!HomePolicy.allows(origin,origin+path,true))throw new AssertionError("Page rejected");
        for(String path:new String[]{"/api/phone-home","/api/phone-home/run","/api/control-view/example/remote/run","/phone-home.js","/assets/material-symbols/material-symbols-outlined.ttf"}){
            if(!HomePolicy.allows(origin,origin+path,false)||HomePolicy.allows(origin,origin+path,true))throw new AssertionError("Resource boundary failed");
        }
        for(String value:new String[]{"http://10.23.42.7:7042/home","https://10.23.42.7:7041/home","http://10.23.42.7.evil/home","file:///home","javascript:alert(1)","content://home",origin+"/api/state",origin+"/api/tasks",origin+"/assets/pages/scifi.html",origin+"/home?token=x",origin+"/controls/../api/state",origin+"/%68ome",origin+"/home#script",origin+"@evil/home"}){
            if(HomePolicy.allows(origin,value,false))throw new AssertionError("Unsafe resource admitted");
        }
        for(String path:new String[]{"/card-renderer.js","/api/phone-home/cards/example/design/device","/plugin-card-assets/example/design/index.html","/plugin-card-assets/example/design/artwork/style.css"}) {
            if(!HomePolicy.allows(origin,origin+path,false)||HomePolicy.allows(origin,origin+path,true))throw new AssertionError("Card resource boundary failed");
        }
        if(!HomePolicy.allowsFrame(origin,origin+"/plugin-card-assets/example/design/index.html"))throw new AssertionError("Card frame rejected");
        for(String path:new String[]{"/assets/card-preview.js?v=4","/api/plugin-preview/webcam/frame.jpg","/api/plugin-preview/webcam/frame.jpg?v=12345"})
            if(!HomePolicy.allows(origin,origin+path,false)||HomePolicy.allows(origin,origin+path,true)||HomePolicy.allowsFrame(origin,origin+path))throw new AssertionError("Preview boundary failed");
        for(String path:new String[]{"/api/plugin-preview/webcam/frame.jpg?token=secret","/api/plugin-preview/webcam/state","/api/plugin-preview/webcam/frame.jpg?v=x","/api/plugin-preview/webcam/frame.jpg?x=1&v=2","/api/plugin-preview/webcam/%66rame.jpg"})
            if(HomePolicy.allows(origin,origin+path,false))throw new AssertionError("Unsafe preview resource admitted");
        if(HomePolicy.allows(origin,"http://10.23.42.8:7041/api/plugin-preview/webcam/frame.jpg",false))throw new AssertionError("Foreign preview admitted");
        for(String path:new String[]{"/api/phone-home","/home","/plugin-card-assets/example/design/index.html?x=1","/plugin-card-assets/example/design/code.js","/plugin-card-assets/example/design/%69ndex.html","/assets/pages/scifi.html"})
            if(HomePolicy.allowsFrame(origin,origin+path))throw new AssertionError("Unsafe frame admitted");
        if(HomePolicy.allowsFrame(origin,"http://10.23.42.8:7041/plugin-card-assets/example/design/index.html"))throw new AssertionError("External frame admitted");
        System.out.println("Phone Home origin and route checks passed.");
    }
}
