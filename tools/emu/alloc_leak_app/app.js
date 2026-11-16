/* Deliberately retain a newly concatenated string on every interval tick. */
var retained = [];
var tick = 0;
lume.system.setInterval(function () {
  retained.push(new Array(4097).join('x') + String(tick++));
}, 100);
Text({text:'Allocator leak control'});
