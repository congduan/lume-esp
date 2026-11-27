/**
 * 示例：天气（examples/weather）
 *
 * 数据源：Open-Meteo 免费接口，无需 API key。
 *   https://api.open-meteo.com/v1/forecast?latitude=..&longitude=..&current=..&daily=..
 *
 * r205 圆屏布局（翻译自 artifacts/r205/design/weather.html）：
 *   480×480 圆形 AMOLED 表盘，全部交互与核心文案严守 [75, 405] 安全区：
 *   - 顶栏：城市位置图标 + 城市名 + 友好化离线胶囊（cloud-off SVG + 演示数据）+ 48×48 圆形刷新键
 *   - 径向主视觉：无黑底精绘天气图标（分层太阳光晕/立体云层）+ 44px 居中温度 + 天气状态与当日范围
 *   - 三指标胶囊：体感 / 湿度 / 风速（带独立语义图标，消除与三日预报「今天」重复）
 *   - 三日预报卡：今天 / 明天 / 后天，配迷你天气图标与温度范围条
 *
 * 前置条件（NVS，用 lume deploy 之前通过 kv 写入）：
 *   wifi_ssid / wifi_pass     —— 与 examples/ai_chat 相同的约定
 *   weather.city              —— 可选，JSON：{"name":"上海","lat":31.23,"lon":121.47}
 *   weather.insecure          —— 可选，true/1 时跳过 TLS 证书校验（见下方说明）
 *
 * TLS / 校时：固件用 ESP-IDF 证书 bundle 校验服务器证书，证书有效期依赖系统时钟。
 * r131 起刷新走 SNTP-first：墙钟未设置（time() < 2026-01-01）时先 lume.system.setTimeNtp()
 * 校时，成功才发 verified HTTPS；校时失败则不发请求、保留演示数据（失败 60s 内不重试）。
 * weather.insecure=1 是在无 SNTP 可达环境下的受控逃生口：跳过校时门控与证书校验，
 * 行为与旧版一致，但安全性下降，不作为推荐做法。
 * 另外 setTimeNtp() / httpGet() 都是同步阻塞调用，执行期间触摸与热重载会被卡住
 * （固件已知限制）。
 */

/* ---- 天气码 / 解析 / 格式化：纯函数，宿主 harness 直接测 ---- */

/* WMO weather code -> 中文描述 + 图标种类 */
function weatherOf(code) {
  if (code === 0) return { text: '晴', icon: 'sun' };
  if (code === 1) return { text: '基本晴', icon: 'sun' };
  if (code === 2) return { text: '局部多云', icon: 'partly' };
  if (code === 3) return { text: '阴', icon: 'cloud' };
  if (code === 45 || code === 48) return { text: '雾', icon: 'fog' };
  if (code >= 51 && code <= 57) return { text: '毛毛雨', icon: 'rain' };
  if (code >= 61 && code <= 67) return { text: '雨', icon: 'rain' };
  if (code >= 71 && code <= 77) return { text: '雪', icon: 'snow' };
  if (code >= 80 && code <= 82) return { text: '阵雨', icon: 'rain' };
  if (code === 85 || code === 86) return { text: '阵雪', icon: 'snow' };
  if (code >= 95 && code <= 99) return { text: '雷暴', icon: 'storm' };
  return { text: '未知', icon: 'cloud' };
}

function fmtTemp(v) {
  if (typeof v !== 'number' || !isFinite(v)) return '--';
  return Math.round(v) + '°';
}

function fmtWind(v) {
  if (typeof v !== 'number' || !isFinite(v)) return '--';
  return (Math.round(v * 10) / 10) + ' km/h';
}

function fmtHumidity(v) {
  if (typeof v !== 'number' || !isFinite(v)) return '--';
  return Math.round(v) + '%';
}

/* '2026-11-15' -> '周日'。用 UTC 解析，避免设备时区/时钟错误影响星期。 */
function weekDay(iso) {
  var d = new Date(String(iso) + 'T00:00:00Z');
  if (isNaN(d.getTime())) return '--';
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getUTCDay()];
}

