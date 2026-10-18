//! What a command line asks the app to do (docs/desktop-app.md §8).

/// The flags this app understands. Anything else, including the exe path, is ignored.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct Launch {
    /// `--toggle`: show the resident window if hidden, hide it if shown. Caps+R runs this.
    pub toggle: bool,
    /// `--hidden`: start resident without showing the window. The logon autostart passes it.
    pub hidden: bool,
}

/// What the resident instance does when a second launch reaches it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SecondLaunch {
    Toggle,
    Show,
}

impl Launch {
    pub fn parse<I, S>(args: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        let mut launch = Launch::default();
        for arg in args {
            match arg.as_ref() {
                "--toggle" => launch.toggle = true,
                "--hidden" => launch.hidden = true,
                _ => {}
            }
        }
        launch
    }

    /// `--toggle` toggles; any other second launch (a double-click on the exe) shows the window.
    pub fn second_launch(self) -> SecondLaunch {
        if self.toggle {
            SecondLaunch::Toggle
        } else {
            SecondLaunch::Show
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_arguments_starts_shown() {
        let launch = Launch::parse(["C:\\Apps\\traccia-desktop.exe"]);
        assert_eq!(launch, Launch { toggle: false, hidden: false });
    }

    #[test]
    fn reads_toggle_and_hidden_and_ignores_the_rest() {
        assert!(Launch::parse(["traccia-desktop.exe", "--toggle"]).toggle);
        assert!(Launch::parse(["traccia-desktop.exe", "--hidden"]).hidden);
        assert_eq!(Launch::parse(["--verbose", "toggle", "-hidden"]), Launch::default());
    }

    #[test]
    fn a_second_launch_toggles_only_with_toggle() {
        assert_eq!(Launch::parse(["--toggle"]).second_launch(), SecondLaunch::Toggle);
        assert_eq!(Launch::parse(["x.exe"]).second_launch(), SecondLaunch::Show);
        assert_eq!(Launch::parse(["--hidden"]).second_launch(), SecondLaunch::Show);
    }
}
