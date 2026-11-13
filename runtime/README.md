# Lume JS runtime (TypeScript types + prelude)

The JS-facing API surface. Compiled (esbuild → QuickJS bytecode) and embedded
into the firmware as the default bundle.

- `types/` — .d.ts for editor autocomplete (lume/ui, lume/board, lume/system, ...)
- `prelude/` — the `lume` global: declarative runtime, diff engine, event glue

## M1 contents
- prelude: minimal vdom diff emitting `lume_attr_msg_t` streams
- types: View / Text / Button + system.log

## Build (M1.x)
```
esbuild prelude/index.ts --bundle --format=esm
qjs bytecode emit → firmware embed
```
