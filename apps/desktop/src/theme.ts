/**
 * Follows the Windows light or dark setting, live (docs/desktop-app.md §2). WebView2 reports the
 * Windows app mode as `prefers-color-scheme`; the Dashboard's tokens switch on a `dark` class.
 * Returns a function that stops following.
 */
export function followSystemTheme(
  root: HTMLElement,
  media: MediaQueryList = window.matchMedia("(prefers-color-scheme: dark)"),
): () => void {
  const apply = () => root.classList.toggle("dark", media.matches);
  apply();
  media.addEventListener("change", apply);
  return () => media.removeEventListener("change", apply);
}