/* Open-Meteo 响应 -> 视图模型；结构不符返回 null 而不是抛异常。 */
function parseForecast(text) {
  var raw;
  try { raw = JSON.parse(text); } catch (e) { return null; }
  if (!raw || typeof raw !== 'object') return null;
  var cur = raw.current;
  if (!cur || typeof cur.temperature_2m !== 'number') return null;
  var out = {
    temp: cur.temperature_2m,
    feels: typeof cur.apparent_temperature === 'number' ? cur.apparent_temperature : null,
    humidity: typeof cur.relative_humidity_2m === 'number' ? cur.relative_humidity_2m : null,
    wind: typeof cur.wind_speed_10m === 'number' ? cur.wind_speed_10m : null,
    code: typeof cur.weather_code === 'number' ? cur.weather_code : -1,
    days: [],
  };
  var daily = raw.daily;
  if (daily && Array.isArray(daily.time) && Array.isArray(daily.temperature_2m_max)) {
    for (var i = 0; i < daily.time.length && out.days.length < 3; i++) {
      var hi = daily.temperature_2m_max[i];
      if (typeof hi !== 'number') continue;
      var lo = Array.isArray(daily.temperature_2m_min) ? daily.temperature_2m_min[i] : null;
      out.days.push({
        label: weekDay(daily.time[i]),
        code: Array.isArray(daily.weather_code) ? daily.weather_code[i] : -1,
        hi: hi,
        lo: typeof lo === 'number' ? lo : null,
      });
    }
  }
  return out;
}

function buildUrl(lat, lon) {
  return 'https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon +
    '&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min&forecast_days=3&timezone=auto';
}

/* Kv 里存的城市 JSON；缺字段就回退到默认城市。 */
function parseCity(text) {
  if (typeof text !== 'string' || text === '') return null;
  var c;
  try { c = JSON.parse(text); } catch (e) { return null; }
  if (!c || typeof c !== 'object') return null;
  if (typeof c.lat !== 'number' || !isFinite(c.lat)) return null;
  if (typeof c.lon !== 'number' || !isFinite(c.lon)) return null;
  return { name: typeof c.name === 'string' && c.name ? c.name : '当前位置', lat: c.lat, lon: c.lon };
}

function dayAt(data, index) {
  if (data && Array.isArray(data.days) && data.days[index]) return data.days[index];
  return { label: '--', code: -1, hi: null, lo: null };
}

/* 离线/未联网时的占位数据，让界面和截图不依赖网络。 */
var DEMO = {
  temp: 18,
  feels: 16,
  humidity: 46,
  wind: 9.4,
  code: 2,
  days: [
    { label: '今天', code: 2, hi: 21, lo: 9 },
    { label: '明天', code: 61, hi: 17, lo: 8 },
    { label: '后天', code: 0, hi: 22, lo: 10 },
  ],
};

