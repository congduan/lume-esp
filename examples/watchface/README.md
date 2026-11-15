# Watchface

Swipe left or right to switch between the digital, analog, and activity ring faces. `WATCHFACE_START_PAGE` selects the initial page, including for automated screenshots. Time comes from `new Date()`; without a synchronized clock, the device may show time relative to boot. The step ring is an IMU movement illustration, not a calibrated pedometer. Battery reads from `lume.pmic.battPercent()` and shows 0 when unavailable. Hardware appearance and gesture feel need board acceptance.
