#include <stdio.h>
#include <stdint.h>
#include <time.h>
#include <stdlib.h>
#include "lume_raycast.h"
static double now_ms(void) { struct timespec t; clock_gettime(CLOCK_MONOTONIC,&t); return t.tv_sec*1000.0+t.tv_nsec/1e6; }
int main(void) {
 const char *rows[16]={"1111111111111111","1000000000000001","1000000000000001","1000000020000001","1000000020000001","1000300000000001","1000300000000001","1000000000000001","1000000000400001","1000000000400001","1000000000000001","1000000000000001","1000000000000001","1000000000000001","1000000000000001","1111111111111111"};
 uint8_t map[256]; for(int y=0;y<16;y++)for(int x=0;x<16;x++)map[y*16+x]=rows[y][x]-'0';
 uint16_t *pixels=calloc(480*480,sizeof(uint16_t));
 lume_raycast_frame_t f={.map=map,.map_w=16,.map_h=16,.px=3.5f,.py=7.5f,.angle=-0.2f,.pixels=pixels,.width=480,.height=480,.stride=480};
 for(int i=0;i<10;i++)lume_raycast_render(&f);
 double start=now_ms(); for(int i=0;i<120;i++){f.angle=-0.2f+i*0.001f;lume_raycast_render(&f);} double ms=(now_ms()-start)/120.0;
 unsigned long checksum=0; for(int i=0;i<480*480;i++)checksum+=pixels[i];
 printf("C host 480x480 frames=120 ms/frame=%.3f equivalent_fps=%.1f checksum=%lu\n",ms,1000.0/ms,checksum);
 free(pixels);return 0;
}
