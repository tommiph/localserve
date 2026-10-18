// Read-only DXGI descriptions and local Windows GPU performance counters.
// Counter instance PID tags are aggregated in memory; no process names, device
// controls, vendor utilities or raw instance names leave this helper.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;

internal sealed class GpuReadings : IDisposable
{
    private const uint MoreData = 0x800007D2;
    private const uint FormatDouble = 0x200 | 0x8000; // DOUBLE | NOCAP100
    private readonly Action checkCancelled;
    private readonly List<Dictionary<string, object>> adapters;
    private IntPtr query, engines, dedicated, shared;
    private bool primed;

    [StructLayout(LayoutKind.Sequential)]
    private struct Luid { public uint Low; public int High; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct Description
    {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string Name;
        public uint Vendor, Device, Subsystem, Revision;
        public UIntPtr DedicatedVideo, DedicatedSystem, SharedSystem;
        public Luid Identity;
        public uint Flags;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct CounterValue { public uint Status; public double Value; }
    [StructLayout(LayoutKind.Sequential)]
    private struct CounterItem { public IntPtr Name; public CounterValue Reading; }
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int EnumerateAdapter(IntPtr factory, uint index, out IntPtr adapter);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int ReadDescription(IntPtr adapter, out Description description);

    [DllImport("dxgi.dll")]
    private static extern int CreateDXGIFactory1(ref Guid identity, out IntPtr factory);
    [DllImport("pdh.dll", CharSet = CharSet.Unicode)]
    private static extern uint PdhOpenQueryW(string source, UIntPtr userData, out IntPtr query);
    [DllImport("pdh.dll", CharSet = CharSet.Unicode)]
    private static extern uint PdhAddEnglishCounterW(IntPtr query, string path, UIntPtr userData, out IntPtr counter);
    [DllImport("pdh.dll")]
    private static extern uint PdhCollectQueryData(IntPtr query);
    [DllImport("pdh.dll", CharSet = CharSet.Unicode)]
    private static extern uint PdhGetFormattedCounterArrayW(IntPtr counter, uint format, ref uint size, out uint count, IntPtr buffer);
    [DllImport("pdh.dll")]
    private static extern uint PdhCloseQuery(IntPtr query);

