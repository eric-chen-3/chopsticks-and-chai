export function summarizeSessions(presence) {
  const session = presence?.sessions?.[presence.activeSession];
  return { online: Boolean(session), inGame: session?.inGame === true };
}

export function claimSession(value, id, state) {
  // Return the occupied record unchanged instead of aborting locally. Firebase
  // must confirm it against the server and retry if the cached record is stale.
  if (value?.sessions?.[value.activeSession] && value.activeSession !== id) return value;
  return { activeSession: id, sessions: { [id]: state } };
}

// The first connected session owns the account until its connection is removed.
export function createPresenceSession(api) {
  let current = null;
  let blockedUid = null;
  function detach(owner) {
    owner.unsubscribe?.();
    owner.unwatch?.();
    owner.version++;
    owner.ready = false;
  }
  function revoke(owner) {
    if (current !== owner) return;
    blockedUid = owner.uid;
    current = null;
    detach(owner);
    api.disconnect();
    owner.resolve(false);
    api.onRejected(owner.uid);
  }
  function update(uid, state) {
    if (blockedUid === uid) return Promise.resolve(false);
    if (current?.uid === uid) {
      const owner = current;
      const changed = owner.state.inGame !== state.inGame;
      owner.state = state;
      if (changed && owner.ready) {
        api.publish(uid, owner.id, state).then((accepted) => {
          if (!accepted) revoke(owner);
        }).catch(api.onError);
      }
      return owner.result;
    }
    if (current) void stop().catch(api.onError);
    const owner = { uid, id: api.newId(), state, claimed: false, ready: false, version: 0 };
    owner.result = new Promise((resolve) => { owner.resolve = resolve; });
    current = owner;
    api.connect();
    owner.unsubscribe = api.watchConnection(async (connected) => {
      const version = ++owner.version;
      owner.ready = false;
      if (!connected || current !== owner) return;
      const valid = () => current === owner && owner.version === version;
      try {
        // Cleanup is armed before the atomic claim publishes the session.
        await api.armDisconnect(uid, owner.id);
        if (!valid()) return;
        if (!owner.claimed) {
          const claimed = await api.claim(uid, owner.id, owner.state);
          if (!valid()) return;
          if (!claimed) return revoke(owner);
          owner.claimed = true;
          owner.unwatch = api.watchOwner(uid, (id) => {
            if (id !== owner.id) revoke(owner);
          }, api.onError);
        }
        const accepted = await api.publish(uid, owner.id, owner.state);
        if (!valid()) return;
        if (!accepted) return revoke(owner);
        owner.ready = true;
        owner.resolve(true);
        // A game state change may have arrived while publishing.
        await api.publish(uid, owner.id, owner.state);
      } catch (error) {
        if (valid()) {
          owner.ready = false;
          owner.resolve(false);
          api.onError(error);
        }
      }
    });
    return owner.result;
  }
  async function stop() {
    const owner = current;
    if (!owner) return;
    current = null;
    detach(owner);
    owner.resolve(false);
    api.disconnect();
  }
  function allowLogin() {
    blockedUid = null;
  }
  return { update, stop, allowLogin };
}
