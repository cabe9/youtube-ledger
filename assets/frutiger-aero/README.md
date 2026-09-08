# Frutiger Aero assets

The dashboard glass and decorative motion are implemented in `frutiger-aero.css`.
The reference screenshot guides the appearance; it is not used as a dashboard background.

## Supplied backgrounds

- `water-desktop.png`: the user's replacement horizontal scene, 1585 × 992 px; sky and turquoise water without buildings, used above 760 px.
- `skyline-desktop.png`: the user's separate transparent skyline, 1672 × 941 px. It sits on the desktop shoreline, centered at 64% of viewport width, with its aspect ratio preserved. Its height follows the available sky and is capped at 360 CSS px to retain detail. It has no blur or animation of its own and is hidden at 760 px and below.
- `landscape-mobile.png`: the user's first image, 941 × 1672 px; portrait skyline and water with foreground plants, used at 760 px and below.
- All active PNGs are copied unchanged from the supplied files and bundled in the Chrome and Firefox packages. No artwork was generated.
- `landscape-desktop.png` retains the original combined desktop scene as an alternate source. It is no longer used or packaged.
- The fixed background uses `cover`, centered at the top. The CSS horizon glow follows the shoreline's scaled position. Water shimmer and bubbles remain separate decorative layers.

## Supplied foliage

- `foliage-left.png` and `foliage-right.png`: the user's transparent RGBA cutouts, each 1386 × 1135 px, copied unchanged.
- The plants and rocks frame the bottom corners, with the left group slightly larger. Both scale down on narrow screens.
- The decorative scene sits behind the dashboard, ignores pointer events, and is hidden from assistive technology.
- Each cutout pivots at its bottom outer corner through −0.65° to +0.65°, with staggered 17- and 21-second sway durations. Theme animations and system Reduce Motion both stop the sway.

## Integration

All five active assets are included in `build.py` so Chrome and Firefox packages carry them. Check the crop and text contrast at desktop and mobile widths when changing their placement. The plants already baked into the portrait background stay still.
