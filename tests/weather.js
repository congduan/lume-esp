const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

/* Only the pure logic half runs here: the UI half needs lume bindings. */
const source = fs.readFileSync('examples/weather/app.js', 'utf8').split('/* WEATHER UI */')[0];
const ctx = vm.createContext({ console });
vm.runInContext(source, ctx, { filename: 'weather-logic.js' });
const ok = (name, fn) => { fn(); console.log('PASS weather ' + name); };

ok('WMO codes map to descriptions and icon kinds', () => {
  assert.equal(ctx.weatherOf(0).text, '晴');
  assert.equal(ctx.weatherOf(0).icon, 'sun');
  assert.equal(ctx.weatherOf(2).text, '局部多云');
  assert.equal(ctx.weatherOf(3).icon, 'cloud');
  assert.equal(ctx.weatherOf(45).icon, 'fog');
  assert.equal(ctx.weatherOf(61).icon, 'rain');
  assert.equal(ctx.weatherOf(75).icon, 'snow');
  assert.equal(ctx.weatherOf(80).text, '阵雨');
  assert.equal(ctx.weatherOf(95).icon, 'storm');
  assert.equal(ctx.weatherOf(999).text, '未知');
});

ok('formatters degrade to -- instead of NaN', () => {
  assert.equal(ctx.fmtTemp(8.4), '8°');
  assert.equal(ctx.fmtTemp(-0.4), '0°');
  assert.equal(ctx.fmtTemp(null), '--');
  assert.equal(ctx.fmtTemp(NaN), '--');
  assert.equal(ctx.fmtWind(9.44), '9.4 km/h');
  assert.equal(ctx.fmtWind(undefined), '--');
  assert.equal(ctx.fmtHumidity(46.6), '47%');
  assert.equal(ctx.fmtHumidity('x'), '--');
});

ok('weekDay parses the ISO date in UTC', () => {
  assert.equal(ctx.weekDay('2026-11-15'), '周日');
  assert.equal(ctx.weekDay('2026-11-16'), '周一');
  assert.equal(ctx.weekDay('2026-11-21'), '周六');
  assert.equal(ctx.weekDay('not-a-date'), '--');
});

const BODY = JSON.stringify({
  current: {
    temperature_2m: 8.4, relative_humidity_2m: 52.4, apparent_temperature: 6.1,
    weather_code: 3, wind_speed_10m: 11.25,
  },
  daily: {
    time: ['2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18'],
    weather_code: [3, 61, 0, 2],
    temperature_2m_max: [12.1, 9.9, 15.4, 14.0],
    temperature_2m_min: [2.0, 1.5, 3.2, 4.4],
  },
});

ok('parseForecast keeps current values and caps the forecast at three days', () => {
  const f = ctx.parseForecast(BODY);
  assert.equal(f.temp, 8.4);
  assert.equal(f.feels, 6.1);
  assert.equal(f.humidity, 52.4);
  assert.equal(f.wind, 11.25);
  assert.equal(f.code, 3);
  assert.equal(f.days.length, 3);
  assert.equal(f.days[0].label, '周日');
  assert.equal(f.days[0].hi, 12.1);
  assert.equal(f.days[0].lo, 2.0);
  assert.equal(f.days[1].code, 61);
});

ok('parseForecast rejects bodies it cannot use', () => {
  assert.equal(ctx.parseForecast('not json'), null);
  assert.equal(ctx.parseForecast('{}'), null);
  assert.equal(ctx.parseForecast('{"current":{}}'), null);
  assert.equal(ctx.parseForecast('[]'), null);
  assert.equal(ctx.parseForecast('null'), null);
});

ok('parseForecast survives a missing daily block and short arrays', () => {
  const onlyCurrent = ctx.parseForecast('{"current":{"temperature_2m":5}}');
  assert.equal(onlyCurrent.days.length, 0);
  assert.equal(onlyCurrent.humidity, null);
  assert.equal(onlyCurrent.code, -1);
  const shortDaily = ctx.parseForecast(JSON.stringify({
    current: { temperature_2m: 5 },
    daily: { time: ['2026-11-15'], weather_code: [0], temperature_2m_max: [7] },
  }));
  assert.equal(shortDaily.days.length, 1);
  assert.equal(shortDaily.days[0].hi, 7);
  assert.equal(shortDaily.days[0].lo, null);
});

ok('buildUrl asks for current + daily with auto timezone', () => {
  const url = ctx.buildUrl(39.9, 116.4);
  assert.match(url, /^https:\/\/api\.open-meteo\.com\/v1\/forecast\?/);
  assert.match(url, /latitude=39\.9&longitude=116\.4/);
  assert.match(url, /current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m/);
  assert.match(url, /daily=weather_code,temperature_2m_max,temperature_2m_min/);
  assert.match(url, /forecast_days=3/);
  assert.match(url, /timezone=auto/);
});

ok('parseCity validates the Kv JSON', () => {
  const c = ctx.parseCity('{"name":"上海","lat":31.23,"lon":121.47}');
  assert.equal(c.name, '上海');
  assert.equal(c.lat, 31.23);
  assert.equal(c.lon, 121.47);
  const bare = ctx.parseCity('{"lat":1,"lon":2}');
  assert.equal(bare.name, '当前位置');
  assert.equal(bare.lat, 1);
  assert.equal(bare.lon, 2);
  assert.equal(ctx.parseCity('oops'), null);
  assert.equal(ctx.parseCity('{"name":"x"}'), null);
  assert.equal(ctx.parseCity(''), null);
  assert.equal(ctx.parseCity(null), null);
});

