#pragma once

#include "quickjs.h"

/* Register the lume.crypto namespace into the given `lume` object. */
void lume_crypto_register(JSContext *ctx, JSValue lume);
