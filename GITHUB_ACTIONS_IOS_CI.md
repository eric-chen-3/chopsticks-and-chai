# GitHub Actions iOS CI

This project now includes a build-only GitHub Actions workflow:

```text
.github/workflows/ios-build.yml
```

Because the repository will be public, GitHub-hosted standard runners are free for public repositories. The workflow uses a hosted macOS runner to verify that the Capacitor iOS project builds.

## What The Current Workflow Does

On pushes and pull requests to `main`, plus manual runs, it:

1. Checks out the repository.
2. Installs Node 24.
3. Runs `npm ci`.
4. Runs `npm run testflight:prep`.
5. Runs `xcodebuild` for the iOS Simulator with code signing disabled.

This proves the app can compile on macOS, but it does not create or upload a TestFlight build yet.

## Get This Repo Onto GitHub

### Option A: GitHub Desktop

1. Install GitHub Desktop.
2. Sign in.
3. Choose `File > Add local repository`.
4. Select this project folder, named `Chopsticks`.
5. If prompted, create the repository.
6. Publish it to GitHub.
7. Choose `Public`.

### Option B: Command Line

Create a new empty public repo on GitHub, then run:

```powershell
git init
git add .
git commit -m "Initial iOS CI setup"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

After pushing, open the repo on GitHub and go to the `Actions` tab. The `iOS build` workflow should run automatically.

## Later: Uploading To TestFlight Automatically

The current workflow intentionally does not upload to TestFlight. Uploading requires Apple secrets and signing assets.

You will eventually need:

- App Store Connect API key issuer ID.
- App Store Connect API key ID.
- App Store Connect API private key file, usually named like `AuthKey_ABC123DEFG.p8`.
- iOS Distribution certificate.
- App Store provisioning profile for `com.chopsticksandchai.app`.

## What The App Store Connect API Key Is For

An App Store Connect API key lets CI authenticate to App Store Connect without using your Apple ID password. It can be used by upload tooling, such as Fastlane or Apple command-line tools, to upload builds and manage TestFlight metadata.

Do not paste the private `.p8` key into chat. In CI, it should be stored as a GitHub Actions secret.

Typical GitHub secrets for a future upload workflow:

```text
APP_STORE_CONNECT_KEY_ID
APP_STORE_CONNECT_ISSUER_ID
APP_STORE_CONNECT_PRIVATE_KEY
IOS_DISTRIBUTION_CERTIFICATE_BASE64
IOS_DISTRIBUTION_CERTIFICATE_PASSWORD
IOS_PROVISIONING_PROFILE_BASE64
```

We can add upload automation after the build-only workflow is green.

## Creating The App Store Connect API Key Later

1. Go to App Store Connect.
2. Open `Users and Access`.
3. Open the `Integrations` or `Keys` area for App Store Connect API.
4. Create a key with access appropriate for app/build upload.
5. Download the `.p8` private key once and store it securely.
6. Record the Key ID and Issuer ID.

Keep these private. They are not needed for build-only CI.

## Cost Notes

- Public GitHub repositories can use standard GitHub-hosted runners for free.
- Private repositories have included minutes based on plan, then overage billing.
- macOS runners cost more than Linux when billed, so keep iOS workflows focused.

Source: GitHub Actions billing docs: https://docs.github.com/en/billing/concepts/product-billing/github-actions
