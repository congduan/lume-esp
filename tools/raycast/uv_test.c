#include <assert.h>
#include <stdint.h>
#include <stdio.h>
#include "lume_raycast.h"
int main(void){
 uint8_t map[9]={1,1,1,1,0,1,1,1,1},tex[768]={0};
 uint16_t pixels[32*32]={0};
 tex[8*16+7]=6; /* centered east ray: x wall at 2, y hit 1.5, flipped u=7, v=8 */
 lume_raycast_frame_t f={.map=map,.textures=tex,.map_w=3,.map_h=3,.px=1.5f,.py=1.5f,.angle=0,.pixels=pixels,.width=32,.height=32,.stride=32};
 lume_raycast_render(&f);
 assert(pixels[16*32+16]==0xc638);
 printf("PASS raycast UV center east: u=7 v=8 palette=6 rgb565=0x%04x\n",pixels[16*32+16]);
 return 0;
}
