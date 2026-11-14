/** M3 animation sample; firmware embeds the same app in lume_demo_js. */
var count = signal(0);
var cardY = signal(200);
var card = View({ style: {
  x: 24, y: cardY, width: 192, height: 80,
  background: '#355C8A', borderRadius: 12, opacity: 0,
  transition: { property: 'y', durationMs: 300, easing: 'ease-out' }
} }, [Text({ text: function () { return 'taps: ' + count(); } })]);
Button({ title: 'Slide card', style: { x: 48, y: 300, width: 144, height: 48 },
  onPress: function () {
    count.set(count() + 1);
    var entering = count() % 2 === 1;
    cardY.set(entering ? 80 : 200);
    lume.anim.to(card, { attr: 'opacity', to: entering ? 1 : 0,
      durationMs: 300, easing: 'ease-out' });
  }
});
