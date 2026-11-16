/* esp32sim probe: a self-feeding chain must leave time for timer ticks. */
var jobs = 0;
var observed = false;
function feed() {
  jobs++;
  Promise.resolve().then(feed);
}
lume.system.setInterval(function () {
  if (!observed && jobs > 64) {
    observed = true;
    lume.log('ASYNC_JOB_TIMER_ALIVE');
  }
}, 20);
feed();
