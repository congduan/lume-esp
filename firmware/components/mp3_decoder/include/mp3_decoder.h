#pragma once
#include <stddef.h>
#include <stdint.h>

typedef struct mp3_decoder mp3_decoder_t;
typedef struct {
    int samples; /* samples per channel */
    int sample_rate;
    int channels;
    int bitrate_kbps;
    size_t byte_offset;
    size_t file_bytes;
} mp3_frame_info_t;
/* Paths are relative to the TF card root. One open file at a time per handle. */
int mp3_decoder_list(const char *dir, void (*emit)(void *, const char *), void *arg);
int mp3_decoder_read_text(const char *path, char *out, size_t cap);
int mp3_decoder_id3v2(const char *path, char title[128], char artist[128], char album[128]);
int mp3_decoder_id3v1(const char *path, char *title, char *artist);
int mp3_decoder_open(const char *path, mp3_decoder_t **out);
int mp3_decoder_decode(mp3_decoder_t *h, int16_t *pcm, mp3_frame_info_t *info);
void mp3_decoder_close(mp3_decoder_t *h);
