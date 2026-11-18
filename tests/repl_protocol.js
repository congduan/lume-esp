/* r115 host harness: REPL frame bytes + bounded output, no board and no deps.
 * Compiles the SAME portable lume_frame.c the firmware links (as ota_auth.js
 * does) so byte-level assertions exercise the real codec, not a JS re-write.
 * Also cross-checks that the firmware/CLI constants agree. */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const inc = path.join(root, 'firmware/components/lume-hotreload/include');
const frameC = path.join(root, 'firmware/components/lume-hotreload/lume_frame.c');

// Source-level cross-checks: wiring must exist and caps must match.
const h = fs.readFileSync(path.join(inc, 'lume_frame.h'), 'utf8');
const hot = fs.readFileSync(path.join(root, 'firmware/components/lume-hotreload/lume_hotreload.c'), 'utf8');
const engH = fs.readFileSync(path.join(root, 'firmware/components/lume-engine/include/lume_engine.h'), 'utf8');
const engC = fs.readFileSync(path.join(root, 'firmware/components/lume-engine/lume_engine.c'), 'utf8');
const proto = fs.readFileSync(path.join(root, 'tools/lume/protocol.js'), 'utf8');
for (const [src, needle] of [
  [h, 'LUME_FRAME_REPL_MAGIC     "LUMR"'],
  [h, 'LUME_FRAME_EV_REPL'],
  [h, 'LUME_FRAME_KIND_REPL'],
  [h, '#define LUME_REPL_OUT_CAP 2048u'],
  [hot, 'case LUME_FRAME_EV_REPL:'],
  [hot, 'lume_engine_set_repl_cb(on_repl_result)'],
  [hot, 'R64'],
  [engH, '#define LUME_EVT_REPL 12'],
  [engH, 'lume_engine_request_repl'],
  [engC, 'static void eval_repl('],
  [engC, 'evt.type == LUME_EVT_REPL'],
  [proto, "MAGIC_REPL = 'LUMR'"],
  [proto, 'REPL_OUT_CAP = 2048'],
]) assert(src.includes(needle), 'missing contract: ' + needle);

