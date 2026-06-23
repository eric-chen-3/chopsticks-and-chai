import {
  acceptFirebaseFriendRequest,
  deleteFirebaseAccount,
  deleteFirebaseNotification,
  deleteFirebaseLobby,
  deleteFirebaseSave,
  findPublicProfile,
  listFriends,
  listLobbiesForUser,
  listNotifications,
  listSaves,
  loadUserProfile,
  removeFirebaseFriend,
  sendFirebaseLobbyMessage,
  sendFirebaseGameInvite,
  sendFirebaseFriendRequest,
  signInWithEmail,
  signOutCurrentUser,
  signUpWithEmail,
  subscribeToAuthState,
  subscribeToFriends,
  subscribeToLobbyMessages,
  subscribeToLobbiesForUser,
  subscribeToNotifications,
  subscribeToSaves,
  updateUserProfileTransaction,
  updateUserPresence,
  upsertUserProfile,
  writeFirebaseSave,
  writeFirebaseLobby,
} from "./firebase.js";

const SAVE_KEY = "chopstickDuel.saves";
const SETTINGS_KEY = "chopstickDuel.settings";
const CHARACTER_KEY = "chopstickDuel.selectedCharacter";
const PROFILE_KEY = "chopstickDuel.profile";
const FRIENDS_KEY = "chopstickDuel.friends";
const NOTIFICATIONS_KEY = "chopstickDuel.notifications";
const MOCK_USERS_KEY = "chopstickDuel.mockUsers";
const ACTIVE_USER_KEY = "chopstickDuel.activeUser";
const ACTIVE_INVITE_KEY = "chopstickDuel.activeInvite";
const LOBBIES_KEY = "chopstickDuel.lobbies";
const ECONOMY_RESET_KEY = "chopstickDuel.economyReset.v1";
const SLEEPY_PANDA_RESET_KEY = "chopstickDuel.sleepyPandaReset.v1";
const MAX_SAVES = 3;
const MAX_LOBBIES = 7;
const WIN_XP = 50;
const LOSS_XP = 15;
const WIN_COINS = 25;
const FORFEIT_SECONDS = 30;

let game;
let previousScreen = "mainMenuScreen";
let pendingSaveName = "";
let pendingRenameId = "";
let audioContext;
let pendingEffect = null;
let pendingMode = "Standard Mode";
let pendingCardIndex = null;
let overwriteBackTarget = "saveName";
let pendingSubmode = "Pass and Play";
let pendingInviteFriendId = "";
let pendingInviteId = "";
let pendingCharacterId = "";
let pendingRenameAccount = "";
let pendingHostClosedNoticeId = "";
let pendingHandleEdit = "";
let pendingStartupBackScreen = "submodeScreen";
let forfeitTimerId = null;
let pendingDeclineGameLobbyId = "";
let forfeitTimerHidden = false;
let firebaseUser = null;
let firebaseProfile = null;
let firebaseAuthReady = false;
let firebaseFriends = [];
let firebaseNotifications = [];
let firebaseLobbies = [];
let firebaseSaves = [];
let firebaseDataUnsubscribers = [];
let firebaseUsernameUidMap = {};
let presenceHeartbeatId = null;
let gameStateSyncTimer = null;
let lobbyChatUnsubscribe = null;
let lobbyChatSubscriptionId = "";
let firebaseLobbyMessages = {};

function devToolsEnabled() {
  try {
    return import.meta.env.DEV && new URLSearchParams(window.location.search).get("devtools") === "1";
  } catch {
    return false;
  }
}

function localMockAccountsEnabled() {
  try {
    return import.meta.env.DEV;
  } catch {
    return false;
  }
}

const defaultSettings = {
  musicVolume: 70,
  sfxVolume: 70,
  reduceMotion: false,
  showHints: true,
};

const legalCopy = {
  privacy: {
    title: "Privacy",
    paragraphs: [
      "Chopsticks & Chai uses Firebase Authentication for email/password sign-in and Firestore for profile, friends, saves, notifications, lobby, chat, and match state data.",
      "The app does not sell personal data. Analytics is configured through Firebase and should be reviewed before public release.",
      "Final Privacy Policy text and the public policy URL must be approved before TestFlight external testing or App Store submission.",
    ],
  },
  terms: {
    title: "Terms",
    paragraphs: [
      "Chopsticks & Chai is a casual game currently in testing. Do not rely on test builds to preserve progress permanently.",
      "Players are responsible for respectful lobby and chat behavior. Accounts may be removed if abuse moderation is added later.",
      "Final Terms text and the public terms URL must be approved before TestFlight external testing or App Store submission.",
    ],
  },
  support: {
    title: "Support",
    paragraphs: [
      "For test builds, contact the developer directly with the email used for your test invite, your device model, and what happened.",
      "Account deletion is available from the Profile screen when signed in. It removes your Firebase account, profile, saves, friends, notifications, active lobbies, and lobby messages that can be reached from your account.",
      "A public support URL or support email should be added before TestFlight external testing.",
    ],
  },
};

const characters = [
  { id: "honeyBear", name: "Honey Bear", tier: "Starter", className: "bear" },
  { id: "mochiBunny", name: "Mochi Bunny", tier: "Starter", className: "bunny" },
  { id: "milkTeaCat", name: "Milk Tea Cat", tier: "Starter", className: "cat" },
  { id: "sleepyPanda", name: "Sleepy Panda", tier: "Starter", className: "panda" },
  { id: "puddingHamster", name: "Pudding Hamster", tier: "Starter", className: "hamster" },
  { id: "peachFox", name: "Peach Fox", tier: "Unlockable", className: "fox" },
  { id: "sunnyChick", name: "Sunny Chick", tier: "Unlockable", className: "chick" },
  { id: "bubbleOtter", name: "Bubble Otter", tier: "Unlockable", className: "otter" },
  { id: "blueberryPenguin", name: "Blueberry Penguin", tier: "Unlockable", className: "penguin" },
  { id: "mapleRaccoon", name: "Maple Raccoon", tier: "Unlockable", className: "raccoon" },
  { id: "dreamUnicorn", name: "Dream Unicorn", tier: "Rare", className: "unicorn" },
  { id: "babyDragon", name: "Baby Dragon", tier: "Rare", className: "dragon" },
  { id: "cloudBear", name: "Cloud Bear", tier: "Rare", className: "cloud" },
  { id: "starBunny", name: "Star Bunny", tier: "Rare", className: "star" },
];

const powerCards = {
  energyUp: { name: "Energy Up", cost: 0, color: "mint", text: "Gain +1 extra energy next turn." },
  energyDown: { name: "Energy Down", cost: 0, color: "pink", text: "Opponent loses 1 energy gain next turn." },
  shield: { name: "Shield", cost: 2, color: "blue", text: "Block the next attack that hits you." },
  precisionStrike: { name: "Precision Strike", cost: 2, color: "gold", text: "Your next attack this turn adds +1." },
  timeFreeze: { name: "Time Freeze", cost: 3, color: "ice", text: "Opponent cannot split next turn." },
  rebalance: { name: "Rebalance", cost: 3, color: "leaf", text: "Redistribute live hands. Cannot revive 0 hands." },
  redirect: { name: "Redirect", cost: 4, color: "rose", text: "Next attack against you hits your other live hand." },
  doubleTap: { name: "Double Tap", cost: 6, color: "plum", text: "Your next attack hits twice." },
  overload: { name: "Overload", cost: 6, color: "sun", text: "This turn, attacks wrap once at the mode threshold instead of killing." },
  revive: { name: "Revive", cost: 7, color: "cream", text: "Revive one dead hand with 1 chopstick." },
};

const powerDeckList = [
  "energyUp", "energyUp", "energyUp",
  "energyDown", "energyDown",
  "shield", "shield", "shield",
  "precisionStrike", "precisionStrike", "precisionStrike",
  "timeFreeze", "timeFreeze",
  "rebalance", "rebalance",
  "redirect", "redirect",
  "doubleTap",
  "overload",
  "revive",
];

function makePlayer(name) {
  const player = {
    name,
    hands: [1, 1],
    actionUsed: false,
  };
  if (pendingMode === "Power Up Mode") addPowerState(player);
  return player;
}

function createGame() {
  return {
    players: [makePlayer("Player 1"), makePlayer("Player 2")],
    current: 0,
    selected: null,
    over: false,
    log: [],
    mode: pendingMode,
    submode: pendingSubmode,
    localPlayer: 0,
    invitedFriendId: pendingInviteFriendId,
    lobbyId: pendingSubmode === "Separate Devices" ? activeInviteId() : null,
    playerCharacters: ["honeyBear", "mochiBunny"],
    saveId: null,
    rewardSummary: null,
  };
}

function startNewGame() {
  game = createGame();
  if (game.submode === "Separate Devices" && game.lobbyId) {
    updateLobby(game.lobbyId, (lobby) => ({
      ...lobby,
      status: "inGame",
      activeGame: true,
      inGameFor: Array.from(new Set([...(lobby.inGameFor || []), getActiveUsername()].filter(Boolean))),
      absentPlayers: {},
      readyFor: [],
      minimizedFor: [],
      closedFor: [],
    }));
  }
  applyGameCharacters();
  applyProfileNames();
  if (isPowerMode()) {
    game.players.forEach((player) => drawCards(player, 3));
    startPowerTurn(currentPlayer(), false);
  }
  addLog("New game started. Player 1 goes first.");
  showScreen("gameScreen");
  render();
  syncActiveGameStateSoon();
  clearForfeitAbsence(getActiveUsername());
  updateForfeitTimer();
}

function beginGameFlow(backScreen = "submodeScreen") {
  pendingStartupBackScreen = backScreen;
  if (needsStartupNotice()) {
    openStartupNotice();
    return;
  }
  startNewGame();
}

function needsStartupNotice() {
  return pendingMode === "Power Up Mode" || pendingSubmode === "Pass and Play";
}

function openStartupNotice() {
  const title = document.querySelector("#startupNoticeTitle");
  const intro = document.querySelector("#startupNoticeIntro");
  const list = document.querySelector("#startupNoticeList");
  const footnote = document.querySelector("#startupNoticeFootnote");
  title.textContent = pendingMode === "Power Up Mode" ? "Power Up Mode" : "Pass and Play";
  intro.textContent = pendingMode === "Power Up Mode"
    ? "Power Up Mode changes the base rules:"
    : "Pass and Play allows you to play using one shared device. Pass the phone to the other player after the end of your turn.";
  list.replaceChildren();
  if (pendingMode === "Power Up Mode") {
    [
      "Hands die at 10 or more chopsticks instead of 5.",
      "Splits cannot revive a hand with 0 chopsticks.",
      "Each player gains energy and draws power-up cards.",
      "Use one power-up and one normal action each turn.",
    ].forEach((text) => {
      const item = document.createElement("li");
      item.textContent = text;
      list.append(item);
    });
  }
  footnote.innerHTML = pendingSubmode === "Pass and Play"
    ? `Notice: No experience or ${coinIconMarkup()} are awarded in Pass and Play mode.`
    : "";
  document.querySelector("#startupNoticeDialog").showModal();
}

function applyProfileNames() {
  const profile = getProfile();
  const invite = getActiveInvite();
  const friend = getFriends().find((candidate) => candidate.id === pendingInviteFriendId) || (invite ? { username: invite.recipient } : null);
  if (pendingSubmode === "Separate Devices" && invite) {
    game.players[0].name = invite.sender;
    if (invite.recipient) game.players[1].name = invite.recipient;
  } else if (profile) {
    game.players[0].name = profile.username;
  }
  if (friend && pendingSubmode === "Separate Devices" && !invite) game.players[1].name = friend.username;
  if (pendingSubmode === "Pass and Play") {
    const opponentCharacter = characters.find((character) => character.id === game.playerCharacters[1]) || characters[1];
    game.players[1].name = opponentCharacter.name;
  }
}

function applyGameCharacters() {
  const profile = getProfile();
  const invite = getActiveInvite();
  const playerCharacter = getSelectedCharacter().id;
  const available = characters.filter((character) => character.id !== playerCharacter);
  const randomOpponent = available[Math.floor(Math.random() * available.length)] || characters[1];
  game.playerCharacters = [playerCharacter, randomOpponent.id];
  if (pendingSubmode === "Separate Devices" && invite) {
    game.playerCharacters[0] = getCharacterForUsername(invite.sender).id;
    if (invite.recipient) game.playerCharacters[1] = getCharacterForUsername(invite.recipient).id;
  } else if (pendingSubmode === "Separate Devices") {
    const friend = getFriends().find((candidate) => candidate.id === pendingInviteFriendId);
    game.playerCharacters[1] = friend ? getCharacterForUsername(friend.username).id : game.playerCharacters[1];
  }
  if (profile && pendingSubmode !== "Separate Devices") game.playerCharacters[0] = getCharacterForUsername(profile.username).id;
}

function addPowerState(player) {
  player.energy = 0;
  player.deck = shuffle([...powerDeckList]);
  player.cardHand = [];
  player.graveyard = [];
  player.powerUsed = false;
  player.shield = false;
  player.buffs = {
    energyUpNext: 0,
    energyDownNext: 0,
    precision: false,
    doubleTap: false,
    overload: false,
    redirect: false,
    frozen: false,
    reviveUsed: false,
  };
}

function isPowerMode() {
  return game && game.mode === "Power Up Mode";
}

function deathThreshold() {
  return isPowerMode() ? 10 : 5;
}

function maxLiveChopsticks() {
  return deathThreshold() - 1;
}

function showScreen(screenId) {
  ["mainMenuScreen", "profileScreen", "friendsScreen", "notificationsScreen", "waitingLobbyScreen", "storeScreen", "modeScreen", "submodeScreen", "loadScreen", "settingsScreen", "gameScreen"].forEach((id) => {
    document.querySelector(`#${id}`).hidden = id !== screenId;
  });
  document.querySelector("#gameMenuDropdown").hidden = true;
  renderGlobalMockSwitcher();
  renderNotificationBadge();
  if (screenId === "mainMenuScreen") {
    renderSelectedCharacter();
    renderActiveLobbyPrompts();
  }
  if (screenId === "profileScreen") renderProfile();
  if (screenId === "friendsScreen") renderFriends();
  if (screenId === "notificationsScreen") renderNotifications();
  if (screenId === "waitingLobbyScreen") renderWaitingLobby();
  if (screenId === "storeScreen") {
    pendingCharacterId = getSelectedCharacter().id;
    document.querySelector("#storeMessage").textContent = "";
    renderCharacterStore();
  }
  if (screenId === "loadScreen") renderSaveList();
  if (screenId === "settingsScreen") renderSettings();
  writePresence();
}

function currentPlayer() {
  return game.players[game.current];
}

function opponentPlayer() {
  return game.players[opponentIndex()];
}

function opponentIndex() {
  return game.current === 0 ? 1 : 0;
}

function activePlayerIndex() {
  if (!game || game.submode !== "Separate Devices") return game ? game.current : -1;
  const activeUser = getActiveUsername();
  return game.players.findIndex((player) => player.name === activeUser);
}

function canActiveAccountAct() {
  if (!game || game.over) return false;
  if (game.submode !== "Separate Devices") return true;
  return activePlayerIndex() === game.current;
}

function handleHandClick(playerIndex, handIndex) {
  if (!game || game.over || currentPlayer().actionUsed || !canActiveAccountAct()) return;

  const clickedPlayer = game.players[playerIndex];
  const clickedValue = clickedPlayer.hands[handIndex];
  const canUseZeroForSplit = !isPowerMode() && playerIndex === game.current && currentPlayer().hands.some((value) => value > 0);
  if (clickedValue === 0 && !canUseZeroForSplit) {
    addLog("That hand is down.");
    return;
  }

  if (!game.selected) {
    selectFirstHand(playerIndex, handIndex);
    return;
  }

  const selected = game.selected;
  if (selected.playerIndex !== game.current) {
    clearSelection();
    return;
  }

  if (playerIndex === game.current) {
    if (selected.handIndex === handIndex) {
      clearSelection();
      addLog("Selection cleared.");
      return;
    }
    if (isOneOne(currentPlayer())) {
      transferSplit(selected.handIndex, handIndex);
      return;
    }
    showSplitChoices();
    return;
  }

  attack(selected.handIndex, handIndex);
}

function selectFirstHand(playerIndex, handIndex) {
  if (playerIndex !== game.current) {
    addLog("Choose one of your chopstick fans first.");
    return;
  }

  if (currentPlayer().hands[handIndex] === 0 && (isPowerMode() || currentPlayer().hands[1 - handIndex] === 0)) {
    addLog("No chopsticks left to split.");
    return;
  }

  game.selected = { playerIndex, handIndex };
  hideSplitChoices();
  addLog(`${currentPlayer().name} selected the ${handName(handIndex)} fan.`);
  render();
}

function attack(attackerHand, targetHand) {
  const player = currentPlayer();
  const opponent = opponentPlayer();
  let actualTarget = targetHand;
  if (isPowerMode() && opponent.buffs.redirect && opponent.hands[1 - targetHand] > 0) {
    actualTarget = 1 - targetHand;
    opponent.buffs.redirect = false;
    addLog(`${opponent.name} redirects the attack.`);
  }

  const hits = isPowerMode() && player.buffs.doubleTap ? 2 : 1;
  for (let i = 0; i < hits; i += 1) {
    if (opponent.hands[actualTarget] === 0) break;
    applyHit(player, opponent, attackerHand, actualTarget);
  }

  player.actionUsed = true;
  if (isPowerMode()) {
    player.buffs.precision = false;
    player.buffs.doubleTap = false;
    player.buffs.overload = false;
  }
  game.selected = null;
  hideSplitChoices();

  addLog(`${player.name} attacks ${opponent.name}'s ${handName(actualTarget)} fan to ${opponent.hands[actualTarget]}.`);
  triggerEffect("attack", [
    { playerIndex: game.current, handIndex: attackerHand },
    { playerIndex: opponentIndex(), handIndex: actualTarget },
  ]);
  checkWinner();
  render();
}

function applyHit(player, opponent, attackerHand, targetHand) {
  if (isPowerMode() && opponent.shield) {
    opponent.shield = false;
    addLog(`${opponent.name}'s shield blocks the tap.`);
    return;
  }

  let attackValue = player.hands[attackerHand];
  if (isPowerMode() && player.buffs.precision) attackValue += 1;
  let result = opponent.hands[targetHand] + attackValue;
  const threshold = deathThreshold();
  if (isPowerMode() && player.buffs.overload && result >= threshold) {
    result -= threshold;
    if (result === 0) result = 1;
  } else if (result >= threshold) {
    result = 0;
  }
  opponent.hands[targetHand] = result;
}

function transferSplit(sourceHand, targetHand) {
  const player = currentPlayer();
  const sourceValue = player.hands[sourceHand];
  const targetValue = player.hands[targetHand];
  const result = sourceValue + targetValue;
  player.hands[sourceHand] = 0;
  player.hands[targetHand] = result >= deathThreshold() ? 0 : result;
  player.actionUsed = true;
  game.selected = null;

  addLog(`${player.name} moves ${sourceValue} from ${handName(sourceHand)} to ${handName(targetHand)}: ${scoreText(player)}.`);
  triggerEffect("split", [
    { playerIndex: game.current, handIndex: sourceHand },
    { playerIndex: game.current, handIndex: targetHand },
  ]);
  checkSelfLoss();
  render();
}

function showSplitChoices() {
  const player = currentPlayer();
  if (isPowerMode() && player.buffs.frozen) {
    addLog("Time Freeze prevents splitting this turn.");
    return;
  }
  const choices = splitChoices(player);
  const choicesEl = document.querySelector("#splitChoices");
  choicesEl.replaceChildren();

  if (choices.length === 0) {
    hideSplitChoices();
    addLog("No legal split is available.");
    return;
  }

  choices.forEach(([left, right]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "split-choice";
    button.textContent = `${left}-${right}`;
    button.addEventListener("click", () => applySplit(left, right));
    choicesEl.append(button);
  });

  choicesEl.hidden = false;
  document.querySelector("#actionHint").textContent = "Choose a split.";
}

function hideSplitChoices() {
  const choicesEl = document.querySelector("#splitChoices");
  if (!choicesEl) return;
  choicesEl.hidden = true;
  choicesEl.replaceChildren();
}

function splitChoices(player) {
  const choices = [];
  const total = player.hands[0] + player.hands[1];
  const maxLive = maxLiveChopsticks();

  for (let left = 0; left <= maxLive; left += 1) {
    const right = total - left;
    if (right < 0 || right > maxLive) continue;
    if (validSplit(player, left, right)) choices.push([left, right]);
  }

  return choices;
}

function applySplit(left, right) {
  const player = currentPlayer();
  if (game.over || player.actionUsed || !validSplit(player, left, right)) return;

  player.hands = [left, right];
  player.actionUsed = true;
  game.selected = null;
  hideSplitChoices();

  addLog(`${player.name} splits to ${left}-${right}.`);
  triggerEffect("split", [
    { playerIndex: game.current, handIndex: 0 },
    { playerIndex: game.current, handIndex: 1 },
  ]);
  render();
}

