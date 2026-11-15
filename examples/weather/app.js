/**
 * 示例：天气（examples/weather）
 *
 * 数据源：Open-Meteo 免费接口，无需 API key。
 *   https://api.open-meteo.com/v1/forecast?latitude=..&longitude=..&current=..&daily=..
 *
 * 布局：480×480 面板，24 px gutter，纵向四段
 *   header 56（城市 + 刷新按钮）/ hero 148（Canvas 图标 + 温度）/ 指标 60 / 三日预报 128
 *
 * 前置条件（NVS，用 lume deploy 之前通过 kv 写入）：
 *   wifi_ssid / wifi_pass     —— 与 examples/ai_chat 相同的约定
 *   weather.city              —— 可选，JSON：{"name":"上海","lat":31.23,"lon":121.47}
 *   weather.insecure          —— 可选，true/1 时跳过 TLS 证书校验（见下方说明）
 *
 * TLS 注意：固件用 ESP-IDF 的证书 bundle 校验服务器证书，证书有效期依赖系统时钟。
 * 没有 SNTP/设时 API，RTC 未同步时 https 请求会失败（通常返回 -2）。两种解决方式：
 *   1) 先让设备拿到正确时间（后续轮次补 SNTP），再正常刷新；
 *   2) 写 Kv weather.insecure=1 强制走 httpsInsecure 路径 —— 不校验证书，仅供受控环境。
 * 另外 httpGet() 是同步阻塞调用，请求期间触摸与热重载会被卡住（固件已知限制）。
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

/* ---- 天气图标：Canvas 逐像素绘制，纯函数，方便单独复用到别的 app ---- */
function drawWeatherIcon(ctx, kind, size) {
  var S = size || 112;
  var cx = Math.round(S / 2);
  var sun = '#FFC24B', cloud = '#9EB3C6', rain = '#5AC8FA', snow = '#E8F4FF', bolt = '#FFD166';
  ctx.clear();

  function rays(ox, oy, r) {
    for (var i = 0; i < 8; i++) {
      var a = i * Math.PI / 4;
      ctx.line(Math.round(ox + Math.cos(a) * (r + 4)), Math.round(oy + Math.sin(a) * (r + 4)),
        Math.round(ox + Math.cos(a) * (r + 12)), Math.round(oy + Math.sin(a) * (r + 12)), sun, 3);
    }
  }
  function cloudShape(ox, oy, r) {
    ctx.fillColor(cloud);
    ctx.circle(ox - r, oy, Math.round(r * 0.72), cloud);
    ctx.circle(ox, oy - Math.round(r * 0.36), r, cloud);
    ctx.circle(ox + r, oy, Math.round(r * 0.78), cloud);
    ctx.fillRect(ox - r, oy, Math.round(r * 2), Math.round(r * 0.8));
  }
  function drops(oy, n, kindColor) {
    for (var i = 0; i < n; i++) {
      var x = cx - 26 + i * 26;
      if (kindColor === 'dot') ctx.circle(x, oy, 3, snow);
      else ctx.line(x, oy, x - 5, oy + 14, kindColor, 3);
    }
  }

  if (kind === 'sun') {
    ctx.circle(cx, cx, 26, sun);
    rays(cx, cx, 26);
  } else if (kind === 'partly') {
    ctx.circle(cx + 18, cx - 18, 20, sun);
    rays(cx + 18, cx - 18, 20);
    cloudShape(cx - 6, cx + 10, 26);
  } else if (kind === 'cloud') {
    cloudShape(cx, cx - 4, 30);
  } else if (kind === 'fog') {
    cloudShape(cx, cx - 16, 28);
    for (var i = 0; i < 3; i++) ctx.line(20, cx + 22 + i * 12, S - 20 - i * 8, cx + 22 + i * 12, cloud, 4);
  } else if (kind === 'rain') {
    cloudShape(cx, cx - 14, 28);
    drops(cx + 14, 3, rain);
  } else if (kind === 'snow') {
    cloudShape(cx, cx - 14, 28);
    drops(cx + 16, 3, 'dot');
  } else if (kind === 'storm') {
    cloudShape(cx, cx - 16, 28);
    ctx.polyline([[cx + 4, cx + 10], [cx - 8, cx + 34], [cx + 6, cx + 34], [cx - 4, cx + 58]], bolt, 4);
  } else {
    cloudShape(cx, cx, 28);
  }
  return { x: 0, y: 0, w: S, h: S };
}

/* WEATHER UI */

var weatherTheme = {
  colors: {
    bg: '#07111D', primary: '#07111D', surface: '#132435', surfaceAlt: '#1C3449',
    text: '#F2F7FB', textDim: '#9EB3C6', accent: '#40D8B0', danger: '#FF6B79', success: '#40D8B0',
  },
  radius: 12, spacing: 12, fontScale: 1,
};
lume.theme.set(weatherTheme);

var city = parseCity(lume.storage.kv.get('weather.city')) ||
  { name: '北京', lat: 39.90, lon: 116.40 };
