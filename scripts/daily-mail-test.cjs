const fs=require('fs'),vm=require('vm'),assert=require('assert');
const source=fs.readFileSync('game.js','utf8');
function extract(name){const start=source.indexOf(`function ${name}(`);let candidates=[source.indexOf('\nfunction ',start+1),source.indexOf('\nasync function ',start+1)].filter(n=>n>=0);let end=Math.min(...candidates);return source.slice(start,end<0?source.length:end);}
let day='2026-09-18';
const ctx={weeklyQuests:[{id:"weekly",title:"Weekly win",metric:"wins",target:1,exp:200,coins:100}],dailyQuests:[{id:'a',title:'Play',metric:'matchesPlayed',target:2,exp:50,coins:30},{id:'b',title:'Win',metric:'wins',target:1,exp:75,coins:50},{id:'c',title:'More',metric:'wins',target:5,exp:100,coins:100}],questPeriodKey:type=>type==='daily'?day:'2026-09-14',defaultQuestState:x=>x,defaultQuestProgress:()=>({}),normalizeQuestProgress:x=>x||{},normalizeClaimedQuestIds:x=>x||{},normalizeEconomy:p=>({coins:p.coins||0}),addExperience:(p,x)=>({...p,exp:(p.exp||0)+x})};
vm.createContext(ctx);
for(const name of ['normalizeQuestState','dailyMailTotals','applyDailyMailReward'])vm.runInContext(extract(name),ctx);
ctx.profileWithEconomy=(p,o)=>({...p,...o});ctx.applyQuestProgressToProfile=p=>p;
const profile={coins:10,questState:{dailyPeriod:'2026-09-17',daily:{matchesPlayed:2,wins:1},dailyClaimed:['b']}};
const state=ctx.normalizeQuestState(profile);assert.equal(state.dailyMail.length,1);assert.equal(state.dailyMail[0].quests.length,1);assert.equal(state.dailyMail[0].quests[0].id,'a');
assert.equal(ctx.normalizeQuestState({questState:state}).dailyMail.length,1);
const claimed=ctx.applyDailyMailReward(profile,'2026-09-17');assert.equal(claimed.coins,40);assert.equal(claimed.exp,50);assert.equal(claimed.questState.dailyMail.length,0);
assert.equal(ctx.applyDailyMailReward(claimed,'2026-09-17').coins,40);
day='2026-10-01';assert.equal(ctx.normalizeQuestState({questState:state}).dailyMail.length,1);
assert.equal(profile.questState.dailyClaimed.length,1);
console.log('PASS: rollover preserves only completed unclaimed rewards, deduplication, no expiry, collection removes mail, repeated claim pays nothing.');

const weekly={coins:10,questState:{dailyPeriod:day,weeklyPeriod:'2026-09-07',weekly:{wins:1},weeklyClaimed:[]}};
const weekState=ctx.normalizeQuestState(weekly);assert.equal(weekState.dailyMail.length,1);assert.equal(weekState.dailyMail[0].type,'weekly');
const weekClaim=ctx.applyDailyMailReward(weekly,'weekly:2026-09-07');assert.equal(weekClaim.coins,110);assert.equal(weekClaim.exp,200);assert.equal(ctx.applyDailyMailReward(weekClaim,'weekly:2026-09-07').coins,110);
weekly.questState.weeklyClaimed=['weekly'];assert.equal(ctx.normalizeQuestState(weekly).dailyMail.length,0);
console.log('PASS: weekly rollover, completed-only rewards, previously claimed exclusion, collection and duplicate protection.');