function validSplit(player, left, right) {
  const maxLive = maxLiveChopsticks();
  if (![left, right].every((value) => Number.isInteger(value) && value >= 0 && value <= maxLive)) {
    return false;
  }
  if (left + right !== player.hands[0] + player.hands[1]) return false;
  if (left === player.hands[0] && right === player.hands[1]) return false;
  if (isPowerMode() && player.hands[0] === 0 && left > 0) return false;
  if (isPowerMode() && player.hands[1] === 0 && right > 0) return false;
  return left + right > 0;
}

function isOneOne(player) {
  return player.hands[0] === 1 && player.hands[1] === 1;
}

function endTurn() {
  if (!game || game.over || !canActiveAccountAct()) return;

  currentPlayer().actionUsed = false;
  if (isPowerMode()) {
    currentPlayer().powerUsed = false;
  }
  game.current = opponentIndex();
  game.selected = null;
  hideSplitChoices();
  startPowerTurn(currentPlayer());
  markMissingCurrentTurnPlayerAbsent();

  addLog(`${currentPlayer().name}'s turn.`);
  render();
}

function checkWinner() {
  const opponent = opponentPlayer();
  if (opponent.hands.every((value) => value === 0)) {
    game.over = true;
    showGameOver(game.current, opponentIndex());
  }
}

function checkSelfLoss() {
  const player = currentPlayer();
  if (player.hands.every((value) => value === 0)) {
    game.over = true;
    showGameOver(opponentIndex(), game.current);
  }
}

async function showGameOver(winnerIndex, loserIndex) {
  const winner = game.players[winnerIndex];
  const loser = game.players[loserIndex];
  await awardMatchRewardsAsync(winnerIndex, loserIndex);
  if (game.submode === "Separate Devices" && game.lobbyId) {
    updateLobby(game.lobbyId, (lobby) => ({ ...lobby, status: "complete", activeGame: false, absentPlayers: {}, gameState: null }));
  }
  const activeIndex = activePlayerIndex();
  const showLose = game.submode === "Separate Devices" && activeIndex === loserIndex;
  const avatarName = showLose ? loser.name : winner.name;
  const character = getCharacterForUsername(avatarName);
  const dialog = document.querySelector("#gameOverDialog");
  dialog.classList.toggle("lose", showLose);
  dialog.classList.toggle("win", !showLose);
  document.querySelector("#gameOverAvatar").innerHTML = characterMarkup(character, showLose ? "result-avatar sad" : "result-avatar");
  document.querySelector("#winnerTitle").textContent = showLose ? "You lost" : `${winner.name} wins`;
  const viewedReward = game.submode === "Separate Devices" ? rewardForUsername(avatarName) : null;
  const streakText = !showLose ? winStreakText(winner.name) : "";
  document.querySelector("#winnerText").innerHTML = `${showLose
    ? `${escapeHtml(winner.name)} knocked both of your chopsticks down.`
    : `${escapeHtml(loser.name)}'s chopsticks are both down.`}${streakText ? ` ${escapeHtml(streakText)}` : ""}`;
  renderRewardPanel(viewedReward);
  document.querySelector("#returnToLobby").hidden = game.submode === "Pass and Play";
  playEndGameSounds(showLose ? "lose" : "win");
  dialog.showModal();
  animateRewardPanel(viewedReward);
}

function clearSelection() {
  game.selected = null;
  hideSplitChoices();
  render();
}

function render() {
  if (!game) return;
  const player = currentPlayer();
  document.querySelector("#gameModeLabel").textContent = game.mode;
  document.querySelector(".turn-card small").textContent = game.submode;
  document.querySelector("#turnLabel").textContent = `${player.name}'s turn`;
  document.querySelector("#phaseLabel").textContent = !canActiveAccountAct() ? "Waiting" : player.actionUsed ? "End turn" : "Tap a fan";
  const hintBox = document.querySelector(".play-orb");
  const showHints = getSettings().showHints;
  hintBox.hidden = !showHints;
  document.querySelector("#actionHint").textContent = showHints ? actionHint() : "";
  document.querySelector(".center-panel").classList.toggle("hints-off", !showHints);
  document.querySelector("#endTurn").disabled = game.over || !player.actionUsed || !canActiveAccountAct();

  renderPlayer(0, document.querySelector("#player1Zone"), document.querySelector("#p1Hands"), document.querySelector("#p1Status"));
  renderPlayer(1, document.querySelector("#player2Zone"), document.querySelector("#p2Hands"), document.querySelector("#p2Status"));
  renderPowerPanel();
  renderLog();
  updateForfeitTimer();
  syncActiveGameStateSoon();
}

function actionHint() {
  if (game.over) return "Game over.";
  if (!canActiveAccountAct()) return "Waiting for the other player.";
  if (currentPlayer().actionUsed) return "Pass the device and end your turn.";
  if (!game.selected) return "Tap one of your chopstick fans.";
  return "Tap an opponent fan to attack, or your other fan to split.";
}

function renderPlayer(index, zone, handsEl, statusEl) {
  const player = game.players[index];
  const fixedSeat = game.submode === "Separate Devices";
  const isCurrent = index === game.current;
  const activeUser = getActiveUsername();
  const activeIndex = game.players.findIndex((candidate) => candidate.name === activeUser);
  const bottomPlayerIndex = fixedSeat && activeIndex !== -1 ? activeIndex : game.localPlayer;
  const isLocalPlayer = fixedSeat && index === bottomPlayerIndex;
  zone.classList.toggle("current-turn", isCurrent);
  zone.dataset.seat = fixedSeat ? (isLocalPlayer ? "current" : "opponent") : (isCurrent ? "current" : "opponent");
  zone.style.setProperty("--mobile-order", fixedSeat ? (isLocalPlayer ? "3" : "1") : (isCurrent ? "3" : "1"));
  const isHost = game.submode === "Separate Devices" && game.players[0].name === player.name;
  const eyebrow = zone.querySelector(".player-header .eyebrow");
  const title = zone.querySelector("h2");
  eyebrow.innerHTML = `${isHost ? '<span class="host-crown" aria-label="Host"></span>' : ""}${player.name}`;
  title.innerHTML = `
    <button class="battle-profile-button" type="button">
      ${characterMarkup(getPlayerCharacter(index), "battle-avatar")}
      <span>${player.name}</span>
    </button>
  `;
  title.querySelector(".battle-profile-button").addEventListener("click", () => openPublicProfile(player.name));
  eyebrow.onclick = () => openPublicProfile(player.name);
  handsEl.replaceChildren();

  player.hands.forEach((value, handIndex) => {
    const button = document.createElement("button");
    const selected = game.selected && game.selected.playerIndex === index && game.selected.handIndex === handIndex;
    const effectClass = getEffectClass(index, handIndex);
    button.type = "button";
    button.className = "hand-button";
    button.dataset.hand = handName(handIndex);
    button.classList.toggle("dead", value === 0);
    button.classList.toggle("selected", Boolean(selected));
    if (effectClass) button.classList.add(effectClass);
    button.disabled = game.over || currentPlayer().actionUsed || !canActiveAccountAct();
    button.setAttribute("aria-label", `${player.name} ${handName(handIndex)} hand, ${value} chopsticks`);
    button.innerHTML = `
      <span class="fan">${makeChopsticks(value)}</span>
      <span class="hand-value">${value}</span>
    `;
    button.addEventListener("click", () => handleHandClick(index, handIndex));
    handsEl.append(button);
  });

  statusEl.textContent = player.hands.every((value) => value === 0) ? "Both down" : isPowerMode() ? `${scoreText(player)} | E${player.energy}` : scoreText(player);
}

function startPowerTurn(player, shouldDraw = true) {
  if (!isPowerMode()) return;
  player.powerUsed = false;
  player.buffs.precision = false;
  player.buffs.doubleTap = false;
  player.buffs.overload = false;
  const gain = Math.max(0, 1 + player.buffs.energyUpNext - player.buffs.energyDownNext);
  player.buffs.energyUpNext = 0;
  player.buffs.energyDownNext = 0;
  player.energy = Math.min(7, player.energy + gain);
  if (shouldDraw) drawCards(player, 1);
  player.buffs.frozen = false;
}

function drawCards(player, count) {
  for (let i = 0; i < count; i += 1) {
    if (player.cardHand.length >= 7) return;
    if (player.deck.length === 0) {
      player.deck = shuffle(player.graveyard);
      player.graveyard = [];
    }
    if (player.deck.length === 0) return;
    player.cardHand.push(player.deck.pop());
  }
}

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function renderPowerPanel() {
  const panel = document.querySelector("#powerPanel");
  if (!isPowerMode() || !canActiveAccountAct()) {
    panel.hidden = true;
    return;
  }

  const player = currentPlayer();
  panel.hidden = false;
  document.querySelector("#energyRow").textContent = `Energy ${player.energy}/7`;
  document.querySelector("#deckLine").textContent = `Deck ${player.deck.length} | Graveyard ${player.graveyard.length}`;
  const cardsEl = document.querySelector("#powerCards");
  cardsEl.replaceChildren();
  player.cardHand.forEach((cardId, index) => {
    const card = powerCards[cardId];
    const button = document.createElement("button");
    const unavailable = player.energy < card.cost || player.powerUsed || (cardId === "revive" && player.buffs.reviveUsed);
    button.type = "button";
    button.className = `power-card mini ${card.color}`;
    button.classList.toggle("unavailable", unavailable);
    button.setAttribute("aria-disabled", unavailable ? "true" : "false");
    button.title = `${card.name} (${card.cost} Energy): ${card.text}`;
    button.innerHTML = `<strong>${card.name}</strong><span>${card.cost}E</span><em class="card-tooltip">${card.name} | ${card.cost} Energy<br>${card.text}</em>`;
    button.addEventListener("click", () => openCardDetail(index));
    cardsEl.append(button);
  });
}

function openCardDetail(index) {
  if (!canActiveAccountAct()) return;
  pendingCardIndex = index;
  const cardId = currentPlayer().cardHand[index];
  const card = powerCards[cardId];
  const largeCard = document.querySelector("#largeCard");
  largeCard.className = `large-card ${card.color}`;
  largeCard.innerHTML = `<p class="eyebrow">${card.cost} Energy</p><h2>${card.name}</h2><p>${card.text}</p>`;
  document.querySelector("#playCardButton").disabled = currentPlayer().energy < card.cost || currentPlayer().powerUsed;
  document.querySelector("#cardDetailDialog").showModal();
}

function playPendingCard() {
  if (pendingCardIndex === null || !isPowerMode() || !canActiveAccountAct()) return;
  const player = currentPlayer();
  const cardId = player.cardHand[pendingCardIndex];
  if (!cardId || player.powerUsed) return;
  const card = powerCards[cardId];
  if (player.energy < card.cost) return;

  if (cardId === "rebalance") {
    showRebalanceChoices();
    return;
  }
  if (!applyPowerCard(cardId)) return;
  finishPowerCardUse(cardId);
  playMenuSound();
  render();
}

function finishPowerCardUse(cardId) {
  const player = currentPlayer();
  const card = powerCards[cardId];
  player.energy -= card.cost;
  player.powerUsed = true;
  player.graveyard.push(cardId);
  player.cardHand.splice(pendingCardIndex, 1);
  pendingCardIndex = null;
}

function applyPowerCard(cardId) {
  const player = currentPlayer();
  const opponent = opponentPlayer();
  if (cardId === "energyUp") player.buffs.energyUpNext += 1;
  if (cardId === "energyDown") opponent.buffs.energyDownNext += 1;
  if (cardId === "shield") player.shield = true;
  if (cardId === "precisionStrike") player.buffs.precision = true;
  if (cardId === "timeFreeze") opponent.buffs.frozen = true;
  if (cardId === "redirect") player.buffs.redirect = true;
  if (cardId === "doubleTap") player.buffs.doubleTap = true;
  if (cardId === "overload") player.buffs.overload = true;
  if (cardId === "revive") {
    const index = player.hands.findIndex((value) => value === 0);
    if (index === -1 || player.buffs.reviveUsed) {
      addLog("No dead hand to revive.");
      return false;
    }
    player.hands[index] = 1;
    player.buffs.reviveUsed = true;
  }
  addLog(`${player.name} plays ${powerCards[cardId].name}.`);
  return true;
}

function showRebalanceChoices() {
  const player = currentPlayer();
  const choices = splitChoices(player);
  const choicesEl = document.querySelector("#splitChoices");
  choicesEl.replaceChildren();
  if (choices.length === 0) {
    hideSplitChoices();
    addLog("No legal rebalance available.");
    return;
  }
  choices.forEach(([left, right]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "split-choice";
    button.textContent = `${left}-${right}`;
    button.addEventListener("click", () => applyRebalanceChoice(left, right));
    choicesEl.append(button);
  });
  choicesEl.hidden = false;
  document.querySelector("#actionHint").textContent = "Choose a rebalance.";
}

function applyRebalanceChoice(left, right) {
  if (pendingCardIndex === null || !isPowerMode() || !canActiveAccountAct()) return;
  const player = currentPlayer();
  const cardId = player.cardHand[pendingCardIndex];
  if (cardId !== "rebalance" || player.powerUsed || player.energy < powerCards.rebalance.cost || !validSplit(player, left, right)) return;
  player.hands = [left, right];
  finishPowerCardUse(cardId);
  hideSplitChoices();
  addLog(`${player.name} plays ${powerCards[cardId].name}.`);
  playMenuSound();
  render();
}

function triggerEffect(type, hands) {
  const settings = getSettings();
  pendingEffect = settings.reduceMotion ? null : { type, hands };
  playSound(type);
  window.setTimeout(() => {
    pendingEffect = null;
    if (game) render();
  }, type === "attack" ? 360 : 420);
}

function getEffectClass(playerIndex, handIndex) {
  if (!pendingEffect) return "";
  const active = pendingEffect.hands.some((hand) => hand.playerIndex === playerIndex && hand.handIndex === handIndex);
  if (!active) return "";
  return pendingEffect.type === "attack" ? "clank-effect" : "split-effect";
}

function getAudioContext() {
  if (!audioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    audioContext = new AudioContextClass();
  }
  return audioContext;
}

function playSound(type) {
  const settings = getSettings();
  const volume = Math.max(0, Math.min(1, settings.sfxVolume / 100));
  if (volume === 0) return;

  const context = getAudioContext();
  if (!context) return;
  if (context.state === "suspended") context.resume();

  if (type === "attack") {
    playTone(context, 920, 0, 0.05, volume * 0.18, "triangle");
    playTone(context, 1320, 0.055, 0.07, volume * 0.12, "sine");
    return;
  }

  if (type === "menu") {
    playTone(context, 620, 0, 0.035, volume * 0.08, "triangle");
    playTone(context, 840, 0.035, 0.045, volume * 0.07, "sine");
    return;
  }

  if (type === "endTurn") {
    playTone(context, 440, 0, 0.055, volume * 0.11, "triangle");
    playTone(context, 360, 0.055, 0.06, volume * 0.08, "sine");
    return;
  }

  if (type === "bossDeath") {
    playVoice(context, {
      startFrequency: 260,
      endFrequency: 150,
      duration: 0.58,
      volume: volume * 0.22,
      vowel: "aww",
      delay: 0,
    });
    return;
  }

  if (type === "victory") {
    playVoice(context, {
      startFrequency: 520,
      endFrequency: 820,
      duration: 0.18,
      volume: volume * 0.18,
      vowel: "ya",
      delay: 0.32,
    });
    playVoice(context, {
      startFrequency: 760,
      endFrequency: 940,
      duration: 0.26,
      volume: volume * 0.2,
      vowel: "yay",
      delay: 0.48,
    });
    return;
  }

  if (type === "trumpetVictory") {
    playTone(context, 523, 0, 0.12, volume * 0.16, "sawtooth");
    playTone(context, 659, 0.13, 0.12, volume * 0.16, "sawtooth");
    playTone(context, 784, 0.26, 0.18, volume * 0.18, "sawtooth");
    playTone(context, 1046, 0.46, 0.22, volume * 0.14, "triangle");
    return;
  }

  if (type === "levelUp") {
    playTone(context, 659, 0, 0.08, volume * 0.13, "triangle");
    playTone(context, 784, 0.08, 0.09, volume * 0.14, "triangle");
    playTone(context, 988, 0.17, 0.12, volume * 0.15, "triangle");
    playTone(context, 1319, 0.31, 0.18, volume * 0.12, "sine");
    return;
  }

  if (type === "sadLose") {
    playVoice(context, {
      startFrequency: 300,
      endFrequency: 145,
      duration: 0.62,
      volume: volume * 0.22,
      vowel: "aww",
      delay: 0,
    });
    [0.72, 0.9, 1.08].forEach((delay, index) => {
      playTone(context, 520 + index * 40, delay, 0.045, volume * 0.09, "triangle");
      playTone(context, 180, delay + 0.025, 0.035, volume * 0.06, "sine");
    });
    return;
  }

  playTone(context, 220, 0, 0.08, volume * 0.16, "sine");
  playTone(context, 340, 0.045, 0.09, volume * 0.09, "triangle");
}

function playEndGameSounds(result) {
  playSound(result === "lose" ? "sadLose" : "trumpetVictory");
}

function playTone(context, frequency, delay, duration, volume, type) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const start = context.currentTime + delay;
  const end = start + duration;
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, end);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(start);
  oscillator.stop(end + 0.02);
}

function playVoice(context, options) {
  const start = context.currentTime + options.delay;
  const end = start + options.duration;
  const fundamental = context.createOscillator();
  const harmonic = context.createOscillator();
  const nasal = context.createOscillator();
  const gain = context.createGain();
  const filter = context.createBiquadFilter();
  const filterTwo = context.createBiquadFilter();

  const vowel = voiceVowel(options.vowel);
  fundamental.type = "sine";
  harmonic.type = "triangle";
  nasal.type = "sine";
  fundamental.frequency.setValueAtTime(options.startFrequency, start);
  fundamental.frequency.exponentialRampToValueAtTime(options.endFrequency, end);
  harmonic.frequency.setValueAtTime(options.startFrequency * 2.02, start);
  harmonic.frequency.exponentialRampToValueAtTime(options.endFrequency * 2.02, end);
  nasal.frequency.setValueAtTime(options.startFrequency * 3.01, start);
  nasal.frequency.exponentialRampToValueAtTime(options.endFrequency * 3.01, end);

  filter.type = "bandpass";
  filter.frequency.setValueAtTime(vowel.low, start);
  filter.Q.setValueAtTime(vowel.lowQ, start);
  filterTwo.type = "bandpass";
  filterTwo.frequency.setValueAtTime(vowel.high, start);
  filterTwo.Q.setValueAtTime(vowel.highQ, start);

  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, options.volume), start + 0.035);
  gain.gain.setValueAtTime(Math.max(0.0001, options.volume * 0.8), end - 0.06);
  gain.gain.exponentialRampToValueAtTime(0.0001, end);

  fundamental.connect(filter);
  harmonic.connect(filter);
  nasal.connect(filterTwo);
  filter.connect(gain);
  filterTwo.connect(gain);
  gain.connect(context.destination);

  [fundamental, harmonic, nasal].forEach((oscillator) => {
    oscillator.start(start);
    oscillator.stop(end + 0.03);
  });
}

function voiceVowel(vowel) {
  if (vowel === "aww") {
    return { low: 650, high: 1080, lowQ: 5, highQ: 3 };
  }
  if (vowel === "ya") {
    return { low: 850, high: 2200, lowQ: 6, highQ: 4 };
  }
  return { low: 980, high: 2600, lowQ: 7, highQ: 5 };
}

function makeChopsticks(value) {
  if (value === 0) return "";

  let html = "";
  const spread = value === 1 ? [0] : Array.from({ length: value }, (_, i) => -18 + (36 / (value - 1)) * i);
  spread.forEach((angle, index) => {
    const lift = (index - (value - 1) / 2) * 2;
    html += `<span class="stick" style="transform: translateY(${lift}px) rotate(${angle}deg)"></span>`;
  });
  return html;
}

function scoreText(player) {
  return `${player.hands[0]}-${player.hands[1]}`;
}

function handName(index) {
  return index === 0 ? "left" : "right";
}

function addLog(message) {
  if (!game) return;
  game.log.unshift(message);
  game.log = game.log.slice(0, 12);
  renderLog();
}

function renderLog() {
  const logEl = document.querySelector("#messageLog");
  if (!logEl || !game) return;
  const expanded = logEl.classList && logEl.classList.contains("expanded");
  logEl.replaceChildren();
  if (expanded) {
    const shrink = document.createElement("button");
    shrink.type = "button";
    shrink.className = "shrink-log";
    shrink.textContent = "Shrink";
    shrink.addEventListener("click", (event) => {
      event.stopPropagation();
      logEl.classList.remove("expanded");
      renderLog();
    });
    logEl.append(shrink);
  }
  const limit = expanded ? 12 : 3;
  game.log.slice(0, limit).forEach((message) => {
    const line = document.createElement("p");
    line.textContent = message;
    logEl.append(line);
  });
}

function getSaves() {
  if (firebaseUser) return firebaseSaves;
  return readAccountJson(SAVE_KEY, []);
}

