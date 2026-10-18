//! The resident instance and the elevation trap (docs/desktop-app.md §8).
//!
//! The owner's AutoHotkey script runs elevated, so a `--toggle` it launches is elevated too. When no
//! instance is running, that process must not become the resident one: it starts the app again through
//! the shell (`explorer.exe <exe>`), which runs it unelevated, and exits.
//!
//! "Is one running?" is a named mutex every launch opens first thing and the resident instance keeps
//! for its whole life. The single-instance plugin then forwards a second launch's arguments to it.

pub use sys::{claim, is_elevated, let_resident_take_focus, Claim};

use std::io;
use std::path::PathBuf;
use std::process::Command;
use std::time::{Duration, Instant};

/// How long a `--toggle` waits for the instance it started through the shell to appear.
const RELAUNCH_WAIT: Duration = Duration::from_secs(3);

#[cfg(windows)]
mod sys {
    use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, ERROR_ALREADY_EXISTS, HANDLE};
    use windows_sys::Win32::Security::{GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY};
    use windows_sys::Win32::System::Threading::{
        CreateMutexW, GetCurrentProcess, OpenMutexW, OpenProcessToken, SYNCHRONIZATION_SYNCHRONIZE,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{AllowSetForegroundWindow, ASFW_ANY};

    fn name() -> Vec<u16> {
        // Per logon session, so another Windows user's instance does not count.
        "Local\\traccia-desktop-resident".encode_utf16().chain(Some(0)).collect()
    }

    /// This launch's hold on the mutex. Windows releases it when the process exits, which is exactly
    /// when the process should stop counting as running; `release` lets go earlier.
    pub struct Claim {
        /// Whether this is the first launch, that is whether no instance is running or starting.
        pub first: bool,
        handle: HANDLE,
    }

    impl Claim {
        /// Stops counting as running, so an instance this launch starts can take the claim.
        pub fn release(self) {
            if !self.handle.is_null() {
                // SAFETY: a handle this process opened and has not closed.
                unsafe { CloseHandle(self.handle) };
            }
        }
    }

    /// Opens the mutex, creating it if no other launch holds it.
    pub fn claim() -> Claim {
        let name = name();
        // SAFETY: `name` is a NUL-terminated UTF-16 string that outlives the call.
        let handle = unsafe { CreateMutexW(std::ptr::null(), 0, name.as_ptr()) };
        // SAFETY: read right after the call that set it.
        let first = !handle.is_null() && unsafe { GetLastError() } != ERROR_ALREADY_EXISTS;
        Claim { first, handle }
    }

    /// Whether some process (the resident instance, or one starting) holds the mutex.
    pub fn someone_holds_it() -> bool {
        let name = name();
        // SAFETY: as in `claim`; the handle is closed straight away.
        let handle = unsafe { OpenMutexW(SYNCHRONIZATION_SYNCHRONIZE, 0, name.as_ptr()) };
        if handle.is_null() {
            return false;
        }
        unsafe { CloseHandle(handle) };
        true
    }

    /// Whether this process runs elevated (an administrator's full token).
    pub fn is_elevated() -> bool {
        let mut token: HANDLE = std::ptr::null_mut();
        // SAFETY: the pseudo-handle needs no closing; `token` is closed below once opened.
        if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) } == 0 {
            return false;
        }
        let mut elevation = TOKEN_ELEVATION { TokenIsElevated: 0 };
        let mut len = 0u32;
        // SAFETY: `elevation` is the struct TokenElevation fills, with its exact size.
        let ok = unsafe {
            GetTokenInformation(
                token,
                TokenElevation,
                (&mut elevation as *mut TOKEN_ELEVATION).cast(),
                std::mem::size_of::<TOKEN_ELEVATION>() as u32,
                &mut len,
            )
        };
        unsafe { CloseHandle(token) };
        ok != 0 && elevation.TokenIsElevated != 0
    }

    /// Lets the resident instance bring its window to the foreground. Windows only lets the process
    /// that got the user's input (this short-lived launch) do that, unless it hands the right on.
    pub fn let_resident_take_focus() {
        // SAFETY: a plain Win32 call with no pointers.
        unsafe { AllowSetForegroundWindow(ASFW_ANY) };
    }
}

#[cfg(not(windows))]
mod sys {
    pub struct Claim {
        pub first: bool,
    }
    impl Claim {
        pub fn release(self) {}
    }
    pub fn claim() -> Claim {
        Claim { first: true }
    }
    pub fn someone_holds_it() -> bool {
        false
    }
    pub fn is_elevated() -> bool {
        false
    }
    pub fn let_resident_take_focus() {}
}

/// Starts this exe again through the shell, unelevated and with no arguments (so it starts shown),
/// and waits for it to take the claim. Errs when it doesn't appear: Explorer isn't running, or it
/// opened folder windows in a separate process and dropped the request.
pub fn relaunch_through_shell(claim: Claim) -> io::Result<()> {
    // Let go first, so the new instance becomes the first launch and not a second one.
    claim.release();
    // The full path, so an elevated launch never runs an `explorer.exe` planted next to the app.
    let windows = std::env::var_os("WINDIR").map_or_else(|| PathBuf::from("C:\\Windows"), PathBuf::from);
    Command::new(windows.join("explorer.exe")).arg(std::env::current_exe()?).spawn()?;
    let start = Instant::now();
    while start.elapsed() < RELAUNCH_WAIT {
        if sys::someone_holds_it() {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    Err(io::Error::new(io::ErrorKind::TimedOut, "the shell did not start the app"))
}

/// What a launch does before Tauri starts (docs/desktop-app.md §8).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Start {
    /// Start Tauri: become the resident instance, or hand the arguments to it.
    Run,
    /// A `--toggle` with nothing running from an elevated process: start it through the shell.
    RelaunchThroughShell,
}

/// A `--toggle` with no instance running starts the app itself, shown. Only an elevated one must go
/// through the shell; an unelevated one can simply become the resident instance, which also works
/// when Explorer can't relaunch it.
pub fn start(first: bool, toggle: bool, elevated: bool) -> Start {
    if first && toggle && elevated {
        Start::RelaunchThroughShell
    } else {
        Start::Run
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_an_elevated_first_toggle_goes_through_the_shell() {
        assert_eq!(start(true, true, true), Start::RelaunchThroughShell);
        assert_eq!(start(true, true, false), Start::Run);
        assert_eq!(start(false, true, true), Start::Run);
        assert_eq!(start(true, false, true), Start::Run);
    }
}
