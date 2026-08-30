#import <Cocoa/Cocoa.h>
#include <stdint.h>
#include <string.h>

enum {
  RDE_FLAG_INSIDE = 1u,
  RDE_FLAG_FOCUSED = 2u,
  RDE_FLAG_VALID = 4u,
};

enum {
  RDE_MOD_SHIFT = 1u,
  RDE_MOD_CTRL = 2u,
  RDE_MOD_ALT = 4u,
  RDE_MOD_META = 8u,
};

enum {
  RDE_PTR_MOUSE = 0,
  RDE_PTR_PEN = 1,
  RDE_PTR_TOUCH = 2,
};

enum {
  RDE_EV_POINTER_DOWN = 1,
  RDE_EV_POINTER_UP = 2,
  RDE_EV_WHEEL = 3,
  RDE_EV_KEY_DOWN = 4,
  RDE_EV_KEY_UP = 5,
};

#define RDE_QUEUE_CAP 256
#define RDE_KEY_BYTES 32

typedef struct {
  uint32_t flags;
  float client_x;
  float client_y;
  float screen_x;
  float screen_y;
  float view_w;
  float view_h;
  uint32_t buttons;
  uint32_t modifiers;
  float pressure;
  float tilt_x;
  float tilt_y;
  float twist;
  uint32_t pointer_type;
} rde_snapshot_t;

typedef struct {
  uint32_t type;
  uint32_t button;
  uint32_t buttons;
  uint32_t modifiers;
  uint32_t click_count;
  uint32_t key_code;
  float client_x;
  float client_y;
  float screen_x;
  float screen_y;
  float delta_x;
  float delta_y;
  float delta_z;
  float pressure;
  float tilt_x;
  float tilt_y;
  float twist;
  uint32_t pointer_type;
  uint32_t key_len;
  uint8_t key[RDE_KEY_BYTES];
} rde_queued_event;

typedef struct {
  rde_queued_event events[RDE_QUEUE_CAP];
  int head;
  int count;
} rde_queue;

static NSLock* gLock;
static id gMonitor;
static void* gAttachedView;
static rde_queue gQueue;
static float gLastPressure = -1.f;
static float gLastTiltX = 0.f;
static float gLastTiltY = 0.f;
static float gLastTwist = 0.f;
static uint32_t gLastPointerType = RDE_PTR_MOUSE;

static void rde_init(void) {
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    gLock = [[NSLock alloc] init];
  });
}

static void rde_on_main(void (^work)(void)) {
  // deno test owns the main thread and never pumps NSApp, so
  // dispatch_sync would deadlock. Skip the hop when there is no app.
  if ([NSThread isMainThread] || NSApp == nil) work();
  else dispatch_sync(dispatch_get_main_queue(), work);
}

static NSView* rde_as_view(void* ptr) {
  if (!ptr) return nil;
  id obj = (__bridge id)ptr;
  if ([obj isKindOfClass:[NSView class]]) return (NSView*)obj;
  if ([obj isKindOfClass:[NSWindow class]]) return [(NSWindow*)obj contentView];
  return nil;
}

static uint32_t rde_modifiers(NSEventModifierFlags flags) {
  uint32_t m = 0;
  if (flags & NSEventModifierFlagShift) m |= RDE_MOD_SHIFT;
  if (flags & NSEventModifierFlagControl) m |= RDE_MOD_CTRL;
  if (flags & NSEventModifierFlagOption) m |= RDE_MOD_ALT;
  if (flags & NSEventModifierFlagCommand) m |= RDE_MOD_META;
  return m;
}

static uint32_t rde_dom_buttons(NSUInteger pressed) {
  return (uint32_t)(pressed & 0x1fu);
}

static uint32_t rde_dom_button(NSInteger n) {
  if (n == 1) return 2;
  if (n == 2) return 1;
  if (n < 0) return 0;
  return (uint32_t)n;
}