function setSaves(saves) {
  const nextSaves = saves.slice(0, MAX_SAVES);
  if (firebaseUser) {
    firebaseSaves = nextSaves;
    nextSaves.forEach((save) => {
      writeFirebaseSave(firebaseUser.uid, save).catch((error) => console.warn("Unable to sync save", error));
    });
    return;
  }
  writeAccountJson(SAVE_KEY, nextSaves);
}

function makeSave(name, id) {
  if (game && game.submode !== "Pass and Play") return null;
  const saveId = id || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
  const gameCopy = JSON.parse(JSON.stringify(game));
  gameCopy.saveId = saveId;
  return {
    id: saveId,
    name,
    savedAt: new Date().toISOString(),
    game: gameCopy,
  };
}

function saveGameWithName(name, overwriteId) {
  if (!game || game.submode !== "Pass and Play") return false;
  const saves = getSaves();
  const save = makeSave(name || defaultSaveName(saves.length), overwriteId);
  if (!save) return false;
  if (overwriteId) {
    const index = saves.findIndex((candidate) => candidate.id === overwriteId);
    if (index !== -1) saves[index] = { ...save, id: overwriteId };
  } else {
    saves.unshift(save);
  }
  if (game) game.saveId = save.id;
  setSaves(saves);
  return true;
}

function defaultSaveName(index) {
  return `Save ${Math.min(index + 1, MAX_SAVES)}`;
}

function requestReturnToMenu() {
  document.querySelector("#gameMenuDropdown").hidden = true;
  if (!game || game.over) {
    game = null;
    showScreen("mainMenuScreen");
    return;
  }
  if (game.submode !== "Pass and Play") {
    document.querySelector("#saveNameFields").hidden = true;
    document.querySelector("#leaveWithoutSave").hidden = false;
    document.querySelector("#leaveWithoutSave").textContent = "Leave Game";
    document.querySelector("#saveAndLeave").hidden = true;
    document.querySelector("#savePromptDialog p").textContent = "Returning to the menu will start a 30 second return timer. If it reaches 0 while it is your turn, it counts as a forfeit loss.";
    document.querySelector("#savePromptDialog").showModal();
    return;
  }
  const saves = getSaves();
  const existingSave = getCurrentSave(saves);
  document.querySelector("#saveNameFields").hidden = true;
  document.querySelector("#leaveWithoutSave").hidden = false;
  document.querySelector("#leaveWithoutSave").textContent = "Leave Without Saving";
  document.querySelector("#saveAndLeave").hidden = false;
  document.querySelector("#savePromptDialog p").textContent = "Leave this match or save it for later?";
  document.querySelector("#saveNameInput").value = existingSave ? existingSave.name : defaultSaveName(saves.length);
  document.querySelector("#savePromptDialog").showModal();
}

function saveAndReturn() {
  pendingSaveName = document.querySelector("#saveNameInput").value.trim();
  const saves = getSaves();
  const existingSave = getCurrentSave(saves);
  if (existingSave) {
    document.querySelector("#savePromptDialog").close();
    document.querySelector("#existingSaveText").textContent = `"${existingSave.name}" already exists. Overwrite it or create a new save file?`;
    document.querySelector("#existingSaveDialog").showModal();
    return;
  }
  createNewSaveAndReturn();
}

function createNewSaveAndReturn() {
  const saves = getSaves();
  if (saves.length >= MAX_SAVES) {
    overwriteBackTarget = getCurrentSave() ? "existingSave" : "saveName";
    renderOverwriteList();
    document.querySelector("#overwriteDialog").showModal();
    return;
  }
  saveGameWithName(pendingSaveName);
  game = null;
  showScreen("mainMenuScreen");
}

function overwriteCurrentSaveAndReturn() {
  const existingSave = getCurrentSave();
  if (!existingSave) {
    createNewSaveAndReturn();
    return;
  }
  saveGameWithName(pendingSaveName || existingSave.name, existingSave.id);
  game = null;
  showScreen("mainMenuScreen");
}

function getCurrentSave(saves = getSaves()) {
  if (!game || !game.saveId) return null;
  return saves.find((candidate) => candidate.id === game.saveId) || null;
}

function showSaveNameStep() {
  if (!game || game.submode !== "Pass and Play") return;
  const dialog = document.querySelector("#savePromptDialog");
  document.querySelector("#saveNameFields").hidden = false;
  document.querySelector("#leaveWithoutSave").hidden = true;
  if (!dialog.open) dialog.showModal();
  document.querySelector("#saveNameInput").focus();
}

function renderSaveList() {
  const list = document.querySelector("#saveList");
  const saves = getSaves();
  list.replaceChildren();
  if (saves.length === 0) {
    const empty = document.createElement("p");
    empty.textContent = "No saved games yet.";
    list.append(empty);
    return;
  }
  saves.forEach((save) => {
    const row = document.createElement("div");
    row.className = "save-slot";
    row.innerHTML = `
      <div class="save-info">
        <strong>${save.name}</strong>
        <span>${save.game && save.game.mode ? save.game.mode : "Standard Mode"} | ${save.game && save.game.submode ? save.game.submode : "Pass and Play"}</span>
        <span>${formatDate(save.savedAt)}</span>
      </div>
      <div class="save-actions">
        <button type="button" data-action="load">Load</button>
        <button type="button" data-action="rename">Rename</button>
        <button type="button" data-action="delete">Delete</button>
      </div>
    `;
    row.querySelector('[data-action="load"]').addEventListener("click", playMenuSound);
    row.querySelector('[data-action="load"]').addEventListener("click", () => loadSave(save.id));
    row.querySelector('[data-action="rename"]').addEventListener("click", playMenuSound);
    row.querySelector('[data-action="rename"]').addEventListener("click", () => promptRenameSave(save.id));
    row.querySelector('[data-action="delete"]').addEventListener("click", playMenuSound);
    row.querySelector('[data-action="delete"]').addEventListener("click", () => deleteSave(save.id));
    list.append(row);
  });
}

function renderOverwriteList() {
  const list = document.querySelector("#overwriteList");
  list.replaceChildren();
  getSaves().forEach((save) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "save-slot";
    row.innerHTML = `<strong>${save.name}</strong><span>${formatDate(save.savedAt)}</span>`;
    row.addEventListener("click", () => {
      playMenuSound();
      saveGameWithName(pendingSaveName, save.id);
      document.querySelector("#overwriteDialog").close();
      game = null;
      showScreen("mainMenuScreen");
    });
    list.append(row);
  });
}

function loadSave(id) {
  const save = getSaves().find((candidate) => candidate.id === id);
  if (!save) return;
  game = save.game;
  game.saveId = save.id;
  game.selected = null;
  hideSplitChoices();
  showScreen("gameScreen");
  render();
}

function promptRenameSave(id) {
  const save = getSaves().find((candidate) => candidate.id === id);
  if (!save) return;
  pendingRenameId = id;
  document.querySelector("#renameSaveInput").value = save.name;
  document.querySelector("#renameSaveDialog").showModal();
}

function renameSave(id, name) {
  const saves = getSaves();
  const save = saves.find((candidate) => candidate.id === id);
  if (!save) return;
  save.name = name || save.name;
  save.savedAt = new Date().toISOString();
  setSaves(saves);
  renderSaveList();
}

function deleteSave(id) {
  const save = getSaves().find((candidate) => candidate.id === id);
  if (!save) return;
  if (!window.confirm(`Delete "${save.name}"?`)) return;
  if (firebaseUser) {
    deleteFirebaseSave(firebaseUser.uid, id).catch((error) => console.warn("Unable to delete save", error));
  }
  setSaves(getSaves().filter((candidate) => candidate.id !== id));
  renderSaveList();
}

function formatDate(value) {
  return new Date(value).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function getSettings() {
  return { ...defaultSettings, ...readAccountJson(SETTINGS_KEY, {}) };
}

function setSettings(settings) {
  writeAccountJson(SETTINGS_KEY, settings);
  document.body.classList.toggle("reduce-motion", settings.reduceMotion);
}

function renderSettings() {
  const settings = getSettings();
  document.querySelector("#musicVolume").value = settings.musicVolume;
  document.querySelector("#sfxVolume").value = settings.sfxVolume;
  document.querySelector("#reduceMotion").checked = settings.reduceMotion;
  document.querySelector("#showHints").checked = settings.showHints;
  document.body.classList.toggle("reduce-motion", settings.reduceMotion);
}

function updateSetting(key, value) {
  const settings = getSettings();
  settings[key] = value;
  setSettings(settings);
  if (game) render();
}

function readJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) || fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(key, JSON.stringify(value));
  }
}

function accountKey(baseKey, username = getActiveUsername()) {
  return `${baseKey}.${username || "guest"}`;
}

function readAccountJson(baseKey, fallback, username) {
  return readJson(accountKey(baseKey, username), fallback);
}

function writeAccountJson(baseKey, value, username) {
  writeJson(accountKey(baseKey, username), value);
}

function removeStorageKey(key) {
  if (typeof localStorage !== "undefined" && localStorage.removeItem) {
    localStorage.removeItem(key);
  }
}

function coinIconMarkup() {
  return '<span class="coin-icon" aria-label="coin">🪙</span>';
}

