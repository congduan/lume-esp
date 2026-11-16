/* Embedded mini-SVG exercises Image -> sizeOf -> target raster -> LVGL. */
var svgIcon = '<svg width="120" height="120" viewBox="0 0 120 120">' +
  '<rect x="8" y="8" width="104" height="104" fill="#153650" stroke="#58d6ff" stroke-width="4"/>' +
  '<path d="M 32 64 L 51 82 L 88 38" fill="none" stroke="white" stroke-width="10"/>' +
  '</svg>';
var svgBytes = new Uint8Array(svgIcon.length);
for (var i = 0; i < svgIcon.length; i++) svgBytes[i] = svgIcon.charCodeAt(i);
var icon = Image({src: svgBytes.buffer, style: {width: 80, height: 80}});
if (icon > 0) View({style: {width: 480, height: 480, background: '#101b27', display: 'flex', alignItems: 'center', justifyContent: 'center'}}, [icon]);
