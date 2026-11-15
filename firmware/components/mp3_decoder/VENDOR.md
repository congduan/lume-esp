# minimp3 vendor

Source: https://github.com/lieff/minimp3 at commit
`ea99364f61c14656440e8d77e9c233ccf3124633`.
Files: `minimp3.h`, `LICENSE` (unmodified). The library is public domain with
Unlicense fallback. Implementation is compiled once by `mp3_decoder.c` with
`MINIMP3_ONLY_MP3` and `MINIMP3_IMPLEMENTATION`. No upstream patches.

Selection evidence (2026-11-15): this commit was retrievable and its single C
header can be compiled as a regular IDF component. The brief's
`asmusso/helix_mp3` GitHub URL and registry component URL returned 404;
`ultraembedded/libhelix-mp3` was reachable but has a multi-source port.
The IDF build result belongs in the r37b report.
