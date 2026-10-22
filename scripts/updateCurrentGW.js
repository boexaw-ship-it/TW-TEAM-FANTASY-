// ==========================================================================
// SCRIPT 2: UPDATE ONLY CURRENT GAMEWEEK LIVE / FT DATA
// Path: scripts/updateCurrentGW.js
// Features: Live Scores, Auto Rollover to Next GW, Full Stats with Player Positions
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

async function updateCurrentGameweekMatches() {
  try {
    // ၁။ FPL Server မှ Bootstrap Static ရယူခြင်း (Team Map, Player Map, Official Current Event)
    const bootRes = await axios.get(`${FPL_BASE}/bootstrap-static/`, {
      headers: { "User-Agent": "Mozilla/5.0 TW-Fantasy/1.0" }
    });
    const bootstrap = bootRes.data;

    const teamShortMap = {};
    bootstrap.teams.forEach(t => {
      teamShortMap[t.id] = t.short_name.toUpperCase();
    });

    const playerMetaMap = {};
    bootstrap.elements.forEach(el => {
      playerMetaMap[el.id] = {
        name: el.web_name || "Player",
        element_type: Number(el.element_type) || 3
      };
    });

    // ၂။ Firestore မှ လက်ရှိ GameConfig ဖတ်ယူခြင်း
    const configRef = db.collection("settings").doc("gameConfig");
    const configSnap = await configRef.get();
    
    // Official Current GW သို့မဟုတ် Firestore ရှိ GW ကို ရယူခြင်း
    const officialCurEv = bootstrap.events.find(e => e.is_current);
    let activeGW = configSnap.exists ? (Number(configSnap.data().currentGW) || 1) : 1;
    if (officialCurEv && officialCurEv.id) {
      activeGW = officialCurEv.id;
    }

    console.log(`⚡ [SCRIPT 2] Current Gameweek (GW ${activeGW}) ပွဲစဉ်ဒေတာများ စတင်ဆွဲယူနေပါသည်...`);

    // ၃။ Current GW အတွက်သာ ပွဲစဉ်များ ရယူခြင်း
    const fixRes = await axios.get(`${FPL_BASE}/fixtures/?event=${activeGW}`, {
      headers: { "User-Agent": "Mozilla/5.0 TW-Fantasy/1.0" }
    });
    const gwMatches = fixRes.data || [];

    if (gwMatches.length === 0) {
      console.log(`ℹ️ GW ${activeGW} အတွက် ပွဲစဉ် မရှိသေးပါ။`);
      process.exit(0);
    }

    const batch = db.batch();
    let updatedCount = 0;
    let finishedCount = 0;

    for (const m of gwMatches) {
      const homeCode = teamShortMap[m.team_h] || "HOME";
      const awayCode = teamShortMap[m.team_a] || "AWAY";
      const docId = `GW${activeGW}_${homeCode}_${awayCode}`;

      const isStarted = Boolean(m.started);
      const isFinished = Boolean(m.finished || m.finished_provisional);
      if (isFinished) finishedCount++;

      const statusStr = isFinished ? "FINISHED" : (isStarted ? "LIVE" : "UPCOMING");
      const hScore = (m.team_h_score !== null && m.team_h_score !== undefined) ? Number(m.team_h_score) : null;
      const aScore = (m.team_a_score !== null && m.team_a_score !== undefined) ? Number(m.team_a_score) : null;

      let homeRes = null;
      let awayRes = null;
      if (isStarted && hScore !== null && aScore !== null) {
        if (hScore > aScore) { homeRes = "WIN"; awayRes = "LOSE"; }
        else if (hScore === aScore) { homeRes = "DRAW"; awayRes = "DRAW"; }
        else { homeRes = "LOSE"; awayRes = "WIN"; }
      }

      // Match Events တွင် Player Name နှင့် Official Position ကို ထိန်းသိမ်းခြင်း
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
        stats: formattedStats,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      updatedCount++;
    }

    // ၄။ အကယ်၍ ပွဲစဉ်အားလုံး ပြီးသွားပါက Next GW သို့ Auto Rollover ပြုလုပ်ခြင်း
    if (finishedCount === gwMatches.length && finishedCount > 0) {
      const nextEv = bootstrap.events.find(e => e.is_next);
      if (nextEv) {
        console.log(`🔄 GW ${activeGW} ပွဲစဉ်များ အားလုံးပြီးဆုံးသဖြင့် GW ${nextEv.id} သို့ ပြောင်းလဲပါမည်။`);
        batch.set(configRef, {
          currentGW: Number(nextEv.id),
          deadline: addOneHourToISO(nextEv.deadline_time),
          chipsActivePeriod: nextEv.id <= 19 ? "GW1_19" : "GW20_38",
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      }
    }

    await batch.commit();
    console.log(`✅ [SUCCESS] GW ${activeGW} မှ ပွဲစဉ် (${updatedCount}) ပွဲ Data အပြည့်အစုံ ဖြည့်သွင်းပြီးပါပြီ (Finished: ${finishedCount}/${updatedCount})။`);
    process.exit(0);

  } catch (err) {
    console.error("❌ Error in updateCurrentGW:", err.message);
    process.exit(1);
  }
}

updateCurrentGameweekMatches();
