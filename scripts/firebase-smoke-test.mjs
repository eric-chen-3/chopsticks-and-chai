import { deleteApp, initializeApp } from "firebase/app";
import {
  createUserWithEmailAndPassword,
  deleteUser,
  getAuth,
  signOut,
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
  orderBy,
  query,
  serverTimestamp,
  setDoc,
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

const stamp = Date.now().toString(36);
const password = "CodexTest123!";
const results = [];

async function record(name, fn) {
  try {
    const value = await fn();
    results.push({ name, ok: true, value });
    return value;
  } catch (error) {
    results.push({
      name,
      ok: false,
      code: error.code || error.name,
      message: error.message,
    });
    return null;
  }
}

async function expectDenied(name, fn) {
  try {
    await fn();
    results.push({ name, ok: false, message: "Expected permission-denied but operation succeeded" });
  } catch (error) {
    results.push({
      name,
      ok: error.code === "permission-denied",
      code: error.code,
      message: error.message,
    });
  }
}

const appA = initializeApp(firebaseConfig, `codex-a-${stamp}`);
const appB = initializeApp(firebaseConfig, `codex-b-${stamp}`);
const authA = getAuth(appA);
const authB = getAuth(appB);
const dbA = getFirestore(appA);
const dbB = getFirestore(appB);

let userA = null;
let userB = null;
let lobbyId = `codex_lobby_${stamp}`;
let notificationId = "";
let messageId = "";

try {
  userA = await record(
    "create test auth user A",
    async () => (await createUserWithEmailAndPassword(authA, `codex_${stamp}_a@example.com`, password)).user,
  );
  userB = await record(
    "create test auth user B",
    async () => (await createUserWithEmailAndPassword(authB, `codex_${stamp}_b@example.com`, password)).user,
  );

  if (userA && userB) {
    notificationId = `friend_${userA.uid}`;

    await record("A writes own private user profile", () => setDoc(doc(dbA, "users", userA.uid), {
      email: userA.email,
      username: `codex_a_${stamp}`,
      tag: "TSTA",
      selectedCharacterId: "honeyBear",
      updatedAt: serverTimestamp(),
    }, { merge: true }));

    await record("B writes own private user profile", () => setDoc(doc(dbB, "users", userB.uid), {
      email: userB.email,
      username: `codex_b_${stamp}`,
      tag: "TSTB",
      selectedCharacterId: "mochiBunny",
      updatedAt: serverTimestamp(),
    }, { merge: true }));

    await record("A writes own public profile", () => setDoc(doc(dbA, "publicProfiles", `codex_a_${stamp}_TSTA`), {
      uid: userA.uid,
      username: `codex_a_${stamp}`,
      tag: "TSTA",
      selectedCharacterId: "honeyBear",
      updatedAt: serverTimestamp(),
    }, { merge: true }));

    await expectDenied("A cannot write invalid oversized public profile", () => setDoc(doc(dbA, "publicProfiles", `codex_a_${stamp}_TOOLONG`), {
      uid: userA.uid,
      username: `codex_a_${stamp}_this_name_is_too_long`,
      tag: "TOOLONG",
      updatedAt: serverTimestamp(),
    }, { merge: true }));

    await expectDenied("A cannot read B private user profile", () => getDoc(doc(dbA, "users", userB.uid)));

    await record("A creates friend request notification for B", () => setDoc(doc(dbA, "users", userB.uid, "notifications", notificationId), {
      type: "friendRequest",
      title: "Friend Request",
      text: `codex_a_${stamp} wants to be cafe friends.`,
      sender: `codex_a_${stamp}`,
      senderUid: userA.uid,
      senderTag: "TSTA",
      recipient: `codex_b_${stamp}`,
      recipientUid: userB.uid,
      status: "pending",
      unread: true,
      createdAt: serverTimestamp(),
    }, { merge: true }));

    await record("B reads received notification", async () => ({
      exists: (await getDoc(doc(dbB, "users", userB.uid, "notifications", notificationId))).exists(),
    }));

    await record("B creates own friend doc for A", () => setDoc(doc(dbB, "users", userB.uid, "friends", userA.uid), {
      uid: userA.uid,
      username: `codex_a_${stamp}`,
      tag: "TSTA",
      status: "Available",
      createdAt: serverTimestamp(),
    }, { merge: true }));

    await record("B creates reverse friend doc under A", () => setDoc(doc(dbB, "users", userA.uid, "friends", userB.uid), {
      uid: userB.uid,
      username: `codex_b_${stamp}`,
      tag: "TSTB",
      status: "Available",
      createdAt: serverTimestamp(),
    }, { merge: true }));

    await record("A reads reverse friend doc", async () => ({
      exists: (await getDoc(doc(dbA, "users", userA.uid, "friends", userB.uid))).exists(),
    }));

    await record("A deletes self from B friend doc", () => deleteDoc(doc(dbA, "users", userB.uid, "friends", userA.uid)));
    await record("B recreates own friend doc for cleanup coverage", () => setDoc(doc(dbB, "users", userB.uid, "friends", userA.uid), {
      uid: userA.uid,
      username: `codex_a_${stamp}`,
      tag: "TSTA",
      status: "Available",
      createdAt: serverTimestamp(),
    }, { merge: true }));

    await record("A creates lobby for A and B", () => setDoc(doc(dbA, "lobbies", lobbyId), {
      id: lobbyId,
      type: "gameInvite",
      sender: `codex_a_${stamp}`,
      senderUid: userA.uid,
      recipient: `codex_b_${stamp}`,
      recipientUid: userB.uid,
      participantUids: [userA.uid, userB.uid],
      status: "accepted",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, { merge: true }));

    await record("B reads participant lobby", async () => ({
      exists: (await getDoc(doc(dbB, "lobbies", lobbyId))).exists(),
    }));

    await record("A creates game invite notification for B", () => setDoc(doc(dbA, "users", userB.uid, "notifications", lobbyId), {
      id: lobbyId,
      type: "gameInvite",
      title: "Game Invite",
      text: `codex_a_${stamp} invited you to play.`,
      sender: `codex_a_${stamp}`,
      senderUid: userA.uid,
      senderTag: "TSTA",
      recipient: `codex_b_${stamp}`,
      recipientUid: userB.uid,
      status: "pending",
      mode: "Standard Mode",
      participantUids: [userA.uid, userB.uid],
      unread: true,
      createdAt: serverTimestamp(),
    }, { merge: true }));

    messageId = await record("A creates lobby message", async () => {
      const ref = await addDoc(collection(dbA, "lobbies", lobbyId, "messages"), {
        senderUid: userA.uid,
        sender: `codex_a_${stamp}`,
        text: `rules smoke ${stamp}`,
        sentAt: serverTimestamp(),
      });
      return ref.id;
    }) || "";

    await record("B reads lobby messages", async () => {
      const snap = await getDocs(query(collection(dbB, "lobbies", lobbyId, "messages"), orderBy("sentAt", "asc"), limit(40)));
      return { count: snap.size, texts: snap.docs.map((messageDoc) => messageDoc.data().text) };
    });

    await expectDenied("A cannot create oversized lobby message", () => addDoc(collection(dbA, "lobbies", lobbyId, "messages"), {
      senderUid: userA.uid,
      sender: `codex_a_${stamp}`,
      text: "x".repeat(121),
      sentAt: serverTimestamp(),
    }));

    await expectDenied("B cannot spoof A as lobby message sender", () => addDoc(collection(dbB, "lobbies", lobbyId, "messages"), {
      senderUid: userA.uid,
      sender: "spoof",
      text: "should fail",
      sentAt: serverTimestamp(),
    }));

    await record("cleanup B notification", () => deleteDoc(doc(dbB, "users", userB.uid, "notifications", notificationId)));
    await record("cleanup B game invite notification", () => deleteDoc(doc(dbB, "users", userB.uid, "notifications", lobbyId)));
    await record("cleanup A friend doc", () => deleteDoc(doc(dbA, "users", userA.uid, "friends", userB.uid)));
    await record("cleanup B friend doc from A account", () => deleteDoc(doc(dbA, "users", userB.uid, "friends", userA.uid)));
    await record("cleanup A public profile", () => deleteDoc(doc(dbA, "publicProfiles", `codex_a_${stamp}_TSTA`)));
    await record("cleanup A user doc", () => deleteDoc(doc(dbA, "users", userA.uid)));
    await record("cleanup B user doc", () => deleteDoc(doc(dbB, "users", userB.uid)));
    if (messageId) {
      await record("cleanup lobby message doc", () => deleteDoc(doc(dbA, "lobbies", lobbyId, "messages", messageId)));
    }
    await record("cleanup lobby doc", () => deleteDoc(doc(dbA, "lobbies", lobbyId)));
    await record("delete auth user A", () => deleteUser(userA));
    await record("delete auth user B", () => deleteUser(userB));
  }
} finally {
  await Promise.allSettled([signOut(authA), signOut(authB)]);
  await Promise.allSettled([deleteApp(appA), deleteApp(appB)]);
}

const failed = results.filter((result) => !result.ok);
console.log(JSON.stringify({ stamp, lobbyId, messageId, failed: failed.length, results }, null, 2));
process.exitCode = failed.length ? 1 : 0;