/* ---- 精绘天气图标：与表盘底色无缝融合（无黑方块底），分层光晕 + 立体云 ---- */
function drawWeatherIcon(ctx, kind, size, bgCol) {
  var S = size || 84;
  var sc = S / 84;
  var bg = bgCol || '#0A1320';
  var sunOuter = '#FFA93A', sunCore = '#FFD78E', sunHi = '#FFF0BF';
  var cloudShadow = '#0B1522', cloudBase = '#8FA7BE', cloudMid = '#C6D8E8', cloudTop = '#F2F7FB';
  var rainCol = '#5B9DF7', snowCol = '#E8F4FF', boltCol = '#FFD78E';

  ctx.clear();
  ctx.fillColor(bg);
  ctx.fillRect(0, 0, S, S);

  function dot(x, y, r, col) {
    var cx = Math.round(x * sc), cy = Math.round(y * sc), rr = Math.max(1, Math.round(r * sc));
    if (typeof ctx.fillCircle === 'function') ctx.fillCircle(cx, cy, rr, col);
    else ctx.circle(cx, cy, rr, col);
  }
  function seg(x1, y1, x2, y2, col, w) {
    ctx.line(Math.round(x1 * sc), Math.round(y1 * sc), Math.round(x2 * sc), Math.round(y2 * sc), col, Math.max(1, Math.round((w || 2) * sc)));
  }
  function drawSun(ox, oy, r, halo) {
    if (halo) {
      dot(ox, oy, r * 1.9, '#1A1C1E');
      dot(ox, oy, r * 1.45, '#312A20');
    }
    for (var i = 0; i < 8; i++) {
      var a = i * Math.PI / 4;
      seg(ox + Math.cos(a) * (r + 3), oy + Math.sin(a) * (r + 3),
          ox + Math.cos(a) * (r + 7.5), oy + Math.sin(a) * (r + 7.5), '#FFD278', 2.2);
    }
    dot(ox, oy, r, sunOuter);
    dot(ox - 1, oy - 1, r * 0.78, sunCore);
    dot(ox - r * 0.25, oy - r * 0.25, r * 0.34, sunHi);
  }
  function drawCloud(ox, oy, r) {
    /* Subtle dark drop shadow beneath cloud */
    dot(ox - r * 0.85, oy + 4, r * 0.65, cloudShadow);
    dot(ox + r * 0.9, oy + 4, r * 0.62, cloudShadow);
    ctx.fillColor(cloudShadow);
    ctx.fillRect(Math.round((ox - r * 0.9) * sc), Math.round((oy + 2) * sc), Math.round(r * 1.8 * sc), Math.round(r * 0.68 * sc));

    /* Cool lower base layer */
    dot(ox - r * 0.85, oy + 1, r * 0.68, cloudBase);
    dot(ox, oy - r * 0.3, r * 0.96, cloudBase);
    dot(ox + r * 0.9, oy + 1, r * 0.64, cloudBase);
    ctx.fillColor(cloudBase);
    ctx.fillRect(Math.round((ox - r * 0.88) * sc), Math.round((oy + 1) * sc), Math.round(r * 1.78 * sc), Math.round(r * 0.68 * sc));

    /* Mid luminous cloud body */
    dot(ox - r * 0.82, oy - 1, r * 0.62, cloudMid);
    dot(ox - 1, oy - r * 0.36, r * 0.88, cloudMid);
    dot(ox + r * 0.84, oy - 1, r * 0.58, cloudMid);
    ctx.fillColor(cloudMid);
    ctx.fillRect(Math.round((ox - r * 0.82) * sc), Math.round((oy - 1) * sc), Math.round(r * 1.66 * sc), Math.round(r * 0.56 * sc));

    /* Top specular highlight puff */
    dot(ox - 2, oy - r * 0.5, r * 0.62, cloudTop);
    dot(ox - r * 0.72, oy - 3, r * 0.36, cloudTop);
  }
  function drawDrops(oy, isSnow) {
    for (var i = 0; i < 3; i++) {
      var x = 28 + i * 14;
      if (isSnow) dot(x, oy + 4, 2.6, snowCol);
      else seg(x, oy, x - 3.5, oy + 11, rainCol, 2.2);
    }
  }

  if (kind === 'sun') {
    drawSun(42, 42, 16, S >= 48);
  } else if (kind === 'partly') {
    drawSun(53, 28, 12.5, S >= 48);
    drawCloud(37, 50, 18);
  } else if (kind === 'cloud') {
    drawCloud(42, 46, 20);
  } else if (kind === 'fog') {
    drawCloud(42, 36, 17);
    seg(18, 58, 66, 58, '#9EB3C6', 2.4);
    seg(24, 65, 60, 65, '#6C849B', 2.4);
  } else if (kind === 'rain') {
    drawCloud(42, 36, 17);
    drawDrops(56, false);
  } else if (kind === 'snow') {
    drawCloud(42, 36, 17);
    drawDrops(56, true);
  } else if (kind === 'storm') {
    drawCloud(42, 34, 17);
    ctx.polyline([
      [Math.round(44 * sc), Math.round(50 * sc)],
      [Math.round(36 * sc), Math.round(62 * sc)],
      [Math.round(44 * sc), Math.round(62 * sc)],
      [Math.round(38 * sc), Math.round(74 * sc)]
    ], boltCol, Math.max(2, Math.round(2.6 * sc)));
  } else {
    drawCloud(42, 44, 18);
  }
  return { x: 0, y: 0, w: S, h: S };
}

