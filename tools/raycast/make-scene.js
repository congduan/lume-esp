#!/usr/bin/env node
/* Reproducible emu visual states. Scenario inputs are seeded before the first
 * game tick; the passage scenario still uses collect(), won(), and next(). */
const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'../..');
const scene=process.argv[2],out=process.argv[3];
if(!out||!['encounter','passage'].includes(scene)){
 console.error('usage: node tools/raycast/make-scene.js encounter|passage <app-dir>');process.exit(2);
}
const file=path.join(root,'examples/raycast/app.js');
const marker="var game=state(),revision=signal(0),hud=signal(''),banner=signal('LANTERN VAULT / FIND EXIT');";
let app=fs.readFileSync(file,'utf8');
if(!app.includes(marker))throw new Error('scenario injection marker moved');
const seed=scene==='encounter'
 ? "loadLevel(game,2);game.angle=0;banner.set('CLEAR ALL SENTRIES');"
 : "game.x=game.pickups[0].x;game.y=game.pickups[0].y;collect(game);game.x=game.ex[0]+0.5;game.y=game.ex[1]+0.5;";
app=app.replace(marker,marker+seed);
fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'app.js'),app);
console.log(`${scene}: ${path.join(out,'app.js')} (${Buffer.byteLength(app)} bytes)`);
