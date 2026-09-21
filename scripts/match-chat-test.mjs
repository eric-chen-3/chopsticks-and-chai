import { isDraw } from "../functions/match-clock.js";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
const load = async (file) => import(`data:text/javascript;base64,${Buffer.from((await readFile(new URL(file, import.meta.url), "utf8")).replace('"./functions/match-clock.js"', JSON.stringify(new URL("../functions/match-clock.js", import.meta.url).href))).toString("base64")}`);
const { sameMatch, completedGameState, protectCompletedMatch, mergeLobbyGame, validMatchEnding } = await load("../match-sync.js");
const source = await readFile(new URL("../game.js", import.meta.url), "utf8");
function fn(name) {
  const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(start >= 0, name);
  const rest = source.slice(start);
  const end = rest.slice(1).search(/\n(?:async )?function /);
  return end < 0 ? rest : rest.slice(0, end + 1);
}
const live = { matchId: "round-1", current: 0, over: false, submode: "Separate Devices", lobbyId: "lobby",
  players: [{ name: "winner", hands: [1, 1] }, { name: "loser", hands: [0, 0] }] };
const final = completedGameState(live, 0, 1);
// Reported regression: 1 attacking 3 gives 4, not a knockout.
const handTest = vm.createContext({ isPowerMode: () => false, deathThreshold: () => 5 });
vm.runInContext(fn("applyHit"), handTest);
const attacker = { hands: [1, 0] };
const defender = { hands: [3, 0] };
handTest.applyHit(attacker, defender, 0, 0);
assert.deepEqual(defender.hands, [4, 0]);
const nonterminal = { ...live, revision: 4, turnDeadlineAt: 2000,
  players: [{ name: "winner", hands: [1, 0] }, { name: "loser", hands: [4, 0] }] };
assert.equal(validMatchEnding({ gameState: nonterminal }, completedGameState(nonterminal, 0, 1), 1000), false);
const bogusTimeout = completedGameState({ ...nonterminal, timeoutForfeit: true }, 1, 0);
assert.equal(validMatchEnding({ gameState: nonterminal }, bogusTimeout, 1000), false, "deadline has not elapsed");
assert.equal(validMatchEnding({ gameState: { ...nonterminal, current: 1, turnDeadlineAt: 3000 } }, bogusTimeout, 2500), false, "old turn timeout cannot end new turn");
assert.equal(validMatchEnding({ gameState: nonterminal }, bogusTimeout, 2500), true);
const staleLobby = { gameState: { ...nonterminal, revision: 1 } };
assert.equal(mergeLobbyGame({ gameState: nonterminal }, staleLobby).gameState, nonterminal);
assert.equal(mergeLobbyGame({ gameState: nonterminal }, staleLobby, true).gameState, nonterminal);
handTest.applyHit(defender, attacker, 0, 0);
assert.deepEqual(attacker.hands, [0, 0], "4 attacking 1 is the actual finishing move");
const completedLobby = { status: "complete", activeGame: false, gameState: final };
const staleTimer = protectCompletedMatch(completedLobby, { status: "inGame", activeGame: true, gameState: live });
assert.equal(staleTimer.activeGame, false);
assert.equal(staleTimer.status, "complete");
assert.equal(staleTimer.gameState.result.winnerIndex, 0);
const staleForfeit = protectCompletedMatch(completedLobby, { status: "complete", gameState: completedGameState(live, 1, 0) });
assert.equal(staleForfeit.gameState.result.winnerIndex, 0);
assert.equal(protectCompletedMatch(completedLobby, { gameState: null }).gameState, final);
const nextGame = { ...live, matchId: "round-2" };
assert.equal(protectCompletedMatch(completedLobby, { gameState: nextGame }).gameState, nextGame);

