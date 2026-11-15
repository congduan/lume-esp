#include "../firmware/components/mp3_decoder/include/id3v2.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>
#include <stdint.h>
static void frame(FILE *f,const char *id,const uint8_t *data,size_t n,int v4) {
    fwrite(id,1,4,f);
    uint8_t size[6]={n>>24,n>>16,n>>8,n,0,0};
    if (v4) { size[0]=n>>21; size[1]=(n>>14)&127; size[2]=(n>>7)&127; size[3]=n&127; }
    fwrite(size,1,6,f); fwrite(data,1,n,f);
}
static void check(int version,int unsync,const uint8_t *title,size_t tlen,const char *expected) {
    FILE *f=tmpfile(); assert(f);
    uint32_t body=10+tlen+10+7+10+8;
    uint8_t h[10]={'I','D','3',version,0,unsync?0x80:0,body>>21,(body>>14)&127,(body>>7)&127,body&127};
    fwrite(h,1,10,f);
    frame(f,"TIT2",title,tlen,version==4);
    const uint8_t artist[]={0,'B',0xe9,'a','t'};
    frame(f,"TPE1",artist,sizeof artist,version==4);
    const uint8_t album[]={3,'A','l','b','u','m',0};
    frame(f,"TALB",album,sizeof album,version==4);
    char t[128],a[128],b[128];
    assert(id3v2_parse(f,t,a,b)==1);
    assert(strcmp(t,expected)==0); assert(strcmp(a,"Béat")==0); assert(strcmp(b,"Album")==0);
    printf("ID3v2.%d %s: title=%s artist=%s album=%s PASS\n",version,unsync?"unsync":"encoding",t,a,b);
    fclose(f);
}
int main(void) {
    const uint8_t utf16[]={1,0xff,0xfe,'H',0,'i',0};
    const uint8_t utf16be[]={1,0xfe,0xff,0,'B',0,'E'};
    const uint8_t utf8[]={3,'C','a','f',0xc3,0xa9};
    const uint8_t latin[]={0,'F',0xff,0,'x'};
    check(3,0,utf16,sizeof utf16,"Hi");
    check(4,0,utf16be,sizeof utf16be,"BE");
    check(4,0,utf8,sizeof utf8,"Café");
    check(3,1,latin,sizeof latin,"Fÿx");
}
