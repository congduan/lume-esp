# Lume reactivity & rendering design — distilled from modern frontend frameworks

Scope: what Lume's JS runtime (prelude) adopts from Vue/React/Solid/Preact-signals,
clean-room (concepts and architecture, no copied code), constrained by ESP32
resources (no Proxy-based deep reactivity, no double-buffer full-tree VDOM churn
on every frame, PSRAM-friendly flat structures).

Sources studied (upstream, 2026-11-13):
- vuejs/core `packages/reactivity/src/{dep,effect,ref}.ts` — Vue 3.5 Dep<->Link doubly-linked graph
- preactjs/signals `packages/core/src/index.ts` (1300 lines) — the minimal signal implementation
- solidjs/solid `packages/solid/src/reactive/signal.ts` — queued effect batches
- React's model: conceptual only (re-render + diff), no fiber adoption

## 1. Reactivity: signals over Proxy reactive()

| option | memory cost | fit |
|---|---|---|
| Vue-style Proxy deep reactive | Proxy per object + Dep map per key | ✗ Proxies are expensive in QuickJS; deep traps churn GC |
| **signals (Preact/Solid model)** | one flat object per signal, linked-list graph | ✓ chosen |

Chosen model: `signal(value)` + `effect(fn)` + `computed(fn)` semantics,
with Preact-signals' lazy computed evaluation and Solid's queued batch runs.

Key decisions:
- **Versioned nodes, doubly-linked source/target lists** (both Vue 3.5 and
  Preact signals converge on this): O(1) subscribe/unsubscribe, no Set objects
  (GC-hostile), dirty flags propagate only to graph subscribers.
- **Lazy computeds with equality check**: computed re-evaluates only when a
  dependency's version changed AND result differs (Preact's `setValue` —
  identity-compare before propagating). On a 240MHz MCU this kills whole
  subtrees of redundant UI updates.
- **Batches, not microtasks**: UI event → `batch(fn)` → queued effects run
  once per input event. No Promise/microtask dependency (QuickJS microtask
  scheduling on ESP-IDF is doable but a simple drain queue is cheaper).
- **No deep reactivity**: component state is plain JS objects owned by the
  app; signals hold the leaf values that map to native attrs. One signal per
  reactive attribute (text content, visibility, list items count) — the bridge
  translates signal.set() directly into lvgl attr messages. This is the single
  biggest resource win: no VDOM re-render at all for signal-only updates.

## 2. Rendering: declarative tree, but diffs are structural-only

React/Vue re-render the whole component function then diff. On ESP32 the
render closure is cheap but the diff machinery (keyed child reconciliation,
props maps) costs RAM. Lume's split:

- **Signal-driven attributes** (majority of UI updates: text changes, colors,
  progress) bypass the tree entirely — signal → native attr message.
- **Structural VDOM** (add/remove/reorder children, conditional blocks) runs
  a keyed diff ONLY on state changes that affect the tree shape (each block
  node subscribes to the condition signal). Vue's compiler-driven block tree
  insight applies: static subtrees never diff.
- **No JSX compiler in M1**: components are plain functions returning tree
  literals. JSX/TSX via esbuild plugin is M4 tooling (same runtime semantics).

## 3. What we deliberately do NOT take

- React fibers/concurrent scheduling: for 60fps on one core, a simple
  priority queue (input > animation > idle) is enough; fibers' Interruptible
  work model needs heap that we'd rather spend on app data.
- Vue's Proxy reactivity & compiler directives runtime (v-if/v-for as
  runtime helpers): compile-time expansion costs nothing here because blocks
  subscribe directly.
- Preact/solid DOM adapters: our "renderer" is the attr-message protocol to
  the native bridge, not DOM.

## 4. Resource budget targets (M1 acceptance)

- prelude bytecode (signals + tree diff + runtime glue) ≤ 40KB flash
- JS heap baseline after boot (empty app) ≤ 256KB PSRAM
- One attribute update signal.set() → native message: < 1ms (no full-tree walk)
- Structural diff of a 100-node list reorder: < 16ms budget, single batch

## 5. JS API shape (M1)

```js
import { signal, effect } from 'lume';
import { View, Text, Button } from 'lume/ui';

const count = signal(0);

View({ style: {...} }, [
  Text({ text: () => `taps: ${count()}` }),      // signal-backed attr
  Button({ title: '+1', onPress: () => count.set(count() + 1) }),
]);
```

getter-call syntax (`count()`) chosen over `.value` (Solid style): reads as
function call so the bridge can also accept plain values uniformly.