/* WEATHER UI */

var weatherTheme = {
  colors: {
    bg: '#000000', primary: '#0A1320', surface: '#16202E', surfaceAlt: '#1F2C3D',
    text: '#F2F7FB', textDim: '#9EB3C6', accent: '#40D8B0', danger: '#FF6B79', success: '#40D8B0',
  },
  radius: 12, spacing: 8, fontScale: 1,
};
lume.theme.set(weatherTheme);

var city = parseCity(lume.storage.kv.get('weather.city')) ||
  { name: '北京', lat: 39.90, lon: 116.40 };
var insecure = lume.storage.kv.get('weather.insecure');
var skipTls = insecure === true || insecure === 1 || insecure === '1';

var data = signal(DEMO);
var status = signal('演示数据');
var online = signal(false);
var busy = signal(false);

function fetchForecast(url) {
  if (skipTls) return lume.net.httpRequest({ url: url, method: 'GET', httpsInsecure: true, timeoutMs: 8000 });
  return lume.net.httpGet(url, { timeoutMs: 8000 });
}

function netReady() {
  var st = lume.net.status();
  return typeof st === 'object' && st !== null && st.state === lume.net.GOT_IP;
}

/* r131: 冷启动 RTC 未同步时 time() 返回 1970 基点的小数值；早于 2026-01-01 视为未设置。 */
var WEATHER_CLOCK_MIN_MS = 1767225600000; /* Date.parse('2026-01-01T00:00:00Z') */
var WEATHER_SYNC_RETRY_MS = 60000;        /* 校时失败后 60s 内不重复尝试，避免连点卡引擎 */
var lastSyncFailMs = 0;                   /* 域：lume._nowMs()；上次校时失败节拍 */

function refresh() {
  if (busy()) return;
  if (!netReady()) {
    online.set(false);
    status.set('演示数据');
    data.set(DEMO);
    return;
  }
  busy.set(true);
  status.set('正在获取…');
  /* 先让 loading 文案落地，再进入同步 setTimeNtp/httpGet（都会阻塞引擎）；
   * 两段同步同处这一次 setTimeout 回调，顺序执行，不拆成两次阻塞段。 */
  lume.system.setTimeout(function () {
    /* ---- r131: SNTP-first BEGIN ---- */
    /* insecure 是显式逃生口：直接发请求，不走校时门控，行为不变。 */
    var sys = lume.system;
    if (!skipTls && sys && typeof sys.time === 'function' &&
        sys.time() < WEATHER_CLOCK_MIN_MS) {
      /* 墙钟未设置：先校时；节流窗口内不重试（setTimeNtp 是 BLOCKING 的）。 */
      if (lume._nowMs() - lastSyncFailMs < WEATHER_SYNC_RETRY_MS) {
        busy.set(false);
        online.set(false);
        data.set(DEMO);
        status.set('校时失败，稍后重试');
        return;
      }
      var r = -2;
      if (typeof sys.setTimeNtp === 'function') {
        try { r = sys.setTimeNtp(); } catch (e) { r = -2; }
      }
      if (r !== 0) {
        lastSyncFailMs = lume._nowMs();
        busy.set(false);
        online.set(false);
        data.set(DEMO);
        /* 短文案带 ASCII 返回码，value 不伪造：校时失败就不发 HTTPS。 */
        status.set('校时失败 ' + r + '，未发 HTTPS');
        return;
      }
    }
    /* ---- r131: SNTP-first END ---- */
    var res = fetchForecast(buildUrl(city.lat, city.lon));
    busy.set(false);
    if (typeof res === 'number') {
      online.set(false);
      data.set(DEMO);
      /* 短文案：header 只有一行，长提示会被省略号截断（insecure 开关见文件头）。
       * r131：校时失败已在上面拦截并单独提示；走到这里的 -2 是传输/TLS 问题。 */
      status.set('请求失败 ' + res + (res === -2 && !skipTls ? ' · TLS 传输问题' : ''));
      return;
    }
    if (res.status !== 200) {
      online.set(false);
      data.set(DEMO);
      status.set('HTTP ' + res.status + '，显示演示数据');
      return;
    }
    var parsed = parseForecast(res.body);
    if (!parsed) {
      online.set(false);
      data.set(DEMO);
      status.set('数据无法解析，显示演示数据');
      return;
    }
    online.set(true);
    data.set(parsed);
    status.set('已更新 ' + (skipTls ? '（未校验证书）' : ''));
  }, 0);
}

