#!/usr/bin/env node
// Record an animated GIF of a Lume app running in the browser Host Simulator.
// Usage: PLAYWRIGHT_MODULE=<path> node tools/simulator/record.js <app> [--seconds N] [--fps N] [--out file.gif]
// Requires ffmpeg on PATH for frame assembly. Output: artifacts/simulator/<app>.gif
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const root = path.resolve(__dirname, '../..');
const outDir = path.join(root, 'artifacts/simulator');
fs.mkdirSync(outDir, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const args = process.argv.slice(2);
const app = args.find(a => !a.startsWith('--'));
if (!app) { console.error('usage: record.js <app> [--seconds N] [--fps N] [--out file.gif]'); process.exit(1); }
const flag = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : dflt;
};
const seconds = flag('--seconds', 4);
const fps = flag('--fps', 10);
const out = path.resolve(root, (() => {
  const i = args.indexOf('--out');
  return i >= 0 ? args[i + 1] : path.join('artifacts/simulator', `${app}.gif`);
})());
const framesDir = path.join(outDir, `${app}-frames`);

async function server(simPath, port) {
  const child = spawn(process.execPath, ['tools/simulator/sim.js', simPath],
    { cwd: root, env: { ...process.env, LUME_SIM_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', b => output += b);
  child.stderr.on('data', b => output += b);
  for (let n = 0; n < 50; n++) {
    if (output.includes('Host Simulator http://')) return child;
    if (child.exitCode !== null) throw Error(output);
    await sleep(100);
  }
  throw Error('server timeout: ' + output);
}

(async () => {
  const port = 8765 + Math.floor(Math.random() * 100);
  const sim = await server(app.startsWith('/') ? app : `examples/${app}/app.js`, port);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 600, height: 640 }, deviceScaleFactor: 1 });
    await page.goto(`http://localhost:${port}/`);
    await page.waitForSelector('#device .lume-node', { timeout: 15000 });
    await sleep(500); // let initial layout settle

    // Accept any user interaction script, same shape as verify_mario.js.
    const scriptPath = process.env.LUME_RECORD_SCRIPT;
    if (scriptPath) {
      const runScript = require(path.resolve(scriptPath));
      await runScript({ page, sleep });
    }

    fs.rmSync(framesDir, { recursive: true, force: true });
    fs.mkdirSync(framesDir, { recursive: true });
    const interval = 1000 / fps;
    const total = Math.round(seconds * fps);
    for (let n = 0; n < total; n++) {
      await page.locator('#device').screenshot({ path: path.join(framesDir, `f${String(n).padStart(4, '0')}.png`) });
      const wait = interval - (Date.now() % interval);
      await sleep(Math.max(wait, 16));
    }

    // Two-pass palette for clean colors (default quantization dithers badly).
    const palette = path.join(framesDir, 'palette.png');
    const mk = (args) => new Promise((res, rej) => {
      const p = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
      let err = ''; p.stderr.on('data', b => err += b);
      p.on('exit', c => c === 0 ? res() : rej(Error(err.slice(-500))));
    });
    await mk(['-y', '-framerate', String(fps), '-i', path.join(framesDir, 'f%04d.png'),
      '-vf', 'palettegen=max_colors=64:stats_mode=diff', palette]);
    await mk(['-y', '-framerate', String(fps), '-i', path.join(framesDir, 'f%04d.png'), '-i', palette,
      '-lavfi', 'paletteuse=dither=none:diff_mode=rectangle', '-loop', '0', out]);
    const size = fs.statSync(out).size;
    console.log(`PASS record ${app} frames=${total} fps=${fps} -> ${path.relative(root, out)} (${(size / 1024).toFixed(0)} KiB)`);
  } finally {
    await browser.close();
    sim.kill();
  }
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
