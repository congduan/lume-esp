#include <math.h>
#include <stddef.h>
#include "lume_raycast.h"

static const uint16_t wall[4][4] = {
    {0x18c4,0x3168,0x630d,0x9d14},
    {0x20a4,0x3948,0x6acd,0xa4b4},
    {0x1964,0x3a28,0x6bcd,0xadb4},
    {0x18a6,0x3150,0x5b18,0x8dff}
};
static const uint16_t palette[16] = {
    0x10a3,0x2946,0x4209,0x630d,0x8410,0xa514,0xc638,0xe71c,
    0x28c6,0x4149,0x59ec,0x7aef,0x9bd3,0xbcd7,0xd5ba,0xf6de
};
static uint16_t shaded[4][16];
/* Original 16x16 silhouettes, '.' transparent. Kept in flash rodata. */
static const char *sprite_art[2][16] = {
    {"................","......88........","....888888......","....8eeee8......",
     "...8e5555e8.....","...8e5ee5e8.....","....8eeee8......","...88888888.....",
     "..8899999988....","..8899999988....","..8899999988....","...8999998......",
     "...8bbbbbb8.....","...8bb..bb8.....","...88....88.....","................"},
    {"................",".....aaaa.......","...aaaffaaa.....","...af7777fa.....",
     "..af7f77f7fa....","..af777777fa....","...af7777fa.....","..aaaaffaaaa....",
     ".aaaccccccaaa...",".aaaccccccaaa...",".aaaccccccaaa...","..aaccccccaa....",
     "...acccccc a....","...aa....aa.....","..aaa....aaa....","................"}
};
static void init_palette(void) {
    static int ready;
    if (ready) return;
    for (int s=0;s<4;s++) for (int i=0;i<16;i++) {
        uint16_t c=palette[i]; int dark=3-s;
        shaded[s][i]=(uint16_t)((((c>>11)>>dark)<<11) |
                    ((((c>>5)&63)>>dark)<<5) | ((c&31)>>dark));
    }
    ready=1;
}

