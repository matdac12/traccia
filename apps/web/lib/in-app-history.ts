/**
 * Whether this document has navigated inside the app at least once: the fallback for browsers without the
 * Navigation API (Firefox, Safari), where `window.navigation.canGoBack` is not there to ask. Module state lives as
 * long as the document, so a reload, a new tab and a deep link all start at zero, which is exactly when Back must
 * fall back to the project page.
 */
let lastLocation: string | null = null;
let navigations = 0;

/** Called by `InAppHistoryTracker` on every location change; the first call is the entry the document loaded on. */
export function recordLocation(location: string) {
  if (lastLocation !== null && lastLocation !== location) navigations += 1;
  lastLocation = location;
}

/** True when the user moved between app locations since this document loaded, so `history.back()` stays in the app. */
export function hasNavigatedInApp() {
  return navigations > 0;
}

/** Test seam. */
export function resetInAppHistory() {
  lastLocation = null;
  navigations = 0;
}