const c = `
#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "lume_frame.h"

static lume_frame_ev_t g_ev;
static char g_reason[32], g_payload[LUME_FRAME_MAX_PAYLOAD];
static size_t g_len;
static int g_events;
static void on_event(lume_frame_ev_t ev, const unsigned char *p, size_t n,
                     const char *reason, void *u) {
  (void)u;
  g_ev = ev; g_len = n; g_events++;
  snprintf(g_reason, sizeof(g_reason), "%s", reason ? reason : "");
  if (p && n <= sizeof(g_payload)) memcpy(g_payload, p, n);
}
static void *my_alloc(size_t n) { return malloc(n); }
static void my_free(void *p) { free(p); }
static void feed(const unsigned char *b, size_t n, lume_frame_parser_t *p) {
  for (size_t i = 0; i < n; i++) lume_frame_parser_feed(p, b[i]);
}
static void reset(lume_frame_parser_t *p) {
  lume_frame_parser_init(p, my_alloc, my_free, on_event, NULL);
  g_events = 0; g_ev = 0; g_len = 0; g_reason[0] = 0;
}

int main(void) {
  unsigned char buf[LUME_FRAME_HDR_LEN + 64];
  static lume_frame_parser_t p;

  /* 1. REPL frame byte layout = 12-byte header + payload, known CRC vector. */
  const char *expr = "1+2";
  size_t n = lume_frame_encode_repl(buf, sizeof(buf),
                                    (const unsigned char *)expr, strlen(expr));
  assert(n == LUME_FRAME_HDR_LEN + 3);
  assert(memcmp(buf, LUME_FRAME_REPL_MAGIC, 4) == 0);
  assert(buf[4] == 3 && buf[5] == 0 && buf[6] == 0 && buf[7] == 0);
  uint32_t crc = lume_frame_crc32((const unsigned char *)expr, 3);
  assert(buf[8] == (crc & 0xffu) && buf[9] == ((crc >> 8) & 0xffu) &&
         buf[10] == ((crc >> 16) & 0xffu) && buf[11] == ((crc >> 24) & 0xffu));
  assert(memcmp(buf + LUME_FRAME_HDR_LEN, expr, 3) == 0);
  puts("PASS: REPL frame layout magic/len/crc/payload");

  /* 2. Parser emits EV_REPL with exact payload. */
  reset(&p); feed(buf, n, &p);
  assert(g_events == 1 && g_ev == LUME_FRAME_EV_REPL && g_len == 3);
  assert(memcmp(g_payload, expr, 3) == 0);
  puts("PASS: parser emits LUME_FRAME_EV_REPL");

  /* 3. Negative: bad CRC -> EV_ERR bad-crc, resync intact. */
  reset(&p); buf[8] ^= 0x01; feed(buf, n, &p); buf[8] ^= 0x01;
  assert(g_events >= 1 && g_ev == LUME_FRAME_EV_ERR);
  assert(strcmp(g_reason, "bad-crc") == 0);
  puts("PASS: bad CRC rejected");

  /* 4. Negative: empty payload -> EV_ERR empty. */
  reset(&p);
  {
    unsigned char e[12] = { 'L','U','M','R', 0,0,0,0, 0,0,0,0 };
    feed(e, 12, &p);
  }
  assert(g_events >= 1 && g_ev == LUME_FRAME_EV_ERR);
  assert(strcmp(g_reason, "empty") == 0);
  puts("PASS: empty payload rejected");

  /* 5. Negative: too-large length -> EV_ERR too-large. */
  reset(&p);
  {
    unsigned char big[12] = { 'L','U','M','R', 1,0,0,1, 0,0,0,0 };
    feed(big, 12, &p);
  }
  assert(g_events >= 1 && g_ev == LUME_FRAME_EV_ERR);
  assert(strcmp(g_reason, "too-large") == 0);
  puts("PASS: overlong length rejected");

  /* 6. Bounded output: cap + truncation marker + NUL termination. */
  {
    char out[LUME_REPL_OUT_CAP + 1];
    char big[LUME_REPL_OUT_CAP + 10];
    memset(big, 'Z', sizeof(big));
    bool trunc = false;
    size_t got = lume_repl_clamp(big, sizeof(big), out, LUME_REPL_OUT_CAP, &trunc);
    assert(got == LUME_REPL_OUT_CAP && trunc && out[got] == '\\0');
    bool t2 = true;
    got = lume_repl_clamp("abc", 3, out, LUME_REPL_OUT_CAP, &t2);
    assert(got == 3 && !t2 && strcmp(out, "abc") == 0);
    /* Embedded NUL is byte-counted, not strlen()-cut. */
    char withnul[3] = { 'a', '\\0', 'b' };
    got = lume_repl_clamp(withnul, 3, out, LUME_REPL_OUT_CAP, &t2);
    assert(got == 3 && out[0] == 'a' && out[1] == '\\0' && out[2] == 'b');
  }
  puts("PASS: REPL output clamp/truncation marker");

  /* 7. A UTF-8 expression round-trips byte-for-byte. */
  {
    const char *u = "log(\\xE4\\xB8\\xAD)";  /* log(中), 3 UTF-8 bytes */
    size_t m = lume_frame_encode_repl(buf, sizeof(buf),
                                      (const unsigned char *)u, strlen(u));
    reset(&p); feed(buf, m, &p);
    assert(g_events == 1 && g_ev == LUME_FRAME_EV_REPL && g_len == strlen(u));
    assert(memcmp(g_payload, u, g_len) == 0);
  }
  puts("PASS: UTF-8 expression round trip");
  return 0;
}
`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lume-repl-'));
try {
  const file = path.join(dir, 'repl.c');
  const bin = path.join(dir, 'repl');
  fs.writeFileSync(file, c);
  cp.execFileSync('cc', ['-std=c11', '-Wall', '-Wextra', '-Werror',
    `-I${inc}`, frameC, file, '-o', bin], { stdio: 'inherit' });
  cp.execFileSync(bin, [], { stdio: 'inherit' });
  process.stdout.write('ALL REPL PROTOCOL CASES PASSED\n');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
