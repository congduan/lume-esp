/**
 * Lume JS API types (M1 surface — grows in M2/M3).
 */

declare namespace lume.ui {
  interface Style {
    display?: 'flex';
    flexDirection?: 'row' | 'column';
    flexWrap?: 'nowrap' | 'wrap';
    justifyContent?: 'start' | 'end' | 'center' | 'space-between' | 'space-around' | 'space-evenly';
    alignItems?: 'start' | 'end' | 'center' | 'stretch';
    gap?: number;
    /** All four sides; `paddingTop`/`Right`/`Bottom`/`Left` override one edge. */
    padding?: number;
    paddingTop?: number;
    paddingRight?: number;
    paddingBottom?: number;
    paddingLeft?: number;
    /** Outer spacing, all four sides; per-side keys override one edge. */
    margin?: number;
    marginTop?: number;
    marginRight?: number;
    marginBottom?: number;
    marginLeft?: number;
    /** 0..255 LVGL flex grow factor; needs a flex parent with free main-axis space. */
    flexGrow?: number;
    borderRadius?: number;
    borderWidth?: number;
    /** #RRGGBB or a key in lume.theme.get().colors. */
    borderColor?: string | (() => string);
    opacity?: number | (() => number); // 0..1
    x?: number | (() => number);
    y?: number | (() => number);
    transition?: { property: 'bg' | 'x' | 'y' | 'width' | 'height' | 'opacity'; durationMs: number; easing?: lume.anim.Easing };
    /** #RRGGBB or a key in lume.theme.get().colors; number keeps the M1 bg path. */
    background?: string | number | (() => string | number);
    /** Pixel, `'0%'`-`'100%'` of the parent content area, or `'auto'` (content size). */
    width?: number | `${number}%` | 'auto' | (() => number);
    height?: number | `${number}%` | 'auto' | (() => number);
    /** Bounds applied to the computed size; most useful together with `'auto'`. */
    minWidth?: number;
    maxWidth?: number;
    minHeight?: number;
    maxHeight?: number;
    /** `'absolute'` takes the node out of the parent's flex flow (x/y apply). */
    position?: 'relative' | 'absolute';
    /** Offsets applied after layout/alignment; also accepts a percentage of the node's own size. */
    translateX?: number | `${number}%`;
    translateY?: number | `${number}%`;
    /** Label alignment inside its own box (Text and Button captions). */
    textAlign?: 'left' | 'center' | 'right' | 'auto';
    /** Overflow behaviour of a label that is wider/taller than its box. */
    longMode?: 'wrap' | 'dots' | 'scroll' | 'scroll-circular' | 'clip';
    /** Font size in px; snapped to the nearest bundled face (14/20/32) and
     * multiplied by `lume.theme.get().fontScale` first. CJK glyphs fall back
     * to the bundled simplified-Chinese face. */
    fontSize?: number | (() => number);
    /** Horizontal letter spacing in px (may be negative). */
    letterSpacing?: number | (() => number);
    /** Vertical line spacing in px (may be negative). */
    lineHeight?: number | (() => number);
    /** Enables LVGL native scrolling on a View. */
    scroll?: 'vertical' | 'horizontal' | 'none';
    scrollbar?: 'off' | 'auto' | 'on';
  }

  /** Nodes are numeric ids returned by the embedded prelude. */
  type Node = number;
  /** LVGL alignment: an `ALIGN_*` constant (0..20) or its kebab-case name.
   * `outside-*` (and the `above`/`below`/`left-of`/`right-of` aliases) place the
   * node next to its base and therefore need `alignTo`. */
  type Align = number
    | 'center' | 'top-left' | 'top-mid' | 'top-right' | 'bottom-mid' | 'bottom-left' | 'bottom-right' | 'left-mid' | 'right-mid'
    | 'outside-top-left' | 'outside-top-mid' | 'outside-top-right'
    | 'outside-bottom-left' | 'outside-bottom-mid' | 'outside-bottom-right'
    | 'outside-left-top' | 'outside-left-mid' | 'outside-left-bottom'
    | 'outside-right-top' | 'outside-right-mid' | 'outside-right-bottom'
    | 'above' | 'below' | 'left-of' | 'right-of';
  interface ViewProps {
    style?: Style;
    parent?: Node;
    bg?: number | (() => number);
    w?: number;
    h?: number;
    /** Aligned inside `alignTo` (or the parent) with `alignOffset` applied. */
    align?: Align;
    /** Node to align against; 0 or omitted means the parent. */
    alignTo?: Node;
    alignOffset?: { x?: number; y?: number };
    visible?: boolean;
    onPress?: () => void;
    onScroll?: (offsetPx: number) => void;
  }
  interface ListProps<T> { style: Style & { height: number }; parent?: Node; items: T[] | (() => T[]); itemHeight: number; overscan?: number; renderItem(item: T, index: number): Node }
  interface TextProps extends ViewProps { text?: string | (() => string) }
  interface ButtonProps extends ViewProps { title?: string | (() => string); onPress?: () => void }
  /** PNG/JPEG or mini-SVG. SVG supports rect/circle/ellipse/line/polyline/polygon/path,
   * solid fill/stroke/opacity and viewBox; transform, gradients, filters and text are unsupported.
   * SVG intrinsic size comes from pixel width/height or viewBox. Raster targets are at most 480×480. */
  interface ImageProps { src: ArrayBuffer; style?: Style; parent?: Node }
  /** RGB565 canvas, fixed size. All coordinates use canvas-local integer pixels. */
  interface CanvasContext {
    /** Canvas node id for native renderers that write to this canvas. */
    readonly nodeId: Node;
    fillColor(color: `#${string}` | number): void;
    /** Clears to black. */
    clear(): void;
    fillRect(x: number, y: number, width: number, height: number): void;
    line(x1: number, y1: number, x2: number, y2: number, color: `#${string}` | number, width?: number): void;
    /** Up to 240 [x,y] points. */
    polyline(points: [number, number][], color: `#${string}` | number, width?: number): void;
    circle(x: number, y: number, radius: number, color: `#${string}` | number): void;
    /** Anti-aliased solid circle at canvas-local integer centre; radius is in pixels. */
    fillCircle(cx: number, cy: number, r: number, color: `#${string}` | number): void;
    /** Anti-aliased solid axis-aligned ellipse; rx/ry are pixel radii. */
    fillEllipse(cx: number, cy: number, rx: number, ry: number, color: `#${string}` | number): void;
    /** Anti-aliased axis-aligned ellipse outline. Width defaults to 1 pixel (1..16), as for line. */
    ellipse(cx: number, cy: number, rx: number, ry: number, color: `#${string}` | number, width?: number): void;
    /**
     * Native anti-aliased annulus arc (r48). Angles are degrees, clockwise from
     * +x (3 o'clock), wrapping at 360; `from == to` draws a round dot and a
     * full 360° sweep draws a ring. Rendered in C (exact annulus geometry, AA
     * edges, round end caps) — no JS polyline sampling. Fractional degrees are
     * rounded to integers (≤0.5° boundary discretisation).
     */
    arc(cx: number, cy: number, r: number, from: number, to: number, width: number, color: `#${string}` | number): void;
    /** LVGL default 14px font; UTF-8 text at most 256 bytes. */
    text(x: number, y: number, str: string, color: `#${string}` | number, size?: 14): void;
    /**
     * Uploads a polyline once and returns its path id (1..8 per canvas). The
     * geometry is kept by the runtime and replayed by drawPath(), so a static
     * picture costs no JS per frame. Up to 240 points.
     */
    retainPath(points: [number, number][], color: `#${string}` | number, width?: number): number;
    /** Same, for independent segments `[x1,y1,x2,y2]` (tick marks, grids); 1..240 entries. */
    retainSegments(segments: [number, number, number, number][], color: `#${string}` | number, width?: number): number;
    /** Replays a retained path, optionally offset by (dx, dy) pixels. */
    drawPath(pathId: number, dx?: number, dy?: number): void;
    /**
     * Uploads an RGB565 bitmap once (r81) and returns 0 on success. `pixels`
     * must be a Uint16Array of exactly `w*h` entries; slot ids are 1..8 per
     * canvas and re-defining a slot replaces the previous bitmap. Pixels equal
     * to 0x0000 (pure black) are transparent when drawn — use #000001 for
     * near-black ink. The runtime keeps a PSRAM copy (8-slot budget caps all
     * sprites of one canvas at 460,800 bytes), so per-frame redraws pay one
     * drawImage() call instead of per-pixel JS.
     */
    retainImage(slot: number, w: number, h: number, pixels: Uint16Array): number;
    /**
     * Replays a retained sprite at (dx, dy), clipping to the canvas edges.
     * `flip` mirrors the sprite horizontally (characters facing left/right).
     */
    drawImage(slot: number, dx?: number, dy?: number, flip?: boolean): void;
  }
  interface CanvasProps {
    /** 1..480 pixels; all canvases share a 460,800-byte RGB565 budget. */
    width: number;
    height: number;
    /** Runs on creation and when a signal read inside changes. Return one or up to eight local dirty rectangles; omit to invalidate all. */
    onDraw(ctx: CanvasContext): void | {x: number; y: number; w: number; h: number} | Array<{x: number; y: number; w: number; h: number}>;
    parent?: Node;
    /** Layout styling; width and height must be specified above. */
    style?: Omit<Style, 'width' | 'height'>;
  }

