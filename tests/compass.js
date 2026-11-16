/* Host harness for examples/compass — runs the app against the firmware prelude.
 * Standalone CommonJS script; run: node tests/compass.js
 * Honesty scope: demo mode needs no IMU; IMU mode is a RELATIVE estimate only. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { runApp } = require('./lib/prelude_runner');

const source = fs.readFileSync('examples/compass/app.js', 'utf8');
const logs = [];
const ui = runApp(source, { onLog: s => logs.push(s) });
const c = ui.ctx;

/* 1. angle wraps into [0,360) */
assert.equal(c.headingWrap(0), 0);
assert.equal(c.headingWrap(-10), 350);
assert.equal(c.headingWrap(370), 10);
assert.equal(c.headingWrap(720 + 45), 45);
assert.equal(c.headingWrap(-725), 355);
console.log('PASS compass heading wraps 0-360');

/* 2. demo angular speed is 18 deg/s */
assert.equal(c.DEMO_DPS, 18);
assert.equal(c.demoHeading(0), 0);
assert.equal(c.demoHeading(1000), 18);
assert.equal(c.demoHeading(5000), 90);
console.log('PASS compass demo mode angular speed (18 deg/s)');

/* 3. gyro Z integration is signed, wrapped, dt-scaled */
assert.equal(c.integrateHeading(350, 20, 1000), 10);
assert.equal(c.integrateHeading(0, -10, 2000), 340);
assert.equal(c.integrateHeading(0, 30, 50), 1.5);
console.log('PASS compass gyro-Z integration wraps and scales by dt');

/* 4. static ring geometry: 36 integer segments within canvas, replayed from C */
const segs = c.compassSegments();
assert.equal(segs.length, 36);
assert.ok(segs.every(s => s.length === 4 && s.every(n => Number.isInteger(n) && n >= 0 && n <= 360)));
const pathDefs = ui.messages.filter(m => m[0] === 'pathDefine');
assert.equal(pathDefs.length, 3, '2 retained ring paths + 1 retained segment path');
const segDef = pathDefs.find(m => m[2] === 3);
assert.ok(segDef && segDef[3].length / 6 >= 36, 'tick path carries 36 segments');
console.log('PASS compass retained ring: 36 segments + 2 paths uploaded once');

/* 5. DRIFT badge condition: IMU mode only, after meaningful accumulated spin */
assert.equal(c.driftBadge('demo', 100), '');
assert.equal(c.driftBadge('imu', 0), '');
assert.equal(c.driftBadge('imu', 30), '');
assert.equal(c.driftBadge('imu', 31), 'DRIFT');
assert.equal(c.driftBadge('imu', -31), 'DRIFT');
console.log('PASS compass DRIFT badge condition (IMU mode, |spin|>30deg)');

/* 6. no-IMU fallback: demo default and refuses IMU mode without a sample */
assert.equal(c.mode, 'demo');
assert.ok(logs.some(l => /^COMPASS READY mode=demo imu=absent demo_dps=18$/.test(l)), logs.join('\n'));
c.setMode('imu');
assert.equal(c.mode, 'demo', 'no IMU sample -> stay in demo');
assert.ok(logs.some(l => l.includes('COMPASS FALLBACK demo')));
console.log('PASS compass no-IMU fallback to demo (honest, no crash)');

/* 7. serial smoke format: COMPASS HDG <deg> mode=<demo|imu> */
const hdg = logs.filter(l => l.startsWith('COMPASS HDG '));
assert.ok(hdg.length > 0);
assert.ok(hdg.every(l => /^COMPASS HDG \d+ mode=(demo|imu)$/.test(l)), hdg.slice(0, 3).join('\n'));
console.log('PASS compass serial smoke: COMPASS HDG <deg> mode=<demo|imu>');

/* 8. IMU mode with injected samples integrates gz and raises DRIFT badge */
const logs2 = [];
const ui2 = runApp(source, { onLog: s => logs2.push(s),
  imu: { read: () => ({ ax: 0, ay: 0, az: 9.8, gx: 0, gy: 0, gz: 30 }) } });
const c2 = ui2.ctx;
assert.equal(c.compassMode(c2.imuRead()), 'imu');
c2.setMode('imu');
assert.equal(c2.mode, 'imu');
for (let i = 0; i < 10; i++) c2.tick();
assert.ok(Math.abs(c2.spunDeg - 15) < 1e-9, `spunDeg=${c2.spunDeg}`);
assert.equal(c2.badge(), '', 'no badge yet');
for (let i = 0; i < 20; i++) c2.tick();
assert.ok(Math.abs(c2.spunDeg - 45) < 1e-9, `spunDeg=${c2.spunDeg}`);
assert.equal(c2.badge(), 'DRIFT', 'badge after accumulated spin');
assert.ok(logs2.some(l => /^COMPASS HDG \d+ mode=imu$/.test(l)));
console.log('PASS compass IMU mode integrates gz and shows DRIFT badge');

/* 9. mode toggle returns to demo and resets offset (no absolute direction) */
c2.setMode('demo');
assert.equal(c2.mode, 'demo');
assert.equal(c2.badge(), '');
assert.ok(logs2.some(l => l.includes('COMPASS MODE demo')));
console.log('PASS compass mode toggle returns to demo, badge clears');

/* 10. headline honesty: disclaimer in head comment, no north promise in UI text */
assert.ok(/NO magnetometer on this board; geographic north is\n \* NOT claimed/.test(source));
const uiTexts = ui.messages.filter(m => m[0] === 'attr' && m[2] === 0).map(m => String(m[3]));
assert.ok(uiTexts.length > 0);
assert.ok(!uiTexts.some(t => /north|magnetic|bearing|point/i.test(t)), uiTexts.join('\n'));
assert.ok(uiTexts.some(t => /no magnetometer/i.test(t)), uiTexts.join('\n'));
console.log('PASS compass honest wording: inertial/relative only, no north promise in UI');

console.log('PASS compass host harness: 10/10 assertions');
