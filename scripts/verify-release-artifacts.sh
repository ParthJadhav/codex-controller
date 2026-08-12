#!/bin/zsh
set -euo pipefail

if (( $# < 1 )); then
  print -u2 "Usage: $0 (--unsigned|--signed|--notarized) [DMG_OR_ZIP ...]"
  exit 64
fi

MODE="$1"
shift
case "$MODE" in
  --unsigned|--signed|--notarized) ;;
  *)
    print -u2 "Unknown verification mode: $MODE"
    exit 64
    ;;
esac

ROOT="${0:A:h:h}"
EXPECTED_VERSION="$(node -p "require('$ROOT/package.json').version")"
EXPECTED_BUNDLE_ID="com.parthjadhav.CodexController"
EXPECTED_EXECUTABLE="Codex Controller"

if (( $# > 0 )); then
  ARTIFACTS=("$@")
else
  ARTIFACTS=("$ROOT"/dist/*.dmg(N) "$ROOT"/dist/*.zip(N))
fi

if (( ${#ARTIFACTS} == 0 )); then
  print -u2 "No DMG or ZIP artifacts found."
  exit 66
fi

verify_app() {
  local APP="$1"
  local ARTIFACT="$2"
  local INFO="$APP/Contents/Info.plist"
  local MAIN_EXECUTABLE="$APP/Contents/MacOS/$EXPECTED_EXECUTABLE"
  local NATIVE_HELPER="$APP/Contents/Resources/native/ControllerBridge"
  local ASAR="$APP/Contents/Resources/app.asar"

  [[ -f "$INFO" ]]
  [[ -x "$MAIN_EXECUTABLE" ]]
  [[ -x "$NATIVE_HELPER" ]]
  [[ -f "$ASAR" ]]
  [[ "$(plutil -extract CFBundleIdentifier raw -o - "$INFO")" == "$EXPECTED_BUNDLE_ID" ]]
  [[ "$(plutil -extract CFBundleShortVersionString raw -o - "$INFO")" == "$EXPECTED_VERSION" ]]

  local MAIN_ARCHS="$(lipo -archs "$MAIN_EXECUTABLE")"
  local HELPER_ARCHS="$(lipo -archs "$NATIVE_HELPER")"
  for REQUIRED_ARCH in arm64 x86_64; do
    [[ " $MAIN_ARCHS " == *" $REQUIRED_ARCH "* ]]
    [[ " $HELPER_ARCHS " == *" $REQUIRED_ARCH "* ]]
  done

  if [[ "$MODE" == "--signed" || "$MODE" == "--notarized" ]]; then
    codesign --verify --deep --strict --verbose=2 "$APP"
    local SIGNATURE_INFO="$(codesign -dv --verbose=4 "$APP" 2>&1)"
    [[ "$SIGNATURE_INFO" == *"Authority=Developer ID Application:"* ]]
    [[ "$SIGNATURE_INFO" == *"(runtime)"* ]]

    local ENTITLEMENTS_XML="$(codesign -d --entitlements :- "$APP" 2>/dev/null || true)"
    local GET_TASK_ALLOW="$(print -r -- "$ENTITLEMENTS_XML" | plutil -extract com.apple.security.get-task-allow raw -o - - 2>/dev/null || true)"
    [[ "$GET_TASK_ALLOW" != "true" ]]
  fi

  if [[ "$MODE" == "--notarized" ]]; then
    xcrun stapler validate "$APP"
    spctl --assess --type execute --verbose=4 "$APP"
    if [[ "$ARTIFACT" == *.dmg ]]; then
      xcrun stapler validate "$ARTIFACT"
    fi
  fi

  print "Verified app: $EXPECTED_BUNDLE_ID $EXPECTED_VERSION"
  print "Main architectures: $MAIN_ARCHS"
  print "Helper architectures: $HELPER_ARCHS"
}

for ARTIFACT in "${ARTIFACTS[@]}"; do
  if [[ ! -f "$ARTIFACT" ]]; then
    print -u2 "Release artifact not found: $ARTIFACT"
    exit 66
  fi

  VERIFY_DIR="$(mktemp -d "${TMPDIR:-/tmp}/codex-controller-verify.XXXXXX")"
  APP=""
  if [[ "$ARTIFACT" == *.zip ]]; then
    ditto -x -k "$ARTIFACT" "$VERIFY_DIR"
    APPS=("$VERIFY_DIR"/*.app(N))
  elif [[ "$ARTIFACT" == *.dmg ]]; then
    MOUNT="$VERIFY_DIR/mount"
    mkdir -p "$MOUNT"
    hdiutil attach "$ARTIFACT" -nobrowse -readonly -mountpoint "$MOUNT" -quiet
    APPS=("$MOUNT"/*.app(N))
  else
    print -u2 "Unsupported release artifact: $ARTIFACT"
    rm -rf "$VERIFY_DIR"
    exit 64
  fi

  if (( ${#APPS} != 1 )); then
    print -u2 "Expected exactly one app in ${ARTIFACT:t}; found ${#APPS}."
    [[ -n "${MOUNT:-}" && -d "$MOUNT" ]] && hdiutil detach "$MOUNT" -quiet || true
    rm -rf "$VERIFY_DIR"
    exit 1
  fi

  verify_app "${APPS[1]}" "$ARTIFACT"
  [[ -n "${MOUNT:-}" && -d "$MOUNT" ]] && hdiutil detach "$MOUNT" -quiet || true
  unset MOUNT
  rm -rf "$VERIFY_DIR"
  shasum -a 256 "$ARTIFACT"
done

print "Release artifact verification passed ($MODE)."
