/* Host protocol ABI check: numeric prelude IDs and fixed-size queue record. */
#include "lume_ui_bridge.h"
_Static_assert(LUME_ATTR_TEXT == 0 && LUME_ATTR_PARENT == 6, "M1 ABI");
_Static_assert(LUME_ATTR_FLEX_FLOW == 7 && LUME_ATTR_FLEX_MAIN_ALIGN == 8 &&
               LUME_ATTR_FLEX_CROSS_ALIGN == 9 && LUME_ATTR_PADDING == 10 &&
               LUME_ATTR_GAP == 11 && LUME_ATTR_RADIUS == 12 &&
               LUME_ATTR_BORDER_WIDTH == 13 && LUME_ATTR_BORDER_COLOR == 14 &&
               LUME_ATTR_OPACITY == 15 && LUME_ATTR_WIDTH_PCT == 16 &&
               LUME_ATTR_HEIGHT_PCT == 17, "M3 ABI");
_Static_assert(sizeof(lume_ui_msg_t) == 76, "fixed-size copy message");
_Static_assert(LUME_FLEX_SPACE_BETWEEN == 3 && LUME_FLEX_CROSS_STRETCH == 3,
               "axis-specific align wire values");
int main(void) { return 0; }
