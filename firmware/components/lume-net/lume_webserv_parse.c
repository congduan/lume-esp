/**
 * lume_webserv_parse — PURE minimal HTTP/1.0 request parser (r71).
 *
 * No lwip / FreeRTOS / QuickJS dependency: this file is compiled both into
 * the firmware component and directly into tests/webserv_parse.c with gcc.
 * It only slices a COMPLETE request buffer into a POD result; the transport
 * layer (lume_webserv.c) owns buffering, timeouts and auth.
 */
#include <stdint.h>
#include <string.h>
#include "lume_webserv.h"

/* Case-insensitive "name" prefix compare, bounded, no libc locale. */
static bool ci_prefix(const char *s, size_t n, const char *lit)
{
    size_t i = 0;
    for (; i < n && lit[i] != '\0'; i++) {
        char a = s[i], b = lit[i];
        if (a >= 'A' && a <= 'Z') a = (char)(a - 'A' + 'a');
        if (b >= 'A' && b <= 'Z') b = (char)(b - 'A' + 'a');
        if (a != b) return false;
    }
    return lit[i] == '\0';
}

/* Find a needle in buf[0..len), returning its offset or SIZE_MAX. */
static size_t find_bytes(const char *buf, size_t len, const char *needle, size_t nlen)
{
    if (nlen == 0 || len < nlen) return SIZE_MAX;
    for (size_t i = 0; i + nlen <= len; i++) {
        if (memcmp(buf + i, needle, nlen) == 0) return i;
    }
    return SIZE_MAX;
}

/* Parse an unsigned decimal field, bounded by cap. Returns false on any
 * non-digit / empty / overflow. Leading spaces are skipped by the caller. */
static bool parse_size(const char *s, size_t n, size_t cap, size_t *out)
{
    if (n == 0) return false;
    size_t v = 0;
    for (size_t i = 0; i < n; i++) {
        if (s[i] < '0' || s[i] > '9') return false;
        size_t d = (size_t)(s[i] - '0');
        if (d > cap || v > (cap - d) / 10) return false;
        v = v * 10 + d;
    }
    *out = v;
    return true;
}