  /** Anti-aliased LVGL arc (native `lv_arc`), for ring gauges. Unlike Canvas,
   * which writes raw pixels, the arc is drawn with coverage so it stays smooth.
   * `style.background` is the value ring colour, `track` the background ring. */
  interface ArcProps extends ViewProps {
    /** 0..100 percent of the start->end sweep, or a getter bound to signals. */
    value?: number | (() => number);
    /** Start angle in degrees (LVGL convention: clockwise, 0 = 3 o'clock). */
    start?: number;
    /** End angle in degrees. Defaults to 135 -> 45 (270-degree open ring). */
    end?: number;
    /** Ring stroke width in px. */
    thickness?: number;
    /** Track (background ring) colour: #RRGGBB or a theme colour key. */
    track?: string;
    /** Value-ring colour: #RRGGBB or a theme colour key. `style.background`
     * carries the same meaning and is accepted too, but on an arc it is never
     * treated as a box fill. */
    color?: string | (() => string);
  }
  function Arc(props: ArcProps): Node;
  function View(props: ViewProps, children?: Node[]): Node;
  function List<T>(props: ListProps<T>): Node;
  function Text(props: TextProps): Node;
  function Button(props: ButtonProps): Node;
  /** Returns a node id, or -1 invalid/oversize, -2 decode failure, -3 OOM/queue failure. */
  function Image(props: ImageProps): Node;
  function Canvas(props: CanvasProps): Node;
}

/** Optional JS bundle module: import runtime/shell.js before using these components. */
declare namespace lume.ui.shell {
  interface SafeInsets { top: number; right: number; bottom: number; left: number }
  interface SafeAreaProps {
    parent?: lume.ui.Node;
    /** Defaults to square. Round uses the largest centered inscribed square. */
    shape?: 'square' | 'round';
    /** Screen diameter/side in logical pixels; defaults to the runtime screen width. */
    size?: number;
    children?: lume.ui.Node[];
  }
  /** Insets in logical pixels; supply the screen's shape and integer diameter/side. */
  function safeInsets(shape: 'square' | 'round', size: number): SafeInsets;
  /** Parents children in a centered safe rectangle; warns once for known oversized View children. */
  function SafeArea(props?: SafeAreaProps): lume.ui.Node;
  /** Surface card with 12 px corners, 16 px padding and 12 px child gap. */
  function Card(props?: {parent?: lume.ui.Node; style?: lume.ui.Style;
    children?: lume.ui.Node[]; onPress?: () => void}): lume.ui.Node;
  /** Round button for compact actions. Default touch target is 56 px. */
  function IconButton(props?: {parent?: lume.ui.Node; title?: string;
    size?: number; style?: lume.ui.Style; onPress?: () => void}): lume.ui.Node;
  interface DialogButton {
    label: string;
    style?: 'plain' | 'primary' | 'danger';
    onPress?: () => void;
  }
  interface DialogProps {
    title: string;
    message?: string;
    buttons: DialogButton[];
    /** true (default): backdrop tap closes the top dialog; false: backdrop only intercepts touch. */
    modal?: boolean;
  }
  /** Opens above existing dialogs. Returns an idempotent close function. */
  function Dialog(props: DialogProps): () => void;
  namespace Toast {
    /** Replaces the active toast and restarts its duration. Never captures touch. */
    function show(message: string, options?: {durationMs?: number; position?: 'top' | 'bottom'}): void;
  }
  interface StatusBarProps {
    parent?: lume.ui.Node; left?: string | (() => string); right?: string | (() => string);
    height?: number; background?: string; clock?: boolean; x?: number; y?: number;
    /** 'round' sizes the bar to the inscribed safe square (e.g. 1.75C); default 'square'. */
    shape?: 'square' | 'round';
  }
  interface EdgeNavigationProps {
    parent?: lume.ui.Node; onBack?: () => boolean;
    onPageSwipe?: (dir: 'left' | 'right') => void;
    edgeWidth?: number; indicator?: boolean; width?: number; height?: number;
  }
  /** Per-letter feedback state for shell.Keyboard key caps.
   * 'hit' = green (right letter, right slot); 'present' = yellow (right letter,
   * wrong slot); 'miss' = grey (letter absent in the answer). */
  type KeyboardKeyState = 'hit' | 'present' | 'miss';
  /** Lowercase ASCII letter (a-z) -> feedback state. Unknown letters and
   * out-of-set values are ignored; SPACE / BKSP / ENTER are never tinted. */
  type KeyboardKeyStates = { [letter: string]: KeyboardKeyState };
  interface KeyboardProps {
    parent?: lume.ui.Node;
    /** Receives one lowercase ASCII character for each letter, plus ' ' for SPACE. */
    onKey?: (char: string) => void;
    onBackspace?: () => void;
    onSubmit?: () => void;
    /** Logical width; defaults to the screen width. */
    width?: number;
    /** Gap between keys, derived from theme.spacing and clamped to fit 40 px keys. */
    gap?: number;
    /** Key side in px (40..128); defaults to the largest size that fits the row. */
    keySize?: number;
    /** Optional per-key tint map, or a signal getter returning one. A getter
     * makes each letter key re-resolve its own background on publish (only that
     * key's ATTR_BG_COLOR is rewritten; no node rebuild). Undefaulted/absent
     * keeps the r148 behaviour: every key uses the theme 'surface' colour. */
    keyStates?: KeyboardKeyStates | (() => KeyboardKeyStates);
    x?: number; y?: number;
    style?: lume.ui.Style;
  }
  /** QWERTY soft keyboard (three letter rows + SPACE / BKSP / ENTER). Returns the
   * root node; dispose(id) removes its rows and keys through the shell cleanup chain.
   * Pure JS — no native input method, no on-device touch calibration on this slice. */
  function Keyboard(props?: KeyboardProps): lume.ui.Node;
  /** r151 form primitives. All three are controlled: state lives in the app's
   * signal and is passed back in via `value`; the component holds no copy. */
  interface SwitchProps {
    parent?: lume.ui.Node;
    /** Boolean state, or a signal getter returning one. Defaults to false. */
    value?: boolean | (() => boolean);
    /** Called with the negated value on a press of the whole >=40 px row. */
    onChange?: (value: boolean) => void;
    /** Optional label string or signal getter, rendered to the right. */
    label?: string | (() => string);
    /** Row / touch-target height in px (40..128, default 48). */
    height?: number;
    /** Track width in px (48..480, default 72); the knob is height-8. */
    trackWidth?: number;
    x?: number; y?: number;
  }
  /** Boolean toggle: track + knob Views with theme-token state colours.
   * A press anywhere on the root emits onChange(!value); no internal state. */
  function Switch(props?: SwitchProps): lume.ui.Node;
  interface ClickWheelProps {
    parent?: lume.ui.Node;
    /** Absolute screen center and radii in pixels. outerR >= 40; 1 <= innerR < outerR. */
    cx: number; cy: number; outerR: number; innerR: number;
    /** Signed 1/16-turn steps from an annular pan; clockwise is positive. */
    onRotate?: (deltaSteps: number) => void;
    /** Tap at radius <= innerR. */
    onCenterTap?: () => void;
    /** Tap in a 45-degree cardinal sector: 0 top, 1 right, 2 bottom, 3 left. */
    onOuterTap?: (quadrant: 0 | 1 | 2 | 3) => void;
  }
  /** Theme-token annulus and center button; pure gesture-to-callback translation.
   * Returns its Canvas node; dispose(node) unregisters all gesture handlers. */
  function ClickWheel(props: ClickWheelProps): lume.ui.Node;
  interface ColorPickerProps {
    parent?: lume.ui.Node;
    x?: number; y?: number;
    /** #RRGGBB; invalid values warn and use #40D8B0. */
    initialHex?: string;
    /** Live selection, at most once per 100 ms during a drag; final value flushes on release. */
    onChange?: (hex: string) => void;
    onConfirm?: (hex: string) => void;
    onDismiss?: () => void;
  }
  /** One 300x360 Canvas with a 24-segment hue ring, separate saturation/value
   * strips, preview and touch buttons. Returns a node for shell.dispose(node).
   * Also disposes on app pause. */
  function ColorPicker(props?: ColorPickerProps): lume.ui.Node;
  /** HSV degrees [0,360), saturation/value [0,1] to canonical #RRGGBB. */
  function hsvToHex(h: number, s: number, v: number): string;
  /** Parses #RRGGBB into HSV or returns null for invalid input. */
  function hexToHsv(hex: string): {h: number; s: number; v: number} | null;
  interface SliderProps {
    parent?: lume.ui.Node;
    min?: number; max?: number; step?: number;
    /** Numeric value, or a signal getter; clamped to [min, max]. */
    value?: number | (() => number);
    /** Called with a step-quantised number when a drag changes the value. */
    onChange?: (value: number) => void;
    /** Track width in px (default screen width - 48); height in px (40..128, default 40). */
    width?: number; height?: number;
    x?: number; y?: number;
  }
  /** Canvas + pan slider. dx from the press start maps back through
   * startValue + dx*(max-min)/width, rounded to `step`. onChange fires only
   * when the quantised value changes during a drag (no per-move jitter);
   * panend ends the drag without an extra emit. Gesture unsubscribers run on
   * dispose. Touch calibration is deferred to board bring-up. */
  function Slider(props?: SliderProps): lume.ui.Node;
  interface ProgressProps {
    parent?: lume.ui.Node;
    /** 0..1 fraction, or a signal getter; clamped. Emits nothing. */
    value?: number | (() => number);
    /** Optional label string or signal getter, drawn above the bar. */
    label?: string | (() => string);
    /** Bar height in px (12..128, default 12) and width in px (default screen - 48). */
    height?: number; width?: number;
    x?: number; y?: number;
  }
  /** Two-View determinate bar. Value changes only update the fill View's
   * ATTR_WIDTH via a bound numeric style (no Canvas, no pixel budget). */
  function Progress(props?: ProgressProps): lume.ui.Node;
  interface LauncherApp { id: string; label: string; color?: string; icon?: string; glyph?: string }
  interface LauncherProps {
    parent?: lume.ui.Node;
    /** Defaults to lume.apps.entries(); pass a list to render something else. */
    apps?: LauncherApp[];
    /** Defaults to lume.apps.launch(id) (real runtime switch). */
    onLaunch?: (id: string) => void;
    statusBar?: boolean; columns?: number; title?: string;
    right?: string | (() => string); indicator?: boolean;
    onBack?: () => boolean; onPageSwipe?: (dir: 'left' | 'right') => void;
    /** Fires when edit mode toggles (edit button or back-out-of-edit). */
    onEditingChange?: (editing: boolean) => void;
  }
  function StatusBar(props?: StatusBarProps): lume.ui.Node;
  /** Returns the left edge node; dispose(id) unregisters both edge targets. */
  function EdgeNavigation(props?: EdgeNavigationProps): lume.ui.Node;
  function Launcher(props: LauncherProps): lume.ui.Node;
  /** Idempotent cleanup for timers and gesture subscriptions before removing a component. */
  function dispose(node: lume.ui.Node): void;
}

