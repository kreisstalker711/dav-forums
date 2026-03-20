// ============================================================
// app.js — ChatCorp with Servers, Invites & DMs
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
  where,
  arrayUnion,
  updateDoc,
  deleteDoc,
} from "./firebase.js";

// ─── STATE ───────────────────────────────────────────────────
let currentUser      = null;
let activeServerId   = null;
let activeServerName = null;
let activeChannel    = "general";
let activeDMUserId   = null;
let activeDMName     = null;
let chatMode         = "channel";   // "channel" | "dm"
let unsubMessages    = null;
let unsubServers     = null;

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

// Server UI refs
const serverList        = document.getElementById("server-list");
const createServerBtn   = document.getElementById("create-server-btn");
const serverModal       = document.getElementById("server-modal");
const serverModalClose  = document.getElementById("server-modal-close");
const createServerForm  = document.getElementById("create-server-form");
const serverNameInput   = document.getElementById("server-name-input");
const serverCreateError = document.getElementById("server-create-error");
const inviteModal       = document.getElementById("invite-modal");
const inviteModalClose  = document.getElementById("invite-modal-close");
const inviteSearchInput = document.getElementById("invite-search-input");
const inviteSearchBtn   = document.getElementById("invite-search-btn");
const inviteResult      = document.getElementById("invite-result");
const inviteServerBtn   = document.getElementById("invite-server-btn");
const membersList       = document.getElementById("members-list");
const noServerView      = document.getElementById("no-server-view");
const serverHeaderName  = document.getElementById("server-header-name");
const serverChannelArea = document.getElementById("server-channel-area");

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
    signupError.textContent = "Username must be at least 2 characters.";
    return;
  }
  btn.textContent = "Creating account…";
  btn.disabled = true;
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(cred.user, { displayName: username });
    await setDoc(doc(db, "users", cred.user.uid), {
      uid: cred.user.uid,
      username,
      email,
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
  if (unsubServers)  unsubServers();
  await signOut(auth);
});

// ─── AUTH STATE ───────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
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
  subscribeServers();
  loadDMList();
}

function showAuth() {
  appScreen.classList.add("hidden");
  authScreen.classList.remove("hidden");
  loginForm.reset();
  signupForm.reset();
}

// ════════════════════════════════════════════════════════════
//  SERVERS
// ════════════════════════════════════════════════════════════

// Subscribe to servers where the user is a member (real-time)
function subscribeServers() {
  if (unsubServers) unsubServers();
  const q = query(
    collection(db, "servers"),
    where("members", "array-contains", currentUser.uid)
  );
  unsubServers = onSnapshot(q, (snap) => {
    renderServerList(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  });
}

function renderServerList(servers) {
  serverList.innerHTML = "";
  if (servers.length === 0) {
    showNoServerView();
    return;
  }

  servers.forEach(server => {
    const btn = document.createElement("button");
    btn.className = "server-icon-btn" + (server.id === activeServerId ? " active" : "");
    btn.title = server.name;
    btn.dataset.id = server.id;
    btn.textContent = server.name.charAt(0).toUpperCase();
    btn.addEventListener("click", () => selectServer(server.id, server.name));
    serverList.appendChild(btn);
  });

  // If no server selected yet, auto-select first
  if (!activeServerId && servers.length > 0) {
    selectServer(servers[0].id, servers[0].name);
  }
}

function showNoServerView() {
  noServerView.classList.remove("hidden");
  serverChannelArea.classList.add("hidden");
  serverHeaderName.textContent = "ChatCorp";
  channelList.innerHTML = "";
  messagesArea.innerHTML = `
    <div class="welcome-banner">
      <div class="welcome-icon-wrap">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" fill="#8b5cf6"/>
        </svg>
      </div>
      <h2>No servers yet</h2>
      <p>Create your first server using the <strong>+</strong> button in the sidebar, or ask a friend to invite you.</p>
    </div>`;
}

async function selectServer(serverId, serverName) {
  activeServerId   = serverId;
  activeServerName = serverName;
  chatMode         = "channel";
  activeDMUserId   = null;

  // Highlight active server icon
  document.querySelectorAll(".server-icon-btn").forEach(b =>
    b.classList.toggle("active", b.dataset.id === serverId)
  );

  // Update header
  serverHeaderName.textContent = serverName;
  noServerView.classList.add("hidden");
  serverChannelArea.classList.remove("hidden");

  // Load server channels
  await buildChannelList(serverId);

  // Check ownership for invite button visibility
  const serverDoc = await getDoc(doc(db, "servers", serverId));
  const serverData = serverDoc.data();
  const isOwner = serverData.ownerId === currentUser.uid;
  document.getElementById("invite-btn").style.display = isOwner ? "flex" : "none";

  // Load members
  loadMembersList(serverData.members || []);

  // Switch to general channel
  switchChannel("general");
}

// ─── CREATE SERVER ───────────────────────────────────────────
createServerBtn.addEventListener("click", () => {
  serverModal.classList.remove("hidden");
  serverNameInput.focus();
});

serverModalClose.addEventListener("click", () => {
  serverModal.classList.add("hidden");
  serverCreateError.textContent = "";
  serverNameInput.value = "";
});

createServerForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = serverNameInput.value.trim();
  if (!name || name.length < 2) {
    serverCreateError.textContent = "Server name must be at least 2 characters.";
    return;
  }
  const btn = createServerForm.querySelector("button[type=submit]");
  btn.textContent = "Creating…";
  btn.disabled = true;
  try {
    const serverRef = await addDoc(collection(db, "servers"), {
      name,
      ownerId: currentUser.uid,
      members: [currentUser.uid],
      createdAt: serverTimestamp(),
    });
    // Create default #general channel
    await setDoc(doc(db, "servers", serverRef.id, "channels", "general"), {
      id: "general",
      label: "general",
      icon: "💬",
      desc: "General discussion",
      createdAt: serverTimestamp(),
    });
    serverModal.classList.add("hidden");
    serverNameInput.value = "";
    serverCreateError.textContent = "";
    showToast(`Server "${name}" created!`);
  } catch (err) {
    serverCreateError.textContent = "Failed to create server. Try again.";
  }
  btn.textContent = "Create Server →";
  btn.disabled = false;
});

