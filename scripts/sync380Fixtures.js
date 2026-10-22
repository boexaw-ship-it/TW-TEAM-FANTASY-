// ==========================================================================
// TW TEAM FANTASY — SCRIPT 1: SYNC 380 FIXTURES & SET CURRENT GAMEWEEK
// Path: scripts/sync380Fixtures.js (ES Module)
// Features: Auto Current GW, Clean Sheet, Results, Official Player Stats & Positions
// ==========================================================================

import admin from "firebase-admin";
import axios from "axios";

// === ၁။ Firebase Admin Service Account စစ်ဆေးခြင်း ===
const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!rawServiceAccount) {
  console.error("❌ FIREBASE_SERVICE_ACCOUNT Environment Variable မတွေ့ရှိပါဗျာ။");
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

// 💡 +1 နာရီ တိုးပေးမည့် Helper Function (Kickoff & Deadline Time)
function addOneHourToISO(isoString) {
  if (!isoString) return null;
  const d = new Date(isoString);
  d.setTime(d.getTime() + 3600000);
  return d.toISOString();
}

// 💡 Cards & Own Goals Stats ပေါင်းစပ်တွက်ချက်ပေးမည့် Helper Function
function sumStatValue(statsArray, identifier, side) {
  const statObj = (statsArray || []).find(s => s.identifier === identifier);
  if (!statObj) return 0;
  const list = side === "h" ? (statObj.h || []) : (statObj.a || []);
  return list.reduce((sum, item) => sum + (Number(item.value) || 0), 0);
}

async function syncAll380Fixtures() {
  try {
    console.log("🚀 [SCRIPT 1] ပွဲစဉ် ၃၈၀ နှင့် Current GW စတင်ဆွဲယူနေပါသည်...");

    // ၂။ FPL Bootstrap-Static မှ အသင်းများနှင့် ကစားသမား အချက်အလက်များ ရယူခြင်း
    const bootRes = await axios.get(`${FPL_BASE}/bootstrap-static/`, {
      headers: { "User-Agent": "Mozilla/5.0 TW-Fantasy/1.0" }
    });
    const bootstrap = bootRes.data;

    // Team ID -> Code (ARS, CHE, etc.) Mapping
    const teamShortMap = {};
    bootstrap.teams.forEach(t => {
      teamShortMap[t.id] = t.short_name.toUpperCase();
    });

    // Player ID -> Official Info (Name, Element Type) Mapping
    // element_type: 1 = GK, 2 = DEF, 3 = MID, 4 = FWD
    const playerMetaMap = {};
    bootstrap.elements.forEach(el => {
      playerMetaMap[el.id] = {
        name: el.web_name || "Player",
        element_type: Number(el.element_type) || 3
      };
    });

    // ၃။ Current Gameweek အလိုအလျောက် ရှာဖွေခြင်း
    let currentGW = 1;
    let deadlineTime = null;
    const curEv = bootstrap.events.find(e => e.is_current);
    const nextEv = bootstrap.events.find(e => e.is_next);

    if (curEv) {
      // လက်ရှိအပတ် ပွဲစဉ်အားလုံး ပြီးသွားပါက Next GW သို့ Auto ပြောင်းမည်
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

    // settings/gameConfig ကို Update ပြုလုပ်ခြင်း
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

    // ၄။ FPL Server မှ ပွဲစဉ် ၃၈၀ စလုံးကို ဆွဲယူခြင်း
    console.log("📡 FPL Server မှ Fixtures အားလုံးကို ဆွဲယူနေပါသည်...");
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

      const hScore = (m.team_h_score !== null && m.team_h_score !== undefined) ? Number(m.team_h_score) : null;
      const aScore = (m.team_a_score !== null && m.team_a_score !== undefined) ? Number(m.team_a_score) : null;

      // Match Result (WIN / DRAW / LOSE)
      let homeRes = null;
      let awayRes = null;
      if (isStarted && hScore !== null && aScore !== null) {
        if (hScore > aScore) {
          homeRes = "WIN";
          awayRes = "LOSE";
        } else if (hScore === aScore) {
          homeRes = "DRAW";
          awayRes = "DRAW";
        } else {
          homeRes = "LOSE";
          awayRes = "WIN";
        }
      }

      // 📋 Match Events (Goals, Assists, Cards) တွင် Player Name နှင့် Official Position ထည့်သွင်းခြင်း
      const formattedStats = (m.stats || []).map(statType => ({
        identifier: statType.identifier,
        h: (statType.h || []).map(p => {
          const pInfo = playerMetaMap[p.element] || { name: "Player", element_type: 3 };
          return {
            element: p.element,
            value: Number(p.value) || 1,
            name: pInfo.name,
            element_name: pInfo.name,
            element_type: pInfo.element_type
          };
        }),
        a: (statType.a || []).map(p => {
          const pInfo = playerMetaMap[p.element] || { name: "Player", element_type: 3 };
          return {
            element: p.element,
            value: Number(p.value) || 1,
            name: pInfo.name,
            element_name: pInfo.name,
            element_type: pInfo.element_type
          };
        })
      }));

      // Firestore Fixture Document Structure
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
        team_h_score: hScore,
        team_a_score: aScore,
        matchResult: {
          home: homeRes,
          away: awayRes
        },
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
        stats: formattedStats,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };

      batch.set(db.collection("fixtures").doc(docId), payload, { merge: true });
      count++;

      // Batch Size 400 ပြည့်တိုင်း Commit လုပ်ခြင်း
      if (count % 400 === 0) {
        await batch.commit();
        batch = db.batch();
      }
    }

    if (count % 400 !== 0) {
      await batch.commit();
    }

    console.log(`🎉 [SUCCESS] ပွဲစဉ်ပေါင်း (${count}) ပွဲလုံး Official Stats & Position များဖြင့် Firestore သို့ အောင်မြင်စွာ ရေးသွင်းပြီးပါပြီ။`);
    process.exit(0);

  } catch (err) {
    console.error("❌ Error in sync380Fixtures:", err.message);
    process.exit(1);
  }
}

syncAll380Fixtures();
