// ============================================================
// app.js — Main application logic
// Handles auth, channel switching, real-time messaging
// ============================================================

import {
  auth,
  db,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
  collection,
  addDoc,
  query,
  orderBy,
  onSnapshot,
  serverTimestamp,
} from "./firebase.js";

// ─── STATE ───────────────────────────────────────────────────
let currentUser = null;
let activeChannel = "general";
let unsubscribeMessages = null; // Firestore listener cleanup

// ─── CHANNELS ────────────────────────────────────────────────
const CHANNELS = [
  { id: "general",       icon: "💬", label: "general" },
  { id: "coding",        icon: "💻", label: "coding" },
  { id: "announcements", icon: "📢", label: "announcements" },
  { id: "random",        icon: "🎲", label: "random" },
  { id: "design",        icon: "🎨", label: "design" },
];

// ─── DOM REFS ─────────────────────────────────────────────────
const authScreen      = document.getElementById("auth-screen");
const appScreen       = document.getElementById("app-screen");
const loginForm       = document.getElementById("login-form");
const signupForm      = document.getElementById("signup-form");
const tabLogin        = document.getElementById("tab-login");
const tabSignup       = document.getElementById("tab-signup");
const loginError      = document.getElementById("login-error");
const signupError     = document.getElementById("signup-error");
const channelList     = document.getElementById("channel-list");
const channelTitle    = document.getElementById("channel-title");
const messagesArea    = document.getElementById("messages-area");
const messageInput    = document.getElementById("message-input");
const sendBtn         = document.getElementById("send-btn");
const logoutBtn       = document.getElementById("logout-btn");
const userDisplay     = document.getElementById("user-display");
const userAvatar      = document.getElementById("user-avatar");
const typingIndicator = document.getElementById("typing-indicator");

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
    // Set display name on the Firebase user
    await updateProfile(cred.user, { displayName: username });
  } catch (err) {
    signupError.textContent = friendlyError(err.code);
    btn.textContent = "Create Account";
    btn.disabled = false;
  }
});

// ─── LOGOUT ───────────────────────────────────────────────────
logoutBtn.addEventListener("click", async () => {
  if (unsubscribeMessages) unsubscribeMessages();
  await signOut(auth);
});

// ─── AUTH STATE OBSERVER ──────────────────────────────────────
onAuthStateChanged(auth, (user) => {
  if (user) {
    currentUser = user;
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

  // User info in sidebar
  const name = user.displayName || user.email.split("@")[0];
  userDisplay.textContent = name;
  userAvatar.textContent  = name.charAt(0).toUpperCase();

  buildChannelList();
  switchChannel("general");
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
    li.className = "channel-item" + (id === activeChannel ? " active" : "");
    li.dataset.channel = id;
    li.innerHTML = `<span class="ch-icon">${icon}</span><span class="ch-name">${label}</span>`;
    li.addEventListener("click", () => switchChannel(id));
    channelList.appendChild(li);
  });
}

// ─── SWITCH CHANNEL ───────────────────────────────────────────
function switchChannel(channelId) {
  activeChannel = channelId;

  // Update sidebar highlight
  document.querySelectorAll(".channel-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.channel === channelId);
  });

  // Update header
  const ch = CHANNELS.find((c) => c.id === channelId);
  channelTitle.textContent = `${ch.icon}  #${ch.label}`;

  // Clear messages and re-subscribe
  messagesArea.innerHTML = "";
  if (unsubscribeMessages) unsubscribeMessages();
  subscribeToMessages(channelId);

  messageInput.focus();
}

// ─── REAL-TIME MESSAGES ───────────────────────────────────────
function subscribeToMessages(channelId) {
  const q = query(
    collection(db, "channels", channelId, "messages"),
    orderBy("timestamp", "asc")
  );

  unsubscribeMessages = onSnapshot(q, (snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === "added") {
        renderMessage(change.doc.data(), change.doc.id);
      }
    });
    scrollToBottom();
  });
}

// ─── RENDER A MESSAGE ─────────────────────────────────────────
function renderMessage(data, docId) {
  // Avoid duplicate renders
  if (document.getElementById(`msg-${docId}`)) return;

  const { username, text, timestamp } = data;
  const time = timestamp ? formatTime(timestamp.toDate()) : "just now";
  const isOwn = username === (currentUser?.displayName || currentUser?.email?.split("@")[0]);

  const div = document.createElement("div");
  div.id = `msg-${docId}`;
  div.className = `message ${isOwn ? "own" : ""}`;
  div.innerHTML = `
    <div class="msg-avatar">${username.charAt(0).toUpperCase()}</div>
    <div class="msg-body">
      <div class="msg-header">
        <span class="msg-username">${escapeHtml(username)}</span>
        <span class="msg-time">${time}</span>
      </div>
      <div class="msg-text">${escapeHtml(text)}</div>
    </div>
  `;

  messagesArea.appendChild(div);

  // Animate in
  requestAnimationFrame(() => div.classList.add("visible"));
}

// ─── SEND MESSAGE ─────────────────────────────────────────────
async function sendMessage() {
  const text = messageInput.value.trim();
  if (!text || !currentUser) return;

  const username = currentUser.displayName || currentUser.email.split("@")[0];

  messageInput.value = "";
  messageInput.style.height = "auto";

  try {
    await addDoc(collection(db, "channels", activeChannel, "messages"), {
      username,
      text,
      timestamp: serverTimestamp(),
    });
  } catch (err) {
    console.error("Failed to send message:", err);
    messageInput.value = text; // Restore on failure
  }
}

// Send on Enter (Shift+Enter for newline)
messageInput.addEventListener("keydown", (e) => {
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

// ─── SCROLL TO BOTTOM ─────────────────────────────────────────
function scrollToBottom() {
  messagesArea.scrollTo({ top: messagesArea.scrollHeight, behavior: "smooth" });
}

// ─── HELPERS ─────────────────────────────────────────────────
function formatTime(date) {
  const today = new Date();
  const isToday =
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear();

  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return isToday ? `Today at ${time}` : date.toLocaleDateString() + " " + time;
}

function escapeHtml(str) {
  return str
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