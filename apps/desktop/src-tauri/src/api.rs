//! Requests to the Traccia API (docs/desktop-app.md §6).
//!
//! The webview never calls the API itself: the API sends no CORS headers, and the Token stays on this
//! side. The front end asks for `api(method, path, body)`; this adds `Authorization: Bearer <token>`
//! and hands back the status and the body as they came. Nothing here logs, and errors are reported
//! without the request, so the Token can't leak through them.

use std::time::Duration;

use reqwest::header::{HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use reqwest::{Client, Method, Request, Url};
use serde::Serialize;

/// The API may take this long before the request counts as offline.
pub const TIMEOUT: Duration = Duration::from_secs(10);

/// What a request came back with.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ApiOutcome {
    /// The API answered, with any status. The body is passed through as text.
    Response { status: u16, body: String },
    /// The API could not be reached: no network, a refused connection, or the timeout.
    Offline { reason: String },
    /// Settings has no API URL or no Token yet.
    NotConfigured,
}

pub fn client() -> Client {
    Client::builder().timeout(TIMEOUT).build().expect("the HTTP client always builds with these options")
}

/// Builds the request. `path` must be an API path (`/v1/…`), so the Token only ever goes to the API URL
/// from Settings.
pub fn build_request(
    client: &Client,
    api_url: &str,
    token: &str,
    method: &str,
    path: &str,
    body: Option<&serde_json::Value>,
) -> Result<Request, String> {
    let method = match method {
        "GET" => Method::GET,
        "POST" => Method::POST,
        "PATCH" => Method::PATCH,
        other => return Err(format!("unsupported method {other}")),
    };
    let base = api_url.trim_end_matches('/');
    let invalid_base = || "the API URL in Settings is not a valid URL".to_string();
    let base_url = Url::parse(base).map_err(|_| invalid_base())?;
    if !matches!(base_url.scheme(), "http" | "https") {
        return Err("the API URL in Settings must start with http:// or https://".to_string());
    }
    let url = Url::parse(&format!("{base}{path}")).map_err(|_| invalid_base())?;
    // Checked after parsing, which resolves `..` and `%2e%2e`: the request must stay on the API URL's
    // origin and under its `/v1/`.
    let api_root = format!("{}/v1/", base_url.path().trim_end_matches('/'));
    if !path.starts_with('/') || url.origin() != base_url.origin() || !url.path().starts_with(&api_root) {
        return Err(format!("not an API path: {path}"));
    }

    let mut bearer = HeaderValue::from_str(&format!("Bearer {}", token.trim()))
        .map_err(|_| "the Token in Settings has characters a Token can't have".to_string())?;
    bearer.set_sensitive(true);
    let mut request = client.request(method, url).header(AUTHORIZATION, bearer);
    if let Some(body) = body {
        request = request.header(CONTENT_TYPE, "application/json").body(body.to_string());
    }
    request.build().map_err(|_| "the request could not be built".to_string())
}

/// Sends a built request. Any transport failure is `Offline`; any HTTP answer is a `Response`.
pub async fn send(client: &Client, request: Request) -> ApiOutcome {
    let response = match client.execute(request).await {
        Ok(response) => response,
        Err(err) => return offline(&err),
    };
    let status = response.status().as_u16();
    match response.text().await {
        Ok(body) => ApiOutcome::Response { status, body },
        Err(err) => offline(&err),
    }
}

