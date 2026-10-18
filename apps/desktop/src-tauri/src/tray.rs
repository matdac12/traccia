//! The tray icon (docs/desktop-app.md §2): left-click shows or hides; a menu for the rest.

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{App, AppHandle, Manager, Runtime, Wry};
use tauri_plugin_opener::OpenerExt;

use crate::{settings, window};

const OPEN_DASHBOARD: &str = "open-dashboard";
const SETTINGS: &str = "settings";
const QUIT: &str = "quit";

/// The menu item that needs the API URL, kept to enable it once Settings has one.
struct OpenDashboard(MenuItem<Wry>);

pub fn build(app: &App) -> tauri::Result<()> {
    // "Open dashboard" opens `<API URL>/personal`, so it waits for an API URL in Settings.
    let has_api_url = settings::load(app.handle()).api_url.is_some();
    let open_dashboard = MenuItem::with_id(app, OPEN_DASHBOARD, "Open dashboard", has_api_url, None::<&str>)?;
    let settings_item = MenuItem::with_id(app, SETTINGS, "Settings…", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, QUIT, "Quit", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&open_dashboard, &settings_item, &separator, &quit])?;

    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("Traccia")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            OPEN_DASHBOARD => open_dashboard_in_browser(app),
            SETTINGS => window::show_settings(app),
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
    app.manage(OpenDashboard(open_dashboard));
    Ok(())
}

pub fn enable_open_dashboard<R: Runtime>(app: &AppHandle<R>, enabled: bool) {
    if let Some(item) = app.try_state::<OpenDashboard>() {
        let _ = item.inner().0.set_enabled(enabled);
    }
}

fn open_dashboard_in_browser<R: Runtime>(app: &AppHandle<R>) {
    if let Some(url) = settings::load(app).dashboard_url() {
        let _ = app.opener().open_url(url, None::<&str>);
    }
}
