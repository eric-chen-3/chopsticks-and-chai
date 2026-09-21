import { expiredMatchResult, completedByClock, isDraw } from "./match-clock.js";
export const RANKS = [
  { name: 'Dirt', icon: '🟫', win: [15,21], loss: [7,10], gold:100, chai:1, reset:0 },
  { name: 'Plain', icon: '😐', win: [13,19], loss: [9,13], gold:250, chai:2, reset:.10 },
  { name: 'Vanilla', icon: '🍦', win: [11,17], loss: [11,16], gold:500, chai:3, reset:.15 },
  { name: 'Matcha', icon: '🍵', win: [11,17], loss: [13,18], gold:800, chai:4, reset:.20 },
  { name: 'Divine', icon: '✨', win: [10,15], loss: [15,20], gold:1200, chai:5, reset:.25 },
];
export const seasonId = (now = Date.now()) => new Date(now).toISOString().slice(0,7);
// Rank boundaries are 101/201/301/401 on downward movement: reaching zero demotes.
export function rankIndex(total, previous = -1) {
  const n = Math.max(0, Math.floor(total));
  const natural = Math.min(4, Math.floor(n / 100));
  return previous > 0 && n === previous * 100 ? previous - 1 : natural;
}
export function rankView(profile = {}) {
  const trophies = Math.max(0, profile.trophies || 0);
  const rank = profile.rank ?? rankIndex(trophies);
  return { ...RANKS[rank], rank, trophies, progress: trophies - rank * 100 };
}
export function strength(p = {}) {
  // Beta prior: 20 wins / 40 games keeps new-account win rates near 50%.
  return (p.trophies || 0) + 120 * (((p.wins || 0) + 20) / ((p.games || 0) + 40) - .5);
}
export function trophyDelta(player, opponent, won) {
  const rank = RANKS[player.rank ?? rankIndex(player.trophies || 0)];
  const difficulty = Math.max(-1, Math.min(1, (strength(opponent) - strength(player)) / 200));
  const newcomer = Math.max(0, 1 - (player.games || 0) / 20);
  const [low, high] = won ? rank.win : rank.loss;
  const amount = Math.round(low + (high-low) * Math.max(0, Math.min(1, .5 + (won ? difficulty : -difficulty) * .4 + (won ? newcomer * .1 : 0))));
  return won ? amount : -amount;
}
export function applyResult(player, delta, won) {
  const trophies = Math.max(0, (player.trophies || 0) + delta);
  const rank = rankIndex(trophies, player.rank);
  return { ...player, trophies, rank, games:(player.games || 0)+1, wins:(player.wins || 0)+(won ? 1 : 0), seasonGames:(player.seasonGames || 0)+1, highestRank:Math.max(player.highestRank || 0, rank), activeMatch:null };
}
export function resetSeason(player, season) {
  if (player.season === season) return player;
  const trophies = Math.round((player.trophies || 0) * (1 - RANKS[player.rank || 0].reset));
  const rank = rankIndex(trophies);
  return { ...player, trophies, rank, season, highestRank:rank, seasonGames:0 };
}
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
export function legalBoards(state) {
  const i = state.current, j = 1-i, own = state.players[i].hands, other = state.players[j].hands;
  const boards = [];
  const push = (a,b) => { const pair=[]; pair[i]=a; pair[j]=b; boards.push(pair); };
  for (let a=0;a<2;a++) for(let b=0;b<2;b++) if(own[a]>0 && other[b]>0) {
    const target=[...other]; target[b]=target[b]+own[a]>=5?0:target[b]+own[a]; push([...own],target);
  }
  for(let left=0;left<5;left++) {
    const right=own[0]+own[1]-left;
    if(right>=0 && right<5 && !same([left,right],own) && !same([right,left],own)) push([left,right],[...other]);
  }
  // Tapping one's other live hand combines the hands, including a self knockout.
  for(let a=0;a<2;a++) if(own[a]>0 && own[1-a]>0) {
    const next=[0,0], sum=own[0]+own[1]; next[1-a]=sum>=5?0:sum; push(next,[...other]);
  }
  return boards;
}
export function advanceRanked(state, proposed, actor, now=Date.now()) {
  if(state.over) return state;
  const expired = expiredMatchResult(state, now);
  if (expired) return completedByClock(state, expired);
  if (isDraw(proposed)) return state; // A client's clock cannot end the match early.
  if(proposed.result?.reason === 'forfeit') return finish(state,1-actor,'forfeit');
  if(actor !== state.current) throw new Error('Wait for your turn.');
  const before=state.players.map(p=>p.hands), after=proposed.players?.map(p=>p.hands);
  const unchanged=same(before,after);
  const moved=!state.players[actor].actionUsed && legalBoards(state).some(board=>same(board,after));
  if(!unchanged && !moved) throw new Error('Invalid ranked move.');
  const turnChanged=proposed.current === 1-actor;
  if(proposed.current !== actor && !turnChanged) throw new Error('Invalid turn.');
  if(turnChanged && !state.players[actor].actionUsed && !moved) throw new Error('Take an action before ending your turn.');
  const next={...state, selected:null, revision:state.revision+1, syncedAt:now, players:state.players.map((p,i)=>({...p,hands:after[i],actionUsed:i===actor ? (turnChanged?false:state.players[i].actionUsed||moved) : false}))};
  const loser=next.players.findIndex(p=>p.hands.every(n=>n===0));
  if(loser>=0) return finish(next,1-loser,'knockout');
  if(turnChanged) Object.assign(next,{current:1-actor,turnStartedAt:now,turnDeadlineAt:now+30000});
  return next;
}
export function finish(state,winnerIndex,reason) {
  return {...state,over:true,selected:null,revision:state.revision+1,result:{winnerIndex,loserIndex:1-winnerIndex,reason},timeoutForfeit:reason==='timeout'};
}

export function settledRankedProfile(player, opponentAtStart, playerAtStart, result, index) {
  // Draws neither grant participation rewards nor change ratings, win/loss counts or streaks.
  if (result.outcome === 'draw' || result.reason === 'match-timeout') return {...player, activeMatch:null};
  const won=index===result.winnerIndex;
  return applyResult(player,trophyDelta(playerAtStart,opponentAtStart,won),won);
}
