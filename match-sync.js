import { expiredMatchResult, isDraw } from "./functions/match-clock.js";
export function sameMatch(a, b) {
  return Boolean(a && b && (a.matchId || "legacy") === (b.matchId || "legacy"));
}

export function protectCompletedMatch(current, incoming) {
  const finished = current?.gameState;
  if (!finished?.over || (incoming.gameState && !sameMatch(finished, incoming.gameState))) return incoming;
  return {
    ...incoming,
    gameState: finished,
    activeGame: false,
    absentPlayers: {},
    status: incoming.status === "inGame" ? "complete" : incoming.status,
  };
}

export function completedGameState(state, winnerIndex, loserIndex) {
  return { ...state, over: true, selected: null, rewardSummary: null,
    result: isDraw(state) ? { outcome: "draw", winnerIndex: null, loserIndex: null, reason: "match-timeout" } : { winnerIndex, loserIndex, reason: state.endReason || (state.timeoutForfeit ? "timeout" : "knockout") }, syncedAt: Date.now() };
}

export function mergeLobbyGame(current, incoming, syncGame = false) {
  const saved = current?.gameState;
  if (saved && (!syncGame || (sameMatch(saved, incoming.gameState) &&
      Number(saved.revision || 0) >= Number(incoming.gameState?.revision || 0)))) {
    incoming = { ...incoming, gameState: saved };
  }
  if (saved && sameMatch(saved, incoming.gameState) && Number.isFinite(saved.matchDeadlineAt)) {
    incoming = { ...incoming, gameState: { ...incoming.gameState, matchStartedAt: saved.matchStartedAt, matchDeadlineAt: saved.matchDeadlineAt } };
  }
  return protectCompletedMatch(current, incoming);
}

export function validMatchEnding(lobby, final, now = Date.now()) {
  const saved = lobby.gameState;
  if (!saved || !sameMatch(saved, final)) return false;
  const { winnerIndex, loserIndex, reason } = final.result || {};
  if (isDraw(final)) return expiredMatchResult(saved, now)?.outcome === "draw" && final.matchDeadlineAt === saved.matchDeadlineAt;
  if (expiredMatchResult(saved, now)?.outcome === "draw") return false;
  if (![0, 1].includes(winnerIndex) || loserIndex !== 1 - winnerIndex) return false;
  if (reason === "timeout") return saved.current === loserIndex &&
    saved.turnDeadlineAt === final.turnDeadlineAt && Number(saved.turnDeadlineAt) > 0 && saved.turnDeadlineAt <= now;
  if (reason === "absence") {
    const username = saved.players[loserIndex].name;
    return saved.current === loserIndex && !(lobby.inGameFor || []).includes(username) &&
      Number(lobby.absentPlayers?.[username]) > 0 && lobby.absentPlayers[username] <= now;
  }
  if (reason === "forfeit") return true;
  return reason === "knockout" && saved.current === final.current &&
    Number(final.revision || 0) >= Number(saved.revision || 0) &&
    final.players[loserIndex].hands.every(value => value === 0) &&
    final.players[winnerIndex].hands.some(value => value > 0);
}