function coinAmountMarkup(amount) {
  return `${amount} ${coinIconMarkup()}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}

function levelRequirement(level) {
  return Math.max(1, level) * 100;
}

function defaultEconomy(overrides = {}) {
  return {
    level: 1,
    experience: 0,
    coins: 0,
    winStreak: 0,
    totalWins: 0,
    totalLosses: 0,
    ...overrides,
  };
}

function normalizeEconomy(profile = {}) {
  return defaultEconomy({
    level: Number.isFinite(profile.level) ? Math.max(1, Math.floor(profile.level)) : 1,
    experience: Number.isFinite(profile.experience) ? Math.max(0, Math.floor(profile.experience)) : 0,
    coins: Number.isFinite(profile.coins) ? Math.max(0, Math.floor(profile.coins)) : 0,
    winStreak: Number.isFinite(profile.winStreak) ? Math.max(0, Math.floor(profile.winStreak)) : 0,
    totalWins: Number.isFinite(profile.totalWins) ? Math.max(0, Math.floor(profile.totalWins)) : 0,
    totalLosses: Number.isFinite(profile.totalLosses) ? Math.max(0, Math.floor(profile.totalLosses)) : 0,
  });
}

function profileWithEconomy(profile, overrides = {}) {
  return { ...profile, ...defaultEconomy(normalizeEconomy(profile)), ...overrides };
}

function addExperience(profile, amount) {
  const next = profileWithEconomy(profile);
  next.experience += Math.max(0, Math.floor(amount));
  while (next.experience >= levelRequirement(next.level)) {
    next.experience -= levelRequirement(next.level);
    next.level += 1;
  }
  return next;
}

function streakBonusRate(streak) {
  if (streak < 3) return 0;
  return Math.min(0.5, 0.2 + ((streak - 3) * 0.1));
}

function applyRewardToProfile(username, didWin) {
  if (!username) return null;
  const existing = getProfile(username) || {
    username,
    phone: `mock-${username}`,
    tag: profileTag(username) || generateTag(),
    verified: true,
  };
  const current = profileWithEconomy(existing);
  const before = {
    level: current.level,
    experience: current.experience,
    coins: current.coins,
    next: levelRequirement(current.level),
  };
  const nextStreak = didWin ? current.winStreak + 1 : 0;
  const bonusRate = didWin ? streakBonusRate(nextStreak) : 0;
  const xp = Math.round((didWin ? WIN_XP : LOSS_XP) * (1 + bonusRate));
  const coins = didWin ? Math.round(WIN_COINS * (1 + bonusRate)) : 0;
  const updated = addExperience({
    ...current,
    coins: current.coins + coins,
    winStreak: nextStreak,
    totalWins: current.totalWins + (didWin ? 1 : 0),
    totalLosses: current.totalLosses + (didWin ? 0 : 1),
  }, xp);
  setProfile(updated, username);
  upsertMockUserFromProfile(updated);
  return {
    username,
    didWin,
    xp,
    coins,
    winStreak: updated.winStreak,
    level: updated.level,
    before,
    after: {
      level: updated.level,
      experience: updated.experience,
      coins: updated.coins,
      next: levelRequirement(updated.level),
    },
  };
}

async function applyRewardToFirebaseProfile(username, didWin) {
  if (!firebaseUser || username !== getActiveUsername()) return applyRewardToProfile(username, didWin);
  const result = await updateUserProfileTransaction(firebaseUser.uid, (remoteProfile) => {
    const current = profileWithEconomy(localProfileFromFirebaseData(remoteProfile, {
      fallbackUsername: username,
      fallbackEmail: firebaseUser.email || "",
    }));
    const before = {
      level: current.level,
      experience: current.experience,
      coins: current.coins,
      next: levelRequirement(current.level),
    };
    const nextStreak = didWin ? current.winStreak + 1 : 0;
    const bonusRate = didWin ? streakBonusRate(nextStreak) : 0;
    const xp = Math.round((didWin ? WIN_XP : LOSS_XP) * (1 + bonusRate));
    const coins = didWin ? Math.round(WIN_COINS * (1 + bonusRate)) : 0;
    const updated = addExperience({
      ...current,
      coins: current.coins + coins,
      winStreak: nextStreak,
      totalWins: current.totalWins + (didWin ? 1 : 0),
      totalLosses: current.totalLosses + (didWin ? 0 : 1),
    }, xp);
    return {
      write: firebaseDocumentFromLocalProfile(updated),
      result: {
        username,
        didWin,
        xp,
        coins,
        winStreak: updated.winStreak,
        level: updated.level,
        before,
        after: {
          level: updated.level,
          experience: updated.experience,
          coins: updated.coins,
          next: levelRequirement(updated.level),
        },
      },
    };
  });
  firebaseProfile = profileWithEconomy(getProfile(username) || { username }, {
    level: result.after.level,
    experience: result.after.experience,
    coins: result.after.coins,
    winStreak: result.winStreak,
    totalWins: normalizeEconomy(getProfile(username) || {}).totalWins + (result.didWin ? 1 : 0),
    totalLosses: normalizeEconomy(getProfile(username) || {}).totalLosses + (result.didWin ? 0 : 1),
  });
  writeAccountJson(PROFILE_KEY, firebaseProfile, username);
  return result;
}

function awardMatchRewards(winnerIndex, loserIndex) {
  if (!game || game.submode === "Pass and Play" || game.rewardSummary) return null;
  const winnerName = game.players[winnerIndex].name;
  const loserName = game.players[loserIndex].name;
  const rewards = [
    applyRewardToProfile(winnerName, true),
    applyRewardToProfile(loserName, false),
  ].filter(Boolean);
  game.rewardSummary = rewards;
  return rewards;
}

async function awardMatchRewardsAsync(winnerIndex, loserIndex) {
  if (!game || game.submode === "Pass and Play" || game.rewardSummary) return null;
  const winnerName = game.players[winnerIndex].name;
  const loserName = game.players[loserIndex].name;
  const rewards = [
    await applyRewardToFirebaseProfile(winnerName, true),
    await applyRewardToFirebaseProfile(loserName, false),
  ].filter(Boolean);
  game.rewardSummary = rewards;
  return rewards;
}

function rewardForUsername(username) {
  return game && Array.isArray(game.rewardSummary)
    ? game.rewardSummary.find((reward) => reward.username === username)
    : null;
}

function xpPercent(exp, level) {
  return Math.min(100, (exp / levelRequirement(level)) * 100);
}

function renderRewardPanel(reward) {
  const panel = document.querySelector("#rewardPanel");
  if (!reward) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  panel.classList.remove("level-up");
  document.querySelector("#rewardXpLabel").textContent = `+${reward.xp} XP`;
  document.querySelector("#rewardLevelLabel").textContent = `Level ${reward.before.level}`;
  document.querySelector("#rewardXpFill").style.width = `${xpPercent(reward.before.experience, reward.before.level)}%`;
  document.querySelector("#rewardXpText").textContent = `${reward.before.experience} / ${levelRequirement(reward.before.level)} XP`;
  document.querySelector("#rewardCoinText").innerHTML = `Total: ${coinAmountMarkup(reward.before.coins)} (+${coinAmountMarkup(reward.coins)})`;
}

function animateRewardPanel(reward) {
  if (!reward) return;
  window.setTimeout(() => {
    animateXpReward(reward);
    animateCoinReward(reward);
  }, 260);
}

function animateXpReward(reward) {
  const panel = document.querySelector("#rewardPanel");
  const fill = document.querySelector("#rewardXpFill");
  const levelLabel = document.querySelector("#rewardLevelLabel");
  const text = document.querySelector("#rewardXpText");
  const segments = xpAnimationSegments(reward.before, reward.after);
  let index = 0;

  const runSegment = () => {
    const segment = segments[index];
    if (!segment) return;
    levelLabel.textContent = `Level ${segment.level}`;
    fill.style.width = `${xpPercent(segment.from, segment.level)}%`;
    text.textContent = `${segment.from} / ${levelRequirement(segment.level)} XP`;
    window.setTimeout(() => {
      fill.style.width = `${xpPercent(segment.to, segment.level)}%`;
      text.textContent = `${segment.to} / ${levelRequirement(segment.level)} XP`;
      window.setTimeout(() => {
        if (segment.levelUp) {
          panel.classList.remove("level-up");
          void panel.offsetWidth;
          panel.classList.add("level-up");
          playSound("levelUp");
          fill.style.width = "0%";
        }
        index += 1;
        runSegment();
      }, 520);
    }, 80);
  };

  runSegment();
}

function xpAnimationSegments(before, after) {
  const segments = [];
  let level = before.level;
  let exp = before.experience;
  while (level < after.level) {
    const next = levelRequirement(level);
    segments.push({ level, from: exp, to: next, levelUp: true });
    level += 1;
    exp = 0;
  }
  segments.push({ level: after.level, from: exp, to: after.experience, levelUp: false });
  return segments;
}

function animateCoinReward(reward) {
  const text = document.querySelector("#rewardCoinText");
  const pile = document.querySelector("#coinPile");
  pile.classList.remove("piling");
  void pile.offsetWidth;
  pile.classList.add("piling");
  const duration = 820;
  const startedAt = performance.now();
  const from = reward.before.coins;
  const to = reward.after.coins;
  const tick = (now) => {
    const progress = Math.min(1, (now - startedAt) / duration);
    const current = Math.round(from + ((to - from) * progress));
    text.innerHTML = `Total: ${coinAmountMarkup(current)} (+${coinAmountMarkup(reward.coins)})`;
    if (progress < 1) window.requestAnimationFrame(tick);
  };
  window.requestAnimationFrame(tick);
}

function winStreakText(username) {
  const profile = getProfile(username);
  const streak = normalizeEconomy(profile || {}).winStreak;
  return streak > 0 ? `${streak} game win streak 🔥` : "";
}

function allKnownUsernames() {
  const names = new Set(getMockUsers().map((user) => user.username).filter(Boolean));
  if (getStoredActiveUsername()) names.add(getStoredActiveUsername());
  if (typeof localStorage !== "undefined") {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith(`${PROFILE_KEY}.`)) names.add(key.slice(PROFILE_KEY.length + 1));
    }
  }
  return [...names];
}

function upsertMockUserFromProfile(profile) {
  if (!profile || !profile.username) return;
  const users = getMockUsers();
  const existing = users.find((user) => user.username === profile.username);
  const nextUser = {
    ...(existing || {}),
    username: profile.username,
    phone: profile.phone || (existing && existing.phone) || `mock-${profile.username}`,
    tag: normalizeTag(profile.tag || (existing && existing.tag) || generateTag()),
  };
  setMockUsers([...users.filter((user) => user.username !== profile.username), nextUser]);
}

function resetProfileProgress(username, options = {}) {
  if (!username) return;
  const existing = getProfile(username) || {
    username,
    phone: `mock-${username}`,
    tag: profileTag(username) || generateTag(),
    verified: true,
  };
  const economy = normalizeEconomy(existing);
  const updated = profileWithEconomy(existing, {
    level: 1,
    experience: 0,
    winStreak: 0,
    totalWins: options.resetRecord ? 0 : economy.totalWins,
    totalLosses: options.resetRecord ? 0 : economy.totalLosses,
    coins: options.resetCoins ? 0 : economy.coins,
  });
  setProfile(updated, username);
  upsertMockUserFromProfile(updated);
}

function resetMockCoins(username) {
  if (!username) return;
  const existing = profileWithEconomy(getProfile(username) || {
    username,
    phone: `mock-${username}`,
    tag: profileTag(username) || generateTag(),
    verified: true,
  });
  const updated = { ...existing, coins: 0 };
  setProfile(updated, username);
  upsertMockUserFromProfile(updated);
}

function runEconomyResetMigration() {
  if (typeof localStorage !== "undefined" && localStorage.getItem(ECONOMY_RESET_KEY) === "true") return;
  allKnownUsernames().forEach((username) => resetProfileProgress(username, { resetCoins: true, resetRecord: true }));
  const humpday = profileWithEconomy(getProfile("humpday") || {
    username: "humpday",
    phone: "mock-humpday",
    tag: profileTag("humpday") || "HUMP",
    verified: true,
  }, { level: 1, experience: 0, coins: 1000, winStreak: 0, totalWins: 0, totalLosses: 0 });
  const g = profileWithEconomy(getProfile("g") || {
    username: "g",
    phone: "mock-g",
    tag: profileTag("g") || "GGGG",
    verified: true,
  }, { level: 1, experience: 0, coins: 100, winStreak: 0, totalWins: 0, totalLosses: 0 });
  setProfile(humpday, "humpday");
  setProfile(g, "g");
  upsertMockUserFromProfile(humpday);
  upsertMockUserFromProfile(g);
  if (typeof localStorage !== "undefined") localStorage.setItem(ECONOMY_RESET_KEY, "true");
}

function resetSleepyPandaMockAccount() {
  if (typeof localStorage === "undefined" || localStorage.getItem(SLEEPY_PANDA_RESET_KEY) === "true") return;
  const username = "sleepy_panda";
  setMockUsers(getMockUsers().filter((user) => user.username !== username));
  [
    PROFILE_KEY,
    SAVE_KEY,
    SETTINGS_KEY,
    CHARACTER_KEY,
    FRIENDS_KEY,
    NOTIFICATIONS_KEY,
  ].forEach((key) => removeStorageKey(accountKey(key, username)));
  if (getStoredActiveUsername() === username) removeStorageKey(ACTIVE_USER_KEY);
  localStorage.setItem(SLEEPY_PANDA_RESET_KEY, "true");
}

function getStoredActiveUsername() {
  try {
    return localStorage.getItem(ACTIVE_USER_KEY) || "";
  } catch {
    return "";
  }
}

function getProfile(username = getStoredActiveUsername()) {
  const scoped = readAccountJson(PROFILE_KEY, null, username);
  if (scoped) return ensureProfileTag(scoped, username);
  const legacy = readJson(PROFILE_KEY, null);
  return legacy && legacy.username === username ? ensureProfileTag(legacy, username) : null;
}

function setProfile(profile, username = getStoredActiveUsername() || (profile && profile.username)) {
  writeAccountJson(PROFILE_KEY, profile, username);
  syncProfileToFirebase(profile);
}

function firebaseProfileDocument(profile) {
  return firebaseDocumentFromLocalProfile({
    ...profile,
    email: profile.email || (firebaseUser && firebaseUser.email) || "",
  });
}

function syncProfileToFirebase(profile) {
  if (!firebaseUser || !profile || !profile.username) return;
  upsertUserProfile(firebaseUser.uid, firebaseProfileDocument(profile)).catch((error) => {
    console.warn("Unable to sync profile to Firebase", error);
  });
}

function clearLocalAccountState(username) {
  if (!username) return;
  [SAVE_KEY, SETTINGS_KEY, FRIENDS_KEY, NOTIFICATIONS_KEY, CHARACTER_KEY, PROFILE_KEY].forEach((baseKey) => {
    removeStorageKey(accountKey(baseKey, username));
  });
  setMockUsers(getMockUsers().filter((user) => user.username !== username));
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem(ACTIVE_USER_KEY);
    localStorage.removeItem(ACTIVE_INVITE_KEY);
    localStorage.removeItem(ACTIVE_INVITE_KEY + ".data");
  }
}

async function deleteSignedInFirebaseAccount() {
  const message = document.querySelector("#deleteAccountMessage");
  if (!firebaseUser) {
    message.textContent = "Sign in before deleting an account.";
    return false;
  }
  const user = firebaseUser;
  const profile = firebaseProfile || getProfile();
  const username = profile && profile.username;
  message.textContent = "Deleting account...";
  try {
    await deleteFirebaseAccount(user, profile || {});
    clearLocalAccountState(username);
    firebaseUser = null;
    firebaseProfile = null;
    stopFirebaseDataListeners();
    stopPresenceHeartbeat();
    clearFirebaseRuntimeData();
    game = null;
    document.querySelector("#deleteAccountDialog").close();
    showScreen("profileScreen");
    document.querySelector("#profileMessage").textContent = "Account deleted.";
    return true;
  } catch (error) {
    console.warn("Unable to delete Firebase account", error);
    message.textContent = authErrorMessage(error);
    return false;
  }
}

function getMockUsers() {
  const users = readJson(MOCK_USERS_KEY, []);
  if (users.length > 0) {
    let changed = false;
    const seen = new Set(users.map((user) => normalizeTag(user.tag || "")).filter(Boolean));
    const tagged = users.map((user) => {
      if (user.tag) return user;
      let tag = generateTag(seen);
      while (seen.has(tag)) tag = generateTag(seen);
      seen.add(tag);
      changed = true;
      return { ...user, tag };
    });
    if (changed) writeJson(MOCK_USERS_KEY, tagged);
    return tagged;
  }
  const seeded = [
    { username: "mochi_bunny", phone: "555-101-2001", tag: "M0CH" },
    { username: "milk_tea_cat", phone: "555-101-2002", tag: "M1LK" },
  ];
  writeJson(MOCK_USERS_KEY, seeded);
  return seeded;
}

function setMockUsers(users) {
  writeJson(MOCK_USERS_KEY, users);
}

function getFriends() {
  if (firebaseUser) return firebaseFriends;
  return readAccountJson(FRIENDS_KEY, []);
}

function setFriends(friends) {
  if (firebaseUser) {
    firebaseFriends = friends;
    return;
  }
  writeAccountJson(FRIENDS_KEY, friends);
}

function getNotifications(username = getActiveUsername()) {
  if (firebaseUser && username === getActiveUsername()) return firebaseNotifications;
  return readAccountJson(NOTIFICATIONS_KEY, [], username);
}

function setNotifications(notifications, username = getActiveUsername()) {
  if (firebaseUser && username === getActiveUsername()) {
    firebaseNotifications = notifications;
    return;
  }
  writeAccountJson(NOTIFICATIONS_KEY, notifications, username);
}

function getActiveUsername() {
  return getStoredActiveUsername();
}

function setActiveUsername(username) {
  const previousUsername = getActiveUsername();
  if (game && !game.over && game.submode === "Separate Devices" && !document.querySelector("#gameScreen").hidden && previousUsername && previousUsername !== username) {
    markGamePlayerLeft(previousUsername);
  }
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(ACTIVE_USER_KEY, username);
  }
  document.body.classList.toggle("reduce-motion", getSettings().reduceMotion);
  renderGlobalMockSwitcher();
  renderNotificationBadge();
  renderSelectedCharacter();
  if (showLobbyClosedPopupIfNeeded()) return;
  if (!getProfile(username)) {
    previousScreen = "mainMenuScreen";
    showScreen("profileScreen");
    return;
  }
  if (!document.querySelector("#waitingLobbyScreen").hidden) renderWaitingLobby();
  if (game && game.submode === "Separate Devices") clearForfeitAbsence(username);
  if (game) render();
}

function localProfileFromFirebase(user, remoteProfile) {
  if (!remoteProfile) return null;
  return localProfileFromFirebaseData(remoteProfile, {
    fallbackUsername: user.displayName || user.email.split("@")[0],
    fallbackEmail: user.email || "",
  });
}

function localProfileFromFirebaseData(remoteProfile, options = {}) {
  const economy = remoteProfile.economy || {};
  return profileWithEconomy({
    username: remoteProfile.username || options.fallbackUsername || "player",
    email: remoteProfile.email || options.fallbackEmail || "",
    phone: remoteProfile.email || options.fallbackEmail || "",
    tag: normalizeTag(remoteProfile.tag || generateTag()),
    verified: true,
    selectedCharacterId: remoteProfile.selectedCharacterId || "honeyBear",
    ownedCharacterIds: Array.isArray(remoteProfile.ownedCharacterIds) && remoteProfile.ownedCharacterIds.length
      ? remoteProfile.ownedCharacterIds
      : ["honeyBear"],
    level: economy.level,
    experience: economy.experience,
    coins: economy.coins,
    winStreak: economy.winStreak,
    totalWins: economy.totalWins,
    totalLosses: economy.totalLosses,
  });
}

function firebaseDocumentFromLocalProfile(profile) {
  const economy = normalizeEconomy(profile || {});
  return {
    username: profile.username,
    tag: normalizeTag(profile.tag || generateTag()),
    email: profile.email || "",
    selectedCharacterId: profile.selectedCharacterId || readAccountJson(CHARACTER_KEY, "honeyBear", profile.username),
    ownedCharacterIds: profile.ownedCharacterIds || ["honeyBear"],
    economy,
    verified: true,
  };
}

async function loadFirebaseProfile(user) {
  const remoteProfile = await loadUserProfile(user.uid);
  const profile = localProfileFromFirebase(user, remoteProfile);
  if (!profile) {
    firebaseProfile = null;
    previousScreen = "mainMenuScreen";
    showScreen("profileScreen");
    return null;
  }
  firebaseProfile = profile;
  firebaseUsernameUidMap[profile.username] = user.uid;
  setProfile(profile, profile.username);
  setActiveUsername(profile.username);
  startFirebaseDataListeners(user.uid);
  startPresenceHeartbeat();
  showScreen("mainMenuScreen");
  return profile;
}

async function refreshFirebaseSocialData() {
  if (!firebaseUser) {
    firebaseFriends = [];
    firebaseNotifications = [];
    firebaseLobbies = [];
    firebaseSaves = [];
    return;
  }
  const [friends, notifications, lobbies, saves] = await Promise.all([
    listFriends(firebaseUser.uid),
    listNotifications(firebaseUser.uid),
    listLobbiesForUser(firebaseUser.uid),
    listSaves(firebaseUser.uid),
  ]);
  applyFirebaseFriends(friends);
  applyFirebaseNotifications(notifications);
  applyFirebaseLobbies(lobbies);
  applyFirebaseSaves(saves);
  renderNotificationBadge();
}

function applyFirebaseFriends(friends) {
  firebaseFriends = friends.map((friend, index) => ({
    id: friend.uid || friend.id,
    uid: friend.uid || friend.id,
    username: friend.username,
    tag: friend.tag || "",
    status: friend.status || "Available",
    selectedCharacterId: friend.selectedCharacterId || "",
    characterId: friend.selectedCharacterId || characters[(index + 1) % characters.length].id,
  }));
  firebaseFriends.forEach((friend) => {
    if (friend.username && friend.uid) firebaseUsernameUidMap[friend.username] = friend.uid;
  });
}

function applyFirebaseNotifications(notifications) {
  firebaseNotifications = notifications.map((notice) => ({
    ...notice,
    createdAt: notice.createdAt && typeof notice.createdAt.toDate === "function"
      ? notice.createdAt.toDate().toISOString()
      : notice.createdAt || new Date().toISOString(),
  }));
}

function applyFirebaseLobbies(lobbies) {
  firebaseLobbies = lobbies.map((lobby) => ({
    chat: [],
    closedFor: [],
    minimizedFor: [],
    joinedFor: [],
    readyFor: [],
    ...lobby,
    createdAt: lobby.createdAt && typeof lobby.createdAt.toDate === "function"
      ? lobby.createdAt.toDate().toISOString()
      : lobby.createdAt || new Date().toISOString(),
  }));
  const activeLobby = game && game.lobbyId
    ? firebaseLobbies.find((lobby) => lobby.id === game.lobbyId)
    : null;
  if (activeLobby && activeLobby.gameState && activeLobby.gameState.syncedAt !== game.syncedAt && !canActiveAccountAct()) {
    game = JSON.parse(JSON.stringify(activeLobby.gameState));
    render();
  }
}

function applyFirebaseSaves(saves) {
  firebaseSaves = saves
    .map((save) => ({
      ...save,
      savedAt: save.savedAt && typeof save.savedAt.toDate === "function"
        ? save.savedAt.toDate().toISOString()
        : save.savedAt || new Date().toISOString(),
    }))
    .sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt))
    .slice(0, MAX_SAVES);
}

function clearFirebaseRuntimeData() {
  firebaseFriends = [];
  firebaseNotifications = [];
  firebaseLobbies = [];
  firebaseSaves = [];
  firebaseUsernameUidMap = {};
  firebaseLobbyMessages = {};
  lobbyChatSubscriptionId = "";
}

function activeScreenId() {
  return ["mainMenuScreen", "profileScreen", "friendsScreen", "notificationsScreen", "waitingLobbyScreen", "storeScreen", "modeScreen", "submodeScreen", "loadScreen", "settingsScreen", "gameScreen"]
    .find((id) => !document.querySelector(`#${id}`).hidden) || "unknown";
}

function writePresence() {
  if (!firebaseUser) return;
  updateUserPresence(firebaseUser.uid, {
    username: getActiveUsername(),
    activeScreen: activeScreenId(),
    activeLobbyId: activeInviteId() || "",
    inGame: Boolean(game && !game.over),
  }).catch((error) => console.warn("Unable to update presence", error));
}

function startPresenceHeartbeat() {
  stopPresenceHeartbeat();
  writePresence();
  presenceHeartbeatId = window.setInterval(writePresence, 30000);
}

function stopPresenceHeartbeat() {
  if (presenceHeartbeatId) window.clearInterval(presenceHeartbeatId);
  presenceHeartbeatId = null;
}

function stopFirebaseDataListeners() {
  firebaseDataUnsubscribers.forEach((unsubscribe) => unsubscribe());
  firebaseDataUnsubscribers = [];
  stopLobbyChatListener();
}

function stopLobbyChatListener() {
  if (lobbyChatUnsubscribe) lobbyChatUnsubscribe();
  lobbyChatUnsubscribe = null;
  lobbyChatSubscriptionId = "";
}

function subscribeToActiveLobbyChat() {
  if (!firebaseUser) return;
  const lobbyId = activeInviteId();
  if (!lobbyId || lobbyChatSubscriptionId === lobbyId) return;
  stopLobbyChatListener();
  lobbyChatSubscriptionId = lobbyId;
  lobbyChatUnsubscribe = subscribeToLobbyMessages(lobbyId, (messages) => {
    firebaseLobbyMessages[lobbyId] = messages.map((message) => ({
      ...message,
      sentAt: message.sentAt && typeof message.sentAt.toDate === "function"
        ? message.sentAt.toDate().toISOString()
        : message.sentAt || new Date().toISOString(),
    }));
    const dialog = document.querySelector("#lobbyChatDialog");
    if (dialog && dialog.open) renderLobbyChat();
  }, (error) => {
    console.warn("Firebase lobby chat listener failed", error);
  });
}

function refreshCurrentScreenFromFirebaseData() {
  renderNotificationBadge();
  if (!document.querySelector("#friendsScreen").hidden) renderFriends();
  if (!document.querySelector("#notificationsScreen").hidden) renderNotifications();
  if (!document.querySelector("#waitingLobbyScreen").hidden) renderWaitingLobby();
  if (!document.querySelector("#loadScreen").hidden) renderSaveList();
  if (!document.querySelector("#mainMenuScreen").hidden) renderActiveLobbyPrompts();
}

function startFirebaseDataListeners(uid) {
  stopFirebaseDataListeners();
  const handleError = (label) => (error) => {
    console.warn(`Firebase ${label} listener failed`, error);
  };
  firebaseDataUnsubscribers = [
    subscribeToFriends(uid, (friends) => {
      applyFirebaseFriends(friends);
      refreshCurrentScreenFromFirebaseData();
    }, handleError("friends")),
    subscribeToNotifications(uid, (notifications) => {
      applyFirebaseNotifications(notifications);
      refreshCurrentScreenFromFirebaseData();
    }, handleError("notifications")),
    subscribeToLobbiesForUser(uid, (lobbies) => {
      applyFirebaseLobbies(lobbies);
      refreshCurrentScreenFromFirebaseData();
    }, handleError("lobbies")),
    subscribeToSaves(uid, (saves) => {
      applyFirebaseSaves(saves);
      refreshCurrentScreenFromFirebaseData();
    }, handleError("saves")),
  ];
}

function startFirebaseAuthListener() {
  subscribeToAuthState(async (user) => {
    firebaseUser = user;
    firebaseAuthReady = true;
    if (!user) {
      firebaseProfile = null;
      stopFirebaseDataListeners();
      stopPresenceHeartbeat();
      clearFirebaseRuntimeData();
      previousScreen = "mainMenuScreen";
      showScreen("profileScreen");
      return;
    }
    try {
      await loadFirebaseProfile(user);
    } catch (error) {
      console.warn("Unable to load Firebase profile", error);
      previousScreen = "mainMenuScreen";
      showScreen("profileScreen");
      document.querySelector("#profileMessage").textContent = authErrorMessage(error);
    }
  });
}

function activeInviteId() {
  try {
    return localStorage.getItem(ACTIVE_INVITE_KEY) || pendingInviteId;
  } catch {
    return pendingInviteId;
  }
}

function setActiveInviteId(id) {
  pendingInviteId = id;
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(ACTIVE_INVITE_KEY, id);
  }
}

function getActiveInvite() {
  const id = activeInviteId();
  return getLobbies().find((lobby) => lobby.id === id) || readJson(ACTIVE_INVITE_KEY + ".data", null) || getNotifications().find((notice) => notice.id === id) || null;
}

function setActiveInviteData(invite) {
  writeJson(ACTIVE_INVITE_KEY + ".data", invite);
  upsertLobby(invite);
}

function getLobbies() {
  if (firebaseUser) return firebaseLobbies;
  return readJson(LOBBIES_KEY, []);
}

function setLobbies(lobbies) {
  if (firebaseUser) {
    firebaseLobbies = lobbies;
    return;
  }
  writeJson(LOBBIES_KEY, lobbies);
}

function activeLobbiesFor(username) {
  return getLobbies().filter((lobby) => isLobbyVisibleFor(lobby, username));
}

function isLobbyVisibleFor(lobby, username) {
  if (!username) return false;
  if (lobby.status === "complete") return false;
  return [lobby.sender, lobby.recipient].includes(username) && !(lobby.closedFor || []).includes(username);
}

function upsertLobby(lobby) {
  if (!lobby || !lobby.id || lobby.type !== "gameInvite") return;
  const lobbies = getLobbies().filter((candidate) => candidate.id !== lobby.id);
  const nextLobby = { chat: [], closedFor: [], minimizedFor: [], joinedFor: [lobby.sender], readyFor: [], ...lobby };
  lobbies.unshift(nextLobby);
  setLobbies(lobbies);
  if (firebaseUser) {
    writeFirebaseLobby(nextLobby).catch((error) => console.warn("Unable to sync lobby", error));
  }
}

function updateLobby(id, updater) {
  const lobbies = getLobbies();
  const index = lobbies.findIndex((lobby) => lobby.id === id);
  if (index === -1) return null;
  const updated = updater(lobbies[index]);
  lobbies[index] = updated;
  setLobbies(lobbies);
  if (activeInviteId() === id) setActiveInviteData(updated);
  if (firebaseUser) {
    writeFirebaseLobby(updated).catch((error) => console.warn("Unable to update lobby", error));
  }
  return updated;
}

function removeLobby(id) {
  setLobbies(getLobbies().filter((lobby) => lobby.id !== id));
  if (firebaseUser) {
    deleteFirebaseLobby(id).catch((error) => console.warn("Unable to delete lobby", error));
  }
  if (activeInviteId() === id) {
    setActiveInviteId("");
    writeJson(ACTIVE_INVITE_KEY + ".data", null);
  }
}

function closeGameLobbyIfHost() {
  if (!game || game.submode === "Pass and Play" || !game.lobbyId) return;
  const lobby = getLobbies().find((candidate) => candidate.id === game.lobbyId);
  if (lobby && getActiveUsername() === lobby.sender) {
    notifyLobbyClosedByHost(lobby, getActiveUsername());
    removeLobby(lobby.id);
  }
}

function closeGameLobbyForActivePlayer() {
  if (!game || game.submode === "Pass and Play" || !game.lobbyId) return;
  closeLobbyForUser(game.lobbyId, getActiveUsername());
}

function isActiveGameLobby(lobby) {
  return Boolean(lobby && lobby.status === "inGame" && lobby.activeGame);
}

function activeGameLobby() {
  return game && game.lobbyId ? getLobbies().find((lobby) => lobby.id === game.lobbyId) : null;
}

function serializableGameState() {
  if (!game || game.submode !== "Separate Devices" || !game.lobbyId) return null;
  return JSON.parse(JSON.stringify({
    ...game,
    syncedAt: Date.now(),
  }));
}

function restoreGameStateFromLobby(lobby) {
  if (!lobby || !lobby.gameState) return false;
  game = JSON.parse(JSON.stringify(lobby.gameState));
  game.lobbyId = lobby.id;
  if (game.over) return false;
  applyGameCharacters();
  clearForfeitAbsence(getActiveUsername());
  showScreen("gameScreen");
  render();
  return true;
}

function syncActiveGameStateSoon() {
  if (!firebaseUser || !game || game.over || game.submode !== "Separate Devices" || !game.lobbyId) return;
  if (gameStateSyncTimer) window.clearTimeout(gameStateSyncTimer);
  gameStateSyncTimer = window.setTimeout(() => {
    gameStateSyncTimer = null;
    const gameState = serializableGameState();
    if (!gameState) return;
    updateLobby(game.lobbyId, (lobby) => ({
      ...lobby,
      status: "inGame",
      activeGame: true,
      activeTurnPlayer: currentPlayer().name,
      lastGameStateAt: Date.now(),
      gameState,
    }));
  }, 350);
}

