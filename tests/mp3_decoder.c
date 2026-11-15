#define MINIMP3_IMPLEMENTATION
#define MINIMP3_ONLY_MP3
#include "../firmware/components/mp3_decoder/vendor/minimp3.h"
#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
int main(void) {
    FILE *f=fopen("tests/fixtures/silence-44100.mp3","rb"); assert(f);
    fseek(f,0,SEEK_END); long size=ftell(f); rewind(f);
    unsigned char *bytes=malloc(size); assert(bytes);
    assert(fread(bytes,1,size,f)==(size_t)size); fclose(f);
    mp3dec_t d; mp3dec_init(&d);
    mp3d_sample_t pcm[2304]; int offset=0, frames=0, samples=0;
    while (offset<size) {
        mp3dec_frame_info_t info={0};
        int n=mp3dec_decode_frame(&d,bytes+offset,size-offset,pcm,&info);
        if (info.frame_bytes<=0) break;
        offset+=info.frame_bytes;
        if (n) { assert(info.hz==44100); assert(info.channels==2); frames++; samples+=n; }
    }
    assert(frames>=8 && samples==frames*1152);
    printf("MP3 decoder: frames=%d sampleRate=44100 channels=2 samples=%d PASS\n",frames,samples);
    free(bytes);
}
