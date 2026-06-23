import { initializeApp } from "firebase/app";
import { getAnalytics, isSupported as isAnalyticsSupported } from "firebase/analytics";
import {
  createUserWithEmailAndPassword,
  deleteUser,
  getAuth,
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
  getFirestore,
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

export const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);

export const analytics = isAnalyticsSupported()
  .then((supported) => (supported ? getAnalytics(firebaseApp) : null))
  .catch(() => null);

export function subscribeToAuthState(callback) {
  return onAuthStateChanged(auth, callback);
}

export async function signUpWithEmail(email, password, username) {
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  if (username) {
    await updateProfile(credential.user, { displayName: username });
  }
  await upsertUserProfile(credential.user.uid, {
    email: credential.user.email,
    username,
  });
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
  await setDoc(doc(db, "users", uid), privateProfile, { merge: true });
  if (profile.username && profile.tag) {
    await setDoc(doc(db, "publicProfiles", publicProfileId(profile.username, profile.tag)), {
      uid,
      username: profile.username,
      tag: profile.tag,
      selectedCharacterId: profile.selectedCharacterId || "honeyBear",
      updatedAt: serverTimestamp(),
    }, { merge: true });
  }
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
    transaction.set(userRef, {
      ...sanitizeForFirestore(next),
      updatedAt: serverTimestamp(),
    }, { merge: true });
    if (next.username && next.tag) {
      transaction.set(doc(db, "publicProfiles", publicProfileId(next.username, next.tag)), {
        uid,
        username: next.username,
        tag: next.tag,
        selectedCharacterId: next.selectedCharacterId || "honeyBear",
        updatedAt: serverTimestamp(),
      }, { merge: true });
    }
    return updateResult && Object.hasOwn(updateResult, "result") ? updateResult.result : next;
  });
}

export function publicProfileId(username, tag) {
  return `${String(username).trim().toLowerCase()}_${String(tag).trim().toUpperCase()}`;
}

export async function findPublicProfile(username, tag) {
  const snapshot = await getDoc(doc(db, "publicProfiles", publicProfileId(username, tag)));
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
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

  if (profile.username && profile.tag) {
    await deleteDoc(doc(db, "publicProfiles", publicProfileId(profile.username, profile.tag)));
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
