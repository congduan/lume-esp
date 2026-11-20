/** 图片画廊。r126 起改为 Sd-first：TF 卡挂载后从 Sd 的
 * /gallery/photo.jpg、/gallery/icon.png、/gallery/alpha.png 读图；未挂载或
 * 单张读取失败（-2/-3 或抛错）逐图回退既有 Fs（LittleFS）路径。三张文件均需
 * 小于 readBinary 的 64 KiB 单次读取上限。HUD 显示 Sd.statvfs() 的容量/剩余；
 * 返回负数错误码时显示 NO CARD。
 * r85: 卡片图片先经 lume.image.decode(bytes,96,96) 解码并一步缩成缩略图，
 * 再走 Canvas.retainImage/drawImage 展示；解码不可用时回退既有 Image 直显路径。
 * 无卡时仍显示内嵌 1×1 红色 PNG，验证字节到 Image 链路。
 *
 * 每张图各自包 try/catch：某张卡图读不到只丢那一张，不拖垮整个 eval；最外层
 * 再包一层兜底，native 抛错只打日志并显示一行错误文本，不让 eval 失败回退启动器。 */
lume.system.log('gallery: eval start');
lume.system.log('gallery: typeof Fs=' + (typeof Fs) +
  ' storage.Fs=' + (typeof lume.storage.Fs) +
  ' NODE_VIEW=' + (typeof NODE_VIEW) +
  ' signal=' + (typeof signal));

/* Sd 防御式解析：无此 API（理论不可能）时 sdReady=false，读图/HUD 走原路径。 */
var sd = (lume.storage && lume.storage.Sd) || null;
var sdReady = !!(sd && typeof sd.mounted === 'function' &&
  typeof sd.readBinary === 'function' && sd.mounted() === true);
lume.system.log('gallery: Sd mounted=' + sdReady);

var galleryStatus = 'no images';

/* Sd-first 读取：挂载卡上优先 Sd.readBinary；非 ArrayBuffer（错误码 -2 IO /
 * -3 无卡）或抛错都回退 Fs.readBinary（现行为）。返回 null 表示两边都读不到。 */
function readImageBytes(path) {
  if (sdReady) {
    try {
      var cardBytes = sd.readBinary(path);
      if (cardBytes instanceof ArrayBuffer) return cardBytes;
      lume.system.log('gallery: Sd read ' + path + ' rc=' + cardBytes + ', fall back to Fs');
    } catch (e) {
      lume.system.log('gallery: Sd threw ' + path + ' ' + e + ', fall back to Fs');
    }
  }
  try {
    var fsBytes = Fs.readBinary(path);
    if (fsBytes instanceof ArrayBuffer) return fsBytes;
  } catch (e) {
    lume.system.log('gallery: Fs threw ' + path + ' ' + e);
  }
  return null;
}

function thumbnailTile(thumb) {
  /* 每个 Canvas 有独立的 1..8 精灵槽，缩略像素只上传一次；onDraw 重入时
   * 只回放 drawImage，避免每帧重复 retainImage 拷贝 PSRAM。 */
  var uploaded = false;
  return Canvas({
    width: 96,
    height: 96,
    onDraw: function (ctx) {
      if (!uploaded) {
        ctx.retainImage(1, thumb.width, thumb.height, thumb.pixels);
        uploaded = true;
      }
      ctx.drawImage(1, 0, 0);
    }
  });
}