// ─── BUILD CHANNEL LIST ───────────────────────────────────────
async function buildChannelList(serverId) {
  channelList.innerHTML = "";
  const snap = await getDocs(collection(db, "servers", serverId, "channels"));
  const channels = [];
  snap.forEach(d => channels.push(d.data()));
  channels.sort((a, b) => (a.label > b.label ? 1 : -1));

  const countEl = document.getElementById("channel-count");
  if (countEl) countEl.textContent = channels.length;

  channels.forEach(({ id, icon, label }) => {
    const li = document.createElement("li");
    li.className = "channel-item" + (id === activeChannel ? " active" : "");
    li.dataset.channel = id;
    li.innerHTML = `<span class="ch-icon">${icon || "💬"}</span><span class="ch-name">${label}</span>`;
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

  channelTitle.innerHTML = `<span class="ch-title-icon">💬</span> #${channelId}`;
  messageInput.placeholder = `Message #${channelId}`;

  const descEl = document.getElementById("channel-desc");
  if (descEl) descEl.textContent = "";

  messagesArea.innerHTML = "";
  if (unsubMessages) unsubMessages();
  if (activeServerId) subscribeServerChannelMessages(activeServerId, channelId);
  messageInput.focus();
}

// ─── SERVER CHANNEL MESSAGES ─────────────────────────────────
function subscribeServerChannelMessages(serverId, channelId) {
  const q = query(
    collection(db, "servers", serverId, "channels", channelId, "messages"),
    orderBy("timestamp", "asc")
  );
  unsubMessages = onSnapshot(q, (snap) => {
    snap.docChanges().forEach(change => {
      if (change.type === "added") renderMessage(change.doc.data(), change.doc.id, "channel");
    });
    scrollToBottom();
  });
}

// ════════════════════════════════════════════════════════════
//  INVITE SYSTEM
// ════════════════════════════════════════════════════════════

let foundInviteUser = null; // { uid, username }

inviteServerBtn.addEventListener("click", () => {
  if (!activeServerId) return;
  inviteModal.classList.remove("hidden");
  inviteResult.textContent = "";
  inviteSearchInput.value = "";
  foundInviteUser = null;
  loadMembersInModal();
});

inviteModalClose.addEventListener("click", () => {
  inviteModal.classList.add("hidden");
  inviteResult.textContent = "";
  inviteSearchInput.value = "";
  foundInviteUser = null;
});

inviteSearchBtn.addEventListener("click", searchAndInvite);
inviteSearchInput.addEventListener("keydown", e => {
  if (e.key === "Enter") searchAndInvite();
});

async function searchAndInvite() {
  const q = inviteSearchInput.value.trim();
  if (!q) return;

  inviteSearchBtn.disabled = true;
  inviteResult.textContent = "Searching…";
  inviteResult.style.color = "var(--text-muted)";

  try {
    const snap = await getDocs(collection(db, "users"));
    let found = null;
    snap.forEach(d => {
      const data = d.data();
      if (data.username?.toLowerCase() === q.toLowerCase() && data.uid !== currentUser.uid) {
        found = data;
      }
    });

    if (!found) {
      inviteResult.textContent = `No user found: "${q}"`;
      inviteResult.style.color = "var(--error-red)";
      foundInviteUser = null;
    } else {
      // Check if already a member
      const serverDoc = await getDoc(doc(db, "servers", activeServerId));
      const members = serverDoc.data().members || [];
      if (members.includes(found.uid)) {
        inviteResult.textContent = `${found.username} is already in this server.`;
        inviteResult.style.color = "var(--warning-amber)";
        foundInviteUser = null;
      } else {
        foundInviteUser = found;
        inviteResult.textContent = `Found: ${found.username} — click Invite to add them.`;
        inviteResult.style.color = "var(--online-green)";
      }
    }
  } catch {
    inviteResult.textContent = "Search failed. Try again.";
    inviteResult.style.color = "var(--error-red)";
  }
  inviteSearchBtn.disabled = false;
}

// Confirm invite button
document.getElementById("confirm-invite-btn").addEventListener("click", async () => {
  if (!foundInviteUser || !activeServerId) return;
  const btn = document.getElementById("confirm-invite-btn");
  btn.disabled = true;
  btn.textContent = "Inviting…";
  try {
    await updateDoc(doc(db, "servers", activeServerId), {
      members: arrayUnion(foundInviteUser.uid),
    });
    inviteResult.textContent = `${foundInviteUser.username} has been added to the server!`;
    inviteResult.style.color = "var(--online-green)";
    showToast(`${foundInviteUser.username} added to ${activeServerName}!`);
    inviteSearchInput.value = "";
    foundInviteUser = null;
    loadMembersInModal();
  } catch {
    inviteResult.textContent = "Failed to invite. Try again.";
    inviteResult.style.color = "var(--error-red)";
  }
  btn.disabled = false;
  btn.textContent = "Invite";
});

async function loadMembersInModal() {
  const membersModal = document.getElementById("modal-members-list");
  if (!membersModal || !activeServerId) return;
  membersModal.innerHTML = `<p style="color:var(--text-faint);font-size:0.8rem;">Loading members…</p>`;
  try {
    const serverDoc = await getDoc(doc(db, "servers", activeServerId));
    const memberUids = serverDoc.data().members || [];
    membersModal.innerHTML = "";
    for (const uid of memberUids) {
      const uDoc = await getDoc(doc(db, "users", uid));
      if (!uDoc.exists()) continue;
      const { username } = uDoc.data();
      const isOwner = serverDoc.data().ownerId === uid;
      const div = document.createElement("div");
      div.className = "modal-member-row";
      div.innerHTML = `
        <div class="dm-avatar" style="width:26px;height:26px;font-size:0.68rem;">${username.charAt(0).toUpperCase()}</div>
        <span style="flex:1;font-size:0.85rem;">${escapeHtml(username)}</span>
        ${isOwner ? `<span class="owner-badge">Owner</span>` : ""}
      `;
      membersModal.appendChild(div);
    }
  } catch {
    membersModal.innerHTML = `<p style="color:var(--error-red);font-size:0.8rem;">Failed to load members.</p>`;
  }
}

async function loadMembersList(memberUids) {
  membersList.innerHTML = "";
  for (const uid of memberUids) {
    try {
      const uDoc = await getDoc(doc(db, "users", uid));
      if (!uDoc.exists()) continue;
      const { username } = uDoc.data();
      const div = document.createElement("div");
      div.className = "member-row";
      div.innerHTML = `
        <div class="dm-avatar" style="width:24px;height:24px;font-size:0.65rem;">${username.charAt(0).toUpperCase()}</div>
        <span>${escapeHtml(username)}</span>
      `;
      membersList.appendChild(div);
    } catch {}
  }
}

// ─── INVITE BTN (sidebar) ─────────────────────────────────────
const inviteBtn = document.getElementById("invite-btn");
if (inviteBtn) {
  inviteBtn.addEventListener("click", () => {
    inviteServerBtn.click();
  });
}

// ════════════════════════════════════════════════════════════
//  DMs  (unchanged logic)
// ════════════════════════════════════════════════════════════

async function loadDMList() {
  dmList.innerHTML = `<li class="dm-placeholder">Search a teammate to start a conversation</li>`;
  try {
    const snap = await getDocs(collection(db, "users", currentUser.uid, "dmConversations"));
    if (!snap.empty) {
      dmList.innerHTML = "";
      snap.forEach(d => {
        const data = d.data();
        addDMItem(data.uid, data.username);
      });
    }
  } catch {}
}

function addDMItem(uid, username) {
  const placeholder = dmList.querySelector(".dm-placeholder");
  if (placeholder) placeholder.remove();
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

dmSearchBtn.addEventListener("click", searchUser);
dmSearchInput.addEventListener("keydown", e => { if (e.key === "Enter") searchUser(); });

async function searchUser() {
  const query_str = dmSearchInput.value.trim();
  if (!query_str) return;
  dmSearchBtn.disabled = true;
  dmSearchBtn.style.opacity = "0.5";
  try {
    const snap = await getDocs(collection(db, "users"));
    let found = null;
    snap.forEach(d => {
      const data = d.data();
      if (data.username?.toLowerCase() === query_str.toLowerCase() && data.uid !== currentUser.uid) {
        found = data;
      }
    });
    if (found) {
      dmSearchInput.value = "";
      await setDoc(doc(db, "users", currentUser.uid, "dmConversations", found.uid), {
        uid: found.uid, username: found.username,
      });
      addDMItem(found.uid, found.username);
      openDM(found.uid, found.username);
    } else {
      showToast(`No user found: "${query_str}"`);
    }
  } catch {
    showToast("Search failed. Try again.");
  }
  dmSearchBtn.disabled = false;
  dmSearchBtn.style.opacity = "1";
}

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
  const descEl = document.getElementById("channel-desc");
  if (descEl) descEl.textContent = "Direct Message";
  messagesArea.innerHTML = "";
  if (unsubMessages) unsubMessages();
  subscribeDMMessages(uid);
  messageInput.focus();
  await setDoc(doc(db, "users", uid, "dmConversations", currentUser.uid), {
    uid: currentUser.uid,
    username: currentUser.displayName || currentUser.email.split("@")[0],
  });
}

function getDMRoomId(uid1, uid2) { return [uid1, uid2].sort().join("_"); }

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
    if (chatMode === "channel" && activeServerId) {
      await addDoc(
        collection(db, "servers", activeServerId, "channels", activeChannel, "messages"),
        { username, uid: currentUser.uid, text, timestamp: serverTimestamp() }
      );
    } else if (chatMode === "dm" && activeDMUserId) {
      const roomId = getDMRoomId(currentUser.uid, activeDMUserId);
      await addDoc(collection(db, "dms", roomId, "messages"), {
        username, uid: currentUser.uid, text, timestamp: serverTimestamp(),
      });
    }
  } catch (err) {
    console.error("Send failed:", err);
    messageInput.value = text;
  }
}