static uint32_t rde_pointer_type(NSEvent* e) {
  NSEventType t = e.type;
  if (t == NSEventTypeTabletPoint || t == NSEventTypeTabletProximity) {
    return RDE_PTR_PEN;
  }
  NSEventSubtype sub = e.subtype;
  if (sub == NSEventSubtypeTabletPoint || sub == NSEventSubtypeTabletProximity) {
    return RDE_PTR_PEN;
  }
  return RDE_PTR_MOUSE;
}

static NSRect rde_desktop_frame(void) {
  NSRect desktop = NSZeroRect;
  for (NSScreen* screen in NSScreen.screens) {
    desktop = NSUnionRect(desktop, screen.frame);
  }
  return desktop;
}

static int rde_map_screen(
  NSView* view,
  NSPoint screen,
  int require_front,
  float* cx,
  float* cy,
  float* sx,
  float* sy,
  float* vw,
  float* vh
) {
  NSWindow* window = view.window;
  if (!window) return 0;
  NSRect viewOnScreen = [window convertRectToScreen:
    [view convertRect:view.bounds toView:nil]];
  NSRect desktop = rde_desktop_frame();
  *sx = (float)screen.x;
  *sy = (float)(NSMaxY(desktop) - screen.y);
  *cx = (float)(screen.x - NSMinX(viewOnScreen));
  // Stay in screen space. convertPoint / isFlipped on winit views
  // does not agree with window-base Y.
  *cy = (float)(NSMaxY(viewOnScreen) - screen.y);
  *vw = (float)viewOnScreen.size.width;
  *vh = (float)viewOnScreen.size.height;
  if (!NSPointInRect(screen, viewOnScreen)) return 0;
  if (require_front) {
    NSInteger front = [NSWindow windowNumberAtPoint:screen
                       belowWindowWithWindowNumber:0];
    if (front != window.windowNumber) return 0;
  }
  return 1;
}

static void rde_push(rde_queued_event ev) {
  [gLock lock];
  if (gQueue.count == RDE_QUEUE_CAP) {
    gQueue.head = (gQueue.head + 1) % RDE_QUEUE_CAP;
    gQueue.count--;
  }
  int tail = (gQueue.head + gQueue.count) % RDE_QUEUE_CAP;
  gQueue.events[tail] = ev;
  gQueue.count++;
  [gLock unlock];
}

static NSPoint rde_event_screen(NSEvent* e) {
  if (e.window) {
    return [e.window convertPointToScreen:e.locationInWindow];
  }
  return [NSEvent mouseLocation];
}

static int rde_event_for_attached(NSEvent* e, NSView* view) {
  if (!view) return 0;
  NSWindow* ours = view.window;
  if (e.window && ours && e.window == ours) return 1;
  NSEventType t = e.type;
  if (t == NSEventTypeKeyDown || t == NSEventTypeKeyUp) {
    return ours.isKeyWindow ? 1 : 0;
  }
  float cx, cy, sx, sy, vw, vh;
  return rde_map_screen(view, rde_event_screen(e), 0, &cx, &cy, &sx, &sy, &vw, &vh);
}

static void rde_fill_pointer_fields(NSEvent* e, rde_queued_event* ev) {
  ev->pointer_type = rde_pointer_type(e);
  if (ev->pointer_type == RDE_PTR_PEN) {
    ev->pressure = (float)e.pressure;
    NSPoint tilt = e.tilt;
    ev->tilt_x = (float)(tilt.x * 90.0);
    ev->tilt_y = (float)(tilt.y * 90.0);
    ev->twist = (float)e.rotation;
    gLastPressure = ev->pressure;
    gLastTiltX = ev->tilt_x;
    gLastTiltY = ev->tilt_y;
    gLastTwist = ev->twist;
    gLastPointerType = RDE_PTR_PEN;
  } else {
    ev->pressure = -1.f;
    ev->tilt_x = gLastTiltX;
    ev->tilt_y = gLastTiltY;
    ev->twist = gLastTwist;
    ev->pointer_type = gLastPointerType;
  }
}

