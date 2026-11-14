/* Exercise the actual request_reload C body with deterministic queue interleavings. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const assert = require('node:assert/strict');

const src = fs.readFileSync(path.join(__dirname, '../firmware/components/lume-engine/lume_engine.c'), 'utf8');
const start = src.indexOf('int lume_engine_request_reload(const char *src, size_t len)');
const end = src.indexOf('\nstatic int request_launch_common', start);
assert(start >= 0 && end > start);
const body = src.slice(start, end);
const c = `
#include <assert.h>
#include <pthread.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <sched.h>
typedef pthread_mutex_t *SemaphoreHandle_t;
typedef int *QueueHandle_t;
typedef struct { int type, node_id; } lume_engine_evt_t;
#define LUME_EVT_RELOAD 2
#define MALLOC_CAP_SPIRAM 0
#define portMAX_DELAY 0
#define pdTRUE 1
#define pdMS_TO_TICKS(x) (x)
#define TAG "test"
#define ESP_LOGE(...) ((void)0)
static pthread_mutex_t mutex = PTHREAD_MUTEX_INITIALIZER;
static SemaphoreHandle_t s_stage_mutex = &mutex;
static int queue_handle;
static QueueHandle_t s_evt_queue = &queue_handle;
static char *s_staged_src;
static size_t s_staged_len;
static bool s_reload_pending;
static int frees, superseded, posts, post_result, block_post, entered_post, release_post;
static pthread_mutex_t alloc_mutex = PTHREAD_MUTEX_INITIALIZER;
static void *live[8];
static void *heap_caps_malloc(size_t n, int caps) {
  (void)caps; void *p = malloc(n);
  pthread_mutex_lock(&alloc_mutex);
  int found = 0;
  for (int i = 0; i < 8; i++) if (!live[i]) { live[i] = p; found = 1; break; }
  pthread_mutex_unlock(&alloc_mutex);
  assert(found); return p;
}
static void heap_caps_free(void *p) {
  pthread_mutex_lock(&alloc_mutex);
  int found = 0;
  for (int i = 0; i < 8; i++) if (live[i] == p) { live[i] = NULL; found++; }
  assert(found == 1); frees++;
  pthread_mutex_unlock(&alloc_mutex);
  free(p);
}
static void result_cb(bool ok, size_t n, const char *why) {
  (void)ok; (void)n; assert(strcmp(why, "superseded") == 0); superseded++;
}
static void (*s_result_cb)(bool,size_t,const char *) = result_cb;
static void xSemaphoreTake(SemaphoreHandle_t m, int wait) { (void)wait; pthread_mutex_lock(m); }
static void xSemaphoreGive(SemaphoreHandle_t m) { pthread_mutex_unlock(m); }
static int xQueueSend(QueueHandle_t q, lume_engine_evt_t *e, int wait) {
  (void)q; (void)e; (void)wait; posts++; entered_post = 1;
  while (block_post && !release_post) sched_yield();
  return post_result;
}
${body}
static int a_result, b_result;
static void *run_a(void *p) { (void)p; a_result = lume_engine_request_reload("A", 1); return NULL; }
static void *run_b(void *p) { (void)p; b_result = lume_engine_request_reload("B", 1); return NULL; }
static void reset(void) {
  s_staged_src = NULL; s_staged_len = 0; s_reload_pending = false;
  frees = superseded = posts = entered_post = release_post = 0;
}
int main(void) {
  pthread_t a, b;
  reset(); post_result = 0; block_post = 1;
  pthread_create(&a, NULL, run_a, NULL);
  while (!entered_post) sched_yield();
  pthread_create(&b, NULL, run_b, NULL);
  release_post = 1;
  pthread_join(a, NULL); pthread_join(b, NULL);
  assert(a_result == -1 && b_result == -1);
  assert(frees == 2 && !s_staged_src && !s_reload_pending && posts == 2);
  puts("PASS: concurrent failed posts free each frame once and clear pending");

  reset(); post_result = 1; block_post = 1;
  pthread_create(&a, NULL, run_a, NULL);
  while (!entered_post) sched_yield();
  pthread_create(&b, NULL, run_b, NULL);
  release_post = 1;
  pthread_join(a, NULL); pthread_join(b, NULL);
  assert(a_result == 0 && b_result == 0);
  assert(frees == 1 && superseded == 1 && posts == 1);
  assert(s_staged_src && s_staged_src[0] == 'B' && s_staged_len == 1 && s_reload_pending);
  heap_caps_free(s_staged_src);
  puts("PASS: successful post coalesces replacement and preserves latest frame");
  return 0;
}
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lume-reload-'));
try {
  const file = path.join(dir, 'test.c');
  fs.writeFileSync(file, c);
  cp.execFileSync('cc', ['-std=c11', '-pthread', '-o', path.join(dir, 'test'), file], { stdio: 'inherit' });
  cp.execFileSync(path.join(dir, 'test'), { stdio: 'inherit' });
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
