# Speedmap (Tauri/Rust)

Same functionality as the SwiftUI app, but built with Tauri + Rust + Web (HTML/CSS/JS).

## Build & Run

### Desktop (macOS/Linux/Windows)

```bash
cd src-tauri
cargo tauri dev
```

### iOS

#### IPA Build erstellen

```bash
./build.sh --ios
```

Das kopiert die Frontend-Assets und erstellt `speedmap.ipa` im Projektordner.

#### Installation per Xcode

1. iPhone per USB verbinden
2. `open src-tauri/gen/apple/speedmap.xcodeproj`
3. Oben im Scheme-Selector dein iPhone auswählen
4. **Cmd + R** oder Play-Button drücken
5. Beim ersten Mal auf dem iPhone: Einstellungen → Allgemein → VPN & Geräteverwaltung → Developer-Zertifikat vertrauen

#### Installation per Sideloadly

1. [Sideloadly](https://sideloadly.io/) herunterladen und installieren
2. iPhone per USB verbinden
3. `speedmap.ipa` in Sideloadly ziehen
4. Apple ID eingeben (für Signierung)
5. "Start" klicken
6. Auf dem iPhone: Einstellungen → Allgemein → VPN & Geräteverwaltung → Deinem Account vertrauen

**Hinweis:** Bei kostenloser Apple ID muss die App alle 7 Tage neu signiert werden.

### Android

```bash
cargo tauri android init
cargo tauri android dev
```

## Project Structure

```
rust-app/
├── src/                    # Web Frontend
│   ├── index.html
│   ├── style.css
│   └── main.js
└── src-tauri/              # Rust Backend
    ├── src/
    │   ├── lib.rs         # Speedtest logic + Tauri commands
    │   └── main.rs
    ├── Cargo.toml
    └── tauri.conf.json
```

## Features

- Project management (create, load, delete)
- Floorplan upload
- Scale calibration
- Grid positioning
- Cloudflare speed test (5 runs, trimmed mean)
- IDW interpolated heatmap
