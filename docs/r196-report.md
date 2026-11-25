# r196 Report - wordle smoke flake fix + gateway handshake-auth E2E bridge

Baseline: `origin/main 9bea3f2` (2026-11-26, includes r195 voice_assistant
handshake auth). Worktree `/tmp/lume-r196-wt`, branch `r196-flake-e2e`.
All verification is host-side. No board, firmware, radio, display or real
gateway deployment was touched; no device acceptance is claimed.

## 1. Task 1 - wordle smoke determinism

### 1.1 Empirical first (before the edit)

Baseline command, run at HEAD with no changes:

```
for i in $(seq 1 20); do node tests/wordle.js >/dev/null 2>&1 || echo "FAIL run $i"; done
```

Raw result (`artifacts/r196/wordle-baseline-20.txt`):

```
OK run 1 ... OK run 20
FAILURES=0/20
```

Deviation from the brief, stated explicitly: the cited clean-baseline failure
rate (2/40 in the r164 evidence) did **not** reproduce here. Node is
`v22.23.1` in this worktree. I extended the sample to 100 more runs and
sampled the smoke's own draw counter (`artifacts/r196/wordle-draws-distribution-100.txt`):

```
FAILURES=0/100
draws min 23094 ... draws max 25094
```

So 120 baseline runs produced 0 failures. This does not contradict the
flaky history (it is probabilistic and did not trigger); the directed fix was
still applied, because removing the random input removes the failure mode
regardless of whether it fires on this host.

### 1.2 Failure surface of the smoke (enumerated before the edit)

The smoke is `tests/wordle.js:480-512` (baseline numbering); post-change the
same assertions are at `:481-518`. Every assertion in it:

| Line (post) | Assertion | Random-stream sensitivity |
|---|---|---|
| 507 | `draws.length > 1000` | **Directly sensitive**: `draws` counts `m[0]==='draw'` messages produced by key presses. This is the only assertion that can fail from an unlucky key stream. |
| 510 | `x + w <= 480 && y + h <= 228` | Geometry is fixed by the app layout; invariant for any key sequence. Listed for completeness, not a flake source. |
| 511 | `w * h <= 480 * 228` | Same: layout-budget invariant, not key-dependent. |
| 514 | `st.current.length <= 5` | Game logic caps the current guess for any input. |
| 515 | `st.attempt >= 0 && st.attempt <= 6` | Game logic cap. |
| 516 | `st.rows.length <= 6` | Game logic cap. |
| 517 | `st.streak >= 0 && st.best >= 0` | Persistence invariant. |

Conclusion: one assertion (`draws.length > 1000`) is the flake surface; the
rest are invariants that the determinism change leaves untouched.

### 1.3 The change

`tests/wordle.js`, smoke block only:

- Seed `0x19600001` and a small LCG (`Math.imul(seed, 1664525) + 1013904223`,
  `>>> 0`, normalized to `[0,1)`).
- Both `Math.random()` call sites replaced by `nextRandom()`; the branch
  thresholds (`0.08`, `0.12`) and the 26-letter `QWERTY.charAt(...)` draw are
  unchanged, so the 8% BKSP / 4% SPACE / 88% letter mix is preserved.
- Submit cadence (`t % 45`) and restart cadence (`t % 120`) untouched.
- The `draws.length > 1000` threshold, every other assertion, the smoke's
  name and the smoke itself are untouched. No app, firmware, runtime or
  tooling file was edited.

### 1.4 Marginal evidence and coverage

10 post-change runs (`artifacts/r196/wordle-after-determinism-10.txt`):

```
run 1..10: smoke (keys=120, submits=39, restarts=14, draws=24374, paints=134)
FAILURES=0/10
```

Minimum `draws` over 10 runs is 24374, i.e. **24.4x** the `> 1000` threshold,
well past the required 2x margin. Key-class coverage
(`artifacts/r196/wordle-key-coverage.txt`): `BKSP=8`, `SPACE=6`,
`letter=106`, 25 distinct letters of 26, plus 39 submits and 14 restarts.
All three input classes and both cycle loops are exercised.

Regression (`artifacts/r196/wordle-postfix-30.txt`):

```
OK run 1 ... OK run 30
FAILURES=0/30
```

## 2. Task 2 - gateway handshake-auth E2E

### 2.1 Start/stop path was verified before writing the test

