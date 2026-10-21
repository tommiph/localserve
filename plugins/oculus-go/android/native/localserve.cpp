/** Head-tracked stereo cockpit and bounded tracked-remote input for Oculus Go. */
#include "VrApi.h"
#include "VrApi_Helpers.h"
#include "VrApi_Input.h"
#include <EGL/egl.h>
#include <GLES3/gl3.h>
#include <android/bitmap.h>
#include <android/log.h>
#include <android/native_window_jni.h>
#include <atomic>
#include <cmath>
#include <cstring>
#include <jni.h>
#include <mutex>
#include <pthread.h>
#include <unistd.h>
#include <vector>
#define LOG(...)                                                               \
  __android_log_print(ANDROID_LOG_INFO, "LocalserveGo", __VA_ARGS__)
static JavaVM *vm;
static jobject activity;
static ANativeWindow *window;
static pthread_t thread;
static std::atomic<bool> running(false), recenter(false);
static bool started = false;
static std::atomic<int> submittedFrames(0);
static std::mutex pixelsMutex;
static std::vector<unsigned char> pixels;
static bool dirty = false;
static constexpr int W = 1536, H = 1024;
static void error(JNIEnv *env, const char *s) {
  LOG("ERROR %s", s);
  jclass c = env->GetObjectClass(activity);
  jmethodID m = env->GetMethodID(c, "onNativeError", "(Ljava/lang/String;)V");
  jstring j = env->NewStringUTF(s);
  env->CallVoidMethod(activity, m, j);
  env->DeleteLocalRef(j);
  env->DeleteLocalRef(c);
}
static GLuint shader(GLenum type, const char *src) {
  GLuint s = glCreateShader(type);
  glShaderSource(s, 1, &src, nullptr);
  glCompileShader(s);
  GLint ok;
  glGetShaderiv(s, GL_COMPILE_STATUS, &ok);
  if (!ok) {
    char b[2048];
    glGetShaderInfoLog(s, sizeof(b), nullptr, b);
    LOG("Shader: %s", b);
  }
  return s;
}
static GLuint program() {
  const char *vs =
      "#version 300 es\nlayout(location=0) in vec3 p;layout(location=1) in "
      "vec2 uv;uniform mat4 mvp;out vec2 t;void "
      "main(){t=uv;gl_Position=mvp*vec4(p,1.0);gl_PointSize=2.0;}";
  const char *fs =
      "#version 300 es\nprecision mediump float;in vec2 t;uniform sampler2D "
      "tex;uniform vec4 color;uniform int textured;out vec4 frag;void "
      "main(){frag=textured==1?texture(tex,t):color;}";
  GLuint p = glCreateProgram(), v = shader(GL_VERTEX_SHADER, vs),
         f = shader(GL_FRAGMENT_SHADER, fs);
  glAttachShader(p, v);
  glAttachShader(p, f);
  glLinkProgram(p);
  glDeleteShader(v);
  glDeleteShader(f);
  return p;
}
struct V {
  float x, y, z, u, v;
};
static void draw(GLuint prog, GLuint buffer, const std::vector<V> &v,
                 GLenum mode, float r, float g, float b, bool textured) {
  glUniform1i(glGetUniformLocation(prog, "textured"), textured);
  glUniform4f(glGetUniformLocation(prog, "color"), r, g, b, 1);
  glBindBuffer(GL_ARRAY_BUFFER, buffer);
  glBufferData(GL_ARRAY_BUFFER, v.size() * sizeof(V), v.data(), GL_STREAM_DRAW);
  glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, sizeof(V), (void *)0);
  glVertexAttribPointer(1, 2, GL_FLOAT, GL_FALSE, sizeof(V),
                        (void *)(3 * sizeof(float)));
  glEnableVertexAttribArray(0);
  glEnableVertexAttribArray(1);
  glDrawArrays(mode, 0, v.size());
}
static void *render(void *) {
  JNIEnv *env;
  vm->AttachCurrentThread(&env, nullptr);
  ovrJava java = {vm, env, activity};
  auto init = vrapi_DefaultInitParms(&java);
  if (vrapi_Initialize(&init) != VRAPI_INITIALIZE_SUCCESS) {
    error(
        env,
        "VrApi initialization failed. This build requires Oculus Go firmware.");
    vm->DetachCurrentThread();
    return nullptr;
  }
  EGLDisplay display = eglGetDisplay(EGL_DEFAULT_DISPLAY);
  eglInitialize(display, nullptr, nullptr);
  EGLConfig configs[128], config = nullptr;
  EGLint count;
  eglGetConfigs(display, configs, 128, &count);
  for (int i = 0; i < count; i++) {
    EGLint renderable, surface, r, g, b, a, depth, samples;
    eglGetConfigAttrib(display, configs[i], EGL_RENDERABLE_TYPE, &renderable);
    eglGetConfigAttrib(display, configs[i], EGL_SURFACE_TYPE, &surface);
    eglGetConfigAttrib(display, configs[i], EGL_RED_SIZE, &r);
    eglGetConfigAttrib(display, configs[i], EGL_GREEN_SIZE, &g);
    eglGetConfigAttrib(display, configs[i], EGL_BLUE_SIZE, &b);
    eglGetConfigAttrib(display, configs[i], EGL_ALPHA_SIZE, &a);
    eglGetConfigAttrib(display, configs[i], EGL_DEPTH_SIZE, &depth);
    eglGetConfigAttrib(display, configs[i], EGL_SAMPLES, &samples);
    if ((renderable & 0x40) && (surface & EGL_PBUFFER_BIT) &&
        (surface & EGL_WINDOW_BIT) && r == 8 && g == 8 && b == 8 && a == 8 &&
        depth == 0 && samples == 0) {
      config = configs[i];
      break;
    }
  }
  const EGLint contextAttr[] = {EGL_CONTEXT_CLIENT_VERSION, 3, EGL_NONE},
               surfaceAttr[] = {EGL_WIDTH, 16, EGL_HEIGHT, 16, EGL_NONE};
  EGLContext context =
      config ? eglCreateContext(display, config, EGL_NO_CONTEXT, contextAttr)
             : EGL_NO_CONTEXT;
  EGLSurface surface =
      config ? eglCreatePbufferSurface(display, config, surfaceAttr)
             : EGL_NO_SURFACE;
  if (context == EGL_NO_CONTEXT || surface == EGL_NO_SURFACE ||
      !eglMakeCurrent(display, surface, surface, context)) {
    error(env, "Unable to create the OpenGL ES 3 renderer.");
    if (surface != EGL_NO_SURFACE)
      eglDestroySurface(display, surface);
    if (context != EGL_NO_CONTEXT)
      eglDestroyContext(display, context);
    eglTerminate(display);
    vrapi_Shutdown();
    vm->DetachCurrentThread();
    return nullptr;
  }
  auto mode = vrapi_DefaultModeParms(&java);
  mode.Flags |= VRAPI_MODE_FLAG_NATIVE_WINDOW;
  mode.Display = (size_t)display;
  mode.WindowSurface = (size_t)window;
  mode.ShareContext = (size_t)context;
  ovrMobile *ovr = vrapi_EnterVrMode(&mode);
  if (!ovr) {
    error(env, "Unable to enter Oculus VR mode.");
    eglMakeCurrent(display, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
    eglDestroySurface(display, surface);
    eglDestroyContext(display, context);
    eglTerminate(display);
    vrapi_Shutdown();
    vm->DetachCurrentThread();
    return nullptr;
  }
  vrapi_SetClockLevels(ovr, 2, 2);
  vrapi_SetPerfThread(ovr, VRAPI_PERF_THREAD_TYPE_RENDERER, gettid());
  int width = vrapi_GetSystemPropertyInt(
          &java, VRAPI_SYS_PROP_SUGGESTED_EYE_TEXTURE_WIDTH),
      height = vrapi_GetSystemPropertyInt(
          &java, VRAPI_SYS_PROP_SUGGESTED_EYE_TEXTURE_HEIGHT);
  if (width <= 0)
    width = 1024;
  if (height <= 0)
    height = 1024;
  ovrTextureSwapChain *chains[2];
  for (int eye = 0; eye < 2; eye++)
    chains[eye] = vrapi_CreateTextureSwapChain2(
        VRAPI_TEXTURE_TYPE_2D, VRAPI_TEXTURE_FORMAT_8888, width, height, 1, 3);
  GLuint prog = program(), buffer, vao, fbo, texture;
  glGenVertexArrays(1, &vao);
  glBindVertexArray(vao);
  glGenBuffers(1, &buffer);
  glGenFramebuffers(1, &fbo);
  glGenTextures(1, &texture);
  glBindTexture(GL_TEXTURE_2D, texture);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
  glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, W, H, 0, GL_RGBA, GL_UNSIGNED_BYTE,
               nullptr);
  const std::vector<V> board = {
      {-1.8f, 1.2f, -3, 0, 0}, {-1.8f, -1.2f, -3, 0, 1},
      {1.8f, -1.2f, -3, 1, 1}, {-1.8f, 1.2f, -3, 0, 0},
      {1.8f, -1.2f, -3, 1, 1}, {1.8f, 1.2f, -3, 1, 0}};
  // A stationary grid, distant stars and segmented light rings surround the
  // cockpit. Head tracking supplies all camera movement for VR comfort.
  std::vector<V> floor, stars, halo, outerHalo;
  for (int i = -12; i <= 12; i++) {
    floor.push_back({(float)i, -1.8f, -14, 0, 0});
    floor.push_back({(float)i, -1.8f, 4, 0, 0});
    floor.push_back({-12, -1.8f, (float)i, 0, 0});
    floor.push_back({12, -1.8f, (float)i, 0, 0});
  }
  for (int i = 0; i < 180; i++) {
    float a = i * 2.399963f, z = -10.f + (i % 11) * .2f;
    stars.push_back({std::sin(a) * 12, std::cos(a * 1.37f) * 7 + 3, z, 0, 0});
  }
  for (int i = 0; i < 96; i++) {
    if (i % 12 == 0 || i % 12 == 1) continue;
    for (int edge = 0; edge < 2; edge++) {
      float angle = (i + edge) * 6.2831853f / 96;
      halo.push_back({std::cos(angle) * 4.4f, std::sin(angle) * 3.2f, -6, 0, 0});
      outerHalo.push_back({std::cos(angle) * 6.2f, std::sin(angle) * 4.7f, -8, 0, 0});
    }
  }
  jclass cls = env->GetObjectClass(activity);
  jmethodID input = env->GetMethodID(cls, "onNativeInput", "(FFI)V");
  uint32_t prevButtons = 0;
  float touchStartX = 0, touchStartY = 0, touchLastX = 0, touchLastY = 0;
  bool touching = false;
  long long frame = 0;
  float oldX = -9, oldY = -9;
  double lastInput = 0;
  LOG("VR renderer ready: %dx%d per eye", width, height);
  while (running) {
    ++frame;
    if (recenter.exchange(false))
      vrapi_RecenterPose(ovr);
    double time = vrapi_GetPredictedDisplayTime(ovr, frame);
    auto tracking = vrapi_GetPredictedTracking2(ovr, time);
    auto pose = tracking.HeadPose.Pose;
    uint32_t buttons = 0;
    int actions = 0;
    bool controller = false;
    for (uint32_t i = 0;; i++) {
      ovrInputCapabilityHeader cap;
      if (vrapi_EnumerateInputDevices(ovr, i, &cap) < 0)
        break;
      if (cap.Type != ovrControllerType_TrackedRemote)
        continue;
      ovrInputStateTrackedRemote s = {};
      s.Header.ControllerType = cap.Type;
      if (vrapi_GetCurrentInputState(ovr, cap.DeviceID, &s.Header) < 0)
        continue;
      ovrTracking remote;
      if (vrapi_GetInputTrackingState(ovr, cap.DeviceID, time, &remote) >= 0) {
        pose = remote.HeadPose.Pose;
        controller = true;
      }
      buttons = s.Buttons;
      if (s.TrackpadStatus) {
        if (!touching) {
          touchStartX = s.TrackpadPosition.x;
          touchStartY = s.TrackpadPosition.y;
        }
        touchLastX = s.TrackpadPosition.x;
        touchLastY = s.TrackpadPosition.y;
        touching = true;
      } else if (touching) {
        float deltaX = touchLastX - touchStartX, deltaY = touchLastY - touchStartY;
        float delta = fabsf(deltaX) > fabsf(deltaY) ? deltaX : deltaY;
        if (fabsf(delta) > 35)
          actions |= delta > 0 ? 4 : 8;
        touching = false;
      }
      break;
    }
    ovrMatrix4f rot = ovrMatrix4f_CreateFromQuaternion(&pose.Orientation);
    float dx = -rot.M[0][2], dy = -rot.M[1][2], dz = -rot.M[2][2],
          ox = controller ? .18f : 0, oy = controller ? -.25f : 0;
    float hitX = -1, hitY = -1, wx = 0, wy = 0;
    if (dz < -.02f) {
      float t = -3 / dz;
      wx = ox + dx * t;
      wy = oy + dy * t;
      hitX = (wx + 1.8f) / 3.6f;
      hitY = (1.2f - wy) / 2.4f;
    }
    if ((buttons & (ovrButton_A | ovrButton_Enter)) &&
        !(prevButtons & (ovrButton_A | ovrButton_Enter)))
      actions |= 1;
    if ((buttons & ovrButton_Back) && !(prevButtons & ovrButton_Back))
      actions |= 2;
    prevButtons = buttons;
    if (actions || (time - lastInput > .05 && (fabsf(hitX - oldX) > .002f ||
                                               fabsf(hitY - oldY) > .002f))) {
      env->CallVoidMethod(activity, input, hitX * W, hitY * H, actions);
      if (env->ExceptionCheck()) {
        env->ExceptionDescribe();
        env->ExceptionClear();
      }
      oldX = hitX;
      oldY = hitY;
      lastInput = time;
    }
    glBindTexture(GL_TEXTURE_2D, texture);
    {
      std::lock_guard<std::mutex> lock(pixelsMutex);
      if (dirty && pixels.size() == W * H * 4) {
        glTexSubImage2D(GL_TEXTURE_2D, 0, 0, 0, W, H, GL_RGBA, GL_UNSIGNED_BYTE,
                        pixels.data());
        dirty = false;
      }
    }
    auto layer = vrapi_DefaultLayerProjection2();
    layer.HeadPose = tracking.HeadPose;
    glUseProgram(prog);
    glUniform1i(glGetUniformLocation(prog, "tex"), 0);
    glDisable(GL_DEPTH_TEST);
    glDisable(GL_CULL_FACE);
    glDisable(GL_BLEND);
    for (int eye = 0; eye < 2; eye++) {
      int index = frame % vrapi_GetTextureSwapChainLength(chains[eye]);
      glBindFramebuffer(GL_FRAMEBUFFER, fbo);
      glFramebufferTexture2D(
          GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D,
          vrapi_GetTextureSwapChainHandle(chains[eye], index), 0);
      glViewport(0, 0, width, height);
      glClearColor(.009f, .016f, .035f, 1);
      glClear(GL_COLOR_BUFFER_BIT);
      auto mvp = ovrMatrix4f_Multiply(&tracking.Eye[eye].ProjectionMatrix,
                                      &tracking.Eye[eye].ViewMatrix);
      auto trans = ovrMatrix4f_Transpose(&mvp);
      glUniformMatrix4fv(glGetUniformLocation(prog, "mvp"), 1, GL_FALSE,
                         &trans.M[0][0]);
      draw(prog, buffer, stars, GL_POINTS, .19f, .3f, .43f, false);
      draw(prog, buffer, floor, GL_LINES, .035f, .18f, .21f, false);
      draw(prog, buffer, outerHalo, GL_LINES, .22f, .12f, .4f, false);
      draw(prog, buffer, halo, GL_LINES, .12f, .47f, .49f, false);
      draw(prog, buffer, board, GL_TRIANGLES, 1, 1, 1, true);
      if (hitX >= 0 && hitX <= 1 && hitY >= 0 && hitY <= 1) {
        float s = .012f;
        std::vector<V> cursor = {{wx - s, wy, -2.985f, 0, 0},
                                 {wx + s, wy, -2.985f, 0, 0},
                                 {wx, wy - s, -2.985f, 0, 0},
                                 {wx, wy + s, -2.985f, 0, 0}};
        glLineWidth(2);
        draw(prog, buffer, cursor, GL_LINES, .4f, 1, .85f, false);
      }
      layer.Textures[eye].ColorSwapChain = chains[eye];
      layer.Textures[eye].SwapChainIndex = index;
      layer.Textures[eye].TexCoordsFromTanAngles =
          ovrMatrix4f_TanAngleMatrixFromProjection(
              &tracking.Eye[eye].ProjectionMatrix);
    }
    glBindFramebuffer(GL_FRAMEBUFFER, 0);
    glFlush();
    const ovrLayerHeader2 *layers[] = {&layer.Header};
    ovrSubmitFrameDescription2 desc = {};
    desc.FrameIndex = frame;
    desc.DisplayTime = time;
    desc.SwapInterval = 1;
    desc.LayerCount = 1;
    desc.Layers = layers;
    ovrResult submitted = vrapi_SubmitFrame2(ovr, &desc);
    if (submitted >= 0)
      submittedFrames++;
  }
  env->DeleteLocalRef(cls);
  vrapi_LeaveVrMode(ovr);
  for (auto chain : chains)
    vrapi_DestroyTextureSwapChain(chain);
  glDeleteTextures(1, &texture);
  glDeleteFramebuffers(1, &fbo);
  glDeleteBuffers(1, &buffer);
  glDeleteVertexArrays(1, &vao);
  glDeleteProgram(prog);
  eglMakeCurrent(display, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
  eglDestroySurface(display, surface);
  eglDestroyContext(display, context);
  eglTerminate(display);
  vrapi_Shutdown();
  vm->DetachCurrentThread();
  return nullptr;
}
extern "C" JNIEXPORT void JNICALL
Java_org_localserve_go_MainActivity_nativeStart(JNIEnv *env, jobject obj,
                                                jobject surf) {
  if (started)
    return;
  env->GetJavaVM(&vm);
  activity = env->NewGlobalRef(obj);
  window = ANativeWindow_fromSurface(env, surf);
  running = true;
  started = true;
  {
    std::lock_guard<std::mutex> lock(pixelsMutex);
    dirty = true;
  }
  pthread_create(&thread, nullptr, render, nullptr);
}
extern "C" JNIEXPORT void JNICALL
Java_org_localserve_go_MainActivity_nativeStop(JNIEnv *env, jobject) {
  if (!started)
    return;
  running = false;
  pthread_join(thread, nullptr);
  ANativeWindow_release(window);
  env->DeleteGlobalRef(activity);
  started = false;
}
extern "C" JNIEXPORT void JNICALL
Java_org_localserve_go_MainActivity_nativeRecenter(JNIEnv *, jobject) {
  recenter = true;
}
extern "C" JNIEXPORT jint JNICALL
Java_org_localserve_go_MainActivity_nativeFrames(JNIEnv *, jobject) {
  return submittedFrames.load();
}
extern "C" JNIEXPORT void JNICALL
Java_org_localserve_go_MainActivity_nativeBitmap(JNIEnv *env, jobject,
                                                 jobject bitmap) {
  AndroidBitmapInfo info;
  AndroidBitmap_getInfo(env, bitmap, &info);
  if (info.width != W || info.height != H ||
      info.format != ANDROID_BITMAP_FORMAT_RGBA_8888)
    return;
  void *ptr;
  if (AndroidBitmap_lockPixels(env, bitmap, &ptr) !=
      ANDROID_BITMAP_RESULT_SUCCESS)
    return;
  {
    std::lock_guard<std::mutex> lock(pixelsMutex);
    pixels.resize(W * H * 4);
    for (int y = 0; y < H; y++)
      memcpy(pixels.data() + y * W * 4, (unsigned char *)ptr + y * info.stride,
             W * 4);
    dirty = true;
  }
  AndroidBitmap_unlockPixels(env, bitmap);
}
