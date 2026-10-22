// ==========================================================================
// TW TEAM FANTASY — COMPLETE 380 FIXTURES SEEDER (GW 1 TO 38 READY)
// Path: scripts/seed380Fixtures.js (ES Module Compatible)
// ==========================================================================

import { initializeApp } from "firebase/app";
import { 
  getFirestore, 
  writeBatch, 
  doc 
} from "firebase/firestore";

// Firebase Config
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

// Premier League အသင်း ၂၀ (Custom TW Fantasy Clubs)
const CLUBS = [
  "ARS", "AVL", "BOU", "BRE", "BHA", 
  "CHE", "COV", "CRY", "EVE", "FUL", 
  "HUL", "IPS", "LEE", "LIV", "MCI", 
  "MUN", "NEW", "NFO", "TOT", "SUN"
];

// အသင်းများ၏ စွမ်းဆောင်ရည်အဆင့် (Realistic Match Scores ထွက်ပေါ်စေရန်)
const CLUB_STRENGTH = {
  MCI: 92, ARS: 89, LIV: 88, CHE: 83, AVL: 81,
  NEW: 80, TOT: 79, BHA: 78, MUN: 77, BRE: 76,
  FUL: 74, CRY: 73, BOU: 73, EVE: 71, NFO: 71,
  LEE: 69, SUN: 68, COV: 66, IPS: 66, HUL: 65
};

/**
 * Berger Round-Robin Algorithm ဖြင့် ပွဲစဉ် ၃၈၀ ထုတ်ယူခြင်း
 */
function generate380Fixtures() {
  const teams = [...CLUBS];
  const numTeams = teams.length;
  const numRounds = numTeams - 1; // 19 rounds for first half
  const matchesPerRound = numTeams / 2; // 10 matches
  const allFixtures = [];

  // ပထမအကျော့: Gameweek 1 မှ 19
  for (let round = 0; round < numRounds; round++) {
    const gw = round + 1;
    for (let match = 0; match < matchesPerRound; match++) {
      let home = teams[match];
      let away = teams[numTeams - 1 - match];

      if (round % 2 === 1) {
        [home, away] = [away, home];
      }

      allFixtures.push(createFixtureObject(gw, home, away, match + 1));
    }
    teams.splice(1, 0, teams.pop());
  }

  // ဒုတိယအကျော့: Gameweek 20 မှ 38 (အိမ်ကွင်း/အဝေးကွင်း ပြောင်းပြန်)
  for (let round = 0; round < numRounds; round++) {
    const gw = round + 20;
    const firstHalfMatches = allFixtures.filter(f => f.gameweek === round + 1);
    firstHalfMatches.forEach((firstMatch, matchIndex) => {
      allFixtures.push(createFixtureObject(gw, firstMatch.awayClub, firstMatch.homeClub, matchIndex + 1));
    });
  }

  return allFixtures;
}

/**
 * GW 1 မှ 38 အထိ ပွဲစဉ်အားလုံးအတွက် ရလဒ်များ တွက်ချက်ခြင်း
 */
function generateMatchScore(gw, home, away, matchIndex) {
  const seed = (gw * 37 + matchIndex * 13 + home.charCodeAt(0) + away.charCodeAt(0)) % 100;
  const diff = (CLUB_STRENGTH[home] || 70) - (CLUB_STRENGTH[away] || 70);

  let hScore = 1;
  let aScore = 1;

  if (diff >= 14) {
    hScore = 2 + (seed % 3);
    aScore = (seed % 4 === 0) ? 1 : 0;
  } else if (diff <= -14) {
    hScore = (seed % 4 === 0) ? 1 : 0;
    aScore = 2 + (seed % 3);
  } else if (diff > 0) {
    hScore = 1 + (seed % 3);
    aScore = (seed % 2);
  } else {
    hScore = (seed % 3);
    aScore = ((seed + 1) % 3);
  }

  return { hScore, aScore, seed };
}

/**
 * Fixture Data Model (GW 1 မှ 38 အထိ Data အပြည့်အစုံ ထည့်သွင်းခြင်း)
 */
