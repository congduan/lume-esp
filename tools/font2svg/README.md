# abc123 font outlines

Run from the repository root:

```sh
python3.12 -m pip install fonttools==4.67.0
python3.12 tools/font2svg/generate.py
```

The generator reads `/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf` by
default. Override it with `--font /path/to/font.ttf`; use `--output` for a
different destination. DejaVu Sans Bold is distributed under the DejaVu Fonts
license (derived from Bitstream Vera): <https://dejavu-fonts.github.io/License.html>.
The generated SVGs use a white fill and a centered 100×100 viewBox. The extra
`width` and `height` attributes satisfy r58 mini-SVG intrinsic size parsing.
