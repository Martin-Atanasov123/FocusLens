import { requireNativeModule } from "expo-modules-core";

import { FocusBlockerNativeModule } from "./FocusBlocker.types";

// Registered via Name("FocusBlocker") in FocusBlockerModule.kt.
export default requireNativeModule<FocusBlockerNativeModule>("FocusBlocker");
