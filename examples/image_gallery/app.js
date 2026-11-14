/** 图片画廊。TF 卡预置 /gallery/photo.jpg、/gallery/icon.png、/gallery/alpha.png
 * 三张文件均需小于 Fs.readBinary 的 64 KiB 单次读取上限。
 * 可显示三张外部图片；无卡时仍显示内嵌 1×1 红色 PNG，验证字节到 Image 链路。
 *
 * 整个构建过程包在 try/catch 里：native 层抛错（比如 image 解码失败）只会
 * 打进日志并显示一行错误文本，不会让整个 eval 失败并回退启动器。 */
lume.system.log('gallery: eval start');
lume.system.log('gallery: typeof Fs=' + (typeof Fs) +
  ' storage.Fs=' + (typeof lume.storage.Fs) +
  ' NODE_VIEW=' + (typeof NODE_VIEW) +
  ' signal=' + (typeof signal));

var galleryStatus = 'no images';

function buildTiles() {
  var tiles = [];
  var redPng = new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,8,6,0,0,0,31,21,196,137,0,0,0,13,73,68,65,84,120,156,99,248,207,192,240,31,0,5,0,1,255,137,153,61,29,0,0,0,0,73,69,78,68,174,66,96,130]).buffer;
  lume.system.log('gallery: embedded png ' + redPng.byteLength + ' bytes');

  /* Image() 可能返回 -1（无效/解码失败）。children 里出现 -1 会让 View() 的
   * setAttr 抛异常并让整个 eval 失败，所以只收集有效节点。 */
  var head = Image({src: redPng, style: {width: 80, height: 80}});
  lume.system.log('gallery: head id ' + head);
  if (head > 0) tiles.push(head);

  var paths = ['/gallery/photo.jpg', '/gallery/icon.png', '/gallery/alpha.png'];
  for (var i = 0; i < paths.length; i++) {
    var bytes = Fs.readBinary(paths[i]);
    if (bytes instanceof ArrayBuffer) {
      var tile = Image({src: bytes, style: {width: 128, height: 128}});
      if (tile > 0) tiles.push(tile);
    }
  }
  return tiles;
}

function main() {
  try {
    var tiles = buildTiles();
    galleryStatus = tiles.length + ' image(s)';
    View({style: {display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 8,
                  width: '100%', padding: 12, background: '#0B1724',
                  alignItems: 'center', justifyContent: 'center', scroll: 'none'}},
      tiles.length > 0 ? tiles : [Text({text: 'no images decoded',
        style: {textAlign: 'center'}})]);
  } catch (e) {
    lume.system.log('gallery fatal: ' + e);
    Text({text: String(e).slice(0, 45), style: {x: 40, y: 220, width: 400, height: 40}});
  }
}

main();
