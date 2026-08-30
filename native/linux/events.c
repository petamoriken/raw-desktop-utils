/*
 * Linux backend for raw-desktop-events.
 *
 * TODO(linux): Implement the rde_* ABI for X11 and, later, Wayland.
 *
 * X11 (poll-first, easier to ship):
 *   rde_find_window     XOpenDisplay + XQueryTree + XFetchName /
 *                       XGetWMName, match UTF-8 title
 *   rde_snapshot        XQueryPointer for root/win coords and button mask
 *                       (Button1Mask..Button5Mask → DOM buttons bits)
 *                       XGetInputFocus for focused
 *                       XGetWindowAttributes for view size
 *   rde_attach          XSelectInput(PointerMotionMask | ButtonPressMask |
 *                       ButtonReleaseMask | KeyPressMask | KeyReleaseMask |
 *                       EnterWindowMask | LeaveWindowMask | FocusChangeMask)
 *                       then XNextEvent / XCheckIfEvent into the queue
 *   Wheel               Button4/5 (vertical) and 6/7 (horizontal), or
 *                       XI2 valuators when available
 *
 * Wayland:
 *   wl_pointer / xdg_toplevel. Deno desktop raw windows may be either
 *   X11 or Wayland depending on the compositor. Detect via
 *   UnsafeWindowSurface's system tag when that handle is exposed.
 *
 * Coordinates must be top-left client pixels.
 *
 * This file currently exports the ABI and returns "not implemented"
 * so the package has a single native contract across platforms.
 */

#include <stdint.h>
#include <string.h>

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
  uint8_t key[32];
} rde_queued_event;

int rde_abi_version(void) {
  return 1;
}

void* rde_find_window(const char* utf8_title) {
  (void)utf8_title;
  return NULL;
}

void* rde_find_front_window(void) {
  return NULL;
}

int rde_attach(void* view_ptr) {
  (void)view_ptr;
  return 0;
}

void rde_detach(void* view_ptr) {
  (void)view_ptr;
}

int rde_snapshot(void* view_ptr, rde_snapshot_t* out) {
  (void)view_ptr;
  if (out) memset(out, 0, sizeof(*out));
  return 0;
}

int rde_poll_events(void* view_ptr, rde_queued_event* buf, int cap) {
  (void)view_ptr;
  (void)buf;
  (void)cap;
  return 0;
}
