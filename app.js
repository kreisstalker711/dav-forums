// ============================================================
// app.js — Main application logic
// Features: Auth, Channel Chat, Direct Messages (DMs)
// ============================================================

import {
  auth, db,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
  collection,
  addDoc,
  doc,
  setDoc,
  getDoc,
  getDocs,
  query,
  orderBy,
  onSnapshot,
  serverTimestamp,
} from "./firebase.js";

// ─── STATE ───────────────────────────────────────────────────
let currentUser     = null;
let activeChannel   = "general";
let activeDMUserId  = null;   // uid of person we're DMing
let activeDMName    = null;   // display name of person we're DMing
let chatMode        = "channel"; // "channel" | "dm"
let unsubMessages   = null;

// ─── CHANNELS ────────────────────────────────────────────────
const CHANNELS = [
  { id: "general",       icon: "💬", label: "general" },
  { id: "coding",        icon: "💻", label: "coding" },
  { id: "announcements", icon: "📢", label: "announcements" },
  { id: "random",        icon: "🎲", label: "random" },
  { id: "design",        icon: "🎨", label: "design" },
];

// ─── DOM REFS ─────────────────────────────────────────────────
const authScreen    = document.getElementById("auth-screen");
const appScreen     = document.getElementById("app-screen");
const loginForm     = document.getElementById("login-form");
const signupForm    = document.getElementById("signup-form");
const tabLogin      = document.getElementById("tab-login");
const tabSignup     = document.getElementById("tab-signup");
const loginError    = document.getElementById("login-error");
const signupError   = document.getElementById("signup-error");
const channelList   = document.getElementById("channel-list");
const dmList        = document.getElementById("dm-list");
const channelTitle  = document.getElementById("channel-title");
const messagesArea  = document.getElementById("messages-area");
const messageInput  = document.getElementById("message-input");
const sendBtn       = document.getElementById("send-btn");
const logoutBtn     = document.getElementById("logout-btn");
const userDisplay   = document.getElementById("user-display");
const userAvatar    = document.getElementById("user-avatar");
const dmSearchInput = document.getElementById("dm-search");
const dmSearchBtn   = document.getElementById("dm-search-btn");

// ─── AUTH TABS ────────────────────────────────────────────────
tabLogin.addEventListener("click", () => {
  tabLogin.classList.add("active");
  tabSignup.classList.remove("active");
  loginForm.classList.add("active");
  signupForm.classList.remove("active");
  loginError.textContent = "";
});

tabSignup.addEventListener("click", () => {
  tabSignup.classList.add("active");
  tabLogin.classList.remove("active");
  signupForm.classList.add("active");
  loginForm.classList.remove("active");
  signupError.textContent = "";
});

// ─── LOGIN ────────────────────────────────────────────────────
loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.textContent = "";
  const email    = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  const btn      = loginForm.querySelector("button[type=submit]");
  btn.textContent = "Signing in…";
  btn.disabled = true;
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    loginError.textContent = friendlyError(err.code);
    btn.textContent = "Sign In";
    btn.disabled = false;
  }
});

// ─── SIGN UP ──────────────────────────────────────────────────
signupForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  signupError.textContent = "";
  const username = document.getElementById("signup-username").value.trim();
  const email    = document.getElementById("signup-email").value.trim();
  const password = document.getElementById("signup-password").value;
  const btn      = signupForm.querySelector("button[type=submit]");

  if (!username || username.length < 2) {
    signupError.textContent = "Username must be at least 2 characters.";
    return;
  }
  btn.textContent = "Creating account…";
  btn.disabled = true;
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(cred.user, { displayName: username });
    // Save user profile to Firestore so others can find them
    await setDoc(doc(db, "users", cred.user.uid), {
      uid: cred.user.uid,
      username,
      email,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    signupError.textContent = friendlyError(err.code);
    btn.textContent = "Create Account";
    btn.disabled = false;
  }
});

