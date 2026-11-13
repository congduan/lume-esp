/**
 * Lume engine: QuickJS-NG task with PSRAM heap.
 *
 * M1 scope:
 *  - engine task pinned to a core, ~32MB JS heap cap from PSRAM
 *  - built-in bytecode bundle (embedded fallback app)
 *  - event queue: drivers (touch, PMIC IRQ, TF detect) post events here
 *
 * The QuickJS-NG component itself is vendored separately (M1 next step:
 * vendor quickjs-ng as components/quickjs-ng with ESP-IDF port).
 */
#include <stdio.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include "esp_log.h"
#include "esp_heap_caps.h"
#include "lume_engine.h"
#include "quickjs.h"

static const char *TAG = "lume-engine";

static QueueHandle_t s_evt_queue;

void lume_engine_post_event(const uint8_t *data, size_t len)
{
    /* M1: queue of fixed-size event records; drivers serialize their payload */
    xQueueSend(s_evt_queue, data, 0);
}

static void engine_task(void *arg)
{
    size_t psram_free = heap_caps_get_free_size(MALLOC_CAP_SPIRAM);
    ESP_LOGI(TAG, "engine task running, PSRAM free=%u bytes", (unsigned)psram_free);

    /* M1 smoke: prove the vendored QuickJS-NG engine links and executes on
     * target. Expected console line: "js eval: 2". The PSRAM-backed allocator,
     * embedded bytecode bundle and event loop land in the next step. */
    JSRuntime *rt = JS_NewRuntime();
    if (rt == NULL) {
        ESP_LOGE(TAG, "JS_NewRuntime failed");
    } else {
        JSContext *ctx = JS_NewContext(rt);
        if (ctx == NULL) {
            ESP_LOGE(TAG, "JS_NewContext failed");
        } else {
            static const char script[] = "1+1";
            JSValue val = JS_Eval(ctx, script, sizeof(script) - 1, "<lume-smoke>",
                                  JS_EVAL_TYPE_GLOBAL);
            if (JS_IsException(val)) {
                JSValue exc = JS_GetException(ctx);
                const char *msg = JS_ToCString(ctx, exc);
                ESP_LOGE(TAG, "js eval exception: %s", msg ? msg : "(unknown)");
                if (msg) {
                    JS_FreeCString(ctx, msg);
                }
                JS_FreeValue(ctx, exc);
            } else {
                int32_t result = 0;
                JS_ToInt32(ctx, &result, val);
                ESP_LOGI(TAG, "js eval: %d", (int)result);
            }
            JS_FreeValue(ctx, val);
            JS_FreeContext(ctx);
        }
        JS_FreeRuntime(rt);
    }
    for (;;) {
        uint8_t evt[32];
        if (xQueueReceive(s_evt_queue, evt, portMAX_DELAY) == pdTRUE) {
            /* dispatch to JS callback (wired when engine lands) */
        }
    }
}

void lume_engine_start(void)
{
    s_evt_queue = xQueueCreate(16, 32);
    xTaskCreatePinnedToCore(engine_task, "lume-js", 16384, NULL, 5, NULL, 1);
}
