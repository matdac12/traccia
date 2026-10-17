//! Settings (docs/desktop-app.md §7): the API URL and the Owner timezone in a small JSON file in the
//! app's config directory. The Token is not here: it lives in Credential Manager (`secrets.rs`).

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime};

pub const FILE_NAME: &str = "settings.json";
pub const DEFAULT_TIMEZONE: &str = "Europe/Rome";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// The API's base URL, such as `https://<tailnet-host>`, without a trailing slash.
    pub api_url: Option<String>,
    /// IANA name; the front end validates it with `Intl.DateTimeFormat`.
    pub owner_timezone: String,
}

impl Default for Settings {
    fn default() -> Self {
        Settings { api_url: None, owner_timezone: DEFAULT_TIMEZONE.to_string() }
    }
}

impl Settings {
    /// `<API URL>/personal`, the Dashboard's Personal Space, for the tray's "Open dashboard".
    pub fn dashboard_url(&self) -> Option<String> {
        self.api_url.as_ref().map(|url| format!("{}/personal", url.trim_end_matches('/')))
    }
}

/// `settings.json` in the app's config directory (`%APPDATA%\app.traccia.desktop`).
pub fn path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|_| "the app's config directory is unavailable")?;
    Ok(dir.join(FILE_NAME))
}

/// The app's saved Settings, or the defaults.
pub fn load<R: Runtime>(app: &AppHandle<R>) -> Settings {
    path(app).map(|path| read(&path)).unwrap_or_default()
}

/// The saved Settings, or the defaults when there is no file yet (a fresh install) or it is unreadable.
pub fn read(path: &Path) -> Settings {
    fs::read_to_string(path).ok().and_then(|text| serde_json::from_str(&text).ok()).unwrap_or_default()
}

pub fn write(path: &Path, settings: &Settings) -> io::Result<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let text = serde_json::to_string_pretty(settings).map_err(io::Error::other)?;
    fs::write(path, text)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn temp_file(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("traccia-desktop-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir.join(FILE_NAME)
    }

    #[test]
    fn a_fresh_install_has_no_api_url_and_rome() {
        let path = temp_file("fresh");
        assert_eq!(read(&path), Settings { api_url: None, owner_timezone: "Europe/Rome".into() });
    }

    #[test]
    fn round_trips_through_the_file_as_camel_case_json() {
        let path = temp_file("round-trip");
        let settings = Settings {
            api_url: Some("https://box.tail.ts.net".into()),
            owner_timezone: "Europe/London".into(),
        };
        write(&path, &settings).unwrap();
        let text = fs::read_to_string(&path).unwrap();
        assert!(text.contains(r#""apiUrl": "https://box.tail.ts.net""#));
        assert!(text.contains(r#""ownerTimezone": "Europe/London""#));
        assert_eq!(read(&path), settings);
        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn opens_the_dashboard_under_the_api_url() {
        let settings = Settings { api_url: Some("https://box.tail.ts.net/".into()), ..Settings::default() };
        assert_eq!(settings.dashboard_url().as_deref(), Some("https://box.tail.ts.net/personal"));
        assert_eq!(Settings::default().dashboard_url(), None);
    }
}
