#!/bin/bash

set -euo pipefail

BUILD_IOS=false

while [[ $# -gt 0 ]]; do
    case $1 in
        -i|--ios)
            BUILD_IOS=true
            shift
            ;;
        -h|--help)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  -i, --ios       Build iOS app (requires macOS + Xcode)"
            echo "  -h, --help      Show this help message"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

if [ "$BUILD_IOS" = true ]; then
    if [[ "$(uname)" != "Darwin" ]]; then
        echo "ERROR: iOS builds require macOS"
        exit 1
    fi

    echo "Building iOS app..."
    cargo tauri ios build

    IPA_PATH="src-tauri/gen/apple/build/arm64/Speedmap.ipa"
    if [ -f "$IPA_PATH" ]; then
        cp "$IPA_PATH" ./speedmap.ipa
        echo ""
        echo "IPA created: $(realpath "./speedmap.ipa")"
        echo ""
        echo "Install with Sideloadly or AltStore."
    else
        echo ""
        echo "ERROR: IPA not found at $IPA_PATH"
        exit 1
    fi
else
    echo "No build target specified. Use --ios for iOS build."
    echo "Use --help for usage information."
    exit 1
fi
