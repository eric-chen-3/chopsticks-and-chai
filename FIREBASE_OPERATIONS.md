# Firebase Operations Notes

These notes cover backend maintenance that should happen before TestFlight testing expands beyond a small internal group.

## Publish Rules

After editing `firestore.rules`, publish the file from the Firebase console or Firebase CLI, then run:

```powershell
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
Remove-Item Env:HTTP_PROXY,Env:HTTPS_PROXY,Env:http_proxy,Env:https_proxy -ErrorAction SilentlyContinue
$env:NODE_OPTIONS='--use-system-ca'
node scripts/firebase-smoke-test.mjs
```

The smoke test creates disposable users, exercises the allowed and denied client paths, and cleans up data that client rules permit it to delete.

## Stale Data Cleanup

Firestore does not automatically cascade-delete subcollections. The app now deletes lobby messages before deleting a lobby, but historical or interrupted writes can still leave stale records.

Before external TestFlight testing, add one of these admin-side cleanup paths:

- A scheduled Cloud Function that deletes old lobbies and their `messages` subcollections after a fixed TTL.
- A local admin script using `firebase-admin` and a service account, run only by the project owner.
- A manual Firebase console cleanup process for early internal testing.

Suggested cleanup targets:

- `lobbies` older than 24 hours with no active game.
- `lobbies/{lobbyId}/messages` under lobbies selected for deletion.
- `publicProfiles` whose `uid` no longer has a matching Auth user.
- Test users or test data with `codex_` prefixes from smoke-test failures.

Do not add admin credentials to this repository.

## Current Client Cleanup

Signed-in account deletion removes:

- the Firebase Auth user,
- the private `users/{uid}` profile,
- `publicProfiles/{username_tag}`,
- owned `friends` and `notifications`,
- reverse friend docs where rules allow the deleting user to remove themselves,
- participant lobbies visible to the user, after deleting lobby messages.


## Realtime Database presence

Database: https://chopsticks-and-chai-default-rtdb.firebaseio.com/

Publish the contents of `database.rules.json` under Firebase Console → Realtime Database → Rules. These are separate from Firestore rules. Signed-in users can read presence; each user can write only their own session records. No profile, email, or lobby data is stored here.

The revised rules must be republished: each account has one `activeSession` owner ID. The first active session keeps ownership. A new login is rejected while the owner's connection record exists; the existing app and game are unaffected. Admission is atomic, so simultaneous sign-ins cannot both win. The rejected instance shows an explanation and signs out locally. A new login is allowed after logout or server disconnect cleanup removes the active connection record. An older disconnected app cannot reclaim ownership after another session has been admitted. Only the current owner's connection record determines availability.

Disconnect cleanup removes only that session's connection record, so old-device cleanup cannot remove a new session. Logout and page exit close the connection. Switching tabs leaves it connected; mobile background suspension may disconnect it. Abrupt network failure detection follows Firebase's timeout and is not guaranteed within three seconds.

Web authentication uses session persistence: closing the tab ends persisted login. A second normal tab starts at login. Refreshing establishes a fresh app instance, which can be admitted after the prior connection has been cleaned up; it cannot override a still-active record. Reload all app instances after publishing; older builds do not enforce admission correctly.

This enforces session ownership in the app and rejects competing clients. It does not revoke Firebase tokens through a trusted backend or add session-token authorization to every Firestore operation; modified clients with previously issued credentials are outside this UI mechanism.

Pending friend requests stay white until accepted or declined, including after they have been read.

Validation: `node scripts/presence-test.mjs` and `npm run build`.
After publishing, reload both test tabs. Sign in to the same account in both and verify the second login is rejected while the first stays connected. Log out of the first, then verify the second can sign in. Also test reconnect and delayed cleanup from an older device.
