const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
function fn(source,name) {
 const start=source.search(new RegExp('(?:export )?(?:async )?function '+name+'\\('));
 const tail=source.slice(start);
 const end=tail.slice(1).search(/\n(?:export )?(?:async )?function /);
 return (end < 0 ? tail : tail.slice(0,end+1)).replace(/^export /,'');
}
const firebase=fs.readFileSync('firebase.js','utf8');
const game=fs.readFileSync('game.js','utf8');
const ctx=vm.createContext({
 firebaseUser:{uid:'me'}, firebaseFriends:[{uid:'friend-uid',username:'oldname',tag:'OLD',selectedCharacterId:'honeyBear'}],
 friendProfiles:new Map([['friend-uid',{uid:'friend-uid',username:'newname',tag:'NEW',selectedCharacterId:'mochiBunny',level:12}]]),
 firebaseUsernameUidMap:{},openFriendProfileUid:'friend-uid',refreshFriendPresence:()=>{},
 document:{querySelector:s=>s==='#publicProfileDialog'?{open:true}:card},
 getCharacterForUsername:name=>ctx.firebaseFriends.find(f=>f.username===name).selectedCharacterId,
 characterMarkup:c=>c,profileProgress:()=>{throw new Error('Must not use local friend level')},
 publicProfileWinStreakMarkup:()=>'',escapeHtml:x=>x,profileTag:()=>'',
});
const card={innerHTML:''};
vm.runInContext(fn(firebase,'publicPlayerProfile')+fn(game,'profileCardMarkup')+fn(game,'refreshFriendProfiles'),ctx);
const publicData=ctx.publicPlayerProfile('uid',{username:'alice',economy:{level:8,coins:100},email:'private',selectedCharacterId:'mochiBunny'});
assert.equal(publicData.level,8);
assert.equal('email' in publicData,false);
assert.equal('economy' in publicData,false);
ctx.refreshFriendProfiles();
assert.equal(ctx.firebaseFriends[0].username,'newname');
assert.equal(ctx.firebaseFriends[0].characterId,'mochiBunny');
assert.ok(card.innerHTML.includes('Level 12') && card.innerHTML.includes('newname') && card.innerHTML.includes('mochiBunny'));
ctx.friendProfiles.set('friend-uid',{username:'newname',selectedCharacterId:'honeyBear',level:13});
ctx.refreshFriendProfiles();
assert.ok(card.innerHTML.includes('Level 13') && card.innerHTML.includes('honeyBear'));
ctx.friendProfiles.clear();
assert.ok(ctx.profileCardMarkup('newname').includes('Level —'));
console.log('PASS: UID-linked rename, live avatar/level updates on open card, private fields excluded, no fabricated default level.');
