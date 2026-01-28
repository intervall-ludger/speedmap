#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RUST_DIR="$SCRIPT_DIR/rust-app"
IPA_OUT="$RUST_DIR/speedmap.ipa"
SOURCE_JSON="$SCRIPT_DIR/altstore/source.json"
REPO="intervall-ludger/wlan-heatmap"

CARGO_TOML="$RUST_DIR/src-tauri/Cargo.toml"
PROJECT_YML="$RUST_DIR/src-tauri/gen/apple/project.yml"
INFO_PLIST="$RUST_DIR/src-tauri/gen/apple/speedmap_iOS/Info.plist"

NEW_VERSION=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --version) NEW_VERSION="$2"; shift 2 ;;
        *) echo "Usage: $0 --version <x.y.z>"; exit 1 ;;
    esac
done

if [[ -z "$NEW_VERSION" ]]; then
    echo "Usage: $0 --version <x.y.z>"
    exit 1
fi

if [[ ! "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "ERROR: Version must be in format x.y.z (e.g. 1.0.1)"
    exit 1
fi

if [[ "$(uname)" != "Darwin" ]]; then
    echo "ERROR: iOS builds require macOS"
    exit 1
fi

if [[ ! -f "$SCRIPT_DIR/.env" ]]; then
    echo "ERROR: .env not found. Copy .env.example to .env and set your DEVELOPMENT_TEAM."
    exit 1
fi
source "$SCRIPT_DIR/.env"

for cmd in gh jq cargo sed; do
    if ! command -v "$cmd" &>/dev/null; then
        echo "ERROR: $cmd not found. Install with: brew install $cmd"
        exit 1
    fi
done

if ! gh auth status &>/dev/null; then
    echo "ERROR: Not logged in to GitHub CLI. Run: gh auth login"
    exit 1
fi

echo "==> Bumping version to $NEW_VERSION..."
sed -i '' "s/^version = \".*\"/version = \"$NEW_VERSION\"/" "$CARGO_TOML"
sed -i '' "s/CFBundleShortVersionString: .*/CFBundleShortVersionString: $NEW_VERSION/" "$PROJECT_YML"
sed -i '' "s/CFBundleVersion: .*/CFBundleVersion: \"$NEW_VERSION\"/" "$PROJECT_YML"
sed -i '' "s/<string>[0-9]*\.[0-9]*\.[0-9]*<\/string>/<string>$NEW_VERSION<\/string>/g" "$INFO_PLIST"
echo "    Updated Cargo.toml, project.yml, Info.plist"

VERSION="$NEW_VERSION"
TAG="v$VERSION"

if gh release view "$TAG" --repo "$REPO" &>/dev/null; then
    echo "ERROR: Release $TAG already exists."
    echo "Bump the version in rust-app/src-tauri/Cargo.toml first."
    exit 1
fi

echo "==> Building iOS app ($TAG)..."
cd "$RUST_DIR"
TAURI_CONF="src-tauri/tauri.conf.json"
cp "$TAURI_CONF" "$TAURI_CONF.bak"
jq --arg team "$DEVELOPMENT_TEAM" '.bundle.iOS.developmentTeam = $team' "$TAURI_CONF.bak" > "$TAURI_CONF"
trap 'mv "$RUST_DIR/$TAURI_CONF.bak" "$RUST_DIR/$TAURI_CONF"' EXIT
cargo tauri ios build

IPA_SRC="src-tauri/gen/apple/build/arm64/Speedmap.ipa"
if [[ ! -f "$IPA_SRC" ]]; then
    echo "ERROR: IPA not found at $IPA_SRC"
    exit 1
fi
cp "$IPA_SRC" "$IPA_OUT"
echo "    IPA ready: $IPA_OUT"
cd "$SCRIPT_DIR"

echo ""
echo "==> Creating GitHub release $TAG..."
gh release create "$TAG" "$IPA_OUT" \
    --repo "$REPO" \
    --title "Speedmap $VERSION" \
    --notes "Speedmap $VERSION for iOS"

DOWNLOAD_URL="https://github.com/$REPO/releases/download/$TAG/speedmap.ipa"
IPA_SIZE=$(stat -f%z "$IPA_OUT")
TODAY=$(date +%Y-%m-%d)

echo ""
echo "==> Updating AltStore source..."
NEW_VERSION=$(jq -n \
    --arg ver "$VERSION" \
    --arg date "$TODAY" \
    --arg url "$DOWNLOAD_URL" \
    --argjson size "$IPA_SIZE" \
    '{
        version: $ver,
        date: $date,
        localizedDescription: "",
        downloadURL: $url,
        size: $size,
        minOSVersion: "16.0"
    }')

jq --argjson entry "$NEW_VERSION" \
    '.apps[0].versions = [$entry] + .apps[0].versions' \
    "$SOURCE_JSON" > "$SOURCE_JSON.tmp"
mv "$SOURCE_JSON.tmp" "$SOURCE_JSON"

echo "    source.json updated"
echo ""
echo "==> Done! Commit and push:"
echo "    git add -A && git commit -m 'release $TAG' && git push"
echo ""
echo "==> AltStore source URL:"
echo "    altstore://source?url=https://raw.githubusercontent.com/$REPO/main/altstore/source.json"