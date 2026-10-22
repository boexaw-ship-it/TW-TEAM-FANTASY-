// ==========================================================================
// SCRIPT 3: CALCULATE CONTESTANT FANTASY SCORES & UPDATE STANDINGS
// Path: scripts/calculateScores.js
// ==========================================================================

import admin from "firebase-admin";

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

const CLUBS_TIER = {
  MCI: { win: 3, draw: 1, lose: -3 },
  ARS: { win: 3, draw: 1, lose: -3 },
  LIV: { win: 4, draw: 1, lose: -2 },
  CHE: { win: 4, draw: 2, lose: -2 },
  BHA: { win: 4, draw: 2, lose: -2 },
  AVL: { win: 5, draw: 2, lose: -2 },
  NEW: { win: 5, draw: 2, lose: -2 },
  BRE: { win: 5, draw: 2, lose: -2 },
  EVE: { win: 5, draw: 2, lose: -2 },
  BOU: { win: 5, draw: 2, lose: -2 },
  MUN: { win: 6, draw: 2, lose: -1 },
  TOT: { win: 6, draw: 3, lose: -1 },
  CRY: { win: 6, draw: 3, lose: -1 },
  FUL: { win: 7, draw: 3, lose: -1 },
  NFO: { win: 7, draw: 3, lose: -1 },
  SUN: { win: 8, draw: 4, lose: 0 },
  LEE: { win: 8, draw: 4, lose: 0 },
  COV: { win: 8, draw: 4, lose: 0 },
  IPS: { win: 8, draw: 4, lose: 0 },
  HUL: { win: 8, draw: 4, lose: 0 }
};

function computeClubFixturePoints(fixture, clubCode, pos) {
  const isHome = fixture.homeClub === clubCode;
  const myGoals = isHome ? fixture.homeScore : fixture.awayScore;
  const oppGoals = isHome ? fixture.awayScore : fixture.homeScore;
  const myEvents = isHome ? fixture.homeEvents : fixture.awayEvents;

  if (myGoals === null || myGoals === undefined) return 0;

  const tier = CLUBS_TIER[clubCode] || { win: 5, draw: 2, lose: -1 };
  let resPts = 0;
  if (myGoals > oppGoals) resPts = tier.win;
  else if (myGoals === oppGoals) resPts = tier.draw;
  else resPts = tier.lose;

  const goalMult = pos === "GK" ? 8 : (pos === "DEF" ? 6 : (pos === "MID" ? 4 : 3));
  const goalPts = (myEvents?.goalsScored || 0) * goalMult;

  const hasCS = (pos === "GK" || pos === "DEF") && oppGoals === 0;
  const csPts = hasCS ? 6 : 0;

  const yellowPts = (myEvents?.yellowCards || 0) * -4;
  const redPts = (myEvents?.redCards || 0) * -6;
  const ogPts = (myEvents?.ownGoals || 0) * -5;

  return resPts + goalPts + csPts + yellowPts + redPts + ogPts;
}

async function runScoreCalculation() {
  try {
    const configSnap = await db.collection("settings").doc("gameConfig").get();
    const currentGW = configSnap.exists ? (Number(configSnap.data().currentGW) || 8) : 8;

    console.log(`📊 [SCRIPT 3] GW ${currentGW} အတွက် ပြိုင်ပွဲဝင် ရမှတ်များ စတင်တွက်ချက်နေပါသည်...`);

    const fixSnap = await db.collection("fixtures").where("gameweek", "==", currentGW).get();
    const clubFixturesMap = {};

    fixSnap.forEach(docSnap => {
      const f = docSnap.data();
      if (!clubFixturesMap[f.homeClub]) clubFixturesMap[f.homeClub] = [];
      if (!clubFixturesMap[f.awayClub]) clubFixturesMap[f.awayClub] = [];
      clubFixturesMap[f.homeClub].push(f);
      clubFixturesMap[f.awayClub].push(f);
    });

    const teamsSnap = await db.collection("teams").get();
    if (teamsSnap.empty) {
      console.log("ℹ️ ပြိုင်ပွဲဝင် အသင်းများ မရှိသေးပါ။");
      process.exit(0);
    }

    let batch = db.batch();
    let count = 0;

    teamsSnap.forEach(teamDoc => {
      const data = teamDoc.data();
      const squad = data.squad || [];
      if (squad.length === 0) return;

      const isBB = data.activeChip === "BB";
      const isTC = data.activeChip === "TC";
      const capSlot = data.captainSlotId || "GK1";

      let gwGross = 0;

      squad.forEach(slot => {
        if (!slot.starter && !isBB) return;

        const matches = clubFixturesMap[slot.code] || [];
        let slotPts = 0;
        matches.forEach(m => {
          slotPts += computeClubFixturePoints(m, slot.code, slot.pos);
        });

        if (slot.slotId === capSlot) {
          slotPts *= (isTC ? 3 : 2);
        }

        gwGross += slotPts;
      });

      const hitCost = Number(data.hitCost) || 0;
      const netGw = gwGross - hitCost;
      const prevTotal = Number(data.prevTotalPoints) || 0;

      batch.set(teamDoc.ref, {
        currentGwPoints: netGw,
        grossGwPoints: gwGross,
        totalPoints: prevTotal + netGw,
        lastCalculatedGW: currentGW,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      count++;
    });

    if (count > 0) {
      await batch.commit();
    }

    console.log(`🎉 [SUCCESS] ပြိုင်ပွဲဝင် (${count}) ဦး၏ ရမှတ်များ တွက်ချက်ပြီးပါပြီ။`);
    process.exit(0);

  } catch (err) {
    console.error("❌ Error in calculateScores:", err.message);
    process.exit(1);
  }
}

runScoreCalculation();