function buildTiles() {
  var tiles = [];
  var redPng = new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,8,6,0,0,0,31,21,196,137,0,0,0,13,73,68,65,84,120,156,99,248,207,192,240,31,0,5,0,1,255,137,153,61,29,0,0,0,0,73,69,78,68,174,66,96,130]).buffer;
  lume.system.log('gallery: embedded png ' + redPng.byteLength + ' bytes');

  /* Image() 可能返回 -1（无效/解码失败）。children 里出现 -1 会让 View() 的
   * setAttr 抛异常并让整个 eval 失败，所以只收集有效节点。 */
  var head = Image({src: redPng, style: {width: 80, height: 80}});
  lume.system.log('gallery: head id ' + head);
  if (head > 0) tiles.push(head);

  var canDecode = typeof lume.image.decode === 'function';
  lume.system.log('gallery: image.decode ' + (canDecode ? 'available' : 'missing'));
  var paths = ['/gallery/photo.jpg', '/gallery/icon.png', '/gallery/alpha.png'];
  for (var i = 0; i < paths.length; i++) {
    /* 逐图 try/catch：一张卡图读不到或解码抛错只丢那一张，不影响其余图。 */
    try {
      var bytes = readImageBytes(paths[i]);
      if (!bytes) continue;
      var thumb = canDecode ? lume.image.decode(bytes, 96, 96) : -2;
      if (thumb && typeof thumb === 'object' &&
          Object.prototype.toString.call(thumb.pixels) === '[object Uint16Array]' &&
          thumb.pixels.length === thumb.width * thumb.height) {
        lume.system.log('gallery: thumbnail ' + paths[i] + ' ' + thumb.width + 'x' + thumb.height);
        var tile = thumbnailTile(thumb);
        if (tile > 0) tiles.push(tile);
      } else {
        lume.system.log('gallery: decode failed ' + paths[i] + ' rc=' + thumb + ', fall back to Image');
        var direct = Image({src: bytes, style: {width: 128, height: 128}});
        if (direct > 0) tiles.push(direct);
      }
    } catch (e) {
      lume.system.log('gallery: image ' + paths[i] + ' skipped: ' + e);
    }
  }
  return tiles;
}

/* HUD 卡信息：statvfs() 成功返回 {total,free}，失败返回负数错误码（-2 IO /
 * -3 无卡）。number 是错误码不是容量，必须用 typeof === 'object' 判别。
 * 字节用 Math.floor 取整到 MB（截断口径，见 KNOWN-SIMPLIFICATIONS r126 节）。 */
function cardInfoText() {
  if (!sd || typeof sd.statvfs !== 'function') return '';
  try {
    var stat = sd.statvfs();
    if (stat && typeof stat === 'object') {
      var totalMB = Math.floor(stat.total / 1048576);
      var freeMB = Math.floor(stat.free / 1048576);
      return 'SD ' + totalMB + 'MB TOTAL ' + freeMB + 'MB FREE';
    }
    return 'NO CARD';
  } catch (e) {
    lume.system.log('gallery: statvfs threw ' + e);
    return '';
  }
}

function main() {
  try {
    var tiles = buildTiles();
    galleryStatus = tiles.length + ' image(s)';
    var content = [Text({text: tiles.length ? 'Preview' : 'No images decoded',
      style: {width: '100%', height: 28, textAlign: 'center', color: '#A9C1CD'}})];
    for (var i = 0; i < tiles.length; i++) content.push(tiles[i]);
    var header = [
      Text({text: 'Image gallery', style: {width: '100%', height: 32, fontSize: 24, color: '#F0F7FA'}}),
      Text({text: galleryStatus + ' available', style: {width: '100%', height: 24, fontSize: 14, color: '#A9C1CD'}})
    ];
    var card = cardInfoText();
    if (card) header.push(Text({text: card,
      style: {width: '100%', height: 24, fontSize: 14, color: '#A9C1CD'}}));
    header.push(View({style: {width: '100%', height: 296, padding: 16, gap: 12,
      background: '#102431', borderRadius: 12, display: 'flex',
      flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center',
      justifyContent: 'center', scroll: 'none'}}, content));
    View({style: {width: '100%', height: '100%', padding: 24, gap: 12,
      background: '#081420', display: 'flex', flexDirection: 'column', scroll: 'none'}}, header);
  } catch (e) {
    lume.system.log('gallery fatal: ' + e);
    Text({text: String(e).slice(0, 45), style: {x: 40, y: 220, width: 400, height: 40}});
  }
}

main();
