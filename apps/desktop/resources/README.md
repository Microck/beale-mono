# Beale branding

`app-icon.svg` is the editable master: a charcoal rounded face tilted seven degrees counterclockwise, with unequal signal-red eyes. It uses only vector geometry and solid fills, with no fonts, embedded images, gradients, or filters.

- `app-icon.png`: 1024 × 1024 transparent export for Electron window, Dock, and bundle icons. The renderer imports the SVG directly.
- `MenuBarIcon.svg`: monochrome silhouette with transparent eye cutouts for macOS template rendering.
- `../../../app-server/resources/icon.png`: identical copy of the desktop PNG for the app-server tray.
- `../../../app-server/resources/MenuBarIcon.svg`: identical monochrome template for standalone app-server resources.
- `../../ios/Beale/Assets.xcassets/AppIcon.appiconset/AppIcon.png`: retained iOS asset, exported at 1024 × 1024 on opaque paper (`#f5f3ee`). The actively developed iOS client lives in a separate repository.

Palette: face `#252623`, rim `#393a35`, eyes `#f24b3d`. Keep the square canvas and transparent padding when exporting desktop assets; the existing Electron branding script generates all macOS icon sizes from this PNG and refreshes its cache when the PNG changes. Keep iOS exports opaque and let the operating system apply the app-icon mask.

When updating the mark, export both PNGs from the SVG master, synchronize the app-server copies, and preserve the eye cutouts in the monochrome variant. Inspect at 16, 22, 32, 64, 128, and 256 pixels before shipping.
