/** Desktop sidebar state (TRC-98). A cookie, not localStorage, so the server can render the right width on the first paint. */
export const SIDEBAR_COOKIE = "traccia_sidebar";
const MAX_AGE = 60 * 60 * 24 * 365;

/** Expanded unless the cookie says `collapsed`: a missing or unknown value is the default layout. */
export function parseSidebarCookie(value: string | undefined): boolean {
  return value === "collapsed";
}

export function sidebarCookie(collapsed: boolean): string {
  return `${SIDEBAR_COOKIE}=${collapsed ? "collapsed" : "expanded"}; path=/; max-age=${MAX_AGE}; samesite=lax`;
}
