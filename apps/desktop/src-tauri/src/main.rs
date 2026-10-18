// No console window in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod api;
mod autostart;
mod commands;
mod launch;
mod placement;
mod resident;
mod secrets;
mod settings;
mod tray;
mod window;

use launch::{Launch, SecondLaunch};
use tauri::WindowEvent;

fn main() {
    let launch = Launch::parse(std::env::args().skip(1));

    let claim = resident::claim();
    let first = claim.first;
    // Whichever process ends up showing the window, this launch is the one Windows lets take focus.
    resident::let_resident_take_focus();
    if resident::start(first, launch.toggle, resident::is_elevated()) == resident::Start::RelaunchThroughShell
    {
        // Never stay resident from an elevated `--toggle`: start the app through the shell, unelevated.
        std::process::exit(if resident::relaunch_through_shell(claim).is_ok() { 0 } else { 1 });
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
        .plugin(tauri_plugin_opener::init())
        .manage(window::BlurHide::default())
        .manage(commands::Http(api::client()))
        .invoke_handler(tauri::generate_handler![
            window::hide_window,
            commands::load_settings,
            commands::save_settings,
            commands::api,
            commands::test_connection,
            commands::open_url,
        ])
        .setup(move |app| {
            if !first {
                // Another instance holds the claim but its single-instance listener wasn't up yet, so
                // the plugin let this launch through. Never become a second resident (it may be
                // elevated); the keypress is lost, which is the lesser harm.
                std::process::exit(0);
            }
            tray::build(app)?;
            autostart::register();
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
