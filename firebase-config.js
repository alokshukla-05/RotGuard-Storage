// ======================================================
// firebase-config.js
// ======================================================

import {
    initializeApp
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js";

import {
    getAuth,
    signInWithEmailAndPassword,
    onAuthStateChanged,
    signOut
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";

import {
    getDatabase,
    ref,
    onValue,
    set,
    update,
    push,
    remove
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-database.js";


// ======================================================
// FIREBASE CONFIG
// ======================================================

const firebaseConfig = {
  apiKey: "AIzaSyDGpagCpskeOxzVO4C5qgdVUTeWO8rUZUU",
  authDomain: "electrician-830b2.firebaseapp.com",
  projectId: "electrician-830b2",
  storageBucket: "electrician-830b2.firebasestorage.app",
  messagingSenderId: "1053791458330",
  appId: "1:1053791458330:web:fdbf5befa79aef2376eda3"
};


// ======================================================
// INITIALIZE
// ======================================================

const app = initializeApp(firebaseConfig);

const auth = getAuth(app);

const db = getDatabase(app);


// ======================================================
// EXPORT
// ======================================================

export {

    app,
    auth,
    db,

    signInWithEmailAndPassword,
    onAuthStateChanged,
    signOut,

    ref,
    onValue,
    set,
    update,
    push,
    remove

};
