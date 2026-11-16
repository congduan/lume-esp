/*
 * Host unit test for the PURE lume_webserv_parse() (r71). No lwip / IDF.
 *   gcc -std=c11 -Wall -Wextra -Werror \
 *       tests/webserv_parse.c \
 *       firmware/components/lume-net/lume_webserv_parse.c \
 *       -Ifirmware/components/lume-net/include -o /tmp/webserv_parse_test \
 *   && /tmp/webserv_parse_test
 */
#include <stdio.h>
#include <string.h>
#include "lume_webserv.h"

static int checks = 0;
#define CHECK(cond) do { checks++; if (!(cond)) { \
    printf("FAIL line %d: %s\n", __LINE__, #cond); return 1; } } while (0)

#define CAP (LUME_WEB_HEAD_MAX + LUME_WEB_BODY_MAX)

static int test_get(void)
{
    const char *raw = "GET / HTTP/1.1\r\nHost: x\r\n\r\n";
    lume_web_parsed_t p;
    CHECK(lume_webserv_parse(raw, strlen(raw), CAP, &p) == 0);
    CHECK(strcmp(p.method, "GET") == 0);
    CHECK(strcmp(p.path, "/") == 0);
    CHECK(strcmp(p.query, "") == 0);
    CHECK(p.body_len == 0);
    CHECK(strcmp(raw + p.body_offset, "") == 0);
    const char *close_raw = "GET / HTTP/1.1\r\nConnection: close\r\n\r\n";
    CHECK(lume_webserv_parse(close_raw, strlen(close_raw), CAP, &p) == 0);
    CHECK(p.connection_close);
    return 0;
}

static int test_get_query(void)
{
    const char *raw = "GET /api/cards?mode=seq&start=A HTTP/1.0\r\n\r\n";
    lume_web_parsed_t p;
    CHECK(lume_webserv_parse(raw, strlen(raw), CAP, &p) == 0);
    CHECK(strcmp(p.method, "GET") == 0);
    CHECK(strcmp(p.path, "/api/cards") == 0);
    CHECK(strcmp(p.query, "mode=seq&start=A") == 0);
    CHECK(p.body_len == 0);
    return 0;
}

static int test_post_body(void)
{
    const char *raw = "POST /api/config HTTP/1.1\r\nHost: x\r\n"
                      "Content-Type: text/plain\r\nContent-Length: 5\r\n\r\nhello";
    lume_web_parsed_t p;
    CHECK(lume_webserv_parse(raw, strlen(raw), CAP, &p) == 0);
    CHECK(strcmp(p.method, "POST") == 0);
    CHECK(strcmp(p.path, "/api/config") == 0);
    CHECK(p.body_len == 5);
    CHECK(memcmp(raw + p.body_offset, "hello", 5) == 0);
    return 0;
}

static int test_content_length_variants(void)
{
    /* lowercase name + leading spaces + trailing extra bytes after body */
    const char *raw = "post /x HTTP/1.1\r\ncontent-length:   3  \r\n\r\nabcNEXT";
    lume_web_parsed_t p;
    /* lowercase method is rejected (methods are uppercase tokens) */
    CHECK(lume_webserv_parse(raw, strlen(raw), CAP, &p) == -1);

    const char *raw2 = "POST /x HTTP/1.0\r\ncontent-length:   3  \r\n\r\nabcNEXT";
    CHECK(lume_webserv_parse(raw2, strlen(raw2), CAP, &p) == 0);
    CHECK(p.body_len == 3);
    CHECK(memcmp(raw2 + p.body_offset, "abc", 3) == 0);

    /* explicit zero body */
    const char *raw3 = "POST /x HTTP/1.1\r\nContent-Length: 0\r\n\r\n";
    CHECK(lume_webserv_parse(raw3, strlen(raw3), CAP, &p) == 0);
    CHECK(p.body_len == 0);
    return 0;
}

static int test_malformed(void)
{
    lume_web_parsed_t p;
    /* missing header terminator */
    const char *a = "GET / HTTP/1.1\r\nHost: x\r\n";
    CHECK(lume_webserv_parse(a, strlen(a), CAP, &p) == -2);
    /* bad version */
    const char *b = "GET / HTTP/2.0\r\n\r\n";
    CHECK(lume_webserv_parse(b, strlen(b), CAP, &p) == -1);
    /* missing target */
    const char *c = "GET  HTTP/1.1\r\n\r\n";
    CHECK(lume_webserv_parse(c, strlen(c), CAP, &p) == -1);
    /* non-numeric Content-Length */
    const char *d = "POST / HTTP/1.1\r\nContent-Length: abc\r\n\r\nxx";
    CHECK(lume_webserv_parse(d, strlen(d), CAP, &p) == -3);
    /* negative Content-Length */
    const char *e = "POST / HTTP/1.1\r\nContent-Length: -1\r\n\r\n";
    CHECK(lume_webserv_parse(e, strlen(e), CAP, &p) == -3);
    /* Content-Length above the 8 KiB body cap (but within buffer cap) */
    char f[64];
    int fn = snprintf(f, sizeof(f), "POST / HTTP/1.1\r\nContent-Length: 9000\r\n\r\n");
    CHECK(lume_webserv_parse(f, (size_t)fn, CAP, &p) == -4);
    /* incomplete body */
    const char *g = "POST / HTTP/1.1\r\nContent-Length: 5\r\n\r\nhel";
    CHECK(lume_webserv_parse(g, strlen(g), CAP, &p) == -2);
    const char *dup = "POST / HTTP/1.1\r\nContent-Length: 1\r\nContent-Length: 2\r\n\r\nab";
    CHECK(lume_webserv_parse(dup, strlen(dup), CAP, &p) == -3);
    const char *chunk = "POST / HTTP/1.1\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n";
    CHECK(lume_webserv_parse(chunk, strlen(chunk), CAP, &p) == -3);
    const char *overflow = "POST / HTTP/1.1\r\nContent-Length: 184467440737095516161\r\n\r\n";
    CHECK(lume_webserv_parse(overflow, strlen(overflow), CAP, &p) == -3);
    /* embedded NUL in the head */
    const char h[] = { 'G','E','T',' ','/', ' ','H','T','T','P','/','1','.','1','\0','\r','\n','\r','\n' };
    CHECK(lume_webserv_parse(h, sizeof(h), CAP, &p) == -6);
    /* NULL arguments / len > cap */
    CHECK(lume_webserv_parse(NULL, 1, CAP, &p) == -1);
    CHECK(lume_webserv_parse(a, strlen(a), CAP, NULL) == -1);
    CHECK(lume_webserv_parse(a, CAP + 1, CAP, &p) == -1);
    return 0;
}

static int test_bounds(void)
{
    lume_web_parsed_t p;
    char full[LUME_WEB_HEAD_MAX + LUME_WEB_BODY_MAX];
    int prefix = snprintf(full, sizeof(full),
        "POST / HTTP/1.1\r\nContent-Length: 8192\r\n\r\n");
    CHECK(prefix > 0);
    memset(full + prefix, 'x', LUME_WEB_BODY_MAX);
    CHECK(lume_webserv_parse(full, (size_t)prefix + LUME_WEB_BODY_MAX,
                             CAP, &p) == 0);
    CHECK(p.body_len == LUME_WEB_BODY_MAX);
    char raw[LUME_WEB_PATH_MAX + 64];
    /* path one char too long (needs PATH_MAX incl. NUL) */
    int n = snprintf(raw, sizeof(raw), "GET /%0*d HTTP/1.1\r\n\r\n",
                     (int)LUME_WEB_PATH_MAX, 0);
    CHECK(lume_webserv_parse(raw, (size_t)n, CAP, &p) == -5);
    /* query too long */
    char q[LUME_WEB_QUERY_MAX + 64];
    n = snprintf(q, sizeof(q), "GET /?%0*d HTTP/1.1\r\n\r\n",
                 (int)LUME_WEB_QUERY_MAX, 0);
    CHECK(lume_webserv_parse(q, (size_t)n, CAP, &p) == -5);
    return 0;
}

static int test_token_ok(void)
{
    CHECK(lume_webserv_token_ok("key=abc123", "abc123") == true);
    CHECK(lume_webserv_token_ok("mode=seq&key=abc123&start=A", "abc123") == true);
    CHECK(lume_webserv_token_ok("key=abc1234", "abc123") == false);   /* longer */
    CHECK(lume_webserv_token_ok("key=abc12", "abc123") == false);     /* shorter */
    CHECK(lume_webserv_token_ok("mode=seq", "abc123") == false);      /* no key */
    CHECK(lume_webserv_token_ok("keyx=abc123", "abc123") == false);   /* wrong name */
    CHECK(lume_webserv_token_ok("", "abc123") == false);
    CHECK(lume_webserv_token_ok("key=abc123", "") == false);
    return 0;
}

int main(void)
{
    if (test_get() || test_get_query() || test_post_body() ||
        test_content_length_variants() || test_malformed() ||
        test_bounds() || test_token_ok()) return 1;
    printf("webserv_parse: %d checks PASS\n", checks);
    return 0;
}
