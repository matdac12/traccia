//! The logon autostart (docs/desktop-app.md §2, §8): `HKCU\…\Run\Traccia` = `"<exe>" --hidden`.
//!
//! Written here rather than through the autostart plugin, which writes the path unquoted (a path with
//! spaces then breaks), tries `HKLM` first, and turns the entry back on in Task Manager at every start.
//! This writes the per-user value only, quoted, and leaves Task Manager's on/off switch to the owner.
//! The installer's uninstaller removes the value (`nsis-hooks.nsh`).

/// The Run value's name. The installer's uninstall hook deletes the same name.
pub const VALUE_NAME: &str = "Traccia";

/// The Run value's data: the exe path, quoted, then `--hidden`.
pub fn command_line(exe: &str) -> String {
    format!("\"{exe}\" --hidden")
}

/// Registers this exe to start hidden at logon. Release builds only, so `tauri dev` never registers
/// a debug build; failures are ignored (the app works without it).
pub fn register() {
    if cfg!(debug_assertions) {
        return;
    }
    if let Ok(exe) = std::env::current_exe() {
        let _ = sys::set_run_value(VALUE_NAME, &command_line(&exe.display().to_string()));
    }
}

#[cfg(windows)]
mod sys {
    use windows_sys::Win32::System::Registry::{RegSetKeyValueW, HKEY_CURRENT_USER, REG_SZ};

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(Some(0)).collect()
    }

    pub fn set_run_value(name: &str, data: &str) -> Result<(), u32> {
        let key = wide(r"Software\Microsoft\Windows\CurrentVersion\Run");
        let name = wide(name);
        let data = wide(data);
        // SAFETY: all three are NUL-terminated UTF-16 buffers that outlive the call; the size is the
        // data's length in bytes, terminator included, as REG_SZ requires.
        let status = unsafe {
            RegSetKeyValueW(
                HKEY_CURRENT_USER,
                key.as_ptr(),
                name.as_ptr(),
                REG_SZ,
                data.as_ptr().cast(),
                (data.len() * 2) as u32,
            )
        };
        if status == 0 {
            Ok(())
        } else {
            Err(status)
        }
    }
}

#[cfg(not(windows))]
mod sys {
    pub fn set_run_value(_name: &str, _data: &str) -> Result<(), u32> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quotes_the_path_so_spaces_survive() {
        assert_eq!(
            command_line(r"C:\Users\Jane Doe\AppData\Local\Traccia\traccia-desktop.exe"),
            r#""C:\Users\Jane Doe\AppData\Local\Traccia\traccia-desktop.exe" --hidden"#
        );
    }
}
