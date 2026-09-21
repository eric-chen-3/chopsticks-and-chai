import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const source = await readFile(new URL("../presence.js", import.meta.url), "utf8");
const { createPresenceSession, summarizeSessions, claimSession } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);

let record = null;
let nextId = 0;
const listeners = new Set();
const notify = () => { for (const listener of [...listeners]) listener(record?.activeSession); };
function client() {
  let connectCallback;
  let cleanupId;
  let ownerCallback;
  const events = [];
  const errors = [];
  const api = {
    newId: () => `session-${++nextId}`,
    connect: () => events.push("connect"),
    disconnect: () => {
      if (record?.sessions) delete record.sessions[cleanupId];
      events.push("disconnect");
    },
    watchConnection: (callback) => { connectCallback = callback; return () => events.push("unsubscribe"); },
    claim: async (uid, id, state) => {
      const next = claimSession(record, id, state);
      if (next.activeSession !== id) return false;
      record = next;
      events.push("claim");
      notify();
      return true;
    },
    watchOwner: (uid, callback) => {
      ownerCallback = callback;
      listeners.add(callback);
      queueMicrotask(() => { if (listeners.has(callback)) callback(record?.activeSession); });
      return () => listeners.delete(callback);
    },
    armDisconnect: async (uid, id) => { cleanupId = id; events.push("arm"); },
    publish: async (uid, id, state) => {
      if (record?.activeSession !== id) return false;
      record.sessions = { [id]: state };
      events.push("publish");
      return true;
    },
    onRejected: () => events.push("rejected"),
    onError: (error) => errors.push(error),
  };
  return {
    session: createPresenceSession(api), events, errors, api,
    connection: (connected) => connectCallback(connected),
    suspendOwnerEvents: () => listeners.delete(ownerCallback),
  };
}
assert.deepEqual(summarizeSessions(null), { online: false, inGame: false });
// A cached occupied record must reach the server, not abort the transaction.
// The server can then retry with its current, disconnected state.
const cached = { activeSession: "stale", sessions: { stale: { inGame: false } } };
assert.equal(claimSession(cached, "fresh", { inGame: false }), cached);
const retried = claimSession({ activeSession: "stale" }, "fresh", { inGame: false });
assert.equal(retried.activeSession, "fresh");
assert.equal(summarizeSessions(retried).online, true);
assert.deepEqual(summarizeSessions({ activeSession: "new", sessions: { old: { inGame: true } } }), { online: false, inGame: false });
const first = client();
first.session.update("alice", { inGame: false });
await first.connection(true);
assert.deepEqual(summarizeSessions(record), { online: true, inGame: false });
assert.ok(first.events.indexOf("arm") < first.events.indexOf("publish"));
first.session.update("alice", { inGame: true });
await Promise.resolve();
assert.equal(summarizeSessions(record).inGame, true);
const originalOwner = record.activeSession;
const second = client();
second.session.update("alice", { inGame: false });
await second.connection(true);
assert.ok(second.events.includes("rejected"));
assert.equal(first.events.includes("rejected"), false);
assert.equal(record.activeSession, originalOwner);
assert.equal(summarizeSessions(record).inGame, true, "rejection leaves existing game intact");
assert.equal(Object.keys(record.sessions).length, 1);
await first.connection(false);
await first.connection(true);
assert.equal(record.activeSession, originalOwner);
assert.equal(first.events.filter(x => x === "claim").length, 1);

// The second device can enter only once the first session ends.
await first.session.stop();
assert.equal(summarizeSessions(record).online, false);
second.session.allowLogin();
second.session.update("alice", { inGame: false });
await second.connection(true);
assert.notEqual(record.activeSession, originalOwner);
assert.equal(summarizeSessions(record).online, true);
await first.session.stop();
assert.equal(summarizeSessions(record).online, true, "old cleanup cannot affect the admitted session");
await second.session.stop();

// Concurrent sign-ins: exactly one wins the atomic claim.
const racerA = client();
const racerB = client();
racerA.session.update("alice", { inGame: false });
racerB.session.update("alice", { inGame: false });
await Promise.all([racerA.connection(true), racerB.connection(true)]);
assert.equal([racerA, racerB].filter(c => c.events.includes("rejected")).length, 1);
assert.equal(Object.keys(record.sessions).length, 1);
await racerA.session.stop();
await racerB.session.stop();
assert.equal(first.errors.length + second.errors.length, 0);

// An in-flight connection must never publish after logout.
const delayed = client();
let release;
delayed.api.armDisconnect = () => new Promise(resolve => { release = resolve; });
delayed.session.update("alice", { inGame: false });
const pending = delayed.connection(true);
await Promise.resolve();
await delayed.session.stop();
release();
await pending;
assert.equal(delayed.events.includes("publish"), false);
console.log("PASS: existing-session protection, simultaneous sign-ins, admission after logout, reconnect, state changes, isolated cleanup, pending-connect cancellation.");