/** Embedded prelude globals used by the firmware fallback bundle. */
declare function View(props: lume.ui.ViewProps, children?: lume.ui.Node[]): lume.ui.Node;
/** View with `display:'flex'` and `flexDirection:'row'` preset (the axis is forced). */
declare function Row(props?: lume.ui.ViewProps, children?: lume.ui.Node[]): lume.ui.Node;
/** View with `display:'flex'` and `flexDirection:'column'` preset (the axis is forced). */
declare function Column(props?: lume.ui.ViewProps, children?: lume.ui.Node[]): lume.ui.Node;

/** Alignment constants for `ViewProps.align` (equivalent to the kebab-case strings). */
declare const ALIGN_CENTER: 0;
declare const ALIGN_TOP_LEFT: 1;
declare const ALIGN_TOP_MID: 2;
declare const ALIGN_TOP_RIGHT: 3;
declare const ALIGN_BOTTOM_MID: 4;
declare const ALIGN_BOTTOM_LEFT: 5;
declare const ALIGN_BOTTOM_RIGHT: 6;
declare const ALIGN_LEFT_MID: 7;
declare const ALIGN_RIGHT_MID: 8;
declare const ALIGN_OUT_TOP_LEFT: 9;
declare const ALIGN_OUT_TOP_MID: 10;
declare const ALIGN_OUT_TOP_RIGHT: 11;
declare const ALIGN_OUT_BOTTOM_LEFT: 12;
declare const ALIGN_OUT_BOTTOM_MID: 13;
declare const ALIGN_OUT_BOTTOM_RIGHT: 14;
declare const ALIGN_OUT_LEFT_TOP: 15;
declare const ALIGN_OUT_LEFT_MID: 16;
declare const ALIGN_OUT_LEFT_BOTTOM: 17;
declare const ALIGN_OUT_RIGHT_TOP: 18;
declare const ALIGN_OUT_RIGHT_MID: 19;
declare const ALIGN_OUT_RIGHT_BOTTOM: 20;
declare function List<T>(props: lume.ui.ListProps<T>): lume.ui.Node;
declare function Text(props: lume.ui.TextProps): lume.ui.Node;
declare function Button(props: lume.ui.ButtonProps): lume.ui.Node;
declare function Image(props: lume.ui.ImageProps): lume.ui.Node;

declare namespace lume.image {
  /** Reads PNG IHDR or JPEG SOF only. -1 invalid/oversize (>480x480); -2 corrupt/unsupported. */
  function sizeOf(bytes: ArrayBuffer): { width: number; height: number } | -1 | -2;
  /** Decode PNG/JPEG bytes into a JS-heap Uint16Array holding the RGB565
   * colour plane (little-endian words; PNG's A8 plane is discarded). With both
   * maxW and maxH supplied, the decoded grid is scaled in one step with
   * nearest sampling; omit both for intrinsic size. Single images keep the
   * existing 480x480 raster cap. Returns -1 for bad arguments/types, -2 for
   * corrupt/oversize data or invalid target dimensions, -3 for PSRAM OOM. */
  function decode(bytes: ArrayBuffer, maxW?: number, maxH?: number): { width: number; height: number; pixels: Uint16Array } | -1 | -2 | -3;
}
declare function Canvas(props: lume.ui.CanvasProps): lume.ui.Node;
declare function signal<T>(initial: T): (() => T) & { set(value: T): void };

declare namespace lume.anim {
  type Easing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';
  type Attr = 'x' | 'y' | 'width' | 'height' | 'opacity';
  /** Starts from the current LVGL value unless from is supplied. Returns a completion token. */
  function to(node: lume.ui.Node, options: {
    attr: Attr; from?: number; to: number; durationMs: number;
    easing?: Easing; onComplete?: () => void;
  }): number;
  /** Cancels one node/attribute animation; its onComplete will not run. */
  function cancel(node: lume.ui.Node, attr: Attr): void;
}

declare namespace lume.theme {
  interface Theme {
    /** Named colors used by Style.background and Style.borderColor. */
    colors?: Record<string, `#${string}`>;
    /** Default borderRadius for styles without an explicit borderRadius. */
    radius?: number;
    /** With runtime/shell.js imported: default View padding and gap in px when omitted; explicit values win. */
    spacing?: number;
    /** Multiplies fontSize before selecting a bundled font face. */
    fontScale?: number;
  }
  /** Replaces the whole theme and repaints styles that read its named colors. */
  function set(theme: Theme): void;
  /** Returns an isolated snapshot of the current theme. */
  function get(): Theme;
}

declare namespace lume.system {
  function log(msg: string): void;
  /** Emits a firmware warning log. */
  function warn(msg: string): void;
  /** 20ms engine drain tick, with skipped missed periods; callbacks run on the engine task. */
  function setInterval(cb: () => void, ms: number): number;
  function setTimeout(cb: () => void, ms: number): number;
  function clearInterval(id: number): void;
  function clearTimeout(id: number): void;
  /**
   * r177: read-only board identifier -- the compile-time board name selected
   * by Kconfig `LUME_BOARD` (for example
   * "waveshare_esp32_s3_touch_amoled_2_16"). It is read from the lume-board-hal
   * registry via lume_board_get()->board_id: the real name after lume-board
   * registers at boot, or the honest "generic" stub id before registration.
   * The value domain is exactly the compiled board-name macro. There is no
   * setter and no API to select or switch a board from JS. On the host test
   * runner this is "host-stub" (harnesses may inject another string via
   * options.board); in the browser playground stub it is "browser-stub".
   * Compile-time / host evidence only; not verified on real hardware.
   */
  const board: string;
  /**
   * r128: wall-clock Unix time in MILLISECONDS (same unit as Date.now()).
   * QuickJS's Date.now() reads gettimeofday() too, so a successful setTimeNtp()
   * corrects it without extra work. Before any sync this returns the genuine
   * value counted from 1970 (a small number near zero), NOT a fabricated
   * plausible epoch -- treat small values as "clock not set" on a cold boot.
   */
  function time(): number;
  /**
   * r128: bounded, synchronous SNTP one-shot. `server` defaults to
   * "pool.ntp.org" (pass "ntp.aliyun.com" on CN networks); max 127 chars.
   * `timeoutMs` defaults to 10000 ms and is capped at 30000 ms; 0 falls back
   * to the default and a negative value throws a RangeError. A non-string
   * server throws a TypeError.
   *
   * Returns 0 on success (settimeofday() already applied, so Date.now() and
   * time() become correct), -1 for an invalid server, -2 for an SNTP
   * init/transport/timeout failure, or -3 when WiFi has no usable IPv4.
   * Idempotent: repeated calls tear down prior SNTP state and re-sync.
   *
   * BLOCKING: holds the engine task for up to `timeoutMs` -- touch, hot
   * reload and UI refresh stall meanwhile (same contract as net.httpGet).
   * Real on-device SNTP exchange is deferred to board bring-up.
   */
  function setTimeNtp(server?: string, timeoutMs?: number): number;
  /**
   * r141: reboot the SoC through esp_restart(). NEVER RETURNS -- the JS task is
   * killed mid-call, so any JS state not already persisted is lost. Takes no
   * arguments; passing any throws a TypeError. One ASCII firmware log line
   * (`lume.system: reboot requested`) is emitted immediately before restart.
   *
   * Persistence / state semantics across the restart:
   *   - LittleFS is journaled, so committed writes survive, but an OPEN write
   *     handle is severed and its buffered bytes are NOT guaranteed flushed.
   *     Close/flushed writes before calling reboot().
   *   - WiFi / SNTP state is not preserved; it is rebuilt by the app after the
   *     next boot (call setTimeNtp() again if wall-clock sync is needed).
   *   - KV (NVS) writes are durable; see lume.storage.kv.
   *
   * The C native returns `undefined` only as an unreachable formality; the
   * type is `never` to reflect that control flow never resumes here.
   */
  function reboot(): never;
}

