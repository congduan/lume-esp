# Music player

Prepare a FAT32 TF card with this layout:

```text
/music/song.mp3
/music/another.mp3
/lyrics/song.lrc
```

An LRC can also sit beside its MP3 (`/music/song.lrc`). The file stem must
match exactly. Prepare your own music and lyrics; this repository includes
only a generated, silent MP3 test fixture. UTF-8 LRC files up to 32767 bytes
are accepted. GBK LRC and ID3v2 metadata are not parsed. ID3v1 title/artist
are displayed when present, otherwise the filename is used.

The player scans the first four sorted MP3 names into its library page.
Playback uses one MP3 frame per 20 ms engine timer tick and queues up to
16 PCM chunks for the audio worker. `lume.storage.Fs` remains LittleFS; the
player's `lume.audio.mp3` methods read the TF card directly. Missing card or
`/music` shows an error on screen. Track duration is a bitrate estimate;
position uses elapsed wall time capped by submitted PCM duration. No seek or
position resume is provided. Pause/resume and track skip are supported.

Host preview:

```bash
node tools/simulator/sim.js examples/music_player/app.js
```

The simulator uses synthetic MP3 frames and demo lyrics. It does not produce
sound. Board audio, card mounting, lyric timing, and long-track stability still
need on-device acceptance.