messageInput.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
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
  const div   = document.createElement("div");
  div.id = `msg-${docId}`;
  div.className = `message ${isOwn ? "own" : ""}`;
  const colorIndex = hashCode(username || "?") % 6;
  div.innerHTML = `
    <div class="msg-avatar avatar-color-${colorIndex}">${(username || "?").charAt(0).toUpperCase()}</div>
    <div class="msg-body">
      <div class="msg-header">
        <span class="msg-username ${isOwn ? "own-name" : ""}">${escapeHtml(username)}</span>
        <span class="msg-time">${time}</span>
        ${type === "channel" && !isOwn ? `<button class="dm-quick-btn" data-uid="${uid}" data-name="${escapeHtml(username)}">✉</button>` : ""}
      </div>
      <div class="msg-text">${formatText(text)}</div>
    </div>
  `;
  const dmBtn = div.querySelector(".dm-quick-btn");
  if (dmBtn) {
    dmBtn.addEventListener("click", () => {
      openDM(dmBtn.dataset.uid, dmBtn.dataset.name);
      addDMItem(dmBtn.dataset.uid, dmBtn.dataset.name);
      setDoc(doc(db, "users", currentUser.uid, "dmConversations", dmBtn.dataset.uid), {
        uid: dmBtn.dataset.uid, username: dmBtn.dataset.name,
      });
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