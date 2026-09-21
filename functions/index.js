import { MATCH_DURATION_MS, ensureMatchClock, expiredMatchResult, completedByClock } from "./match-clock.js";
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { randomUUID } from 'node:crypto';
import { RANKS, seasonId, resetSeason, strength, trophyDelta, applyResult, advanceRanked, finish, settledRankedProfile } from './ranked-core.js';
initializeApp();
const db=getFirestore();
const uidOf=req=>{ if(!req.auth) throw new HttpsError('unauthenticated','Please sign in.'); return req.auth.uid; };
const rankRef=uid=>db.doc(`rankedPlayers/${uid}`);
const queueRef=uid=>db.doc(`rankedQueue/${uid}`);

// All rank mutations, queue admission, and season changes share one transaction lock.
// This also serializes simultaneous arrivals into an initially empty queue.
async function lock(tx) { const ref=db.doc('rankedInternal/lock'); await tx.get(ref); return ref; }
async function rollover(uid) {
  return db.runTransaction(async tx=>{
    const guard=await lock(tx), ref=rankRef(uid), snap=await tx.get(ref);
    const userRef=db.doc(`users/${uid}`), user=await tx.get(userRef);
    if(!user.exists) throw new HttpsError('failed-precondition','Create a profile first.');
    let p=snap.exists?snap.data():{uid,trophies:0,rank:0,games:0,wins:0,season:seasonId(),seasonGames:0,highestRank:0,activeMatch:null};
    // A game belongs to the season in which it started. Settle it before reset.
    if(p.season!==seasonId() && !p.activeMatch) {
      if(p.seasonGames>0) {
        const reward=RANKS[p.highestRank], data=user.data();
        tx.update(userRef,{'economy.coins':(data.economy?.coins||0)+reward.gold,'inventory.consumables.chaiTeaSpecial':(data.inventory?.consumables?.chaiTeaSpecial||0)+reward.chai});
        tx.set(db.doc(`rankedPlayers/${uid}/rewards/${p.season}`),{season:p.season,rank:p.highestRank,gold:reward.gold,chai:reward.chai,awardedAt:Date.now()});
      }
      p=resetSeason(p,seasonId());
    }
    p.username=user.data().username; p.selectedCharacterId=user.data().selectedCharacterId||'honeyBear';
    tx.set(ref,p); tx.set(guard,{at:Date.now()}); return p;
  });
}
export const rankedProfile=onCall(async req=>rollover(uidOf(req)));
export const rankedQueue=onCall(async req=>{
  const uid=uidOf(req); await rollover(uid);
  return db.runTransaction(async tx=>{
    const guard=await lock(tx), self=await tx.get(rankRef(uid)), own=await tx.get(queueRef(uid));
    const p=self.data(), now=Date.now();
    if(p.activeMatch) return {matchId:p.activeMatch};
    if(req.data?.cancel) { tx.delete(queueRef(uid)); tx.set(guard,{at:now}); return {cancelled:true}; }
    const waiting=await tx.get(db.collection('rankedQueue').where('expiresAt','>',now).limit(100));
    const since=own.exists?own.data().joinedAt:now;
    const candidates=waiting.docs.filter(d=>d.id!==uid).sort((a,b)=>Math.abs(a.data().rating-strength(p))-Math.abs(b.data().rating-strength(p)) || a.data().joinedAt-b.data().joinedAt);
    let opponent=null, op=null;
    for(const candidate of candidates) {
      const allowed=100+Math.floor((now-Math.min(since,candidate.data().joinedAt))/15000)*100;
      if(Math.abs(candidate.data().rating-strength(p))>allowed) continue;
      const other=await tx.get(rankRef(candidate.id));
      if(other.exists && !other.data().activeMatch && other.data().season===seasonId()) { opponent=candidate; op=other.data(); break; }
    }
    if(!opponent) {
      tx.set(queueRef(uid),{uid,joinedAt:since,expiresAt:now+20000,rating:strength(p)}); tx.set(guard,{at:now}); return {queued:true};
    }
    const matchId=randomUUID(), ids=Math.random()<.5?[uid,opponent.id]:[opponent.id,uid];
    const profiles=ids.map(id=>id===uid?p:op), names=profiles.map(x=>x.username);
    const state={matchId,revision:0,players:names.map(name=>({name,hands:[1,1],actionUsed:false})),current:0,selected:null,over:false,log:['Ranked match started.'],mode:'Ranked Mode',submode:'Separate Devices',localPlayer:0,lobbyId:matchId,playerCharacters:profiles.map(x=>x.selectedCharacterId),playerWinStreaks:[0,0],turnStartedAt:now,turnDeadlineAt:now+30000,matchStartedAt:now,matchDeadlineAt:now+MATCH_DURATION_MS,saveId:null,rewardSummary:null};
    const lobby={id:matchId,ranked:true,rankedSeason:seasonId(),rankedProfiles:profiles,type:'gameInvite',sender:names[0],recipient:names[1],senderUid:ids[0],recipientUid:ids[1],senderCharacterId:state.playerCharacters[0],recipientCharacterId:state.playerCharacters[1],participantUids:ids,status:'inGame',activeGame:true,mode:'Ranked Mode',inGameFor:names,joinedFor:names,readyFor:[],closedFor:[],minimizedFor:[],absentPlayers:{},gameState:state,createdAt:now,lastGameStateAt:now};
    tx.create(db.doc(`lobbies/${matchId}`),lobby);
    for(const id of ids) {tx.update(rankRef(id),{activeMatch:matchId});tx.delete(queueRef(id));}
    tx.set(guard,{at:now}); return {matchId};
  });
});
async function move(uid,id,proposed,timeoutOnly=false) {
  return db.runTransaction(async tx=>{
    const guard=await lock(tx), ref=db.doc(`lobbies/${id}`), snap=await tx.get(ref);
    if(!snap.exists || !snap.data().ranked) throw new HttpsError('not-found','Ranked match not found.');
    const lobby=snap.data(), actor=lobby.participantUids.indexOf(uid);
    if(!timeoutOnly && actor<0) throw new HttpsError('permission-denied','Not your match.');
    const state=lobby.gameState;
    if(state.over) return state;
    const now=Date.now();
    ensureMatchClock(state, now, typeof lobby.createdAt === 'number' ? lobby.createdAt : state.turnStartedAt);
    const expired=expiredMatchResult(state,now);
    if(timeoutOnly && !expired) return state;
    let next;
    try { next=expired?completedByClock(state,expired):advanceRanked(state,proposed,actor,now); }
    catch(e) { throw new HttpsError('failed-precondition',e.message); }
    if(next.over) {
      const players=await Promise.all(lobby.participantUids.map(id=>tx.get(rankRef(id))));
      next.trophyChanges=players.map((doc,i)=>{
        const updated=settledRankedProfile(doc.data(),lobby.rankedProfiles[1-i],lobby.rankedProfiles[i],next.result,i); tx.set(doc.ref,updated);
        return updated.trophies-doc.data().trophies;
      });
    }
    tx.update(ref,{gameState:next,activeGame:!next.over,status:next.over?'complete':'inGame',lastGameStateAt:Date.now()});
    tx.set(guard,{at:Date.now()}); return next;
  });
}
export const rankedMove=onCall(async req=>{
  const uid=uidOf(req), id=req.data?.matchId;
  if(typeof id!=='string'||!id.match(/^[a-zA-Z0-9-]{1,80}$/)||!req.data?.state) throw new HttpsError('invalid-argument','Invalid match.');
  return move(uid,id,req.data.state);
});
// Expire abandoned matches even when neither player remains connected.
export const rankedMaintenance=onSchedule({schedule:'every 1 minutes',timeZone:'UTC'},async()=>{
  const active=await db.collection('lobbies').where('activeGame','==',true).get();
  for(const doc of active.docs) if(doc.data().ranked && expiredMatchResult(doc.data().gameState,Date.now())) await move('',doc.id,null,true);
  // Lazy rollover also runs on sign-in; this pass handles offline accounts.
  const old=await db.collection('rankedPlayers').where('season','<',seasonId()).limit(200).get();
  for(const doc of old.docs) await rollover(doc.id);
});

// Keep leaderboard identity current after profile edits without trusting client rank writes.
export const rankedIdentityChanged=onDocumentWritten('users/{uid}',async event=>{
  const data=event.data?.after.data();
  if(!data) return;
  const ref=rankRef(event.params.uid);
  await db.runTransaction(async tx=>{
    const snapshot=await tx.get(ref);
    if(snapshot.exists && (snapshot.data().username!==data.username || snapshot.data().selectedCharacterId!==data.selectedCharacterId))
      tx.update(ref,{username:data.username,selectedCharacterId:data.selectedCharacterId||'honeyBear'});
  });
});
