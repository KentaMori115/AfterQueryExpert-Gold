import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

const firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

let app: FirebaseApp | null = null;
let authInstance: Auth | null = null;
let dbInstance: Firestore | null = null;

function getAppInstance(): FirebaseApp {
    if (!app) {
        app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
    }
    return app;
}

// Lazy accessors so the client Firebase SDK is only initialized in the browser
// at first use, never during server-side prerendering.
export function getAuthInstance(): Auth {
    if (!authInstance) {
        authInstance = getAuth(getAppInstance());
    }
    return authInstance;
}

export function getDb(): Firestore {
    if (!dbInstance) {
        dbInstance = getFirestore(getAppInstance());
    }
    return dbInstance;
}