//! The Token, in Windows Credential Manager (docs/desktop-app.md §7), never in a file.
//!
//! It shows in Control Panel → Credential Manager → Windows Credentials as a generic credential named
//! `traccia-desktop:token`.

use keyring::{Entry, Error};

/// The Credential Manager target the app uses.
pub const TARGET: &str = "traccia-desktop:token";
const SERVICE: &str = "traccia-desktop";
const USER: &str = "token";

fn entry(target: &str) -> Result<Entry, String> {
    Entry::new_with_target(target, SERVICE, USER).map_err(|_| "Credential Manager is unavailable".to_string())
}

/// The saved Token, or `None` when there is none yet.
pub fn read(target: &str) -> Result<Option<String>, String> {
    match entry(target)?.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(Error::NoEntry) => Ok(None),
        Err(_) => Err("the Token could not be read from Credential Manager".to_string()),
    }
}

pub fn store(target: &str, token: &str) -> Result<(), String> {
    entry(target)?
        .set_password(token)
        .map_err(|_| "the Token could not be saved in Credential Manager".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Writes to the real Credential Manager, under a test target it deletes again; so it only runs
    /// on request: `cargo test -- --ignored`.
    #[test]
    #[ignore]
    fn round_trips_through_credential_manager() {
        const TEST_TARGET: &str = "traccia-desktop-test:token";
        assert_eq!(read(TEST_TARGET), Ok(None));
        store(TEST_TARGET, "first").unwrap();
        store(TEST_TARGET, "second").unwrap();
        assert_eq!(read(TEST_TARGET), Ok(Some("second".to_string())));
        entry(TEST_TARGET).unwrap().delete_credential().unwrap();
        assert_eq!(read(TEST_TARGET), Ok(None));
    }
}
