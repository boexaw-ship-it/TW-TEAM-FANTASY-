// ==========================================================================
// SCRIPT 1: SYNC ALL 380 FIXTURES & SET CURRENT GAMEWEEK
// Path: scripts/sync380Fixtures.js
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

function addOneHourToISO(isoString) {
  if (!isoString) return null;
  const d = new Date(isoString);
  d.setTime(d.getTime() + 3600000);
  return d.toISOString();
}

function sumStatValue(statsArray, identifier, side) {
  const statObj = (statsArray || []).find(s => s.identifier === identifier);
  if (!statObj) return 0;
  const list = side === "h" ? (statObj.h || []) : (statObj.a || []);
  return list.reduce((sum, item) => sum + (Number(item.value) || 0), 0);
}

async function syncAll380Fixtures() {
  try {
    console.log("🚀 [SCRIPT 1] ပွဲစဉ် ၃၈၀ နှင့် Current GW စတင်သွင်းနေပါသည်...");

    const bootRes = await axios.get(`${FPL_BASE}/bootstrap-static/`, {
      headers: { "User-Agent": "Mozilla/5.0 TW-Fantasy/1.0" }
    });
    const bootstrap = bootRes.data;

    const teamShortMap = {};
    bootstrap.teams.forEach(t => {
      teamShortMap[t.id] = t.short_name.toUpperCase();
    });

    // Current Gameweek ရှာဖွေခြင်း
    let currentGW = 1;
    let deadlineTime = null;
    const curEv = bootstrap.events.find(e => e.is_current);
    const nextEv = bootstrap.events.find(e => e.is_next);

    if (curEv) {
      if (curEv.finished && nextEv) {
        currentGW = nextEv.id;
        deadlineTime = nextEv.deadline_time;
      } else {
        currentGW = curEv.id;
        deadlineTime = curEv.deadline_time;
      }
    } else if (nextEv) {
      currentGW = nextEv.id;
      deadlineTime = nextEv.deadline_time;
    }

    // 1. Update settings/gameConfig
    await db.collection("settings").doc("gameConfig").set({
      currentGW: Number(currentGW),
      currentSeason: "2026/27",
      deadline: addOneHourToISO(deadlineTime),
      status: "OPEN",
      chipsActivePeriod: currentGW <= 19 ? "GW1_19" : "GW20_38",
      totalGameweeks: 38,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    console.log(`✅ Current Gameweek အား GW ${currentGW} သို့ သတ်မှတ်ပြီးပါပြီ။`);

    // 2. Fetch all 380 Fixtures
    const fixRes = await axios.get(`${FPL_BASE}/fixtures/`, {
      headers: { "User-Agent": "Mozilla/5.0 TW-Fantasy/1.0" }
    });
    const apiFixtures = fixRes.data;

    let batch = db.batch();
    let count = 0;

    for (const m of apiFixtures) {
      const gw = m.event !== null ? Number(m.event) : null;
      if (!gw) continue;

      const homeCode = teamShortMap[m.team_h] || "HOME";
      const awayCode = teamShortMap[m.team_a] || "AWAY";
      const docId = `GW${gw}_${homeCode}_${awayCode}`;

      const isStarted = Boolean(m.started);
      const isFinished = Boolean(m.finished || m.finished_provisional);
      const statusStr = isFinished ? "FINISHED" : (isStarted ? "LIVE" : "UPCOMING");

      const hScore = m.team_h_score !== null && m.team_h_score !== undefined ? Number(m.team_h_score) : null;
      const aScore = m.team_a_score !== null && m.team_a_score !== undefined ? Number(m.team_a_score) : null;

      let homeRes = null, awayRes = null;
      if (isStarted && hScore !== null && aScore !== null) {
        if (hScore > aScore) { homeRes = "WIN"; awayRes = "LOSE"; }
        else if (hScore === aScore) { homeRes = "DRAW"; awayRes = "DRAW"; }
        else { homeRes = "LOSE"; awayRes = "WIN"; }
      }

      const payload = {
        id: docId,
        fpl_id: m.id,
        gameweek: gw,
        event: gw,
        homeClub: homeCode,
        awayClub: awayCode,
        team_h_code: homeCode,
        team_a_code: awayCode,
        kickoffTime: addOneHourToISO(m.kickoff_time),
        status: statusStr,
        started: isStarted,
        finished: isFinished,
        minutes: Number(m.minutes) || 0,
        homeScore: hScore,
        awayScore: aScore,
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
      };

      batch.set(db.collection("fixtures").doc(docId), payload, { merge: true });
      count++;

      if (count % 400 === 0) {
        await batch.commit();
        batch = db.batch();
      }
    }

    if (count % 400 !== 0) {
      await batch.commit();
    }

    console.log(`🎉 [SUCCESS] ပွဲစဉ် (${count}) ပွဲလုံး Firestore သို့ သွင်းပြီးပါပြီ။`);
    process.exit(0);
  } catch (err) {
    console.error("❌ Error in sync380Fixtures:", err.message);
    process.exit(1);
  }
}

syncAll380Fixtures();