    // English counter paths work independently of the Windows display language.
    // DXGI LUIDs join descriptions to counters; enumeration indexes never join
    // unrelated adapters. Linked physical nodes are left unavailable here.
    private static readonly Regex Instance = new Regex(
        @"^(?:pid_\d+_)?luid_0x([0-9a-f]{1,8})_0x([0-9a-f]{1,8})_phys_(\d+)(?:_eng_(\d+)_engtype_[a-z0-9_ .-]+)?(?:#\d+)?$",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    public GpuReadings(Action cancellation)
    {
        checkCancelled = cancellation;
        try { adapters = Enumerate(); }
        catch (OperationCanceledException) { throw; }
        catch { adapters = null; }
        if (adapters == null || adapters.Count == 0) return;
        try
        {
            if (PdhOpenQueryW(null, UIntPtr.Zero, out query) != 0) return;
            Add(@"\GPU Engine(*)\Utilization Percentage", out engines);
            Add(@"\GPU Adapter Memory(*)\Dedicated Usage", out dedicated);
            Add(@"\GPU Adapter Memory(*)\Shared Usage", out shared);
        }
        catch (OperationCanceledException) { Dispose(); throw; }
        catch { Dispose(); }
    }

    private void Add(string path, out IntPtr counter)
    {
        checkCancelled();
        if (PdhAddEnglishCounterW(query, path, UIntPtr.Zero, out counter) != 0) counter = IntPtr.Zero;
    }

    private List<Dictionary<string, object>> Enumerate()
    {
        IntPtr factory;
        Guid identity = new Guid("770aae78-f26f-4dba-a829-253c83d1b387");
        if (CreateDXGIFactory1(ref identity, out factory) < 0) throw new InvalidOperationException();
        try
        {
            // Explicit inherited COM vtable slots: IUnknown (3), IDXGIObject
            // (4), IDXGIFactory (5), then EnumAdapters1. GetDesc1 follows the
            // three IDXGIAdapter methods. No graphics device/context is created.
            var enumerate = (EnumerateAdapter)Marshal.GetDelegateForFunctionPointer(
                Marshal.ReadIntPtr(Marshal.ReadIntPtr(factory), 12 * IntPtr.Size), typeof(EnumerateAdapter));
            var result = new List<Dictionary<string, object>>();
            for (uint index = 0; index < 32 && result.Count < 4; index++)
            {
                checkCancelled();
                IntPtr adapter;
                int status = enumerate(factory, index, out adapter);
                if (unchecked((uint)status) == 0x887A0002) break; // DXGI_ERROR_NOT_FOUND
                if (status < 0 || adapter == IntPtr.Zero) throw new InvalidOperationException();
                try
                {
                    var describe = (ReadDescription)Marshal.GetDelegateForFunctionPointer(
                        Marshal.ReadIntPtr(Marshal.ReadIntPtr(adapter), 10 * IntPtr.Size), typeof(ReadDescription));
                    Description description;
                    if (describe(adapter, out description) < 0) throw new InvalidOperationException();
                    if ((description.Flags & 2) != 0) continue; // Skip software adapters.
                    result.Add(new Dictionary<string, object> {
                        { "id", unchecked((uint)description.Identity.High).ToString("x8") + "_" + description.Identity.Low.ToString("x8") },
                        { "name", description.Name }, { "dedicatedTotal", description.DedicatedVideo.ToUInt64() },
                        { "sharedLimit", description.SharedSystem.ToUInt64() }
                    });
                }
                finally { Marshal.Release(adapter); }
            }
            return result;
        }
        finally { Marshal.Release(factory); }
    }

    public void BeginSample()
    {
        checkCancelled();
        primed = query != IntPtr.Zero && PdhCollectQueryData(query) == 0;
    }

    private Dictionary<string, double?> Values(IntPtr counter)
    {
        if (counter == IntPtr.Zero) return null;
        checkCancelled();
        uint size = 0, count;
        uint status = PdhGetFormattedCounterArrayW(counter, FormatDouble, ref size, out count, IntPtr.Zero);
        // Read only bounded arrays. A changing/oversized array is unavailable,
        // not a partial aggregate and not a reason to immediately retry.
        if (status != MoreData || size == 0 || size > 512 * 1024 || count > 4096) return null;
        IntPtr buffer = Marshal.AllocHGlobal((int)size);
        try
        {
            uint capacity = size;
            if (PdhGetFormattedCounterArrayW(counter, FormatDouble, ref size, out count, buffer) != 0
                || size > capacity || count > 4096) return null;
            int itemSize = Marshal.SizeOf(typeof(CounterItem));
            if ((long)count * itemSize > size) return null;
            var result = new Dictionary<string, double?>();
            for (int index = 0; index < count; index++)
            {
                checkCancelled();
                var item = (CounterItem)Marshal.PtrToStructure(IntPtr.Add(buffer, index * itemSize), typeof(CounterItem));
                long offset = item.Name.ToInt64() - buffer.ToInt64();
                if (offset < 0 || offset >= size) return null;
                string name = Marshal.PtrToStringUni(item.Name, (int)Math.Min(512, (size - offset) / 2));
                int end = name.IndexOf('\0');
                if (end < 0) return null;
                name = name.Substring(0, end);
                bool valid = (item.Reading.Status == 0 || item.Reading.Status == 1)
                    && !Double.IsNaN(item.Reading.Value) && !Double.IsInfinity(item.Reading.Value) && item.Reading.Value >= 0;
                result[name] = valid ? (double?)item.Reading.Value : null;
            }
            return result;
        }
        finally { Marshal.FreeHGlobal(buffer); }
    }

    private static Match MatchAdapter(string instance, string identity)
    {
        var match = Instance.Match(instance);
        if (!match.Success) return null;
        string luid = Convert.ToUInt32(match.Groups[1].Value, 16).ToString("x8") + "_"
            + Convert.ToUInt32(match.Groups[2].Value, 16).ToString("x8");
        return luid == identity ? match : null;
    }

    private static double? Usage(Dictionary<string, double?> values, string identity)
    {
        if (values == null) return null;
        var totals = new Dictionary<string, double>();
        foreach (var item in values)
        {
            var match = MatchAdapter(item.Key, identity);
            if (match == null) continue;
            if (match.Groups[3].Value != "0" || !match.Groups[4].Success || !item.Value.HasValue) return null;
            // Sum process contexts of the same engine, then take the busiest
            // engine. Summing/averaging different concurrent engines mislabels
            // overall utilization. Raw PID tags are neither persisted nor sent.
            string engine = match.Groups[4].Value;
            double prior;
            totals.TryGetValue(engine, out prior);
            totals[engine] = prior + item.Value.Value;
        }
        return totals.Count == 0 ? null : (double?)Math.Min(100, totals.Values.Max());
    }

    private static double? Memory(Dictionary<string, double?> values, string identity)
    {
        if (values == null) return null;
        var matches = values.Where(item => MatchAdapter(item.Key, identity) != null).ToArray();
        if (matches.Length != 1) return null;
        var match = MatchAdapter(matches[0].Key, identity);
        return match.Groups[3].Value == "0" && !match.Groups[4].Success ? matches[0].Value : null;
    }

    public object Read()
    {
        checkCancelled();
        if (adapters == null) return null;
        bool sampled = primed && PdhCollectQueryData(query) == 0;
        var engineValues = sampled ? Values(engines) : null;
        var dedicatedValues = sampled ? Values(dedicated) : null;
        var sharedValues = sampled ? Values(shared) : null;
        foreach (var adapter in adapters)
        {
            string identity = (string)adapter["id"];
            adapter["usage"] = Usage(engineValues, identity);
            adapter["dedicatedUsed"] = Memory(dedicatedValues, identity);
            adapter["sharedUsed"] = Memory(sharedValues, identity);
        }
        return adapters;
    }

    public void Dispose()
    {
        if (query != IntPtr.Zero) PdhCloseQuery(query);
        query = IntPtr.Zero;
    }
}
