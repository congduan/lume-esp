#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <time.h>
#include "lume_svg.h"
static void run(const char *name) {
 FILE *f=fopen(name,"rb"); fseek(f,0,SEEK_END); long n=ftell(f); rewind(f);
 uint8_t *s=malloc(n); fread(s,1,n,f); fclose(f);
 for(int i=0;i<10;i++) {uint8_t *out=NULL;uint16_t w=0,h=0;struct timespec a,b;
 clock_gettime(CLOCK_MONOTONIC,&a); int rc=lume_svg_render(s,n,320,320,&out,&w,&h);clock_gettime(CLOCK_MONOTONIC,&b);
 printf("%s %d rc=%d size=%ux%u us=%ld\n",name,i,rc,w,h,(b.tv_sec-a.tv_sec)*1000000L+(b.tv_nsec-a.tv_nsec)/1000L);free(out);}
 free(s);
}
int main(int argc,char **argv){for(int i=1;i<argc;i++)run(argv[i]);}