var insecure = lume.storage.kv.get('weather.insecure');
var skipTls = insecure === true || insecure === 1 || insecure === '1';

var data = signal(DEMO);
var status = signal('未联网，显示演示数据');
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

function refresh() {
  if (busy()) return;
  if (!netReady()) {
    online.set(false);
    status.set('WiFi 未连接，显示演示数据');
    data.set(DEMO);
    return;
  }
  busy.set(true);
  status.set('正在获取…');
  /* 先让 loading 文案落地，再进入同步 httpGet（它会阻塞引擎）。 */
  lume.system.setTimeout(function () {
    var res = fetchForecast(buildUrl(city.lat, city.lon));
    busy.set(false);
    if (typeof res === 'number') {
      online.set(false);
      data.set(DEMO);
      status.set('请求失败 ' + res + (res === -2 && !skipTls ? '（TLS 需先校时，可设 weather.insecure=1）' : ''));
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
  return drawWeatherIcon(ctx, weatherOf(data().code).icon, 112);
}

function metricCard(label, valueOf) {
  return View({
    style: {
      flexGrow: 1, height: 60, background: 'surfaceAlt', borderRadius: 12, padding: 8,
      display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center',
      gap: 4, scroll: 'none',
    },
  }, [
    Text({ text: label, style: { fontSize: 14, color: 'textDim' } }),
    Text({ text: valueOf, style: { fontSize: 20, color: 'text' } }),
  ]);
}

function dayRow(index) {
  return View({
    style: {
      width: '100%', height: 40, display: 'flex', flexDirection: 'row',
      alignItems: 'center', justifyContent: 'space-between', padding: 0, gap: 8,
    },
  }, [
    Text({ text: function () { return dayAt(data(), index).label; }, style: { fontSize: 14, color: 'textDim' } }),
    Text({ text: function () { return weatherOf(dayAt(data(), index).code).text; }, style: { fontSize: 14, color: 'text' } }),
    Text({
      text: function () {
        var d = dayAt(data(), index);
        return fmtTemp(d.lo) + ' / ' + fmtTemp(d.hi);
      },
      style: { fontSize: 14, color: 'text' },
    }),
  ]);
}

var root = View({
  style: {
    width: '100%', height: '100%', padding: 24, background: 'bg', scroll: 'none',
    display: 'flex', flexDirection: 'column', gap: 12,
  },
}, [
  /* header：城市 + 状态，右侧 88×56 刷新按钮（≥56 px 触摸目标） */
  View({
    style: {
      width: '100%', height: 56, display: 'flex', flexDirection: 'row',
      justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: 0,
    },
  }, [
    View({ style: { display: 'flex', flexDirection: 'column', gap: 4, padding: 0, flexGrow: 1 } }, [
      Text({ text: function () { return city.name; }, style: { fontSize: 20, color: 'text' } }),
      Text({ text: headerLine, style: { fontSize: 14, color: function () { return online() ? 'textDim' : 'danger'; } } }),
    ]),
    Button({
      title: function () { return busy() ? '…' : '刷新'; },
      style: { width: 88, height: 56, borderRadius: 28, background: 'accent' },
      onPress: refresh,
    }),
  ]),

  /* hero：Canvas 天气图标 + 温度 */
  View({
    style: {
      width: '100%', height: 148, background: 'surface', borderRadius: 20, padding: 16,
      display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 16, scroll: 'none',
    },
  }, [
    Canvas({ width: 112, height: 112, onDraw: heroIcon }),
    View({ style: { display: 'flex', flexDirection: 'column', gap: 8, padding: 0, flexGrow: 1 } }, [
      Text({ text: function () { return fmtTemp(data().temp); }, style: { fontSize: 32, color: 'text' } }),
      Text({ text: function () { return weatherOf(data().code).text; }, style: { fontSize: 20, color: 'text' } }),
      Text({ text: function () { return '体感 ' + fmtTemp(data().feels); }, style: { fontSize: 14, color: 'textDim' } }),
    ]),
  ]),

  /* 指标：湿度 / 风速 / 今日范围 */
  View({ style: { width: '100%', height: 60, display: 'flex', flexDirection: 'row', gap: 12, padding: 0 } }, [
    metricCard('湿度', function () { return fmtHumidity(data().humidity); }),
    metricCard('风速', function () { return fmtWind(data().wind); }),
    metricCard('今日', function () {
      var d = dayAt(data(), 0);
      return fmtTemp(d.lo) + '/' + fmtTemp(d.hi);
    }),
  ]),

  /* 三日预报 */
  View({ style: { width: '100%', height: 128, display: 'flex', flexDirection: 'column', gap: 4, padding: 0 } }, [
    dayRow(0), dayRow(1), dayRow(2),
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
    status.set('WiFi 未就绪，显示演示数据');
  }
}, 1500);

/* 首帧先画出来，再让联网结果覆盖；onResume 时补一次刷新。 */
lume.system.setTimeout(refresh, 600);
lume.app.onResume(refresh);
void root;
