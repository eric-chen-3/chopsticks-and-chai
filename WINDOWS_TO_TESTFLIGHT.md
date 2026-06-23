# Windows to Internal TestFlight

You cannot run Xcode directly on Windows. Xcode is Apple's build/sign/upload toolchain for Apple platforms, and TestFlight builds must be produced with the Apple iOS toolchain. From a Windows-only machine, use one of the paths below.

## Recommended Path: Temporary Mac Access

This is the lowest-friction route for the first internal TestFlight build.

Options:

- Borrow a Mac for a few hours.
- Rent a hosted Mac with remote desktop.
- Use a local Apple Store/developer friend/Mac mini if available.

You only need the Mac for signing, archiving, and uploading. Most app work can still happen on Windows.

### 1. Prep on Windows

From this project folder:

```powershell
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
Remove-Item Env:HTTP_PROXY,Env:HTTPS_PROXY,Env:http_proxy,Env:https_proxy -ErrorAction SilentlyContinue
$env:NODE_OPTIONS='--use-system-ca'
npm.cmd run firebase:smoke
npm.cmd run testflight:prep
```

Then copy the full project folder to the Mac. Do not copy only `ios/`; the Mac may need the full project for future syncs.

Good transfer options:

- Git repository push/pull.
- Zip the project folder, excluding `node_modules`.
- Cloud drive folder, as long as the iOS project files stay intact.

### 2. Install on the Mac

On the Mac:

1. Install Xcode from the Mac App Store or Apple Developer downloads.
2. Open Xcode once and accept/install any required components.
3. Install Node.js LTS from `nodejs.org`.
4. Open Terminal in the project folder.
5. Run:

```bash
npm install
npm run testflight:prep
open ios/App/App.xcodeproj
```

### 3. Sign in Xcode

In Xcode:

1. Open `ios/App/App.xcodeproj`.
2. Select the blue `App` project in the left sidebar.
3. Select the `App` target.
4. Go to `Signing & Capabilities`.
5. Sign in with your Apple ID if prompted.
6. Select your Apple Developer Team.
7. Keep Bundle Identifier as `com.chopsticksandchai.app`.
8. Confirm automatic signing creates a provisioning profile.

### 4. Archive

In Xcode:

1. Select scheme `App`.
2. Select destination `Any iOS Device`.
3. Choose `Product > Archive`.
4. Wait for Organizer to open.
5. Select the archive.
6. Click `Distribute App`.
7. Choose App Store Connect upload.
8. Let Xcode upload the build.

### 5. App Store Connect Internal TestFlight

In App Store Connect:

1. Create the app record if it does not exist.
2. Use Bundle ID `com.chopsticksandchai.app`.
3. Open the app record.
4. Go to the `TestFlight` tab.
5. Wait for the uploaded build to finish processing.
6. Add internal testers.
7. Assign the build to internal testing.

Internal testing uses members of your App Store Connect team. External testers are separate and require Beta App Review, but you said internal only for now.

## Alternative Path: Hosted CI Build

This is possible from Windows, but it is more setup-heavy than using a Mac once.

Typical services:

- Xcode Cloud
- GitHub Actions macOS runner
- Codemagic
- Bitrise
- A rented Mac with command-line automation

You will need:

- Apple Developer membership.
- App Store Connect app record.
- App Store Connect API key or Apple signing session.
- iOS Distribution certificate.
- App Store provisioning profile.
- A secure place to store signing credentials.

This is worth doing after the first successful manual upload. For the first TestFlight build, manual Xcode upload is usually faster and easier to debug.

## App Icon Changes Later

Yes, you can change the app icon later.

Replace:

```text
ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png
```

Requirements:

- PNG
- 1024 x 1024
- no transparency/alpha
- no pre-rounded corners
- no App Store badge or text

Then increment the build number in Xcode and upload a new build.

## Current Project Values

- App name: `Chopsticks & Chai`
- Bundle ID: `com.chopsticksandchai.app`
- Version: `1.0`
- Build: `1`
- TestFlight mode: internal only
- Provisional icon installed: yes

## What Still Needs You

- Access to any macOS machine with Xcode.
- Apple Developer Team selected in Xcode.
- App Store Connect app record created for `com.chopsticksandchai.app`.
- Final Privacy Policy, Terms, and Support URL/email before wider testing.
