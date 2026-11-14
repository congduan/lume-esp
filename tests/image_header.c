#include "lume_image.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>
int main(void)
{
    uint16_t w = 0, h = 0;
    const unsigned char png[] = {137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1};
    assert(lume_image_size_of(png, sizeof(png), &w, &h) == 0 && w == 1 && h == 1);
    puts("PASS PNG IHDR 1x1");
    const unsigned char jpg[] = {0xff,0xd8,0xff,0xe0,0,4,1,2,0xff,0xc0,0,11,8,0,2,0,3,3,1,1,0};
    assert(lume_image_size_of(jpg, sizeof(jpg), &w, &h) == 0 && w == 3 && h == 2);
    puts("PASS JPEG SOF 3x2");
    unsigned char too_big[sizeof(png)]; memcpy(too_big, png, sizeof(png));
    too_big[19] = 0x01; too_big[20] = 0xe1;
    assert(lume_image_size_of(too_big, sizeof(too_big), &w, &h) == -1);
    puts("PASS oversize rejected before decode");
    assert(lume_image_size_of((const unsigned char *)"junk", 4, &w, &h) == -2);
    puts("PASS bad bytes rejected");
    assert(lume_image_size_of(NULL, 0, &w, &h) == -1);
    puts("PASS invalid argument error code");
    return 0;
}
