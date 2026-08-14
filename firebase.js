import { initializeApp } from "firebase/app";
import { getAnalytics, isSupported as isAnalyticsSupported } from "firebase/analytics";
import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  deleteUser,
  indexedDBLocalPersistence,
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
  getDocs,
  initializeFirestore,
  limit,
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
  storageBucket: "chopsticks-and-chai.firebasestorage.app",
  messagingSenderId: "489064265036",
  appId: "1:489064265036:web:e660343c56471c40844be9",
  measurementId: "G-QWWESBQV3X",
};

const firestoreRestBase = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents`;

export const firebaseApp = initializeApp(firebaseConfig);
export const auth = initializeAuth(firebaseApp, {
  persistence: [indexedDBLocalPersistence, browserLocalPersistence],
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
    transaction.set(doc(db, "users", uid), privateProfile);
  });
}

export function updateUserPresence(uid, presence = {}) {
  return setDoc(doc(db, "users", uid), {
    presence: {
      ...presence,
      lastSeenAt: serverTimestamp(),
    },
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

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

export async function findPublicProfile(username, tag) {
  const snapshot = await getDoc(doc(db, "publicProfiles", publicProfileId(username)));
  if (!snapshot.exists()) return null;
  const profile = { id: snapshot.id, ...snapshot.data() };
  return tag && profile.tag && String(profile.tag).toUpperCase() !== String(tag).toUpperCase()
    ? null
    : profile;
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

export async function sendFirebaseGameInvite(lobby, recipientUid) {
  await writeFirebaseLobby(lobby);
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

export async function writeFirebaseLobby(lobby) {
  await setDoc(doc(db, "lobbies", lobby.id), {
    ...sanitizeForFirestore(lobby),
    updatedAt: serverTimestamp(),
  }, { merge: true });
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
    query(collection(db, "lobbies", lobbyId, "messages"), orderBy("sentAt", "asc"), limit(40)),
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