/// A short reason with no URL, header or body in it.
fn offline(err: &reqwest::Error) -> ApiOutcome {
    let reason = if err.is_timeout() {
        "timed out"
    } else if err.is_connect() {
        "could not connect"
    } else {
        "the request failed"
    };
    ApiOutcome::Offline { reason: reason.to_string() }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;

    const TOKEN: &str = "trc_test_secret_123";

    fn get(path: &str) -> Result<Request, String> {
        build_request(&client(), "http://127.0.0.1:8871/", TOKEN, "GET", path, None)
    }

    #[test]
    fn adds_the_bearer_from_settings() {
        let request = get("/v1/todos?state=open&limit=1").unwrap();
        let header = request.headers().get(AUTHORIZATION).unwrap();
        assert_eq!(header.to_str().unwrap(), format!("Bearer {TOKEN}"));
        assert!(header.is_sensitive());
        assert_eq!(request.url().as_str(), "http://127.0.0.1:8871/v1/todos?state=open&limit=1");
    }

    #[test]
    fn sends_a_json_body() {
        let body = serde_json::json!({ "state": "done" });
        let request =
            build_request(&client(), "http://h", TOKEN, "PATCH", "/v1/todos/t1", Some(&body)).unwrap();
        assert_eq!(request.method(), Method::PATCH);
        assert_eq!(request.headers().get(CONTENT_TYPE).unwrap(), "application/json");
        let sent = request.body().and_then(|b| b.as_bytes()).unwrap();
        assert_eq!(sent, br#"{"state":"done"}"#);
    }

    #[test]
    fn sends_the_token_only_to_api_paths() {
        assert!(get("https://elsewhere.example/v1/todos").is_err());
        assert!(get("/personal").is_err());
        assert!(get("/v1/../files/x").is_err());
        assert!(get("/v1/%2e%2e/files/x").is_err());
        assert!(get("/v1/%2E%2E/files/x").is_err());
        assert!(get("@elsewhere.example/v1/todos").is_err());
        assert!(get("/v1/todos?state=open&limit=1").is_ok());
        assert!(build_request(&client(), "http://h", TOKEN, "DELETE", "/v1/todos/t1", None).is_err());
        assert!(build_request(&client(), "ftp://h", TOKEN, "GET", "/v1/todos", None).is_err());
    }

    #[test]
    fn never_shows_the_token_when_debug_printed_or_on_errors() {
        let request = get("/v1/todos").unwrap();
        assert!(!format!("{request:?}").contains(TOKEN));
        let err = build_request(&client(), "not a url", TOKEN, "GET", "/v1/todos", None).unwrap_err();
        assert!(!err.contains(TOKEN));
    }

    /// A one-shot HTTP server on a free port: answers with `reply` and hands back what it received.
    fn serve_once(reply: &'static str) -> (String, thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buf = [0u8; 4096];
            let n = stream.read(&mut buf).unwrap();
            stream.write_all(reply.as_bytes()).unwrap();
            String::from_utf8_lossy(&buf[..n]).into_owned()
        });
        (url, handle)
    }

    #[tokio::test]
    async fn passes_the_status_and_body_through() {
        let body = r#"{"error":{"code":"unauthorized","message":"Invalid token"}}"#;
        let reply: &'static str = Box::leak(
            format!(
                "HTTP/1.1 401 Unauthorized\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                body.len()
            )
            .into_boxed_str(),
        );
        let (url, server) = serve_once(reply);
        let client = client();
        let request =
            build_request(&client, &url, TOKEN, "GET", "/v1/todos?state=open&limit=1", None).unwrap();

        let outcome = send(&client, request).await;

        assert_eq!(outcome, ApiOutcome::Response { status: 401, body: body.to_string() });
        let received = server.join().unwrap().to_lowercase();
        assert!(received.starts_with("get /v1/todos?state=open&limit=1 http/1.1"));
        assert!(received.contains(&format!("authorization: bearer {TOKEN}")));
    }

    #[tokio::test]
    async fn reports_an_unreachable_api_as_offline_without_the_url() {
        // Bind then drop: nothing listens on this port any more.
        let port = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        let client = client();
        let request =
            build_request(&client, &format!("http://127.0.0.1:{port}"), TOKEN, "GET", "/v1/todos", None)
                .unwrap();

        let outcome = send(&client, request).await;

        assert_eq!(outcome, ApiOutcome::Offline { reason: "could not connect".to_string() });
    }
}