const resultCalls = [];
const context = vm.createContext({
  game: structuredClone(live), isDraw, sameMatch, completedResultScreens: new Set(),
  opponentPlayer: () => context.game.players[1], opponentIndex: () => 1,
  showGameOver: (...args) => resultCalls.push(args), showScreen: () => {},
});
vm.runInContext(fn("checkWinner") + fn("applyRemoteCompletedLobby"), context);
context.checkWinner();
assert.equal(context.game.over, true);
assert.deepEqual(resultCalls[0], [0, 1], "final hit triggers completion without End Turn");
context.game = structuredClone(live);
assert.equal(context.applyRemoteCompletedLobby(completedLobby), true);
assert.equal(context.game.over, true);
assert.equal(context.game.rewardSummary, null);
assert.equal(resultCalls[1][0], 0);
assert.equal(resultCalls[1][1], 1);
assert.equal(resultCalls[1][2].remote, true);
context.completedResultScreens.add("round-1");
context.applyRemoteCompletedLobby(completedLobby);
assert.equal(resultCalls.length, 2, "duplicate snapshots do not award/show again");
context.game = nextGame;
assert.equal(context.applyRemoteCompletedLobby(completedLobby), false, "old result cannot end a new round");

// The losing player sees their avatar and stopped timers before reward I/O finishes.
const nodes = new Map();
function node(selector) {
  if (!nodes.has(selector)) nodes.set(selector, {
    hidden: false, open: false, textContent: "", innerHTML: "", classes: {},
    classList: { remove: (name) => { delete node(selector).classes[name]; }, toggle: (name, enabled) => { node(selector).classes[name] = enabled; } },
    showModal() { this.open = true; },
  });
  return nodes.get(selector);
}
const stopped = [];
let finishRewards;
const resultContext = vm.createContext({
  game: structuredClone(final), isDraw, completedGameState, renderRankedResultHeader() {}, completedResultScreens: new Set(),
  gameStateSyncTimer: 10, forfeitTimerId: 11,
  stopTurnTimerLoop: () => stopped.push("turn"), clearAiMoveTimer: () => {}, clearActiveGameState: () => {},
  window: { clearTimeout: id => stopped.push(id), clearInterval: id => stopped.push(id) },
  document: { querySelector: node }, activePlayerIndex: () => 1,
  getPlayerCharacter: index => ({ index }), characterMarkup: (character, classes) => `${character.index}:${classes}`,
  renderRewardPanel: () => {}, playEndGameSounds: sound => stopped.push(sound), writePresence: () => {},
  awardMatchRewardsAsync: () => new Promise(resolve => { finishRewards = resolve; }),
  rewardForUsername: () => ({ xp: 1, coins: 0 }), animateRewardPanel: () => {}, auditUserAction: () => {},
});
vm.runInContext(fn("renderPlayerStatus") + "\n" + fn("showGameOver"), resultContext);
const showing = resultContext.showGameOver(0, 1, { remote: true });
assert.equal(node("#gameOverDialog").open, true);
assert.equal(node("#winnerTitle").textContent, "You lost");
assert.equal(node("#gameOverAvatar").innerHTML, "1:result-avatar sad");
assert.ok(stopped.includes("turn") && stopped.includes(10) && stopped.includes(11));
assert.ok(stopped.includes("lose"));
finishRewards(); await showing;

// Unread chat is scoped to account/lobby, ignores own messages, and clears on read.
const storage = new Map();
const badge = {};
const button = { setAttribute: (key, value) => { button[key] = value; } };
let username = "alice";
let lobbyId = "one";
let messages = [{ id: "1", sender: "bob", text: "hello" }];
const chat = vm.createContext({
  getActiveUsername: () => username, activeInviteId: () => lobbyId,
  getLobbyChat: () => messages, readJson: (key, fallback) => storage.get(key) ?? fallback,
  writeJson: (key, value) => storage.set(key, value),
  document: { querySelector: (selector) => selector === "#lobbyChatBadge" ? badge : button },
});
vm.runInContext(["lobbyChatReadKey", "lobbyChatMessageKey", "markLobbyChatRead", "renderLobbyChatBadge"].map(fn).join("\n"), chat);
chat.renderLobbyChatBadge(); assert.equal(badge.hidden, false);
chat.markLobbyChatRead(); assert.equal(badge.hidden, true);
messages.push({ id: "2", sender: "alice", text: "mine" });
chat.renderLobbyChatBadge(); assert.equal(badge.hidden, true);
messages.push({ id: "3", sender: "bob", text: "new" });
chat.renderLobbyChatBadge(); assert.equal(badge.hidden, false);
chat.markLobbyChatRead();
lobbyId = "two";
chat.renderLobbyChatBadge(); assert.equal(badge.hidden, false);
console.log("PASS: final-hit completion, remote loss result, duplicate snapshots, stale timer/forfeit protection, next round isolation, unread chat and read clearing.");
