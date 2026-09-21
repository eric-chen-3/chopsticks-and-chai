import { expiredMatchResult, completedByClock } from "./functions/match-clock.js";
import { getFunctions, httpsCallable } from "firebase/functions";
import { sameMatch, mergeLobbyGame, validMatchEnding } from "./match-sync.js";
import { getDatabase, get, ref, onValue, onDisconnect, runTransaction as runRealtimeTransaction, goOffline, goOnline } from "firebase/database";
import { createPresenceSession, summarizeSessions, claimSession } from "./presence.js";
import { initializeApp } from "firebase/app";
import { getAnalytics, isSupported as isAnalyticsSupported } from "firebase/analytics";
import {
  browserSessionPersistence,
  createUserWithEmailAndPassword,
  deleteUser,
  initializeAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from "firebase/auth";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  initializeFirestore,
  limit,
  limitToLast,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBTxpS2iWeqDpoQJYTCXWEVvGYfnKBRhAo",
  authDomain: "chopsticks-and-chai.firebaseapp.com",
  projectId: "chopsticks-and-chai",
  databaseURL: "https://chopsticks-and-chai-default-rtdb.firebaseio.com",
  storageBucket: "chopsticks-and-chai.firebasestorage.app",
  messagingSenderId: "489064265036",
  appId: "1:489064265036:web:e660343c56471c40844be9",
  measurementId: "G-QWWESBQV3X",
};

