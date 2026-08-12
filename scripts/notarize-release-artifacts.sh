#!/bin/zsh
set -euo pipefail

ROOT="${0:A:h:h}"
TIMEOUT="${NOTARY_TIMEOUT:-30m}"

if [[ -n "${APPLE_KEYCHAIN_PROFILE:-}" ]]; then
  AUTH=(--keychain-profile "$APPLE_KEYCHAIN_PROFILE")
elif [[ -n "${APPLE_API_KEY:-}" && -n "${APPLE_API_KEY_ID:-}" && -n "${APPLE_API_ISSUER:-}" ]]; then
  AUTH=(--key "$APPLE_API_KEY" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER")
elif [[ -n "${APPLE_ID:-}" && -n "${APPLE_APP_SPECIFIC_PASSWORD:-}" && -n "${APPLE_TEAM_ID:-}" ]]; then
  AUTH=(--apple-id "$APPLE_ID" --password "$APPLE_APP_SPECIFIC_PASSWORD" --team-id "$APPLE_TEAM_ID")
else
  print -u2 "No Apple notarization credentials were supplied."
  print -u2 "Set APPLE_KEYCHAIN_PROFILE, an App Store Connect API key, or Apple ID notarization variables."
  exit 78
fi

if (( $# > 0 )); then
  ARTIFACTS=("$@")
else
  ARTIFACTS=("$ROOT"/dist/*.dmg(N) "$ROOT"/dist/*.zip(N))
fi

if (( ${#ARTIFACTS} == 0 )); then
  print -u2 "No DMG or ZIP artifacts found. Run npm run dist first."
  exit 66
fi

for ARTIFACT in "${ARTIFACTS[@]}"; do
  if [[ ! -f "$ARTIFACT" ]]; then
    print -u2 "Release artifact not found: $ARTIFACT"
    exit 66
  fi

  print "Submitting ${ARTIFACT:t} to Apple's notary service…"
  RESULT="$(xcrun notarytool submit "$ARTIFACT" \
    "${AUTH[@]}" \
    --wait \
    --timeout "$TIMEOUT" \
    --output-format json)"
  STATUS="$(print -r -- "$RESULT" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>process.stdout.write(JSON.parse(s).status ?? ""))')"
  SUBMISSION_ID="$(print -r -- "$RESULT" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>process.stdout.write(JSON.parse(s).id ?? ""))')"

  if [[ "$STATUS" != "Accepted" ]]; then
    print -u2 "Notarization failed for ${ARTIFACT:t}: ${STATUS:-unknown} ($SUBMISSION_ID)"
    xcrun notarytool log "$SUBMISSION_ID" "${AUTH[@]}" || true
    exit 1
  fi

  print "Accepted: ${ARTIFACT:t} ($SUBMISSION_ID)"
  if [[ "$ARTIFACT" == *.dmg ]]; then
    xcrun stapler staple "$ARTIFACT"
    xcrun stapler validate "$ARTIFACT"
  fi
done