// ─── LOGOUT ───────────────────────────────────────────────────
logoutBtn.addEventListener("click", async () => {
  if (unsubMessages) unsubMessages();
  await signOut(auth);
});

// ─── AUTH STATE ───────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    // Ensure user doc exists (for users who signed up before DM feature)
    const uDoc = await getDoc(doc(db, "users", user.uid));
    if (!uDoc.exists()) {
      await setDoc(doc(db, "users", user.uid), {
        uid: user.uid,
        username: user.displayName || user.email.split("@")[0],
        email: user.email,
        createdAt: serverTimestamp(),
      });
    }
    showApp(user);
  } else {
    currentUser = null;
    showAuth();
  }
});

// ─── SHOW / HIDE SCREENS ─────────────────────────────────────
function showApp(user) {
  authScreen.classList.add("hidden");
  appScreen.classList.remove("hidden");
  const name = user.displayName || user.email.split("@")[0];
  userDisplay.textContent = name;
  userAvatar.textContent  = name.charAt(0).toUpperCase();
  buildChannelList();
  switchChannel("general");
  loadDMList();
}

function showAuth() {
  appScreen.classList.add("hidden");
  authScreen.classList.remove("hidden");
  loginForm.reset();
  signupForm.reset();
}

// ─── CHANNEL LIST ─────────────────────────────────────────────
function buildChannelList() {
  channelList.innerHTML = "";
  CHANNELS.forEach(({ id, icon, label }) => {
    const li = document.createElement("li");
    li.className = "channel-item" + (id === activeChannel && chatMode === "channel" ? " active" : "");
    li.dataset.channel = id;
    li.innerHTML = `<span class="ch-icon">${icon}</span><span class="ch-name">${label}</span>`;
    li.addEventListener("click", () => switchChannel(id));
    channelList.appendChild(li);
  });
}

// ─── SWITCH CHANNEL ───────────────────────────────────────────
function switchChannel(channelId) {
  chatMode      = "channel";
  activeChannel = channelId;
  activeDMUserId = null;

  document.querySelectorAll(".channel-item").forEach(el =>
    el.classList.toggle("active", el.dataset.channel === channelId)
  );
  document.querySelectorAll(".dm-item").forEach(el =>
    el.classList.remove("active")
  );

  const ch = CHANNELS.find(c => c.id === channelId);
  channelTitle.innerHTML = `<span class="ch-title-icon">${ch.icon}</span> #${ch.label}`;
  messageInput.placeholder = `Message #${ch.label}`;

  messagesArea.innerHTML = "";
  if (unsubMessages) unsubMessages();
  subscribeChannelMessages(channelId);
  messageInput.focus();
}

// ─── CHANNEL MESSAGES ─────────────────────────────────────────
function subscribeChannelMessages(channelId) {
  const q = query(
    collection(db, "channels", channelId, "messages"),
    orderBy("timestamp", "asc")
  );
  unsubMessages = onSnapshot(q, (snap) => {
    snap.docChanges().forEach(change => {
      if (change.type === "added") renderMessage(change.doc.data(), change.doc.id, "channel");
    });
    scrollToBottom();
  });
}

// ─── DM LIST ─────────────────────────────────────────────────
async function loadDMList() {
  dmList.innerHTML = `<li class="dm-placeholder">Search a username above to start a DM</li>`;
  // Load recent DM conversations from Firestore
  try {
    const snap = await getDocs(collection(db, "users", currentUser.uid, "dmConversations"));
    if (!snap.empty) {
      dmList.innerHTML = "";
      snap.forEach(d => {
        const data = d.data();
        addDMItem(data.uid, data.username);
      });
    }
  } catch (e) {
    // no conversations yet
  }
}

