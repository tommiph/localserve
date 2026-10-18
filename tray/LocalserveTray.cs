// Localserve's Windows notification-area application. Server commands use only
// this installation's private pipe; no service or process-name discovery occurs.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Pipes;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

namespace LocalserveDesktop
{
    public sealed class ServerHost
    {
        public readonly string Root;
        public readonly string Identity;
        private readonly JavaScriptSerializer json = new JavaScriptSerializer();
        private readonly object logGate = new object();

        public ServerHost(string root)
        {
            Root = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar);
            using (SHA256 sha = SHA256.Create())
                Identity = BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(Root.ToLowerInvariant())))
                    .Replace("-", "").ToLowerInvariant().Substring(0, 24);
        }

        public string FileAt(string relative) { return Path.Combine(Root, relative); }
        public static string Text(IDictionary<string, object> item, string key, string fallback = "")
        {
            object value;
            return item != null && item.TryGetValue(key, out value) ? Convert.ToString(value) : fallback;
        }
        public Dictionary<string, object> Read(string relative)
        {
            return json.Deserialize<Dictionary<string, object>>(File.ReadAllText(FileAt(relative), Encoding.UTF8));
        }
        public void Log(string message)
        {
            lock (logGate)
            {
                string folder = FileAt("data/tray");
                Directory.CreateDirectory(folder);
                string file = Path.Combine(folder, "desktop.log");
                if (File.Exists(file) && new FileInfo(file).Length > 1024 * 1024)
                {
                    string previous = file + ".previous";
                    if (File.Exists(previous)) File.Delete(previous);
                    File.Move(file, previous);
                }
                File.AppendAllText(file, DateTimeOffset.Now.ToString("o") + " " + message + Environment.NewLine, Encoding.UTF8);
            }
        }

        private bool ProcessExists(int pid)
        {
            if (pid <= 0) throw new InvalidDataException("Invalid Localserve lock PID.");
            try { using (Process process = Process.GetProcessById(pid)) return !process.HasExited; }
            catch (ArgumentException) { return false; }
        }

        public Dictionary<string, object> Command(string command)
        {
            Dictionary<string, object> descriptor = Read("data/tray-server.json");
            if (Text(descriptor, "pipeName") != "localserve-" + Identity)
                throw new InvalidDataException("Desktop control belongs to another installation.");
            int pid = Convert.ToInt32(descriptor["pid"]);
            if (!ProcessExists(pid)) throw new IOException("Localserve process is no longer running.");
            using (NamedPipeClientStream pipe = new NamedPipeClientStream(".", Text(descriptor, "pipeName"), PipeDirection.InOut, PipeOptions.Asynchronous))
            {
                pipe.Connect(1500);
                using (StreamWriter writer = new StreamWriter(pipe, new UTF8Encoding(false), 1024, true))
                using (StreamReader reader = new StreamReader(pipe, Encoding.UTF8, false, 1024, true))
                {
                    writer.WriteLine(json.Serialize(new { token = Text(descriptor, "token"), command = command }));
                    writer.Flush();
                    Task<string> line = reader.ReadLineAsync();
                    if (!line.Wait(4000)) throw new TimeoutException("Localserve did not respond to desktop control.");
                    if (line.Result == null || line.Result.Length > 8192) throw new IOException("Invalid desktop response.");
                    Dictionary<string, object> response = json.Deserialize<Dictionary<string, object>>(line.Result);
                    if (Text(response, "ok") != "True") throw new IOException(Text(response, "error", "Desktop command failed."));
                    if (Convert.ToInt32(response["pid"]) != pid) throw new IOException("Localserve instance changed.");
                    return response;
                }
            }
        }

        public Dictionary<string, object> Status()
        {
            try { return Command("status"); }
            catch (Exception error)
            {
                string lockFile = FileAt("data/server.lock");
                bool activeLock = false;
                if (File.Exists(lockFile)) activeLock = ProcessExists(Convert.ToInt32(Read("data/server.lock")["pid"]));
                return new Dictionary<string, object> {
                    { "ok", true }, { "running", false }, { "unmanaged", activeLock },
                    { "error", activeLock ? error.Message : "" }, { "name", Text(Read("config.json"), "name", "Localserve") }
                };
            }
        }

        public Dictionary<string, object> Start()
        {
            // GUI and command-line callers share a per-installation startup gate.
            // A live PID is never killed/adopted merely because it holds a lock.
            using (Mutex gate = new Mutex(false, "Local\\LocalserveStart-" + Identity))
            {
                bool acquired = false;
                try
                {
                    try { acquired = gate.WaitOne(3000); } catch (AbandonedMutexException) { acquired = true; }
                    if (!acquired) throw new IOException("Another Localserve start is in progress.");
                    Dictionary<string, object> current = Status();
                    if (current.ContainsKey("pid")) return current;
                    if (Text(current, "unmanaged") == "True") throw new IOException("A Localserve lock is active. Stop its console instance before starting from the tray.");
                    string lockFile = FileAt("data/server.lock");
                    if (File.Exists(lockFile))
                    {
                        string previous = File.ReadAllText(lockFile);
                        int pid = Convert.ToInt32(json.Deserialize<Dictionary<string, object>>(previous)["pid"]);
                        if (ProcessExists(pid)) throw new IOException("Localserve lock is in use.");
                        if (File.ReadAllText(lockFile) != previous) throw new IOException("Localserve lock changed; try again.");
                        File.Delete(lockFile);
                        Log("Recovered stale Localserve lock for absent PID " + pid + ".");
                    }
                    ProcessStartInfo start = new ProcessStartInfo(FileAt("runtime/node.exe"), "\"" + FileAt("tray/server-host.mjs") + "\"");
                    start.WorkingDirectory = Root;
                    // Shell launch gives the hidden server its own lifetime and
                    // avoids inherited output pipes keeping the tray/CLI alive.
                    start.UseShellExecute = true;
                    start.WindowStyle = ProcessWindowStyle.Hidden;
                    using (Process child = Process.Start(start))
                    {
                        Log("Started bundled Localserve host PID " + child.Id + ".");
                        DateTime deadline = DateTime.UtcNow.AddSeconds(25);
                        while (DateTime.UtcNow < deadline)
                        {
                            if (child.HasExited) throw new IOException("Localserve could not start. See data/tray/server.log.");
                            try
                            {
                                Dictionary<string, object> ready = Command("status");
                                if (Convert.ToInt32(ready["pid"]) == child.Id) return ready;
                            }
                            catch (IOException) { }
                            catch (TimeoutException) { }
                            Thread.Sleep(200);
                        }
                        throw new TimeoutException("Localserve is still starting. Check status and server.log; the process was not terminated.");
                    }
                }
                finally { if (acquired) gate.ReleaseMutex(); }
            }
        }

        public void Stop()
        {
            Dictionary<string, object> current = Status();
            if (!current.ContainsKey("pid"))
            {
                if (Text(current, "unmanaged") == "True") throw new IOException("This console instance has no desktop control. Stop it from its console.");
                return;
            }
            int pid = Convert.ToInt32(current["pid"]);
            Command("stop");
            DateTime deadline = DateTime.UtcNow.AddSeconds(35);
            while (ProcessExists(pid) && DateTime.UtcNow < deadline) Thread.Sleep(150);
            if (ProcessExists(pid)) throw new TimeoutException("Localserve is still draining. It has not been force-stopped.");
            Log("Localserve completed graceful shutdown.");
        }

        public bool AutoStartServer
        {
            get { return Text(Read("tray/settings.json"), "autoStartServer", "True") == "True"; }
            set
            {
                string file = FileAt("tray/settings.json"), temporary = file + ".tmp";
                File.WriteAllText(temporary, json.Serialize(new { autoStartServer = value }) + Environment.NewLine, new UTF8Encoding(false));
                if (File.Exists(file)) File.Replace(temporary, file, null); else File.Move(temporary, file);
            }
        }

        private string StartupName { get { return "LocalserveTray-" + Identity; } }
        private string StartupCommand { get { return "\"" + FileAt("tray/LocalserveTray.exe") + "\" --autostart"; } }
        public bool WindowsStartup
        {
            get
            {
                using (RegistryKey run = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run"))
                    return run != null && Convert.ToString(run.GetValue(StartupName)) == StartupCommand;
            }
            set
            {
                // Windows startup needs a resolved executable path. Only this
                // application's per-user entry is touched; source paths stay portable.
                if (StartupCommand.Length > 260) throw new IOException("Installation path is too long for Windows startup. Move Localserve to a shorter path.");
                using (RegistryKey run = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run"))
                {
                    if (value) run.SetValue(StartupName, StartupCommand, RegistryValueKind.String);
                    else if (Convert.ToString(run.GetValue(StartupName)) == StartupCommand) run.DeleteValue(StartupName, false);
                }
                Log(value ? "Enabled startup for the current Windows user." : "Disabled current-user startup.");
            }
        }

        public void OpenAdministrator()
        {
            Dictionary<string, object> status = Command("status");
            Uri address = new Uri(Text(status, "origin"));
            if (!address.IsLoopback || address.Scheme != "http") throw new IOException("Invalid Localserve administrator address.");
            Process.Start(new ProcessStartInfo(address.AbsoluteUri) { UseShellExecute = true });
        }
        public string Json(object value) { return json.Serialize(value); }
    }

    public sealed class TrayContext : ApplicationContext
    {
        private readonly ServerHost host;
        private readonly NotifyIcon tray;
        private readonly System.Windows.Forms.Timer timer;
        private readonly ToolStripMenuItem status, start, stop, restart, enabled, open, startup, autoStart;
        private bool busy, refreshing, initialized;
        private Icon logo;

        public TrayContext(ServerHost server)
        {
            host = server;
            ContextMenuStrip menu = new ContextMenuStrip();
            status = new ToolStripMenuItem("Localserve — Checking") { Enabled = false };
            start = new ToolStripMenuItem("Start server", null, async (s, e) => await RunCommand(() => host.Start()));
            stop = new ToolStripMenuItem("Stop server", null, async (s, e) => await RunCommand(() => host.Stop()));
            restart = new ToolStripMenuItem("Restart server", null, async (s, e) => await RunCommand(() => { host.Stop(); host.Start(); }));
            enabled = new ToolStripMenuItem("Enabled", null, async (s, e) => await RunCommand(() => host.Command(enabled.Checked ? "pause" : "resume")));
            open = new ToolStripMenuItem("Open administrator", null, async (s, e) => await RunCommand(() => host.OpenAdministrator()));
            startup = new ToolStripMenuItem("Start with Windows", null, async (s, e) => await RunCommand(() => host.WindowsStartup = !host.WindowsStartup));
            autoStart = new ToolStripMenuItem("Start server when tray opens", null, async (s, e) => await RunCommand(() => host.AutoStartServer = !host.AutoStartServer));
            menu.Items.AddRange(new ToolStripItem[] { status, new ToolStripSeparator(), open, start, stop, restart, enabled,
                new ToolStripSeparator(), startup, autoStart,
                new ToolStripMenuItem("Open server log", null, (s, e) => OpenLog()),
                new ToolStripSeparator(),
                new ToolStripMenuItem("Exit tray (keep server running)", null, (s, e) => ExitThread()),
                new ToolStripMenuItem("Stop server and exit", null, async (s, e) => { if (await RunCommand(() => host.Stop())) ExitThread(); }) });
            logo = new Icon(host.FileAt("tray/assets/logo-dark.ico"));
            tray = new NotifyIcon { Icon = logo, ContextMenuStrip = menu, Text = "Localserve", Visible = true };
            tray.DoubleClick += async (s, e) => await RunCommand(() => host.OpenAdministrator());
            timer = new System.Windows.Forms.Timer { Interval = 500 };
            timer.Tick += async (s, e) => {
                if (!initialized)
                {
                    initialized = true; timer.Interval = 3000;
                    if (host.AutoStartServer) await RunCommand(() => host.Start());
                }
                await Refresh();
            };
            timer.Start();
        }

        private async Task<bool> RunCommand(Action operation)
        {
            if (busy) return false;
            busy = true;
            start.Enabled = stop.Enabled = restart.Enabled = enabled.Enabled = open.Enabled = false;
            bool succeeded = false;
            try { await Task.Run(operation); succeeded = true; }
            catch (Exception error)
            {
                host.Log(error.ToString());
                tray.ShowBalloonTip(5000, "Localserve", error.Message, ToolTipIcon.Error);
            }
            finally { busy = false; }
            await Refresh();
            return succeeded;
        }

        private async Task Refresh()
        {
            if (busy || refreshing) return;
            refreshing = true;
            try
            {
                Dictionary<string, object> current = await Task.Run(() => host.Status());
                if (busy) return;
                bool running = current.ContainsKey("pid"), unmanaged = ServerHost.Text(current, "unmanaged") == "True";
                bool paused = ServerHost.Text(current, "paused") == "True", stopping = ServerHost.Text(current, "stopping") == "True";
                string name = ServerHost.Text(current, "name", "Localserve");
                string label = stopping ? "Stopping" : running ? (paused ? "Paused" : "Running") : unmanaged ? "Console instance" : "Stopped";
                string summary = name + " — " + label;
                status.Text = summary;
                tray.Text = summary.Length > 63 ? summary.Substring(0, 63) : summary;
                start.Enabled = !running && !unmanaged;
                stop.Enabled = restart.Enabled = enabled.Enabled = open.Enabled = running && !stopping;
                enabled.Checked = running && !paused;
                startup.Checked = host.WindowsStartup;
                autoStart.Checked = host.AutoStartServer;
                // Use the application's light/negative icon to match the Windows taskbar.
                bool light = false;
                using (RegistryKey theme = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize"))
                    light = theme != null && Convert.ToInt32(theme.GetValue("SystemUsesLightTheme", 0)) == 1;
                string iconFile = host.FileAt(light ? "tray/assets/logo.ico" : "tray/assets/logo-dark.ico");
                using (Icon selected = new Icon(iconFile))
                {
                    Icon previous = logo;
                    logo = (Icon)selected.Clone(); tray.Icon = logo;
                    if (previous != null) previous.Dispose();
                }
            }
            catch (Exception error) { status.Text = "Localserve — " + error.Message; }
            finally { refreshing = false; }
        }

        private void OpenLog()
        {
            try
            {
                string file = host.FileAt("data/tray/server.log");
                if (!File.Exists(file)) { tray.ShowBalloonTip(3000, "Localserve", "No server log yet.", ToolTipIcon.Info); return; }
                Process.Start(new ProcessStartInfo(file) { UseShellExecute = true });
            }
            catch (Exception error) { tray.ShowBalloonTip(3000, "Localserve", error.Message, ToolTipIcon.Error); }
        }

        protected override void ExitThreadCore()
        {
            timer.Stop(); timer.Dispose();
            tray.Visible = false; tray.Dispose();
            if (logo != null) logo.Dispose();
            base.ExitThreadCore();
        }
    }

    public static class Program
    {
        [STAThread]
        public static int Main(string[] args)
        {
            string root = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, ".."));
            ServerHost host = new ServerHost(root);
            try
            {
                if (args.Length > 0 && args[0] != "--autostart")
                {
                    switch (args[0])
                    {
                        case "--status": Console.WriteLine(host.Json(host.Status())); break;
                        case "--start": Console.WriteLine(host.Json(host.Start())); break;
                        case "--stop": host.Stop(); Console.WriteLine("{\"ok\":true}"); break;
                        case "--restart": host.Stop(); Console.WriteLine(host.Json(host.Start())); break;
                        case "--pause": Console.WriteLine(host.Json(host.Command("pause"))); break;
                        case "--resume": Console.WriteLine(host.Json(host.Command("resume"))); break;
                        case "--enable-startup": host.WindowsStartup = true; Console.WriteLine("{\"ok\":true}"); break;
                        case "--disable-startup": host.WindowsStartup = false; Console.WriteLine("{\"ok\":true}"); break;
                        case "--startup-status": Console.WriteLine(host.Json(new { enabled = host.WindowsStartup })); break;
                        default: throw new ArgumentException("Unknown Localserve tray command.");
                    }
                    return 0;
                }
                using (Mutex single = new Mutex(false, "Local\\LocalserveTray-" + host.Identity))
                {
                    bool acquired;
                    try { acquired = single.WaitOne(0); } catch (AbandonedMutexException) { acquired = true; }
                    if (!acquired) return 0;
                    try { Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false); Application.Run(new TrayContext(host)); }
                    finally { single.ReleaseMutex(); }
                }
                return 0;
            }
            catch (Exception error)
            {
                host.Log(error.ToString());
                if (args.Length > 0 && args[0] != "--autostart") Console.Error.WriteLine(error.Message);
                else MessageBox.Show(error.Message, "Localserve", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }
        }
    }
}
