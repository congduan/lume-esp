import { GLYPHS } from './glyphs.js';
function bytes(svg) { var a = new Uint8Array(svg.length); for (var i=0;i<svg.length;i++) a[i]=svg.charCodeAt(i); return a.buffer; }
var aa=bytes(GLYPHS.A), bb=bytes(GLYPHS.B), toggle=false;
var root=View({style:{width:480,height:480,background:'#000000'}});
var img=Image({parent:root,src:aa,style:{x:80,y:64,width:320,height:320}});
var sample=0;
lume.system.setInterval(function(){
  var t=Date.now();
  var rc=lume.image._setSource(img,toggle?aa:bb,320,320);
  lume.system.log('R183 SVG sample='+sample+' ms='+(Date.now()-t)+' rc='+rc+' glyph='+(toggle?'A':'B'));
  toggle=!toggle; sample++;
},400);
