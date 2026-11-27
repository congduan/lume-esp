/** Vector physics demo: lume.math on one static screen (r137).
 *
 *  N=24 particles live in caller-owned Float32Arrays (px/py/vx/vy) plus an
 *  interleaved acceleration buffer acc=[ax0,ay0,ax1,ay1,...]. Each fixed step
 *  calls all four lume.math APIs for real: integrate() applies gravity to the
 *  velocities, vecScale() applies damping, vecAdd() composes a constant
 *  horizontal kick into vx, and dot(vx,vx)+dot(vy,vy) reports squared speed
 *  (kinetic proxy) on the HUD. Positions and wall bounces are plain app JS.
 *
 *  EXCEPTION CONTRACT: lume.math is the one namespace that signals failure by
 *  THROWING, not by a negative return code: TypeError for a non-Float32Array
 *  view, RangeError for a length mismatch (acc must be vx.length*2). Every
 *  physics step wraps the calls in try/catch; on a throw the HUD shows ASCII
 *  "MATH ERR" and physics stops updating. The branch is defensive only --
 *  well-formed app inputs never reach it; the host harness injects a throwing
 *  stub to prove it can be presented.
 *
 *  PHYSICS (integer-tuned, fixed 50 ms step for deterministic replay):
 *    GLEVELS = [40, 80, 160] px/s^2 gravity; NEXT cycles the level.
 *    DAMP = 0.98 per step, KICK = 6 px/s horizontal impulse per step,
 *    REST = 0.7 restitution, R = 4 px radius, S = 240 px square canvas.
 *  Float32 writes round once after double arithmetic, mirroring the firmware
 *  (float) cast; the host harness replays the same step with an INDEPENDENT
 *  double reference integrator and checks strict equality.
 *
 *  NODE BUDGET: the firmware node table is LUME_MAX_NODES = 128 slots. This
 *  app builds ONE static tree of 9 nodes and creates nothing at runtime:
 *    root View (1) + header View + Text (2) + stats View + 2 Texts (3) +
 *    controls View + Button (1+1) + Canvas (1). No lists, no dynamic views.
 *  The canvas is 240x240 (not full-screen) to keep the raster budget modest.
 *
 *  ASCII-only UI copy (r64). Plain global var/function script, no imports.
 *  Host harness tests/vec_demo.js runs this app through the firmware prelude
 *  and the real JS mirror stub; the board C binding is exercised by the native
 *  build, not on the host. Real-device acceptance stays deferred.
 */
var math = lume.math;
var N = 24, R = 4, S = 240, DT = 0.05;
var GLEVELS = [40, 80, 160];
var DAMP = 0.98, KICK = 6, REST = 0.7;
var BG = '#07111D', INK = '#40D8B0';

var px = new Float32Array(N), py = new Float32Array(N);
var vx = new Float32Array(N), vy = new Float32Array(N);
var acc = new Float32Array(N * 2), kickX = new Float32Array(N);
var COLS = 6, ROWS = Math.ceil(N / COLS);
var SPX = (S - 2 * R) / (COLS - 1);
var SPY = (S - 2 * R) / Math.max(1, ROWS - 1);
var i;
for (i = 0; i < N; i++) {
  px[i] = R + (i % COLS) * SPX;
  py[i] = R + Math.floor(i / COLS) * SPY;
  vx[i] = (i % 2 ? 1 : -1) * (8 + (i % 5) * 3);
  vy[i] = 0;
  kickX[i] = KICK;
}

var level = 0;
var lastEnergy = 0;
var mathErr = false;
var timer = null, paused = false;
var frame = signal(0);
var hudDisplay = signal(''), statusDisplay = signal('');

var theme = { colors: {
  bg:'#07111D', primary:'#07111D', surface:'#132435', surfaceAlt:'#1C3449',
  text:'#F2F7FB', textDim:'#9EB3C6', accent:'#40D8B0', danger:'#FF6B79', success:'#40D8B0'
}, radius:12, spacing:12, fontScale:1 };
lume.theme.set(theme);

function publish() {
  hudDisplay.set('N' + N + ' G' + GLEVELS[level] + ' E' + Math.round(lastEnergy));
  statusDisplay.set(mathErr ? 'MATH ERR' : 'OK');
}

