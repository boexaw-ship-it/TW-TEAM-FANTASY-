// ==========================================================================
// TW TEAM FANTASY — OFFICIAL FPL FIXTURES & GW SCORING SYNC ENGINE
// Project: tw-team-fantasy (Firestore Sync + Current GW Auto-Advance)
// Path: scripts/syncFixtures.js
// ==========================================================================

const admin = require("firebase-admin");
const axios = require("axios");

// === ၁။ Firebase Admin SDK စတင်ချိတ်ဆက်ခြင်း ===
const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;

if (!rawServiceAccount) {
  console.error("❌ Error: GitHub Secret ထဲတွင် FIREBASE_SERVICE_ACCOUNT မတွေ့ရှိပါခင်ဗျာ။");
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

// === ၂။ FPL API Endpoints ===
const FPL_BASE = "https://fantasy.premierleague.com/api";
const FIXTURES_URL = `${FPL_BASE}/fixtures/`;
const BOOTSTRAP_URL = `${FPL_BASE}/bootstrap-static/`;

async function fplFetch(url) {
  try {
    const res = await axios.get(url, {
      headers: { "User-Agent": "TW-Team-Fantasy-Engine/2026.1" }
    });
    return res.data;
  } catch (err) {
    console.error(`⚠️ FPL API ချိတ်ဆက်မှု မအောင်မြင်ပါ: ${url} - ${err.message}`);
    throw err;
  }
}

// Kickoff Time ကို +1 နာရီ တိုးပေးခြင်း
function addOneHourToISO(isoString) {
  if (!isoString) return null;
  const dateObj = new Date(isoString);
  dateObj.setTime(dateObj.getTime() + (1 * 60 * 60 * 1000));
  return dateObj.toISOString();
}

// Event Stats (Goals, Cards, Own Goals) စုစုပေါင်း တွက်ချက်ခြင်း
function extractSideEvents(statsArray, side) {
  const getSum = (identifier) => {
    const item = (statsArray || []).find(s => s.identifier === identifier);
    if (!item) return 0;
    const targetSide = side === "h" ? item.h : item.a;
    return (targetSide || []).reduce((acc, p) => acc + (Number(p.value) || 0), 0);
  };

  return {
    goalsScored: getSum("goals_scored"),
    yellowCards: getSum("yellow_cards"),
    redCards: getSum("red_cards"),
    ownGoals: getSum("own_goals")
  };
}

async function startSync() {
  try {
    console.log("🚀 TW Fantasy — Premier League Official Fixtures Sync စတင်နေပါပြီ...");

    // ၁။ Bootstrap Data (Teams & Gameweek Events) ရယူခြင်း
    const bootstrap = await fplFetch(BOOTSTRAP_URL);

    const teamShortNameMap = {};
    bootstrap.teams.forEach(t => {
      teamShortNameMap[t.id] = t.short_name.toUpperCase();
    });

    const playerWebNameMap = {};
    bootstrap.elements.forEach(el => {
      playerWebNameMap[el.id] = el.web_name;
    });

    // လက်ရှိ Gameweek အမှန်ကို ရှာဖွေခြင်း (GW 8 Active စစ်ဆေးမှု)
    let currentGameweek = 1;
    let nextDeadline = null;

    const currentEvent = bootstrap.events.find(ev => ev.is_current) || 
                         bootstrap.events.find(ev => ev.is_next) || 
                         bootstrap.events[0];

    if (currentEvent) {
      currentGameweek = currentEvent.id;
      nextDeadline = currentEvent.deadline_time;
    }

    console.log(`📌 လက်ရှိ Active Gameweek: GW ${currentGameweek} (Deadline: ${nextDeadline})`);

    // ၂။ System Game Settings Document ကို GW အသစ်ဖြင့် Update လုပ်ခြင်း
    const configRef = db.collection("settings").doc("gameConfig");
    await configRef.set({
      currentGW: currentGameweek,
      currentSeason: "2026/27",
      deadline: nextDeadline,
      status: "OPEN",
      chipsActivePeriod: currentGameweek <= 19 ? "GW1_19" : "GW20_38",
      totalGameweeks: 38,
      lastSyncedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    console.log(`✅ settings/gameConfig တွင် currentGW: ${currentGameweek} သို့ ပြင်ဆင်ပြီးပါပြီ။`);

    // ၃။ ပွဲစဉ်များအားလုံး ဆွဲယူခြင်း
    console.log("📡 FPL Official Server မှ ပွဲစဉ် ၃၈၀ ရယူနေပါသည်...");
    const apiFixtures = await fplFetch(FIXTURES_URL);

    let batch = db.batch();
    let batchCount = 0;
    let totalUpdated = 0;

    for (const match of apiFixtures) {
      const gw = match.event;
      if (!gw) continue; // Postponed/Unassigned fixtures skip

      const homeCode = teamShortNameMap[match.team_h] || "HOME";
      const awayCode = teamShortNameMap[match.team_a] || "AWAY";

      // 💡 Document ID: TW Database စံသတ်မှတ်ချက်အတိုင်း GW10_BHA_NEW ပုံစံဖြင့် တည်ဆောက်ခြင်း
      const docId = `GW${gw}_${homeCode}_${awayCode}`;
      const fixtureDocRef = db.collection("fixtures").doc(docId);

      const isFinished = Boolean(match.finished || match.finished_provisional);
      const isStarted = Boolean(match.started);

      let status = "UPCOMING";
      if (isFinished) status = "FINISHED";
      else if (isStarted) status = "LIVE";

      const homeScore = match.team_h_score !== undefined ? match.team_h_score : null;
      const awayScore = match.team_a_score !== undefined ? match.team_a_score : null;

      // Clean Sheet စစ်ဆေးချက်
      const homeCleanSheet = isFinished && awayScore === 0;
      const awayCleanSheet = isFinished && homeScore === 0;

      // Event Stats များ ဆွဲထုတ်ခြင်း
      const homeEv = extractSideEvents(match.stats, "h");
      const awayEv = extractSideEvents(match.stats, "a");

      // Match Result (WIN / DRAW / LOSE)
      let homeResult = null;
      let awayResult = null;
      if (isFinished && homeScore !== null && awayScore !== null) {
        if (homeScore > awayScore) {
          homeResult = "WIN";
          awayResult = "LOSE";
        } else if (homeScore === awayScore) {
          homeResult = "DRAW";
          awayResult = "DRAW";
        } else {
          homeResult = "LOSE";
          awayResult = "WIN";
        }
      }

      // Player Name ပါဝင်သော Formatted Stats
      const formattedStats = (match.stats || []).map(statType => ({
        identifier: statType.identifier,
        h: (statType.h || []).map(p => ({
          element: p.element,
          value: p.value,
          name: playerWebNameMap[p.element] || "Player"
        })),
        a: (statType.a || []).map(p => ({
          element: p.element,
          value: p.value,
          name: playerWebNameMap[p.element] || "Player"
        }))
      }));

      // TW Firestore Data Model (Client Web App & Scoring Engine နှစ်မျိုးလုံးနှင့် ကိုက်ညီအောင် သိမ်းခြင်း)
      const fixturePayload = {
        id: docId,
        fplId: match.id,
        gameweek: Number(gw),
        homeClub: homeCode,
        awayClub: awayCode,
        status: status,
        kickoffTime: addOneHourToISO(match.kickoff_time),
        minutes: Number(match.minutes) || 0,

        // ရလဒ်နှင့် ဂိုးများ
        homeScore: homeScore,
        awayScore: awayScore,
        matchResult: {
          home: homeResult,
          away: awayResult
        },

        // TW Scoring Engine အတွက် မရှိမဖြစ် Event Data များ
        homeEvents: {
          goalsScored: homeEv.goalsScored,
          cleanSheet: homeCleanSheet,
          redCards: homeEv.redCards,
          yellowCards: homeEv.yellowCards,
          ownGoals: homeEv.ownGoals
        },
        awayEvents: {
          goalsScored: awayEv.goalsScored,
          cleanSheet: awayCleanSheet,
          redCards: awayEv.redCards,
          yellowCards: awayEv.yellowCards,
          ownGoals: awayEv.ownGoals
        },

        // အသေးစိတ် ကစားသမား Stats
        stats: formattedStats,

        // Official FPL Direct Keys
        team_h_code: homeCode,
        team_a_code: awayCode,
        team_h_score: homeScore,
        team_a_score: awayScore,
        finished: isFinished,
        started: isStarted,

        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };

      batch.set(fixtureDocRef, fixturePayload, { merge: true });
      batchCount++;
      totalUpdated++;

      // Firestore Batch Limit (500) မကျော်စေရန် ခွဲသွင်းခြင်း
      if (batchCount >= 400) {
        await batch.commit();
        batch = db.batch();
        batchCount = 0;
      }
    }

    if (batchCount > 0) {
      await batch.commit();
    }

    console.log(`🎉 အောင်မြင်ပါသည်! ပွဲစဉ်ပေါင်း (${totalUpdated}) ခုအား GW 8 အခြေအနေဖြင့် Firestore ထဲသို့ ရေးသွင်းပြီးပါပြီ။`);
    process.exit(0);

  } catch (error) {
    console.error("❌ Sync ပြုလုပ်စဉ် Error ဖြစ်ပေါ်ခဲ့ပါသည်:", error);
    process.exit(1);
  }
}

startSync();