static void rde_handle_event(NSEvent* e) {
  NSView* view = rde_as_view(gAttachedView);
  if (!view || !rde_event_for_attached(e, view)) return;

  rde_queued_event ev;
  memset(&ev, 0, sizeof(ev));
  ev.modifiers = rde_modifiers(e.modifierFlags);
  ev.buttons = rde_dom_buttons(NSEvent.pressedMouseButtons);
  ev.click_count = (uint32_t)e.clickCount;
  ev.key_code = (uint32_t)e.keyCode;
  ev.pressure = -1.f;

  float vw = 0, vh = 0;
  int inside = rde_map_screen(
    view,
    rde_event_screen(e),
    0,
    &ev.client_x,
    &ev.client_y,
    &ev.screen_x,
    &ev.screen_y,
    &vw,
    &vh
  );
  (void)inside;

  switch (e.type) {
    case NSEventTypeLeftMouseDown:
    case NSEventTypeRightMouseDown:
    case NSEventTypeOtherMouseDown:
      ev.type = RDE_EV_POINTER_DOWN;
      ev.button = rde_dom_button(e.buttonNumber);
      rde_fill_pointer_fields(e, &ev);
      rde_push(ev);
      break;
    case NSEventTypeLeftMouseUp:
    case NSEventTypeRightMouseUp:
    case NSEventTypeOtherMouseUp:
      ev.type = RDE_EV_POINTER_UP;
      ev.button = rde_dom_button(e.buttonNumber);
      rde_fill_pointer_fields(e, &ev);
      rde_push(ev);
      break;
    case NSEventTypeScrollWheel:
      ev.type = RDE_EV_WHEEL;
      if (e.hasPreciseScrollingDeltas) {
        ev.delta_x = (float)e.scrollingDeltaX;
        ev.delta_y = (float)-e.scrollingDeltaY;
      } else {
        ev.delta_x = (float)(e.scrollingDeltaX * 16.0);
        ev.delta_y = (float)(-e.scrollingDeltaY * 16.0);
      }
      ev.delta_z = 0;
      rde_push(ev);
      break;
    case NSEventTypeKeyDown:
    case NSEventTypeKeyUp:
      ev.type = e.type == NSEventTypeKeyDown ? RDE_EV_KEY_DOWN : RDE_EV_KEY_UP;
      {
        NSString* chars = e.charactersIgnoringModifiers;
        if (chars.length == 0) chars = e.characters;
        if (chars.length > 0) {
          const char* utf8 = chars.UTF8String;
          if (utf8) {
            size_t n = strlen(utf8);
            if (n > RDE_KEY_BYTES) n = RDE_KEY_BYTES;
            memcpy(ev.key, utf8, n);
            ev.key_len = (uint32_t)n;
          }
        }
      }
      rde_push(ev);
      break;
    case NSEventTypeTabletPoint:
      rde_fill_pointer_fields(e, &ev);
      break;
    default:
      break;
  }
}

static void rde_install_monitor(void) {
  if (gMonitor) return;
  NSEventMask mask =
    NSEventMaskLeftMouseDown | NSEventMaskLeftMouseUp |
    NSEventMaskRightMouseDown | NSEventMaskRightMouseUp |
    NSEventMaskOtherMouseDown | NSEventMaskOtherMouseUp |
    NSEventMaskScrollWheel |
    NSEventMaskKeyDown | NSEventMaskKeyUp |
    NSEventMaskTabletPoint;
  gMonitor = [NSEvent addLocalMonitorForEventsMatchingMask:mask
    handler:^NSEvent* (NSEvent* e) {
      rde_handle_event(e);
      return e;
    }];
}

static void rde_remove_monitor(void) {
  if (!gMonitor) return;
  [NSEvent removeMonitor:gMonitor];
  gMonitor = nil;
}

