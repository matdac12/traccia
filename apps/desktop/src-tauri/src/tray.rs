//! The tray icon (docs/desktop-app.md §2): left-click shows or hides; a menu for the rest.

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::App;

use crate::window;

const OPEN_DASHBOARD: &str = "open-dashboard";
const SETTINGS: &str = "settings";
const QUIT: &str = "quit";

pub fn build(app: &App) -> tauri::Result<()> {
    // "Open dashboard" opens `<API URL>/personal`; the API URL arrives with Settings (TRC-169).
    let open_dashboard = MenuItem::with_id(app, OPEN_DASHBOARD, "Open dashboard", false, None::<&str>)?;
    // A placeholder until Settings exists (TRC-169): it shows the window.
    let settings = MenuItem::with_id(app, SETTINGS, "Settings…", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, QUIT, "Quit", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&open_dashboard, &settings, &separator, &quit])?;

    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("Traccia")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            SETTINGS => window::show(app),
            QUIT => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                window::toggle_from_tray(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}