int lume_webserv_parse(const char *buf, size_t len, size_t cap,
                       lume_web_parsed_t *out)
{
    if (buf == NULL || out == NULL || cap == 0 || len > cap) return -1;
    memset(out, 0, sizeof(*out));

    /* 1. Request line: "METHOD SP TARGET SP HTTP/1.x\r\n". */
    size_t line_end = find_bytes(buf, len, "\r\n", 2);
    if (line_end == SIZE_MAX || line_end == 0) return -1;
    if (memchr(buf, '\0', line_end) != NULL) return -6;
    const char *line = buf;

    size_t sp1 = SIZE_MAX, sp2 = SIZE_MAX;
    for (size_t i = 0; i < line_end; i++) {
        if (line[i] == ' ') {
            if (sp1 == SIZE_MAX) sp1 = i;
            else { sp2 = i; break; }
        }
    }
    if (sp1 == SIZE_MAX || sp2 == SIZE_MAX || sp2 == sp1 + 1) return -1;
    size_t mlen = sp1;
    if (mlen == 0 || mlen >= LUME_WEB_METHOD_MAX) return -1;
    for (size_t i = 0; i < mlen; i++) {
        if (line[i] < 'A' || line[i] > 'Z') return -1;
    }
    /* Version must be HTTP/1.0 or HTTP/1.1 (HTTP/1.<single digit>). */
    size_t vpos = sp2 + 1;
    if (line_end - vpos != 8 || memcmp(line + vpos, "HTTP/1.", 7) != 0 ||
        (line[vpos + 7] != '0' && line[vpos + 7] != '1')) return -1;

    /* 2. Target -> path + raw query (no decoding: routes are exact strings). */
    size_t tstart = sp1 + 1, tlen = sp2 - tstart;
    if (tlen == 0 || line[tstart] != '/') return -1;
    size_t qmark = SIZE_MAX;
    for (size_t i = tstart; i < sp2; i++) {
        if (line[i] == '?') { qmark = i; break; }
    }
    size_t plen = (qmark == SIZE_MAX ? sp2 : qmark) - tstart;
    if (plen == 0 || plen >= LUME_WEB_PATH_MAX) return -5;
    memcpy(out->path, line + tstart, plen);       /* NUL from memset */
    if (qmark != SIZE_MAX) {
        size_t qlen = sp2 - (qmark + 1);
        if (qlen >= LUME_WEB_QUERY_MAX) return -5;
        memcpy(out->query, line + qmark + 1, qlen);
    }
    memcpy(out->method, line, mlen);

    /* 3. Header terminator + bounded head. */
    size_t head = find_bytes(buf, len, "\r\n\r\n", 4);
    if (head == SIZE_MAX) return -2;
    if (head + 4 > LUME_WEB_HEAD_MAX) return -1;
    if (memchr(buf, '\0', head + 4) != NULL) return -6;
    size_t body_off = head + 4;

    /* 4. Content-Length (the only header we need). */
    size_t content_len = 0;
    bool seen_length = false;
    size_t pos = line_end + 2;
    /* Include the terminator's first CRLF: the last header line's CRLF *is*
     * the first two bytes of the "\r\n\r\n" separator. */
    while (pos < head + 2) {
        size_t eol = find_bytes(buf + pos, head + 2 - pos, "\r\n", 2);
        if (eol == SIZE_MAX) break;
        if (ci_prefix(buf + pos, eol, "Content-Length:")) {
            if (seen_length) return -3;
            seen_length = true;
            size_t k = 15, vend = eol;           /* strlen("Content-Length:") */
            while (k < vend && (buf[pos + k] == ' ' || buf[pos + k] == '\t')) k++;
            while (vend > k && (buf[pos + vend - 1] == ' ' ||
                                buf[pos + vend - 1] == '\t')) vend--;
            if (!parse_size(buf + pos + k, vend - k, SIZE_MAX,
                            &content_len)) return -3;
        } else if (ci_prefix(buf + pos, eol, "Transfer-Encoding:")) {
            return -3; /* chunked framing is unsupported */
        } else if (ci_prefix(buf + pos, eol, "Connection:")) {
            size_t k = 11;
            while (k < eol && (buf[pos + k] == ' ' || buf[pos + k] == '\t')) k++;
            out->connection_close = (eol - k == 5 &&
                ci_prefix(buf + pos + k, 5, "close"));
        }
        pos += eol + 2;
    }
    if (content_len > LUME_WEB_BODY_MAX) return -4;
    if (content_len > len - body_off) return -2;  /* incomplete body */

    out->body_offset = body_off;
    out->body_len = content_len;
    return 0;
}

/* Constant-time-ish compare of the `key=<token>` query parameter. Kept here
 * (pure) so the host test can exercise the auth boundary without lwip. */
bool lume_webserv_token_ok(const char *query, const char *token)
{
    if (query == NULL || token == NULL || token[0] == '\0') return false;
    size_t tlen = strlen(token);
    const char *p = query;
    while (*p != '\0') {
        const char *amp = strchr(p, '&');
        size_t plen = amp != NULL ? (size_t)(amp - p) : strlen(p);
        static const char key[] = "key=";
        if (plen > sizeof(key) - 1 && memcmp(p, key, sizeof(key) - 1) == 0) {
            const char *val = p + sizeof(key) - 1;
            size_t vlen = plen - (sizeof(key) - 1);
            if (vlen != tlen) return false;
            uint8_t diff = 0;
            for (size_t i = 0; i < tlen; i++) diff |= (uint8_t)(val[i] ^ token[i]);
            return diff == 0;
        }
        if (amp == NULL) break;
        p = amp + 1;
    }
    return false;
}
