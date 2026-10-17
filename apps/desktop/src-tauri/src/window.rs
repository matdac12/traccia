//! Showing, hiding and placing the window (docs/desktop-app.md §2).

use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, LogicalSize, Manager, Runtime, WebviewWindow};

use crate::placement::{bottom_right, outer_rect, Frame, Rect};

pub const MAIN: &str = "main";

/// A click on the tray icon first takes the focus away from the window, which hides it, and only then
/// arrives as a click. A tray click this soon after a focus-loss hide is that same click: it stays hidden.
const BLUR_GRACE: Duration = Duration::from_millis(300);

/// When the window last hid because it lost focus.
#[derive(Default)]
pub struct BlurHide(Mutex<Option<Instant>>);

fn just_hid_on_blur(last: Option<Instant>, now: Instant) -> bool {
    last.is_some_and(|at| now.saturating_duration_since(at) < BLUR_GRACE)
}

fn main_window<R: Runtime>(app: &AppHandle<R>) -> Option<WebviewWindow<R>> {
    app.get_webview_window(MAIN)
}

pub fn show<R: Runtime>(app: &AppHandle<R>) {
    let Some(window) = main_window(app) else { return };
    let _ = place(app, &window);
    let _ = window.show();
    let _ = window.set_always_on_top(true);
    let _ = window.set_focus();
}

pub fn hide<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = main_window(app) {
        let _ = window.hide();
    }
}

/// `--toggle` (Caps+R).
pub fn toggle<R: Runtime>(app: &AppHandle<R>) {
    let Some(window) = main_window(app) else { return };
    if window.is_visible().unwrap_or(false) {
        hide(app);
    } else {
        show(app);
    }
}

/// A left-click on the tray icon.
pub fn toggle_from_tray<R: Runtime>(app: &AppHandle<R>) {
    let last = *app.state::<BlurHide>().0.lock().unwrap();
    if !just_hid_on_blur(last, Instant::now()) {
        toggle(app);
    }
}

/// The window lost focus: the owner clicked elsewhere, so it hides.
///
/// The webview taking the focus inside the window also reports a focus loss, while the window as a
/// whole is still the focused one; that one is ignored.
pub fn hide_on_blur<R: Runtime>(window: &tauri::Window<R>) {
    if window.label() != MAIN || !window.is_visible().unwrap_or(false) || window.is_focused().unwrap_or(false)
    {
        return;
    }
    let _ = window.hide();
    *window.state::<BlurHide>().0.lock().unwrap() = Some(Instant::now());
}

/// Esc in the window (src/app.tsx).
#[tauri::command]
pub fn hide_window<R: Runtime>(app: AppHandle<R>) {
    hide(&app);
}

/// Moves the window to the bottom-right of the work area of the monitor the mouse is on.
fn place<R: Runtime>(app: &AppHandle<R>, window: &WebviewWindow<R>) -> tauri::Result<()> {
    let cursor = app.cursor_position()?;
    let Some(monitor) = app.monitor_from_point(cursor.x, cursor.y)?.or(app.primary_monitor()?) else {
        return Ok(());
    };
    let scale = monitor.scale_factor();
    // The configured size (tauri.conf.json, 380x520) at the target monitor's scale.
    let Some(config) = app.config().app.windows.iter().find(|w| w.label == MAIN) else { return Ok(()) };
    let size = LogicalSize::new(config.width, config.height).to_physical::<u32>(scale);
    let area = monitor.work_area();
    let work_area =
        Rect { x: area.position.x, y: area.position.y, width: area.size.width, height: area.size.height };
    let (x, y) = bottom_right(work_area, (size.width, size.height), scale);
    let content = Rect { x, y, width: size.width, height: size.height };
    // Moving onto a monitor with another scale changes the frame, so measure and set twice.
    set_outer_rect(window, outer_rect(content, frame_of(window)?))?;
    set_outer_rect(window, outer_rect(content, frame_of(window)?))
}

/// The invisible resize border Windows keeps around the content, as it is now.
fn frame_of<R: Runtime>(window: &WebviewWindow<R>) -> tauri::Result<Frame> {
    let (outer, inner) = (window.outer_position()?, window.inner_position()?);
    let (outer_size, inner_size) = (window.outer_size()?, window.inner_size()?);
    let (left, top) = (inner.x - outer.x, inner.y - outer.y);
    Ok(Frame {
        left,
        top,
        right: outer_size.width as i32 - inner_size.width as i32 - left,
        bottom: outer_size.height as i32 - inner_size.height as i32 - top,
    })
}

/// Sets the window's outer rectangle in one call. Tauri's `set_size` miscounts the frame of a frameless
/// window with a shadow (the content lands 43 px off at 150 %), so this goes to Win32 directly.
#[cfg(windows)]
fn set_outer_rect<R: Runtime>(window: &WebviewWindow<R>, rect: Rect) -> tauri::Result<()> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{SetWindowPos, SWP_NOACTIVATE, SWP_NOZORDER};
    let hwnd = window.hwnd()?;
    // SAFETY: `hwnd` is this live window's handle; SetWindowPos takes no other pointers.
    unsafe {
        SetWindowPos(
            hwnd.0,
            std::ptr::null_mut(),
            rect.x,
            rect.y,
            rect.width as i32,
            rect.height as i32,
            SWP_NOZORDER | SWP_NOACTIVATE,
        )
    };
    Ok(())
}

#[cfg(not(windows))]
fn set_outer_rect<R: Runtime>(window: &WebviewWindow<R>, rect: Rect) -> tauri::Result<()> {
    window.set_position(tauri::PhysicalPosition::new(rect.x, rect.y))?;
    window.set_size(tauri::PhysicalSize::new(rect.width, rect.height))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_toggle_right_after_a_focus_loss_hide_is_the_same_click() {
        let hid = Instant::now();
        assert!(just_hid_on_blur(Some(hid), hid + Duration::from_millis(120)));
    }

    #[test]
    fn a_later_toggle_shows_again() {
        let hid = Instant::now();
        assert!(!just_hid_on_blur(Some(hid), hid + Duration::from_millis(800)));
        assert!(!just_hid_on_blur(None, hid));
    }
}
