//! What the front end can ask of the Rust side for Settings and the API (docs/desktop-app.md §6, §7).
//! The Token goes in (from the Settings form) but never comes back out.

use reqwest::Client;
use serde::Serialize;
use tauri::{AppHandle, Runtime, State};
use tauri_plugin_opener::OpenerExt;

use crate::api::{self, ApiOutcome};
use crate::{secrets, settings, tray};

/// The one HTTP client, so connections to the API are reused.
pub struct Http(pub Client);

/// Settings as the form sees them: whether a Token is saved, never the Token.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsView {
    api_url: Option<String>,
    owner_timezone: String,
    has_token: bool,
}

impl SettingsView {
    fn new(saved: settings::Settings, has_token: bool) -> Self {
        SettingsView { api_url: saved.api_url, owner_timezone: saved.owner_timezone, has_token }
    }
}

/// An `http://` or `https://` URL with a host.
fn is_web_url(input: &str) -> bool {
    reqwest::Url::parse(input)
        .is_ok_and(|parsed| matches!(parsed.scheme(), "http" | "https") && parsed.host().is_some())
}

/// Trims it and drops trailing slashes; only web URLs.
fn normalize_api_url(input: &str) -> Result<String, String> {
    let url = input.trim().trim_end_matches('/');
    if is_web_url(url) {
        Ok(url.to_string())
    } else {
        Err("Enter the API URL, starting with https://".to_string())
    }
}

#[tauri::command]
pub fn load_settings<R: Runtime>(app: AppHandle<R>) -> Result<SettingsView, String> {
    Ok(SettingsView::new(settings::load(&app), secrets::read(secrets::TARGET)?.is_some()))
}

/// Saves the form. A blank `token` keeps the saved one.
#[tauri::command]
pub fn save_settings<R: Runtime>(
    app: AppHandle<R>,
    api_url: String,
    owner_timezone: String,
    token: Option<String>,
) -> Result<SettingsView, String> {
    let api_url = normalize_api_url(&api_url)?;
    let owner_timezone = owner_timezone.trim().to_string();
    if owner_timezone.is_empty() {
        return Err("Enter the Owner timezone".to_string());
    }
    match token.as_deref().map(str::trim).filter(|t| !t.is_empty()) {
        Some(token) => secrets::store(secrets::TARGET, token)?,
        None if secrets::read(secrets::TARGET)?.is_none() => return Err("Enter the Token".to_string()),
        None => {}
    }
    let saved = settings::Settings { api_url: Some(api_url), owner_timezone };
    settings::write(&settings::path(&app)?, &saved).map_err(|_| "Settings could not be saved")?;
    tray::enable_open_dashboard(&app, true);
    Ok(SettingsView::new(saved, true))
}

/// `api(method, path, body) → { status, body }` with the saved API URL and Token.
#[tauri::command]
pub async fn api<R: Runtime>(
    app: AppHandle<R>,
    http: State<'_, Http>,
    method: String,
    path: String,
    body: Option<serde_json::Value>,
) -> Result<ApiOutcome, String> {
    let saved = settings::load(&app);
    let (Some(api_url), Some(token)) = (saved.api_url, secrets::read(secrets::TARGET)?) else {
        return Ok(ApiOutcome::NotConfigured);
    };
    let request = api::build_request(&http.0, &api_url, &token, &method, &path, body.as_ref())?;
    Ok(api::send(&http.0, request).await)
}

/// Settings' "Test connection": `GET /v1/todos?state=open&limit=1` with the URL in the form, and the
/// Token in the form or, when that is blank, the saved one. The saved Token only goes to the saved API
/// URL: testing another URL needs the Token typed again.
#[tauri::command]
pub async fn test_connection<R: Runtime>(
    app: AppHandle<R>,
    http: State<'_, Http>,
    api_url: String,
    token: Option<String>,
) -> Result<ApiOutcome, String> {
    let api_url = normalize_api_url(&api_url)?;
    let token = match token.map(|t| t.trim().to_string()).filter(|t| !t.is_empty()) {
        Some(token) => token,
        None if settings::load(&app).api_url.as_deref() != Some(api_url.as_str()) => {
            return Err("Enter the Token to test a new API URL".to_string())
        }
        None => secrets::read(secrets::TARGET)?.ok_or("Enter the Token")?,
    };
    let request = api::build_request(&http.0, &api_url, &token, "GET", "/v1/todos?state=open&limit=1", None)?;
    Ok(api::send(&http.0, request).await)
}

/// Opens a To-do's `url` (the Dashboard's details panel for it) in the default browser (docs/desktop-app.md §4).
/// Only a web URL: the link comes from the API, and anything else would start a program.
#[tauri::command]
pub fn open_url<R: Runtime>(app: AppHandle<R>, url: String) -> Result<(), String> {
    if !is_web_url(&url) {
        return Err("The To-do's link is not a web address".to_string());
    }
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_http_and_https_urls_and_drops_the_trailing_slash() {
        assert_eq!(normalize_api_url(" https://box.tail.ts.net/ ").unwrap(), "https://box.tail.ts.net");
        assert_eq!(normalize_api_url("http://127.0.0.1:8871").unwrap(), "http://127.0.0.1:8871");
    }

    #[test]
    fn opens_only_web_urls() {
        assert!(is_web_url("https://box.tail.ts.net/personal?todo=td_1"));
        assert!(is_web_url("http://127.0.0.1:8873/personal?todo=td_1"));
        for bad in [
            "",
            "file:///C:/Windows/notepad.exe",
            "javascript:alert(1)",
            "ms-settings:",
            "personal?todo=td_1",
        ] {
            assert!(!is_web_url(bad), "{bad}");
        }
    }

    #[test]
    fn refuses_anything_else() {
        for bad in ["", "box.tail.ts.net", "ftp://box", "https://", "not a url"] {
            assert!(normalize_api_url(bad).is_err(), "{bad}");
        }
    }
}
