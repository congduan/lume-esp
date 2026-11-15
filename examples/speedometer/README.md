# Speedometer

This is a UI and animation demonstration, not a real speed measurement. The board has no OBD/CAN speed source. A real vehicle display needs OBD-II or GPS input and validation before use.

Set `SPEED_MODE` at the top of `app.js` to `demo` (default sine sweep), `imu` (tilt as a playful speed input), or `manual`. In manual mode, call `speedTarget.set(kmH)` from JS. The trip estimate integrates the displayed simulated speed and is saved to `lume.storage.kv`; it is not actual vehicle mileage.

The 135°–405° dial spans 0–260 km/h, with 20 km/h major and 10 km/h minor ticks. Each color band uses a 2° polyline sample (about 136 points for the whole dial on a 432×344 canvas), which stays below the 240-point limit of one `ctx.polyline()` call.

Redraw strategy: the dial layer (background arc, color bands, ticks) is painted **once**; later frames repaint only the needle and return a single dirty rectangle covering the old and the new needle, so the bridge publishes a few KB instead of the whole canvas. The dial labels are `Text` widgets rather than `ctx.text`, because they sit at r=119 — inside the needle's sweep — and the needle's dirty rect must be free to erase there. The needle (r=128) never reaches the ticks (r=139..152), so erasing it cannot damage static content.

Measured on the board with a probe app: the one-off dial layer costs ~86 ms (276 segments, built in JS), a needle-only frame ~3 ms with an 8–12k px dirty rectangle, and frames arrive every ~120 ms — the app only asks for a new dial value every 100 ms, so the canvas keeps up with the 20 ms tick instead of lagging behind it. Visual smoothness and touch feel still need board acceptance.
