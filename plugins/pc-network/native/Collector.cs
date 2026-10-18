// Read-only Windows counters. The parent uses a private stdin cancellation
// channel; no process enumeration, remote management or service control exists.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Threading;
using System.Web.Script.Serialization;

internal static class Collector
{
    private static readonly ManualResetEvent Cancelled = new ManualResetEvent(false);

    [StructLayout(LayoutKind.Sequential)]
    private struct FileTime { public uint Low; public uint High; }

    [StructLayout(LayoutKind.Sequential)]
    private struct MemoryStatus
    {
        public uint Length, Load;
        public ulong TotalPhysical, AvailablePhysical, TotalPageFile, AvailablePageFile;
        public ulong TotalVirtual, AvailableVirtual, AvailableExtendedVirtual;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct NeighborRow
    {
        // SOCKADDR_INET is a 28-byte IPv4/IPv6 union. ULONG then aligns the
        // NET_LUID to byte 32, yielding the Windows SDK's 88-byte row on x64.
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 28)] public byte[] Address;
        public uint InterfaceIndex;
        public ulong InterfaceLuid;
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 32)] public byte[] PhysicalAddress;
        public uint PhysicalAddressLength, State;
        public byte Flags;
        public uint ReachabilityTime;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetSystemTimes(out FileTime idle, out FileTime kernel, out FileTime user);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GlobalMemoryStatusEx(ref MemoryStatus value);
    [DllImport("kernel32.dll")]
    private static extern uint GetActiveProcessorCount(ushort group);
    [DllImport("iphlpapi.dll")]
    private static extern uint GetIpNetTable2(ushort family, out IntPtr table);
    [DllImport("iphlpapi.dll")]
    private static extern void FreeMibTable(IntPtr table);

    private static ulong Value(FileTime value) { return ((ulong)value.High << 32) | value.Low; }
    private static void CheckCancelled() { if (Cancelled.WaitOne(0)) throw new OperationCanceledException(); }

    private static Dictionary<string, object> NetworkSnapshot(NetworkInterface adapter)
    {
        IPInterfaceProperties properties = adapter.GetIPProperties();
        IPInterfaceStatistics counters = adapter.GetIPStatistics();
        int index;
        try { index = properties.GetIPv4Properties().Index; } catch { index = 0; }
        return new Dictionary<string, object> {
            { "id", adapter.Id }, { "name", adapter.Name }, { "index", index },
            { "status", adapter.OperationalStatus.ToString() }, { "speed", adapter.Speed },
            { "addresses", properties.UnicastAddresses.Select(item => item.Address.ToString()).Take(8).ToArray() },
            { "received", counters.BytesReceived }, { "sent", counters.BytesSent }
        };
    }

    private static List<Dictionary<string, object>> Neighbors()
    {
        IntPtr table;
        uint code = GetIpNetTable2(2, out table); // AF_INET; no probing is performed.
        if (code != 0) throw new InvalidOperationException("Windows neighbor cache is unavailable.");
        try
        {
            int count = Math.Min(Marshal.ReadInt32(table), 256);
            int rowSize = Marshal.SizeOf(typeof(NeighborRow));
            if (rowSize != 88) throw new InvalidOperationException("Unsupported Windows neighbor layout.");
            var rows = new List<Dictionary<string, object>>();
            for (int index = 0; index < count; index++)
            {
                CheckCancelled();
                // The table's leading ULONG has four bytes of alignment padding.
                var row = (NeighborRow)Marshal.PtrToStructure(IntPtr.Add(table, 8 + index * rowSize), typeof(NeighborRow));
                if (row.PhysicalAddressLength != 6 || row.State < 2 || row.State > 6) continue;
                string address = String.Join(".", row.Address.Skip(4).Take(4).Select(value => value.ToString()).ToArray());
                string mac = String.Join("-", row.PhysicalAddress.Take(6).Select(value => value.ToString("X2")).ToArray());
                rows.Add(new Dictionary<string, object> { { "address", address }, { "mac", mac },
                    { "index", row.InterfaceIndex }, { "state", new[] { "Unreachable", "Incomplete", "Probe", "Delay", "Stale", "Reachable", "Permanent" }[row.State] } });
            }
            return rows;
        }
        finally { FreeMibTable(table); }
    }

    private static object Read()
    {
        using (var gpu = new GpuReadings(CheckCancelled)) return ReadStatus(gpu);
    }

    private static object ReadStatus(GpuReadings gpu)
    {
        FileTime idleBefore, kernelBefore, userBefore, idleAfter, kernelAfter, userAfter;
        bool cpuBefore = GetSystemTimes(out idleBefore, out kernelBefore, out userBefore);
        var adapters = NetworkInterface.GetAllNetworkInterfaces()
            .Where(item => item.NetworkInterfaceType != NetworkInterfaceType.Loopback)
            .OrderByDescending(item => item.OperationalStatus == OperationalStatus.Up).ThenBy(item => item.Name)
            .Take(10).ToArray();
        var before = new Dictionary<string, Dictionary<string, object>>();
        foreach (NetworkInterface adapter in adapters)
        {
            CheckCancelled();
            try { before[adapter.Id] = NetworkSnapshot(adapter); } catch { }
        }
        gpu.BeginSample();
        var watch = Stopwatch.StartNew();
        // A fresh one-second sample avoids deriving rates across restarts,
        // adapter replacement or long gaps. Cancellation interrupts this wait.
        if (Cancelled.WaitOne(1000)) throw new OperationCanceledException();
        double elapsed = watch.Elapsed.TotalSeconds;
        bool cpuAfter = GetSystemTimes(out idleAfter, out kernelAfter, out userAfter);
        double? cpu = null;
        // GetSystemTimes covers one processor group on machines with >64
        // logical processors. Missing total CPU is safer than labelling a group
        // counter as whole-PC usage; other telemetry still remains available.
        if (cpuBefore && cpuAfter && GetActiveProcessorCount(0xffff) <= 64)
        {
            ulong beforeTotal = Value(kernelBefore) + Value(userBefore);
            ulong afterTotal = Value(kernelAfter) + Value(userAfter);
            if (afterTotal > beforeTotal && Value(idleAfter) >= Value(idleBefore))
            {
                double total = afterTotal - beforeTotal;
                double idle = Value(idleAfter) - Value(idleBefore);
                cpu = Math.Max(0, Math.Min(100, 100 * (total - idle) / total));
            }
        }
        var memory = new MemoryStatus { Length = (uint)Marshal.SizeOf(typeof(MemoryStatus)) };
        if (!GlobalMemoryStatusEx(ref memory)) throw new InvalidOperationException("Windows memory counters are unavailable.");
        var network = new List<Dictionary<string, object>>();
        foreach (NetworkInterface adapter in adapters)
        {
            CheckCancelled();
            try
            {
                Dictionary<string, object> current = NetworkSnapshot(adapter);
                Dictionary<string, object> previous;
                object receive = null, transmit = null;
                if (before.TryGetValue(adapter.Id, out previous))
                {
                    long received = (long)current["received"] - (long)previous["received"];
                    long sent = (long)current["sent"] - (long)previous["sent"];
                    if (received >= 0) receive = received * 8.0 / elapsed / 1000000;
                    if (sent >= 0) transmit = sent * 8.0 / elapsed / 1000000;
                }
                current["receiveMbps"] = receive;
                current["transmitMbps"] = transmit;
                network.Add(current);
            }
            catch { /* An adapter can disappear during sampling; do not invent counters. */ }
        }
        var disks = new List<Dictionary<string, object>>();
        foreach (DriveInfo drive in DriveInfo.GetDrives().Where(item => item.DriveType == DriveType.Fixed).Take(10))
        {
            CheckCancelled();
            try
            {
                if (drive.IsReady) disks.Add(new Dictionary<string, object> {
                    { "name", drive.Name }, { "total", drive.TotalSize }, { "free", drive.AvailableFreeSpace }
                });
            }
            catch { /* Missing/inaccessible volumes do not become zero-capacity volumes. */ }
        }
        object neighbors = null;
        try { neighbors = Neighbors(); } catch (OperationCanceledException) { throw; } catch { }
        object gpus = null;
        try { gpus = gpu.Read(); } catch (OperationCanceledException) { throw; } catch { }
        CheckCancelled();
        return new Dictionary<string, object> {
            { "cpu", cpu }, { "sampleSeconds", elapsed },
            { "totalMemory", memory.TotalPhysical }, { "availableMemory", memory.AvailablePhysical },
            { "commitLimit", memory.TotalPageFile }, { "commitUsed", memory.TotalPageFile - memory.AvailablePageFile },
            { "adapters", network }, { "disks", disks }, { "neighbors", neighbors }, { "gpus", gpus }
        };
    }

    public static int Main(string[] args)
    {
        if (args.Length != 0) return 2;
        // EOF means the owning worker disappeared. The helper exits normally
        // instead of leaving a detached collector or requiring process killing.
        var input = new Thread(() => { try { Console.ReadLine(); } catch { } finally { Cancelled.Set(); } });
        input.IsBackground = true;
        input.Start();
        try
        {
            Console.OutputEncoding = new System.Text.UTF8Encoding(false);
            Console.WriteLine(new JavaScriptSerializer().Serialize(Read()));
            return 0;
        }
        catch (OperationCanceledException) { return 3; }
        catch { Console.Error.WriteLine("Windows status collection failed."); return 1; }
    }
}