const firestoreRestBase = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents`;

export const firebaseApp = initializeApp(firebaseConfig);
export const auth = initializeAuth(firebaseApp, {
  persistence: browserSessionPersistence,
});
export const db = initializeFirestore(firebaseApp, {
  experimentalForceLongPolling: true,
  useFetchStreams: false,
});

export const analytics = isAnalyticsSupported()
  .then((supported) => (supported ? getAnalytics(firebaseApp) : null))
  .catch(() => null);

export function subscribeToAuthState(callback) {
  return onAuthStateChanged(auth, callback);
}

export async function signUpWithEmail(email, password, profile = {}) {
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  const nextProfile = typeof profile === "string" ? { username: profile } : profile;
  if (nextProfile.username) {
    await updateProfile(credential.user, { displayName: nextProfile.username });
  }
  try {
    await upsertUserProfileRest(credential.user, {
      email: credential.user.email,
      ...nextProfile,
    });
  } catch (error) {
    await deleteDoc(doc(db, "users", credential.user.uid)).catch(() => null);
    await deleteUser(credential.user).catch(() => null);
    throw error;
  }
  return credential.user;
}

export async function signInWithEmail(email, password) {
  sessionPresence.allowLogin();
  const credential = await signInWithEmailAndPassword(auth, email, password);
  return credential.user;
}

export function signOutCurrentUser() {
  return signOut(auth);
}

export async function loadUserProfile(uid) {
  const currentUser = auth.currentUser;
  if (currentUser && currentUser.uid === uid) {
    return loadUserProfileRest(currentUser);
  }
  const snapshot = await getDoc(doc(db, "users", uid));
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
}

export function publicPlayerProfile(uid, profile) {
  return {
    uid, username: profile.username, tag: profile.tag || "",
    selectedCharacterId: profile.selectedCharacterId || "honeyBear",
    level: Math.max(1, Math.floor(Number(profile.economy?.level ?? profile.level) || 1)),
  };
}

export function publishPlayerProfile(uid, profile) {
  return setDoc(doc(db, "playerProfiles", uid), {
    ...publicPlayerProfile(uid, profile), updatedAt: serverTimestamp(),
  });
}

export function subscribeToPlayerProfile(uid, callback, onError) {
  return onSnapshot(doc(db, "playerProfiles", uid), (snapshot) => {
    callback(snapshot.exists() ? snapshot.data() : null);
  }, onError);
}

export async function upsertUserProfile(uid, profile) {
  const nowFields = profile.createdAt ? {} : { createdAt: serverTimestamp() };
  const privateProfile = {
    ...nowFields,
    ...profile,
    updatedAt: serverTimestamp(),
  };
  await runTransaction(db, async (transaction) => {
    let usernameHandleRef = null;
    if (profile.username) {
      usernameHandleRef = doc(db, "usernameHandles", publicProfileId(profile.username));
      const usernameHandleSnapshot = await transaction.get(usernameHandleRef);
      if (usernameHandleSnapshot.exists()) {
        const existingUid = usernameHandleSnapshot.data().uid || "";
        if (existingUid && existingUid !== uid) {
          const error = new Error("Username is already taken.");
          error.code = "app/username-taken";
          throw error;
        }
      }
      const publicRef = doc(db, "publicProfiles", publicProfileId(profile.username));
      const publicSnapshot = await transaction.get(publicRef);
      if (publicSnapshot.exists() && publicSnapshot.data().uid !== uid) {
        const error = new Error("Username is already taken.");
        error.code = "app/username-taken";
        throw error;
      }
      transaction.set(publicRef, {
        uid,
        username: profile.username,
        tag: profile.tag || "",
        selectedCharacterId: profile.selectedCharacterId || "honeyBear",
        updatedAt: serverTimestamp(),
      }, { merge: true });
      transaction.set(usernameHandleRef, {
        uid,
        username: profile.username,
        updatedAt: serverTimestamp(),
      }, { merge: true });
    }
    transaction.set(doc(db, "playerProfiles", uid), { ...publicPlayerProfile(uid, profile), updatedAt: serverTimestamp() });
    transaction.set(doc(db, "users", uid), privateProfile);
  });
}

const presenceDb = getDatabase(firebaseApp);
let serverTimeOffset = 0;
onValue(ref(presenceDb, ".info/serverTimeOffset"), snapshot => {
  serverTimeOffset = Number(snapshot.val()) || 0;
});
export const serverNow = () => Date.now() + serverTimeOffset;
const sessionPresence = createPresenceSession({
  watchConnection: (callback) => onValue(ref(presenceDb, ".info/connected"), (snapshot) => callback(snapshot.val() === true)),
  newId: () => crypto.randomUUID(),
  claim: async (uid, id, state) => {
    const accountRef = ref(presenceDb, `presence/${uid}`);
    await get(accountRef);
    const result = await runRealtimeTransaction(accountRef,
      (value) => claimSession(value, id, state), { applyLocally: false });
    return result.committed && result.snapshot.child("activeSession").val() === id;
  },
  watchOwner: (uid, callback, onError) => onValue(ref(presenceDb, `presence/${uid}/activeSession`),
    (snapshot) => callback(snapshot.val()), onError),
  armDisconnect: (uid, id) => onDisconnect(ref(presenceDb, `presence/${uid}/sessions/${id}`)).remove(),
  publish: async (uid, id, state) => {
    const accountRef = ref(presenceDb, `presence/${uid}`);
    await get(accountRef);
    const result = await runRealtimeTransaction(accountRef, (value) => {
      if (!value || value.activeSession !== id) return value;
      return { activeSession: id, sessions: { [id]: state } };
    }, { applyLocally: false });
    return result.committed && result.snapshot.child("activeSession").val() === id;
  },
  connect: () => goOnline(presenceDb),
  disconnect: () => goOffline(presenceDb),
  onRejected: (uid) => {
    if (auth.currentUser?.uid !== uid) return;
    window.dispatchEvent(new CustomEvent("account-session-rejected"));
    void signOut(auth).catch(console.warn);
  },
  onError: (error) => {
    console.warn("Realtime session failed. Check Realtime Database rules.", error);
    window.dispatchEvent(new CustomEvent("account-session-error"));
    void signOut(auth).catch(console.warn);
  },
});

export function updateUserPresence(uid, presence = {}) {
  if (presence.online === false) return sessionPresence.stop();
  return sessionPresence.update(uid, { inGame: Boolean(presence.inGame) });
}

export function stopUserPresence() {
  return sessionPresence.stop();
}

export function subscribeToFriendPresence(uid, callback, onError) {
  return onValue(ref(presenceDb, `presence/${uid}`), (snapshot) => {
    callback(summarizeSessions(snapshot.val()));
  }, onError);
}

// A background tab stays connected. Page exit disconnects this session only.
window.addEventListener("pagehide", () => goOffline(presenceDb));
window.addEventListener("pageshow", () => goOnline(presenceDb));

export async function updateUserProfileTransaction(uid, updater) {
  const userRef = doc(db, "users", uid);
  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(userRef);
    const current = snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : {};
    const updateResult = updater(current);
    const next = updateResult && updateResult.write ? updateResult.write : updateResult;
    let publicRef = null;
    let usernameHandleRef = null;
    if (next.username) {
      usernameHandleRef = doc(db, "usernameHandles", publicProfileId(next.username));
      const usernameHandleSnapshot = await transaction.get(usernameHandleRef);
      if (usernameHandleSnapshot.exists()) {
        const existingUid = usernameHandleSnapshot.data().uid || "";
        if (existingUid && existingUid !== uid) {
          const error = new Error("Username is already taken.");
          error.code = "app/username-taken";
          throw error;
        }
      }
      publicRef = doc(db, "publicProfiles", publicProfileId(next.username));
      const publicSnapshot = await transaction.get(publicRef);
      if (publicSnapshot.exists() && publicSnapshot.data().uid !== uid) {
        const error = new Error("Username is already taken.");
        error.code = "app/username-taken";
        throw error;
      }
    }
    transaction.set(doc(db, "playerProfiles", uid), { ...publicPlayerProfile(uid, next), updatedAt: serverTimestamp() });
    transaction.set(userRef, {
      ...sanitizeForFirestore(next),
      updatedAt: serverTimestamp(),
    });
    if (publicRef) {
      transaction.set(publicRef, {
        uid,
        username: next.username,
        tag: next.tag || "",
        selectedCharacterId: next.selectedCharacterId || "honeyBear",
        updatedAt: serverTimestamp(),
      }, { merge: true });
      transaction.set(usernameHandleRef, {
        uid,
        username: next.username,
        updatedAt: serverTimestamp(),
      }, { merge: true });
    }
    return updateResult && Object.hasOwn(updateResult, "result") ? updateResult.result : next;
  });
}

export function publicProfileId(username) {
  return String(username).trim().toLowerCase();
}

export async function findPublicProfile(username) {
  const snapshot = await getDoc(doc(db, "publicProfiles", publicProfileId(username)));
  if (!snapshot.exists()) return null;
  const profile = { id: snapshot.id, ...snapshot.data() };
  return profile;
}

export async function isUsernameTaken(username) {
  const snapshot = await getRestDocument(["usernameHandles", publicProfileId(username)]);
  return Boolean(snapshot);
}

async function loadUserProfileRest(user) {
  const snapshot = await getRestDocument(["users", user.uid], await user.getIdToken());
  return snapshot ? { id: user.uid, ...snapshot } : null;
}

async function upsertUserProfileRest(user, profile) {
  const token = await user.getIdToken();
  const username = profile.username ? publicProfileId(profile.username) : "";
  const timestamp = new Date().toISOString();
  const privateProfile = sanitizeForFirestore({
    createdAt: profile.createdAt || timestamp,
    ...profile,
    updatedAt: timestamp,
  });
  const writes = [
    restUpdateWrite(["users", user.uid], privateProfile),
  ];

  if (username) {
    const [usernameHandle, publicProfile] = await Promise.all([
      getRestDocument(["usernameHandles", username], token),
      getRestDocument(["publicProfiles", username], token),
    ]);
    if (usernameHandle && usernameHandle.uid && usernameHandle.uid !== user.uid) {
      throwUsernameTaken();
    }
    if (publicProfile && publicProfile.uid && publicProfile.uid !== user.uid) {
      throwUsernameTaken();
    }
    const publicProfilePayload = {
      uid: user.uid,
      username,
      tag: profile.tag || "",
      selectedCharacterId: profile.selectedCharacterId || "honeyBear",
      updatedAt: timestamp,
    };
    const usernameHandlePayload = {
      uid: user.uid,
      username,
      updatedAt: timestamp,
    };
    writes.push(restUpdateWrite(["publicProfiles", username], publicProfilePayload, publicProfile ? "exists" : "missing"));
    writes.push(restUpdateWrite(["usernameHandles", username], usernameHandlePayload, usernameHandle ? "exists" : "missing"));
  }

  writes.push(restUpdateWrite(["playerProfiles", user.uid], { ...publicPlayerProfile(user.uid, profile), updatedAt: timestamp }));
  await commitRestWrites(writes, token);
}

async function getRestDocument(pathParts, token = "") {
  const response = await fetch(restDocumentUrl(pathParts), {
    headers: restHeaders(token),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw await restError(response);
  const data = await response.json();
  return restFieldsToObject(data.fields || {});
}

async function commitRestWrites(writes, token) {
  const response = await fetch(`${firestoreRestBase}:commit`, {
    method: "POST",
    headers: restHeaders(token),
    body: JSON.stringify({ writes }),
  });
  if (!response.ok) {
    const error = await restError(response);
    if (error.status === 400 || error.status === 409) throwUsernameTaken();
    throw error;
  }
}

function restUpdateWrite(pathParts, value, precondition = "") {
  const write = {
    update: {
      name: restDocumentName(pathParts),
      fields: objectToRestFields(value),
    },
  };
  if (precondition === "missing") write.currentDocument = { exists: false };
  if (precondition === "exists") write.currentDocument = { exists: true };
  return write;
}

function restDocumentUrl(pathParts) {
  return `${firestoreRestBase}/${restPath(pathParts)}`;
}

function restDocumentName(pathParts) {
  return `projects/${firebaseConfig.projectId}/databases/(default)/documents/${restPath(pathParts)}`;
}

function restPath(pathParts) {
  return pathParts.map((part) => encodeURIComponent(String(part))).join("/");
}

function restHeaders(token = "") {
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function restError(response) {
  let body = {};
  try {
    body = await response.json();
  } catch {
    body = {};
  }
  const error = new Error(body.error && body.error.message ? body.error.message : `Firestore REST request failed: ${response.status}`);
  error.code = body.error && body.error.status ? body.error.status.toLowerCase().replaceAll("_", "-") : "app/rest-error";
  error.status = response.status;
  return error;
}

function throwUsernameTaken() {
  const error = new Error("Username is already taken.");
  error.code = "app/username-taken";
  throw error;
}

function objectToRestFields(value) {
  return Object.fromEntries(
    Object.entries(sanitizeForFirestore(value))
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, toRestValue(item)]),
  );
}

function toRestValue(value) {
  if (value === null) return { nullValue: null };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(toRestValue) } };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number" && Number.isInteger(value)) return { integerValue: String(value) };
  if (typeof value === "number") return { doubleValue: value };
  if (typeof value === "object") return { mapValue: { fields: objectToRestFields(value) } };
  return { stringValue: String(value) };
}

function restFieldsToObject(fields) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, fromRestValue(value)]));
}

function fromRestValue(value) {
  if (Object.hasOwn(value, "nullValue")) return null;
  if (Object.hasOwn(value, "booleanValue")) return value.booleanValue;
  if (Object.hasOwn(value, "integerValue")) return Number(value.integerValue);
  if (Object.hasOwn(value, "doubleValue")) return value.doubleValue;
  if (Object.hasOwn(value, "timestampValue")) return value.timestampValue;
  if (Object.hasOwn(value, "arrayValue")) return (value.arrayValue.values || []).map(fromRestValue);
  if (Object.hasOwn(value, "mapValue")) return restFieldsToObject(value.mapValue.fields || {});
  return value.stringValue || "";
}

export async function listFriends(uid) {
  const snapshot = await getDocs(collection(db, "users", uid, "friends"));
  return snapshot.docs.map((friendDoc) => ({ id: friendDoc.id, ...friendDoc.data() }));
}

export function subscribeToFriends(uid, callback, onError) {
  return onSnapshot(collection(db, "users", uid, "friends"), (snapshot) => {
    callback(snapshot.docs.map((friendDoc) => ({ id: friendDoc.id, ...friendDoc.data() })));
  }, onError);
}

export async function listSaves(uid) {
  const snapshot = await getDocs(collection(db, "users", uid, "saves"));
  return snapshot.docs.map((saveDoc) => ({ id: saveDoc.id, ...saveDoc.data() }));
}

export function subscribeToSaves(uid, callback, onError) {
  return onSnapshot(collection(db, "users", uid, "saves"), (snapshot) => {
    callback(snapshot.docs.map((saveDoc) => ({ id: saveDoc.id, ...saveDoc.data() })));
  }, onError);
}

export async function writeFirebaseSave(uid, save) {
  await setDoc(doc(db, "users", uid, "saves", save.id), {
    ...sanitizeForFirestore(save),
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

export async function deleteFirebaseSave(uid, saveId) {
  await deleteDoc(doc(db, "users", uid, "saves", saveId));
}

export async function listNotifications(uid) {
  const snapshot = await getDocs(collection(db, "users", uid, "notifications"));
  return snapshot.docs.map((noticeDoc) => ({ id: noticeDoc.id, ...noticeDoc.data() }));
}

export function subscribeToNotifications(uid, callback, onError) {
  return onSnapshot(collection(db, "users", uid, "notifications"), (snapshot) => {
    callback(snapshot.docs.map((noticeDoc) => ({ id: noticeDoc.id, ...noticeDoc.data() })));
  }, onError);
}

export async function listLobbiesForUser(uid) {
  const snapshot = await getDocs(query(collection(db, "lobbies"), where("participantUids", "array-contains", uid)));
  return snapshot.docs.map((lobbyDoc) => ({ id: lobbyDoc.id, ...lobbyDoc.data() }));
}

export function subscribeToLobbiesForUser(uid, callback, onError) {
  return onSnapshot(query(collection(db, "lobbies"), where("participantUids", "array-contains", uid)), (snapshot) => {
    callback(snapshot.docs.map((lobbyDoc) => ({ id: lobbyDoc.id, ...lobbyDoc.data() })));
  }, onError);
}

export async function sendFirebaseFriendRequest(senderUid, senderProfile, recipientProfile) {
  const notificationId = `friend_${senderUid}`;
  await setDoc(doc(db, "users", recipientProfile.uid, "notifications", notificationId), {
    type: "friendRequest",
    title: "Friend Request",
    text: `${senderProfile.username} wants to be cafe friends.`,
    sender: senderProfile.username,
    senderUid,
    senderTag: senderProfile.tag,
    recipient: recipientProfile.username,
    recipientUid: recipientProfile.uid,
    status: "pending",
    unread: true,
    createdAt: serverTimestamp(),
  }, { merge: true });
}

export async function sendFirebaseGameInvite(lobby, recipientUid, { existing = false } = {}) {
  if (existing) {
    await writeFirebaseLobby(lobby);
  } else {
    // Missing lobbies cannot pass participant-only read rules. Create directly.
    await setDoc(doc(db, "lobbies", lobby.id), sanitizeForFirestore(firebaseLobbyDocument(lobby)));
  }
  await setDoc(doc(db, "users", recipientUid, "notifications", lobby.id), {
    id: lobby.id,
    type: "gameInvite",
    title: "Game Invite",
    text: lobby.text || `${lobby.sender} invited you to play ${lobby.mode || "Chopsticks & Chai"}.`,
    sender: lobby.sender,
    senderUid: lobby.senderUid,
    senderTag: lobby.senderTag || "",
    recipient: lobby.recipient || "",
    recipientUid,
    status: lobby.status || "pending",
    mode: lobby.mode || "",
    participantUids: lobby.participantUids || [],
    senderCharacterId: lobby.senderCharacterId || "",
    recipientCharacterId: lobby.recipientCharacterId || "",
    unread: true,
    createdAt: serverTimestamp(),
  }, { merge: true });
}

function firebaseLobbyDocument(lobby) {
  return {
    id: lobby.id,
    type: lobby.type || "gameInvite",
    title: lobby.title || "",
    text: lobby.text || "",
    sender: lobby.sender || "",
    senderUid: lobby.senderUid || "",
    senderTag: lobby.senderTag || "",
    recipient: lobby.recipient || "",
    recipientUid: lobby.recipientUid || "",
    status: lobby.status || "pending",
    unread: Boolean(lobby.unread),
    createdAt: lobby.createdAt || "",
    updatedAt: serverTimestamp(),
    mode: lobby.mode || "",
    activeGame: Boolean(lobby.activeGame),
    activeTurnPlayer: lobby.activeTurnPlayer || "",
    lastGameStateAt: lobby.lastGameStateAt || "",
    participantUids: lobby.participantUids || [],
    recipientCharacterId: lobby.recipientCharacterId || "",
    senderCharacterId: lobby.senderCharacterId || "",
    chat: lobby.chat || [],
    closedFor: lobby.closedFor || [],
    minimizedFor: lobby.minimizedFor || [],
    joinedFor: lobby.joinedFor || [],
    readyFor: lobby.readyFor || [],
    declined: Boolean(lobby.declined),
    inGameFor: lobby.inGameFor || [],
    absentPlayers: lobby.absentPlayers || {},
    gameState: lobby.gameState || null,
  };
}

export async function writeFirebaseLobby(lobby, { syncGame = false } = {}) {
  if (lobby.mode === "Ranked Mode") {
    if (syncGame) await submitRankedState(lobby.id, lobby.gameState);
    return;
  }
  const lobbyRef = doc(db, "lobbies", lobby.id);
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(lobbyRef);
    const next = mergeLobbyGame(snapshot.data(), firebaseLobbyDocument(lobby), syncGame);
    transaction.set(lobbyRef, sanitizeForFirestore(next), { merge: true });
  });
}

export async function completeFirebaseMatch(lobbyId, finalState) {
  if (finalState.mode === "Ranked Mode") return submitRankedState(lobbyId, finalState);
  const lobbyRef = doc(db, "lobbies", lobbyId);
  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(lobbyRef);
    if (!snapshot.exists()) throw new Error("The match lobby is unavailable.");
    const lobby = snapshot.data();
    if (lobby.gameState && !sameMatch(lobby.gameState, finalState)) throw new Error("This match has already been replaced.");
    if (lobby.gameState?.over && lobby.gameState.result) return lobby.gameState;
    const expired = expiredMatchResult(lobby.gameState, serverNow());
    const confirmed = expired ? completedByClock(lobby.gameState, expired) : finalState;
    if (!validMatchEnding(lobby, confirmed, serverNow())) return lobby.gameState;
    transaction.update(lobbyRef, sanitizeForFirestore({
      status: "complete", activeGame: false, absentPlayers: {},
      gameState: confirmed, lastGameStateAt: Date.now(),
    }));
    return confirmed;
  });
}

export async function deleteFirebaseLobby(lobbyId) {
  await deleteFirebaseLobbyMessages(lobbyId);
  await deleteDoc(doc(db, "lobbies", lobbyId));
}

export async function deleteFirebaseLobbyMessages(lobbyId) {
  const snapshot = await getDocs(collection(db, "lobbies", lobbyId, "messages"));
  await Promise.all(snapshot.docs.map((messageDoc) => deleteDoc(messageDoc.ref)));
}

export function subscribeToLobbyMessages(lobbyId, callback, onError) {
  return onSnapshot(
    query(collection(db, "lobbies", lobbyId, "messages"), orderBy("sentAt", "asc"), limitToLast(40)),
    (snapshot) => {
      callback(snapshot.docs.map((messageDoc) => ({ id: messageDoc.id, ...messageDoc.data() })));
    },
    onError,
  );
}

export async function sendFirebaseLobbyMessage(lobbyId, message) {
  await addDoc(collection(db, "lobbies", lobbyId, "messages"), {
    ...sanitizeForFirestore(message),
    sentAt: serverTimestamp(),
  });
}

export async function logFirebaseAuditEvent(uid, event = {}) {
  if (!uid || !event.type) return;
  await addDoc(collection(db, "users", uid, "auditLogs"), {
    type: String(event.type).slice(0, 80),
    username: String(event.username || "").slice(0, 18),
    summary: String(event.summary || "").slice(0, 240),
    metadata: sanitizeForFirestore(event.metadata || {}),
    clientCreatedAt: new Date().toISOString(),
    createdAt: serverTimestamp(),
  });
}

export async function acceptFirebaseFriendRequest(currentUid, currentProfile, notice) {
  const now = serverTimestamp();
  await setDoc(doc(db, "users", currentUid, "friends", notice.senderUid), {
    uid: notice.senderUid,
    username: notice.sender,
    tag: notice.senderTag || "",
    status: "Available",
    createdAt: now,
  }, { merge: true });
  await setDoc(doc(db, "users", notice.senderUid, "friends", currentUid), {
    uid: currentUid,
    username: currentProfile.username,
    tag: currentProfile.tag || "",
    status: "Available",
    createdAt: now,
  }, { merge: true });
  await deleteFirebaseNotification(currentUid, notice.id);
}

export function deleteFirebaseNotification(uid, notificationId) {
  return deleteDoc(doc(db, "users", uid, "notifications", notificationId));
}

export async function removeFirebaseFriend(currentUid, friendUid) {
  await deleteDoc(doc(db, "users", currentUid, "friends", friendUid));
  await deleteDoc(doc(db, "users", friendUid, "friends", currentUid));
}

export async function deleteFirebaseAccount(currentUser, profile = {}) {
  if (!currentUser) throw new Error("No signed-in Firebase user.");
  const uid = currentUser.uid;
  await deleteDoc(doc(db, "playerProfiles", uid));
  const [friends, notifications, saves, lobbies] = await Promise.all([
    listFriends(uid),
    listNotifications(uid),
    listSaves(uid),
    listLobbiesForUser(uid),
  ]);

  await Promise.all([
    ...friends.map((friend) => deleteDoc(doc(db, "users", uid, "friends", friend.uid || friend.id))),
    ...friends
      .filter((friend) => friend.uid || friend.id)
      .map((friend) => deleteDoc(doc(db, "users", friend.uid || friend.id, "friends", uid)).catch((error) => {
        if (error && error.code === "permission-denied") return;
        throw error;
      })),
    ...notifications.map((notice) => deleteDoc(doc(db, "users", uid, "notifications", notice.id))),
    ...saves.map((save) => deleteDoc(doc(db, "users", uid, "saves", save.id))),
    ...lobbies.map((lobby) => deleteFirebaseLobby(lobby.id)),
  ]);

  if (profile.username) {
    await deleteDoc(doc(db, "publicProfiles", publicProfileId(profile.username)));
    await deleteDoc(doc(db, "usernameHandles", publicProfileId(profile.username)));
  }
  await deleteDoc(doc(db, "users", uid));
  await deleteUser(currentUser);
}

function sanitizeForFirestore(value) {
  if (Array.isArray(value)) return value.map(sanitizeForFirestore);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, sanitizeForFirestore(item)]),
  );
}

const rankedFunctions = getFunctions(firebaseApp, "us-central1");
export const rankedCall = async (name, data = {}) => (await httpsCallable(rankedFunctions, name)(data)).data;
let rankedWrites = Promise.resolve();
export function submitRankedState(matchId, state) {
  const pending = rankedWrites.catch(() => {}).then(() => rankedCall("rankedMove", {matchId, state}));
  rankedWrites = pending;
  pending.then(confirmed => window.dispatchEvent(new CustomEvent("ranked-state", {detail:confirmed}))).catch(error => {
    window.dispatchEvent(new CustomEvent("ranked-sync-error", {detail:{matchId, message:error.message}}));
  });
  return pending;
}
export const watchRankedProfile = (uid, callback, error) => onSnapshot(doc(db, "rankedPlayers", uid), snap => callback(snap.exists() ? snap.data() : null), error);
export const watchRankedLeaderboard = (rank, callback, error) => onSnapshot(query(collection(db, "rankedPlayers"), where("rank", "==", rank)), snap => callback(snap.docs.map(d => ({uid:d.id,...d.data()}))), error);
export const getRankedLobby = async id => { const snap=await getDocFromServer(doc(db,"lobbies",id)); return snap.exists()?{id:snap.id,...snap.data()}:null; };
