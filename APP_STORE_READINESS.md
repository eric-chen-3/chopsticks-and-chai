# App Store Readiness Plan

This project is now prepared for a Capacitor iOS wrapper, with the current static web app copied into `www/` by `npm run build`.

## Current Wrapper

- Capacitor app name: `Chopsticks & Chai`
- Bundle ID placeholder: `com.chopsticksandchai.app`
- Web asset directory: `www`
- Build command: `npm run build`
- Sync command after native platform setup: `npm run cap:sync`
- iOS native project: `ios/App/App.xcodeproj`

## Windows Notes

This workspace used the bundled Codex Node runtime, which is not on the normal shell `PATH`. If local package scripts fail with `node is not recognized`, install Node.js LTS normally or invoke the bundled Node executable directly.

If package installation fails with `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, try using the Windows certificate store:

```powershell
$env:NODE_OPTIONS='--use-system-ca'
pnpm install
```

Windows can install Capacitor packages and generate/sync the iOS project. Building, signing, archiving, and TestFlight upload still require macOS with Xcode.

## Before TestFlight

1. Keep Firebase Authentication and Firestore rules in production mode.
2. Remove or lock all mock/testing controls from production builds.
3. Decide which data is collected, where it is stored, how deletion works, and how children/minors are handled if relevant.
4. Add Privacy Policy, Terms, support/contact links, and App Store privacy nutrition label inputs.
5. Add production app icons, launch screen, display name, version/build numbers, signing team, and capabilities in Xcode.
6. Create the iOS archive on macOS with Xcode, upload to App Store Connect, and distribute through TestFlight.

## Firebase Migration Status

- Email/password account creation and sign-in are backed by Firebase Authentication.
- User profiles, public profile lookup, presence, friends, notifications, saves, lobbies, active game state, lobby messages, economy/profile updates, and account deletion cleanup are backed by Firebase for signed-in users.
- Settings includes draft Privacy, Terms, Support, and account deletion information surfaces.
- Local storage paths remain as a fallback for unsigned/local development sessions.
- Mock test controls are hidden in production builds, including when the app is opened with `?devtools=1`.
- Firestore rules include field/key validation for the main client-written documents.
- `FIREBASE_OPERATIONS.md` documents rule publishing, smoke testing, and admin-side stale data cleanup.
- `TESTFLIGHT_PREP.md` documents the App Store Connect/TestFlight handoff fields and macOS/Xcode upload steps.
- A provisional 1024x1024 iOS app icon is installed in the asset catalog.

## Remaining Pre-TestFlight Engineering

- Deploy the current `firestore.rules` to Firebase after each rule change.
- Replace draft Privacy/Terms/Support text with final reviewed URLs and App Store privacy-label answers.
- Replace placeholder bundle/signing values with the Apple Developer Team and final App Store Connect app record values.
- Replace provisional icon/launch visuals with final brand assets if desired.
