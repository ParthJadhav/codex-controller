#!/bin/zsh
set -euo pipefail

ROOT="${0:A:h:h}"
PACKAGE="$ROOT/native"
OUTPUT="$PACKAGE/.build/universal-release"

swift build \
  --package-path "$PACKAGE" \
  --configuration release \
  --arch arm64 \
  --arch x86_64

BIN_PATH="$(swift build \
  --package-path "$PACKAGE" \
  --configuration release \
  --arch arm64 \
  --arch x86_64 \
  --show-bin-path)"
SOURCE="$BIN_PATH/ControllerBridge"
DESTINATION="$OUTPUT/ControllerBridge"

if [[ ! -x "$SOURCE" ]]; then
  print -u2 "Universal ControllerBridge was not produced at $SOURCE"
  exit 1
fi

mkdir -p "$OUTPUT"
install -m 0755 "$SOURCE" "$DESTINATION"

ARCHS="$(lipo -archs "$DESTINATION")"
for REQUIRED_ARCH in arm64 x86_64; do
  if [[ " $ARCHS " != *" $REQUIRED_ARCH "* ]]; then
    print -u2 "ControllerBridge is missing required architecture $REQUIRED_ARCH: $ARCHS"
    exit 1
  fi
done

print "Universal ControllerBridge: $DESTINATION"
print "Architectures: $ARCHS"
