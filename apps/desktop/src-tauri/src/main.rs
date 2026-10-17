// No console window in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod launch;
mod placement;
mod resident;
mod tray;
mod window;

use launch::{Launch, SecondLaunch};
use tauri::WindowEvent;

fn main() {
    let launch = Launch::parse(std::env::args().skip(1));

    let first = resident::claim();
    // Whichever process ends up showing the window, this launch is the one Windows lets take focus.
    resident::let_resident_take_focus();
    if first && launch.toggle {
        // Never stay resident from a `--toggle` (it may be elevated): start the app through the shell.
        std::process::exit(if resident::relaunch_through_shell().is_ok() { 0 } else { 1 });
    }
    // Otherwise, when an instance is running, the single-instance plugin below hands it our arguments
    // and exits.

    tauri::Builder::default()
        // First, so a second launch exits before anything else starts.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            match Launch::parse(argv).second_launch() {
                SecondLaunch::Toggle => window::toggle(app),
                SecondLaunch::Show => window::show(app),
            }
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .plugin(tauri_plugin_opener::init())
        .manage(window::BlurHide::default())
        .invoke_handler(tauri::generate_handler![window::hide_window])
        .setup(move |app| {
            tray::build(app)?;
            start_at_logon(app);
            if !launch.hidden {
                window::show(app.handle());
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::Focused(false) = event {
                window::hide_on_blur(window);
            }
        })
        .run(tauri::generate_context!())
        .expect("the Desktop app failed to start");
}

/// Registers the logon autostart (with `--hidden`) for this exe's current path. Release builds only,
/// so `tauri dev` never registers a debug build.
fn start_at_logon(app: &tauri::App) {
    #[cfg(not(debug_assertions))]
    {
        use tauri_plugin_autostart::ManagerExt;
        let _ = app.autolaunch().enable();
    }
    #[cfg(debug_assertions)]
    let _ = app;
}