function headerLine() {
  return status();
}

function heroIcon(ctx) {
  return drawWeatherIcon(ctx, weatherOf(data().code).icon, 84, '#0A1320');
}

/* ---- Inline SVG icons (compatible with both browser & firmware lume-svg) -- */
function wSvgBytes(svg) {
  var b = new Uint8Array(svg.length);
  for (var i = 0; i < svg.length; i++) b[i] = svg.charCodeAt(i);
  return b.buffer;
}
function wSvgNode(bytes, w, h, extra) {
  var style = { width: w, height: h };
  if (extra) { for (var k in extra) style[k] = extra[k]; }
  return Image({ src: bytes, style: style });
}

var SVG_PIN = wSvgBytes(
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24">' +
  '<path d="M12 21s-6.5-5.6-6.5-11A6.5 6.5 0 1 1 18.5 10c0 5.4-6.5 11-6.5 11z" fill="none" stroke="#40D8B0" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>' +
  '<circle cx="12" cy="10" r="2.2" fill="#40D8B0"/>' +
  '</svg>'
);
var SVG_CLOUD_OFF = wSvgBytes(
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24">' +
  '<path d="M20 17.6A4.5 4.5 0 0 0 18 9h-1.26A7 7 0 0 0 9.6 4.8" fill="none" stroke="#9EB3C6" stroke-width="2" stroke-linecap="round"/>' +
  '<path d="M6.5 7.5A5.5 5.5 0 0 0 6 18h10" fill="none" stroke="#9EB3C6" stroke-width="2" stroke-linecap="round"/>' +
  '<line x1="3" y1="3" x2="21" y2="21" stroke="#9EB3C6" stroke-width="2" stroke-linecap="round"/>' +
  '</svg>'
);
var SVG_REFRESH = wSvgBytes(
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24">' +
  '<path d="M21 12a9 9 0 1 1-2.64-6.36" fill="none" stroke="#40D8B0" stroke-width="2.2" stroke-linecap="round"/>' +
  '<polyline points="21,3 21,9 15,9" fill="none" stroke="#40D8B0" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>' +
  '</svg>'
);
var SVG_THERMO = wSvgBytes(
  '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24">' +
  '<path d="M14 14.76V5a2 2 0 1 0-4 0v9.76a4 4 0 1 0 4 0z" fill="none" stroke="#FFD78E" stroke-width="2.2" stroke-linecap="round"/>' +
  '<circle cx="12" cy="17.5" r="2" fill="#FFD78E"/>' +
  '</svg>'
);
var SVG_DROP = wSvgBytes(
  '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24">' +
  '<path d="M12 2.7l5.6 6.8a7 7 0 1 1-11.2 0L12 2.7z" fill="none" stroke="#5B9DF7" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>' +
  '</svg>'
);
var SVG_WIND = wSvgBytes(
  '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24">' +
  '<path d="M4 10h11a3 3 0 1 0-3-3" fill="none" stroke="#40D8B0" stroke-width="2.2" stroke-linecap="round"/>' +
  '<path d="M4 15h14a2.5 2.5 0 1 1-2.5 2.5" fill="none" stroke="#40D8B0" stroke-width="2.2" stroke-linecap="round"/>' +
  '</svg>'
);