declare namespace lume.power {
  /** Blocks until a GPIO11 touch wake; 0 success, -1 WiFi started, -2 INT held low, -3 driver error. */
  function sleepNow(): number;
  /** Idempotent once JS is executing; external touch wakes the sleeping CPU. */
  function wake(): number;
  /** Called after panel wake and redraw scheduling; returns an unregister function. */
  function onWake(cb: () => void): () => void;
}

declare namespace lume.app {
  /** Hooks run in registration order; each returns an idempotent unregister function. */
  function onStart(cb: () => void): () => void;
  function onPause(cb: () => void): () => void;
  function onResume(cb: () => void): () => void;
  /** Returning true handles BACK; false invokes the single-app default. */
  function onBack(cb: () => boolean): () => void;
}

/**
 * GPIO + PWM (LEDC) bindings (M2).
 * Every function returns a status NUMBER: 0 = success, negative = error code
 * (lume_gpio.h: -1 invalid/out-of-range arg, -2 ESP-IDF driver failure,
 * -3 pin/channel state conflict). read() returns the 0/1 level on success.
 * Semantic failures are logged via ESP_LOGW and returned as the negative
 * status; they never abort. Calling with too few arguments throws a
 * TypeError (a QuickJS contract: JS_EXCEPTION always implies a pending
 * exception), and passing non-numeric arguments raises the JS_ToInt32
 * conversion error.
 * Channel range is 0..LEDC_TIMER_MAX-1 (0..3 on ESP32-S3); one timer per
 * channel, so each channel has an independent frequency. pwmFree releases
 * the pin + channel; re-attaching a bound channel resets the old pad.
 */
declare namespace lume.gpio {
  /** mode: 0=INPUT 1=OUTPUT 2=OUTPUT_OD; pull: 0=none 1=up 2=down.
    * rejected (-3) while the pin is PWM-attached; pwmFree first. */
  function setPin(pin: number, mode: number, pull: number): number;
  /** level: 0 or 1. */
  function write(pin: number, level: number): number;
  /** returns the pin level (0/1), or a negative error code. */
  function read(pin: number): number;
  function toggle(pin: number): number;
  /** dutyPct 0..100, 8-bit resolution, LEDC low-speed channel.
    * re-attaching a channel resets the pad it previously drove. */
  function pwmAttach(pin: number, freqHz: number, dutyPct: number, channel: number): number;
  /** change duty of an already-attached pin (usable inside signal/effect). */
  function pwmDuty(pin: number, dutyPct: number): number;
  /** release a PWM pin + channel (stops output, resets the pad). */
  function pwmFree(pin: number): number;
}

/**
 * ADC1 oneshot bindings (M2), ESP32-S3.
 * Every function returns a status NUMBER: 0 = success, negative = error code
 * (lume_adc.h: -1 invalid/out-of-range arg, -2 ESP-IDF adc driver / calibration
 * failure, -3 pin not configured or calibration unavailable). readRaw() /
 * readMv() return a NON-NEGATIVE measurement on success (12-bit raw 0..4095 /
 * calibrated mV); negative values are the error codes. Semantic failures are
 * logged via ESP_LOGW and returned as the negative status; they never abort.
 * Calling with too few arguments throws a TypeError (a QuickJS contract:
 * JS_EXCEPTION always implies a pending exception), and passing non-numeric
 * arguments raises the JS_ToInt32 conversion error.
 *
 * Valid pins are the ADC1-samplable GPIOs 1..10 (hardcoded from the ESP32-S3
 * soc map); ADC2 GPIOs and board-specific dividers are out of scope. Each pin
 * is an independent channel, so there are no cross-pin conflicts: re-running
 * config() on a configured pin is last-wins (rebuilds the channel + calibration
 * for the new atten); free() releases the pin's calibration handle.
 *
 * atten (0..3) selects the input attenuation, which sets the measurable
 * voltage range: 0 = ADC_ATTEN_DB_0, 1 = ADC_ATTEN_DB_2_5, 2 = ADC_ATTEN_DB_6,
 * 3 = ADC_ATTEN_DB_12. Higher attenuation widens the range at the cost of
 * resolution/accuracy near the low end.
 *
 * readMv() returns curve-fitting-calibrated millivolts (ESP32-S3's only
 * compiled calibration scheme), NOT a raw-to-linear estimate. Accuracy is
 * bounded by the chip's eFuse calibration data and the chosen atten; absolute
 * voltage precision is deferred to board-level verification. If eFuse
 * calibration bits are absent, config() still succeeds and readRaw() works,
 * but readMv() returns -3 (calibration unavailable) rather than an
 * uncalibrated guess.
 */
declare namespace lume.adc {
  /** configure an ADC1 pin (GPIO 1..10) with atten 0..3; last-wins on repeat. */
  function config(pin: number, atten: number): number;
  /** raw 12-bit sample (0..4095), or a negative error code. */
  function readRaw(pin: number): number;
  /** calibrated mV, or a negative error code (-3 if calibration unavailable). */
  function readMv(pin: number): number;
  /** release the pin's calibration handle (keeps the shared ADC1 unit). */
  function free(pin: number): number;
}

/**
 * AXP2101 PMIC bindings (M2): battery telemetry, USB/charge status and power
 * off. NO-ARGUMENT API. Every function returns a status NUMBER: 0 = success,
 * negative = error code (lume_pmic_hw.h: -1 reserved / unused here, -2
 * ESP-IDF i2c_master driver failure, -3 PMIC not detected or required source
 * absent). Semantic failures are logged via ESP_LOGW and returned as the
 * negative status; they never abort. All functions take no arguments, so the
 * "too few arguments -> TypeError" path used by lume.gpio/lume.adc never
 * triggers here.
 *
 * The six telemetry/status reads return a NON-NEGATIVE measurement on success;
 * negative values are the error codes. powerOff() returns the status itself
 * (0 = the shutdown bit was written).
 *
 * NO BOARD: lume_pmic_hw_init() (run from the engine's binding registrar on
 * every fresh runtime) cannot confirm AXP2101 CHIP_ID 0x4A @ reg 0x03, so the
 * device handle stays NULL and ALL of battVoltageMv / battPercent /
 * vbusVoltageMv / usbConnected / chargingStatus / dieTempRaw / powerOff return
 * -3. Init failure is non-fatal (WARN only) and retries on the next runtime
 * reset; only a successful init latches. Battery voltage/percent additionally
 * return -3 when no battery is connected (STATUS1 bit3 clear); vbusVoltageMv
 * returns -3 when VBUS is not in (STATUS1 bit5 VBUS_GOOD clear or STATUS2
 * bit3 VINDPM set).
 *
 * Register facts are verified against XPowersLib (see lume_pmic_hw.c head
 * comment for the file:line table). Note the verified correction: VBUS in is
 * STATUS1 bit5 + !STATUS2 bit3, NOT STATUS1 bit4 (which is BATFET state).
 *
 * Charging parameters (voltages, currents, target voltage, fuel-gauge config)
 * are NEVER written — only measurement-channel enables at init and the single
 * shutdown bit in powerOff(). Reboot is exposed as `lume.system.reboot()`
 * (r141); powerOff() remains the only register write in this namespace.
 */
declare namespace lume.pmic {
  /** battery voltage in mV (H5L8 of REG 34h/35h, 1 mV/LSB), or -3 / negative error. */
  function battVoltageMv(): number;
  /** fuel-gauge battery percentage (raw REG A4h byte, 0..100 in practice), or -3 / negative error. */
  function battPercent(): number;
  /** VBUS voltage in mV (H6L8 of REG 38h/39h), or -3 when VBUS not in / negative error. */
  function vbusVoltageMv(): number;
  /** 1 = VBUS in, 0 = not in, negative = error. */
  function usbConnected(): number;
  /** charger status = STATUS2[2:0]: 0 tri_charge, 1 pre_charge, 2 CC,
    * 3 CV, 4 charge done, 5 not charging, 6..7 reserved; negative = error.
    * 0 is a VALID state here, not the OK status — test < 0 for errors. */
  function chargingStatus(): number;
  /** internal die-temperature ADC raw 14-bit sample (H6L8 of REG 3Ch/3Dh),
    * or negative error. Returned RAW: degC = 22 + (7274 - raw)/20 per
    * XPowersLib XPOWERS_AXP2101_CONVERSION (AXP2101Constants.h:241) — the
    * linear fit is left to JS because absolute accuracy needs board
    * verification (see docs/KNOWN-SIMPLIFICATIONS.md). */
  function dieTempRaw(): number;
  /** HIGH-RISK: set COMMON_CONFIG (10h) bit0 = soft PWROFF. The PMIC powers
    * off shortly after; returns 0 once written, or a negative error. This is
    * the ONLY register write and no charging parameters are touched. */
  function powerOff(): number;
}