function addDMItem(uid, username) {
  // Remove placeholder
  const placeholder = dmList.querySelector(".dm-placeholder");
  if (placeholder) placeholder.remove();

  // Avoid duplicates
  if (document.querySelector(`[data-dmuid="${uid}"]`)) return;

  const li = document.createElement("li");
  li.className = "dm-item";
  li.dataset.dmuid = uid;
  li.innerHTML = `
    <div class="dm-avatar">${username.charAt(0).toUpperCase()}</div>
    <span class="dm-name">${escapeHtml(username)}</span>
  `;
  li.addEventListener("click", () => openDM(uid, username));
  dmList.appendChild(li);
}

// ─── DM SEARCH ───────────────────────────────────────────────
dmSearchBtn.addEventListener("click", searchUser);
dmSearchInput.addEventListener("keydown", e => { if (e.key === "Enter") searchUser(); });

async function searchUser() {
  const query_str = dmSearchInput.value.trim();
  if (!query_str) return;

  dmSearchBtn.textContent = "…";
  dmSearchBtn.disabled = true;

  try {
    // Search by username in users collection
    const snap = await getDocs(collection(db, "users"));
    let found = null;
    snap.forEach(d => {
      const data = d.data();
      if (
        data.username?.toLowerCase() === query_str.toLowerCase() &&
        data.uid !== currentUser.uid
      ) {
        found = data;
      }
    });

    if (found) {
      dmSearchInput.value = "";
      // Save to dmConversations for both users
      await setDoc(
        doc(db, "users", currentUser.uid, "dmConversations", found.uid),
        { uid: found.uid, username: found.username }
      );
      addDMItem(found.uid, found.username);
      openDM(found.uid, found.username);
    } else {
      showToast(`No user found: "${query_str}"`);
    }
  } catch (err) {
    showToast("Search failed. Try again.");
  }

  dmSearchBtn.textContent = "→";
  dmSearchBtn.disabled = false;
}

// ─── OPEN DM ─────────────────────────────────────────────────
async function openDM(uid, username) {
  chatMode       = "dm";
  activeDMUserId = uid;
  activeDMName   = username;

  document.querySelectorAll(".channel-item").forEach(el => el.classList.remove("active"));
  document.querySelectorAll(".dm-item").forEach(el =>
    el.classList.toggle("active", el.dataset.dmuid === uid)
  );

  channelTitle.innerHTML = `<div class="dm-header-avatar">${username.charAt(0).toUpperCase()}</div> ${escapeHtml(username)}`;
  messageInput.placeholder = `Message ${username}`;

  messagesArea.innerHTML = "";
  if (unsubMessages) unsubMessages();
  subscribeDMMessages(uid);
  messageInput.focus();

  // Save conversation reference on their side too
  await setDoc(
    doc(db, "users", uid, "dmConversations", currentUser.uid),
    {
      uid: currentUser.uid,
      username: currentUser.displayName || currentUser.email.split("@")[0]
    }
  );
}

// ─── DM MESSAGES ─────────────────────────────────────────────
function getDMRoomId(uid1, uid2) {
  // Deterministic room ID — same for both users
  return [uid1, uid2].sort().join("_");
}

function subscribeDMMessages(otherUid) {
  const roomId = getDMRoomId(currentUser.uid, otherUid);
  const q = query(
    collection(db, "dms", roomId, "messages"),
    orderBy("timestamp", "asc")
  );
  unsubMessages = onSnapshot(q, (snap) => {
    snap.docChanges().forEach(change => {
      if (change.type === "added") renderMessage(change.doc.data(), change.doc.id, "dm");
    });
    scrollToBottom();
  });
}

// ─── SEND MESSAGE ─────────────────────────────────────────────
async function sendMessage() {
  const text = messageInput.value.trim();
  if (!text || !currentUser) return;

  const username = currentUser.displayName || currentUser.email.split("@")[0];
  messageInput.value = "";
  messageInput.style.height = "auto";

  try {
    if (chatMode === "channel") {
      await addDoc(collection(db, "channels", activeChannel, "messages"), {
        username,
        uid: currentUser.uid,
        text,
        timestamp: serverTimestamp(),
      });
    } else if (chatMode === "dm" && activeDMUserId) {
      const roomId = getDMRoomId(currentUser.uid, activeDMUserId);
      await addDoc(collection(db, "dms", roomId, "messages"), {
        username,
        uid: currentUser.uid,
        text,
        timestamp: serverTimestamp(),
      });
    }
  } catch (err) {
    console.error("Send failed:", err);
    messageInput.value = text;
  }
}

