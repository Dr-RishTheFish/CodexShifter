#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
APP="../Codex Shifter.app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
swiftc -swift-version 5 -O -framework Cocoa -framework WebKit Sources/main.swift -o "$APP/Contents/MacOS/CodexShifter"
find Resources -maxdepth 1 -type f -exec cp {} "$APP/Contents/Resources/" \;
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>Codex Shifter</string><key>CFBundleDisplayName</key><string>Codex Shifter</string>
<key>CFBundleIdentifier</key><string>local.codex.shifter</string><key>CFBundleExecutable</key><string>CodexShifter</string>
<key>CFBundlePackageType</key><string>APPL</string><key>CFBundleShortVersionString</key><string>1.1.0</string>
<key>CFBundleVersion</key><string>1</string><key>LSMinimumSystemVersion</key><string>13.0</string>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST
codesign --force --deep --sign - "$APP"
printf 'Built %s\n' "$APP"
