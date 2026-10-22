using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

// Windows DirectShow capture has no listener, file output, audio capture or service installation.
// Frames leave only through stdout. Stdin EOF, Stop or a missing owner heartbeat ends capture.
public static class Capture {
    static readonly Guid Video = new Guid("73646976-0000-0010-8000-00aa00389b71");
    static readonly Guid VideoInfo = new Guid("05589f80-c356-11ce-bf01-00aa0055595a");
    static readonly Guid Category = new Guid("fb6c4281-0353-11d1-905f-0000c0cc16ba");
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 900000 };
    static volatile bool stopped;
    static long heartbeat;
    static readonly Stopwatch Clock = Stopwatch.StartNew();
    static object Com(string id) { return Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid(id))); }
    static void Check(int result) { if (result < 0) Marshal.ThrowExceptionForHR(result); }
    static void Release(object value) { if (value != null && Marshal.IsComObject(value)) Marshal.ReleaseComObject(value); }
    static void Free(MediaType value) { if (value == null) return;
        if (value.Format != IntPtr.Zero) Marshal.FreeCoTaskMem(value.Format);
        if (value.Unknown != IntPtr.Zero) Marshal.Release(value.Unknown);
    }
    static void Output(object value) { Console.WriteLine(Json.Serialize(value)); Console.Out.Flush(); }

    [STAThread] static int Main(string[] args) {
        Console.OutputEncoding = new UTF8Encoding(false);
        try {
            if (args.Length == 1 && args[0] == "--self-test") {
                using (Bitmap image = new Bitmap(64,48)) { using (Graphics g=Graphics.FromImage(image)) g.Clear(Color.Gray); Output(Packet(image,1)); }
                return 0;
            }
            if (args.Length == 1 && args[0] == "--list") {
                List<object> entries = new List<object>(); Enumerate(delegate(IMoniker item,int index) {
                    object bag=null; try { Guid id=typeof(IPropertyBag).GUID; item.BindToStorage(null,null,ref id,out bag);
                        object name; Check(((IPropertyBag)bag).Read("FriendlyName",out name,IntPtr.Zero));
                        string text=Convert.ToString(name); entries.Add(new { index=index, name=text.Length>128?text.Substring(0,128):text });
                    } finally { Release(bag); } return false;
                }); Output(new { devices=entries }); return 0;
            }
            if (args.Length != 5) throw new ArgumentException("Use device index, width, height, FPS and JPEG quality.");
            int selected=Bound(args[0],0,31), width=Bound(args[1],160,1280), height=Bound(args[2],120,720), fps=Bound(args[3],1,10), quality=Bound(args[4],20,90);
            heartbeat=Clock.ElapsedMilliseconds;
            Thread input=new Thread(delegate() { try { string line; while ((line=Console.ReadLine())!=null) {
                if (line=="stop") break; if(line=="ping") Interlocked.Exchange(ref heartbeat,Clock.ElapsedMilliseconds);
            }} finally { stopped=true; } }); input.IsBackground=true; input.Start();
            // A blocked camera driver must not outlive its owner. Give normal graph
            // cleanup two seconds, then end only this helper's own process.
            Thread watchdog=new Thread(delegate() {
                while(!stopped&&Clock.ElapsedMilliseconds-Interlocked.Read(ref heartbeat)<20000)Thread.Sleep(250);
                stopped=true;Thread.Sleep(2000);Environment.Exit(0);
            });watchdog.IsBackground=true;watchdog.Start();
            Run(selected,width,height,fps,quality); return 0;
        } catch (Exception error) { Console.Error.WriteLine("Camera capture unavailable: " + error.GetType().Name + " ("+error.HResult+")."); return 1; }
    }
    static int Bound(string text,int min,int max) { int value; if(!int.TryParse(text,out value)||value<min||value>max) throw new ArgumentException("Capture argument outside bounds.");return value; }
    // Read display names/indices only; enumeration does not open a video stream.
    static void Enumerate(Func<IMoniker,int,bool> visit) {
        object system=Com("62be5d10-60eb-11d0-bd3b-00a0c911ce86"); IEnumMoniker iterator=null;
        try { Guid category=new Guid("860bb310-5d01-11d0-bd3b-00a0c911ce86");
            int status=((IDeviceEnum)system).CreateClassEnumerator(ref category,out iterator,0); Check(status);
            if(status!=0||iterator==null)return; IMoniker[] item=new IMoniker[1];int index=0;
            while(index<32&&iterator.Next(1,item,IntPtr.Zero)==0) { try { if(visit(item[0],index++))break; } finally { Release(item[0]); } }
        } finally { Release(iterator);Release(system); }
    }
    // Prefer a bounded native format near the requested aspect ratio and size.
    // Drivers without this interface keep their default format; output is still bounded.
    static void Configure(object builder,IBaseFilter source,int width,int height) {
        object config=null;IntPtr caps=IntPtr.Zero;MediaType best=null;
        try { Guid category=Category,video=Video,id=typeof(IStreamConfig).GUID;
            int found=((ICaptureBuilder)builder).FindInterface(ref category,ref video,source,ref id,out config);
            if(found<0||config==null)return; int count,size;Check(((IStreamConfig)config).GetNumberOfCapabilities(out count,out size));
            if(count<1||count>256||size<1||size>4096)return;caps=Marshal.AllocCoTaskMem(size);double score=double.MaxValue;
            for(int i=0;i<count;i++){IntPtr pointer=IntPtr.Zero;MediaType media=null;
                try { if(((IStreamConfig)config).GetStreamCaps(i,out pointer,caps)<0||pointer==IntPtr.Zero)continue;
                    media=(MediaType)Marshal.PtrToStructure(pointer,typeof(MediaType));
                    if(media.FormatType!=VideoInfo||media.FormatSize<88)continue;
                    int w=Marshal.ReadInt32(media.Format,52),h=Math.Abs(Marshal.ReadInt32(media.Format,56));
                    if(w<1||w>1920||h<1||h>1080)continue;
                    double next=Math.Abs((double)w/h-(double)width/height)*10000+Math.Abs(w-width)+Math.Abs(h-height);
                    if(next<score){Free(best);best=media;media=null;score=next;}
                } finally {Free(media);if(pointer!=IntPtr.Zero)Marshal.FreeCoTaskMem(pointer);}
            }
            if(best!=null)Check(((IStreamConfig)config).SetFormat(best));
        } finally {Free(best);if(caps!=IntPtr.Zero)Marshal.FreeCoTaskMem(caps);Release(config);}
    }
    // A Sample Grabber and Null Renderer keep capture independent of a desktop window.
    // COM filters and callbacks belong exclusively to this process and graph.
    static void Run(int selected,int width,int height,int fps,int quality) {
        object sourceObject=null,graph=null,builder=null,grabObject=null,sink=null; FrameSink callback=new FrameSink();
        try {
            Enumerate(delegate(IMoniker item,int index) { if(index!=selected)return false;Guid id=typeof(IBaseFilter).GUID;item.BindToObject(null,null,ref id,out sourceObject);return true; });
            if(sourceObject==null)throw new InvalidOperationException("Camera not present.");
            IBaseFilter source=(IBaseFilter)sourceObject;
            graph=Com("e436ebb3-524f-11ce-9f53-0020af0ba770");builder=Com("bf87b6e1-8c27-11d0-b3f0-00aa003761c5");
            Check(((ICaptureBuilder)builder).SetFiltergraph((IGraph)graph)); Check(((IGraph)graph).AddFilter(source,"Webcam"));
            Configure(builder,source,width,height);
            grabObject=Com("c1f400a0-3f08-11d3-9f0b-006008039e37");ISampleGrabber grab=(ISampleGrabber)grabObject;
            MediaType media=new MediaType { Major=Video, Subtype=new Guid("e436eb7d-524f-11ce-9f53-0020af0ba770"), FormatType=VideoInfo };
            Check(grab.SetMediaType(media));Check(grab.SetOneShot(false));Check(grab.SetBufferSamples(false));
            Check(((IGraph)graph).AddFilter((IBaseFilter)grabObject,"Frame samples"));
            sink=Com("c1f400a4-3f08-11d3-9f0b-006008039e37");Check(((IGraph)graph).AddFilter((IBaseFilter)sink,"No display"));
            Guid category=Category,video=Video;Check(((ICaptureBuilder)builder).RenderStream(ref category,ref video,source, (IBaseFilter)grabObject,(IBaseFilter)sink));
            MediaType connected=new MediaType();try {Check(grab.GetConnectedMediaType(connected));
                if(connected.Subtype!=media.Subtype||connected.FormatType!=VideoInfo||connected.FormatSize<88)throw new InvalidOperationException("Expected RGB24 video.");
                callback.Width=Marshal.ReadInt32(connected.Format,52);callback.Height=Marshal.ReadInt32(connected.Format,56);
                if(callback.Width<1||callback.Width>4096||callback.Height==0||Math.Abs(callback.Height)>2160)throw new InvalidOperationException("Video size outside bounds.");
            } finally {Free(connected);}
            callback.Interval=1000/fps;Check(grab.SetCallback(callback,1));Check(((IMediaControl)graph).Run());long sequence=0,next=0;
            while(!stopped&&Clock.ElapsedMilliseconds-Interlocked.Read(ref heartbeat)<20000) {
                if(Clock.ElapsedMilliseconds>=next){byte[] raw=callback.Take();if(raw!=null){
                    using(Bitmap image=callback.Bitmap(raw)) {
                        double scale=Math.Min(1,Math.Min((double)width/image.Width,(double)height/image.Height));
                        using(Bitmap resized=new Bitmap(Math.Max(1,(int)(image.Width*scale)),Math.Max(1,(int)(image.Height*scale)))) {
                            using(Graphics g=Graphics.FromImage(resized))g.DrawImage(image,0,0,resized.Width,resized.Height);
                            Output(Packet(resized,++sequence,quality));
                        }
                    }
                } next=Clock.ElapsedMilliseconds+1000/fps;}Thread.Sleep(15);
            }
        } finally {
            callback.Closed=true;
            try {if(graph!=null)((IMediaControl)graph).Stop();}catch{}
            try {if(grabObject!=null)((ISampleGrabber)grabObject).SetCallback(null,1);}catch{}
            Release(builder);Release(sink);Release(grabObject);Release(sourceObject);Release(graph);
        }
    }
    // A small luminance sample drives detection; the full image is only JPEG output.
    static object Packet(Bitmap image,long sequence,int quality=70) {
        byte[] grey=new byte[32*24];for(int y=0;y<24;y++)for(int x=0;x<32;x++) {
            Color c=image.GetPixel(Math.Min(image.Width-1,x*image.Width/32),Math.Min(image.Height-1,y*image.Height/24));
            grey[y*32+x]=(byte)((77*c.R+150*c.G+29*c.B)>>8);
        }
        using(MemoryStream stream=new MemoryStream())using(EncoderParameters options=new EncoderParameters(1)) {
            options.Param[0]=new EncoderParameter(System.Drawing.Imaging.Encoder.Quality,(long)quality);
            ImageCodecInfo jpeg=Array.Find(ImageCodecInfo.GetImageEncoders(),c=>c.MimeType=="image/jpeg");image.Save(stream,jpeg,options);
            if(stream.Length>512*1024)throw new InvalidOperationException("JPEG outside bounds.");
            return new { sequence=sequence, width=image.Width,height=image.Height,jpeg=Convert.ToBase64String(stream.ToArray()),grey=Convert.ToBase64String(grey) };
        }
    }
    [ComVisible(true),ClassInterface(ClassInterfaceType.None)] public sealed class FrameSink:ISampleGrabberCB {
        public int Width,Height,Interval=200;long next;public volatile bool Closed;byte[] latest;readonly object gate=new object();
        public int SampleCB(double time,IntPtr sample){return 0;}
        public int BufferCB(double time,IntPtr data,int length){
            if(Closed||length<1||length>24*1024*1024)return 0;
            long now=Clock.ElapsedMilliseconds;if(now<Interlocked.Read(ref next))return 0;Interlocked.Exchange(ref next,now+Interval);
            try {byte[] bytes=new byte[length];Marshal.Copy(data,bytes,0,length);lock(gate)latest=bytes;}catch{}return 0;
        }
        public byte[] Take(){lock(gate){byte[] bytes=latest;latest=null;return bytes;}}
        // DirectShow RGB24 rows are DWORD-aligned and may arrive bottom-up.
        public Bitmap Bitmap(byte[] raw){int h=Math.Abs(Height),stride=(Width*3+3)&~3;
            if(raw.Length<stride*h)throw new InvalidOperationException("Short RGB frame.");
            Bitmap result=new Bitmap(Width,h,PixelFormat.Format24bppRgb);BitmapData bits=result.LockBits(new Rectangle(0,0,Width,h),ImageLockMode.WriteOnly,PixelFormat.Format24bppRgb);
            try{for(int y=0;y<h;y++)Marshal.Copy(raw,(Height>0?h-1-y:y)*stride,IntPtr.Add(bits.Scan0,y*bits.Stride),Width*3);}finally{result.UnlockBits(bits);}return result;
        }
    }
    [StructLayout(LayoutKind.Sequential)] sealed class MediaType {
        public Guid Major,Subtype;[MarshalAs(UnmanagedType.Bool)]public bool Fixed,Temporal;public int SampleSize;public Guid FormatType;public IntPtr Unknown;public int FormatSize;public IntPtr Format;
    }
    [ComImport,Guid("29840822-5b84-11d0-bd3b-00a0c911ce86"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IDeviceEnum {
        [PreserveSig]int CreateClassEnumerator(ref Guid category,out IEnumMoniker iterator,int flags);
    }
    [ComImport,Guid("55272a00-42cb-11ce-8135-00aa004bb851"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IPropertyBag {
        [PreserveSig]int Read([MarshalAs(UnmanagedType.LPWStr)]string name,[MarshalAs(UnmanagedType.Struct)]out object value,IntPtr error);
    }
    [ComImport,Guid("56a86895-0ad4-11ce-b03a-0020af0ba770"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IBaseFilter {}
    [ComImport,Guid("56a868a9-0ad4-11ce-b03a-0020af0ba770"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IGraph {
        [PreserveSig]int AddFilter(IBaseFilter filter,[MarshalAs(UnmanagedType.LPWStr)]string name);
    }
    [ComImport,Guid("93e5a4e0-2d50-11d2-abfa-00a0c9c6e38d"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface ICaptureBuilder {
        [PreserveSig]int SetFiltergraph(IGraph graph);[PreserveSig]int GetFiltergraph(out IGraph graph);
        [PreserveSig]int SetOutputFileName(ref Guid type,string file,out IBaseFilter filter,out IntPtr sink);
        [PreserveSig]int FindInterface(ref Guid category,ref Guid type,IBaseFilter source,ref Guid id,[MarshalAs(UnmanagedType.IUnknown)]out object result);
        [PreserveSig]int RenderStream(ref Guid category,ref Guid type,[MarshalAs(UnmanagedType.IUnknown)]object source,IBaseFilter compressor,IBaseFilter renderer);
    }
    [ComImport,Guid("c6e13340-30ac-11d0-a18c-00a0c9118956"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IStreamConfig {
        [PreserveSig]int SetFormat([In]MediaType type);[PreserveSig]int GetFormat(out IntPtr type);
        [PreserveSig]int GetNumberOfCapabilities(out int count,out int size);[PreserveSig]int GetStreamCaps(int index,out IntPtr type,IntPtr capabilities);
    }
    [ComImport,Guid("6b652fff-11fe-4fce-92ad-0266b5d7c78f"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface ISampleGrabber {
        [PreserveSig]int SetOneShot([MarshalAs(UnmanagedType.Bool)]bool one);
        [PreserveSig]int SetMediaType([In]MediaType type);[PreserveSig]int GetConnectedMediaType([Out]MediaType type);
        [PreserveSig]int SetBufferSamples([MarshalAs(UnmanagedType.Bool)]bool buffer);
        [PreserveSig]int GetCurrentBuffer(ref int length,IntPtr buffer);[PreserveSig]int GetCurrentSample(IntPtr sample);
        [PreserveSig]int SetCallback(ISampleGrabberCB callback,int method);
    }
    [ComVisible(true),Guid("0579154a-2b53-4994-b0d0-e773148eff85"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] public interface ISampleGrabberCB {
        [PreserveSig]int SampleCB(double time,IntPtr sample);[PreserveSig]int BufferCB(double time,IntPtr buffer,int length);
    }
    [ComImport,Guid("56a868b1-0ad4-11ce-b03a-0020af0ba770"),InterfaceType(ComInterfaceType.InterfaceIsDual)] interface IMediaControl {
        [PreserveSig]int Run();[PreserveSig]int Pause();[PreserveSig]int Stop();
    }
}
