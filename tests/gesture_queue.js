/* Compile the production gesture sink with a tiny FIFO queue model. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const assert = require('node:assert/strict');
const src = fs.readFileSync(path.join(__dirname, '../firmware/components/lume-engine/lume_engine.c'), 'utf8');
const start = src.indexOf('void lume_engine_post_gesture(');
const end = src.indexOf('\nstatic void dispatch_scroll', start);
assert(start >= 0 && end > start);
const body = src.slice(start, end);
const c = `
#include <assert.h>
#include <stdint.h>
#include <stddef.h>
#include <stdio.h>
typedef struct { uint8_t type, g_kind, g_dir, g_cancelled; uint16_t node_id; int16_t g_x,g_y; uint32_t g_t; } lume_engine_evt_t;
#define LUME_EVT_GESTURE 8
#define EVT_DROP_LOG_EVERY 16
#define portMAX_DELAY -1
#define pdTRUE 1
#define TAG "test"
#define ESP_LOGW(...) ((void)0)
static int queue_handle;
static int *s_evt_queue = &queue_handle;
static unsigned s_evt_dropped;
static lume_engine_evt_t queue[16];
static int count, waited;
static int uxQueueSpacesAvailable(int *q) { (void)q; return 16-count; }
static int xQueueSend(int *q, const lume_engine_evt_t *e, int timeout) {
  (void)q;
  if (count == 16) { assert(timeout == portMAX_DELAY); waited++; count--; }
  queue[count++] = *e; return pdTRUE;
}
${body}
int main(void) {
  lume_engine_post_gesture(1,0,0,0,0,0,0);
  lume_engine_post_gesture(1,1,1,0,1,0,0);
  lume_engine_post_gesture(1,2,2,0,2,0,0);
  assert(count == 3 && queue[0].g_kind == 0 && queue[1].g_kind == 1 && queue[2].g_kind == 2);
  puts("PASS: DOWN MOVE UP retain FIFO order");
  count = 0; s_evt_dropped = 0;
  lume_engine_post_gesture(1,0,0,0,0,0,0);
  for (int i=0;i<30;i++) lume_engine_post_gesture(1,1,i,0,i,0,0);
  assert(count == 12 && s_evt_dropped == 19);
  lume_engine_post_gesture(1,2,0,0,31,0,0);
  assert(count == 13 && queue[0].g_kind == 0 && queue[12].g_kind == 2 && !waited);
  puts("PASS: MOVE pressure reserves capacity and UP reaches queue tail");
  return 0;
}
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lume-gesture-'));
try {
  const file = path.join(dir, 'test.c');
  fs.writeFileSync(file, c);
  cp.execFileSync('cc', ['-std=c11', '-o', path.join(dir, 'test'), file], { stdio: 'inherit' });
  cp.execFileSync(path.join(dir, 'test'), { stdio: 'inherit' });
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
