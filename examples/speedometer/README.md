# Speedometer

This is a UI and animation demonstration, not a real speed measurement. The board has no OBD/CAN speed source. A real vehicle display needs OBD-II or GPS input and validation before use.

Set `SPEED_MODE` at the top of `app.js` to `demo` (default sine sweep), `imu` (tilt as a playful speed input), or `manual`. In manual mode, call `speedTarget.set(kmH)` from JS. The trip estimate integrates the displayed simulated speed and is saved to `lume.storage.kv`; it is not actual vehicle mileage.

The 135°–405° dial spans 0–260 km/h, with 20 km/h major and 10 km/h minor ticks. Each color band uses a 2° polyline sample: about 136 points across the whole dial. At a 20 ms tick the app redraws roughly 50 times/s, so the full dial submits roughly 6,800 arc points/s plus ticks and labels. This conservatively stays below the 240-point limit of a single `ctx.polyline()` call. Rendering performance and touch/visual quality still need board acceptance.
