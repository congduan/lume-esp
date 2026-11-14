/* Host protocol ABI check: numeric prelude IDs and fixed-size queue record. */
#include "lume_ui_bridge.h"
_Static_assert(LUME_ATTR_TEXT == 0 && LUME_ATTR_PARENT == 6, "M1 ABI");
_Static_assert(LUME_ATTR_FLEX_FLOW == 7 && LUME_ATTR_FLEX_MAIN_ALIGN == 8 &&
               LUME_ATTR_FLEX_CROSS_ALIGN == 9 && LUME_ATTR_PADDING == 10 &&
               LUME_ATTR_GAP == 11 && LUME_ATTR_RADIUS == 12 &&
               LUME_ATTR_BORDER_WIDTH == 13 && LUME_ATTR_BORDER_COLOR == 14 &&
               LUME_ATTR_OPACITY == 15 && LUME_ATTR_WIDTH_PCT == 16 &&
               LUME_ATTR_HEIGHT_PCT == 17 && LUME_ATTR_X == 18 &&
               LUME_ATTR_Y == 19, "M3 ABI");
_Static_assert(LUME_NODE_ARC == 5, "arc node id");
_Static_assert(LUME_ATTR_ARC_VALUE == 24 && LUME_ATTR_ARC_START == 25 &&
               LUME_ATTR_ARC_END == 26 && LUME_ATTR_ARC_THICKNESS == 27 &&
               LUME_ATTR_ARC_TRACK == 28 && LUME_ATTR_ARC_COLOR == 29,
               "arc attribute ids");
_Static_assert(LUME_ATTR_ARC_COLOR == 29, "arc colour id");
_Static_assert(LUME_ATTR_PAD_TOP == 30 && LUME_ATTR_PAD_RIGHT == 31 &&
               LUME_ATTR_PAD_BOTTOM == 32 && LUME_ATTR_PAD_LEFT == 33 &&
               LUME_ATTR_MARGIN == 34 && LUME_ATTR_MARGIN_TOP == 35 &&
               LUME_ATTR_MARGIN_RIGHT == 36 && LUME_ATTR_MARGIN_BOTTOM == 37 &&
               LUME_ATTR_MARGIN_LEFT == 38 && LUME_ATTR_FLEX_GROW == 39 &&
               LUME_ATTR_ALIGN_TARGET == 40 && LUME_ATTR_ALIGN_OFS_X == 41 &&
               LUME_ATTR_ALIGN_OFS_Y == 42, "layout extension attribute ids");
_Static_assert(LUME_ALIGN_TARGET_PARENT == 0 && LUME_ALIGN_RIGHT_MID == 8,
               "align wire values");
_Static_assert(sizeof(lume_ui_msg_t) <= 112, "bounded copy message");
_Static_assert(LUME_NODE_CANVAS == 3 && LUME_OP_CANVAS_DRAW == 6 &&
               LUME_OP_CANVAS_INVALIDATE == 7, "canvas wire ids");
_Static_assert(LUME_NODE_IMAGE == 4 && LUME_OP_IMAGE_SOURCE == 10, "image wire ids");
_Static_assert(LUME_FLEX_SPACE_BETWEEN == 3 && LUME_FLEX_CROSS_STRETCH == 3,
               "axis-specific align wire values");
int main(void) { return 0; }
