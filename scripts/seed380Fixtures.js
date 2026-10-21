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

// Premier League အသင်း ၂၀
const CLUBS = [
  "ARS", "AVL", "BOU", "BRE", "BHA", 
  "CHE", "COV", "CRY", "EVE", "FUL", 
  "HUL", "IPS", "LEE", "LIV", "MCI", 
  "MUN", "NEW", "NFO", "TOT", "SUN"
];

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

      // အိမ်ကွင်း/အဝေးကွင်း မျှတစေရန်
      if (round % 2 === 1) {
        [home, away] = [away, home];
      }

      allFixtures.push(createFixtureObject(gw, home, away));
    }
    // အသင်းများကို တစ်နေရာစီ ရွှေ့လှည့်ခြင်း
    teams.splice(1, 0, teams.pop());
  }

  // ဒုတိယအကျော့: Gameweek 20 မှ 38 (အိမ်ကွင်း/အဝေးကွင်း ပြောင်းပြန်)
  for (let round = 0; round < numRounds; round++) {
    const gw = round + 20;
    const firstHalfMatches = allFixtures.filter(f => f.gameweek === round + 1);
    firstHalfMatches.forEach(firstMatch => {
      allFixtures.push(createFixtureObject(gw, firstMatch.awayClub, firstMatch.homeClub));
    });
  }

  return allFixtures;
}

/**
 * Fixture Data Model (Goal, Clean Sheet, Cards, Own Goal ပါဝင်သော Structure)
 */
function createFixtureObject(gw, home, away) {
  const fixtureId = `GW${gw}_${home}_${away}`;
  return {
    id: fixtureId,
    gameweek: gw,
    homeClub: home,
    awayClub: away,
    status: "UPCOMING", // UPCOMING, LIVE, FINISHED
    kickoffTime: new Date(Date.UTC(2026, 7, 15 + gw * 7, 14, 0, 0)).toISOString(),
    
    // ရလဒ်နှင့် ဂိုးများ
    homeScore: null,
    awayScore: null,
    matchResult: {
      home: null, // "WIN", "DRAW", "LOSE"
      away: null
    },

    // Scoring Engine အတွက် Event Data များ
    homeEvents: {
      goalsScored: 0,
      cleanSheet: false,
      redCards: 0,
      yellowCards: 0,
      ownGoals: 0
    },
    awayEvents: {
      goalsScored: 0,
      cleanSheet: false,
      redCards: 0,
      yellowCards: 0,
      ownGoals: 0
    },

    updatedAt: new Date().toISOString()
  };
}

/**
 * Firestore ထဲသို့ Batch ဖြင့် အကုန်မောင်းထည့်ခြင်း
 */
async function seedAllFixtures() {
  console.log("🚀 Premier League ပွဲစဉ် ၃၈၀ စတင်ဖန်တီးနေပါသည်...");
  const fixtures = generate380Fixtures();
  console.log(`✅ စုစုပေါင်းပွဲစဉ်: ${fixtures.length} ပွဲ ထွက်ပေါ်လာပါပြီ။`);

  // ၁။ System Game Settings Document သတ်မှတ်ခြင်း (Current Gameweek 1)
  console.log("⚙️  Game Config (Current Gameweek: 1) ကို စတင်သွင်းနေပါသည်...");
  const configRef = doc(db, "settings", "gameConfig");
  const configBatch = writeBatch(db);
  configBatch.set(configRef, {
    currentGW: 1,
    currentSeason: "2026/27",
    deadline: new Date(Date.UTC(2026, 7, 15, 12, 30, 0)).toISOString(),
    status: "OPEN",
    chipsActivePeriod: "GW1_19",
    totalGameweeks: 38
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

  console.log("🎉 အောင်မြင်ပါသည်! ပွဲစဉ် ၃၈၀ လုံး Firestore ထဲ အပြည့်အစုံ ရောက်ရှိသွားပါပြီ။");
}

// Execute Script with Proper Process Exit
seedAllFixtures()
  .then(() => {
    console.log("🏁 Process Finished Successfully.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("❌ Seeding Failed with Error:", err);
    process.exit(1);
  });