messageInput.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});
sendBtn.addEventListener("click", sendMessage);

messageInput.addEventListener("input", () => {
  messageInput.style.height = "auto";
  messageInput.style.height = Math.min(messageInput.scrollHeight, 160) + "px";
});

// ─── RENDER MESSAGE ───────────────────────────────────────────
function renderMessage(data, docId, type) {
  if (document.getElementById(`msg-${docId}`)) return;

  const { username, text, timestamp, uid } = data;
  const time  = timestamp ? formatTime(timestamp.toDate()) : "just now";
  const isOwn = uid === currentUser?.uid;

  const div = document.createElement("div");
  div.id = `msg-${docId}`;
  div.className = `message ${isOwn ? "own" : ""}`;

  // Color the avatar based on username hash for variety
  const colorIndex = hashCode(username || "?") % 6;
  const avatarClass = `avatar-color-${colorIndex}`;

  div.innerHTML = `
    <div class="msg-avatar ${avatarClass}">${(username || "?").charAt(0).toUpperCase()}</div>
    <div class="msg-body">
      <div class="msg-header">
        <span class="msg-username ${isOwn ? "own-name" : ""}">${escapeHtml(username)}</span>
        <span class="msg-time">${time}</span>
        ${type === "channel" && !isOwn ? `<button class="dm-quick-btn" data-uid="${uid}" data-name="${escapeHtml(username)}" title="Send DM">✉</button>` : ""}
      </div>
      <div class="msg-text">${formatText(text)}</div>
    </div>
  `;

  // Quick DM button handler
  const dmBtn = div.querySelector(".dm-quick-btn");
  if (dmBtn) {
    dmBtn.addEventListener("click", () => {
      openDM(dmBtn.dataset.uid, dmBtn.dataset.name);
      addDMItem(dmBtn.dataset.uid, dmBtn.dataset.name);
      setDoc(
        doc(db, "users", currentUser.uid, "dmConversations", dmBtn.dataset.uid),
        { uid: dmBtn.dataset.uid, username: dmBtn.dataset.name }
      );
    });
  }

  messagesArea.appendChild(div);
  requestAnimationFrame(() => div.classList.add("visible"));
}

// ─── SCROLL ───────────────────────────────────────────────────
function scrollToBottom() {
  messagesArea.scrollTo({ top: messagesArea.scrollHeight, behavior: "smooth" });
}

// ─── TOAST ────────────────────────────────────────────────────
function showToast(msg) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add("show"));
  setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 300); }, 3000);
}

// ─── HELPERS ─────────────────────────────────────────────────
function formatTime(date) {
  const today = new Date();
  const isToday = date.toDateString() === today.toDateString();
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return isToday ? `Today at ${time}` : date.toLocaleDateString() + " " + time;
}

function formatText(str) {
  // Basic markdown: **bold**, `code`, escape HTML
  return escapeHtml(str)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`(.+?)`/g, "<code>$1</code>");
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function friendlyError(code) {
  const map = {
    "auth/invalid-email":          "Please enter a valid email address.",
    "auth/user-not-found":         "No account found with that email.",
    "auth/wrong-password":         "Incorrect password. Try again.",
    "auth/email-already-in-use":   "An account with this email already exists.",
    "auth/weak-password":          "Password must be at least 6 characters.",
    "auth/too-many-requests":      "Too many attempts. Please wait a moment.",
    "auth/invalid-credential":     "Invalid email or password.",
    "auth/network-request-failed": "Network error. Check your connection.",
  };
  return map[code] || "Something went wrong. Please try again.";
}

function hashCode(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = Math.imul(31, h) + str.charCodeAt(i) | 0;
  return Math.abs(h);
}