function createFixtureObject(gw, home, away, matchIndex) {
  const fixtureId = `GW${gw}_${home}_${away}`;

  // Kickoff Date
  let daysOffset = (gw - 1) * 7;
  if (gw > 3) daysOffset += 7;
  if (gw > 7) daysOffset += 7;

  const seasonStart = new Date(Date.UTC(2026, 7, 15, 14, 0, 0));
  const isSunday = matchIndex > 6;
  const kickoffDate = new Date(seasonStart.getTime() + (daysOffset + (isSunday ? 1 : 0)) * 86400000);

  // ပွဲစဉ် ၃၈၀ စလုံးအတွက် ရလဒ်နှင့် Events များကို ကြိုတင်တွက်ချက်ထားခြင်း
  const { hScore, aScore, seed } = generateMatchScore(gw, home, away, matchIndex);

  let homeResult = "DRAW";
  let awayResult = "DRAW";
  if (hScore > aScore) {
    homeResult = "WIN";
    awayResult = "LOSE";
  } else if (hScore < aScore) {
    homeResult = "LOSE";
    awayResult = "WIN";
  }

  return {
    id: fixtureId,
    gameweek: gw,
    homeClub: home,
    awayClub: away,
    kickoffTime: kickoffDate.toISOString(),
    
    // ဂိုးရလဒ်များ
    homeScore: hScore,
    awayScore: aScore,
    matchResult: {
      home: homeResult,
      away: awayResult
    },

    // TW Scoring Engine အတွက် Event Data များ
    homeEvents: {
      goalsScored: hScore,
      cleanSheet: aScore === 0,
      redCards: (seed === 7 ? 1 : 0),
      yellowCards: (seed % 3),
      ownGoals: (seed === 19 ? 1 : 0)
    },
    awayEvents: {
      goalsScored: aScore,
      cleanSheet: hScore === 0,
      redCards: (seed === 13 ? 1 : 0),
      yellowCards: ((seed + 1) % 3),
      ownGoals: 0
    },

    updatedAt: new Date().toISOString()
  };
}

/**
 * Firestore ထဲသို့ အကုန်မောင်းထည့်ခြင်း
 */
async function seedAllFixtures() {
  console.log("🚀 TW Fantasy — ပွဲစဉ် ၃၈၀ စလုံး (GW 1 မှ 38 အထိ) စတင်ဖန်တီးနေပါသည်...");
  const fixtures = generate380Fixtures();
  console.log(`✅ စုစုပေါင်းပွဲစဉ်: ${fixtures.length} ပွဲ တွက်ချက်ပြီးပါပြီ။`);

  // ၁။ System Game Settings Document သတ်မှတ်ခြင်း (Default: GW 8)
  console.log("⚙️  Game Config (Current Gameweek: 8) သတ်မှတ်နေပါသည်...");
  const configRef = doc(db, "settings", "gameConfig");
  const configBatch = writeBatch(db);
  configBatch.set(configRef, {
    currentGW: 8,
    currentSeason: "2026/27",
    deadline: new Date(Date.UTC(2026, 9, 24, 12, 30, 0)).toISOString(),
    status: "OPEN",
    chipsActivePeriod: "GW1_19",
    totalGameweeks: 38,
    updatedAt: new Date().toISOString()
  });
  await configBatch.commit();
  console.log("✅ Game Config သွင်းပြီးပါပြီ။");

  // ၂။ Fixtures ၃၈၀ ကို Batch (၁၀၀ ပွဲစီ) ခွဲသွင်းခြင်း
  const chunkSize = 100;
  for (let i = 0; i < fixtures.length; i += chunkSize) {
    const chunk = fixtures.slice(i, i + chunkSize);
    const batch = writeBatch(db);

    chunk.forEach(fixture => {
      const docRef = doc(db, "fixtures", fixture.id);
      batch.set(docRef, fixture);
    });

    await batch.commit();
    console.log(`📦 Fixtures ${i + 1} မှ ${Math.min(i + chunkSize, fixtures.length)} အထိ သွင်းပြီးပါပြီ။`);
  }

  console.log("🎉 အောင်မြင်ပါသည်! GW 1 မှ 38 အထိ ပွဲစဉ် ၃၈၀ လုံး ရလဒ်များနှင့်တကွ Firestore ထဲ အပြည့်အစုံ ရောက်ရှိသွားပါပြီ။");
}

seedAllFixtures()
  .then(() => {
    console.log("🏁 Process Finished Successfully.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("❌ Seeding Failed with Error:", err);
    process.exit(1);
  });
