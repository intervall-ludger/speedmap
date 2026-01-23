#!/bin/bash
set -e

cd "$(dirname "$0")"

echo "Building Rust code for iOS..."
cargo build --release --target aarch64-apple-ios --features custom-protocol

echo "Creating Externals directories..."
mkdir -p gen/apple/Externals/arm64/release
mkdir -p gen/apple/Externals/x86_64/release

echo "Copying libapp.a..."
cp target/aarch64-apple-ios/release/libapp_lib.a gen/apple/Externals/arm64/release/libapp.a
# Create dummy for x86_64 (simulator)
cp target/aarch64-apple-ios/release/libapp_lib.a gen/apple/Externals/x86_64/release/libapp.a

echo "Done! Now open Xcode and build."