- `tools/gateway/cli.js` exports `main()` which reads `process.argv` and
  installs `SIGINT`/`SIGTERM` handlers; it is a process entry point, not an
  in-process server API.
- `tools/gateway/server.js` exports `createGateway(opts)`, whose
  `start()` / `close()` are promise-based and accept `port: 0` for an
  ephemeral port. A throwaway probe confirmed: `started port=38259`,
  `onOpen 101`, `hello-ack` with a correct device token, `gateway closed
  cleanly`. **Chosen path**: `createGateway({ port: 0, ... })` from the test,
  no child process, no CLI argv manipulation.

Source finding sharper than the brief: in `tests/va_ws.js:38-60`, the bridge
records the prelude's header string into `stats.headers` but calls
`gwConnect(url, callbacks)` with **no third argument**. The r195 assertion is
therefore exactly at the `_connect` boundary - the header is never forwarded
to `ws-client.js` by that harness. This E2E supplies the missing third
argument and drives the real gate.

### 2.2 Test file and scope comment

New `tests/gateway_e2e_auth.js`. Its header comment states that the file is
the semantic bridge between r195's device header construction and r187's
gateway 401 gate, drives the real `ws-client.js connect(url, cb, headers)`
against the real `server.js`, and claims **no real-device verification**.

Both the literal HTTP status (via a small raw upgrade probe) and the device
client's observed outcome are asserted for every case. `createGateway` is
started with both `--token` and `--device-token` equivalents configured
(`token: HS`, `deviceToken: DT`), so the upgrade gate and the hello gate are
both live.

### 2.3 Cases and raw output

Raw output: `artifacts/r196/gateway-e2e-auth.txt`.

```
PASS gateway e2e auth: no headers: HTTP 401, ws-client onError(1), no upgrade
PASS gateway e2e auth: wrong Bearer: HTTP 401, ws-client onError(1), no session
PASS gateway e2e auth: correct Bearer: HTTP 101 + hello-ack with correct device token
PASS gateway e2e auth: correct Bearer + wrong device token: hello gate rejects (unauthorized)
PASS gateway e2e auth: x-gateway-token compatibility form: HTTP 101 + hello-ack
PASS gateway e2e auth: ?token= compatibility form: HTTP 101 + hello-ack
ALL GATEWAY E2E AUTH CASES PASSED
exit=0
```

Coverage of `authorized()`'s three forms: `Authorization: Bearer` (right and
wrong), `x-gateway-token` and `?token=`, plus the no-header negative. The
`hello.auth` device-token gate is exercised with a correct and a wrong
token; rejected upgrades create zero sessions.

Stability: 10 consecutive runs, `FAILURES=0/10`
(`artifacts/r196/gateway-e2e-auth-10-runs.txt`).

## 3. Guard, unit tests and firmware diff

- `tests/ota_consumers.js`: pre-added `tests/gateway_e2e_auth.js` and
  `docs/r196-report.md` to `ALLOWED` and allowed the `artifacts/r196/`
  evidence prefix. The `BASE` pin is untouched and the guard is not deleted
  or weakened. Guard run: `ALL OTA CONSUMERS HARNESS CASES PASSED`, exit 0
  (`artifacts/r196/ota-guard.txt`).
- `npm test --prefix tools/lume`: **52 pass / 0 fail**, unchanged from the
  expected number (`artifacts/r196/npm-test-tools-lume.txt`).
- Full host sweep with both changes present
  (`artifacts/r196/full-tests-sweep-final.txt`):

```
done
sweep exit=0
```

i.e. `for t in tests/*.js; do node "$t" ...` produced zero `FAIL` lines.

- `git diff origin/main -- firmware/` produced an empty diff and
  `git status --short -- firmware/` is empty
  (`artifacts/r196/firmware-zero-diff.txt`). Per the brief, `idf.py build`
  is skipped.

## 4. Honesty / deferred

- All evidence above is host-side. The real gesture of a board pushing a
  `Bearer` header over a real network, real gateway deployment and TLS are
  not verified here.
- The wordle flake did not reproduce on this host (0/120 baseline runs);
  the determinism fix is preventive and its margin is measured, not a
  before/after reproduction of the failure.
- No board metrics (display, touch, sleep current, radio, persistence) are
  claimed. No files outside the allowed change surface were modified.