ok('dayAt falls back for out-of-range indexes', () => {
  const d = ctx.dayAt(ctx.DEMO, 0);
  assert.equal(d.label, '今天');
  assert.equal(ctx.dayAt(ctx.DEMO, 9).label, '--');
  assert.equal(ctx.dayAt(null, 0).code, -1);
});

function recorder() {
  const calls = { clear: 0, circle: 0, line: 0, fillRect: 0, polyline: 0, fillColor: 0 };
  return {
    calls,
    clear() { calls.clear++; },
    circle() { calls.circle++; },
    line() { calls.line++; },
    fillRect() { calls.fillRect++; },
    polyline() { calls.polyline++; },
    fillColor() { calls.fillColor++; },
  };
}

ok('icons issue the expected raster commands and repaint the whole canvas', () => {
  const sun = recorder();
  const sunRect = ctx.drawWeatherIcon(sun, 'sun', 112);
  assert.equal(sun.calls.clear, 1);
  assert.equal(sun.calls.circle, 1);
  assert.equal(sun.calls.line, 8);
  assert.deepEqual({ ...sunRect }, { x: 0, y: 0, w: 112, h: 112 });

  const rain = recorder();
  ctx.drawWeatherIcon(rain, 'rain', 112);
  assert.equal(rain.calls.circle, 3, 'cloud is three circles');
  assert.equal(rain.calls.line, 3, 'three rain streaks');
  assert.equal(rain.calls.fillRect, 1, 'cloud base');

  const storm = recorder();
  ctx.drawWeatherIcon(storm, 'storm', 112);
  assert.equal(storm.calls.polyline, 1);

  const unknown = recorder();
  ctx.drawWeatherIcon(unknown, 'nope', 112);
  assert.equal(unknown.calls.circle, 3, 'unknown kind still draws a cloud');
});

console.log('PASS 10 weather logic cases');

/* ---- UI pass: run the real app on the firmware prelude with a fake radio ---- */
const { runApp } = require('./lib/prelude_runner');
const appScript = fs.readFileSync('examples/weather/app.js', 'utf8');

/* Latest text per node: later attr writes overwrite earlier ones. */
function screenText(app) {
  const latest = new Map();
  for (const m of app.messages) if (m[0] === 'attr' && m[2] === 0) latest.set(m[1], m[3]);
  return [...latest.values()];
}
function pressId(app) {
  const hit = app.messages.find(m => m[0] === 'press');
  assert.ok(hit, 'the app registers a refresh press event');
  return hit[1];
}
function uiApp(net) {
  const app = runApp(appScript, {
    kv: { get: k => (k === 'wifi_ssid' ? 'home' : k === 'wifi_pass' ? 'secret123' : null), set: () => 0 },
    net: { status: () => ({ state: 3, ip: '10.0.0.5' }), ...net },
  });
  /* The host prelude has no native timer queue, so the deferred fetch never
   * runs there. Execute it inline instead of waiting on a real clock. */
  app.ctx.lume.system.setTimeout = fn => { fn(); return 0; };
  return app;
}
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  /* Happy path: the demo numbers are replaced by the response. */
  const urls = [];
  const good = uiApp({
    httpGet: url => { urls.push(url); return { status: 200, body: BODY, contentLength: BODY.length, truncated: false }; },
  });
  let texts = screenText(good);
  assert.ok(texts.includes('北京'), 'default city is rendered');
  assert.ok(texts.includes('18°'), 'demo temperature before the first fetch');

  good.press(pressId(good));
  await wait(40);
  texts = screenText(good);
  assert.equal(urls.length, 1, 'one request per press');
  assert.match(urls[0], /latitude=39\.9&longitude=116\.4/);
  assert.ok(texts.includes('8°'), 'temperature comes from current.temperature_2m');
  assert.ok(texts.includes('阴'), 'weather_code 3 renders as 阴');
  assert.ok(texts.includes('52%'), 'humidity is rounded');
  assert.ok(texts.includes('11.3 km/h'), 'wind is rounded to one decimal');
  assert.ok(texts.includes('体感 6°'), 'apparent temperature is shown');
  assert.ok(texts.some(t => String(t).indexOf('已更新') === 0), 'status flips to 已更新');
  console.log('PASS weather refresh replaces the demo data');

  /* Failure path: a negative code falls back to the demo set and says why. */
  const bad = uiApp({ httpGet: () => -2 });
  bad.press(pressId(bad));
  await wait(40);
  texts = screenText(bad);
  assert.ok(texts.some(t => String(t).indexOf('请求失败 -2') === 0), 'negative code is surfaced');
  assert.ok(texts.some(t => String(t).indexOf('TLS') >= 0), 'the -2 hint mentions clock/TLS');
  assert.ok(texts.includes('18°'), 'demo data is restored after a failure');
  console.log('PASS weather request failure keeps the app usable');

  /* A non-200 response is a failure too, not a parse attempt. */
  const http500 = uiApp({ httpGet: () => ({ status: 500, body: BODY, contentLength: BODY.length, truncated: false }) });
  http500.press(pressId(http500));
  await wait(40);
  assert.ok(screenText(http500).some(t => String(t).indexOf('HTTP 500') === 0), 'HTTP status is shown');
  console.log('PASS weather non-200 response is reported');

  console.log('PASS 13 weather cases (10 logic + 3 UI)');
})().then(
  () => process.exit(0),
  e => { console.error(e); process.exit(1); },
);

