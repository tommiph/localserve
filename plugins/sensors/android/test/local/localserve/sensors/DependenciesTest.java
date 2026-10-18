package local.localserve.sensors;

/** Classpath/resource linkage checks only; no SDK registration, Android method,
 * account, location provider, network call or device access is performed. */
public final class DependenciesTest {
    public static void main(String[] arguments) throws Exception {
        ClassLoader loader=DependenciesTest.class.getClassLoader();
        for(String type:new String[]{"com.google.android.gms.location.ActivityRecognitionClient",
            "com.google.android.gms.location.ActivityTransitionResult","com.google.android.gms.tasks.Task",
            "kotlinx.coroutines.CoroutineScope","kotlinx.coroutines.android.AndroidDispatcherFactory"})Class.forName(type,false,loader);
        if(loader.getResource("META-INF/services/kotlinx.coroutines.internal.MainDispatcherFactory")==null)throw new AssertionError("Missing coroutine service resource");
        if(loader.getResource("play-services-location.properties")==null)throw new AssertionError("Missing SDK version resource");
        System.out.println("Activity SDK classes and runtime resources linked.");
    }
}