function metricPill(x, svgBytes, label, valueOf) {
  var topKids = [];
  var ic = wSvgNode(svgBytes, 13, 13);
  if (ic > 0) topKids.push(ic);
  topKids.push(Text({ text: label, style: { fontSize: 12, color: 'textDim', borderRadius: 0 } }));
  return View({
    style: {
      position: 'absolute', x: x, y: 222, width: 100, height: 54,
      background: '#16202E', borderRadius: 12, borderWidth: 1, borderColor: '#253548',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4,
      scroll: 'none',
    },
  }, [
    View({ style: { display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 4, scroll: 'none' } }, topKids),
    Text({
      text: valueOf,
      style: { width: 96, height: 20, fontSize: 15, color: 'text', textAlign: 'center', borderRadius: 0 },
    }),
  ]);
}

function dayRow(index) {
  var top = 6 + index * 34;
  return View({
    style: {
      position: 'absolute', x: 10, y: top, width: 296, height: 32,
      borderColor: index > 0 ? '#1E2E40' : '#15202E', borderWidth: 0, scroll: 'none',
    },
  }, [
    Text({
      text: function () { return dayAt(data(), index).label; },
      style: { position: 'absolute', x: 0, y: 6, width: 42, height: 20, fontSize: 13, color: 'textDim', textAlign: 'left', borderRadius: 0 },
    }),
    Canvas({
      width: 24, height: 24,
      style: { position: 'absolute', x: 44, y: 4 },
      onDraw: function (ctx) {
        return drawWeatherIcon(ctx, weatherOf(dayAt(data(), index).code).icon, 24, '#141E2B');
      },
    }),
    Text({
      text: function () { return weatherOf(dayAt(data(), index).code).text; },
      style: { position: 'absolute', x: 74, y: 6, width: 68, height: 20, fontSize: 13, color: 'text', textAlign: 'left', borderRadius: 0 },
    }),
    /* Mini temperature range track + bar */
    View({
      style: {
        position: 'absolute', x: 146, y: 13, width: 62, height: 6,
        background: '#1F2C3D', borderRadius: 3, scroll: 'none',
      },
    }, [
      View({
        style: {
          position: 'absolute',
          x: function () {
            var d = dayAt(data(), index);
            var lo = typeof d.lo === 'number' ? d.lo : 8;
            return Math.max(0, Math.min(36, Math.round((lo - 4) * 2)));
          },
          y: 0,
          width: function () {
            var d = dayAt(data(), index);
            var lo = typeof d.lo === 'number' ? d.lo : 8;
            var hi = typeof d.hi === 'number' ? d.hi : 20;
            return Math.max(14, Math.min(54, Math.round((hi - lo) * 2.8)));
          },
          height: 6, background: '#40D8B0', borderRadius: 3, scroll: 'none',
        },
      }),
    ]),
    Text({
      text: function () {
        var d = dayAt(data(), index);
        return fmtTemp(d.lo) + ' / ' + fmtTemp(d.hi);
      },
      style: { position: 'absolute', x: 214, y: 6, width: 82, height: 20, fontSize: 13, color: 'text', textAlign: 'right', borderRadius: 0 },
    }),
  ]);
}

var cityRowKids = [];
var pinIcon = wSvgNode(SVG_PIN, 14, 14);
if (pinIcon > 0) cityRowKids.push(pinIcon);
cityRowKids.push(Text({
  text: function () { return city.name; },
  style: { fontSize: 20, color: 'text', borderRadius: 0, longMode: 'dots' },
}));

var offlinePillKids = [];
var cloudOffIcon = wSvgNode(SVG_CLOUD_OFF, 14, 14, { position: 'absolute', x: 8, y: 4 });
if (cloudOffIcon > 0) offlinePillKids.push(cloudOffIcon);
offlinePillKids.push(Text({
  text: headerLine,
  style: { position: 'absolute', x: 26, y: 3, width: 140, height: 18, fontSize: 12, color: function () { return online() ? '#40D8B0' : '#9EB3C6'; }, borderRadius: 0, longMode: 'dots' },
}));

var refreshBtnKids = [];
var refreshIcon = wSvgNode(SVG_REFRESH, 20, 20);
if (refreshIcon > 0) refreshBtnKids.push(refreshIcon);
else refreshBtnKids.push(Text({ text: function () { return busy() ? '...' : 'R'; }, style: { fontSize: 16, color: '#40D8B0' } }));

