// ==========================================================================
// SCRIPT 2: UPDATE ONLY CURRENT GAMEWEEK LIVE / FT DATA
// Path: scripts/updateCurrentGW.js
// ==========================================================================

import admin from "firebase-admin";
import axios from "axios";

const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!rawServiceAccount) {
  console.error("❌ FIREBASE_SERVICE_ACCOUNT မတွေ့ရှိပါ။");
  process.exit(1);
}

const serviceAccount = typeof rawServiceAccount === "string"
  ? JSON.parse(rawServiceAccount)
  : rawServiceAccount;

if (admin.apps.length === 0) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();
const FPL_BASE = "https://fantasy.premierleague.com/api";

function sumStatValue(statsArray, identifier, side) {
  const statObj = (statsArray || []).find(s => s.identifier === identifier);
  if (!statObj) return 0;
  const list = side === "h" ? (statObj.h || []) : (statObj.a || []);
  return list.reduce((sum, item) => sum + (Number(item.value) || 0), 0);
}

async function updateCurrentGameweekMatches() {
  try {
    // 1. Get Current GW from Firestore settings/gameConfig
    const configSnap = await db.collection("settings").doc("gameConfig").get();
    const currentGW = configSnap.exists ? (Number(configSnap.data().currentGW) || 8) : 8;

    console.log(`⚡ [SCRIPT 2] Current Gameweek (GW ${currentGW}) ပွဲစဉ်ဒေတာများ လိုက်ဖြည့်နေပါသည်...`);

    // 2. Fetch Team Map & Only Current GW Fixtures (?event=GW)
    const bootRes = await axios.get(`${FPL_BASE}/bootstrap-static/`, {
      headers: { "User-Agent": "Mozilla/5.0 TW-Fantasy/1.0" }
    });
    const teamShortMap = {};
    bootRes.data.teams.forEach(t => {
      teamShortMap[t.id] = t.short_name.toUpperCase();
    });

    const fixRes = await axios.get(`${FPL_BASE}/fixtures/?event=${currentGW}`, {
      headers: { "User-Agent": "Mozilla/5.0 TW-Fantasy/1.0" }
    });
    const gwMatches = fixRes.data || [];

    const batch = db.batch();
    let updatedCount = 0;
    let finishedCount = 0;

    for (const m of gwMatches) {
      const homeCode = teamShortMap[m.team_h] || "HOME";
      const awayCode = teamShortMap[m.team_a] || "AWAY";
      const docId = `GW${currentGW}_${homeCode}_${awayCode}`;

      const isStarted = Boolean(m.started);
      const isFinished = Boolean(m.finished || m.finished_provisional);
      if (isFinished) finishedCount++;

      const statusStr = isFinished ? "FINISHED" : (isStarted ? "LIVE" : "UPCOMING");
      const hScore = m.team_h_score !== null && m.team_h_score !== undefined ? Number(m.team_h_score) : null;
      const aScore = m.team_a_score !== null && m.team_a_score !== undefined ? Number(m.team_a_score) : null;

      let homeRes = null, awayRes = null;
      if (isStarted && hScore !== null && aScore !== null) {
        if (hScore > aScore) { homeRes = "WIN"; awayRes = "LOSE"; }
        else if (hScore === aScore) { homeRes = "DRAW"; awayRes = "DRAW"; }
        else { homeRes = "LOSE"; awayRes = "WIN"; }
      }

      batch.set(db.collection("fixtures").doc(docId), {
        status: statusStr,
        started: isStarted,
        finished: isFinished,
        minutes: Number(m.minutes) || 0,
        homeScore: hScore,
        awayScore: aScore,
        team_h_score: hScore,
        team_a_score: aScore,
        matchResult: { home: homeRes, away: awayRes },
        homeEvents: {
          goalsScored: hScore || 0,
          cleanSheet: isFinished && aScore === 0,
          yellowCards: sumStatValue(m.stats, "yellow_cards", "h"),
          redCards: sumStatValue(m.stats, "red_cards", "h"),
          ownGoals: sumStatValue(m.stats, "own_goals", "h")
        },
        awayEvents: {
          goalsScored: aScore || 0,
          cleanSheet: isFinished && hScore === 0,
          yellowCards: sumStatValue(m.stats, "yellow_cards", "a"),
          redCards: sumStatValue(m.stats, "red_cards", "a"),
          ownGoals: sumStatValue(m.stats, "own_goals", "a")
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      updatedCount++;
    }

    await batch.commit();
    console.log(`✅ GW ${currentGW} မှ ပွဲစဉ် (${updatedCount}) ပွဲ Update ပြီးပါပြီ (ပြီးဆုံးပွဲ: ${finishedCount}/${updatedCount})။`);
    process.exit(0);

  } catch (err) {
    console.error("❌ Error in updateCurrentGW:", err.message);
    process.exit(1);
  }
}

updateCurrentGameweekMatches();
