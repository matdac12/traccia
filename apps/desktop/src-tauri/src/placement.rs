//! Where the window goes: bottom-right of the work area, 12 px from the edges (docs/desktop-app.md §2).

/// Distance from the work area's right and bottom edges, in logical pixels.
const MARGIN: f64 = 12.0;

/// A rectangle in physical pixels, as Windows reports a monitor's work area (the part above the taskbar).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// The window's top-left corner, in physical pixels, for a window of `size` (physical) on a monitor
/// with this work area and scale factor.
pub fn bottom_right(work_area: Rect, size: (u32, u32), scale: f64) -> (i32, i32) {
    let margin = (MARGIN * scale).round() as i32;
    let right = work_area.x + work_area.width as i32;
    let bottom = work_area.y + work_area.height as i32;
    (right - size.0 as i32 - margin, bottom - size.1 as i32 - margin)
}

/// The invisible resize border around a window's content, in physical pixels per side.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Frame {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

/// The outer rectangle Windows needs so that the content fills `content` exactly.
pub fn outer_rect(content: Rect, frame: Frame) -> Rect {
    Rect {
        x: content.x - frame.left,
        y: content.y - frame.top,
        width: (content.width as i32 + frame.left + frame.right) as u32,
        height: (content.height as i32 + frame.top + frame.bottom) as u32,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sits_12_px_from_the_corner_above_a_bottom_taskbar() {
        // 1920x1080 at 100 %, a 48 px taskbar at the bottom.
        let work = Rect { x: 0, y: 0, width: 1920, height: 1032 };
        assert_eq!(bottom_right(work, (380, 520), 1.0), (1920 - 380 - 12, 1032 - 520 - 12));
    }

    #[test]
    fn scales_the_margin_with_the_monitor() {
        // A 2880x1800 laptop panel at 200 %: the window is 760x1040 physical, the margin 24.
        let work = Rect { x: 0, y: 0, width: 2880, height: 1704 };
        assert_eq!(bottom_right(work, (760, 1040), 2.0), (2880 - 760 - 24, 1704 - 1040 - 24));
    }

    #[test]
    fn follows_a_secondary_monitor_left_of_or_above_the_primary() {
        // 2560x1440 at 125 %, left of the primary and 200 px higher.
        let left = Rect { x: -2560, y: -200, width: 2560, height: 1392 };
        assert_eq!(bottom_right(left, (475, 650), 1.25), (-475 - 15, 1192 - 650 - 15));
    }

    #[test]
    fn grows_the_content_by_the_invisible_border_to_get_the_outer_rect() {
        // Measured on Windows 11 at 150 %: 11 px each side and bottom, 2 px on top.
        let content = Rect { x: 3252, y: 1362, width: 570, height: 780 };
        let frame = Frame { left: 11, top: 2, right: 11, bottom: 11 };
        assert_eq!(outer_rect(content, frame), Rect { x: 3241, y: 1360, width: 592, height: 793 });
    }
}
