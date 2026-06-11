import { registerRootComponent } from "expo";

import App from "./src/App";
// Side-effect import: defines the background sync task before the app mounts.
import "./src/sync";

registerRootComponent(App);
