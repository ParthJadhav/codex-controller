# Releasing Codex Controller

Every release is built from a version tag, signed with a Developer ID
Application certificate, notarized by Apple, verified, and published as a
universal DMG and ZIP.

## One-time GitHub setup

Create a protected `release` environment and add these secrets:

- `CSC_LINK`: base64-encoded Developer ID Application `.p12`
- `CSC_KEY_PASSWORD`: password used to export that `.p12`
- `APPLE_API_KEY_CONTENT`: contents of an App Store Connect API `.p8` key
- `APPLE_API_KEY_ID`: key ID for the `.p8` key
- `APPLE_API_ISSUER`: App Store Connect issuer ID

Require a maintainer approval on the environment. Restrict version-tag creation
and deletion to maintainers, and require the CI workflow on `main`.

The workflow writes the API key to a temporary runner file, uses it only for
the release, and removes it in an `always()` cleanup step. Fork pull requests
cannot access release-environment secrets.

## Prepare a version

1. Update `package.json` and `package-lock.json` to the same semantic version.
2. Move the relevant entries in `CHANGELOG.md` under that version.
3. Run the complete local gate:

   ```sh
   npm ci
   npm audit --audit-level=high
   npm test
   swift test --package-path native
   npm run build:all
   npm run dist
   ./scripts/verify-release-artifacts.sh --signed
   ```

4. Confirm the intended controller, permission, reconnect, sleep/wake, and
   Accessibility cases on the exact candidate.
5. Merge the version commit to `main` and wait for CI.

## Publish

Tag the exact `main` commit and push the tag:

```sh
git switch main
git pull --ff-only
git tag -s v0.2.0 -m "Codex Controller v0.2.0"
git push origin v0.2.0
```

`.github/workflows/release.yml` then:

1. validates that the tag matches `package.json` and points at `main`;
2. audits all dependencies and runs both test suites;
3. cross-builds the Swift helper for arm64 and x86_64;
4. packages a universal Electron app as DMG and ZIP;
5. signs with Developer ID and enables hardened runtime;
6. notarizes the app and the exact DMG/ZIP bytes, then staples the DMG;
7. verifies signatures, tickets, Gatekeeper assessment, entitlements, bundle
   identity, version, and both architectures;
8. publishes checksums, a CycloneDX SBOM, and generated release notes.

Do not create or replace a release by hand when any gate fails. Fix the version
commit, delete the unpublished tag, and issue a new tag only after the commit is
green.

## Local notarization

The release scripts accept any authentication method supported by
`notarytool`. The safest local option is a keychain profile:

```sh
xcrun notarytool store-credentials codex-controller-notary
export APPLE_KEYCHAIN_PROFILE=codex-controller-notary
npm run dist
npm run release:notarize
npm run release:verify
```

`npm run release:notarize` submits both the DMG and ZIP. The DMG is stapled;
the ZIP cannot be stapled, so it contains the already-stapled application and
is separately accepted by Apple's notary service.
