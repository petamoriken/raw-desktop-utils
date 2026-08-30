/*
 * Windows backend for raw-desktop-events.
 *
 * TODO(windows): Implement the rde_* ABI using Win32. The TypeScript
 * side already speaks this struct layout. Suggested mapping:
 *
 *   rde_find_window     FindWindowW / EnumWindows + GetWindowTextW
 *   rde_find_front_window GetForegroundWindow (this process) or
 *                       EnumWindows filtered by GetWindowThreadProcessId
 *   rde_snapshot        GetCursorPos + ScreenToClient + GetClientRect
 *                       + WindowFromPoint / ChildWindowFromPointEx
 *                       + GetAsyncKeyState(VK_LBUTTON/RBUTTON/MBUTTON/
 *                         XBUTTON1/XBUTTON2)
 *                       + GetKeyState(VK_SHIFT/CONTROL/MENU) and
 *                         GetAsyncKeyState(VK_LWIN/VK_RWIN)
 *                       Honor SM_SWAPBUTTON when building the bitmask.
 *   rde_attach          SetWindowsHookExW(WH_GETMESSAGE or WH_MOUSE)
 *                       on the window thread, or use GetRawInputBuffer
 *                       for wheel / extra buttons. Drain into the same
 *                       rde_queued_event layout as macOS.
 *   rde_poll_events     Pop the hook queue.
 *
 * Coordinates must be top-left client pixels so they match
 * PointerEvent.clientX/clientY. screenY is from the top of the
 * virtual desktop (not Win32's bottom-left).
 *
 * This file currently exports the ABI and returns "not implemented"
 * so the package has a single native contract across platforms.
 */

#include <stdint.h>
#include <string.h>

#ifdef _WIN32
#define RDE_EXPORT __declspec(dllexport)
#else
#define RDE_EXPORT
#endif

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

RDE_EXPORT int rde_abi_version(void) {
  return 1;
}

RDE_EXPORT void* rde_find_window(const char* utf8_title) {
  (void)utf8_title;
  return NULL;
}

RDE_EXPORT void* rde_find_front_window(void) {
  return NULL;
}

RDE_EXPORT int rde_attach(void* view_ptr) {
  (void)view_ptr;
  return 0;
}

RDE_EXPORT void rde_detach(void* view_ptr) {
  (void)view_ptr;
}

RDE_EXPORT int rde_snapshot(void* view_ptr, rde_snapshot_t* out) {
  (void)view_ptr;
  if (out) memset(out, 0, sizeof(*out));
  return 0;
}

RDE_EXPORT int rde_poll_events(void* view_ptr, rde_queued_event* buf, int cap) {
  (void)view_ptr;
  (void)buf;
  (void)cap;
  return 0;
}