/**
 * QMI8658 accelerometer + gyroscope bindings (M2 / r9). POLLED-ONLY this
 * round: lume_pins.h defines no IMU INT pin and the Waveshare official example
 * for this board polls getDataReady(), so there is no interrupt/event path.
 *
 * read() returns an OBJECT (unlike the int-status lume.gpio/adc/pmic APIs):
 *   {ax, ay, az}  m/s^2  (linear acceleration incl. gravity: ~9.81 on +Z at
 *                         rest; g -> m/s^2 with the standard 9.80665)
 *   {gx, gy, gz}  deg/s  (angular rate, the sensor's native dps unit)
 * The raw->physical scaling is done in NATIVE C (lume-imu), not JS. Config
 * mirrors the Waveshare SensorQMI8658 GetDataExample: accel +/-4g @ the
 * ACC_ODR_1000Hz setting (896.8 Hz effective in 6DOF mode),
 * gyro +/-64dps @ 896.8Hz, both LPFs on.
 *
 * On failure (no board, QMI8658 not detected, I2C error) read() returns null;
 * the native layer logs an ESP_LOGW. Semantic failures never abort/throw.
 * read() is deliberately NOT gated on the STATUS0 "new data since last read"
 * bits, so back-to-back reads always return the latest sample.
 *
 * NO BOARD: lume_imu_hw_init() (run from the engine's binding registrar on
 * every fresh runtime) cannot confirm WHO_AM_I, so read() returns null and
 * onMotion() returns -4. Init failure is non-fatal (WARN only) and retries on
 * the next runtime reset; only a successful init latches (r8 lume-pmic policy).
 *
 * onMotion(cb) is present for API-shape completeness but UNSUPPORTED this
 * round: it ALWAYS returns -4 (LUME_IMU_ERR_NO_INT) and never fires cb. The
 * schematic routes QMI_INT1 -> GPIO17 / QMI_INT2 -> GPIO21, but lume_pins.h
 * has no board-level IMU INT definition and the INT path cannot be validated
 * without a board -- deferred to the main controller's on-board round.
 * See docs/KNOWN-SIMPLIFICATIONS.md (r9 section).
 *
 * WHO_AM_I: the bundled Waveshare QMI8658A datasheet + SensorQMI8658 driver
 * say 0x05; the QMI8658C used on other Waveshare boards says 0xFD (the value
 * in the brief). init ACCEPTS BOTH (a single 0xFD check would fail on an
 * A-die board); the two variants share this register map. The detected ID is
 * logged at init.
 */
declare namespace lume.imu {
  interface ImuSample {
    /** linear acceleration in m/s^2 (gravity included). */
    ax: number; ay: number; az: number;
    /** angular rate in deg/s. */
    gx: number; gy: number; gz: number;
  }
  /** latest 6-axis sample, or null on no board / IMU not initialised / I2C error. */
  function read(): ImuSample | null;
  /** UNSUPPORTED (polled-only): always returns -4, cb is never called. */
  function onMotion(cb: () => void): number;
}

/**
 * NVS-backed persistent key-value store (M2 / r10).
 * Natives self-register under lume.storage.kv, so the prelude is unchanged.
 *
 * Status contract (returned as a NUMBER): 0 = success, negative = error code
 * (lume_kv.h: -1 invalid key/value, -2 ESP-IDF nvs_* driver failure, -3 NVS
 * not available). Semantic failures are logged via ESP_LOGW and returned as
 * the negative status; they never abort or throw. Calling with too few
 * arguments throws a TypeError (a QuickJS contract: JS_EXCEPTION always
 * implies a pending exception).
 *
 * DEGRADATION: nvs_flash_init() failure (e.g. the partition table has no NVS
 * partition) is NON-FATAL and makes ALL five APIs return -3. Init is
 * idempotent across hot-reload runtime resets and retries on failure. No
 * board is needed: NVS lives in main flash, so unlike lume.pmic/lume.imu
 * there is no "no board" path.
 *
 * Keys: NVS keys are at most 15 characters (NVS_KEY_NAME_MAX_SIZE 16 incl.
 * the NUL); empty or longer keys return -1. A single FIXED default namespace
 * "lume" is used (NVS namespace names are also <= 15 chars); namespace is not
 * JS-specifiable this round -- see docs/KNOWN-SIMPLIFICATIONS.md (r10).
 *
 * Values: one distinct NVS type per JS type so get() can reconstruct it --
 *   string      -> nvs_set_str  -> NVS_TYPE_STR
 *   number(int) -> nvs_set_i32  -> NVS_TYPE_I32   (JS_ToInt32 truncation/wrap)
 *   boolean     -> nvs_set_u8   -> NVS_TYPE_U8
 *   ArrayBuffer -> nvs_set_blob -> NVS_TYPE_BLOB  (small binary blob)
 * set() overwriting a key with a different type is handled by NVS. get()
 * recovers the type with nvs_find_key(). Strings/values are capped at < 4000
 * bytes (a string of 3999 B + NUL = the NVS single-page string limit; a blob
 * ~one NVS page in the 24 KB partition). Zero-length blobs, embedded-NUL
 * strings and unsupported value types (e.g. null/objects) return -1.
 * remove() of a missing key is idempotent (0); every write is nvs_commit()-ed
 * so values survive a power cycle (real power-cycle persistence is verified
 * by the main controller's on-board round, not here).
 *
 * NOTE the get()/keys() return unions: on failure they return a NEGATIVE
 * NUMBER (the error code) rather than a value/array. A stored number can
 * also be negative (-1/-2/-3 are legal stored values), so a negative result
 * from get() is AMBIGUOUS when NVS is available -- it is either a stored
 * number or an error code, and callers cannot reliably tell them apart.
 * Treat this as a known tradeoff (see docs/KNOWN-SIMPLIFICATIONS.md r10);
 * do NOT use `r < 0` as an error discriminator for get(). keys() has no
 * ambiguity: use `Array.isArray(r)` to detect failure there.
 */
declare namespace lume.storage.kv {
  /** string | number(int) | boolean | ArrayBuffer (small blob). */
  type KvValue = string | number | boolean | ArrayBuffer;
  /** persist a value; 0 on success, negative error code on failure. */
  function set(key: string, value: KvValue): number;
  /** the stored value (type preserved), null if the key is absent, or a
    * negative error code (as a number) on failure. */
  function get(key: string): KvValue | null | number;
  /** erase one key (idempotent: a missing key is 0); 0 or negative error. */
  function remove(key: string): number;
  /** all keys in the namespace; string[] (empty when none) or a negative
    * error code (as a number) on failure. */
  function keys(): string[] | number;
  /** erase ALL keys in the namespace; 0 or negative error. */
  function clear(): number;
}

/** LittleFS storage partition (M2 / r12). Paths are root-relative and may
 * start with '/'. Empty, '.', '..', repeated slash, trailing slash, embedded
 * NUL, and paths longer than 240 bytes are rejected with -1. No automatic
 * parent-directory creation; mkdir creates one level. Files are limited to
 * 64 KiB per read. write/append accept UTF-8 strings or ArrayBuffers.
 * read decodes UTF-8 text (invalid sequences use QuickJS replacement decoding);
 * readBinary returns exact bytes. Missing file on read/list is -2; remove of
 * a missing path is 0. All semantic failures return -1 invalid argument,
 * -2 filesystem/IO failure, or -3 unmounted. Too few arguments throw
 * TypeError; runtime allocation failures propagate a JS exception.
 * Mount failure is nonfatal; mounted() reports readiness. First mount may
 * format an unmountable partition, destroying any previous contents there.
 */
declare namespace lume.storage.Fs {
  function mounted(): boolean;
  function write(path: string, data: string | ArrayBuffer): number;
  function append(path: string, data: string | ArrayBuffer): number;
  function read(path: string): string | number;
  function readBinary(path: string): ArrayBuffer | number;
  function remove(path: string): number;
  function mkdir(path: string): number;
  function list(dirPath: string): string[] | number;
  function exists(path: string): boolean | number;
}

/** TF/microSD card over SPI (r125). Paths are root-relative and may
 * start with '/'. Path rules mirror lume.storage.Fs: empty, '.', '..',
 * repeated slash, embedded NUL, and paths longer than 240 bytes are
 * rejected with -1; a trailing '/' is normalized. No automatic
 * parent-directory creation; mkdir creates one level. Files are limited
 * to 64 KiB per read. write/append accept UTF-8 strings or ArrayBuffers.
 * read decodes UTF-8 text; readBinary returns exact bytes. Missing file
 * on read/list is -2; remove of a missing path is 0. All semantic
 * failures return -1 invalid argument, -2 card/IO failure, -3 card not
 * mounted (also every call when the board has no TF slot or no card is
 * inserted), or -4 detect() with no CD pin on this board. Too few
 * arguments throw TypeError; runtime allocation failures propagate a
 * JS exception.
 *
 * The mount is lazy (first Sd call), one-shot per boot, nonfatal, and
 * NEVER formats the card: a card that fails to mount leaves every API
 * returning -3 until reboot, and contents are never destroyed (opposite
 * of Fs, whose first mount may format the internal partition). No board
 * profile currently defines a CD pin, so detect() returns -4;
 * mounted() reflects the mount result.
 */
/** r173 companion file metadata returned by LUMC FLS over USB or HMAC OTA.
 * The transfer channel is separate from the JS Fs/Sd APIs and does not change
 * their 64 KiB read limit. */
interface LumeCompanionFileEntry {
  name: string;
  size: number;
  dir: boolean;
}

declare namespace lume.storage.Sd {
  /** true once the card VFS is mounted; false after a failed or not-yet
   * attempted mount. The first call triggers the mount attempt. */
  function mounted(): boolean;
  /** Card-detect pin state (1 = present, 0 = absent), or -4 when this
   * board has no CD pin. Independent of the mount state. */
  function detect(): number;
  /** Card capacity and free bytes, or a negative error code (as a
   * number) on failure. Exact integers (FAT32 max 2 TiB << 2^53). */
  function statvfs(): { total: number; free: number } | number;
  function write(path: string, data: string | ArrayBuffer): number;
  function append(path: string, data: string | ArrayBuffer): number;
  function read(path: string): string | number;
  function readBinary(path: string): ArrayBuffer | number;
  function remove(path: string): number;
  function mkdir(path: string): number;
  function list(dirPath: string): string[] | number;
  function exists(path: string): boolean | number;
}