/* One fixed physics step. All four math APIs are genuinely used. Returns true
 * on success, false when the defensive error branch was taken. */
function step(dt) {
  if (mathErr) return false;
  try {
    var g = GLEVELS[level], n;
    for (n = 0; n < N; n++) { acc[2 * n] = 0; acc[2 * n + 1] = g; }
    math.integrate(acc, vx, vy, dt);            /* gravity -> velocities */
    math.vecScale(vx, DAMP);                    /* damping */
    math.vecScale(vy, DAMP);
    math.vecAdd(vx, kickX);                     /* horizontal composition */
    lastEnergy = math.dot(vx, vx) + math.dot(vy, vy);
    for (n = 0; n < N; n++) {                   /* app-level position + bounce */
      px[n] = px[n] + vx[n] * dt;
      py[n] = py[n] + vy[n] * dt;
      if (px[n] < R) { px[n] = R; if (vx[n] < 0) vx[n] = -vx[n] * REST; }
      else if (px[n] > S - R) { px[n] = S - R; if (vx[n] > 0) vx[n] = -vx[n] * REST; }
      if (py[n] < R) { py[n] = R; if (vy[n] < 0) vy[n] = -vy[n] * REST; }
      else if (py[n] > S - R) { py[n] = S - R; if (vy[n] > 0) vy[n] = -vy[n] * REST; }
    }
  } catch (e) {
    mathErr = true;
    hudDisplay.set('MATH ERR');
    statusDisplay.set('MATH ERR');
    return false;
  }
  publish();
  return true;
}

function next() {
  level = (level + 1) % GLEVELS.length;
  publish();
  return state();
}

/* Snapshot for host assertions (plain arrays of exact Float32 values). */
function state() {
  return {
    n: N, level: level, g: GLEVELS[level], energy: lastEnergy, mathErr: mathErr,
    px: Array.prototype.slice.call(px), py: Array.prototype.slice.call(py),
    vx: Array.prototype.slice.call(vx), vy: Array.prototype.slice.call(vy)
  };
}

function tick() {
  if (paused) return;
  if (step(DT)) frame.set(frame() + 1);
}
function start() { if (timer === null && !mathErr) timer = lume.system.setInterval(tick, 50); }
function stop() { if (timer !== null) lume.system.clearInterval(timer); timer = null; }
lume.app.onStart(start);
lume.app.onPause(function () { paused = true; stop(); });
lume.app.onResume(function () { paused = false; start(); });

var root = View({style:{width:'100%',height:'100%',background:'bg',scroll:'none',
  display:'flex',flexDirection:'column',justifyContent:'space-between',padding:76,gap:4}},[
  View({style:{width:'100%',height:32,display:'flex',flexDirection:'column',
    alignItems:'center',justifyContent:'center',padding:0,gap:0}},[
    Text({text:'Vector Physics',style:{fontSize:16,color:'text',borderRadius:0}})
  ]),
  View({style:{width:'100%',height:48,display:'flex',flexDirection:'row',
    alignItems:'center',justifyContent:'space-between',padding:0,gap:8}},[
    View({style:{height:44,display:'flex',flexDirection:'column',
      justifyContent:'center',padding:0,gap:2}},[
      Text({text:hudDisplay,style:{fontSize:14,color:'text',borderRadius:0}}),
      Text({text:statusDisplay,style:{fontSize:12,color:'accent',borderRadius:0}})
    ]),
    Button({title:'NEXT',style:{width:100,height:48,borderRadius:12,background:'surface'},onPress:next})
  ])
]);

Canvas({ parent: root, width: S, height: S,
  style:{position:'absolute',x:120,y:112}, onDraw: function (c) {
  frame();                                    /* subscribe to tick redraws */
  c.fillColor(BG);
  c.fillRect(0, 0, S, S);
  c.fillColor(INK);
  for (var k = 0; k < N; k++) {
    c.fillRect(Math.round(px[k] - R), Math.round(py[k] - R), 2 * R + 1, 2 * R + 1);
  }
} });

publish();
start();
