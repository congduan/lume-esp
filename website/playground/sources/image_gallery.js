/** Image gallery (r126 Sd-first, r206 round AMOLED 2x2 grid + inspector).
 *
 *  Reads /gallery/photo.jpg, /gallery/icon.png, /gallery/alpha.png from Sd first
 *  when mounted, falling back per-image to LittleFS (Fs). Uses lume.image.decode
 *  (96x96 thumbnail -> Canvas retainImage/drawImage) with Image fallback. Keeps
 *  the embedded 1x1 red PNG probe so bytes->Image is always verified even with
 *  no card. HUD shows Sd.statvfs() MB or NO CARD on negative error codes.
 */
lume.theme.set({ colors: {
  bg: '#000000', primary: '#09101A', surface: '#16202E', surfaceAlt: '#1F2C3D',
  text: '#F2F7FB', textDim: '#9EB3C6', accent: '#40D8B0', danger: '#FF6B79'
}, radius: 12, spacing: 12 });

lume.system.log('gallery: eval start');
lume.system.log('gallery: typeof Fs=' + (typeof Fs) +
  ' storage.Fs=' + (typeof lume.storage.Fs) +
  ' NODE_VIEW=' + (typeof NODE_VIEW) +
  ' signal=' + (typeof signal));

var sd = (lume.storage && lume.storage.Sd) || null;
var sdReady = !!(sd && typeof sd.mounted === 'function' &&
  typeof sd.readBinary === 'function' && sd.mounted() === true);
lume.system.log('gallery: Sd mounted=' + sdReady);

var galleryStatus = 'no images';

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
  var uploaded = false;
  return Canvas({
    width: 96,
    height: 76,
    style: { scroll: 'none' },
    onDraw: function (ctx) {
      if (!uploaded) {
        ctx.retainImage(1, thumb.width, thumb.height, thumb.pixels);
        uploaded = true;
      }
      ctx.fillColor('#0B121C'); ctx.fillRect(0, 0, 96, 76);
      ctx.drawImage(1, Math.floor((96 - thumb.width) / 2), Math.floor((76 - thumb.height) / 2));
    }
  });
}

