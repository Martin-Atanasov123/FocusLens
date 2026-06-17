/**
 * Crash reporting via Sentry.
 *
 * HOW TO ACTIVATE:
 *  1. Create a project at https://sentry.io (free tier is fine for MVP).
 *  2. Copy the DSN from Settings → Projects → <project> → Client Keys (DSN).
 *  3. Replace SENTRY_DSN below with the real value.
 *  4. For symbolicated native crashes, also add to app.json plugins:
 *       ["@sentry/react-native/expo", { "organization": "...", "project": "..." }]
 *     and set SENTRY_AUTH_TOKEN in your EAS secrets.
 *
 * Until a real DSN is set, every function is a no-op and the package import
 * is still safe (the module initialises nothing without a valid DSN).
 */
import * as Sentry from "@sentry/react-native";

const SENTRY_DSN = "YOUR_SENTRY_DSN_HERE";

export function isSentryConfigured(): boolean {
  return SENTRY_DSN !== "YOUR_SENTRY_DSN_HERE" && SENTRY_DSN.startsWith("https://");
}

export function initSentry(): void {
  if (!isSentryConfigured()) return;
  Sentry.init({
    dsn: SENTRY_DSN,
    tracesSampleRate: 0,      // crash reports only — no performance traces
    attachScreenshot: false,   // GDPR-friendly default
    debug: false,
  });
}

export function captureException(err: unknown): void {
  if (!isSentryConfigured()) return;
  try { Sentry.captureException(err); } catch {}
}
