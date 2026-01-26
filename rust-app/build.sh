#!/bin/bash
set -euo pipefail

FLASH=false

usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --ios         Build iOS app"
    echo "  --flash       Build and deploy to connected iPhone"
    echo "  -h, --help    Show this help message"
    exit 0
}

if [[ $# -eq 0 ]]; then
    echo "No option specified."
    usage
fi

while [[ $# -gt 0 ]]; do
    case $1 in
        --ios)
            shift
            ;;
        --flash)
            FLASH=true
            shift
            ;;
        -h|--help)
            usage
            ;;
        *)
            echo "Unknown option: $1"
            usage
            ;;
    esac
done

if [[ "$(uname)" != "Darwin" ]]; then
    echo "ERROR: iOS builds require macOS"
    exit 1
fi

echo "Building iOS app..."
cargo tauri ios build

IPA_PATH="src-tauri/gen/apple/build/arm64/Speedmap.ipa"
if [[ -f "$IPA_PATH" ]]; then
    cp "$IPA_PATH" ./speedmap.ipa
    echo ""
    echo "IPA created: ./speedmap.ipa"

    if [[ "$FLASH" == true ]]; then
        echo ""
        echo "Deploying to iPhone..."

        DEVICE_ID=$(xcrun devicectl list devices 2>/dev/null | grep "iPhone.*connected" | awk '{print $3}' | head -1)

        if [[ -z "$DEVICE_ID" ]]; then
            echo "ERROR: No connected iPhone found"
            echo "Connect your iPhone and trust this computer"
            exit 1
        fi

        echo "Found device: $DEVICE_ID"

        # Extract app from IPA
        rm -rf /tmp/speedmap_install
        mkdir -p /tmp/speedmap_install
        unzip -q ./speedmap.ipa -d /tmp/speedmap_install

        # Install app
        xcrun devicectl device install app --device "$DEVICE_ID" /tmp/speedmap_install/Payload/Speedmap.app

        echo ""
        echo "App installed on iPhone"

        rm -rf /tmp/speedmap_install
    fi
else
    echo "ERROR: IPA not found at $IPA_PATH"
    exit 1
fi
