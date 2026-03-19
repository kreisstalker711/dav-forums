// ============================================================
// firebase.js — Firebase initialization (modular SDK v9)
// Replace the firebaseConfig object with your own project values
// from: https://console.firebase.google.com → Project Settings
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  collection,
  addDoc,
  query,
  orderBy,
  onSnapshot,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ─── Firebase Config (dav-forum project) ────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyC6-6Y9I-v0gnUJNGEsanlf2oU12Zm550k",
  authDomain: "dav-forum.firebaseapp.com",
  projectId: "dav-forum",
  storageBucket: "dav-forum.firebasestorage.app",
  messagingSenderId: "781784814352",
  appId: "1:781784814352:web:56e3c6166a7a9f217d4b95",
  measurementId: "G-8MX6X889F1",
};
// ─────────────────────────────────────────────────────────────

// Initialize Firebase app
const app = initializeApp(firebaseConfig);

// Export initialized services
export const auth = getAuth(app);
export const db = getFirestore(app);

// Re-export Auth helpers
export {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
};

// Re-export Firestore helpers
export {
  collection,
  addDoc,
  query,
  orderBy,
  onSnapshot,
  serverTimestamp,
};