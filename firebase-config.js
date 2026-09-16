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

    apiKey: "YOUR_API_KEY",

    authDomain:
        "YOUR_PROJECT.firebaseapp.com",

    databaseURL:
        "https://YOUR_PROJECT-default-rtdb.firebaseio.com/",

    projectId:
        "YOUR_PROJECT_ID",

    storageBucket:
        "YOUR_PROJECT.firebasestorage.app",

    messagingSenderId:
        "YOUR_MESSAGING_SENDER_ID",

    appId:
        "YOUR_APP_ID"

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
