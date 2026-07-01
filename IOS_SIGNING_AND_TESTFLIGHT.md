# iOS Signing and TestFlight Upload Setup

This repo has a manual GitHub Actions job named `Signed TestFlight upload`. It only runs when you start the `iOS build` workflow manually from the Actions tab. Normal pushes and pull requests still run the unsigned simulator build.

## 1. Apple Developer: confirm Bundle ID

Use the explicit Bundle ID already configured in Capacitor and Xcode:

```text
com.chopsticksandchai.app
```

Current app capabilities can remain empty. Firebase Auth and Firestore over HTTPS do not require a special Apple capability.

## 2. Apple Developer: create an Apple Distribution certificate

Create or use an existing Apple Distribution certificate for App Store distribution.

You need a `.p12` export of the certificate plus private key. The easiest way to create/export this is from a Mac with Xcode or Keychain Access. If you do not have a Mac, use the hosted Mac/CI provider path you choose for signing setup, or use a borrowed Mac once to create the certificate export.

When exporting the `.p12`, set a password. You will save that password in GitHub as `IOS_DISTRIBUTION_CERTIFICATE_PASSWORD`.

## 3. Apple Developer: create an App Store provisioning profile

Create an App Store distribution provisioning profile for:

```text
com.chopsticksandchai.app
```

Download the `.mobileprovision` file. The GitHub Actions workflow reads the profile name and team ID from this file automatically.

## 4. App Store Connect: create an API key

Create an App Store Connect API key with access that can upload builds.

Save:

- Key ID
- Issuer ID
- The `.p8` private key file contents

The `.p8` private key is only downloadable once from Apple, so store it carefully.

## 5. Convert signing files to Base64

On macOS or Linux:

```bash
base64 -i AppleDistribution.p12 | pbcopy
base64 -i ChopsticksAndChai_AppStore.mobileprovision | pbcopy
```

On Windows PowerShell:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\path\to\AppleDistribution.p12")) | Set-Clipboard
[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\path\to\ChopsticksAndChai_AppStore.mobileprovision")) | Set-Clipboard
```

Paste each copied value into the matching GitHub Secret.

## 6. GitHub: create repository secrets

Go to:

```text
GitHub repo -> Settings -> Secrets and variables -> Actions -> New repository secret
```

Create these secrets:

```text
APP_STORE_CONNECT_KEY_ID
APP_STORE_CONNECT_ISSUER_ID
APP_STORE_CONNECT_PRIVATE_KEY
IOS_DISTRIBUTION_CERTIFICATE_BASE64
IOS_DISTRIBUTION_CERTIFICATE_PASSWORD
IOS_PROVISIONING_PROFILE_BASE64
```

For `APP_STORE_CONNECT_PRIVATE_KEY`, paste the full `.p8` file content, including the BEGIN and END lines.

## 7. Commit and push the workflow update

Commit this file:

```text
.github/workflows/ios-build.yml
```

Also commit this guide if you want it in the repo:

```text
IOS_SIGNING_AND_TESTFLIGHT.md
```

## 8. Run the upload workflow

After the secrets are added and pushed:

1. Open the GitHub repo.
2. Go to `Actions`.
3. Select `iOS build`.
4. Click `Run workflow`.
5. Choose branch `main`.
6. Start the workflow.

The workflow will:

- install dependencies
- build the web app
- sync Capacitor iOS
- import the Apple Distribution certificate
- install the provisioning profile
- archive the app
- export a signed `.ipa`
- upload the `.ipa` artifact to GitHub Actions
- upload the `.ipa` to TestFlight

## 9. App Store Connect: process and test

After upload succeeds:

1. Open App Store Connect.
2. Go to `My Apps -> Chopsticks & Chai -> TestFlight`.
3. Wait for Apple build processing.
4. Add the processed build to internal testing.
5. Add yourself as an internal tester.
6. Install using the TestFlight app on your iPhone.

## Notes

- Internal TestFlight does not require external beta review.
- External testers require beta review.
- You must increment build numbers for future uploads. The first build currently uses `CURRENT_PROJECT_VERSION = 1`.