int rde_abi_version(void) {
  return 1;
}

void* rde_find_window(const char* utf8_title) {
  if (!utf8_title) return NULL;
  rde_init();
  __block void* result = NULL;
  rde_on_main(^{
    @autoreleasepool {
      NSString* want = [NSString stringWithUTF8String:utf8_title];
      for (NSWindow* window in NSApp.windows) {
        if ([window.title isEqualToString:want]) {
          NSView* view = window.contentView;
          result = (__bridge void*)view;
          break;
        }
      }
    }
  });
  return result;
}

void* rde_find_front_window(void) {
  rde_init();
  __block void* result = NULL;
  rde_on_main(^{
    @autoreleasepool {
      NSWindow* window = NSApp.keyWindow;
      if (!window) window = NSApp.mainWindow;
      if (!window && NSApp.windows.count > 0) window = NSApp.windows[0];
      if (window) result = (__bridge void*)window.contentView;
    }
  });
  return result;
}

int rde_attach(void* view_ptr) {
  if (!view_ptr) return 0;
  rde_init();
  __block int ok = 0;
  rde_on_main(^{
    @autoreleasepool {
      if (!rde_as_view(view_ptr)) return;
      gAttachedView = view_ptr;
      [gLock lock];
      gQueue.head = 0;
      gQueue.count = 0;
      [gLock unlock];
      rde_install_monitor();
      ok = 1;
    }
  });
  return ok;
}

void rde_detach(void* view_ptr) {
  rde_init();
  rde_on_main(^{
    if (gAttachedView == view_ptr || view_ptr == NULL) {
      gAttachedView = NULL;
      rde_remove_monitor();
      [gLock lock];
      gQueue.head = 0;
      gQueue.count = 0;
      [gLock unlock];
    }
  });
}

int rde_snapshot(void* view_ptr, rde_snapshot_t* out) {
  if (!view_ptr || !out) return 0;
  rde_init();
  memset(out, 0, sizeof(*out));
  out->pressure = -1.f;
  __block int ok = 0;
  rde_on_main(^{
    @autoreleasepool {
      NSView* view = rde_as_view(view_ptr);
      if (!view) return;
      NSWindow* window = view.window;
      NSPoint screen = [NSEvent mouseLocation];
      float cx = 0, cy = 0, sx = 0, sy = 0, vw = 0, vh = 0;
      int inside = rde_map_screen(view, screen, 1, &cx, &cy, &sx, &sy, &vw, &vh);
      out->flags = RDE_FLAG_VALID;
      if (inside) out->flags |= RDE_FLAG_INSIDE;
      if (window.isKeyWindow) out->flags |= RDE_FLAG_FOCUSED;
      out->client_x = cx;
      out->client_y = cy;
      out->screen_x = sx;
      out->screen_y = sy;
      out->view_w = vw;
      out->view_h = vh;
      out->buttons = rde_dom_buttons(NSEvent.pressedMouseButtons);
      out->modifiers = rde_modifiers(NSEvent.modifierFlags);
      out->pressure = gLastPressure;
      out->tilt_x = gLastTiltX;
      out->tilt_y = gLastTiltY;
      out->twist = gLastTwist;
      out->pointer_type = gLastPointerType;
      ok = 1;
    }
  });
  return ok;
}

int rde_poll_events(void* view_ptr, rde_queued_event* buf, int cap) {
  if (!buf || cap <= 0) return 0;
  (void)view_ptr;
  rde_init();
  [gLock lock];
  int n = gQueue.count;
  if (n > cap) n = cap;
  for (int i = 0; i < n; i++) {
    buf[i] = gQueue.events[(gQueue.head + i) % RDE_QUEUE_CAP];
  }
  gQueue.head = (gQueue.head + n) % RDE_QUEUE_CAP;
  gQueue.count -= n;
  [gLock unlock];
  return n;
}
