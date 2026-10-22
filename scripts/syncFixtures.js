// ==========================================================================
// TW Fantasy Official League
// Official FPL API Sync Script (ES Module Compatible for GitHub Actions)
// Path: scripts/syncFixtures.js
// ==========================================================================

import admin from "firebase-admin";
import axios from "axios";

// === ၁။ Firebase Admin Initialization ===
const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;

if (!rawServiceAccount) {
  console.error("❌ Error: FIREBASE_SERVICE_ACCOUNT Environment Variable မတွေ့ရှိပါဗျာ။");
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

// === ၂။ FPL Official API URLs ===
const FPL_BASE = "https://fantasy.premierleague.com/api";
const FIXTURES_URL = `${FPL_BASE}/fixtures/`;
const BOOTSTRAP_URL = `${FPL_BASE}/bootstrap-static/`;

async function fplFetch(url) {
  try {
    const res = await axios.get(url, {
      headers: { "User-Agent": "Mozilla/5.0 TW-Fantasy-Sync/1.0" }
    });
    return res.data;
  } catch (err) {
    console.error(`⚠️ Fetch Failed: ${url} - ${err.message}`);
    throw err;
  }
}

// 💡 +1 နာရီ တိုးပေးမည့် Helper Function
function addOneHourToISO(isoString) {
  if (!isoString) return null;
  const dateObj = new Date(isoString);
  dateObj.setTime(dateObj.getTime() + (1 * 60 * 60 * 1000));
  return dateObj.toISOString();
}

// 💡 Official Team ID Mapping
const officialTeamTranslateMap = {
  "ars": 1,  "avl": 2,  "bou": 3,  "bre": 4,  "bha": 5,
  "che": 6,  "cov": 7,  "cry": 8,  "eve": 9,  "ful": 10,
  "hul": 11, "ips": 12, "lee": 13, "liv": 14, "mci": 15,
  "mun": 16, "new": 17, "nfo": 18, "tot": 19, "sun": 20
};

// 💡 FPL Stats မှ ကတ်များနှင့် Own Goal များ ပေါင်းခြင်း
function sumStatValue(statsArray, identifier, side) {
  const statObj = (statsArray || []).find(s => s.identifier === identifier);
  if (!statObj) return 0;
  const list = side === "h" ? (statObj.h || []) : (statObj.a || []);
  return list.reduce((sum, item) => sum + (Number(item.value) || 0), 0);
}

async function syncOfficialFplApiToFirebase() {
  try {
    console.log("🚀 TW Fantasy — Official FPL Fixtures Sync Starting...");
    const bootstrap = await fplFetch(BOOTSTRAP_URL);

    // Player ID -> Web Name mapping
    const playerWebNameMap = {};
    bootstrap.elements.forEach(el => {
      playerWebNameMap[el.id] = el.web_name;
    });

    // Team ID -> Short name mapping
    const teamShortNameMap = {};
    bootstrap.teams.forEach(t => {
      teamShortNameMap[t.id] = t.short_name.toLowerCase();
    });

    // 💡 FPL Events မှ Current Gameweek အမှန်ကို ရှာဖွေခြင်း
    let currentGW = 1;
    let currentDeadline = null;
    const currentEv = bootstrap.events.find(e => e.is_current);
    const nextEv = bootstrap.events.find(e => e.is_next);

    if (currentEv) {
      // အကယ်၍ လက်ရှိ GW ပွဲအားလုံး ပြီးဆုံးသွားပြီဆိုပါက Next GW သို့ Auto ပြောင်းပေးမည်
      if (currentEv.finished && nextEv) {
        currentGW = nextEv.id;
        currentDeadline = nextEv.deadline_time;
      } else {
        currentGW = currentEv.id;
        currentDeadline = currentEv.deadline_time;
      }
    } else if (nextEv) {
      currentGW = nextEv.id;
      currentDeadline = nextEv.deadline_time;
    }

    console.log(`📌 Official FPL Active Gameweek: GW ${currentGW}`);

    // settings/gameConfig ကို Update လုပ်ခြင်း
    await db.collection("settings").doc("gameConfig").set({
      currentGW: Number(currentGW),
      currentSeason: "2026/27",
      deadline: addOneHourToISO(currentDeadline),
      status: "OPEN",
      chipsActivePeriod: currentGW <= 19 ? "GW1_19" : "GW20_38",
      totalGameweeks: 38,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    console.log("📡 Fetching fixtures from Premier League Official Server...");
    const apiFixtures = await fplFetch(FIXTURES_URL);

    // 🧹 ယခင် မှားဝင်နေသော Berger အတု Document များကို ရှင်းလင်းခြင်း
    console.log("🧹 Cleaning old mismatched fixture documents...");
    const existingSnap = await db.collection("fixtures").get();
    if (!existingSnap.empty) {
      let delBatch = db.batch();
      let delCount = 0;
      for (const docSnap of existingSnap.docs) {
        delBatch.delete(docSnap.ref);
        delCount++;
        if (delCount % 400 === 0) {
          await delBatch.commit();
          delBatch = db.batch();
        }
      }
      if (delCount % 400 !== 0) {
        await delBatch.commit();
      }
      console.log(`✅ ရှင်းလင်းပြီးသော Document အဟောင်းအရေအတွက်: ${delCount}`);
    }

    // DGW/BGW Detector
    const gwTeamMatchCount = {};
    apiFixtures.forEach(m => {
      const gw = m.event;
      if (gw) {
        if (!gwTeamMatchCount[gw]) gwTeamMatchCount[gw] = {};
        gwTeamMatchCount[gw][m.team_h] = (gwTeamMatchCount[gw][m.team_h] || 0) + 1;
        gwTeamMatchCount[gw][m.team_a] = (gwTeamMatchCount[gw][m.team_a] || 0) + 1;
      }
    });

    let batch = db.batch();
    let count = 0;

    for (const apiMatch of apiFixtures) {
      const gw = apiMatch.event !== null ? Number(apiMatch.event) : null;
      const homeTeamShort = teamShortNameMap[apiMatch.team_h] || "";
      const awayTeamShort = teamShortNameMap[apiMatch.team_a] || "";
      const homeCode = homeTeamShort.toUpperCase();
      const awayCode = awayTeamShort.toUpperCase();

      // Document ID
      const idStr = gw ? `GW${gw}_${homeCode}_${awayCode}` : String(apiMatch.id);
      const fixtureDocRef = db.collection("fixtures").doc(idStr);

      const adjustedKickoffTime = addOneHourToISO(apiMatch.kickoff_time);

      const formattedStats = (apiMatch.stats || []).map(statType => ({
        identifier: statType.identifier,
        h: (statType.h || []).map(p => ({
          element: p.element,
          value: p.value,
          element_name: playerWebNameMap[p.element] || "Player"
        })),
        a: (statType.a || []).map(p => ({
          element: p.element,
          value: p.value,
          element_name: playerWebNameMap[p.element] || "Player"
        }))
      }));

      const isHomeDgw = gw && gwTeamMatchCount[gw] && gwTeamMatchCount[gw][apiMatch.team_h] > 1;
      const isAwayDgw = gw && gwTeamMatchCount[gw] && gwTeamMatchCount[gw][apiMatch.team_a] > 1;
      const isDoubleGameweek = Boolean(isHomeDgw || isAwayDgw);
      const isPostponed = apiMatch.event === null || apiMatch.kickoff_time === null;

      const isStarted = Boolean(apiMatch.started);
      const isFinished = Boolean(apiMatch.finished || apiMatch.finished_provisional);

      let statusStr = "UPCOMING";
      if (isFinished) statusStr = "FINISHED";
      else if (isStarted) statusStr = "LIVE";

      const hScore = apiMatch.team_h_score !== undefined && apiMatch.team_h_score !== null ? Number(apiMatch.team_h_score) : null;
      const aScore = apiMatch.team_a_score !== undefined && apiMatch.team_a_score !== null ? Number(apiMatch.team_a_score) : null;

      let homeRes = null;
      let awayRes = null;
      if (isStarted && hScore !== null && aScore !== null) {
        if (hScore > aScore) { homeRes = "WIN"; awayRes = "LOSE"; }
        else if (hScore === aScore) { homeRes = "DRAW"; awayRes = "DRAW"; }
        else { homeRes = "LOSE"; awayRes = "WIN"; }
      }

      const matchData = {
        id: idStr,
        fpl_id: apiMatch.id,
        event: gw,
        gameweek: gw,
        kickoff_time: adjustedKickoffTime,
        kickoffTime: adjustedKickoffTime,
        team_h: apiMatch.team_h,
        team_a: apiMatch.team_a,
        team_h_code: homeCode,
        team_a_code: awayCode,
        homeClub: homeCode,
        awayClub: awayCode,
        team_h_jersey_id: officialTeamTranslateMap[homeTeamShort] || apiMatch.team_h,
        team_a_jersey_id: officialTeamTranslateMap[awayTeamShort] || apiMatch.team_a,
        team_h_difficulty: apiMatch.team_h_difficulty || 3,
        team_a_difficulty: apiMatch.team_a_difficulty || 3,

        is_dgw: isDoubleGameweek,
        is_home_dgw: Boolean(isHomeDgw),
        is_away_dgw: Boolean(isAwayDgw),
        is_postponed: isPostponed,

        status: statusStr,
        started: isStarted,
        finished: Boolean(apiMatch.finished),
        finished_provisional: Boolean(apiMatch.finished_provisional),
        minutes: Number(apiMatch.minutes) || 0,
        team_h_score: hScore,
        team_a_score: aScore,
        homeScore: hScore,
        awayScore: aScore,

        matchResult: {
          home: homeRes,
          away: awayRes
        },

        // TW Scoring Engine Events
        homeEvents: {
          goalsScored: hScore || 0,
          cleanSheet: isFinished && aScore === 0,
          yellowCards: sumStatValue(apiMatch.stats, "yellow_cards", "h"),
          redCards: sumStatValue(apiMatch.stats, "red_cards", "h"),
          ownGoals: sumStatValue(apiMatch.stats, "own_goals", "h")
        },
        awayEvents: {
          goalsScored: aScore || 0,
          cleanSheet: isFinished && hScore === 0,
          yellowCards: sumStatValue(apiMatch.stats, "yellow_cards", "a"),
          redCards: sumStatValue(apiMatch.stats, "red_cards", "a"),
          ownGoals: sumStatValue(apiMatch.stats, "own_goals", "a")
        },

        stats: formattedStats,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };

      batch.set(fixtureDocRef, matchData, { merge: true });
      count++;

      if (count % 400 === 0) {
        await batch.commit();
        batch = db.batch();
      }
    }

    if (count % 400 !== 0) {
      await batch.commit();
    }

    // GW Summary Metadata
    console.log("📊 Writing Gameweek BGW/DGW Summary Metadata to Firestore...");
    const gwSummaryRef = db.collection("system_meta").doc("gameweeks_summary");
    const totalTeams = Object.keys(officialTeamTranslateMap).map(k => officialTeamTranslateMap[k]);

    const summaryData = {};
    for (let g = 1; g <= 38; g++) {
      const activeTeamsInGw = gwTeamMatchCount[g] ? Object.keys(gwTeamMatchCount[g]).map(Number) : [];
      const blankTeams = totalTeams.filter(tId => !activeTeamsInGw.includes(tId));
      const doubleTeams = activeTeamsInGw.filter(tId => gwTeamMatchCount[g][tId] > 1);

      summaryData[`gw_${g}`] = {
        gameweek: g,
        has_blank: blankTeams.length > 0,
        has_double: doubleTeams.length > 0,
        blank_team_ids: blankTeams,
        double_team_ids: doubleTeams
      };
    }

    await gwSummaryRef.set({
      summary: summaryData,
      lastSync: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    console.log(`🚀 [SUCCESS] FPL Official ပွဲစဉ်ပေါင်း (${count}) ခုအား Firebase သို့ အောင်မြင်စွာ ရေးသွင်းပြီးပါပြီ။`);
    process.exit(0);

  } catch (error) {
    console.error("❌ Sync ကျရှုံးပါသည်:", error.message);
    process.exit(1);
  }
}

syncOfficialFplApiToFirebase();
