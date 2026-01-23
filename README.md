# Speedmap

Measure WiFi speed at different locations in your home and visualize the results as a heatmap on your floorplan. Find dead zones, optimize router placement, and understand your network coverage.

**Free to use, modify, and distribute.**

## Screenshots

<p align="center">
  <img src="imgs/home.PNG" width="250" alt="Home Screen"/>
</p>

<p align="center">
  <img src="imgs/grid.PNG" width="250" alt="Heatmap Screen"/>
</p>

<p align="center">
  <img src="imgs/measure.PNG" width="250" alt="Measure Screen"/>
</p>

<p align="center">
  <img src="imgs/heatmap.PNG" width="250" alt="Heatmap Screen"/>
</p>

## Features

- Upload any floorplan image
- Adjustable grid density (Coarse / Medium / Fine)
- Multiple speed test runs for accuracy
- Download, Upload, and Confidence heatmaps
- Pinch-to-zoom on measure screen
- All data stored locally
- Dark mode UI

## How It Works

1. **Create a project** and upload your floorplan
2. **Set the grid** density and position
3. **Measure** by tapping cells and running speed tests
4. **View the heatmap** with interpolated values

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

Requires [Rust](https://rustup.rs/) and Xcode.

```bash
cd rust-app/src-tauri
./build-ios.sh
open gen/apple/speedmap.xcodeproj
```

Then build and run in Xcode (Cmd+R).

## Generate Icons

Requires `rsvg-convert`:

```bash
brew install librsvg
```

```bash
cd rust-app/src-tauri/icons

# General icons
rsvg-convert -w 512 -h 512 icon.svg -o icon.png

# iOS icons
DEST="../gen/apple/Assets.xcassets/AppIcon.appiconset"
for size in 20 29 40 60 76; do
  rsvg-convert -w $size -h $size icon.svg -o "$DEST/AppIcon-${size}x${size}@1x.png"
  rsvg-convert -w $((size*2)) -h $((size*2)) icon.svg -o "$DEST/AppIcon-${size}x${size}@2x.png"
  rsvg-convert -w $((size*3)) -h $((size*3)) icon.svg -o "$DEST/AppIcon-${size}x${size}@3x.png"
done
rsvg-convert -w 167 -h 167 icon.svg -o "$DEST/AppIcon-83.5x83.5@2x.png"
rsvg-convert -w 1024 -h 1024 icon.svg -o "$DEST/AppIcon-512@2x.png"
```

## Tech Stack

- **Frontend**: HTML, CSS, JavaScript
- **Backend**: Rust with Tauri v2
- **Speed Test**: Cloudflare speed test
- **Platform**: iOS (tested on iPhone)

## Contributing

Contributions are welcome! Feel free to open issues or submit pull requests.

## License

MIT License - see [LICENSE](LICENSE) for details.
