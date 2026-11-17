#include <assert.h>
#include <stdint.h>
#include <stdio.h>
#include "lume_raycast.h"
int main(void){
 uint8_t map[25]={1,1,1,1,1,1,0,0,0,1,1,0,0,0,1,1,0,0,0,1,1,1,1,1,1};
 uint16_t pixels[32*32]={0};
 lume_raycast_frame_t f={.map=map,.map_w=5,.map_h=5,.px=1.5f,.py=2.5f,.angle=0,.pixels=pixels,.width=32,.height=32,.stride=32,.sprite_count=1,.sprites={{2.5f,2.5f,0}}};
 lume_raycast_render(&f);
 assert(pixels[16*32+16]==0x4149);
 printf("PASS sprite visible at center rgb565=0x%04x\n",pixels[16*32+16]);
 map[2*5+2]=1;lume_raycast_render(&f);
 assert(pixels[16*32+16]!=0x4149);
 printf("PASS sprite occluded by column z-buffer rgb565=0x%04x\n",pixels[16*32+16]);
 return 0;
}