var root = View({
  style: { width: 480, height: 480, background: 'bg', scroll: 'none' },
}, [
  /* Circular AMOLED dial bezel */
  View({
    style: {
      position: 'absolute', x: 14, y: 14, width: 452, height: 452,
      borderRadius: 226, background: '#0A1320', borderWidth: 1, borderColor: '#23364A',
      scroll: 'none',
    },
  }),

  /* Top header strictly inside [75, 405]: city + friendly cloud-off demo pill + 48x48 circular refresh */
  View({
    style: {
      position: 'absolute', x: 82, y: 78, width: 220, height: 24,
      display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6, scroll: 'none',
    },
  }, cityRowKids),

  View({
    style: {
      position: 'absolute', x: 82, y: 104, width: 102, height: 22,
      borderRadius: 11,
      background: '#15202E', borderWidth: 1, borderColor: '#26364A', scroll: 'none',
    },
  }, offlinePillKids),

  View({
    onPress: refresh,
    style: {
      position: 'absolute', x: 350, y: 78, width: 48, height: 48,
      borderRadius: 24, background: '#142B32', borderWidth: 1, borderColor: '#318D7A',
      display: 'flex', alignItems: 'center', justifyContent: 'center', scroll: 'none',
    },
  }, refreshBtnKids),

  /* Radial center hero: layered weather icon (no black box) + 44px centered temperature */
  Canvas({ width: 84, height: 84, onDraw: heroIcon, style: { position: 'absolute', x: 116, y: 130 } }),
  Text({
    text: function () { return fmtTemp(data().temp); },
    style: { position: 'absolute', x: 212, y: 132, width: 156, height: 48, fontSize: 44, color: 'text', borderRadius: 0 },
  }),
  Text({
    text: function () {
      var d = dayAt(data(), 0);
      return weatherOf(data().code).text + '  ' + fmtTemp(d.lo) + ' / ' + fmtTemp(d.hi);
    },
    style: { position: 'absolute', x: 212, y: 184, width: 176, height: 22, fontSize: 15, color: 'textDim', borderRadius: 0 },
  }),

  /* Three non-duplicate metric pills: Feels Like / Humidity / Wind */
  metricPill(82, SVG_THERMO, '体感', function () { return fmtTemp(data().feels); }),
  metricPill(190, SVG_DROP, '湿度', function () { return fmtHumidity(data().humidity); }),
  metricPill(298, SVG_WIND, '风速', function () { return fmtWind(data().wind); }),

  /* 3-day forecast card inside [75, 405] */
  View({
    style: {
      position: 'absolute', x: 82, y: 286, width: 316, height: 112,
      background: '#141E2B', borderRadius: 12, borderWidth: 1, borderColor: '#233345',
      scroll: 'none',
    },
  }, [
    dayRow(0),
    View({ style: { position: 'absolute', x: 12, y: 39, width: 292, height: 1, background: '#203042', scroll: 'none' } }),
    dayRow(1),
    View({ style: { position: 'absolute', x: 12, y: 73, width: 292, height: 1, background: '#203042', scroll: 'none' } }),
    dayRow(2),
  ]),
]);

/* WiFi：与 examples/ai_chat 相同的约定，凭据放 NVS。 */
var ssid = lume.storage.kv.get('wifi_ssid');
var password = lume.storage.kv.get('wifi_pass');
if (typeof ssid === 'string' && ssid && typeof password === 'string') {
  lume.net.init();
  lume.net.connect(ssid, password);
  status.set('正在连接 WiFi…');
}

/* 轮询到有 IP 就抓一次；成功或超时后停止轮询，交给刷新按钮。 */
var tries = 0;
var poll = lume.system.setInterval(function () {
  tries += 1;
  if (netReady()) {
    lume.system.clearInterval(poll);
    refresh();
    return;
  }
  if (tries >= 8) {
    lume.system.clearInterval(poll);
    status.set('演示数据');
  }
}, 1500);

/* 首帧先画出来，再让联网结果覆盖；onResume 时补一次刷新。 */
lume.system.setTimeout(refresh, 600);
lume.app.onResume(refresh);
void root;
