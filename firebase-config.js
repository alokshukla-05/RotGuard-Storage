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
  apiKey: "AIzaSyC0dYCbPoH5mH1QeLI31xrfqnUSbT8Bao0",
  authDomain: "fixeasy-568cd.firebaseapp.com",
  projectId: "fixeasy-568cd",
  storageBucket: "fixeasy-568cd.firebasestorage.app",
  messagingSenderId: "839456909521",
  appId: "1:839456909521:web:8555cb99e40cb5e1753df0",
  measurementId: "G-RQD3RPMZKS"
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