/**
 * Multi-app store + single-live-app switching (r30).
 *
 * Layout on the LittleFS "storage" partition:
 *   /apps/<id>/app.js     bundled source (installed by `lume deploy`)
 *   /apps/<id>/meta.json  one-line JSON: {"label","icon","color"}
 *   /apps/.current        app started on the next boot ("" = built-in home)
 *
 * Ids are 1..31 chars of [A-Za-z0-9._-] and must not start with '.'.
 *
 * ONLY ONE APP IS ALIVE AT A TIME. launch()/home() do not run code in the
 * current context: they ask the engine to recycle the whole QuickJS runtime
 * and evaluate the target source in a fresh one (the hot-reload chain). The
 * call returns before that happens, so nothing after it in the caller runs.
 *
 * Return codes: 0 = success, -1 bad id / queue full / switch refused, -2
 * filesystem failure, -3 filesystem unavailable, -4 app not found, -6 refused
 * because that app is the one currently running. list() returns an array of
 * ids (ascending), meta() returns the raw JSON text. Launching is refused for
 * an id with no app.js.
 */
declare namespace lume.apps {
  function list(): string[] | number;
  function meta(id: string): string | number;
  function current(): string | number;
  /** Pin an installed app for every boot; "" clears the pin. Returns 0 or a
   * negative error. A pinned app wins over the last launched app (.current).
   * launch() still switches runtime and records .current; home() only clears
   * .current. Without a pin, boot uses .current or the built-in home grid. */
  function setBoot(id: string): number;
  function launch(id: string): number;
  function home(): number;
  function remove(id: string): number;
  function mounted(): boolean;
  /** Installed apps with meta.json merged; used by the launcher and lume_home_js. */
  function entries(): {
    id: string; label: string; icon: string; color: string;
  }[];
}

/**
 * WiFi station + basic HTTP client bindings (M2 / r11). Station-only,
 * WPA2-PSK only, http:// this round; smartconfig / softAP / BLE coexistence /
 * WPA3-Enterprise are NOT exposed. Natives self-register under lume.net and
 * lume.net.http (prelude unchanged).
 *
 * Status contract (returned as a NUMBER for the int-style APIs), mirrors
 * lume.storage.kv (r10) / lume.pmic: 0 = success, negative = error code
 * (lume_net.h: -1 invalid ssid/password/url/options, -2 ESP-IDF wifi/netif/
 * event/http_client driver failure, -3 WiFi not initialized / not connected
 * with an IP -- the UNIFORM degradation path). Semantic failures are logged
 * via ESP_LOGW and returned as the negative status; they never abort or throw.
 * Calling with too few arguments throws a TypeError (QuickJS contract).
 *
 * DEGRADATION: lume_net_init() runs from register_bindings() on every fresh
 * runtime; it is idempotent (a successful init latches for the process
 * lifetime, a failed init does NOT latch and retries on the next runtime reset)
 * and non-fatal. With a missing NVS partition / failed WiFi init, EVERY net
 * API (except init) returns -3 and never crashes. httpGet additionally needs
 * state GOT_IP (a usable IPv4), else -3.
 *
 * Credentials (password) are NEVER logged; the url is never logged either
 * (query strings may carry secrets). SSID <= 32 bytes, password 8..63 bytes
 * (WPA2-PSK), embedded NUL rejected with -1.
 *
 * THREAD NOTE (verified against ESP-IDF v5.5.5 source): WIFI_EVENT/IP_EVENT
 * handlers run on the dedicated "sys_evt" task (core 0), NOT the engine task
 * (core 1); the shared connection state is guarded by a portMUX spinlock
 * critical section. httpGet is SYNCHRONOUS and blocks the engine task for up
 * to timeoutMs (hot-reload/touch events stall meanwhile) -- an async/callback
 * version is a LATER round (docs/KNOWN-SIMPLIFICATIONS.md r11).
 *
 * Real WiFi association / HTTP transfer is NOT verified this round (compile +
 * size + ESP-IDF API self-check only); on-board acceptance is deferred to the
 * main controller's board round.
 */
declare namespace lume.net {
  namespace ws {
    interface Connection {
      /** String sends a text frame; ArrayBuffer sends a binary frame. */
      send(data: string | ArrayBuffer): number;
      close(): number;
    }
    interface Options {
      headers?: Record<string, string>;
      onOpen?: (connection: Connection) => void;
      onMessage?: (data: string | ArrayBuffer) => void;
      onClose?: () => void;
      onError?: (error: number) => void;
    }
    /** Starts a client connection. Callback receives (null, handle) on open or
     * (negative error, null) on failure; callbacks run on the engine task.
     * At most two connections and 64 KiB per incoming message. */
    function connect(url: string, options?: Options, cb?: (error: number | null, handle: Connection | null) => void): Promise<Connection> | void;
  }
  /** status().state enum values, also exposed as lume.net.DISCONNECTED etc. */
  const DISCONNECTED: 0;
  const CONNECTING: 1;
  const CONNECTED: 2;   /* associated, DHCP pending (no IP yet) */
  const GOT_IP: 3;      /* has an IPv4 address, usable for httpGet */
  type NetState = 0 | 1 | 2 | 3;

  interface NetStatus {
    state: NetState;
    /** dotted IPv4 string, or null when the station has no IP yet. */
    ip: string | null;
  }

  type HttpBody = string | ArrayBuffer;
  interface HttpGetOptions {
    /** network timeout in ms; <=0 -> 5000, clamped to 30000. */
    timeoutMs?: number;
    /** 'text' (default) -> string body; 'arraybuffer' -> ArrayBuffer body. */
    /**
     * 'text' (default) or 'arraybuffer'. Unknown string values fall back to
     * text at runtime (string-compare based coercion).
     */
    responseType?: 'text' | 'arraybuffer';
  }
  interface HttpResponse {
    /** HTTP status code (200/404/...). A 404 is a SUCCESS result, not an error. */
    status: number;
    /** response body; string by default, ArrayBuffer when requested. Capped
      * at 32 KB; if longer, `truncated` is true and body is truncated. */
    body: HttpBody;
    /** Content-Length from the server (may be -1 / larger than body). */
    contentLength: number;
    /** true when the body exceeded the 32 KB native cap. */
    truncated: boolean;
  }

  /** One-time WiFi station setup (idempotent, latches on success). 0 or -2/-3. */
  function init(): number;
  /** Tear down the station and allow a later re-init. 0 or -3 when not up. */
  function deinit(): number;
  /** Non-blocking WPA2-PSK connect. Returns 0 immediately; poll status() for
    * DISCONNECTED -> CONNECTING -> CONNECTED -> GOT_IP. 0 or negative error. */
  function connect(ssid: string, password: string): number;
  /** Disconnect (non-blocking; the DISCONNECTED event clears state/IP). */
  function disconnect(): number;
  /** Snapshot state + IP; negative error code (number) when WiFi is not up. */
  function status(): NetStatus | number;

  /** r26/r96: local snapshot of the WiFi-OTA push channel (no network probe).
   * `token` is the 32-hex HMAC key also printed on the serial log; it is never
   * sent over the WiFi channel. */
  interface OtaStatus {
    running: boolean;       /* TCP listener currently bound */
    wifiReady: boolean;      /* station has a usable IPv4 */
    tokenReady: boolean;     /* a token is available */
    hmac: boolean;           /* r96: HMAC-SHA256 challenge-response active */
    port: number;            /* configured TCP port (default 8765) */
    token: string;           /* 32 lowercase hex chars */
  }
  function otaStatus(): OtaStatus;
  /** Synchronous oneshot HTTP GET, primary shape. Object on a completed
    * transfer, negative error code (number) on failure / WiFi down. */
  function httpGet(url: string, options?: HttpGetOptions): HttpResponse | number;
  interface HttpRequestOptions {
    url: string;
    method?: 'GET' | 'POST';
    headers?: Record<string, string>;
    body?: string | ArrayBuffer;
    /** Defaults to 30 seconds; capped at 120 seconds. */
    timeoutMs?: number;
    /** PEM CA certificate. Overrides the built-in trust bundle. */
    caPem?: string;
    /** Explicitly disable TLS server verification. Unsafe. Defaults to false. */
    httpsInsecure?: boolean;
  }
  /** Synchronous request. Response body is text, capped at 32 KiB.
   * -1 argument, -2 transport, -3 WiFi state, -5 timeout. */
  function httpRequest(options: HttpRequestOptions): HttpResponse | number;

  interface ScanResult {
    /** AP name, '' for a hidden AP. */
    ssid: string;
    /** signal strength in dBm (negative; closer to 0 = stronger). */
    rssi: number;
    /** wifi_auth_mode_t: 0 open, 1 WEP, 2 WPA_PSK, 3 WPA2_PSK,
      * 4 WPA/WPA2_PSK, ... only WPA2-PSK-class networks (>= 2) can be
      * joined with connect(). */
    auth: number;
  }

  /** Synchronous AP scan over all channels; BLOCKS the engine task for
    * ~1.5-3 s (same tradeoff as the synchronous httpGet). Returns an
    * array sorted by RSSI descending (possibly empty), or a negative
    * error code (number) when WiFi is not initialized or the driver
    * rejects the scan (e.g. during an ongoing association). */
  function scan(): ScanResult[] | number;

