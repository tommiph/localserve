package local.localserve.sensors;

/** Pure host tests: no GPS/Google callbacks, Android UI or device commands. */
public final class RegionRulesTest {
    private static final String ID="11111111-1111-4111-8111-111111111111";
    private static void check(boolean value){if(!value)throw new AssertionError("Region invariant failed");}
    public static void main(String[] arguments) {
        RegionRules.Region region=new RegionRules.Region(ID,"Home",0,0,100,true);
        check(RegionRules.distance(0,0,region)==0);
        check(Math.abs(RegionRules.distance(0,1,region)-111195.08)<1);
        check(RegionRules.classify(90,20,100)==null);
        check(RegionRules.classify(90,10,100)==null);
        check(RegionRules.classify(120,10,100).equals(false));
        check(RegionRules.classify(50,5,100).equals(true));
        check(RegionRules.classify(Double.NaN,5,100)==null);
        RegionRules tracker=new RegionRules();
        check(tracker.observe(region,50,5,1000)==null); // Initial inside baseline.
        check(tracker.observe(region,120,5,2000).equals(false));
        check(tracker.observe(region,120,5,3000)==null); // Repeated outside.
        check(tracker.observe(region,50,5,2500)==null); // Ignore out of order.
        check(tracker.observe(region,50,5,4000).equals(true));
        check(tracker.observe(region,120,5,130000)==null); // Observation gap.
        check(tracker.observe(region,50,5,131000).equals(true));
        tracker.clear();check(tracker.observe(region,120,5,132000)==null);
        for(double invalid:new double[]{Double.NaN,Double.POSITIVE_INFINITY,91,-91}){
            boolean failed=false;try{new RegionRules.Region(ID,"Home",invalid,0,100,true);}catch(IllegalArgumentException error){failed=true;}check(failed);
        }
        boolean failed=false;try{new RegionRules.Region(ID,"Home",0,0,0,true);}catch(IllegalArgumentException error){failed=true;}check(failed);
        System.out.println("Region geometry, uncertainty and transition checks passed.");
    }
}