function markGamePlayerLeft(username) {
  if (!game || game.over || game.submode !== "Separate Devices" || !game.lobbyId || !username) return;
  updateLobby(game.lobbyId, (lobby) => ({
    ...lobby,
    status: "inGame",
    activeGame: true,
    inGameFor: (lobby.inGameFor || []).filter((name) => name !== username),
    absentPlayers: {
      ...(lobby.absentPlayers || {}),
      [username]: Date.now() + (FORFEIT_SECONDS * 1000),
    },
    lastGameStateAt: Date.now(),
  }));
  updateForfeitTimer();
}

function markMissingCurrentTurnPlayerAbsent() {
  if (!game || game.over || game.submode !== "Separate Devices" || !game.lobbyId) return;
  const lobby = activeGameLobby();
  if (!isActiveGameLobby(lobby)) return;
  const activeTurnPlayer = currentPlayer().name;
  const inGame = new Set(lobby.inGameFor || []);
  const absentPlayers = lobby.absentPlayers || {};
  if (inGame.has(activeTurnPlayer) || absentPlayers[activeTurnPlayer]) return;
  markGamePlayerLeft(activeTurnPlayer);
}

function clearForfeitAbsence(username) {
  if (!game || game.submode !== "Separate Devices" || !game.lobbyId || !username) return;
  updateLobby(game.lobbyId, (lobby) => {
    const absentPlayers = { ...(lobby.absentPlayers || {}) };
    delete absentPlayers[username];
    return {
      ...lobby,
      inGameFor: Array.from(new Set([...(lobby.inGameFor || []), username])),
      absentPlayers,
    };
  });
  updateForfeitTimer();
}

function absentOpponentForActiveUser() {
  if (!game || game.over || game.submode !== "Separate Devices" || document.querySelector("#gameScreen").hidden) return null;
  const lobby = activeGameLobby();
  if (!isActiveGameLobby(lobby)) return null;
  const activeUser = getActiveUsername();
  const absentPlayers = lobby.absentPlayers || {};
  const activeTurnPlayer = currentPlayer().name;
  if (activeTurnPlayer === activeUser || !absentPlayers[activeTurnPlayer]) return null;
  return { username: activeTurnPlayer, expiresAt: absentPlayers[activeTurnPlayer] };
}

function updateForfeitTimer() {
  const absent = absentOpponentForActiveUser();
  const panel = document.querySelector("#forfeitTimerPanel");
  if (!absent) {
    if (panel) panel.hidden = true;
    forfeitTimerHidden = false;
    if (forfeitTimerId) {
      window.clearInterval(forfeitTimerId);
      forfeitTimerId = null;
    }
    return;
  }
  const secondsLeft = Math.max(0, Math.ceil((absent.expiresAt - Date.now()) / 1000));
  document.querySelector("#forfeitTimerText").textContent = `${absent.username} has ${secondsLeft} seconds to return before forfeit.`;
  document.querySelector("#forfeitTimerCount").textContent = String(secondsLeft);
  document.querySelector("#forfeitTimerFill").style.width = `${Math.max(0, Math.min(100, (secondsLeft / FORFEIT_SECONDS) * 100))}%`;
  if (panel && !forfeitTimerHidden) panel.hidden = false;
  if (secondsLeft <= 0) {
    handleForfeitWin(absent.username);
    return;
  }
  if (!forfeitTimerId) forfeitTimerId = window.setInterval(updateForfeitTimer, 250);
}

function handleForfeitWin(absentUsername) {
  if (!game || game.over) return;
  const loserIndex = game.players.findIndex((player) => player.name === absentUsername);
  const winnerIndex = loserIndex === 0 ? 1 : 0;
  if (loserIndex === -1) return;
  const panel = document.querySelector("#forfeitTimerPanel");
  if (panel) panel.hidden = true;
  game.players[loserIndex].hands = [0, 0];
  game.over = true;
  updateLobby(game.lobbyId, (lobby) => ({ ...lobby, status: "complete", activeGame: false, absentPlayers: {}, gameState: null }));
  showGameOver(winnerIndex, loserIndex);
}

function forfeitActiveGameFor(username, lobbyId) {
  const targetLobbyId = lobbyId || (game && game.lobbyId);
  if (!targetLobbyId || !username) return;
  setActiveInviteId(targetLobbyId);
  if (!game || game.lobbyId !== targetLobbyId || game.over) {
    updateLobby(targetLobbyId, (lobby) => ({ ...lobby, status: "complete", activeGame: false, absentPlayers: {}, gameState: null }));
    renderActiveLobbyPrompts();
    return;
  }
  const loserIndex = game.players.findIndex((player) => player.name === username);
  const winnerIndex = loserIndex === 0 ? 1 : 0;
  if (loserIndex === -1) return;
  const timerPanel = document.querySelector("#forfeitTimerPanel");
  if (timerPanel) timerPanel.hidden = true;
  game.players[loserIndex].hands = [0, 0];
  game.over = true;
  updateLobby(targetLobbyId, (lobby) => ({ ...lobby, status: "complete", activeGame: false, absentPlayers: {}, gameState: null }));
  showScreen("gameScreen");
  showGameOver(winnerIndex, loserIndex);
}

function returnToActiveGame(lobbyId) {
  const username = getActiveUsername();
  setActiveInviteId(lobbyId);
  if (game && game.lobbyId === lobbyId && !game.over) {
    clearForfeitAbsence(username);
    showScreen("gameScreen");
    render();
    return;
  }
  joinLobby(lobbyId, username);
  const lobby = getLobbies().find((candidate) => candidate.id === lobbyId);
  if (restoreGameStateFromLobby(lobby)) return;
  showScreen("waitingLobbyScreen");
}

function unreadyInLobby(lobbyId, username) {
  if (!lobbyId || !username) return;
  updateLobby(lobbyId, (lobby) => ({
    ...lobby,
    readyFor: (lobby.readyFor || []).filter((name) => name !== username),
  }));
}

function unreadyActiveLobby() {
  unreadyInLobby(activeInviteId(), getActiveUsername());
}

function returnToGameLobby() {
  if (!game || game.submode === "Pass and Play" || !game.lobbyId) return false;
  const lobby = getLobbies().find((candidate) => candidate.id === game.lobbyId);
  if (!lobby) {
    document.querySelector("#gameOverDialog").close();
    game = null;
    document.querySelector("#hostClosedDialog").showModal();
    return false;
  }
  setActiveInviteId(lobby.id);
  updateLobby(lobby.id, (candidate) => ({
    ...candidate,
    status: candidate.recipient ? "accepted" : "declined",
    readyFor: [],
    minimizedFor: (candidate.minimizedFor || []).filter((name) => name !== getActiveUsername()),
    joinedFor: Array.from(new Set([...(candidate.joinedFor || []), getActiveUsername()])),
  }));
  game = null;
  showScreen("waitingLobbyScreen");
  return true;
}

function tooManyLobbies(username) {
  return activeLobbiesFor(username).length >= MAX_LOBBIES;
}

function getLobbyChat() {
  if (firebaseUser) return firebaseLobbyMessages[activeInviteId()] || [];
  const invite = getActiveInvite();
  return invite && Array.isArray(invite.chat) ? invite.chat : [];
}

function setLobbyChat(chat) {
  if (firebaseUser) {
    firebaseLobbyMessages[activeInviteId()] = chat;
    return;
  }
  const invite = getActiveInvite();
  if (!invite) return;
  setActiveInviteData({ ...invite, chat });
}

function clearLobbyChat() {
  if (firebaseUser) {
    firebaseLobbyMessages[activeInviteId()] = [];
    return;
  }
  const invite = getActiveInvite();
  if (!invite) return;
  setActiveInviteData({ ...invite, chat: [] });
}

function normalizeIdentity(value) {
  return value.trim().toLowerCase();
}

function normalizeUsername(value) {
  return normalizeIdentity(value).replace(/[^a-z0-9_.]/g, "");
}

