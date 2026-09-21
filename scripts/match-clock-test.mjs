import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {MATCH_DURATION_MS,ensureMatchClock,expiredMatchResult,completedByClock,isDraw,formatMatchTime} from '../functions/match-clock.js';
import {advanceRanked,settledRankedProfile} from '../functions/ranked-core.js';
const source=await readFile(new URL('../game.js',import.meta.url),'utf8');
const syncSource=(await readFile(new URL('../match-sync.js',import.meta.url),'utf8')).replace('"./functions/match-clock.js"',JSON.stringify(new URL('../functions/match-clock.js',import.meta.url).href));
const {completedGameState,mergeLobbyGame,validMatchEnding}=await import('data:text/javascript;base64,'+Buffer.from(syncSource).toString('base64'));
function fn(name){const start=source.search(new RegExp(`(?:async )?function ${name}\\(`));assert.ok(start>=0,name);const tail=source.slice(start),end=tail.slice(1).search(/\n(?:async )?function /);return end<0?tail:tail.slice(0,end+1);}
const start=1000000, deadline=start+MATCH_DURATION_MS;
const live={matchId:'test',revision:4,matchStartedAt:start,matchDeadlineAt:deadline,turnStartedAt:deadline-5000,turnDeadlineAt:deadline+25000,current:0,over:false,players:[{name:'A',hands:[1,1],actionUsed:true},{name:'B',hands:[2,1],actionUsed:false}]};
assert.equal(formatMatchTime(MATCH_DURATION_MS),'10:00');assert.equal(formatMatchTime(1),'0:01');assert.equal(formatMatchTime(-1),'0:00');
assert.equal(expiredMatchResult(live,deadline-1),null);
const result=expiredMatchResult(live,deadline),draw=completedByClock(live,result);
assert.ok(isDraw(draw));assert.equal(draw.result.winnerIndex,null);assert.equal(draw.result.loserIndex,null);
assert.equal(expiredMatchResult({...live,turnDeadlineAt:deadline},deadline).outcome,'draw');
assert.equal(expiredMatchResult({...live,turnDeadlineAt:deadline-1},deadline+100).reason,'timeout','Earlier turn expiry remains a loss');
assert.equal(expiredMatchResult(draw,deadline+99999),null);
const recovered=structuredClone(live);ensureMatchClock(recovered,deadline+100000);assert.equal(recovered.matchDeadlineAt,deadline,'Reconnect never grants more time');
const nextTurn=advanceRanked(live,{...live,current:1},0,deadline-1000);assert.equal(nextTurn.matchDeadlineAt,deadline);
assert.ok(isDraw(advanceRanked(nextTurn,{...nextTurn,current:0},1,deadline)),'Any actor gets the shared draw');
assert.deepEqual(advanceRanked(draw,{},0,deadline+5000),draw,'Repeated completion is idempotent');
assert.equal(advanceRanked(live,draw,1,deadline-1),live,'Early draw claims are ignored');
assert.ok(validMatchEnding({gameState:live},completedGameState(draw,null,null),deadline));
assert.equal(validMatchEnding({gameState:live},draw,deadline-1),false);
const fabricatedWin=completedGameState({...live,players:[live.players[0],{name:'B',hands:[0,0]}]},0,1);
assert.equal(validMatchEnding({gameState:live},fabricatedWin,deadline),false,'A late hit cannot defeat the match deadline');
const merged=mergeLobbyGame({gameState:live},{gameState:{...live,revision:8,matchDeadlineAt:deadline+MATCH_DURATION_MS}},true);
assert.equal(merged.gameState.matchDeadlineAt,deadline,'Shared updates cannot extend the match');
for(const index of [0,1]){
 const player={rank:3,trophies:345,wins:12,games:20,seasonGames:10,highestRank:3,activeMatch:'test',gold:500,exp:100};
 assert.deepEqual(settledRankedProfile(player,{},player,result,index),{...player,activeMatch:null},'Draw settlement has no rewards or ranking changes');
}
for(const [mode,submode] of [['Standard Mode','Pass and Play'],['Standard Mode','Play vs AI'],['Standard Mode','Separate Devices'],['Ranked Mode','Separate Devices'],['Power Up Mode','Pass and Play'],['Power Up Mode','Separate Devices']]){
 const calls=[];const context={game:{...structuredClone(live),mode,submode},ensureMatchClock,expiredMatchResult,completedByClock,matchClockNow:()=>deadline,showScreen(){},renderMatchTimer(){},showGameOver:(...args)=>calls.push(args),handleTurnTimerExpired(){throw Error('Draw misclassified as loss');}};
 vm.createContext(context);vm.runInContext(fn('endExpiredMatchIfNeeded'),context);
 assert.equal(context.endExpiredMatchIfNeeded(),true);assert.ok(isDraw(context.game));assert.deepEqual(calls[0],[null,null]);
 assert.equal(context.endExpiredMatchIfNeeded(),false);assert.equal(calls.length,1);
}
// Exercise the actual draw popup path for both player seats: no reward function is called.
for(const seat of [0,1]){
 const nodes=new Map();const node=id=>{if(!nodes.has(id))nodes.set(id,{hidden:false,open:false,classList:{remove(){},add(){},toggle(){}},showModal(){this.open=true;}});return nodes.get(id);};
 const context={game:{...structuredClone(draw),mode:'Ranked Mode',submode:'Separate Devices'},isDraw,completedGameState,renderRankedResultHeader(){},completedResultScreens:new Set(),gameStateSyncTimer:null,forfeitTimerId:null,stopTurnTimerLoop(){},clearAiMoveTimer(){},clearActiveGameState(){},document:{querySelector:node},activePlayerIndex:()=>seat,getPlayerCharacter:i=>i,characterMarkup:()=>'',renderRewardPanel:()=>{node('#rewardPanel').hidden=true;},renderMatchTimer(){},writePresence(){},awardMatchRewardsAsync(){throw Error('Draw must never award');}};
 vm.createContext(context);vm.runInContext(fn('renderPlayerStatus')+'\n'+fn('showDrawResult')+'\n'+fn('showGameOver')+'\n'+fn('awardMatchRewards')+'\n'+fn('awardMatchRewardsAsync'),context);
 await context.showGameOver(null,null,{remote:true});assert.equal(node('#winnerTitle').textContent,"It's a draw!");assert.match(node('#winnerText').textContent,/No EXP, coins, rewards, or trophies/);assert.equal(node('#gameOverDialog').open,true);assert.equal(node('#rewardPanel').hidden,true);
 assert.equal(context.awardMatchRewards(null,null),null);assert.equal(await context.awardMatchRewardsAsync(null,null),null);
}
console.log('PASS: all modes draw at 10 minutes, deadline precedence, shared immutable clock, no rewards, both draw popups, and duplicate completion.');
