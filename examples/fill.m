//! Overlay plain rectangles on a child view. Never layer-back the winit
//! content view: that freezes chrome (close) and stops redraws.
#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>
#include <stdlib.h>
#include <string.h>

static const int kMaxRects = 16;
static NSString* const kCanvasName = @"rdu-ex-canvas";

@interface RduExCanvas : NSView
@end

@implementation RduExCanvas
- (NSView*)hitTest:(NSPoint)_point {
  (void)_point;
  return nil;
}
@end

static void on_main_sync(void (^work)(void)) {
  if (NSThread.isMainThread) {
    work();
    return;
  }
  dispatch_sync(dispatch_get_main_queue(), work);
}

void* rdu_ex_find_view(const char* title) {
  if (!title) return NULL;
  __block void* out = NULL;
  on_main_sync(^{
    NSString* want = [NSString stringWithUTF8String:title];
    for (NSWindow* window in NSApp.windows) {
      if ([window.title isEqualToString:want]) {
        out = (__bridge void*)window.contentView;
        break;
      }
    }
  });
  return out;
}

static RduExCanvas* canvas_for(NSView* view) {
  for (NSView* child in view.subviews) {
    if ([child isKindOfClass:[RduExCanvas class]] ||
        [child.identifier isEqualToString:kCanvasName]) {
      return (RduExCanvas*)child;
    }
  }
  RduExCanvas* canvas = [[RduExCanvas alloc] initWithFrame:view.bounds];
  canvas.identifier = kCanvasName;
  canvas.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  canvas.wantsLayer = YES;
  [view addSubview:canvas positioned:NSWindowBelow relativeTo:nil];
  return canvas;
}

void rdu_ex_fill(
  void* view_ptr,
  const float* bg,
  const float* xywh,
  const float* rgba,
  int32_t n
) {
  if (!view_ptr || n < 0 || n > kMaxRects) return;
  float* bgCopy = (float*)malloc(4 * sizeof(float));
  float* xywhCopy = (float*)malloc((size_t)n * 4 * sizeof(float));
  float* rgbaCopy = (float*)malloc((size_t)n * 4 * sizeof(float));
  if (!bgCopy || !xywhCopy || !rgbaCopy) {
    free(bgCopy);
    free(xywhCopy);
    free(rgbaCopy);
    return;
  }
  if (bg) memcpy(bgCopy, bg, 4 * sizeof(float));
  else memset(bgCopy, 0, 4 * sizeof(float));
  if (n > 0 && xywh) memcpy(xywhCopy, xywh, (size_t)n * 4 * sizeof(float));
  if (n > 0 && rgba) memcpy(rgbaCopy, rgba, (size_t)n * 4 * sizeof(float));
  int count = n;
  void* viewPtr = view_ptr;
  dispatch_async(dispatch_get_main_queue(), ^{
    NSView* view = (__bridge NSView*)viewPtr;
    RduExCanvas* canvas = canvas_for(view);
    canvas.frame = view.bounds;
    CALayer* root = canvas.layer;
    if (!root) {
      free(bgCopy);
      free(xywhCopy);
      free(rgbaCopy);
      return;
    }
    CGColorRef bgColor =
      CGColorCreateGenericRGB(bgCopy[0], bgCopy[1], bgCopy[2], bgCopy[3]);
    root.backgroundColor = bgColor;
    CGColorRelease(bgColor);
    NSMutableArray<CALayer*>* ours = [NSMutableArray array];
    for (CALayer* layer in root.sublayers ?: @[]) {
      if ([layer.name isEqualToString:@"rdu-ex"]) [ours addObject:layer];
    }
    while ((int)ours.count < count) {
      CALayer* layer = [CALayer layer];
      layer.name = @"rdu-ex";
      layer.actions = @{
        @"backgroundColor": [NSNull null],
        @"bounds": [NSNull null],
        @"position": [NSNull null],
      };
      [root addSublayer:layer];
      [ours addObject:layer];
    }
    while ((int)ours.count > count) {
      [[ours lastObject] removeFromSuperlayer];
      [ours removeLastObject];
    }
    CGFloat height = NSHeight(canvas.bounds);
    for (int i = 0; i < count; i++) {
      float x = xywhCopy[i * 4];
      float y = xywhCopy[i * 4 + 1];
      float w = xywhCopy[i * 4 + 2];
      float h = xywhCopy[i * 4 + 3];
      CALayer* layer = ours[(NSUInteger)i];
      layer.frame = CGRectMake(x, height - y - h, w, h);
      CGColorRef color = CGColorCreateGenericRGB(
        rgbaCopy[i * 4],
        rgbaCopy[i * 4 + 1],
        rgbaCopy[i * 4 + 2],
        rgbaCopy[i * 4 + 3]
      );
      layer.backgroundColor = color;
      CGColorRelease(color);
    }
    free(bgCopy);
    free(xywhCopy);
    free(rgbaCopy);
  });
}
