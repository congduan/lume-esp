#define MINIMP3_IMPLEMENTATION
#define MINIMP3_ONLY_MP3
#include "minimp3.h"
#include "mp3_decoder.h"
#include "id3v2.h"
#include "lume_pins.h"
#include "driver/spi_master.h"
#include "driver/sdspi_host.h"
#include "esp_vfs_fat.h"
#include "sdmmc_cmd.h"
#include <dirent.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define CARD_ROOT "/lume_sd"
#define INPUT_BYTES 4096
struct mp3_decoder {
    FILE *file;
    mp3dec_t decoder;
    uint8_t input[INPUT_BYTES];
    size_t available, offset, size;
    int eof;
};
#if defined(LUME_PIN_SD_MOSI) && defined(LUME_PIN_SD_CLK) && \
    defined(LUME_PIN_SD_MISO) && defined(LUME_PIN_SD_CS)
static int card_ready;
static sdmmc_card_t *card;
#endif
static int mount_card(void)
{
#if defined(LUME_PIN_SD_MOSI) && defined(LUME_PIN_SD_CLK) && \
    defined(LUME_PIN_SD_MISO) && defined(LUME_PIN_SD_CS)
    if (card_ready) return 0;
    sdmmc_host_t host = SDSPI_HOST_DEFAULT();
    host.slot = SPI3_HOST;
    spi_bus_config_t bus = {.mosi_io_num=LUME_PIN_SD_MOSI,
        .miso_io_num=LUME_PIN_SD_MISO,.sclk_io_num=LUME_PIN_SD_CLK,
        .quadwp_io_num=-1,.quadhd_io_num=-1,.max_transfer_sz=4096};
    if (spi_bus_initialize(host.slot, &bus, SDSPI_DEFAULT_DMA) != ESP_OK) return -2;
    sdspi_device_config_t slot = SDSPI_DEVICE_CONFIG_DEFAULT();
    slot.gpio_cs = LUME_PIN_SD_CS;
    slot.host_id = host.slot;
    esp_vfs_fat_sdmmc_mount_config_t cfg = {.format_if_mount_failed=false,
        .max_files=4,.allocation_unit_size=16*1024};
    if (esp_vfs_fat_sdspi_mount(CARD_ROOT, &host, &slot, &cfg, &card) != ESP_OK) {
        spi_bus_free(host.slot);
        return -2;
    }
    card_ready = 1;
    return 0;
#else
    return -2; /* No TF slot on this board. */
#endif
}
static int card_path(const char *path, char *out, size_t cap)
{
    if (!path || path[0] != '/' || strlen(path) > 220) return -1;
    for (const char *p=path+1; *p; ++p)
        if (*p == '\\' || (p[0] == '.' && (p[1] == '.' || p[1] == '/'))) return -1;
    if (snprintf(out, cap, "%s%s", CARD_ROOT, path) >= cap) return -1;
    return 0;
}
int mp3_decoder_list(const char *dir, void (*emit)(void *, const char *), void *arg)
{
    char path[240];
    if (card_path(dir, path, sizeof path) < 0) return -1;
    if (mount_card() < 0) return -2;
    DIR *d = opendir(path);
    if (!d) return -2;
    struct dirent *e;
    while ((e = readdir(d))) if (e->d_name[0] != '.') emit(arg,e->d_name);
    closedir(d);
    return 0;
}
int mp3_decoder_read_text(const char *name, char *out, size_t cap)
{
    char path[240];
    if (!out || cap < 2 || card_path(name,path,sizeof path) < 0) return -1;
    if (mount_card() < 0) return -2;
    FILE *f=fopen(path,"rb");
    if (!f) return -2;
    size_t n=fread(out,1,cap-1,f);
    int more=fgetc(f);
    fclose(f);
    out[n]=0;
    return more == EOF ? (int)n : -1;
}
static void id3_field(char *out, const uint8_t *src)
{
    int n=30;
    while (n>0 && (src[n-1]==' ' || src[n-1]==0)) --n;
    int j=0;
    for (int i=0;i<n;i++) {
        if (src[i]<0x20) continue;
        if (src[i]<0x80) out[j++]=src[i];
        else { out[j++]=(char)(0xc0 | (src[i]>>6)); out[j++]=(char)(0x80 | (src[i]&63)); }
    }
    out[j]=0;
}
int mp3_decoder_id3v1(const char *name, char *title, char *artist)
{
    char path[240];
    if (!title || !artist || card_path(name,path,sizeof path)<0) return -1;
    title[0]=artist[0]=0;
    if (mount_card()<0) return -2;
    FILE *f=fopen(path,"rb");
    if (!f) return -2;
    uint8_t tag[128];
    int ok=fseek(f,-128,SEEK_END)==0 && fread(tag,1,128,f)==128 &&
           memcmp(tag,"TAG",3)==0;
    fclose(f);
    if (!ok) return 0;
    id3_field(title,tag+3); id3_field(artist,tag+33);
    return 1;
}
int mp3_decoder_id3v2(const char *name, char title[128], char artist[128], char album[128])
{
    char path[240];
    if (!title || !artist || !album || card_path(name,path,sizeof path)<0) return -1;
    if (mount_card()<0) return -2;
    FILE *f=fopen(path,"rb"); if (!f) return -2;
    int r=id3v2_parse(f,title,artist,album);
    fclose(f); return r;
}
int mp3_decoder_open(const char *name, mp3_decoder_t **out)
{
    char path[240];
    if (!out || card_path(name,path,sizeof path)<0) return -1;
    *out=NULL;
    if (mount_card()<0) return -2;
    FILE *f=fopen(path,"rb");
    if (!f) return -2;
    if (fseek(f,0,SEEK_END)!=0) { fclose(f); return -2; }
    long size=ftell(f);
    if (size<=0 || fseek(f,0,SEEK_SET)!=0) { fclose(f); return -2; }
    mp3_decoder_t *h=calloc(1,sizeof *h);
    if (!h) { fclose(f); return -4; }
    h->file=f; h->size=(size_t)size; mp3dec_init(&h->decoder);
    *out=h;
    return 0;
}
int mp3_decoder_decode(mp3_decoder_t *h, int16_t *pcm, mp3_frame_info_t *info)
{
    if (!h || !pcm || !info) return -1;
    for (;;) {
        if (!h->eof && h->available < INPUT_BYTES/2) {
            memmove(h->input,h->input+h->offset,h->available);
            h->offset=0;
            size_t got=fread(h->input+h->available,1,INPUT_BYTES-h->available,h->file);
            h->available+=got;
            if (!got) h->eof=1;
        }
        if (!h->available) return 0;
        mp3dec_frame_info_t frame={0};
        int samples=mp3dec_decode_frame(&h->decoder,h->input+h->offset,
                                          (int)h->available,pcm,&frame);
        if (frame.frame_bytes <= 0) {
            if (!h->eof && h->available < INPUT_BYTES) continue;
            h->offset++; h->available--; continue;
        }
        h->offset+=frame.frame_bytes; h->available-=frame.frame_bytes;
        if (!samples) continue;
        info->samples=samples; info->sample_rate=frame.hz;
        info->channels=frame.channels; info->bitrate_kbps=frame.bitrate_kbps;
        info->byte_offset=(size_t)ftell(h->file)-h->available;
        info->file_bytes=h->size;
        return 1;
    }
}
void mp3_decoder_close(mp3_decoder_t *h)
{ if (h) { fclose(h->file); free(h); } }
