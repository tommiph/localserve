package local.localserve.sensors;

import java.util.HashMap;
import java.util.Map;

/** Pure region geometry/transition logic, shared with host-side tests. Distances
 * are calculated from reported coordinates, not claimed GPS measurements. */
public final class RegionRules {
    public static final class Region {
        public final String id, name;
        public final double latitude, longitude, radius;
        public final boolean enabled;
        public Region(String id,String name,double latitude,double longitude,double radius,boolean enabled) {
            if(id==null || !id.matches("[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}"))throw new IllegalArgumentException("Invalid region ID");
            if(name==null || name.trim().isEmpty() || name.length()>32 || name.matches(".*[\\p{Cntrl}].*"))throw new IllegalArgumentException("Enter a region name (1–32 characters)");
            if(!Double.isFinite(latitude)||Math.abs(latitude)>90 || !Double.isFinite(longitude)||Math.abs(longitude)>180)throw new IllegalArgumentException("Enter valid latitude and longitude");
            if(!Double.isFinite(radius)||radius<25||radius>100000)throw new IllegalArgumentException("Radius must be 25–100000 metres");
            this.id=id;this.name=name.trim();this.latitude=latitude;this.longitude=longitude;this.radius=radius;this.enabled=enabled;
        }
    }
    public static double distance(double latitude,double longitude,Region region) {
        double a=Math.toRadians(latitude),b=Math.toRadians(region.latitude),delta=Math.toRadians(longitude-region.longitude);
        double h=Math.pow(Math.sin((b-a)/2),2)+Math.cos(a)*Math.cos(b)*Math.pow(Math.sin(delta/2),2);
        return 6371008.8*2*Math.asin(Math.sqrt(Math.max(0,Math.min(1,h))));
    }
    /** No classification while the accuracy circle intersects the boundary. */
    public static Boolean classify(double distance,double accuracy,double radius) {
        if(!Double.isFinite(distance)||distance<0||!Double.isFinite(accuracy)||accuracy<0)return null;
        if(distance+accuracy<radius)return true;
        if(distance-accuracy>radius)return false;
        return null;
    }
    private static final class State {boolean inside;long at;State(boolean inside,long at){this.inside=inside;this.at=at;}}
    private final Map<String,State> states=new HashMap<>();
    /** First/recovered observations establish a baseline. No path between fixes
     * is inferred; a change needs two recent unambiguous classifications. */
    public Boolean observe(Region region,double distance,double accuracy,long elapsedMillis) {
        Boolean inside=classify(distance,accuracy,region.radius);if(inside==null || elapsedMillis<0)return null;
        State previous=states.get(region.id);if(previous!=null && elapsedMillis<previous.at)return null;
        states.put(region.id,new State(inside,elapsedMillis));
        return previous!=null && elapsedMillis>=previous.at && elapsedMillis-previous.at<=120000 && previous.inside!=inside?inside:null;
    }
    public void clear(){states.clear();}
}
