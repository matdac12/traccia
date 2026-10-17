//! The resident instance and the elevation trap (docs/desktop-app.md §8).
//!
//! The owner's AutoHotkey script runs elevated, so a `--toggle` it launches is elevated too. When no
//! instance is running, that process must not become the resident one: it starts the app again through
//! the shell (`explorer.exe <exe>`), which runs it unelevated, and exits.
//!
//! "Is one running?" is a named mutex every launch opens first thing and the resident instance keeps
//! for its whole life. The single-instance plugin then forwards a second launch's arguments to it.

pub use sys::{claim, let_resident_take_focus};

use std::io;
use std::path::PathBuf;
use std::process::Command;

#[cfg(windows)]
mod sys {
    use windows_sys::Win32::Foundation::{GetLastError, ERROR_ALREADY_EXISTS};
    use windows_sys::Win32::System::Threading::CreateMutexW;
    use windows_sys::Win32::UI::WindowsAndMessaging::{AllowSetForegroundWindow, ASFW_ANY};

    /// Opens the mutex, creating it if no other launch holds it, and keeps it until this process exits.
    /// Returns whether this is the first launch, that is whether no instance is running or starting.
    pub fn claim() -> bool {
        // Per logon session, so another Windows user's instance does not count.
        let name: Vec<u16> = "Local\\traccia-desktop-resident".encode_utf16().chain(Some(0)).collect();
        // SAFETY: `name` is a NUL-terminated UTF-16 string that outlives the call. The handle is
        // deliberately never closed: Windows releases it when the process exits, which is exactly when
        // the process should stop counting as running.
        let handle = unsafe { CreateMutexW(std::ptr::null(), 0, name.as_ptr()) };
        // SAFETY: read right after the call that set it.
        !handle.is_null() && unsafe { GetLastError() } != ERROR_ALREADY_EXISTS
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
    pub fn claim() -> bool {
        true
    }
    pub fn let_resident_take_focus() {}
}

/// Starts this exe again through the shell, unelevated and with no arguments (so it starts shown).
pub fn relaunch_through_shell() -> io::Result<()> {
    // The full path, so an elevated launch never runs an `explorer.exe` planted next to the app.
    let windows = std::env::var_os("WINDIR").map_or_else(|| PathBuf::from("C:\\Windows"), PathBuf::from);
    Command::new(windows.join("explorer.exe")).arg(std::env::current_exe()?).spawn()?;
    Ok(())
}