  /** Reserved `http` sub-namespace: get() is the SAME native as httpGet(). */
  namespace http {
    function get(url: string, options?: HttpGetOptions): HttpResponse | number;
  }

  /**
   * r71: tiny LAN web server. C owns HTTP + sockets; the running JS app owns
   * EVERY route and page body via on(), so the UI hot-updates with the app.
   *
   * OFF by default: start({token}) is explicit, binds only when WiFi has an
   * IPv4, and is auto-stopped on every app switch / close / failed eval.
   * A request without a matching `?key=<token>` is rejected with 403 before
   * any JS handler runs. Paths are NEVER filesystem paths. Body <= 8 KiB,
   * at most 2 concurrent connections, HTTP/1.0 short connections only.
   *
   * Handlers are SYNCHRONOUS on the engine task and must return in a few ms:
   * light string building is fine, heavy work must be pushed to state/signal
   * and fetched by a later poll. See docs/hardware-api.md and
   * docs/KNOWN-SIMPLIFICATIONS.md (r71).
   */
  namespace web {
    interface StartOptions {
      /** TCP port 1024-65535; defaults to CONFIG_LUME_WEB_PORT (8080). */
      port?: number;
      /** REQUIRED URL-safe token; appended as ?key=<token> to url(). */
      token: string;
    }
    interface Request {
      method: string;
      /** Exact raw path (no decoding, no file-system interpretation). */
      path: string;
      /** URL-decoded query parameters. */
      query: Record<string, string>;
      /** UTF-8 request body, capped at 8 KiB. */
      body: string;
    }
    interface Response {
      status: number;
      headers?: Record<string, string>;
      body?: string | ArrayBuffer;
    }
    type Handler = (req: Request) => Response;
    /** 0 on success, or a negative error code: -1 argument, -2 no WiFi IP,
      * -3 already running, -4 out of memory. */
    function start(options: StartOptions): number;
    /** Stop the listener and close all connections. Returns 0. */
    function stop(): number;
    /** Register an exact (method, path) route; returns 0 or -1 on bad args.
      * Last registration for a key wins. Unmatched requests get 404; GET /
      * with no route shows a built-in welcome page listing registered routes. */
    function on(method: string, path: string, handler: Handler): number;
    /** "http://<ip>:<port>/?key=<token>" or null when stopped / no WiFi IP. */
    function url(): string | null;
  }
}

/** r96: WiFi OTA app-push channel (HMAC-SHA256 challenge-response).
 * The listener is auto-managed by the WiFi GOT_IP gate — there is deliberately
 * no start()/stop(): status() reflects whether it is currently bound. */
declare namespace lume.ota {
  /** Same snapshot as lume.net.otaStatus(), with `hmac: true`. */
  function status(): lume.net.OtaStatus;
  /** Replace the WiFi-OTA token (32 lowercase hex chars) and persist it to NVS.
   * Returns 0 on success, a negative error code otherwise. */
  function setToken(tokenHex: string): number;
}

/** Synchronous OpenAI-compatible chat completion. Blocks UI and touch. */
declare namespace lume.ai {
  interface Message { role: 'system' | 'user' | 'assistant'; content: string; }
  interface ChatOptions {
    messages: Message[];
    model?: string;       /* defaults to deepseek-flash */
    baseUrl?: string;     /* defaults to https://api.deepseek.com */
    maxTokens?: number;
    temperature?: number;
    timeoutMs?: number;   /* defaults 30000, native cap 120000 */
    caPem?: string;
    httpsInsecure?: boolean;
  }
  interface ChatResult { content: string; usage: unknown; finishReason: string | null; }
  /** Persists plaintext key in NVS under ai_api_key. Never bundle a real key. */
  function setKey(key: string): number;
  /** -1 invalid/key absent, -2 network, -3 HTTP, -4 parse/truncated, -5 timeout. */
  function chat(options: ChatOptions): ChatResult | number;
}

/**
 * BLE peripheral (NimBLE GATT server), r25. One 128-bit Nordic UART
 * Service-shaped service: RX (write / write-no-rsp) + TX (notify). Peripheral
 * only: no central/scan, no pairing/bonding, no encryption, one connection.
 * Radio init is LAZY (first start()/init()); there is no deinit() — stop()
 * ends advertising/the connection but the stack lives for the process
 * lifetime. status()/read() return an object/value on success and a NEGATIVE
 * NUMBER on failure; init/start/stop/write return the int status directly.
 * Error codes (lume_ble.h): 0 OK, -1 bad name/data, -2 NimBLE driver,
 * -3 stack/connection state. Semantic failures never abort or throw.
 *
 * Data is a UTF-8 string of at most MAX_PAYLOAD (20) bytes: the default ATT
 * MTU 23 minus the 3-byte ATT header. No MTU negotiation / fragmentation and
 * no ArrayBuffer form. read() polls a bounded 8-packet FIFO (a full queue
 * drops the OLDEST packet); pair it with lume.system.setInterval(). A central
 * must subscribe to TX notifications to receive write().
 *
 * Firmware build + `idf.py size` are verified on ESP-IDF v5.5.5, but on-board
 * acceptance is NOT done: advertising, GATT discovery, notify throughput,
 * WiFi+BLE coexistence and sleep current remain for the board round
 * (docs/KNOWN-SIMPLIFICATIONS.md r25).
 */
declare namespace lume.ble {
  const IDLE: 0;
  const ADVERTISING: 1;
  const CONNECTED: 2;
  /** Fixed 20-byte packet cap (default ATT_MTU 23 - 3). */
  const MAX_PAYLOAD: 20;
  type BleState = 0 | 1 | 2;

  interface BleStatus {
    state: BleState;
    connected: boolean;
    /** central subscribed to TX notifications */
    subscribed: boolean;
    /** last observed ATT MTU (23 before BLE_GAP_EVENT_MTU) */
    mtu: number;
    /** unread packets waiting in the bounded FIFO */
    pending: number;
  }

  /** One-time NimBLE stack setup; idempotent, optional (start() calls it). */
  function init(): number;
  /** Set the advertised name (1..24 bytes, no embedded NUL) and start
    * undirected general-discoverable advertising. Omit for "Lume". */
  function start(name?: string): number;
  /** Stop advertising and terminate the current connection (best effort). */
  function stop(): number;
  /** Snapshot; negative error code when the stack is not initialized. */
  function status(): BleStatus | number;
  /** Notify the connected central. 1..20 UTF-8 bytes, no embedded NUL.
    * 0 or a negative error code (-3 when not connected / no TX handle). */
  function write(data: string): number;
  /** Pop one inbound packet: string, null when the FIFO is empty, or a
    * negative error code. */
  function read(): string | null | number;
}

/** M2 audio: signed little-endian 16-bit stereo PCM at 16 kHz, no WAV header.
 * play/record block the JS engine task; 64000 bytes = one second. */
declare namespace lume.audio {
  interface Options { sampleRate?: 16000; channels?: 2; bits?: 16; }
  /** 0 success; -1 bad argument, -2 driver/I2C/I2S failure, -3 board not ready. */
  function play(pcm: ArrayBuffer, opts?: Options): number;
  /** 0 < seconds <= 10; PSRAM buffer becomes the returned ArrayBuffer backing store.
   * On failure returns -1 argument, -2 driver, -3 board, -4 allocation. */
  function record(seconds: number, opts?: Options): ArrayBuffer | number;
  /** 0..100; returns 0 or negative error code. */
  function setVolume(percent: number): number;
  /** Mutes future output; cannot interrupt an active synchronous play call. */
  function stop(): number;
  interface StreamOptions { sampleRate: 16000 | 32000 | 44100 | 48000; channels: 2; bits: 16; }
  /** Copies at most 4608 bytes into a 16-chunk PSRAM queue. Returns -3 when full;
   * retry the same chunk on a later timer tick. PCM output uses the given rate. */
  function playStream(pcmChunk: ArrayBuffer, opts: StreamOptions): number;
  /** True after the queued writes finish. The final codec/DMA settling time is
   * subject to board acceptance. */
  function streamFinished(): boolean;
  function streamPause(paused: boolean): number;
  function streamReset(): number;
  interface RecordStreamOptions {
    /** 512, 1024 (default), or 2048 stereo frames at 16 kHz. */
    chunkSamples?: 512 | 1024 | 2048;
    /** PCM is signed 16-bit little-endian interleaved stereo. Return within a
     * few milliseconds: only do small FFT work or set a signal. Do not build
     * strings, decode, or redraw in this callback. Buffer is valid afterward. */
    onChunk(pcm: ArrayBuffer, samples: number): void;
    onError?(code: number): void;
  }
  /** Starts one microphone stream. 0 success; -1 arguments, -2 I2S/codec,
   * -3 board/busy (including another recording or incompatible playback rate),
   * -4 PSRAM allocation. An eight-chunk engine queue drops its oldest audio
   * chunk when full to bound live latency; use recordStreamDropped() for HUD. */
  function recordStream(opts: RecordStreamOptions): number;
  /** Stops capture and releases queued chunks; -3 if no stream is active. */
  function stopStream(): number;
  function recordStreamDropped(): number;
  namespace mp3 {
    interface Frame {
      pcm: ArrayBuffer;
      samples: number;
      sampleRate: number;
      channels: 1 | 2;
      bitrateKbps: number;
      byteOffset: number;
      fileBytes: number;
    }
    /** TF card paths, separate from LittleFS Fs. One active decoder. */
    function list(path: string): string[] | number;
    function open(path: string): number;
    function decode(): Frame | null | number;
    function close(): number;
    /** UTF-8 LRC text, maximum 32767 bytes; -1 if larger. */
    function readText(path: string): string | number;
    function id3v1(path: string): { title: string; artist: string } | null | number;
    /** v2.3/v2.4 TIT2, TPE1 and TALB as UTF-8; null without a v2 tag. */
    function id3v2(path: string): { title: string; artist: string; album: string } | null | number;
  }
}

