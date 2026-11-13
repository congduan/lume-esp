/**
 * Declarative UI → LVGL bridge (M1 stub).
 *
 * M1 target: JS side diffs its virtual tree (View/Text/Button) and posts
 * attribute messages; this component maps them onto lv_obj/lv_label/lv_button
 * calls. LVGL is vendored in M1 next step.
 */
#include <stdio.h>
#include "lume_ui_bridge.h"

void lume_ui_bridge_apply(const lume_attr_msg_t *msg)
{
    /* TODO(M1): node table lookup + lv_obj_set_* mapping */
    (void)msg;
}
