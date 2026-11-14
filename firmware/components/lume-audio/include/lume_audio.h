#pragma once
#include <stddef.h>
#include <stdint.h>

#define LUME_AUDIO_OK 0
#define LUME_AUDIO_ERR_ARG (-1)
#define LUME_AUDIO_ERR_DRIVER (-2)
#define LUME_AUDIO_ERR_STATE (-3)
#define LUME_AUDIO_ERR_MEMORY (-4)

/* M1: 16 kHz, signed 16-bit interleaved stereo PCM. Synchronous on engine task. */
int lume_audio_init(void);
int lume_audio_play(const void *pcm, size_t bytes);
int lume_audio_record(void *pcm, size_t bytes);
int lume_audio_set_volume(int percent);
int lume_audio_stop(void);