/**
 * Gesture layer (M3 / r21). Gestures attach to a specific View (a numeric node
 * id) and are delivered through the same LVGL->engine event pipeline as onPress.
 * x/y are absolute screen pixels; dx/dy are displacement from the press start;
 * `dir` is LVGL's lv_indev_get_gesture_dir() when a swipe exceeds LVGL's
 * gesture limit, else inferred from the dominant movement axis.
 */
interface GestureEvent {
  type: 'tap' | 'swipe' | 'longpress' | 'pan' | 'panstart' | 'panend';
  x: number; y: number;            // current / end point
  dx?: number; dy?: number;        // swipe delta or pan displacement
  dir?: 'left' | 'right' | 'up' | 'down';
}
declare namespace lume.gesture {
  /** Register a gesture callback on a View; returns an idempotent unregister fn.
    * `target` is the numeric node id returned by View()/Button()/etc. */
  function on(target: lume.ui.Node, type: GestureEvent['type'], cb: (e: GestureEvent) => void): () => void;
  /** Centralized, tunable thresholds (start from vendored LVGL defaults). */
  const tuning: {
    tapMovePx: number; tapMaxMs: number; longpressMs: number;
    panMinPx: number; swipeMinPx: number; swipeMinVel: number;
  };
}

/** Float32Array operations use the view directly. vecAdd/vecScale mutate a. */
declare namespace lume.math {
  function vecAdd(a: Float32Array, b: Float32Array): Float32Array;
  function vecScale(a: Float32Array, scale: number): Float32Array;
  function dot(a: Float32Array, b: Float32Array): number;
  /** acc is interleaved [ax, ay]; vx and vy are mutated in place. */
  function integrate(acc: Float32Array, vx: Float32Array, vy: Float32Array, dt: number): void;
}

/** Forward, unnormalised real FFT over 2..4096 power-of-two Float32 samples. */
declare namespace lume.fft {
  /** Writes N packed floats into re, or out when supplied: [DC, Nyquist,
   * Re(1), Im(1), ..., Re(N/2-1), Im(N/2-1)]. Returns 0, -1 for a non-Float32Array,
   * -2 for an invalid length, or -3 if scratch allocation fails. */
  function realfft(re: Float32Array, out?: Float32Array): number;
  /** Writes N/2 magnitudes (DC through bin N/2-1; Nyquist is omitted).
   * With im omitted, re is the packed N-slot realfft output. With im supplied,
   * re and im are separate N/2-slot spectra. out must not overlap either input.
   * Returns 0, -1 for a non-Float32Array, or -2 for invalid lengths/overlap. */
  function magnitude(out: Float32Array, re: Float32Array, im?: Float32Array): number;
}

/** Zero-copy RGB565 scaling into a caller-owned Uint16Array. Pure per-pixel
 * sampling: 0x0000 transparency and colour keys are NOT interpreted here; the
 * retainImage / drawImage layer owns those semantics. */
declare namespace lume.imgscale {
  /** Scale the sw*sh RGB565 pixels in src into the dw*dh region in dst.
   * Both views are used directly (no backing-store copy); offsets from
   * subarray() are honoured. mode defaults to 'nearest'; 'bilinear' samples
   * R5/G6/B5 independently with 8-bit fixed-point weights and clamps to the
   * source border. dst may be the same view as src only when sw===dw and
   * sh===dh (in-place copy); partially overlapping buffers are rejected.
   * Returns 0 on success, -1 for a bad argument/type/mode, -2 for invalid
   * dimensions, too-short views or buffer overlap, -3 reserved for internal
   * failure (no reachable path in the current implementation).
   * Each dimension must be an integer in 1..16384 and each view long enough
   * for its grid; fractional dimensions are rejected with -2. */
  function scale(src: Uint16Array, sw: number, sh: number, dst: Uint16Array, dw: number, dh: number, mode?: 'nearest' | 'bilinear'): number;
}

/** Native crypto primitives backed by ESP-IDF mbedTLS (r91). Inputs are
 * borrowed zero-copy typed arrays (subarray byteOffsets are honoured) and no
 * JS callback runs while a backing-store pointer is in use. All outputs are
 * written into a caller-owned Uint8Array. Return codes: 0 success, -1 bad
 * argument type, -2 invalid key/iv/output length, -3 internal failure.
 * Browser playground / host prelude stubs return -3 (unsupported). */
declare namespace lume.crypto {
  /** SHA-256 digest of data into out (a Uint8Array with >= 32 bytes; its
   * byteOffset is honoured). Returns 0, -1 for a non-typed-array/non-Uint8Array
   * argument, or -2 if out is shorter than 32 bytes. */
  function sha256(data: ArrayBufferView, out: Uint8Array): number;
  /** HMAC-SHA256 of data under key into out (>= 32 bytes). Returns 0, -1 for a
   * bad argument type, or -2 if out is shorter than 32 bytes. */
  function hmacSha256(key: ArrayBufferView, data: ArrayBufferView, out: Uint8Array): number;
  /** Reflected CRC-32 (polynomial 0xEDB88320), zlib-compatible: seed is the
   * previous zlib.crc32() return value (omit/0 for a fresh stream). Returns
   * the unsigned 32-bit CRC value, or -1 for a bad argument type (a valid CRC
   * of 0xFFFFFFFF is returned as 4294967295, not -1). */
  function crc32(data: ArrayBufferView, seed?: number): number;
  /** AES-CTR (key 16/24/32 bytes, iv 16 bytes). CTR is symmetric: the same
   * call encrypts and decrypts. Writes data.length bytes into out, which may
   * be the same view as data (in-place); a partially overlapping out is -2.
   * The caller's iv is copied and never modified. Returns 0, -1 for a bad
   * argument type, -2 for an invalid key/iv/out length or overlap, or -3 if
   * mbedTLS fails. */
  function aesCtr(key: ArrayBufferView, iv: ArrayBufferView, data: ArrayBufferView, out: Uint8Array): number;
}

/** Native DEFLATE decompression via vendored miniz tinfl (r92). Inputs are
 * borrowed zero-copy typed arrays (subarray byteOffsets are honoured) and no
 * JS callback runs while a backing-store pointer is in use. The result is
 * written into a caller-owned Uint8Array; no native allocation happens.
 * format is "raw" (RFC 1951, default when omitted/null) or "zlib" (RFC 1950).
 * zlib mode validates CMF/FLG, rejects preset dictionaries and verifies
 * Adler-32 internally, so no separate adler32 primitive is exposed.
 * Browser playground / host prelude stubs return -3 (unsupported). */
declare namespace lume.compress {
  /** Decompress src into out. Returns the number of bytes written (>= 0;
   * 0 for an empty stream), -1 for a bad argument type/format string, -2 for
   * a malformed/truncated/checksum-mismatched input stream, or -3 if out is
   * too small for the decompressed data. src may be any typed array; out must
   * be a Uint8Array. Views are used directly; bytes outside a view are never
   * written. */
  function inflate(src: ArrayBufferView, out: Uint8Array, format?: 'raw' | 'zlib'): number;
}

/** Native DDA renderer for a fixed-size RGB565 Canvas. */
declare namespace lume.raycast {
  /** Bind a Uint8Array map without copying its backing store.
   * 0 is empty; 1..3 select the brick, stone or door texture. The view must contain exactly w*h
   * cells and remain unchanged while a frame is queued. */
  function setMap(w: number, h: number, bytes: Uint8Array): 0;
  /** Bind three 16x16 palette-index wall textures (768 bytes total).
   * Rebind after setMap when changing levels. */
  function setTextures(bytes: Uint8Array): 0;
  /** Queue a full-frame render into the Canvas work buffer. Angle is radians.
   * Call from Canvas.onDraw; its normal invalidate publishes the frame. */
  /** sprites holds up to eight [x,y,type] triples; type 0 is guard, 1 hunter. */
  function render(id: lume.ui.Node, px: number, py: number, angle: number, hp?: number, sprites?: Float32Array): void;
}

declare namespace lume {
  const math: typeof lume.math;
  const fft: typeof lume.fft;
  const imgscale: typeof lume.imgscale;
  const crypto: typeof lume.crypto;
  const compress: typeof lume.compress;
  const raycast: typeof lume.raycast;
  const ui: typeof lume.ui;
  const system: typeof lume.system;
  const app: typeof lume.app;
  const theme: typeof lume.theme;
  const gpio: typeof lume.gpio;
  const adc: typeof lume.adc;
  const pmic: typeof lume.pmic;
  const imu: typeof lume.imu;
  const storage: typeof lume.storage;
  const net: typeof lume.net;
  const ai: typeof lume.ai;
  const ble: typeof lume.ble;
  const audio: typeof lume.audio;
  const gesture: typeof lume.gesture;
  function start(root: lume.ui.Node): void;
}
