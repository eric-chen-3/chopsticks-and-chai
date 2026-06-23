# TestFlight Prep

This project is ready for the macOS/Xcode TestFlight step once the items below are filled in with real account/legal details.

If you only have Windows, follow `WINDOWS_TO_TESTFLIGHT.md` first. Xcode/archive/upload still requires macOS or a hosted macOS build environment.

## Native App Settings

- App name: `Chopsticks & Chai`
- Bundle ID: `com.chopsticksandchai.app`
- Version: `1.0`
- Build: `1`
- Platform: iOS/iPadOS
- Current iOS deployment target: `15.0`
- Capacitor web directory: `www`
- iOS project: `ios/App/App.xcodeproj`
- Provisional app icon: `ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png`

## Build Before Opening Xcode

Run this from the project root:

```powershell
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
npm.cmd run build
npx.cmd cap sync ios
```

Then move the project to macOS and open:

```bash
open ios/App/App.xcodeproj
```

## Xcode Checklist

- Select the `App` target.
- Confirm Display Name is `Chopsticks & Chai`.
- Confirm Bundle Identifier is `com.chopsticksandchai.app`, or replace it with the final Apple Developer bundle ID.
- Select your Apple Developer Team.
- Confirm automatic signing can create a provisioning profile.
- Confirm Version is `1.0` and Build is `1`; increment Build for each upload.
- Set Release scheme/device to `Any iOS Device`.
- Archive with `Product > Archive`.
- Upload through Organizer to App Store Connect.

## App Store Connect App Record

Create or update the app with:

- Name: `Chopsticks & Chai`
- Primary language: English
- Bundle ID: the same ID used in Xcode
- SKU: `chopsticks-and-chai-ios`
- Category: Games
- Content rights: no third-party copyrighted game content currently included
- Age rating draft: likely low, but complete Apple questionnaire based on final content

## TestFlight Information Draft

Beta App Description:

```text
Chopsticks & Chai is a cozy digital version of the chopsticks hand game with cafe-themed characters, power-up variants, friends, lobbies, saves, and online test accounts.
```

What to Test:

```text
Please test account creation/sign-in, profile setup, friend requests, separate-device lobbies, lobby chat, match flow, saves, character unlocks, account deletion, and general UI fit on your device.
```

Beta App Review Notes:

```text
This beta uses Firebase Authentication with email/password sign-in and Firestore for profile, friends, saves, notifications, lobbies, lobby chat, and game state. Create a new test account in-app or use a reviewer test account if provided in App Store Connect. No purchases are enabled.
```

Feedback Email:

```text
TODO: add support email
```

Apple notes: external TestFlight testing requires beta app description and beta app review information, and the first external build must be approved for TestFlight review. See Apple TestFlight docs: https://developer.apple.com/testflight/

## Privacy Label Draft

Apple requires privacy details in App Store Connect for new apps and updates, including data collected by integrated third-party SDKs. See Apple App Privacy details: https://developer.apple.com/app-store/app-privacy-details/

Likely data collected and linked to user identity:

- Email Address: Firebase Authentication account sign-in.
- User ID: Firebase Auth UID and Firestore document ownership.
- User Content: profile username/tag, friends, notifications, saves, lobby messages, lobby/game state.
- Product Interaction: Firebase Analytics may collect app interaction data if analytics remains enabled.
- Diagnostics: Firebase/App Store/TestFlight crash or diagnostic data may be available through platform tooling.

Likely purpose:

- App Functionality for account, friends, lobbies, saves, chat, and gameplay state.
- Analytics only if Firebase Analytics remains enabled and used.

Tracking:

- No advertising tracking is intentionally implemented.
- Confirm whether Firebase Analytics configuration or any future SDK changes affect this answer before submission.

Final privacy answers must match the final Privacy Policy and actual production SDK configuration.

## Legal URLs Needed

Before external testing or App Store submission, replace draft in-app text with:

- Privacy Policy URL
- Terms of Use URL
- Support URL or support email
- Data deletion/support contact instructions

## Export Compliance

The app uses HTTPS/Firebase networking. Answer Apple export-compliance questions in App Store Connect based on final encryption usage and legal guidance. Do not treat this note as legal advice.

## Final Pre-Upload Smoke Test

After the final Firebase rules are published:

```powershell
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
Remove-Item Env:HTTP_PROXY,Env:HTTPS_PROXY,Env:http_proxy,Env:https_proxy -ErrorAction SilentlyContinue
$env:NODE_OPTIONS='--use-system-ca'
npm.cmd run firebase:smoke
npm.cmd run build
npx.cmd cap sync ios
```
