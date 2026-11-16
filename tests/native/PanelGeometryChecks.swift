import Foundation
import PipCore

// Intent: the chat window's size and place (ELF-65 plan: 600 pt wide beside Pip, grows upward from a fixed bottom, at most 70% of the
// visible height, see-through unless the Mac asks for less transparency). Fixtures: the visible frames of a 14-inch MacBook Pro
// (menu bar taken off), a smaller display, and a second display placed left of the first (negative origin).
enum PanelGeometryChecks {
    static func require(_ condition: Bool, _ what: String) { precondition(condition, "Panel geometry failed: " + what) }
    static func run() {
        let laptop = CGRect(x: 0, y: 0, width: 1512, height: 944)
        let small = CGRect(x: 0, y: 0, width: 800, height: 560)
        let left = CGRect(x: -1920, y: 100, width: 1920, height: 1055)

        let first = PanelGeometry.panel(visible: laptop, windowWidth: 600, windowHeight: 163)
        require(first.width == 756 && first.height == 171, "the panel holds the window, the gap, Pip and the feet")
        require(first.maxX == laptop.maxX && first.minY == laptop.minY + 16, "right-aligned, with the window's bottom 24 pt above the screen's")
        let grown = PanelGeometry.panel(visible: laptop, windowWidth: 600, windowHeight: 400)
        require(grown.minY == first.minY && grown.maxY == first.minY + 408, "growing only moves the top edge")

        require(PanelGeometry.tallest(visibleHeight: 944) == 660, "70% of the visible height, rounded down")
        require(PanelGeometry.panel(visible: laptop, windowWidth: 600, windowHeight: 5000).height == 668, "never taller than the cap, plus the feet")
        require(PanelGeometry.panel(visible: laptop, windowWidth: 600, windowHeight: 10).height == 171, "never shorter than the smallest window")

        let narrow = PanelGeometry.panel(visible: small, windowWidth: 600, windowHeight: 300)
        require(narrow.width <= small.width && narrow.maxX == small.maxX, "on a small display the panel stays on screen")
        require(PanelGeometry.panel(visible: small, windowWidth: 600, windowHeight: 5000).height == 392 + 8, "70% of 560 on the small display")
        require(PanelGeometry.panel(visible: laptop, windowWidth: 100, windowHeight: 200).width == 420 + 156, "never narrower than 420 pt")
        require(PanelGeometry.panel(visible: laptop, windowWidth: 2000, windowHeight: 200).width == 760 + 156, "never wider than 760 pt")

        let second = PanelGeometry.panel(visible: left, windowWidth: 600, windowHeight: 300)
        require(second.maxX == 0 && second.minY == 116, "a display left of the main one keeps its own origin")

        let back = PanelGeometry.backdrop(windowWidth: 600, windowHeight: 300)
        require(back == CGRect(x: 0, y: 8, width: 600, height: 300), "the see-through layer covers the window, not Pip")

        require(!PanelGeometry.solid(reduceTransparency: false, increaseContrast: false), "see-through by default")
        require(PanelGeometry.solid(reduceTransparency: true, increaseContrast: false), "Reduce Transparency makes it solid")
        require(PanelGeometry.solid(reduceTransparency: false, increaseContrast: true), "Increase Contrast makes it solid")

        // Intent (ELF-70's cold-launch bug, and the edge drags of ELF-65's spec): a fresh launch opens 600 pt wide, a first measurement taken in a web view
        // that has no size yet must not narrow the window, a dragged width stays between 420 and 760 pt, and the top edge sets the most height.
        require(PanelGeometry.width(requested: nil, current: 600, visibleWidth: 1512) == 600, "no width in a resize keeps the current width")
        require(PanelGeometry.width(requested: 0, current: 600, visibleWidth: 1512) == 600, "a zero-sized web view measures zero and keeps 600, not 420")
        require(PanelGeometry.width(requested: -156, current: 600, visibleWidth: 1512) == 600, "a web view narrower than Pip's figure measures a negative width and keeps the current one")
        require(PanelGeometry.width(requested: .nan, current: 700, visibleWidth: 1512) == 700, "an unreadable width keeps the current one")
        require(PanelGeometry.width(requested: nil, current: 0, visibleWidth: 1512) == 600, "with nothing known the window is 600 pt")
        require(PanelGeometry.width(requested: 300, current: 600, visibleWidth: 1512) == 420 && PanelGeometry.width(requested: 900, current: 600, visibleWidth: 1512) == 760, "a dragged width stays between 420 and 760 pt")
        require(PanelGeometry.width(requested: 760, current: 600, visibleWidth: 800) == 644, "on a small display the window leaves room for Pip")
        let fresh = PanelGeometry.panel(visible: laptop, windowWidth: PanelGeometry.width(requested: 0, current: PanelGeometry.defaultWidth, visibleWidth: 1512), windowHeight: 163)
        require(fresh.width == 600 + 156, "a cold launch opens the panel 600 pt wide plus Pip")
        let wide = PanelGeometry.panel(visible: laptop, windowWidth: 720, windowHeight: 300)
        require(wide.maxX == first.maxX && wide.minY == first.minY, "dragging the left edge widens the window without moving its right side or bottom")
        require(PanelGeometry.tallest(visibleHeight: 944, most: nil) == 660, "without a choice the most height is 70%")
        require(PanelGeometry.tallest(visibleHeight: 944, most: 800) == 800 && PanelGeometry.panel(visible: laptop, windowWidth: 600, windowHeight: 5000, most: 800).height == 808, "a chosen most height replaces the 70% cap")
        require(PanelGeometry.tallest(visibleHeight: 944, most: 100) == 320, "the most height is never below 320 pt")
        require(PanelGeometry.tallest(visibleHeight: 944, most: 5000) == 944 - 24 - 12, "the most height never reaches past the top of the screen")
        let taller = PanelGeometry.panel(visible: laptop, windowWidth: 600, windowHeight: 700, most: 800)
        require(taller.minY == first.minY && taller.maxX == first.maxX, "dragging the top edge moves only the top edge")

        let home = FileManager.default.temporaryDirectory.appendingPathComponent("pip-window-" + UUID().uuidString, isDirectory: true)
        try? FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: home) }
        require(WindowSetting.load(from: home) == WindowSetting(width: 600, most: nil), "a new install opens 600 pt wide with the default most height")
        try? WindowSetting(width: 700, most: 640).save(to: home)
        require(WindowSetting.load(from: home) == WindowSetting(width: 700, most: 640), "the dragged width and most height survive a restart")
        try? Data("{\"width\":9000,\"most\":40}".utf8).write(to: home.appendingPathComponent(WindowSetting.fileName))
        require(WindowSetting.load(from: home) == WindowSetting(width: 760, most: nil), "values outside the range are held to it, and a most height under 320 pt is dropped")
        try? Data("not json".utf8).write(to: home.appendingPathComponent(WindowSetting.fileName))
        require(WindowSetting.load(from: home) == WindowSetting(), "a damaged file gives the default size")
        print("Panel geometry checks passed")
    }
}
