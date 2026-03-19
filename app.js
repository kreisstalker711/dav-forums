// ============================================================
// app.js — ChatCorp Main Logic
// Fixed: real-time messages, DM search button, cross-account sync
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
let currentUser    = null;
let activeChannel  = "general";
let activeDMUserId = null;
let activeDMName   = null;
let chatMode       = "channel";
let unsubMessages  = null;

// ─── CHANNELS ────────────────────────────────────────────────
const CHANNELS = [
  { id: "general",       icon: "💬", label: "general",       desc: "General team discussion" },
  { id: "announcements", icon: "📢", label: "announcements", desc: "Important company updates" },
  { id: "coding",        icon: "💻", label: "coding",        desc: "Dev talk, code reviews, help" },
  { id: "design",        icon: "🎨", label: "design",        desc: "UI/UX, assets, feedback" },
  { id: "random",        icon: "🎲", label: "random",        desc: "Off-topic, fun, anything goes" },
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
const channelDesc   = document.getElementById("channel-desc");
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
    btn.textContent = "Sign In →";
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
    signupError.textContent = "Display name must be at least 2 characters.";
    return;
  }
  btn.textContent = "Creating account…";
  btn.disabled = true;
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(cred.user, { displayName: username });
    // Save user to Firestore so others can search and DM them
    await setDoc(doc(db, "users", cred.user.uid), {
      uid:      cred.user.uid,
      username: username,
      email:    email,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    signupError.textContent = friendlyError(err.code);
    btn.textContent = "Create Account →";
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
    // Create user doc if it doesn't exist yet (handles old accounts)
    try {
      const uDoc = await getDoc(doc(db, "users", user.uid));
      if (!uDoc.exists()) {
        await setDoc(doc(db, "users", user.uid), {
          uid:      user.uid,
          username: user.displayName || user.email.split("@")[0],
          email:    user.email,
          createdAt: serverTimestamp(),
        });
      }
    } catch (e) {
      console.warn("Could not sync user doc:", e);
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

// ─── BUILD CHANNEL LIST ───────────────────────────────────────
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
  chatMode       = "channel";
  activeChannel  = channelId;
  activeDMUserId = null;

  document.querySelectorAll(".channel-item").forEach(el =>
    el.classList.toggle("active", el.dataset.channel === channelId)
  );
  document.querySelectorAll(".dm-item").forEach(el =>
    el.classList.remove("active")
  );

  const ch = CHANNELS.find(c => c.id === channelId);
  channelTitle.innerHTML = `<span>${ch.icon}</span> #${ch.label}`;
  messageInput.placeholder = `Message #${ch.label}…`;
  if (channelDesc) channelDesc.textContent = ch.desc || "";

  messagesArea.innerHTML = "";
  if (unsubMessages) unsubMessages();
  subscribeChannelMessages(channelId);
  messageInput.focus();
}

// ─── SUBSCRIBE CHANNEL MESSAGES (real-time) ───────────────────
function subscribeChannelMessages(channelId) {
  const q = query(
    collection(db, "channels", channelId, "messages"),
    orderBy("timestamp", "asc")
  );
  // onSnapshot fires immediately with existing messages,
  // then again whenever anyone sends a new one
  unsubMessages = onSnapshot(q, (snap) => {
    snap.docChanges().forEach(change => {
      if (change.type === "added") {
        renderMessage(change.doc.data(), change.doc.id, "channel");
      }
    });
    scrollToBottom();
  }, (err) => {
    console.error("Channel listener error:", err);
    showToast("Connection error. Check your Firestore rules.");
  });
}

// ─── LOAD DM LIST ─────────────────────────────────────────────
async function loadDMList() {
  dmList.innerHTML = `<li class="dm-placeholder">Search a teammate to start a conversation</li>`;
  try {
    const snap = await getDocs(collection(db, "users", currentUser.uid, "dmConversations"));
    if (!snap.empty) {
      dmList.innerHTML = "";
      snap.forEach(d => {
        const data = d.data();
        if (data.uid && data.username) addDMItem(data.uid, data.username);
      });
    }
  } catch (e) {
    console.warn("Could not load DM list:", e);
  }
}

// ─── ADD DM ITEM TO SIDEBAR ───────────────────────────────────
function addDMItem(uid, username) {
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
dmSearchInput.addEventListener("keydown", e => {
  if (e.key === "Enter") searchUser();
});

async function searchUser() {
  const queryStr = dmSearchInput.value.trim();
  if (!queryStr) return;

  // Disable button while searching (keep SVG icon intact)
  dmSearchBtn.disabled = true;
  dmSearchBtn.style.opacity = "0.5";

  try {
    const snap = await getDocs(collection(db, "users"));
    let found = null;
    snap.forEach(d => {
      const data = d.data();
      if (
        data.username?.toLowerCase() === queryStr.toLowerCase() &&
        data.uid !== currentUser.uid
      ) {
        found = data;
      }
    });

    if (found) {
      dmSearchInput.value = "";
      // Save conversation to both users' dmConversations
      await setDoc(
        doc(db, "users", currentUser.uid, "dmConversations", found.uid),
        { uid: found.uid, username: found.username }
      );
      addDMItem(found.uid, found.username);
      openDM(found.uid, found.username);
    } else {
      showToast(`No user found: "${queryStr}"`);
    }
  } catch (err) {
    console.error("Search error:", err);
    showToast("Search failed. Try again.");
  }

  dmSearchBtn.disabled = false;
  dmSearchBtn.style.opacity = "1";
}

// ─── OPEN DM CONVERSATION ─────────────────────────────────────
async function openDM(uid, username) {
  chatMode       = "dm";
  activeDMUserId = uid;
  activeDMName   = username;

  document.querySelectorAll(".channel-item").forEach(el => el.classList.remove("active"));
  document.querySelectorAll(".dm-item").forEach(el =>
    el.classList.toggle("active", el.dataset.dmuid === uid)
  );

  channelTitle.innerHTML = `
    <div class="dm-header-avatar">${username.charAt(0).toUpperCase()}</div>
    ${escapeHtml(username)}
  `;
  messageInput.placeholder = `Message ${username}…`;
  if (channelDesc) channelDesc.textContent = "Direct Message";

  messagesArea.innerHTML = "";
  if (unsubMessages) unsubMessages();
  subscribeDMMessages(uid);
  messageInput.focus();

  // Save conversation on the other user's side too
  try {
    await setDoc(
      doc(db, "users", uid, "dmConversations", currentUser.uid),
      {
        uid:      currentUser.uid,
        username: currentUser.displayName || currentUser.email.split("@")[0],
      }
    );
  } catch (e) {
    console.warn("Could not save reverse DM ref:", e);
  }
}

// ─── DM ROOM ID ───────────────────────────────────────────────
// Always sorted so both users get the same room
function getDMRoomId(uid1, uid2) {
  return [uid1, uid2].sort().join("_");
}

// ─── SUBSCRIBE DM MESSAGES (real-time) ────────────────────────
function subscribeDMMessages(otherUid) {
  const roomId = getDMRoomId(currentUser.uid, otherUid);
  const q = query(
    collection(db, "dms", roomId, "messages"),
    orderBy("timestamp", "asc")
  );
  unsubMessages = onSnapshot(q, (snap) => {
    snap.docChanges().forEach(change => {
      if (change.type === "added") {
        renderMessage(change.doc.data(), change.doc.id, "dm");
      }
    });
    scrollToBottom();
  }, (err) => {
    console.error("DM listener error:", err);
    showToast("Connection error. Check your Firestore rules.");
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
        username:  username,
        uid:       currentUser.uid,
        text:      text,
        timestamp: serverTimestamp(),
      });
    } else if (chatMode === "dm" && activeDMUserId) {
      const roomId = getDMRoomId(currentUser.uid, activeDMUserId);
      await addDoc(collection(db, "dms", roomId, "messages"), {
        username:  username,
        uid:       currentUser.uid,
        text:      text,
        timestamp: serverTimestamp(),
      });
    }
  } catch (err) {
    console.error("Send failed:", err);
    showToast("Failed to send. Check connection.");
    messageInput.value = text; // restore on failure
  }
}

// Send on Enter, new line on Shift+Enter
messageInput.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

sendBtn.addEventListener("click", sendMessage);

// Auto-resize textarea
messageInput.addEventListener("input", () => {
  messageInput.style.height = "auto";
  messageInput.style.height = Math.min(messageInput.scrollHeight, 160) + "px";
});

// ─── RENDER MESSAGE ───────────────────────────────────────────
function renderMessage(data, docId, type) {
  // Prevent duplicate renders
  if (document.getElementById(`msg-${docId}`)) return;

  const { username, text, timestamp, uid } = data;
  const time   = timestamp ? formatTime(timestamp.toDate()) : "just now";
  const isOwn  = uid === currentUser?.uid;
  const color  = hashCode(username || "?") % 6;

  const div = document.createElement("div");
  div.id = `msg-${docId}`;
  div.className = `message${isOwn ? " own" : ""}`;
  div.innerHTML = `
    <div class="msg-avatar avatar-color-${color}">${(username || "?").charAt(0).toUpperCase()}</div>
    <div class="msg-body">
      <div class="msg-header">
        <span class="msg-username${isOwn ? " own-name" : ""}">${escapeHtml(username)}</span>
        <span class="msg-time">${time}</span>
        ${type === "channel" && !isOwn
          ? `<button class="dm-quick-btn" data-uid="${uid}" data-uname="${escapeHtml(username)}">✉ DM</button>`
          : ""}
      </div>
      <div class="msg-text">${formatText(text)}</div>
    </div>
  `;

  // Quick DM from channel message
  const dmBtn = div.querySelector(".dm-quick-btn");
  if (dmBtn) {
    dmBtn.addEventListener("click", async () => {
      const tUid  = dmBtn.dataset.uid;
      const tName = dmBtn.dataset.uname;
      await setDoc(
        doc(db, "users", currentUser.uid, "dmConversations", tUid),
        { uid: tUid, username: tName }
      );
      addDMItem(tUid, tName);
      openDM(tUid, tName);
    });
  }

  messagesArea.appendChild(div);
  // Animate in
  requestAnimationFrame(() => div.classList.add("visible"));
}

// ─── AUTO SCROLL ──────────────────────────────────────────────
function scrollToBottom() {
  messagesArea.scrollTo({ top: messagesArea.scrollHeight, behavior: "smooth" });
}

// ─── TOAST NOTIFICATION ───────────────────────────────────────
function showToast(msg) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add("show"));
  setTimeout(() => {
    t.classList.remove("show");
    setTimeout(() => t.remove(), 300);
  }, 3000);
}

// ─── HELPERS ─────────────────────────────────────────────────
function formatTime(date) {
  const today = new Date();
  const isToday = date.toDateString() === today.toDateString();
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return isToday ? `Today at ${time}` : date.toLocaleDateString() + " " + time;
}

function formatText(str) {
  return escapeHtml(str)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`(.+?)`/g, "<code>$1</code>");
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
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
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(31, h) + str.charCodeAt(i) | 0;
  }
  return Math.abs(h);
}