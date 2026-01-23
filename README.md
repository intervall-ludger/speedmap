# Speedmap

Measure internet speed at different locations in your home and visualize the results as a heatmap on your floorplan.

1. Upload a floorplan image
2. Set the scale by marking a known distance
3. Create a measurement grid
4. Run speed tests at each location
5. View the interpolated heatmap

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

## Note

Only tested on iOS.
