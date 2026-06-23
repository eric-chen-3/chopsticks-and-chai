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
- owned `friends`, `notifications`, and `saves`,
- reverse friend docs where rules allow the deleting user to remove themselves,
- participant lobbies visible to the user, after deleting lobby messages.
