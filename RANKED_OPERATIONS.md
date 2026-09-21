# Ranked launch and deployment

Power Up is retained in game.js (engine, cards, rewards and achievements), the hidden powerMode button, and the commented Help section. Launch entry points and saved-game restoration reject Power Up. Re-enable these guards and UI together for a future release.

## Deploy

This feature adds trusted Firebase Functions; publishing Firestore rules alone does not enable Ranked. Use the existing Firebase project `chopsticks-and-chai`.

1. Install dependencies: `npm install --prefix functions`.
2. Authenticate the Firebase CLI with the project owner account.
3. Deploy: `firebase deploy --project chopsticks-and-chai --only functions,firestore:rules`.
4. Reload the app and sign in with two different accounts. Open Ranked on both; confirm matching, terminal-move results, trophy changes on both profiles, and Leaderboard.

Functions run in us-central1. Scheduled maintenance runs once a minute (UTC); deployment needs a project configured for Cloud Functions and Cloud Scheduler. No RTDB rules changes are required by Ranked.

## Authority and concurrency

Clients cannot write rankedPlayers, rankedQueue, rankedInternal or Ranked lobby state. Callable functions authenticate participants, validate Standard moves, choose the winner, and atomically settle both players' trophies once. The initial profiles are frozen in the lobby for trophy calculation. Repeated completed requests return the existing result. Turn deadlines use server time. Queue operations and season settlement use a transaction lock; expired queue entries are ignored after 20 seconds without a heartbeat. The client polls every five seconds. A cancellation racing a match claim resumes that match. Abandoned games settle after their 30-second turn expires; maintenance handles games where both clients close.

This initial queue uses a single transaction lock and a bounded candidate scan of 100 live entries. A larger concurrent population will need a partitioned queue. Matchmaking starts within 100 strength points, expanding by 100 every 15 seconds. Usernames break leaderboard ties, then stable UID. Leaderboards subscribe to all entries in the selected rank.

Strength = overall trophies + 120 × (smoothed win rate − 0.5), where smoothed win rate = (wins + 20) / (games + 40). Opponent strength difference / 200 is clamped to −1…1. Win-range position = clamp(0.5 + 0.4 × difference + 0.1 × max(0, 1 − games/20)); loss-range position = clamp(0.5 − 0.4 × difference). Interpolate inside the rank's range and round. All counts are lifetime Ranked counts. Dirt's floor may reduce an actual deduction below its quoted loss range.

At an exact downward rank boundary, retain the lower rank with 100 trophies until the next win promotes it; this implements the requested demotion at zero without immediately promoting again. Promotion carries overflow; Divine is uncapped.

## Seasons

UTC calendar months. Matches belong to the season in which matchmaking created them. At rollover, an active match settles before that account resets. Accounts with at least one Ranked game receive the highest rank's reward once, deposited into their existing economy.coins and inventory.consumables.chaiTeaSpecial. A reward receipt is stored at rankedPlayers/{uid}/rewards/{season}. No participation means no reward. Only one soft reset occurs when a dormant account next settles, not repeated penalties for each missed month. Lifetime win/game counts persist. New season highestRank starts at the reset rank.

Dirt: win 15–21, lose 7–10, reset 0%, 100 gold + 1 chai.
Plain: win 13–19, lose 9–13, reset 10%, 250 gold + 2 chai.
Vanilla: win 11–17, lose 11–16, reset 15%, 500 gold + 3 chai.
Matcha: win 11–17, lose 13–18, reset 20%, 800 gold + 4 chai.
Divine: win 10–15, lose 15–20, reset 25%, 1200 gold + 5 chai.

## Checks

`node scripts/ranked-test.mjs`
`node scripts/match-chat-test.mjs`
`node scripts/presence-test.mjs`
`node scripts/friend-profile-test.cjs`
`npm run build`

Live Functions/Firestore integration still requires deployment and two-account testing. Pure logic tests are not a substitute for that check.
