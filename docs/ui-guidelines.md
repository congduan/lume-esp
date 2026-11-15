# Lume 480 × 480 UI guidelines

The 2.16-inch rounded AMOLED is a watch-size canvas. Design one task per screen, with two or three information groups in a vertical flow. Lists may scroll; ordinary task screens should fit in one viewport.

## Tokens

| Role | Values / purpose |
| --- | --- |
| Spacing | 4, 8, 12, 16, 24, 32 px only |
| Radius | 8 px small control, 12 px card, 20 px large container, 999 px pill |
| Type | display 40–48 px, title 24 px, body 16 px, caption 13 px, micro 11 px |
| Color | `bg`, `surface`, `surfaceAlt`, `text`, `textDim`, `accent`, `danger`, `success` |

Set semantic colors once in `lume.theme.set({ colors: … })` and reference their names in View/Text/Button styles. The `primary` alias serves older components. `spacing` is provided by the optional JS shell extension; specify padding and gap explicitly in standalone apps. Canvas drawing colors come from `lume.theme.get().colors` where practical. There is no firmware theme change in r40b.

## Layout and interaction

- Keep content at least 16 px from the display edge. Use 24–32 px at the top and bottom where the rounded corners cut deeper.
- Put each information group on a `surface` card with a 12 px radius, 16 px internal padding and 12 px gap between cards. Use 20 px for the dominant card.
- Give the main number a display size; give its label caption size and `textDim`. Size and color establish hierarchy without relying on bold weight.
- Make primary buttons at least 56 px tall and full width when possible. Give a pressed or busy state visible feedback.
- Design empty states with a centered symbol and a short caption. Show loading as text or an activity indicator, and preserve enough room for error messages.
- Place paths above file lists. Use 48 px rows, alternating `surface` / `surfaceAlt`, a selected accent marker, and explicit empty copy.

## Verification

Capture the rendered 480 × 480 frame with `tools/emu/run.sh examples/<app>`. Emulator screenshots confirm layout and text fit, but physical display, touch feel, sleep current and audio still require board acceptance.