function buildTiles() {
  var tiles = [];
  var redPng = new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,8,6,0,0,0,31,21,196,137,0,0,0,13,73,68,65,84,120,156,99,248,207,192,240,31,0,5,0,1,255,137,153,61,29,0,0,0,0,73,69,78,68,174,66,96,130]).buffer;
  lume.system.log('gallery: embedded png ' + redPng.byteLength + ' bytes');

  var head = Image({ src: redPng, style: { width: 64, height: 64, borderRadius: 8 } });
  lume.system.log('gallery: head id ' + head);
  if (head > 0) tiles.push({ node: head, name: 'probe.png', meta: '1x1 PNG' });

  var canDecode = typeof lume.image.decode === 'function';
  lume.system.log('gallery: image.decode ' + (canDecode ? 'available' : 'missing'));
  var paths = ['/gallery/photo.jpg', '/gallery/icon.png', '/gallery/alpha.png'];
  for (var i = 0; i < paths.length; i++) {
    try {
      var bytes = readImageBytes(paths[i]);
      if (!bytes) continue;
      var fname = paths[i].slice(paths[i].lastIndexOf('/') + 1);
      var thumb = canDecode ? lume.image.decode(bytes, 96, 76) : -2;
      if (thumb && typeof thumb === 'object' &&
          Object.prototype.toString.call(thumb.pixels) === '[object Uint16Array]' &&
          thumb.pixels.length === thumb.width * thumb.height) {
        lume.system.log('gallery: thumbnail ' + paths[i] + ' ' + thumb.width + 'x' + thumb.height);
        var tile = thumbnailTile(thumb);
        if (tile > 0) tiles.push({ node: tile, name: fname, meta: thumb.width + 'x' + thumb.height });
      } else {
        lume.system.log('gallery: decode failed ' + paths[i] + ' rc=' + thumb + ', fall back to Image');
        var direct = Image({ src: bytes, style: { width: 72, height: 72, borderRadius: 8 } });
        if (direct > 0) tiles.push({ node: direct, name: fname, meta: 'IMAGE' });
      }
    } catch (e) {
      lume.system.log('gallery: image ' + paths[i] + ' skipped: ' + e);
    }
  }
  return tiles;
}

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
    var activeIdx = signal(0);
    var card = cardInfoText();

    /* Build 2x2 grid cards strictly inside [76, 404] safe square */
    var gridCards = [];
    for (var i = 0; i < 4; i++) {
      (function (slot) {
        var entry = slot < tiles.length ? tiles[slot] : null;
        var col = slot % 2;
        var row = Math.floor(slot / 2);
        var cx = 4 + col * 165;
        var cy = 36 + row * 118;
        if (entry) {
          gridCards.push(View({
            onPress: function () { activeIdx.set(slot); },
            style: {
              position: 'absolute', x: cx, y: cy, width: 155, height: 110,
              background: function () { return activeIdx() === slot ? '#14292E' : '#16202E'; },
              borderColor: function () { return activeIdx() === slot ? '#34A88B' : '#233245'; },
              borderWidth: 1, borderRadius: 12, padding: 6,
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'space-between', scroll: 'none'
            }
          }, [
            entry.node,
            Text({ text: entry.name + '  ' + entry.meta, style: {
              width: 140, height: 18, fontSize: 11, color: '#9EB3C6', textAlign: 'center'
            } })
          ]));
        } else {
          gridCards.push(View({
            style: {
              position: 'absolute', x: cx, y: cy, width: 155, height: 110,
              background: '#101824', borderColor: '#1E2C3E', borderWidth: 1, borderRadius: 12,
              display: 'flex', alignItems: 'center', justifyContent: 'center', scroll: 'none'
            }
          }, [
            Text({ text: 'Empty slot', style: { fontSize: 12, color: '#5C7794', textAlign: 'center' } })
          ]));
        }
      })(i);
    }

    var safeChildren = [
      Text({ text: 'Gallery', style: {
        position: 'absolute', x: 4, y: 2, width: 140, height: 28,
        fontSize: 21, color: '#F2F7FB'
      } }),
      View({ style: {
        position: 'absolute', x: 152, y: 4, width: 172, height: 24,
        background: '#122A2B', borderColor: '#2E7D6B', borderWidth: 1, borderRadius: 12,
        display: 'flex', alignItems: 'center', justifyContent: 'center', scroll: 'none'
      } }, [
        Text({
          text: card ? card : (galleryStatus + ' ready'),
          style: { fontSize: 11, color: '#40D8B0', textAlign: 'center', longMode: 'dots' }
        })
      ])
    ];
    for (var j = 0; j < gridCards.length; j++) safeChildren.push(gridCards[j]);

    safeChildren.push(View({ style: {
      position: 'absolute', x: 4, y: 272, width: 320, height: 52,
      background: '#16202E', borderColor: '#233245', borderWidth: 1, borderRadius: 12,
      display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingLeft: 4, paddingRight: 4, scroll: 'none'
    } }, [
      Button({ title: '<', onPress: function () {
        if (tiles.length > 0) activeIdx.set((activeIdx() + tiles.length - 1) % tiles.length);
      }, style: {
        width: 48, height: 48, borderRadius: 10, background: '#1F2C3D', color: '#F2F7FB', fontSize: 14
      } }),
      Text({ text: function () {
        if (!tiles.length) return 'No images decoded';
        var cur = tiles[activeIdx()];
        return (activeIdx() + 1) + '/' + tiles.length + '  ' + cur.name;
      }, style: { flexGrow: 1, fontSize: 13, color: '#F2F7FB', textAlign: 'center' } }),
      Button({ title: '>', onPress: function () {
        if (tiles.length > 0) activeIdx.set((activeIdx() + 1) % tiles.length);
      }, style: {
        width: 48, height: 48, borderRadius: 10, background: '#1F2C3D', color: '#F2F7FB', fontSize: 14
      } })
    ]));

    View({ style: { width: '100%', height: '100%', background: '#000000', scroll: 'none' } }, [
      View({ style: {
        position: 'absolute', x: 14, y: 14, width: 452, height: 452,
        borderRadius: 226, background: '#09101A', borderWidth: 1, borderColor: '#1E2D3F',
        scroll: 'none'
      } }),
      View({ style: {
        position: 'absolute', x: 76, y: 76, width: 328, height: 328,
        background: '#09101A', scroll: 'none'
      } }, safeChildren)
    ]);
  } catch (e) {
    lume.system.log('gallery fatal: ' + e);
    Text({ text: String(e).slice(0, 45), style: { x: 80, y: 220, width: 320, height: 40 } });
  }
}

main();
