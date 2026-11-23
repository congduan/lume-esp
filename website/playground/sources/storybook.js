/* StoryBook: TF story packs, with an explicitly labelled three-page sample. */
var sbMp3 = lume.audio && lume.audio.mp3;
var sbSd = lume.storage && lume.storage.Sd;
var sbKv = lume.storage && lume.storage.kv;
var sbSample = {name:'BUILT-IN SAMPLE', sample:true, pages:[
  {number:1, audio:null, meta:{caption:'HELLO, LITTLE STAR!', mood:'happy', hotspot:{x:324,y:155,r:52,sound:null}}},
  {number:2, audio:null, meta:{caption:'THE MOON SAYS HELLO.', mood:'surprised', hotspot:{x:152,y:160,r:54,sound:null}}},
  {number:3, audio:null, meta:{caption:'GOOD NIGHT, FRIEND.', mood:'calm', hotspot:{x:240,y:153,r:52,sound:null}}}
]};
function sbSafeName(s) { return typeof s === 'string' && !!s && s[0] !== '.' && s.indexOf('/') < 0 && s.indexOf('\\') < 0 && s.length < 100; }
function sbMeta(text) {
  if (typeof text !== 'string' || text.length > 4096) return null;
  /* Only the documented literal fields are accepted; card content is never evaluated. */
  var out = {}, m, h = /hotspot\s*:\s*\{([^}]*)\}/.exec(text);
  function field(src, key) { var re = new RegExp('\\b' + key + '\\s*:\\s*[\'\"]([^\'\"]*)[\'\"]'); var a = re.exec(src); return a ? a[1] : null; }
  out.image = field(text, 'image');
  out.caption = field(text, 'caption') || '';
  out.mood = field(text, 'mood') || 'calm';
  if (['happy','sad','surprised','calm'].indexOf(out.mood) < 0) out.mood = 'calm';
  if (h) {
    function n(key) { var a = new RegExp('\\b' + key + '\\s*:\\s*(-?\\d+(?:\\.\\d+)?)').exec(h[1]); return a ? Number(a[1]) : NaN; }
    var x=n('x'), y=n('y'), r=n('r'), sound=field(h[1], 'sound');
    if (isFinite(x) && isFinite(y) && r > 0 && r <= 240) out.hotspot = {x:x,y:y,r:r,sound:sbSafeName(sound) && /\.mp3$/i.test(sound) ? sound : null};
  }
  if (!sbSafeName(out.image) || !/\.png$/i.test(out.image || '')) out.image = null;
  return out;
}
function sbPack(name, files, readText) {
  if (!sbSafeName(name) || !Array.isArray(files)) return null;
  var pages = [], seen = {};
  for (var i=0;i<files.length;i++) {
    var m=/^page-(\d{2})\.mp3$/i.exec(files[i]);
    if (!m || seen[Number(m[1])]) continue;
    seen[Number(m[1])] = true;
    var stem='page-' + m[1], raw;
    try { raw=readText('/storybook/' + name + '/' + stem + '.meta.js'); } catch (_) { raw=null; }
    pages.push({number:Number(m[1]), audio:'/storybook/' + name + '/' + files[i], meta:sbMeta(raw)});
  }
  pages.sort(function(a,b){return a.number-b.number;});
  return pages.length ? {name:name, sample:false, pages:pages} : null;
}
function sbLibrary(list, listDir, readText) {
  var books=[];
  if (Array.isArray(list)) for (var i=0;i<list.length && books.length<24;i++) {
    if (!sbSafeName(list[i])) continue;
    var files; try { files=listDir('/storybook/'+list[i]); } catch (_) { files=null; }
    var book=sbPack(list[i],files,readText); if (book) books.push(book);
  }
  books.sort(function(a,b){return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;});
  return books.length ? books : [sbSample];
}
function sbHit(h,x,y) { if (!h) return false; var dx=x-h.x,dy=y-h.y; return dx*dx+dy*dy<=h.r*h.r; }
function sbAdvance(page,count,auto,eof) { return eof && auto && page+1<count ? page+1 : page; }
function sbSaved(book,page) { return JSON.stringify({book:book,page:page}); }
function sbRestore(raw,books) {
  try { var v=JSON.parse(raw); for(var i=0;i<books.length;i++) if(books[i].name===v.book && v.page>=0 && v.page<books[i].pages.length && Math.floor(v.page)===v.page) return {book:i,page:v.page}; } catch (_) {}
  return null;
}
var sbBooks, sbBook=0, sbPage=0, sbShelfOffset=0, sbReading=false, sbControls=false;
var sbAuto=true, sbPaused=false, sbMute=false, sbDecoder=false, sbPending=null, sbEof=false, sbTone=0, sbHotTimer=0, sbEffect=false, sbFrames=0, sbResumeFrames=0;
var sbLast=null, sbImage=null, sbImageKey='';
try { var root=sbMp3 && sbMp3.list('/storybook'); sbBooks=sbLibrary(root,function(p){return sbMp3.list(p);},function(p){return sbMp3.readText(p);}); } catch (_) { sbBooks=[sbSample]; }
try { sbLast=sbRestore(sbKv && sbKv.get('storybook.last'),sbBooks); } catch (_) {}
var sbShelfTitle=signal('STORYBOOK'), sbContinue=signal(sbLast ? 'CONTINUE READING' : 'START STORY');
var sbCaption=signal(''), sbPageLabel=signal(''), sbBookTitle=signal(''), sbMode=signal(''), sbPlay=signal('PAUSE'), sbAutoLabel=signal('AUTO ON');
var sbRows=[signal(''),signal(''),signal(''),signal('')], sbScene=signal(0), sbMood=signal('calm');
function sbShort(s,n) { s=String(s||'').replace(/[\r\n]/g,' ').toUpperCase(); return s.length>n ? s.slice(0,n-1)+'~' : s; }
function sbRefreshShelf() { for(var i=0;i<4;i++){ var b=sbBooks[sbShelfOffset+i]; sbRows[i].set(b ? sbShort(b.name,21)+'  '+b.pages.length+' PAGES' : ''); } }
function sbStop() { if(sbDecoder && sbMp3) try{sbMp3.close();}catch(_){} sbDecoder=false; sbPending=null; sbEof=false; try{lume.audio.streamReset();}catch(_){} }
function sbSave() { try { if(sbKv) sbKv.set('storybook.last',sbSaved(sbBooks[sbBook].name,sbPage)); } catch (_) {} }
function sbLoadImage(page) {
  sbImage=null; sbImageKey='';
  var meta=page.meta, name=meta && meta.image;
  if (!name || !sbSd || !lume.image || !lume.image.decode) return;
  try { var bytes=sbSd.readBinary('/storybook/'+sbBooks[sbBook].name+'/'+name);
    if (!(bytes instanceof ArrayBuffer)) return;
    var d=lume.image.decode(bytes,400,270);
    if (d && typeof d==='object' && d.pixels && d.pixels.length===d.width*d.height) { sbImage=d; sbImageKey=sbBooks[sbBook].name+'/'+name; }
  } catch (_) {}
}
function sbStartAudio() {
  sbStop(); sbEffect=false; sbFrames=0; sbResumeFrames=0; sbMute=false; sbMode.set('READING');
  var book=sbBooks[sbBook], page=book.pages[sbPage];
  if (book.sample) { sbTone=0; return; }
  if (!page.audio || !sbMp3) { sbMute=true; sbMode.set('MUTE'); return; }
  try { if(sbMp3.open(page.audio)===0) sbDecoder=true; else {sbMute=true;sbMode.set('MUTE');} }
  catch (_) { sbMute=true; sbMode.set('MUTE'); }
}
function sbShowPage() {
  var b=sbBooks[sbBook], p=b.pages[sbPage], m=p.meta||{};
  sbBookTitle.set(sbShort(b.name,25)); sbCaption.set(sbShort(m.caption||'LISTEN AND TURN THE PAGE',31));
  sbPageLabel.set('PAGE '+(sbPage+1)+' / '+b.pages.length); sbMood.set(m.mood||'calm');
  sbLoadImage(p); sbScene.set(sbScene()+1); sbStartAudio(); sbSave();
}
function sbOpen(book,page) { sbBook=book; sbPage=page||0; sbReading=true; sbControls=false; sbPaused=false; sbShowPage(); sbShowPanels(); }
function sbShowPanels() { if(sbShelfNode) lume.setAttr(sbShelfNode,5,sbReading?0:1); if(sbReadNode) lume.setAttr(sbReadNode,5,sbReading?1:0); if(sbControlNode) lume.setAttr(sbControlNode,5,sbReading&&sbControls?1:0); }
function sbGo(delta) { var n=sbPage+delta, count=sbBooks[sbBook].pages.length; if(n>=0 && n<count){ sbPage=n; sbShowPage(); } else if(n>=count){sbPaused=true;sbPlay.set('PLAY');sbMode.set('THE END');} }
function sbTick() {
  if(!sbReading || sbPaused || sbMute) return;
  if(sbHotTimer>0) {sbHotTimer--; if(sbHotTimer===0) sbMood.set((sbBooks[sbBook].pages[sbPage].meta||{}).mood||'calm');}
  if(sbBooks[sbBook].sample) {
    if(sbTone===0) { try {var pcm=new Int16Array(3200);for(var q=0;q<1600;q++){var v=Math.floor(1500*Math.sin(q*0.09));pcm[q*2]=v;pcm[q*2+1]=v;}
      if(lume.audio.playStream(pcm.buffer,{sampleRate:16000,channels:2,bits:16})<0){sbMute=true;sbMode.set('MUTE');return;}
    } catch (_) {sbMute=true;sbMode.set('MUTE');return;} }
    if(++sbTone>=90){sbTone=1;var next=sbAdvance(sbPage,sbBooks[sbBook].pages.length,sbAuto,true);
      if(next!==sbPage)sbGo(1);else {sbPaused=true;sbPlay.set('PLAY');sbMode.set(sbAuto?'THE END':'PAUSED');}} return;
  }
  if(!sbDecoder) return;
  try {
    if(!sbPending && !sbEof){sbPending=sbMp3.decode();if(sbPending===null)sbEof=true;else if(typeof sbPending==='number') throw Error('decode');}
    if(sbPending && sbResumeFrames>0){sbResumeFrames--;sbPending=null;return;}
    if(sbPending){var f=sbPending,pcm=f.pcm;
      if(f.channels===1){var mono=new Int16Array(pcm),st=new Int16Array(mono.length*2);for(var i=0;i<mono.length;i++)st[i*2]=st[i*2+1]=mono[i];pcm=st.buffer;}
      var rc=lume.audio.playStream(pcm,{sampleRate:f.sampleRate,channels:2,bits:16});
      if(rc===0) {sbPending=null;sbFrames++;} else if(rc!==-3) throw Error('play');
    }
    if(sbEof && !sbPending && lume.audio.streamFinished()){
      if(sbEffect){var skip=sbResumeFrames;sbStop();sbEffect=false;sbResumeFrames=skip;
        if(sbMp3.open(sbBooks[sbBook].pages[sbPage].audio)===0){sbDecoder=true;sbMode.set('READING');}else throw Error('resume');}
      else {sbStop(); var next=sbAdvance(sbPage,sbBooks[sbBook].pages.length,sbAuto,true);
        if(next!==sbPage)sbGo(1); else {sbPaused=true;sbPlay.set('PLAY');}}
    }
  } catch (_) {sbStop();sbMute=true;sbMode.set('MUTE');}
}
function sbHotspot(x,y) {
  var h=(sbBooks[sbBook].pages[sbPage].meta||{}).hotspot;
  if(!sbHit(h,x,y)) return false;
  sbMood.set('surprised');sbHotTimer=12;
  if(h.sound && sbMp3 && !sbMute) {
    /* The decoder is exclusive. Save the page position and play the short effect. */
    var played=sbFrames;sbStop();sbEffect=true;sbResumeFrames=played;
    try { if(sbMp3.open('/storybook/'+sbBooks[sbBook].name+'/'+h.sound)===0) {sbDecoder=true;sbEof=false;sbMode.set('HOTSPOT');} else throw Error('open'); }
    catch (_) {sbMute=true;sbMode.set('MUTE');}
  }
  return true;
}
function sbDraw(ctx) {
  sbScene(); var p=sbBooks[sbBook].pages[sbPage], mood=sbMood();
  var bg=['#17345C','#26365F','#172B50'][sbPage%3];ctx.fillColor(bg);ctx.fillRect(0,0,480,300);
  if(sbImage){ if(sbImageKey!==sbDraw.key){ctx.retainImage(1,sbImage.width,sbImage.height,sbImage.pixels);sbDraw.key=sbImageKey;} ctx.drawImage(1,40,12); }
  else {
    ctx.fillCircle(369,57,33,'#FFE9A3');ctx.fillCircle(80,91,4,'#FFFFFF');ctx.fillCircle(417,150,4,'#FFFFFF');
    if(sbPage%3===0){ctx.fillEllipse(240,236,173,72,'#497B85');ctx.fillCircle(309,143,48,'#FFC96B');ctx.fillCircle(301,130,5,'#24314A');}
    else if(sbPage%3===1){ctx.fillCircle(155,151,58,'#F5DF9B');ctx.fillCircle(175,132,58,bg);ctx.fillEllipse(320,233,143,60,'#426B93');}
    else {ctx.fillEllipse(240,244,165,65,'#355E83');ctx.fillCircle(240,152,53,'#F8DB87');ctx.fillCircle(229,143,5,'#26365F');}
  }
  /* A compact expression model inspired by examples/mochi. */
  ctx.fillCircle(426,250,37,'#FFF2D6');
  if(mood==='sad'){ctx.line(412,245,418,249,'#293249',3);ctx.line(434,249,440,245,'#293249',3);ctx.line(419,268,434,263,'#293249',3);}
  else if(mood==='surprised'){ctx.fillCircle(415,245,4,'#293249');ctx.fillCircle(437,245,4,'#293249');ctx.fillCircle(426,265,7,'#293249');}
  else {ctx.fillCircle(415,245,4,'#293249');ctx.fillCircle(437,245,4,'#293249');ctx.line(416,261,426,267,'#293249',3);ctx.line(426,267,437,261,'#293249',3);}
}
lume.theme.set({colors:{bg:'#101D3C',primary:'#101D3C',surface:'#263F65',surfaceAlt:'#345678',text:'#FFF7DC',textDim:'#D5D9E0',accent:'#FFCF75',danger:'#E98E7A',success:'#91D8B4'},radius:18,spacing:12,fontScale:1});
var sbShelfNode, sbReadNode, sbControlNode;
var shelfChildren=[Text({text:'STORYBOOK',style:{x:28,y:30,width:420,height:54,fontSize:36,color:'text'}}),Text({text:function(){return sbBooks[0].sample?'BUILT-IN SAMPLE':'TF CARD LIBRARY';},style:{x:30,y:90,width:400,height:30,fontSize:18,color:'accent'}})];
for(var j=0;j<4;j++)(function(k){shelfChildren.push(Button({title:function(){return sbRows[k]();},style:{x:28,y:138+k*70,width:424,height:58,fontSize:23,background:'surface',color:'text'},onPress:function(){if(sbShelfOffset+k<sbBooks.length)sbOpen(sbShelfOffset+k,0);}}));})(j);
shelfChildren.push(Button({title:function(){return sbContinue();},style:{x:28,y:425,width:286,height:46,fontSize:18,background:'accent',color:'bg'},onPress:function(){if(sbLast)sbOpen(sbLast.book,sbLast.page);else sbOpen(0,0);}}));
shelfChildren.push(Button({title:'MORE',style:{x:324,y:425,width:128,height:46,fontSize:18,background:'surfaceAlt'},onPress:function(){sbShelfOffset=(sbShelfOffset+4)%sbBooks.length;sbRefreshShelf();}}));
sbShelfNode=View({style:{width:480,height:480,background:'bg',scroll:'none'}},shelfChildren);
var sbCanvas=Canvas({width:480,height:300,style:{x:0,y:42},onDraw:sbDraw});
sbControlNode=View({style:{x:10,y:388,width:460,height:88,background:'surface',scroll:'none'}},[
  Button({title:'SHELF',style:{x:8,y:14,width:105,height:59,fontSize:18},onPress:function(){sbStop();sbReading=false;sbShowPanels();}}),
  Button({title:function(){return sbPlay();},style:{x:121,y:14,width:105,height:59,fontSize:18},onPress:function(){sbPaused=!sbPaused;sbPlay.set(sbPaused?'PLAY':'PAUSE');try{lume.audio.streamPause(sbPaused);}catch(_){} }}),
  Button({title:function(){return sbAutoLabel();},style:{x:234,y:14,width:105,height:59,fontSize:17},onPress:function(){sbAuto=!sbAuto;sbAutoLabel.set(sbAuto?'AUTO ON':'AUTO OFF');}}),
  Button({title:'NEXT',style:{x:347,y:14,width:105,height:59,fontSize:18},onPress:function(){sbGo(1);}})
]);
sbReadNode=View({style:{width:480,height:480,background:'bg',scroll:'none'}},[
  Text({text:function(){return sbBookTitle();},style:{x:24,y:8,width:330,height:34,fontSize:20,color:'accent'}}),
  Text({text:function(){return sbMode();},style:{x:356,y:8,width:100,height:34,fontSize:17,color:'textDim',textAlign:'right'}}),
  sbCanvas,
  Text({text:function(){return sbCaption();},style:{x:20,y:352,width:440,height:42,fontSize:28,color:'text',textAlign:'center'}}),
  Text({text:function(){return sbPageLabel();},style:{x:24,y:427,width:290,height:32,fontSize:19,color:'textDim'}}),
  sbControlNode
]);
lume.gesture.on(sbReadNode,'swipe',function(e){if(e.dir==='left')sbGo(1);else if(e.dir==='right')sbGo(-1);});
lume.gesture.on(sbReadNode,'tap',function(e){if(sbHotspot(e.x,e.y))return;if(e.x>70&&e.x<410&&e.y>80&&e.y<380){sbControls=!sbControls;sbShowPanels();}});
sbRefreshShelf();sbShowPanels();lume.system.setInterval(sbTick,35);
