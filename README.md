# Speedmap

Measure internet speed at different locations in your home and visualize the results as a heatmap on your floorplan.

1. Upload a floorplan image
2. Create a measurement grid
3. Run speed tests at each location
4. View the interpolated heatmap

## Interpolation

The heatmap uses Inverse Distance Weighting (IDW):

```
z(x,y) = Σ(wᵢ · zᵢ) / Σ(wᵢ)    where wᵢ = 1 / dᵢ²
```

- `zᵢ` = measured speed at point i
- `dᵢ` = distance from (x,y) to point i

Closer measurements have more influence on the interpolated value.

## Privacy

All data is stored locally on your device. No data is sent to external servers except for the speed test itself (Cloudflare).

## Build

```bash
cd rust-app/src-tauri
./build-ios.sh
open gen/apple/speedmap.xcodeproj
```

## Generate Icons

Requires `rsvg-convert` (install via `brew install librsvg`).

```bash
cd rust-app/src-tauri/icons

# General icons
rsvg-convert -w 32 -h 32 icon.svg -o 32x32.png
rsvg-convert -w 128 -h 128 icon.svg -o 128x128.png
rsvg-convert -w 256 -h 256 icon.svg -o 128x128@2x.png
rsvg-convert -w 512 -h 512 icon.svg -o icon.png

# iOS icons
DEST="../gen/apple/Assets.xcassets/AppIcon.appiconset"
rsvg-convert -w 20 -h 20 icon.svg -o "$DEST/AppIcon-20x20@1x.png"
rsvg-convert -w 40 -h 40 icon.svg -o "$DEST/AppIcon-20x20@2x.png"
rsvg-convert -w 60 -h 60 icon.svg -o "$DEST/AppIcon-20x20@3x.png"
rsvg-convert -w 29 -h 29 icon.svg -o "$DEST/AppIcon-29x29@1x.png"
rsvg-convert -w 58 -h 58 icon.svg -o "$DEST/AppIcon-29x29@2x.png"
rsvg-convert -w 87 -h 87 icon.svg -o "$DEST/AppIcon-29x29@3x.png"
rsvg-convert -w 40 -h 40 icon.svg -o "$DEST/AppIcon-40x40@1x.png"
rsvg-convert -w 80 -h 80 icon.svg -o "$DEST/AppIcon-40x40@2x.png"
rsvg-convert -w 120 -h 120 icon.svg -o "$DEST/AppIcon-40x40@3x.png"
rsvg-convert -w 120 -h 120 icon.svg -o "$DEST/AppIcon-60x60@2x.png"
rsvg-convert -w 180 -h 180 icon.svg -o "$DEST/AppIcon-60x60@3x.png"
rsvg-convert -w 76 -h 76 icon.svg -o "$DEST/AppIcon-76x76@1x.png"
rsvg-convert -w 152 -h 152 icon.svg -o "$DEST/AppIcon-76x76@2x.png"
rsvg-convert -w 167 -h 167 icon.svg -o "$DEST/AppIcon-83.5x83.5@2x.png"
rsvg-convert -w 1024 -h 1024 icon.svg -o "$DEST/AppIcon-512@2x.png"
```

## Note

Only tested on iOS.
