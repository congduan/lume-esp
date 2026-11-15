#include "id3v2.h"
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

static uint32_t be32(const uint8_t *p)
{ return ((uint32_t)p[0]<<24)|((uint32_t)p[1]<<16)|((uint32_t)p[2]<<8)|p[3]; }
static uint32_t sync32(const uint8_t *p)
{ return ((uint32_t)p[0]<<21)|((uint32_t)p[1]<<14)|((uint32_t)p[2]<<7)|p[3]; }
static void put_cp(char *out, size_t *n, uint32_t cp)
{
    if (cp < 0x20 || cp == 0x7f) return;
    if (cp < 0x80 && *n+1 < 128) out[(*n)++]=cp;
    else if (cp < 0x800 && *n+2 < 128) { out[(*n)++]=0xc0|(cp>>6); out[(*n)++]=0x80|(cp&63); }
    else if (cp < 0x10000 && *n+3 < 128) { out[(*n)++]=0xe0|(cp>>12); out[(*n)++]=0x80|((cp>>6)&63); out[(*n)++]=0x80|(cp&63); }
    else if (cp <= 0x10ffff && *n+4 < 128) { out[(*n)++]=0xf0|(cp>>18); out[(*n)++]=0x80|((cp>>12)&63); out[(*n)++]=0x80|((cp>>6)&63); out[(*n)++]=0x80|(cp&63); }
}
static void decode(char out[128], const uint8_t *p, size_t len, int unsync)
{
    out[0]=0; if (!len) return;
    uint8_t *clean=malloc(len);
    if (!clean) return;
    size_t k=0;
    for (size_t i=0;i<len;i++) {
        clean[k++]=p[i];
        if (unsync && p[i]==0xff && i+1<len && p[i+1]==0) i++;
    }
    uint8_t enc=clean[0]; p=clean+1; len=k-1;
    size_t n=0;
    if (enc==0) {
        for (size_t i=0;i<len && p[i] && n<124;i++) put_cp(out,&n,p[i]);
    } else if (enc==3) {
        /* Copy valid UTF-8 text; QuickJS/LVGL both consume UTF-8. */
        for (size_t i=0;i<len && p[i] && n<124;) {
            int bytes=p[i]<0x80?1:(p[i]&0xe0)==0xc0?2:(p[i]&0xf0)==0xe0?3:(p[i]&0xf8)==0xf0?4:0;
            if (!bytes || i+(size_t)bytes>len) { i++; continue; }
            int ok=1; for (int j=1;j<bytes;j++) if ((p[i+j]&0xc0)!=0x80) ok=0;
            if (ok && n+(size_t)bytes<128) { memcpy(out+n,p+i,bytes); n+=bytes; }
            i+=bytes;
        }
    } else if (enc==1 && len>=2) {
        int le=p[0]==0xff && p[1]==0xfe;
        if (le || (p[0]==0xfe && p[1]==0xff)) {
            p+=2; len-=2;
            for (size_t i=0;i+1<len && n<124;i+=2) {
                uint32_t cp=le?((uint32_t)p[i]|((uint32_t)p[i+1]<<8)):(((uint32_t)p[i]<<8)|p[i+1]);
                if (!cp) break;
                if (cp>=0xd800 && cp<=0xdbff && i+3<len) {
                    uint32_t low=le?((uint32_t)p[i+2]|((uint32_t)p[i+3]<<8)):(((uint32_t)p[i+2]<<8)|p[i+3]);
                    if (low>=0xdc00 && low<=0xdfff) { cp=0x10000+((cp-0xd800)<<10)+(low-0xdc00); i+=2; }
                    else cp=0xfffd;
                } else if (cp>=0xd800 && cp<=0xdfff) cp=0xfffd;
                put_cp(out,&n,cp);
            }
        }
    }
    out[n]=0; free(clean);
}
int id3v2_parse(FILE *file, char title[128], char artist[128], char album[128])
{
    title[0]=artist[0]=album[0]=0;
    if (fseek(file,0,SEEK_SET)!=0) return -1;
    uint8_t h[10]; if (fread(h,1,10,file)!=10 || memcmp(h,"ID3",3)!=0) return 0;
    int ver=h[3]; if ((ver!=3 && ver!=4) || (h[6]|h[7]|h[8]|h[9])&0x80) return -1;
    uint32_t remaining=sync32(h+6);
    if (remaining>16*1024*1024) return -1;
    if (h[5]&0x40) {
        uint8_t ext[4]; if (remaining<4 || fread(ext,1,4,file)!=4) return -1;
        uint32_t skip=ver==4?sync32(ext):be32(ext);
        if (ver==3) skip+=4;
        if (skip<4 || skip>remaining || fseek(file,(long)skip-4,SEEK_CUR)!=0) return -1;
        remaining-=skip;
    }
    while (remaining>=10) {
        uint8_t f[10]; if (fread(f,1,10,file)!=10) return -1;
        remaining-=10; if (!f[0]) break;
        uint32_t size=ver==4?sync32(f+4):be32(f+4);
        if (size>remaining) return -1;
        char *dest=memcmp(f,"TIT2",4)==0?title:memcmp(f,"TPE1",4)==0?artist:memcmp(f,"TALB",4)==0?album:NULL;
        int unsupported=ver==3?(f[8]&0xc0):(f[9]&0x0c);
        if (dest && !unsupported && size && size<=4096) {
            uint8_t *buf=malloc(size);
            if (!buf) return -1;
            if (fread(buf,1,size,file)!=size) { free(buf); return -1; }
            decode(dest,buf,size,(h[5]&0x80) || (ver==4 && (f[9]&0x02)));
            free(buf);
        } else if (fseek(file,(long)size,SEEK_CUR)!=0) return -1;
        remaining-=size;
    }
    return 1;
}