function normalizeTag(value) {
  return value.trim().replace(/^#/, "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

function isValidUsernameInput(value) {
  return /^[a-z0-9_.]{1,18}$/.test(value.trim().toLowerCase());
}

function isValidTagInput(value) {
  return /^[a-zA-Z0-9]{4}$/.test(value.trim().replace(/^#/, ""));
}

function showInvalidInput(message) {
  document.querySelector("#invalidInputText").textContent = message;
  document.querySelector("#invalidInputDialog").showModal();
}

function openLegalDialog(kind) {
  const content = legalCopy[kind];
  if (!content) return;
  document.querySelector("#legalDialogTitle").textContent = content.title;
  const body = document.querySelector("#legalDialogContent");
  body.replaceChildren();
  content.paragraphs.forEach((paragraph) => {
    const p = document.createElement("p");
    p.textContent = paragraph;
    body.append(p);
  });
  document.querySelector("#legalDialog").showModal();
}

function generateTag(existingTags = null) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const used = existingTags || new Set(readJson(MOCK_USERS_KEY, []).map((user) => normalizeTag(user.tag || "")));
  let tag = "";
  do {
    tag = Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  } while (used.has(tag));
  return tag;
}

function profileTag(username) {
  const profile = readAccountJson(PROFILE_KEY, null, username);
  const user = getMockUsers().find((candidate) => candidate.username === username);
  return normalizeTag((profile && profile.tag) || (user && user.tag) || "");
}

function ensureProfileTag(profile, username) {
  if (!profile) return profile;
  const tag = normalizeTag(profile.tag || profileTag(username) || generateTag());
  if (profile.tag === tag) return profile;
  const updated = { ...profile, tag };
  setProfile(updated, username || profile.username);
  setMockUsers(getMockUsers().map((user) => user.username === (username || profile.username) ? { ...user, tag } : user));
  return updated;
}

function parseFriendHandle(value) {
  const [rawUsername, rawTag] = value.trim().split("#");
  if (!rawUsername || rawTag === undefined) return null;
  if (!isValidUsernameInput(rawUsername) || !isValidTagInput(rawTag)) return null;
  const username = normalizeUsername(rawUsername);
  const tag = normalizeTag(rawTag);
  return username && tag ? { username, tag } : null;
}

function profileProgress(username) {
  const profile = getProfile(username);
  const economy = normalizeEconomy(profile || {});
  return {
    level: economy.level,
    exp: economy.experience,
    next: levelRequirement(economy.level),
    coins: economy.coins,
    winStreak: economy.winStreak,
  };
}

function achievementItems(username) {
  const base = username || "Player";
  return [
    `${base} joined Cozy Chopsticks Cafe`,
    "First win achievement coming soon",
    "Power Up collector achievement coming soon",
  ];
}

function profileCardMarkup(username, options = {}) {
  const character = getCharacterForUsername(username);
  const progress = profileProgress(username);
  const tag = profileTag(username);
  return `
    <div class="public-profile-card">
      ${characterMarkup(character, options.avatarClass || "profile-avatar")}
      <h2>${username || "Guest"}${tag ? `<span class="profile-tag">#${tag}</span>` : ""}</h2>
      <div class="level-panel compact">
        <div>
          <strong>Level ${progress.level}</strong>
        </div>
      </div>
      <div class="achievement-panel">
        <strong>Achievements</strong>
        ${achievementItems(username).map((item) => `<div>${item}</div>`).join("")}
      </div>
    </div>
  `;
}

function openPublicProfile(username) {
  const dialog = document.querySelector("#publicProfileDialog");
  document.querySelector("#publicProfileContent").innerHTML = profileCardMarkup(username);
  dialog.showModal();
}

function renderProfile() {
  const profile = getProfile();
  const activeUsername = getActiveUsername();
  const isSetup = !profile;
  document.querySelector("#profileScreen").classList.toggle("profile-setup", isSetup);
  document.querySelector("#profileScreen").classList.toggle("profile-unverified", !firebaseUser);
  document.querySelector("#profileUsername").value = profile ? profile.username : activeUsername;
  document.querySelector("#profileTag").value = profile ? `#${normalizeTag(profile.tag)}` : "";
  document.querySelector("#profilePhone").value = profile ? (profile.email || profile.phone || "") : (firebaseUser ? firebaseUser.email || "" : "");
  document.querySelector("#verificationCode").value = "";
  document.querySelector("#profileMessage").textContent = firebaseUser && profile
    ? "Signed in with Firebase."
    : firebaseUser
      ? "Choose a username to finish your cafe profile."
      : "Create an account or sign in with email and password to start playing.";
  const username = activeUsername || (profile ? profile.username : "Guest");
  const progress = profileProgress(username);
  const tag = profileTag(username);
  document.querySelector("#profileSummary").innerHTML = `
    ${characterMarkup(getCharacterForUsername(username), "profile-avatar")}
    <div class="profile-handle-row">
      ${profile ? `
        <button class="edit-profile-icon" data-edit="username" type="button" aria-label="Edit username">✎</button>
      ` : ""}
      <h2>${username}<span class="profile-tag">#${tag}</span></h2>
      ${profile ? `
        <button class="edit-profile-icon" data-edit="tag" type="button" aria-label="Edit tag">✎</button>
      ` : ""}
    </div>
  `;
  document.querySelectorAll(".edit-profile-icon").forEach((button) => {
    button.addEventListener("click", () => openHandleEdit(button.dataset.edit));
  });
  document.querySelector("#profileLevel").textContent = `Level ${progress.level}`;
  document.querySelector("#profileExpText").textContent = `${progress.exp} / ${progress.next} EXP`;
  document.querySelector("#profileExpFill").style.width = `${Math.min(100, (progress.exp / progress.next) * 100)}%`;
  document.querySelector("#profileCoins").innerHTML = coinAmountMarkup(progress.coins);
  const streakEl = document.querySelector("#profileWinStreak");
  streakEl.textContent = progress.winStreak > 0 ? `${progress.winStreak} game streak` : "";
  streakEl.hidden = progress.winStreak === 0;
  document.querySelector("#profileAchievements").innerHTML = achievementItems(username).map((item) => `<div>${item}</div>`).join("");
  const mockPanel = document.querySelector(".mock-testing-panel");
  if (mockPanel) mockPanel.hidden = !devToolsEnabled();
  document.querySelector("#profilePhoneSection").hidden = Boolean(firebaseUser && profile);
  document.querySelector("#verifyPhoneSection").hidden = Boolean(firebaseUser && profile);
  document.querySelector("#profileUsernameField").hidden = Boolean(firebaseUser && profile);
  document.querySelector("#profileTagField").hidden = true;
  document.querySelector("#verifyRow").hidden = Boolean(firebaseUser && profile);
  document.querySelector("#sendVerification").textContent = firebaseUser ? "Save Profile" : "Create Account";
  document.querySelector("#deleteFirebaseAccount").hidden = !(firebaseUser && profile);
}

async function saveProfile() {
  const rawUsername = document.querySelector("#profileUsername").value;
  const username = normalizeUsername(rawUsername);
  const current = getProfile();
  const tag = current ? normalizeTag(current.tag) : generateTag();
  const email = document.querySelector("#profilePhone").value.trim();
  const password = document.querySelector("#verificationCode").value;
  const message = document.querySelector("#profileMessage");
  if (!username || !email || (!firebaseUser && password.length < 6)) {
    message.textContent = "Username, email, and a password of at least 6 characters are required.";
    return false;
  }
  if (!isValidUsernameInput(rawUsername)) {
    showInvalidInput("Usernames can use letters, numbers, underscores, and periods only. Max length: 18.");
    return false;
  }

  const activeUsername = getActiveUsername();
  const users = getMockUsers();
  const conflict = users.find((user) => {
    const sameUser = user.username.toLowerCase() === (activeUsername || "").toLowerCase();
    return !sameUser && user.username.toLowerCase() === username.toLowerCase();
  });
  if (conflict) {
    showInvalidInput("Username is already taken. Pick another one.");
    return false;
  }

  try {
    if (!firebaseUser) {
      firebaseUser = await signUpWithEmail(email, password, username);
    }
  } catch (error) {
    message.textContent = authErrorMessage(error);
    return false;
  }

  const nextProfile = profileWithEconomy(current || {}, {
    username,
    email,
    phone: email,
    tag,
    verified: true,
  });
  if (activeUsername && activeUsername !== username) {
    if (!renameAccount(activeUsername, username)) {
      message.textContent = "That username is unavailable.";
      return false;
    }
  }
  const remaining = getMockUsers().filter((user) => user.username !== username && !(current && user.username === current.username));
  remaining.push({ username, phone: email, tag });
  setMockUsers(remaining);
  setProfile(nextProfile, username);
  if (!getActiveUsername() || getActiveUsername() !== username) setActiveUsername(nextProfile.username);
  firebaseProfile = nextProfile;
  message.textContent = "Profile saved.";
  return true;
}

async function signInFromProfileFields() {
  const email = document.querySelector("#profilePhone").value.trim();
  const password = document.querySelector("#verificationCode").value;
  const message = document.querySelector("#profileMessage");
  if (!email || !password) {
    message.textContent = "Email and password are required.";
    return false;
  }
  try {
    firebaseUser = await signInWithEmail(email, password);
    await loadFirebaseProfile(firebaseUser);
    return true;
  } catch (error) {
    message.textContent = authErrorMessage(error);
    return false;
  }
}

function authErrorMessage(error) {
  const code = error && error.code ? error.code : "";
  if (code === "auth/email-already-in-use") return "That email already has an account. Try signing in.";
  if (code === "auth/invalid-email") return "Enter a valid email address.";
  if (code === "auth/weak-password") return "Password must be at least 6 characters.";
  if (code === "auth/invalid-credential" || code === "auth/wrong-password" || code === "auth/user-not-found") return "Email or password is incorrect.";
  if (code === "auth/requires-recent-login") return "Please sign out, sign back in, and try deleting the account again.";
  if (code === "auth/operation-not-allowed") return "Enable Email/Password sign-in in Firebase Authentication first.";
  if (String(error && error.message).includes("permission-denied")) return "Check Firestore security rules for user profile access.";
  return "Firebase sign-in failed. Check your Firebase setup and try again.";
}

function openHandleEdit(kind) {
  const profile = getProfile();
  if (!profile) return;
  pendingHandleEdit = kind;
  const input = document.querySelector("#editHandleInput");
  document.querySelector("#editHandleTitle").textContent = kind === "tag" ? "Edit Tag" : "Edit Username";
  document.querySelector("#editHandleMessage").textContent = kind === "tag"
    ? "Tags must be exactly 4 letters or numbers."
    : "Usernames can use letters, numbers, underscores, and periods. Max 18 characters.";
  input.maxLength = kind === "tag" ? 4 : 18;
  input.placeholder = kind === "tag" ? "A7K2" : "username";
  input.value = kind === "tag" ? normalizeTag(profile.tag) : profile.username;
  document.querySelector("#editHandleDialog").showModal();
  input.focus();
}

function updateProfileUsername(rawUsername) {
  const username = normalizeUsername(rawUsername);
  if (!isValidUsernameInput(rawUsername)) {
    showInvalidInput("Usernames can use letters, numbers, underscores, and periods only. Max length: 18.");
    return false;
  }
  const activeUsername = getActiveUsername();
  if (username === activeUsername) return true;
  if (getMockUsers().some((user) => user.username.toLowerCase() === username.toLowerCase())) {
    showInvalidInput("Username is already taken. Pick another one.");
    return false;
  }
  const profile = getProfile();
  if (!renameAccount(activeUsername, username)) {
    document.querySelector("#editHandleMessage").textContent = "That username is unavailable.";
    return false;
  }
  setProfile({ ...profile, username }, username);
  setMockUsers(getMockUsers().map((user) => user.username === username ? { ...user, username } : user));
  return true;
}

function updateProfileTag(rawTag) {
  if (!isValidTagInput(rawTag)) {
    showInvalidInput("Tags can only use letters and numbers, and must be exactly 4 characters.");
    return false;
  }
  const tag = normalizeTag(rawTag);
  const username = getActiveUsername();
  const profile = getProfile();
  setProfile({ ...profile, tag }, username);
  setMockUsers(getMockUsers().map((user) => user.username === username ? { ...user, tag } : user));
  return true;
}

function renderFriends() {
  const list = document.querySelector("#friendList");
  const requestsEl = document.querySelector("#pendingFriendRequests");
  const friends = getFriends();
  list.replaceChildren();
  requestsEl.replaceChildren();
  renderPendingFriendRequests(requestsEl);
  document.querySelector("#friendsMessage").textContent = friends.length ? "" : "No cafe friends yet.";
  friends.forEach((friend) => {
    const row = document.createElement("div");
    const character = characters.find((candidate) => candidate.id === friend.characterId) || characters[0];
    row.className = "friend-row";
    row.innerHTML = `
      <button class="friend-profile-button" type="button" aria-label="View ${friend.username} profile">${characterMarkup(character)}</button>
      <button class="friend-name-button" type="button">
        <strong>${friend.username}</strong>
        <small class="status-chip ${statusClass(friend.status)}">${friend.status}</small>
      </button>
      <button class="delete-friend-button" type="button">Delete</button>
    `;
    row.querySelector(".friend-profile-button").addEventListener("click", () => openPublicProfile(friend.username));
    row.querySelector(".friend-name-button").addEventListener("click", () => openPublicProfile(friend.username));
    row.querySelector(".delete-friend-button").addEventListener("click", async () => {
      if (firebaseUser && friend.uid) {
        await removeFirebaseFriend(firebaseUser.uid, friend.uid);
        await refreshFirebaseSocialData();
      } else {
        removeFriendMutual(getActiveUsername(), friend.username);
      }
      playMenuSound();
      renderFriends();
    });
    list.append(row);
  });
}

function renderPendingFriendRequests(container) {
  const requests = getNotifications().filter((notice) => notice.type === "friendRequest");
  if (requests.length === 0) return;
  const heading = document.createElement("p");
  heading.className = "eyebrow";
  heading.textContent = "Pending Requests";
  container.append(heading);
  requests.forEach((notice) => {
    const row = document.createElement("div");
    row.className = "friend-row pending-request-row";
    row.innerHTML = `
      <div>
        <strong>${notice.sender}</strong>
        <span>wants to be cafe friends</span>
      </div>
      <button type="button" data-action="accept">Accept</button>
      <button type="button" data-action="decline">Decline</button>
    `;
    row.querySelector('[data-action="accept"]').addEventListener("click", async () => {
      await acceptFriendRequest(notice);
      playMenuSound();
      renderFriends();
    });
    row.querySelector('[data-action="decline"]').addEventListener("click", async () => {
      await declineNotification(notice);
      playMenuSound();
      renderFriends();
    });
    container.append(row);
  });
}

async function addFriendFromFields() {
  const handle = parseFriendHandle(document.querySelector("#friendUsername").value);
  const message = document.querySelector("#addFriendMessage");
  if (!handle) {
    message.textContent = "Enter your friend's username and tag, like grace#A7K2.";
    return false;
  }
  const { username, tag } = handle;
  const profile = getProfile();
  if (profile && profile.username === username && normalizeTag(profile.tag) === tag) {
    message.textContent = "You cannot add your own profile.";
    return false;
  }
  let user = null;
  if (firebaseUser) {
    try {
      user = await findPublicProfile(username, tag);
    } catch (error) {
      message.textContent = "Unable to search for that profile right now.";
      console.warn("Firebase friend lookup failed", error);
      return false;
    }
  } else {
    const users = getMockUsers();
    user = users.find((candidate) => candidate.username.toLowerCase() === username.toLowerCase() && normalizeTag(candidate.tag) === tag);
  }
  if (!user) {
    document.querySelector("#addFriendDialog").close();
    document.querySelector("#unknownUserDialog").showModal();
    return false;
  }
  if (getFriends().some((friend) => friend.username === user.username)) {
    message.textContent = "That friend is already in your list.";
    return false;
  }
  await sendFriendRequest(user);
  document.querySelector("#friendUsername").value = "";
  message.textContent = `Friend request sent to ${user.username}.`;
  document.querySelector("#addFriendDialog").close();
  document.querySelector("#inviteSentText").textContent = `Friend invite successfully delivered to ${user.username}.`;
  document.querySelector("#inviteSentDialog").showModal();
  renderFriends();
  return true;
}

function statusClass(status) {
  return `status-${status.toLowerCase().replace(/\s+/g, "-")}`;
}

function makeFriendRecord(username, index = 0) {
  const user = getMockUsers().find((candidate) => candidate.username === username) || { username, phone: `mock-${Date.now()}` };
  const statuses = ["Available", "Offline", "In Game"];
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : `${username}-${Date.now()}`,
    username,
    phone: user.phone,
    status: statuses[index % statuses.length],
    characterId: characters[(index + 1) % characters.length].id,
  };
}

function addFriendForAccount(accountUsername, friendUsername) {
  const friends = getFriendsForAccount(accountUsername);
  if (friends.some((friend) => friend.username === friendUsername)) return;
  setFriendsForAccount([...friends, makeFriendRecord(friendUsername, friends.length)], accountUsername);
}

function getFriendsForAccount(username) {
  return readAccountJson(FRIENDS_KEY, [], username);
}

function setFriendsForAccount(friends, username) {
  writeAccountJson(FRIENDS_KEY, friends, username);
}

function removeFriendMutual(username, friendUsername) {
  if (!username || !friendUsername) return;
  setFriendsForAccount(getFriendsForAccount(username).filter((friend) => friend.username !== friendUsername), username);
  setFriendsForAccount(getFriendsForAccount(friendUsername).filter((friend) => friend.username !== username), friendUsername);
}

async function sendFriendRequest(user) {
  const profile = getProfile();
  const sender = getActiveUsername() || (profile && profile.username);
  if (!sender) return;
  const username = typeof user === "string" ? user : user.username;
  if (firebaseUser && firebaseProfile && typeof user !== "string") {
    await sendFirebaseFriendRequest(firebaseUser.uid, firebaseProfileDocument(firebaseProfile), user);
    return;
  }
  const existing = getNotifications(username).filter((notice) => !(notice.type === "friendRequest" && notice.sender === sender && notice.recipient === username));
  const notification = {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    type: "friendRequest",
    title: "Friend Request",
    text: `${sender} wants to be cafe friends.`,
    sender,
    recipient: username,
    status: "pending",
    unread: true,
    createdAt: new Date().toISOString(),
  };
  setNotifications([notification, ...existing], username);
  renderNotificationBadge();
}

async function acceptFriendRequest(notice) {
  if (firebaseUser && firebaseProfile && notice.senderUid) {
    await acceptFirebaseFriendRequest(firebaseUser.uid, firebaseProfileDocument(firebaseProfile), notice);
    await refreshFirebaseSocialData();
    renderNotificationBadge();
    return;
  }
  addFriendForAccount(notice.recipient, notice.sender);
  addFriendForAccount(notice.sender, notice.recipient);
  setNotifications(getNotifications().filter((candidate) => candidate.id !== notice.id));
  renderNotificationBadge();
}

async function declineNotification(notice) {
  if (firebaseUser && notice.id) {
    await deleteFirebaseNotification(firebaseUser.uid, notice.id);
    await refreshFirebaseSocialData();
    if (notice.type === "gameInvite") markLobbyInviteDeclined(notice.id, notice.recipient);
    renderNotificationBadge();
    return;
  }
  setNotifications(getNotifications().filter((candidate) => candidate.id !== notice.id));
  if (notice.type === "gameInvite") markLobbyInviteDeclined(notice.id, notice.recipient);
  renderNotificationBadge();
}

function markLobbyInviteDeclined(lobbyId, username) {
  updateLobby(lobbyId, (lobby) => ({
    ...lobby,
    status: "declined",
    declined: true,
    recipient: "",
    invitedFormer: username || lobby.recipient,
    closedFor: Array.from(new Set([...(lobby.closedFor || []), username || lobby.recipient].filter(Boolean))),
    joinedFor: (lobby.joinedFor || []).filter((name) => name !== username && name !== lobby.recipient),
    readyFor: (lobby.readyFor || []).filter((name) => name !== username && name !== lobby.recipient),
  }));
}

function addSystemNotification(username, title, text) {
  const notification = {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    type: "system",
    title,
    text,
    recipient: username,
    unread: true,
    createdAt: new Date().toISOString(),
  };
  setNotifications([notification, ...getNotifications(username)], username);
  renderNotificationBadge();
}

function notifyLobbyClosedByHost(lobby, hostUsername) {
  lobbyParticipants(lobby)
    .filter((username) => username && username !== hostUsername)
    .forEach((username) => {
      setNotifications(getNotifications(username).filter((notice) => notice.id !== lobby.id), username);
      addSystemNotification(username, "Lobby Closed", `${hostUsername} closed the lobby.`);
    });
}

function showLobbyClosedPopupIfNeeded() {
  const username = getActiveUsername();
  if (!username) return false;
  const notices = getNotifications(username);
  const notice = notices.find((candidate) => candidate.type === "system" && candidate.title === "Lobby Closed" && candidate.unread);
  if (!notice) return false;
  pendingHostClosedNoticeId = notice.id;
  setNotifications(notices.map((candidate) => candidate.id === notice.id ? { ...candidate, unread: false } : candidate), username);
  const dialog = document.querySelector("#hostClosedDialog");
  const text = dialog.querySelector("p");
  if (text) text.textContent = notice.text || "The host has closed the lobby.";
  if (document.querySelector("#gameOverDialog").open) document.querySelector("#gameOverDialog").close();
  game = null;
  showScreen("mainMenuScreen");
  dialog.showModal();
  return true;
}

function closeLobbyForUser(lobbyId, username) {
  const lobby = getLobbies().find((candidate) => candidate.id === lobbyId);
  if (!lobby) return;
  if (isActiveGameLobby(lobby)) {
    markGamePlayerLeft(username);
    return;
  }
  setNotifications(getNotifications(username).filter((notice) => notice.id !== lobbyId), username);
  if (username === lobby.sender) {
    notifyLobbyClosedByHost(lobby, username);
    removeLobby(lobbyId);
    return;
  }
  markLobbyInviteDeclined(lobbyId, username);
  const wasAccepted = lobby.status === "accepted" || (lobby.joinedFor || []).includes(username);
  addSystemNotification(lobby.sender, wasAccepted ? "Player Left Lobby" : "Invite Declined", wasAccepted ? `${username} left the lobby.` : `${username} declined the game invite.`);
}

function renameAccount(oldUsername, newUsername) {
  if (!oldUsername || !newUsername || oldUsername === newUsername) return false;
  if (getMockUsers().some((user) => user.username === newUsername)) return false;
  const users = getMockUsers().map((user) => user.username === oldUsername ? { ...user, username: newUsername } : user);
  setMockUsers(users);

  [SAVE_KEY, SETTINGS_KEY, FRIENDS_KEY, NOTIFICATIONS_KEY, CHARACTER_KEY, PROFILE_KEY].forEach((baseKey) => {
    let value = readAccountJson(baseKey, null, oldUsername);
    if (value !== null) {
      if (baseKey === PROFILE_KEY && value && value.username === oldUsername) value = { ...value, username: newUsername };
      writeAccountJson(baseKey, value, newUsername);
      removeStorageKey(accountKey(baseKey, oldUsername));
    }
  });

  getMockUsers().forEach((user) => {
    setFriendsForAccount(getFriendsForAccount(user.username).map((friend) => friend.username === oldUsername ? { ...friend, username: newUsername } : friend), user.username);
    setNotifications(getNotifications(user.username).map((notice) => renameNoticeAccount(notice, oldUsername, newUsername)), user.username);
  });

  setLobbies(getLobbies().map((lobby) => ({
    ...renameNoticeAccount(lobby, oldUsername, newUsername),
    joinedFor: (lobby.joinedFor || []).map((name) => name === oldUsername ? newUsername : name),
    minimizedFor: (lobby.minimizedFor || []).map((name) => name === oldUsername ? newUsername : name),
    closedFor: (lobby.closedFor || []).map((name) => name === oldUsername ? newUsername : name),
    chat: (lobby.chat || []).map((message) => message.sender === oldUsername ? { ...message, sender: newUsername } : message),
  })));

  const profile = getProfile();
  if (profile && profile.username === oldUsername) setProfile({ ...profile, username: newUsername });
  if (getActiveUsername() === oldUsername) setActiveUsername(newUsername);
  return true;
}

function renameNoticeAccount(notice, oldUsername, newUsername) {
  return {
    ...notice,
    sender: notice.sender === oldUsername ? newUsername : notice.sender,
    recipient: notice.recipient === oldUsername ? newUsername : notice.recipient,
    text: notice.text ? notice.text.replaceAll(oldUsername, newUsername) : notice.text,
  };
}

function deleteAccount(username) {
  if (!username || username === "humpday") return false;
  setMockUsers(getMockUsers().filter((user) => user.username !== username));
  [SAVE_KEY, SETTINGS_KEY, FRIENDS_KEY, NOTIFICATIONS_KEY, CHARACTER_KEY, PROFILE_KEY].forEach((baseKey) => removeStorageKey(accountKey(baseKey, username)));
  getMockUsers().forEach((user) => {
    setFriendsForAccount(getFriendsForAccount(user.username).filter((friend) => friend.username !== username), user.username);
    setNotifications(getNotifications(user.username).filter((notice) => notice.sender !== username && notice.recipient !== username), user.username);
  });
  setLobbies(getLobbies().filter((lobby) => lobby.sender !== username && lobby.recipient !== username));
  if (getActiveUsername() === username) {
    const profile = getProfile();
    setActiveUsername(profile ? profile.username : "humpday");
  }
  return true;
}

function openSeparateDevicesInvite() {
  if (!getProfile()) {
    previousScreen = "submodeScreen";
    showScreen("profileScreen");
    return;
  }
  renderInviteFriendList();
  document.querySelector("#inviteFriendDialog").showModal();
}

function renderInviteFriendList() {
  const list = document.querySelector("#inviteFriendList");
  const friends = getFriends();
  list.replaceChildren();
  if (friends.length === 0) {
    const empty = document.createElement("p");
    empty.textContent = "No friends yet.";
    list.append(empty);
    return;
  }
  friends.forEach((friend) => {
    const character = characters.find((candidate) => candidate.id === friend.characterId) || characters[0];
    const button = document.createElement("button");
    button.type = "button";
    button.className = "invite-friend-card";
    button.innerHTML = `
      ${characterMarkup(character)}
      <strong>${friend.username}</strong>
      <span>${friend.status}</span>
    `;
    button.addEventListener("click", async () => {
      const invite = getActiveInvite();
      if (invite && invite.declined && invite.sender === getActiveUsername()) {
        replaceLobbyInvite(friend.id);
        return;
      }
      await sendGameInvite(friend.id);
    });
    list.append(button);
  });
}

function replaceLobbyInvite(friendId) {
  const lobby = getActiveInvite();
  const friend = getFriends().find((candidate) => candidate.id === friendId);
  if (!lobby || !friend) return;
  const previousFriend = lobby.recipient || lobby.invitedFormer || "";
  const shouldClearChat = previousFriend && previousFriend !== friend.username;
  const updated = {
    ...lobby,
    recipient: friend.username,
    status: "pending",
    declined: false,
    closedFor: [],
    minimizedFor: [],
    joinedFor: [lobby.sender],
    readyFor: [],
    chat: shouldClearChat ? [] : (lobby.chat || []),
    unread: true,
    text: `${lobby.sender} invited you to ${lobby.mode}.`,
  };
  setActiveInviteData(updated);
  setNotifications([updated, ...getNotifications(friend.username).filter((notice) => notice.id !== updated.id)], friend.username);
  document.querySelector("#inviteFriendDialog").close();
  renderWaitingLobby();
}

async function sendGameInvite(friendId) {
  const friend = getFriends().find((candidate) => candidate.id === friendId);
  const hostUsername = getActiveUsername();
  if (!friend || !hostUsername) return;
  if (tooManyLobbies(hostUsername) || tooManyLobbies(friend.username)) {
    addSystemNotification(hostUsername, "Too Many Lobbies", "You or your friend is already in too many lobbies.");
    document.querySelector("#inviteFriendDialog").close();
    document.querySelector("#inviteSentText").textContent = "Unable to send invite. One player is in too many lobbies.";
    document.querySelector("#inviteSentDialog").showModal();
    return;
  }
  pendingSubmode = "Separate Devices";
  pendingInviteFriendId = friend.id;
  const recipientNotifications = getNotifications(friend.username);
  const existing = recipientNotifications.filter((notice) => !(
    notice.type === "gameInvite"
    && notice.sender === hostUsername
    && notice.recipient === friend.username
    && notice.mode === pendingMode
    && notice.submode === "Separate Devices"
  ));
  const existingLobby = getLobbies().find((lobby) => lobby.type === "gameInvite" && lobby.sender === hostUsername && lobby.recipient === friend.username && lobby.mode === pendingMode && lobby.submode === "Separate Devices");
  const notification = {
    id: existingLobby ? existingLobby.id : (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())),
    type: "gameInvite",
    title: "Game Invite",
    text: `${hostUsername} invited you to ${pendingMode}.`,
    sender: hostUsername,
    senderUid: firebaseUser ? firebaseUser.uid : "",
    recipient: friend.username,
    recipientUid: friend.uid || "",
    participantUids: firebaseUser && friend.uid ? [firebaseUser.uid, friend.uid] : [],
    participants: [hostUsername, friend.username],
    mode: pendingMode,
    submode: "Separate Devices",
    status: existingLobby ? existingLobby.status : "pending",
    unread: true,
    createdAt: new Date().toISOString(),
    chat: existingLobby ? existingLobby.chat : [],
    closedFor: [],
    minimizedFor: [],
    joinedFor: existingLobby ? existingLobby.joinedFor : [hostUsername],
    readyFor: existingLobby ? existingLobby.readyFor || [] : [],
  };
  if (firebaseUser && friend.uid) {
    await sendFirebaseGameInvite(notification, friend.uid);
    firebaseLobbies = [notification, ...firebaseLobbies.filter((lobby) => lobby.id !== notification.id)];
  } else {
    setNotifications([notification, ...existing], friend.username);
  }
  setActiveInviteId(notification.id);
  setActiveInviteData(notification);
  document.querySelector("#inviteFriendDialog").close();
  document.querySelector("#inviteSentText").textContent = `${friend.username} received a game invite.`;
  document.querySelector("#inviteSentDialog").showModal();
  showScreen("waitingLobbyScreen");
}

function renderNotifications() {
  const list = document.querySelector("#notificationList");
  const activeUser = getActiveUsername();
  const allNotifications = getNotifications();
  let notifications = allNotifications.filter((notice) => !notice.recipient || notice.recipient === activeUser);
  const activeAccountLabel = document.querySelector("#activeAccountLabel");
  if (activeAccountLabel) activeAccountLabel.textContent = activeUser ? `Viewing as ${activeUser}` : "Viewing as you";
  if (notifications.some((notice) => notice.unread)) {
    const visibleIds = new Set(notifications.map((notice) => notice.id));
    const updated = allNotifications.map((notice) => visibleIds.has(notice.id) ? { ...notice, unread: false } : notice);
    setNotifications(updated);
    notifications = updated.filter((notice) => !notice.recipient || notice.recipient === activeUser);
    renderNotificationBadge();
  }
  list.replaceChildren();
  if (notifications.length === 0) {
    const empty = document.createElement("p");
    empty.textContent = "No invites yet.";
    list.append(empty);
    document.querySelector("#deleteAllNotifications").hidden = true;
    return;
  }
  document.querySelector("#deleteAllNotifications").hidden = false;
  notifications.forEach((notice) => {
    const row = document.createElement("div");
    row.className = "notification-row";
    row.classList.toggle("read", !notice.unread);
    const isSystemNotice = notice.type === "system";
    row.innerHTML = `
      <div>
        <strong>${notice.title}</strong>
        <span>${notice.text}${notice.status === "accepted" ? " Accepted." : ""}</span>
      </div>
      <button type="button" data-action="accept">${isSystemNotice ? "Okay" : "Accept"}</button>
      ${isSystemNotice ? "" : '<button type="button" data-action="delete">Decline</button>'}
    `;
    row.querySelector('[data-action="accept"]').disabled = notice.status === "accepted";
    row.querySelector('[data-action="accept"]').addEventListener("click", async () => {
      if (notice.type === "system") {
        await declineNotification(notice);
        renderNotifications();
        return;
      }
      if (notice.type === "friendRequest") {
        await acceptFriendRequest(notice);
        playMenuSound();
        renderNotifications();
        return;
      }
      joinLobby(notice.id, getActiveUsername());
      setActiveInviteId(notice.id);
      playMenuSound();
      showScreen("waitingLobbyScreen");
    });
    const deleteButton = row.querySelector('[data-action="delete"]');
    if (deleteButton) {
      deleteButton.addEventListener("click", async () => {
        await declineNotification(notice);
        playMenuSound();
        renderNotifications();
      });
    }
    list.append(row);
  });
}

function requireProfile(nextScreen) {
  const profile = getProfile();
  if (profile) {
    showScreen(nextScreen);
    return true;
  }
  previousScreen = "mainMenuScreen";
  showScreen("profileScreen");
  return false;
}

function renderNotificationBadge() {
  const badge = document.querySelector("#notificationBadge");
  if (!badge) return;
  const activeUser = getActiveUsername();
  badge.hidden = !getNotifications().some((notice) => notice.unread && (!notice.recipient || notice.recipient === activeUser));
}

function lobbyParticipants(invite) {
  if (!invite) return [];
  return [invite.sender, invite.recipient].filter(Boolean);
}

function renderLobbyRoster(invite) {
  const roster = document.querySelector("#lobbyRoster");
  if (!roster) return;
  roster.replaceChildren();
  if (!invite) return;
  const joined = new Set(invite.joinedFor || []);
  const ready = new Set(invite.readyFor || []);
  const activeUser = getActiveUsername();
  const viewerIsHost = activeUser === invite.sender;
  lobbyParticipants(invite).forEach((username) => {
    const character = getCharacterForUsername(username);
    const canManage = viewerIsHost && username !== invite.sender;
    const card = document.createElement("div");
    card.className = "lobby-player";
    card.classList.toggle("not-joined", !joined.has(username));
    card.innerHTML = `
      ${canManage ? '<button class="player-menu-button" type="button" aria-label="Player menu">☰</button>' : ""}
      <strong>${username === invite.sender ? '<span class="host-crown" aria-label="Host"></span>' : ""}${username}</strong>
      ${characterMarkup(character, "lobby-avatar")}
      <span class="ready-check ${ready.has(username) ? "ready" : ""}" aria-label="${ready.has(username) ? "Ready" : "Not ready"}">✓</span>
      ${canManage ? `
        <div class="player-menu" hidden>
          <button type="button" data-action="kick" data-username="${username}">Kick</button>
          <button type="button" data-action="host" data-username="${username}">Make Host</button>
        </div>
      ` : ""}
    `;
    const menuButton = card.querySelector(".player-menu-button");
    if (menuButton) {
      menuButton.addEventListener("click", () => {
        const menu = card.querySelector(".player-menu");
        menu.hidden = !menu.hidden;
      });
    }
    card.querySelectorAll(".player-menu button").forEach((button) => {
      button.addEventListener("click", () => {
        if (button.dataset.action === "kick") kickLobbyPlayer(invite.id, button.dataset.username);
        if (button.dataset.action === "host") makeLobbyHost(invite.id, button.dataset.username);
      });
    });
    roster.append(card);
  });
}

function kickLobbyPlayer(lobbyId, username) {
  const lobby = getLobbies().find((candidate) => candidate.id === lobbyId);
  if (!lobby || getActiveUsername() !== lobby.sender || username === lobby.sender) return;
  updateLobby(lobbyId, (candidate) => ({
    ...candidate,
    recipient: candidate.recipient === username ? "" : candidate.recipient,
    invitedFormer: username,
    status: "declined",
    declined: true,
    closedFor: Array.from(new Set([...(candidate.closedFor || []), username])),
    joinedFor: (candidate.joinedFor || []).filter((name) => name !== username),
    readyFor: (candidate.readyFor || []).filter((name) => name !== username),
  }));
  setNotifications(getNotifications(username).filter((notice) => notice.id !== lobbyId), username);
  addSystemNotification(username, "Kicked From Lobby", `${lobby.sender} removed you from the lobby.`);
  renderWaitingLobby();
}

function makeLobbyHost(lobbyId, username) {
  const lobby = getLobbies().find((candidate) => candidate.id === lobbyId);
  const activeUser = getActiveUsername();
  if (!lobby || activeUser !== lobby.sender || username === lobby.sender) return;
  updateLobby(lobbyId, (candidate) => ({
    ...candidate,
    sender: username,
    recipient: activeUser,
    status: "accepted",
    declined: false,
    readyFor: [],
    joinedFor: Array.from(new Set([...(candidate.joinedFor || []), username, activeUser])),
  }));
  addSystemNotification(username, "You Are Host", `${activeUser} made you the lobby host.`);
  renderWaitingLobby();
}

function renderLobbyChatPlayers(invite) {
  const container = document.querySelector("#lobbyChatPlayers");
  if (!container) return;
  container.replaceChildren();
  if (!invite) return;
  const activeUser = getActiveUsername();
  const players = lobbyParticipants(invite);
  const ordered = [
    activeUser,
    ...players.filter((username) => username !== activeUser),
  ].filter((username, index, list) => username && players.includes(username) && list.indexOf(username) === index);
  ordered.slice(0, 2).forEach((username) => {
    const card = document.createElement("div");
    card.className = "chat-player";
    card.classList.toggle("other", username !== activeUser);
    card.innerHTML = `
      ${characterMarkup(getCharacterForUsername(username), "chat-avatar")}
      <strong>${username}</strong>
    `;
    container.append(card);
  });
}

function renderWaitingLobby() {
  const invite = getActiveInvite();
  const activeUser = getActiveUsername();
  const accountLabel = document.querySelector("#lobbyAccountLabel");
  if (accountLabel) accountLabel.textContent = activeUser ? `Viewing as ${activeUser}` : "Viewing as you";
  if (!invite) {
    document.querySelector("#lobbyStatusText").textContent = "No active invite selected.";
    document.querySelector("#startLobbyGame").disabled = true;
    document.querySelector("#startLobbyGame").hidden = false;
    document.querySelector("#readyLobbyGame").hidden = true;
    document.querySelector("#returnActiveGame").hidden = true;
    document.querySelector("#lobbyInvitePlayer").hidden = true;
    renderLobbyRoster(null);
    return;
  }
  const accepted = invite.status === "accepted";
  const activeGame = isActiveGameLobby(invite);
  const viewerIsSender = activeUser === invite.sender;
  const friendName = viewerIsSender ? invite.recipient : invite.sender;
  const needsInvite = viewerIsSender && (invite.declined || !invite.recipient);
  const readyFor = new Set(invite.readyFor || []);
  const participants = lobbyParticipants(invite);
  const allReady = accepted && participants.length > 0 && participants.every((username) => readyFor.has(username));
  const canReady = participants.includes(activeUser) && !needsInvite && (accepted || viewerIsSender);
  document.querySelector("#lobbyInvitePlayer").hidden = !needsInvite;
  document.querySelector("#lobbyStatusText").textContent = needsInvite
    ? "Invite a player to play."
    : activeGame
      ? `Game in progress with ${friendName}.`
      : accepted
      ? allReady
        ? `Waiting for ${invite.sender} to start the game.`
        : "Waiting for players to be Ready."
      : `Waiting for ${friendName} to accept the invite.`;
  document.querySelector("#startLobbyGame").hidden = activeGame || !viewerIsSender;
  document.querySelector("#readyLobbyGame").hidden = activeGame || !canReady;
  document.querySelector("#returnActiveGame").hidden = !activeGame;
  document.querySelector("#readyLobbyGame").disabled = false;
  document.querySelector("#readyLobbyGame").textContent = readyFor.has(activeUser) ? "Unready" : "Ready";
  document.querySelector("#readyLobbyGame").classList.toggle("unready-action", readyFor.has(activeUser));
  document.querySelector("#startLobbyGame").disabled = !accepted || needsInvite || !allReady;
  renderLobbyRoster(invite);
}

function renderActiveLobbyPrompts() {
  const container = document.querySelector("#activeLobbyPrompts");
  if (!container) return;
  const username = getActiveUsername();
  const lobbies = activeLobbiesFor(username);
  container.replaceChildren();
  lobbies.forEach((lobby) => {
    const other = lobby.sender === username ? lobby.recipient : lobby.sender;
    const activeGame = isActiveGameLobby(lobby);
    const minimized = (lobby.minimizedFor || []).includes(username);
    const joined = (lobby.joinedFor || []).includes(username);
    const primaryLabel = activeGame ? "Return" : joined ? "Return" : "Join";
    const closeLabel = activeGame ? "Decline" : lobby.sender === username ? "Close Lobby" : "Decline";
    const title = activeGame ? `Return to game with ${other}` : `Open lobby with ${other}`;
    const statusText = activeGame ? "Game in progress" : lobby.status === "accepted" ? "Ready to start" : "Waiting for invite response";
    const row = document.createElement("div");
    row.className = `lobby-prompt${minimized ? " minimized" : ""}`;
    row.innerHTML = minimized
      ? `<strong>${title}</strong><button class="expand-lobby" data-action="open" type="button" aria-label="Expand lobby"></button><button data-action="${activeGame ? "decline-game" : "close"}" type="button">X</button>`
      : `<button class="minimize-lobby" data-action="minimize" type="button" aria-label="Minimize">-</button><strong>${title}</strong><span>${statusText}</span><div class="lobby-prompt-actions"><button class="save-action" data-action="return" type="button">${primaryLabel}</button><button class="overwrite-action" data-action="${activeGame ? "decline-game" : "close"}" type="button">${closeLabel}</button></div>`;
    row.querySelectorAll("button").forEach((button) => {
      button.addEventListener("click", () => handleLobbyPromptAction(lobby.id, button.dataset.action));
    });
    container.append(row);
  });
}

function handleLobbyPromptAction(lobbyId, action) {
  const username = getActiveUsername();
  if (action === "open") {
    updateLobby(lobbyId, (lobby) => ({ ...lobby, minimizedFor: (lobby.minimizedFor || []).filter((name) => name !== username) }));
    renderActiveLobbyPrompts();
    return;
  }
  if (action === "return") {
    const lobby = getLobbies().find((candidate) => candidate.id === lobbyId);
    if (isActiveGameLobby(lobby)) {
      returnToActiveGame(lobbyId);
      return;
    }
    joinLobby(lobbyId, username);
    setActiveInviteId(lobbyId);
    showScreen("waitingLobbyScreen");
    return;
  }
  if (action === "minimize") {
    updateLobby(lobbyId, (lobby) => ({ ...lobby, minimizedFor: Array.from(new Set([...(lobby.minimizedFor || []), username])) }));
    renderActiveLobbyPrompts();
    return;
  }
  if (action === "close") {
    const lobby = getLobbies().find((candidate) => candidate.id === lobbyId);
    if (isActiveGameLobby(lobby)) {
      returnToActiveGame(lobbyId);
      return;
    }
    closeLobbyForUser(lobbyId, username);
    renderActiveLobbyPrompts();
  }
  if (action === "decline-game") {
    pendingDeclineGameLobbyId = lobbyId;
    document.querySelector("#declineGameDialog").showModal();
  }
}

function joinLobby(lobbyId, username) {
  const lobby = updateLobby(lobbyId, (candidate) => ({
    ...candidate,
    status: username === candidate.recipient ? "accepted" : candidate.status,
    unread: username === candidate.recipient ? false : candidate.unread,
    declined: username === candidate.recipient ? false : candidate.declined,
    recipient: candidate.recipient || (username === candidate.sender ? "" : username),
    minimizedFor: (candidate.minimizedFor || []).filter((name) => name !== username),
    joinedFor: Array.from(new Set([...(candidate.joinedFor || []), username])),
  }));
  if (!lobby) return;
  setNotifications(getNotifications(username).filter((notice) => notice.id !== lobbyId), username);
  if (firebaseUser) {
    deleteFirebaseNotification(firebaseUser.uid, lobbyId)
      .then(refreshFirebaseSocialData)
      .catch((error) => console.warn("Unable to clear lobby notification", error));
  }
}

function renderLobbyChat() {
  const log = document.querySelector("#lobbyChatLog");
  if (!log) return;
  subscribeToActiveLobbyChat();
  renderLobbyChatPlayers(getActiveInvite());
  const messages = getLobbyChat();
  log.replaceChildren();
  if (messages.length === 0) {
    const empty = document.createElement("p");
    empty.textContent = "No messages yet.";
    log.append(empty);
    return;
  }
  messages.forEach((message) => {
    const line = document.createElement("p");
    line.className = message.sender === getActiveUsername() ? "mine" : "";
    const sender = document.createElement("strong");
    sender.textContent = message.sender || "Guest";
    const text = document.createElement("span");
    text.textContent = formatChatText(message.text || "");
    line.append(sender, text);
    log.append(line);
  });
  log.scrollTop = log.scrollHeight;
}

function formatChatText(text) {
  return String(text)
    .replaceAll("<3", "\u2661")
    .replaceAll(":)", "\u263A")
    .replaceAll(":(", "\u2639");
}

async function sendLobbyChatMessage() {
  const input = document.querySelector("#lobbyChatInput");
  const text = input.value.trim();
  if (!text) return;
  await sendLobbyChatText(text);
  input.value = "";
  renderLobbyChat();
}

async function sendLobbyChatText(text) {
  const cleanText = String(text).trim().slice(0, 120);
  if (!cleanText) return;
  if (firebaseUser && activeInviteId()) {
    await sendFirebaseLobbyMessage(activeInviteId(), {
      senderUid: firebaseUser.uid,
      sender: getActiveUsername() || "Guest",
      text: cleanText,
    }).catch((error) => {
      console.warn("Unable to send lobby chat message", error);
      showInvalidInput("Could not send that message. Please try again.");
    });
    return;
  }
  const messages = getLobbyChat();
  messages.push({
    sender: getActiveUsername() || "Guest",
    text: cleanText,
    sentAt: new Date().toISOString(),
  });
  setLobbyChat(messages.slice(-40));
}

function renderGlobalMockSwitcher() {
  const label = document.querySelector("#globalMockAccountLabel");
  const button = document.querySelector("#globalSwitchAccount");
  if (!label) return;
  const username = getActiveUsername();
  if (firebaseUser) {
    label.textContent = username ? `Signed in: ${username}` : "Signed in";
  } else {
    label.textContent = localMockAccountsEnabled() && username ? `Local: ${username}` : "Signed out";
  }
  if (button) button.textContent = firebaseUser ? "Sign Out" : (localMockAccountsEnabled() ? "Switch" : "Sign In");
}

function renderMockAccountList() {
  const list = document.querySelector("#mockAccountList");
  const profile = getProfile();
  const seen = new Set();
  const accounts = [];
  if (profile) {
    accounts.push({ username: profile.username, label: "You" });
    seen.add(profile.username);
  }
  getMockUsers().forEach((user) => {
    if (seen.has(user.username)) return;
    accounts.push({ username: user.username, label: "Mock account" });
    seen.add(user.username);
  });
  list.replaceChildren();
  accounts.forEach((account) => {
    const row = document.createElement("div");
    row.className = "account-switch-row";
    row.innerHTML = `
      <div>
        <strong>${account.username}</strong>
        <span>${account.label}</span>
      </div>
      <button type="button" data-action="switch">Switch</button>
      <button type="button" data-action="rename">Rename</button>
      <button type="button" data-action="delete" ${account.username === "humpday" ? "disabled" : ""}>Delete</button>
    `;
    row.querySelector('[data-action="switch"]').addEventListener("click", () => {
      setActiveUsername(account.username);
      document.querySelector("#switchAccountDialog").close();
      playMenuSound();
      if (document.querySelector("#lobbyChatDialog").open) document.querySelector("#lobbyChatDialog").close();
      previousScreen = "mainMenuScreen";
      showScreen(getProfile(account.username) ? "mainMenuScreen" : "profileScreen");
    });
    row.querySelector('[data-action="rename"]').addEventListener("click", () => {
      pendingRenameAccount = account.username;
      document.querySelector("#renameAccountInput").value = account.username;
      document.querySelector("#renameAccountMessage").textContent = "";
      document.querySelector("#renameAccountDialog").showModal();
    });
    row.querySelector('[data-action="delete"]').addEventListener("click", () => {
      deleteAccount(account.username);
      renderMockAccountList();
    });
    list.append(row);
  });
}

function openMockAccountSwitcher() {
  if (firebaseUser) return;
  if (!localMockAccountsEnabled()) {
    previousScreen = "mainMenuScreen";
    showScreen("profileScreen");
    return;
  }
  renderMockAccountList();
  document.querySelector("#switchAccountDialog").showModal();
}

function getSelectedCharacter() {
  if (firebaseUser && firebaseProfile && firebaseProfile.selectedCharacterId) {
    return characters.find((character) => character.id === firebaseProfile.selectedCharacterId) || characters[0];
  }
  const selectedId = readAccountJson(CHARACTER_KEY, "honeyBear");
  return characters.find((character) => character.id === selectedId) || characters[0];
}

function getCharacterForUsername(username) {
  if (firebaseUser && username === getActiveUsername() && firebaseProfile && firebaseProfile.selectedCharacterId) {
    return characters.find((character) => character.id === firebaseProfile.selectedCharacterId) || characters[0];
  }
  const friend = firebaseFriends.find((candidate) => candidate.username === username);
  if (friend && friend.selectedCharacterId) {
    return characters.find((character) => character.id === friend.selectedCharacterId) || characters[0];
  }
  const selectedId = readAccountJson(CHARACTER_KEY, "honeyBear", username);
  return characters.find((character) => character.id === selectedId) || characters[0];
}

function getPlayerCharacter(index) {
  const characterId = game && game.playerCharacters ? game.playerCharacters[index] : "";
  return characters.find((character) => character.id === characterId) || getCharacterForUsername(game.players[index].name);
}

function characterPrice(characterId) {
  const index = characters.findIndex((character) => character.id === characterId);
  if (index <= 0) return 0;
  return 50 + (index * 25);
}

function ownedCharacterIds() {
  if (firebaseUser && firebaseProfile) {
    return Array.from(new Set(["honeyBear", ...(firebaseProfile.ownedCharacterIds || [])]));
  }
  return characters.map((character) => character.id);
}

function ownsCharacter(characterId) {
  return ownedCharacterIds().includes(characterId);
}

function setSelectedCharacter(id) {
  if (firebaseUser && firebaseProfile) {
    firebaseProfile = { ...firebaseProfile, selectedCharacterId: id };
    writeAccountJson(PROFILE_KEY, firebaseProfile, firebaseProfile.username);
    updateUserProfileTransaction(firebaseUser.uid, (remoteProfile) => ({
      ...remoteProfile,
      selectedCharacterId: id,
    })).catch((error) => console.warn("Unable to sync selected character", error));
  }
  writeAccountJson(CHARACTER_KEY, id);
  renderSelectedCharacter();
  renderCharacterStore();
}

async function saveSelectedCharacter() {
  const characterId = pendingCharacterId || getSelectedCharacter().id;
  const character = characters.find((candidate) => candidate.id === characterId);
  if (!character) return false;
  if (!firebaseUser || !firebaseProfile) {
    setSelectedCharacter(characterId);
    return true;
  }
  const currentEconomy = normalizeEconomy(firebaseProfile);
  const price = ownsCharacter(characterId) ? 0 : characterPrice(characterId);
  if (currentEconomy.coins < price) {
    document.querySelector("#storeMessage").textContent = `You need ${coinAmountMarkup(price)} to unlock ${character.name}.`;
    return false;
  }
  const updated = await updateUserProfileTransaction(firebaseUser.uid, (remoteProfile) => {
    const local = localProfileFromFirebaseData(remoteProfile, {
      fallbackUsername: firebaseProfile.username,
      fallbackEmail: firebaseProfile.email || firebaseUser.email || "",
    });
    const economy = normalizeEconomy(local);
    const owned = Array.from(new Set(["honeyBear", ...(local.ownedCharacterIds || [])]));
    const alreadyOwned = owned.includes(characterId);
    const unlockPrice = alreadyOwned ? 0 : characterPrice(characterId);
    if (economy.coins < unlockPrice) {
      return {
        write: firebaseDocumentFromLocalProfile(local),
        result: { ok: false, reason: "coins", required: unlockPrice, characterName: character.name },
      };
    }
    const next = profileWithEconomy(local, {
      coins: economy.coins - unlockPrice,
      selectedCharacterId: characterId,
      ownedCharacterIds: alreadyOwned ? owned : [...owned, characterId],
    });
    return {
      write: firebaseDocumentFromLocalProfile(next),
      result: { ok: true, profile: next, unlocked: !alreadyOwned, spent: unlockPrice },
    };
  });
  if (!updated.ok) {
    document.querySelector("#storeMessage").textContent = `You need ${coinAmountMarkup(updated.required)} to unlock ${updated.characterName}.`;
    return false;
  }
  firebaseProfile = updated.profile;
  writeAccountJson(PROFILE_KEY, firebaseProfile, firebaseProfile.username);
  writeAccountJson(CHARACTER_KEY, characterId, firebaseProfile.username);
  renderSelectedCharacter();
  renderCharacterStore();
  document.querySelector("#storeMessage").textContent = updated.unlocked
    ? `${character.name} unlocked and saved.`
    : `${character.name} saved.`;
  return true;
}

function characterMarkup(character, extraClass = "") {
  return `
    <div class="character-avatar ${character.className} ${extraClass}" aria-hidden="true">
      <span class="ear left"></span>
      <span class="ear right"></span>
      <span class="snout"></span>
      <span class="blush left"></span>
      <span class="blush right"></span>
      <span class="apron"></span>
    </div>
  `;
}

function renderSelectedCharacter() {
  const character = getSelectedCharacter();
  const mascot = document.querySelector("#menuMascot");
  if (!mascot) return;
  mascot.outerHTML = characterMarkup(character, "menu-mascot").replace("<div", '<div id="menuMascot"');
}

function renderCharacterStore() {
  const store = document.querySelector("#characterStore");
  if (!store) return;
  const selected = getSelectedCharacter();
  const progress = profileProgress(getActiveUsername());
  document.querySelector("#storeCoinBalance").innerHTML = coinAmountMarkup(progress.coins);
  if (!pendingCharacterId) pendingCharacterId = selected.id;
  store.replaceChildren();
  characters.forEach((character, index) => {
    const owned = ownsCharacter(character.id);
    const price = characterPrice(character.id);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "character-card";
    button.classList.toggle("selected", character.id === pendingCharacterId);
    button.classList.toggle("locked", !owned);
    button.innerHTML = `
      ${characterMarkup(character)}
      <strong>${character.name}</strong>
      <small>${character.tier} | ${owned ? (character.id === selected.id ? "Saved" : "Owned") : coinAmountMarkup(price)}</small>
    `;
    button.addEventListener("click", () => {
      pendingCharacterId = character.id;
      document.querySelector("#storeMessage").innerHTML = owned
        ? `${character.name} selected. Tap Save Character to keep it for ${getActiveUsername()}.`
        : `${character.name} costs ${coinAmountMarkup(price)}. Tap Save Character to unlock it.`;
      renderCharacterStore();
      playMenuSound();
    });
    store.append(button);
  });
}

document.querySelector("#menuNewGame").addEventListener("click", () => showScreen("modeScreen"));
document.querySelector("#menuNewGame").addEventListener("click", playMenuSound);
document.querySelector("#menuLoadGame").addEventListener("click", () => showScreen("loadScreen"));
document.querySelector("#menuLoadGame").addEventListener("click", playMenuSound);
document.querySelector("#menuStore").addEventListener("click", () => showScreen("storeScreen"));
document.querySelector("#menuStore").addEventListener("click", playMenuSound);
document.querySelector("#menuFriends").addEventListener("click", () => requireProfile("friendsScreen"));
document.querySelector("#menuFriends").addEventListener("click", playMenuSound);
document.querySelector("#menuNotifications").addEventListener("click", () => requireProfile("notificationsScreen"));
document.querySelector("#menuNotifications").addEventListener("click", playMenuSound);
document.querySelector("#menuProfile").addEventListener("click", () => {
  previousScreen = "mainMenuScreen";
  showScreen("profileScreen");
});
document.querySelector("#menuProfile").addEventListener("click", playMenuSound);
document.querySelector("#menuSettings").addEventListener("click", () => {
  previousScreen = "mainMenuScreen";
  showScreen("settingsScreen");
});
document.querySelector("#menuSettings").addEventListener("click", playMenuSound);
document.querySelector("#standardMode").addEventListener("click", () => chooseMode("Standard Mode"));
document.querySelector("#standardMode").addEventListener("click", playMenuSound);
document.querySelector("#powerMode").addEventListener("click", () => chooseMode("Power Up Mode"));
document.querySelector("#powerMode").addEventListener("click", playMenuSound);
document.querySelector("#modeBack").addEventListener("click", () => showScreen("mainMenuScreen"));
document.querySelector("#modeBack").addEventListener("click", playMenuSound);
document.querySelector("#submodeBack").addEventListener("click", () => showScreen("modeScreen"));
document.querySelector("#submodeBack").addEventListener("click", playMenuSound);
document.querySelector("#passPlayMode").addEventListener("click", () => {
  pendingSubmode = "Pass and Play";
  pendingInviteFriendId = "";
  beginGameFlow("submodeScreen");
});
document.querySelector("#passPlayMode").addEventListener("click", playMenuSound);
document.querySelector("#separateDevicesMode").addEventListener("click", openSeparateDevicesInvite);
document.querySelector("#separateDevicesMode").addEventListener("click", playMenuSound);
document.querySelector("#loadBack").addEventListener("click", () => showScreen("mainMenuScreen"));
document.querySelector("#loadBack").addEventListener("click", playMenuSound);
document.querySelector("#storeBack").addEventListener("click", () => showScreen("mainMenuScreen"));
document.querySelector("#storeBack").addEventListener("click", playMenuSound);
document.querySelector("#saveCharacter").addEventListener("click", async () => {
  if (await saveSelectedCharacter()) {
    const character = characters.find((candidate) => candidate.id === (pendingCharacterId || getSelectedCharacter().id)) || getSelectedCharacter();
    if (!firebaseUser) document.querySelector("#storeMessage").textContent = `Saved ${character.name} for ${getActiveUsername()}.`;
  }
});
document.querySelector("#saveCharacter").addEventListener("click", playMenuSound);
document.querySelector("#friendsBack").addEventListener("click", () => showScreen("mainMenuScreen"));
document.querySelector("#friendsBack").addEventListener("click", playMenuSound);
document.querySelector("#openAddFriend").addEventListener("click", () => {
  document.querySelector("#friendUsername").value = "";
  document.querySelector("#addFriendMessage").textContent = "";
  document.querySelector("#addFriendDialog").showModal();
});
document.querySelector("#openAddFriend").addEventListener("click", playMenuSound);
document.querySelector("#notificationsBack").addEventListener("click", () => showScreen("mainMenuScreen"));
document.querySelector("#notificationsBack").addEventListener("click", playMenuSound);
document.querySelector("#globalSwitchAccount").addEventListener("click", async () => {
  if (firebaseUser) {
    await signOutCurrentUser();
    return;
  }
  openMockAccountSwitcher();
});
document.querySelector("#globalSwitchAccount").addEventListener("click", playMenuSound);
const switchMockAccount = document.querySelector("#switchMockAccount");
if (switchMockAccount) {
  switchMockAccount.addEventListener("click", openMockAccountSwitcher);
  switchMockAccount.addEventListener("click", playMenuSound);
}
const lobbySwitchAccount = document.querySelector("#lobbySwitchAccount");
if (lobbySwitchAccount) {
  lobbySwitchAccount.addEventListener("click", openMockAccountSwitcher);
  lobbySwitchAccount.addEventListener("click", playMenuSound);
}
document.querySelector("#lobbyInvitePlayer").addEventListener("click", () => {
  renderInviteFriendList();
  document.querySelector("#inviteFriendDialog").showModal();
});
document.querySelector("#lobbyInvitePlayer").addEventListener("click", playMenuSound);
document.querySelector("#openLobbyChat").addEventListener("click", () => {
  renderLobbyChat();
  document.querySelector("#lobbyChatDialog").showModal();
});
document.querySelector("#openLobbyChat").addEventListener("click", playMenuSound);
document.querySelector("#sendLobbyChat").addEventListener("click", (event) => {
  event.preventDefault();
  sendLobbyChatMessage();
});
document.querySelector("#sendLobbyChat").addEventListener("click", playMenuSound);
document.querySelector("#lobbyEmojiRow").addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  await sendLobbyChatText(button.dataset.emoji);
  renderLobbyChat();
  playMenuSound();
});
document.querySelector("#confirmRenameAccount").addEventListener("click", (event) => {
  event.preventDefault();
  const nextName = normalizeIdentity(document.querySelector("#renameAccountInput").value);
  if (!nextName) {
    document.querySelector("#renameAccountMessage").textContent = "Username is required.";
    return;
  }
  if (!renameAccount(pendingRenameAccount, nextName)) {
    document.querySelector("#renameAccountMessage").textContent = "That username is unavailable.";
    return;
  }
  document.querySelector("#renameAccountDialog").close();
  renderMockAccountList();
});
document.querySelector("#confirmRenameAccount").addEventListener("click", playMenuSound);
document.querySelector("#confirmHandleEdit").addEventListener("click", (event) => {
  event.preventDefault();
  const value = document.querySelector("#editHandleInput").value.trim();
  const updated = pendingHandleEdit === "tag" ? updateProfileTag(value) : updateProfileUsername(value);
  if (!updated) return;
  document.querySelector("#editHandleDialog").close();
  renderProfile();
  renderGlobalMockSwitcher();
});
document.querySelector("#confirmHandleEdit").addEventListener("click", playMenuSound);
document.querySelector("#lobbyBack").addEventListener("click", () => {
  const invite = getActiveInvite();
  const activeUser = getActiveUsername();
  document.querySelector("#closeLobby").textContent = invite && activeUser !== invite.sender ? "Leave Lobby" : "Close Lobby";
  document.querySelector("#lobbyBackDialog").showModal();
});
document.querySelector("#lobbyBack").addEventListener("click", playMenuSound);
document.querySelector("#returnLaterLobby").addEventListener("click", (event) => {
  event.preventDefault();
  document.querySelector("#lobbyBackDialog").close();
  const invite = getActiveInvite();
  if (isActiveGameLobby(invite)) markGamePlayerLeft(getActiveUsername());
  unreadyActiveLobby();
  showScreen("mainMenuScreen");
});
document.querySelector("#returnLaterLobby").addEventListener("click", playMenuSound);
document.querySelector("#closeLobby").addEventListener("click", (event) => {
  event.preventDefault();
  document.querySelector("#lobbyBackDialog").close();
  closeLobbyForUser(activeInviteId(), getActiveUsername());
  showScreen("mainMenuScreen");
});
document.querySelector("#closeLobby").addEventListener("click", playMenuSound);
document.querySelector("#startLobbyGame").addEventListener("click", () => {
  const invite = getActiveInvite();
  if (!invite || invite.status !== "accepted" || !invite.recipient || getActiveUsername() !== invite.sender) return;
  const readyFor = new Set(invite.readyFor || []);
  if (!lobbyParticipants(invite).every((username) => readyFor.has(username))) return;
  pendingMode = invite.mode;
  pendingSubmode = "Separate Devices";
  pendingInviteFriendId = (getFriends().find((friend) => friend.username === invite.recipient) || {}).id || "";
  beginGameFlow("waitingLobbyScreen");
});
document.querySelector("#startLobbyGame").addEventListener("click", playMenuSound);
document.querySelector("#returnActiveGame").addEventListener("click", () => {
  const invite = getActiveInvite();
  if (!invite) return;
  returnToActiveGame(invite.id);
});
document.querySelector("#returnActiveGame").addEventListener("click", playMenuSound);
document.querySelector("#confirmDeclineGame").addEventListener("click", () => {
  document.querySelector("#declineGameDialog").close();
  forfeitActiveGameFor(getActiveUsername(), pendingDeclineGameLobbyId);
  pendingDeclineGameLobbyId = "";
});
document.querySelector("#confirmDeclineGame").addEventListener("click", playMenuSound);
document.querySelector("#readyLobbyGame").addEventListener("click", () => {
  const invite = getActiveInvite();
  const activeUser = getActiveUsername();
  if (!invite) return;
  const canReady = lobbyParticipants(invite).includes(activeUser) && (invite.status === "accepted" || activeUser === invite.sender);
  if (!canReady) return;
  updateLobby(invite.id, (lobby) => ({
    ...lobby,
    readyFor: (lobby.readyFor || []).includes(activeUser)
      ? (lobby.readyFor || []).filter((name) => name !== activeUser)
      : Array.from(new Set([...(lobby.readyFor || []), activeUser])),
  }));
  renderWaitingLobby();
});
document.querySelector("#readyLobbyGame").addEventListener("click", playMenuSound);
document.querySelector("#deleteAllNotifications").addEventListener("click", async () => {
  if (firebaseUser) {
    await Promise.all(getNotifications().map((notice) => deleteFirebaseNotification(firebaseUser.uid, notice.id)));
    await refreshFirebaseSocialData();
  } else {
    setNotifications([]);
  }
  renderNotifications();
  renderNotificationBadge();
});
document.querySelector("#deleteAllNotifications").addEventListener("click", playMenuSound);
document.querySelector("#profileBack").addEventListener("click", () => {
  const profile = getProfile();
  if (!profile) {
    document.querySelector("#profileMessage").textContent = "Profile setup is required before using the app.";
    return;
  }
  showScreen(previousScreen);
});
document.querySelector("#profileBack").addEventListener("click", playMenuSound);
document.querySelector("#saveProfile").addEventListener("click", async () => {
  if (await saveProfile() && getProfile()) showScreen(previousScreen);
});
document.querySelector("#saveProfile").addEventListener("click", playMenuSound);
document.querySelector("#sendVerification").addEventListener("click", async () => {
  if (await saveProfile() && getProfile()) showScreen(previousScreen);
});
document.querySelector("#sendVerification").addEventListener("click", playMenuSound);
document.querySelector("#verifyCode").addEventListener("click", async () => {
  if (await signInFromProfileFields() && getProfile()) showScreen("mainMenuScreen");
});
document.querySelector("#verifyCode").addEventListener("click", playMenuSound);
document.querySelector("#deleteFirebaseAccount").addEventListener("click", () => {
  document.querySelector("#deleteAccountMessage").textContent = "";
  document.querySelector("#deleteAccountDialog").showModal();
});
document.querySelector("#deleteFirebaseAccount").addEventListener("click", playMenuSound);
document.querySelector("#confirmDeleteFirebaseAccount").addEventListener("click", async (event) => {
  event.preventDefault();
  await deleteSignedInFirebaseAccount();
});
document.querySelector("#confirmDeleteFirebaseAccount").addEventListener("click", playMenuSound);
// Mock testing only. Remove this block when mock profile controls are no longer needed.
document.querySelector("#resetMockLevel").addEventListener("click", () => {
  resetProfileProgress(getActiveUsername());
  document.querySelector("#profileMessage").textContent = "Mock level, XP, and win streak reset.";
  renderProfile();
});
document.querySelector("#resetMockLevel").addEventListener("click", playMenuSound);
document.querySelector("#resetMockCoins").addEventListener("click", () => {
  resetMockCoins(getActiveUsername());
  document.querySelector("#profileMessage").innerHTML = `Mock ${coinIconMarkup()} reset.`;
  renderProfile();
});
document.querySelector("#resetMockCoins").addEventListener("click", playMenuSound);
document.querySelector("#addFriend").addEventListener("click", async (event) => {
  event.preventDefault();
  await addFriendFromFields();
});
document.querySelector("#addFriend").addEventListener("click", playMenuSound);
document.querySelector("#inviteAddFriend").addEventListener("click", () => {
  document.querySelector("#inviteFriendDialog").close();
  showScreen("friendsScreen");
});
document.querySelector("#inviteAddFriend").addEventListener("click", playMenuSound);
document.querySelector("#settingsBack").addEventListener("click", () => {
  if (previousScreen === "gameScreen") clearForfeitAbsence(getActiveUsername());
  showScreen(previousScreen);
});
document.querySelector("#settingsBack").addEventListener("click", playMenuSound);
document.querySelector("#resetSettings").addEventListener("click", () => {
  setSettings({ ...defaultSettings });
  renderSettings();
});
document.querySelector("#resetSettings").addEventListener("click", playMenuSound);
document.querySelector("#openPrivacyPolicy").addEventListener("click", () => openLegalDialog("privacy"));
document.querySelector("#openPrivacyPolicy").addEventListener("click", playMenuSound);
document.querySelector("#openTerms").addEventListener("click", () => openLegalDialog("terms"));
document.querySelector("#openTerms").addEventListener("click", playMenuSound);
document.querySelector("#openSupport").addEventListener("click", () => openLegalDialog("support"));
document.querySelector("#openSupport").addEventListener("click", playMenuSound);
document.querySelector("#musicVolume").addEventListener("input", (event) => updateSetting("musicVolume", Number(event.target.value)));
document.querySelector("#sfxVolume").addEventListener("input", (event) => updateSetting("sfxVolume", Number(event.target.value)));
document.querySelector("#reduceMotion").addEventListener("change", (event) => updateSetting("reduceMotion", event.target.checked));
document.querySelector("#showHints").addEventListener("change", (event) => updateSetting("showHints", event.target.checked));
document.querySelector("#gameMenuButton").addEventListener("click", () => {
  const menu = document.querySelector("#gameMenuDropdown");
  menu.hidden = !menu.hidden;
});
document.querySelector("#gameMenuButton").addEventListener("click", playMenuSound);
document.querySelector("#gameReturnMenu").addEventListener("click", requestReturnToMenu);
document.querySelector("#gameReturnMenu").addEventListener("click", playMenuSound);
document.querySelector("#gameSettings").addEventListener("click", () => {
  if (game && game.submode === "Separate Devices" && !game.over) markGamePlayerLeft(getActiveUsername());
  previousScreen = "gameScreen";
  showScreen("settingsScreen");
});
document.querySelector("#gameSettings").addEventListener("click", playMenuSound);
document.querySelector("#endTurn").addEventListener("click", () => playSound("endTurn"));
document.querySelector("#endTurn").addEventListener("click", endTurn);
document.querySelector("#hideForfeitTimer").addEventListener("click", () => {
  forfeitTimerHidden = true;
  document.querySelector("#forfeitTimerPanel").hidden = true;
});
document.querySelector("#messageLog").addEventListener("click", () => {
  document.querySelector("#messageLog").classList.add("expanded");
  renderLog();
});
document.querySelector("#newGame").addEventListener("click", closeGameLobbyForActivePlayer);
document.querySelector("#newGame").addEventListener("click", () => showScreen("modeScreen"));
document.querySelector("#newGame").addEventListener("click", playMenuSound);
document.querySelector("#returnToLobby").addEventListener("click", (event) => {
  event.preventDefault();
  document.querySelector("#gameOverDialog").close();
  returnToGameLobby();
});
document.querySelector("#returnToLobby").addEventListener("click", playMenuSound);
document.querySelector("#gameOverMenu").addEventListener("click", () => {
  closeGameLobbyForActivePlayer();
  game = null;
  showScreen("mainMenuScreen");
});
document.querySelector("#gameOverMenu").addEventListener("click", playMenuSound);
document.querySelector("#hostClosedOkay").addEventListener("click", () => {
  if (pendingHostClosedNoticeId) {
    setNotifications(getNotifications().filter((notice) => notice.id !== pendingHostClosedNoticeId));
    pendingHostClosedNoticeId = "";
    renderNotificationBadge();
  }
  showScreen("mainMenuScreen");
});
document.querySelector("#hostClosedOkay").addEventListener("click", playMenuSound);
document.querySelector("#saveAndLeave").addEventListener("click", (event) => {
  event.preventDefault();
  const saveFields = document.querySelector("#saveNameFields");
  if (saveFields.hidden) {
    showSaveNameStep();
    return;
  }
  document.querySelector("#savePromptDialog").close();
  saveAndReturn();
});
document.querySelector("#saveAndLeave").addEventListener("click", playMenuSound);
document.querySelector("#savePromptBack").addEventListener("click", (event) => {
  const saveFields = document.querySelector("#saveNameFields");
  if (!saveFields.hidden) {
    event.preventDefault();
    saveFields.hidden = true;
    document.querySelector("#leaveWithoutSave").hidden = false;
    document.querySelector("#leaveWithoutSave").focus();
  }
});
document.querySelector("#savePromptBack").addEventListener("click", playMenuSound);
document.querySelector("#leaveWithoutSave").addEventListener("click", () => {
  if (game && game.submode === "Separate Devices" && !game.over) {
    markGamePlayerLeft(getActiveUsername());
  } else {
    closeGameLobbyForActivePlayer();
    game = null;
  }
  showScreen("mainMenuScreen");
});
document.querySelector("#leaveWithoutSave").addEventListener("click", playMenuSound);
document.querySelector("#existingSaveBack").addEventListener("click", (event) => {
  event.preventDefault();
  document.querySelector("#existingSaveDialog").close();
  showSaveNameStep();
});
document.querySelector("#existingSaveBack").addEventListener("click", playMenuSound);
document.querySelector("#overwriteExistingSave").addEventListener("click", (event) => {
  event.preventDefault();
  document.querySelector("#existingSaveDialog").close();
  overwriteCurrentSaveAndReturn();
});
document.querySelector("#overwriteExistingSave").addEventListener("click", playMenuSound);
document.querySelector("#createSeparateSave").addEventListener("click", (event) => {
  event.preventDefault();
  document.querySelector("#existingSaveDialog").close();
  createNewSaveAndReturn();
});
document.querySelector("#createSeparateSave").addEventListener("click", playMenuSound);
document.querySelector("#overwriteBack").addEventListener("click", (event) => {
  event.preventDefault();
  document.querySelector("#overwriteDialog").close();
  if (overwriteBackTarget === "existingSave") {
    const existingSave = getCurrentSave();
    document.querySelector("#existingSaveText").textContent = existingSave
      ? `"${existingSave.name}" already exists. Overwrite it or create a new save file?`
      : "This game already has a save file.";
    document.querySelector("#existingSaveDialog").showModal();
    return;
  }
  showSaveNameStep();
});
document.querySelector("#overwriteBack").addEventListener("click", playMenuSound);
document.querySelector("#confirmRenameSave").addEventListener("click", (event) => {
  event.preventDefault();
  document.querySelector("#renameSaveDialog").close();
  renameSave(pendingRenameId, document.querySelector("#renameSaveInput").value.trim());
});
document.querySelector("#confirmRenameSave").addEventListener("click", playMenuSound);
document.querySelector("#playCardButton").addEventListener("click", (event) => {
  event.preventDefault();
  document.querySelector("#cardDetailDialog").close();
  playPendingCard();
});
document.querySelector("#startNoticeGame").addEventListener("click", (event) => {
  event.preventDefault();
  document.querySelector("#startupNoticeDialog").close();
  playMenuSound();
  startNewGame();
});
document.querySelector("#backStartupNotice").addEventListener("click", () => {
  document.querySelector("#startupNoticeDialog").close();
  playMenuSound();
  showScreen(pendingStartupBackScreen);
});

function chooseMode(mode) {
  pendingMode = mode;
  document.querySelector("#submodeModeLabel").textContent = mode;
  showScreen("submodeScreen");
}

function playMenuSound() {
  playSound("menu");
}

runEconomyResetMigration();
resetSleepyPandaMockAccount();
setSettings(getSettings());
previousScreen = "mainMenuScreen";
showScreen("profileScreen");
startFirebaseAuthListener();
