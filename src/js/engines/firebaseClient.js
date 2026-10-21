import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { 
  getFirestore, 
  doc, 
  getDoc, 
  onSnapshot 
} from "firebase/firestore";

// User's Firebase Configuration
const firebaseConfig = {
  apiKey: "AIzaSyCLdcbF2_PFeff5BIlANejl7HH57Gz_iq4",
  authDomain: "tw-team-fantasy.firebaseapp.com",
  projectId: "tw-team-fantasy",
  storageBucket: "tw-team-fantasy.firebasestorage.app",
  messagingSenderId: "361576967728",
  appId: "1:361576967728:web:32c3bb7e21192bc40507f5",
  measurementId: "G-65EXLT67DK"
};

// Initialize Firebase
export const app = initializeApp(firebaseConfig);
export const analytics = typeof window !== "undefined" ? getAnalytics(app) : null;
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = getFirestore(app);

/**
 * လက်ရှိ Current Gameweek နှင့် Deadline အခြေအနေကို ရယူခြင်း
 */
export async function getCurrentGameweekStatus() {
  try {
    const configRef = doc(db, "settings", "gameConfig");
    const snap = await getDoc(configRef);
    if (snap.exists()) {
      return snap.data(); // { currentGW: 1, deadline: "...", status: "OPEN" }
    }
  } catch (error) {
    console.error("Error fetching Gameweek status:", error);
  }
  // Default Fallback
  return { currentGW: 1, deadline: null, status: "OPEN" };
}

/**
 * Current Gameweek ပြောင်းလဲမှုကို Realtime စောင့်ကြည့်ခြင်း
 */
export function subscribeGameweekStatus(callback) {
  const configRef = doc(db, "settings", "gameConfig");
  return onSnapshot(configRef, (docSnap) => {
    if (docSnap.exists()) {
      callback(docSnap.data());
    }
  });
}
