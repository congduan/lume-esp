# r192 report — repair CI red: extend ota_consumers zero-diff allowlist with r191 paths

Baseline: `origin/main` / `c3d65ff` (2026-11-26, r191 pushed).
Worktree: `/tmp/lume-r192-wt`, branch `r192-ota-guard-fix` (created from `origin/main`).
Scope: `tests/ota_consumers.js`, this report, `artifacts/r192/` only. No push. No
`idf.py build` (host-only round). No on-device claim is made.

## 1. Pre-fix evidence (FAIL)

`node tests/ota_consumers.js` in the fresh worktree exited 1:

```
PASS ota_consumers: all UI string literals ASCII-only (r64)
PASS ota_consumers: firmware/ runtime/ CLI tooling identical to 674684a
AssertionError [ERR_ASSERTION]: FAIL ota_consumers: only known r132 + r133 + r134 + r135 + r136 files differ from 674684a
```

Raw output: `artifacts/r192/ota_consumers-before.txt`. The assertion does not
print its diff, so I extracted the actual guard diff with the harness's own
predicate (BASE `94f5d4e`, `git diff --name-only -M BASE HEAD` plus worktree diff,
minus `ALLOWED`, the `artifacts/r*` prefixes and the r188 removed-file set).
Raw diff: `artifacts/r192/guard-diff-raw.txt` (251 paths).

## 2. Actual offending paths: 29, not 8 — brief assumption corrected

The brief's 8 paths (from `docs/r191-report.md`, "Known, out-of-scope JS
regression") are real, but the guard on pushed `c3d65ff` sees **29** paths
outside `ALLOWED`. Full list: `artifacts/r192/guard-outside-allowed-pre-fix.txt`.

- the 8 named in the brief: `.github/workflows/tests.yml`,
  `tests/canvas_prims.c`, `tests/compress_host.c`, `tests/crypto_host.c`,
  `tests/decode_host.c`, `tests/fft_host.c`, `tests/imgscale_host.c`,
  `tests/ws_frame.c`;
- `docs/r191-report.md`;
- 20 `artifacts/r191/*.log` files (16 C-harness logs, `c-step-preplay.log`,
  `check-website.log`, `js-all.log`, `yamllint.log`).

Why the discrepancy: r191's report was written while its report and artifacts
were still untracked in the r191 worktree, so they were absent from the guard's
`git diff` at that moment. After r191 landed on main they became tracked, so
the zero-diff guard includes them. The brief's "以守卫实际 diff 为准" rule was
applied: all 29 are admitted. `docs/r192-report.md` and `artifacts/r192/` are
admitted too so this round's own commit does not re-break the guard.

## 3. Change

`tests/ota_consumers.js`: add an `// r191: ...` commented block to `ALLOWED`
(workflow, 7 C harnesses, r191 report, r192 report) and extend the evidence
predicate with `f.startsWith('artifacts/r191/') || f.startsWith('artifacts/r192/')`.
No wildcard for source paths; no change to any firmware/runtime/CLI guard.
Full patch: `artifacts/r192/git-diff-origin-main.txt` (one file only).

## 4. Post-fix evidence (PASS)

`node tests/ota_consumers.js` -> exit 0, ends with
`ALL OTA CONSUMERS HARNESS CASES PASSED`.
Raw output: `artifacts/r192/ota_consumers-after.txt`.

## 5. Full JS regression — 2 FAILs, both pre-existing outside this round's red line

Command: `for t in tests/*.js; do echo "== $t"; node "$t" || echo "FAIL $t"; done`
raw output: `artifacts/r192/tests-all-js.txt`.

```
FAIL zero-diff guard: no changes outside board components and r148 surfaces
board_abi: FAIL
FAIL tests/board_abi.js
```

Both FAILs come from `tests/board_abi.js`, whose *separate* zero-diff guard
(`tests/board_abi.js:94`–`134`, BASE `3514c76`) excludes `docs/`, `tests/`,
`artifacts/`, etc., but not `.github/`. Once r191's `.github/workflows/tests.yml`
lands on main, that guard goes red. Verified pre-existing: `node tests/board_abi.js`
run on untouched `/home/ubuntu/lume` at `c3d65ff` also exits 1 with the same
message (`artifacts/r192/board_abi-main-baseline.txt`). Re-running the same git
pathspec with only `:!.github/workflows/tests.yml` added yields empty diff, so
that single tracked path is the sole cause. r191's `artifacts/r191/js-all.log`
recorded only 1 FAIL (`ota_consumers.js`) because the measurement was taken in
the r191 worktree before its HEAD contained the workflow change.

Fixing this would require editing `tests/board_abi.js` (or `.github/`), which is
outside this round's explicit change surface, so it is **left untouched** and
reported to the controller for a decision. With that one exception the JS suite
runs clean; `ota_consumers.js` itself is green.

## 6. Environment / discipline

- Worktree initially lacked gitignored `tools/lume/node_modules` and
  `tools/lume/bin/qjsc`; both were soft-linked read-only from `/home/ubuntu/lume`
  as in r191. Symlinks are not part of the change.
- No firmware, runtime, prelude, `.github/` or other `tests/` file was modified.
- No push; single `test:` commit.
