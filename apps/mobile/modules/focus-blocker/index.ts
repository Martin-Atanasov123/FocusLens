// Local Expo module: native app-blocking (foreground service + overlay).
// The high-level API lives in src/blocking/FocusBlocker.ts; this re-exports
// the raw native module.
export { default as FocusBlockerModule } from "./src/FocusBlockerModule";
export * from "./src/FocusBlocker.types";
