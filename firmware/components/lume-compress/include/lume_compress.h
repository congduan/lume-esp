#pragma once

#include "quickjs.h"

/* Register the lume.compress namespace into the given `lume` object. */
void lume_compress_register(JSContext *ctx, JSValue lume);
