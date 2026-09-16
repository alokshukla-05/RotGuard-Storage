// ============================================================
// SILO GUARD - FIREBASE CONFIG
// ============================================================

import { initializeApp } from
  "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";

import {
  getAuth,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from
  "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  getDatabase,
  ref,
  onValue,
  get,
  update,
  remove,
  set
} from
  "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";

import {
  getStorage,
  ref as storageRef,
  uploadBytesResumable,
  getDownloadURL
} from
  "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";


// ============================================================
// IMPORTANT
// Replace ONLY these Firebase web configuration values.
// Do NOT put your Firebase account password here.
// ============================================================

const firebaseConfig = {
  apiKey: "AIzaSyDGpagCpskeOxzVO4C5qgdVUTeWO8rUZUU",
  authDomain: "electrician-830b2.firebaseapp.com",
  projectId: "electrician-830b2",
  storageBucket: "electrician-830b2.firebasestorage.app",
  messagingSenderId: "1053791458330",
  appId: "1:1053791458330:web:fdbf5befa79aef2376eda3"
};


// ============================================================
// INITIALIZE
// ============================================================

const app =
  initializeApp(firebaseConfig);

const auth =
  getAuth(app);

const db =
  getDatabase(app);

const storage =
  getStorage(app);


// ============================================================
// EXPORT
// ============================================================

export {

  app,

  auth,

  db,

  storage,

  signInWithEmailAndPassword,

  onAuthStateChanged,

  signOut,

  ref,

  onValue,

  get,

  update,

  remove,

  set,

  storageRef,

  uploadBytesResumable,

  getDownloadURL

};
