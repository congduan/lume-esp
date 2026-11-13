#pragma once
#include <stdint.h>
#include <stddef.h>

/* Declarative UI node kinds (M1: VIEW, TEXT, BUTTON) */
typedef enum {
    LUME_NODE_VIEW = 0,
    LUME_NODE_TEXT,
    LUME_NODE_BUTTON,
} lume_node_kind_t;

/* One attribute update in the declarative diff stream. */
typedef struct {
    uint16_t node_id;
    uint8_t  kind;        /* lume_node_kind_t */
    uint8_t  attr;        /* ATTR_* */
    int32_t  value;       /* numeric value or string pool index */
} lume_attr_msg_t;

/* Bridge consumes diff messages from JS and applies them to LVGL. */
void lume_ui_bridge_apply(const lume_attr_msg_t *msg);