void lume_raycast_render(const lume_raycast_frame_t *f)
{
    if (!f || !f->map || !f->pixels || f->width <= 0 || f->height <= 0 ||
        f->stride < f->width || f->map_w <= 0 || f->map_h <= 0) return;
    if (f->textures) init_palette();
    const float dx = cosf(f->angle), dy = sinf(f->angle);
    const float plane_x = -dy * 0.66f, plane_y = dx * 0.66f;
    if (f->width > 480) return;
    /* One LVGL reader. Static scratch avoids a large LVGL-task stack frame;
     * row-major writes keep PSRAM cache lines hot. */
    static int16_t tops[480], bottoms[480];
    static uint16_t colors[480];
    static uint8_t tex_x[480], tex_id[480], shades[480];
    static int tex_steps[480];
    static float depth[480];
    int step = f->quality == 4 ? 4 : f->quality == 2 ? 2 : 1;
    const int horizon = f->height / 2;
    for (int x = 0; x < f->width; x += step) {
        float camera = 2.0f * (float)x / (float)f->width - 1.0f;
        float rx = dx + plane_x * camera, ry = dy + plane_y * camera;
        int mx = (int)floorf(f->px), my = (int)floorf(f->py);
        float delta_x = rx == 0.0f ? 1e30f : fabsf(1.0f / rx);
        float delta_y = ry == 0.0f ? 1e30f : fabsf(1.0f / ry);
        int step_x = rx < 0 ? -1 : 1, step_y = ry < 0 ? -1 : 1;
        float side_x = (rx < 0 ? f->px - mx : mx + 1.0f - f->px) * delta_x;
        float side_y = (ry < 0 ? f->py - my : my + 1.0f - f->py) * delta_y;
        int side = 0, tile = 0;
        for (int n = 0; n < f->map_w + f->map_h + 1; n++) {
            if (side_x < side_y) { side_x += delta_x; mx += step_x; side = 0; }
            else { side_y += delta_y; my += step_y; side = 1; }
            if (mx < 0 || my < 0 || mx >= f->map_w || my >= f->map_h) { tile = 1; break; }
            tile = f->map[my * f->map_w + mx];
            if (tile) break;
        }
        float dist = side ? side_y - delta_y : side_x - delta_x;
        if (dist < 0.05f) dist = 0.05f;
        depth[x] = dist;
        int wall_h = (int)((float)f->height / dist);
        int top = horizon - wall_h / 2, bottom = horizon + wall_h / 2;
        if (top < 0) top = 0;
        if (bottom > f->height) bottom = f->height;
        int shade = dist < 2.0f ? 3 : dist < 4.0f ? 2 : dist < 7.0f ? 1 : 0;
        if (side && shade) shade--;
        tops[x] = top; bottoms[x] = bottom;
        colors[x] = wall[(tile - 1) & 3][shade];
        tex_steps[x] = wall_h > 0 ? (16 * 65536 / wall_h) : 0;
        shades[x] = (uint8_t)shade;
        tex_id[x] = (uint8_t)((tile - 1) % 3);
        float hit = side ? f->px + dist * rx : f->py + dist * ry;
        hit -= floorf(hit);
        int u = (int)(hit * 16.0f) & 15;
        if ((side == 0 && rx > 0) || (side == 1 && ry < 0)) u = 15 - u;
        tex_x[x] = (uint8_t)u;
        for (int j=1;j<step && x+j<f->width;j++) {
            int at=x+j;
            tops[at]=tops[x];bottoms[at]=bottoms[x];colors[at]=colors[x];
            tex_steps[at]=tex_steps[x];shades[at]=shades[x];
            tex_id[at]=tex_id[x];tex_x[at]=tex_x[x];depth[at]=depth[x];
        }
    }
    for (int y = 0; y < f->height; y++) {
        uint16_t sky = y < horizon / 2 ? 0x08a6 : 0x10e8;
        uint16_t floor = y < horizon + horizon / 2 ? 0x2106 : 0x18c3;
        uint16_t *row = f->pixels + (size_t)y * f->stride;
        for (int x = 0; x < f->width; x += step) {
            uint16_t color;
            if (y < tops[x]) color = sky;
            else if (y >= bottoms[x]) color = floor;
            else if (f->textures) {
                int v = (((y - horizon) * tex_steps[x]) >> 16) + 8;
                v &= 15;
                uint8_t index = f->textures[tex_id[x] * 256 + v * 16 + tex_x[x]] & 15;
                color = shaded[shades[x]][index];
            } else color = colors[x];
            for(int j=0;j<step && x+j<f->width;j++)row[x+j]=color;
        }
    }
    /* Far-to-near billboard pass. Per-column wall depth hides occluded parts. */
    int order[8];
    for (int i=0;i<f->sprite_count && i<8;i++) order[i]=i;
    for (int i=0;i<f->sprite_count && i<8;i++) for(int j=i+1;j<f->sprite_count;j++) {
        float ax=f->sprites[order[i]].x-f->px, ay=f->sprites[order[i]].y-f->py;
        float bx=f->sprites[order[j]].x-f->px, by=f->sprites[order[j]].y-f->py;
        if(ax*ax+ay*ay < bx*bx+by*by){int tmp=order[i];order[i]=order[j];order[j]=tmp;}
    }
    float det=plane_x*dy-dx*plane_y;
    if (fabsf(det)<0.001f) return;
    float inv=1.0f/det;
    int sprite_limit=step>=4?2:step>=2?4:8;
    int sprite_start=f->sprite_count>sprite_limit?f->sprite_count-sprite_limit:0;
    for(int i=sprite_start;i<f->sprite_count && i<8;i++){
        int si=order[i],type=f->sprites[si].type;
        if(type<0||type>1)continue;
        float sx=f->sprites[si].x-f->px,sy=f->sprites[si].y-f->py;
        float tx=inv*(dy*sx-dx*sy),tz=inv*(-plane_y*sx+plane_x*sy);
        if(tz<=0.1f)continue;
        int sh=(int)((float)f->height/tz);
        if(sh>128)sh=128; /* bounded close-up cost and readable silhouette */
        int sw=sh;
        int center=(int)((float)f->width*0.5f*(1.0f+tx/tz));
        int left=center-sw/2,right=center+sw/2,top=horizon-sh/2,bottom=horizon+sh/2;
        if(left<0)left=0;
        if(right>f->width)right=f->width;
        if(top<0)top=0;
        if(bottom>f->height)bottom=f->height;
        uint8_t us[480];
        for(int x=left;x<right;x++)us[x]=(uint8_t)(((x-(center-sw/2))*16)/sw);
        for(int y=top;y<bottom;y++){
            int v=((y-(horizon-sh/2))*16)/sh;
            if(v<0||v>=16)continue;
            uint16_t *row=f->pixels+(size_t)y*f->stride;
            const char *art=sprite_art[type][v];
            for(int x=left;x<right;x++){
                if(tz>=depth[x]||us[x]>=16)continue;
                char ch=art[us[x]];
                if(ch=='.'||ch==' ')continue;
                int index=ch<='9'?ch-'0':ch-'a'+10;
                row[x]=palette[index&15];
            }
        }
    }
}
