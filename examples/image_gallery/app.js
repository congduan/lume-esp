/** 图片画廊。TF 卡预置 /gallery/photo.jpg、/gallery/icon.png、/gallery/alpha.png
 * 可显示三张外部图片；无卡时仍显示内嵌 1×1 红色 PNG，验证字节到 Image 链路。
 */
var redPng = new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,8,6,0,0,0,31,21,196,137,0,0,0,13,73,68,65,84,120,156,99,248,207,192,240,31,0,5,0,1,255,137,153,61,29,0,0,0,0,73,69,78,68,174,66,96,130]).buffer;
var tiles = [Image({src: redPng, style: {width: 80, height: 80}})];
var paths = ['/gallery/photo.jpg', '/gallery/icon.png', '/gallery/alpha.png'];
for (var i = 0; i < paths.length; i++) {
  var bytes = Fs.readBinary(paths[i]);
  if (bytes instanceof ArrayBuffer) {
    var tile = Image({src: bytes, style: {width: 128, height: 128}});
    if (tile > 0) tiles.push(tile);
  }
}
View({style: {display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 8,
              width: '100%', padding: 12}}, tiles);
