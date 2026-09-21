export const MATCH_DURATION_MS = 10 * 60 * 1000;
export const isDraw = state => state?.result?.outcome === 'draw' || state?.result?.reason === 'match-timeout';
export function ensureMatchClock(state, now = Date.now(), legacyStart = state?.turnStartedAt) {
  if (!state) return;
  if (!Number.isFinite(state.matchStartedAt)) state.matchStartedAt = Number.isFinite(legacyStart) ? legacyStart : now;
  if (!Number.isFinite(state.matchDeadlineAt)) state.matchDeadlineAt = state.matchStartedAt + MATCH_DURATION_MS;
}
export function expiredMatchResult(state, now = Date.now()) {
  if (!state || state.over) return null;
  const match = Number(state.matchDeadlineAt) || Infinity;
  const turn = Number(state.turnDeadlineAt) || Infinity;
  // The earlier deadline decides the result. A tie at the match limit is a draw.
  if (now >= match && match <= turn) return {outcome:'draw',winnerIndex:null,loserIndex:null,reason:'match-timeout'};
  if (now >= turn) return {outcome:'win',winnerIndex:1-state.current,loserIndex:state.current,reason:'timeout'};
  return null;
}
export function formatMatchTime(ms) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
export function completedByClock(state, result) {
  return {...state,over:true,selected:null,rewardSummary:null,revision:(state.revision||0)+1,result,timeoutForfeit:result.reason==='timeout'};
}
