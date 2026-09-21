const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('game.js','utf8');
const sync=source.slice(source.indexOf('function syncActiveGameStateSoon('),source.indexOf('\nfunction markGamePlayerLeft'));
const end=source.slice(source.indexOf('async function endRankedTurn('),source.indexOf('function resetTurnDeadline()'));
const timer=source.slice(source.indexOf('function turnTimerMsLeft('),source.indexOf('function startTurnTimerLoop()'));
const listener=source.match(/window.addEventListener\("ranked-state", event=>\{[\s\S]*?\n\}\);/)[0];
const sent=[],timers=[];let receive,resolveEnd,rejectEnd;
const context={
 game:{matchId:'test',mode:'Ranked Mode',submode:'Separate Devices',lobbyId:'lobby',revision:0,current:0,over:false,turnDeadlineAt:30000,players:[{name:'A',hands:[1,1],actionUsed:false},{name:'B',hands:[1,1],actionUsed:false}]},
 firebaseUser:{uid:'A'},gameStateSyncTimer:null,rankedTurnPending:false,rankedSyncError:'',Date,JSON,
 persistActiveGameState(){},render(){},hideSplitChoices(){},applyRemoteCompletedLobby(){return false;},ensureTurnDeadline(){},serverNow(){return 14000;},matchClockNow(){return 14000;},
 currentPlayer(){return context.game.players[context.game.current];},
 serializableGameState(){context.game.revision++;return structuredClone(context.game);},
 updateLobby(id,update){sent.push(update({id}).gameState);},
 submitRankedState(id,state){sent.push(state);return new Promise((resolve,reject)=>{resolveEnd=resolve;rejectEnd=reject;});},
 getRankedLobby:async()=>({gameState:sent[0]}),
 window:{setTimeout(fn){timers.push(fn);return timers.length;},clearTimeout(){},addEventListener(name,fn){receive=fn;}},
};
vm.createContext(context);vm.runInContext(sync+'\n'+end+'\n'+timer+'\n'+listener,context);
(async()=>{
 context.game.players[1].hands=[2,1];context.game.players[0].actionUsed=true;
 context.syncActiveGameStateSoon(0);assert.equal(sent.length,1);
 const pending=context.endRankedTurn();
 assert.equal(sent.length,2);assert.equal(sent[1].current,1);
 assert.equal(context.game.current,0,'No optimistic turn change');
 assert.equal(context.game.turnDeadlineAt,30000,'No client-generated deadline');
 assert.equal(context.rankedTurnPending,true);
 await context.endRankedTurn();assert.equal(sent.length,2,'Double click must not resubmit');
 receive({detail:sent[0]});assert.equal(context.game.revision,2,'Late action response cannot undo pending End Turn');
 const confirmed={...sent[1],turnDeadlineAt:44000};
 receive({detail:confirmed});resolveEnd(confirmed);await pending;
 assert.equal(context.game.current,1);assert.equal(context.game.turnDeadlineAt,44000);
 assert.equal(context.rankedTurnPending,false);assert.equal(context.turnTimerMsLeft(),30000,'Timer uses server-adjusted time');
 context.game=structuredClone(sent[0]);context.game.revision=3;
 const failed=context.endRankedTurn();rejectEnd(new Error('403'));await failed;
 assert.match(context.rankedSyncError,/not confirmed/);assert.equal(context.game.current,0);assert.equal(context.game.turnDeadlineAt,30000);assert.equal(context.rankedTurnPending,false);
 context.game.mode='Standard Mode';context.syncActiveGameStateSoon(350);assert.equal(timers.length,1);
 console.log('PASS: delayed ack, double click, confirmed shared deadline, rejected End Turn recovery, server clock, Standard debounce.');
})().catch(error=>{console.error(error);process.exitCode=1;});
