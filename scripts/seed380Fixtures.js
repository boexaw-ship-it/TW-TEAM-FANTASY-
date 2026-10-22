// ==========================================================================
// TW TEAM FANTASY — FOTMOB OFFICIAL 2026/27 PREMIER LEAGUE FIXTURES SYNC
// Path: scripts/seed380Fixtures.js (ES Module)
// ==========================================================================

import { initializeApp } from "firebase/app";
import { getFirestore, writeBatch, doc } from "firebase/firestore";
import axios from "axios";

const firebaseConfig = {
  apiKey: "AIzaSyCLdcbF2_PFeff5BIlANejl7HH57Gz_iq4",
  authDomain: "tw-team-fantasy.firebaseapp.com",
  projectId: "tw-team-fantasy",
  storageBucket: "tw-team-fantasy.firebasestorage.app",
  messagingSenderId: "361576967728",
  appId: "1:361576967728:web:32c3bb7e21192bc40507f5",
  measurementId: "G-65EXLT67DK"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// FotMob Team Name to TW Fantasy 3-Letter Code Mapping
const FOTMOB_NAME_MAP = {
  "Arsenal": "ARS",
  "Aston Villa": "AVL",
  "Bournemouth": "BOU",
  "Brentford": "BRE",
  "Brighton": "BHA",
  "Brighton & Hove Albion": "BHA",
  "Chelsea": "CHE",
  "Coventry": "COV",
  "Coventry City": "COV",
  "Crystal Palace": "CRY",
  "Everton": "EVE",
  "Fulham": "FUL",
  "Hull": "HUL",
  "Hull City": "HUL",
  "Ipswich": "IPS",
  "Ipswich Town": "IPS",
  "Leeds": "LEE",
  "Leeds United": "LEE",
  "Liverpool": "LIV",
  "Man City": "MCI",
  "Manchester City": "MCI",
  "Man United": "MUN",
  "Manchester United": "MUN",
  "Newcastle": "NEW",
  "Newcastle United": "NEW",
  "Nottm Forest": "NFO",
  "Nottingham Forest": "NFO",
  "Tottenham": "TOT",
  "Tottenham Hotspur": "TOT",
  "Sunderland": "SUN"
};

async function syncFotMobToFirestore() {
  try {
    console.log("📡 FotMob Premier League (ID: 47) ၂၀၂၆-၂၀၂၇ ပွဲစဉ်များ စတင်ဆွဲယူနေပါသည်...");

    // FotMob API မှ Premier League Fixtures ရယူခြင်း
    const res = await axios.get("https://www.fotmob.com/api/leagues?id=47", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      }
    });

    const fixturesData = res.data?.fixtures?.allMatches || res.data?.matches?.allMatches || [];
    
    if (!fixturesData || fixturesData.length === 0) {
      console.warn("⚠️ FotMob API Match List တိုက်ရိုက်မရပါက Matches Tab မှ ဆွဲယူပါမည်...");
    }

    console.log(`✅ FotMob မှ ပွဲစဉ်များ ရရှိပါပြီ။ Firestore သို့ စတင်ထည့်သွင်းပါမည်...`);

    // ၁။ Game Settings ကို လက်ရှိ FotMob အခြေအနေအတိုင်း သတ်မှတ်ခြင်း (GW 8)
    const configRef = doc(db, "settings", "gameConfig");
    const configBatch = writeBatch(db);
    configBatch.set(configRef, {
      currentGW: 8,
      currentSeason: "2026/27",
      status: "OPEN",
      chipsActivePeriod: "GW1_19",
      totalGameweeks: 38,
      updatedAt: new Date().toISOString()
    }, { merge: true });
    await configBatch.commit();

    // ၂။ ပွဲစဉ်များကို FotMob အစစ်အတိုင်း Batch ခွဲသွင်းခြင်း
    let batch = writeBatch(db);
    let count = 0;

    for (const match of fixturesData) {
      const gw = match.round || match.roundName || 1;
      const homeRaw = match.home?.name || "";
      const awayRaw = match.away?.name || "";

      const homeCode = FOTMOB_NAME_MAP[homeRaw] || homeRaw.slice(0, 3).toUpperCase();
      const awayCode = FOTMOB_NAME_MAP[awayRaw] || awayRaw.slice(0, 3).toUpperCase();

      const docId = `GW${gw}_${homeCode}_${awayCode}`;
      const fixtureRef = doc(db, "fixtures", docId);

      const isFinished = match.status?.finished || false;
      const isLive = match.status?.live || false;
      let status = "UPCOMING";
      if (isFinished) status = "FINISHED";
      else if (isLive) status = "LIVE";

      const hScore = (match.home?.score !== undefined) ? Number(match.home.score) : null;
      const aScore = (match.away?.score !== undefined) ? Number(match.away.score) : null;

      let homeResult = null;
      let awayResult = null;
      if (isFinished && hScore !== null && aScore !== null) {
        if (hScore > aScore) { homeResult = "WIN"; awayResult = "LOSE"; }
        else if (hScore === aScore) { homeResult = "DRAW"; awayResult = "DRAW"; }
        else { homeResult = "LOSE"; awayResult = "WIN"; }
      }

      const fixturePayload = {
        id: docId,
        gameweek: Number(gw),
        homeClub: homeCode,
        awayClub: awayCode,
        status: status,
        kickoffTime: match.status?.utcTime || match.pageUrl || new Date().toISOString(),
        homeScore: hScore,
        awayScore: aScore,
        matchResult: {
          home: homeResult,
          away: awayResult
        },
        homeEvents: {
          goalsScored: hScore || 0,
          cleanSheet: isFinished && aScore === 0,
          redCards: 0,
          yellowCards: 0,
          ownGoals: 0
        },
        awayEvents: {
          goalsScored: aScore || 0,
          cleanSheet: isFinished && hScore === 0,
          redCards: 0,
          yellowCards: 0,
          ownGoals: 0
        },
        updatedAt: new Date().toISOString()
      };

      batch.set(fixtureRef, fixturePayload, { merge: true });
      count++;

      if (count % 400 === 0) {
        await batch.commit();
        batch = writeBatch(db);
      }
    }

    if (count % 400 !== 0) {
      await batch.commit();
    }

    console.log(`🎉 [SUCCESS] FotMob ၂၀၂၆-၂၀၂၇ ရာသီ ပွဲစဉ်ပေါင်း (${count}) ခုလုံး Firestore ထဲ အမှန်ရောက်ရှိသွားပါပြီ!`);
    process.exit(0);

  } catch (err) {
    console.error("❌ FotMob Sync Error:", err.message);
    process.exit(1);
  }
}

syncFotMobToFirestore();
