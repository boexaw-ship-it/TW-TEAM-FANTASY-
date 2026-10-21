import { calculateClubScore } from './clubScoreCalculator.js';

/**
 * Squad တစ်ခုလုံး၏ Gameweek ရမှတ်တွက်ချက်ခြင်း
 * @param {Array} squadSlots - ၁၅ သင်းစာရင်း [{ clubCode, position, isStarter, isCaptain, isViceCaptain, matchEvent }]
 * @param {object} chipActive - { name: 'TRIPLE_CAPTAIN' | 'BENCH_BOOST' | 'FREE_HIT' | 'WILDCARD' | null }
 * @param {number} paidTransfersCount - အခမဲ့ထက် ကျော်လွန်၍ ပြောင်းထားသော Transfer အရေအတွက်
 * @param {object} clubsMap - clubCode ဖြင့် တွဲထားသော clubs.json map object
 */
export function calculateSquadGameweekScore(squadSlots, chipActive, paidTransfersCount = 0, clubsMap) {
  let startingScore = 0;
  let benchScore = 0;
  let captainBonus = 0;
  const clubBreakdowns = [];

  // Triple Captain သုံးထားလျှင် 3x၊ ပုံမှန်ဆိုလျှင် 2x
  const captainMultiplier = (chipActive && chipActive.name === 'TRIPLE_CAPTAIN') ? 3 : 2;

  squadSlots.forEach(slot => {
    const club = clubsMap[slot.clubCode];
    if (!club) return;

    // ကလပ် ၁ သင်းချင်း ရမှတ်တွက်ထုတ်ခြင်း
    const { totalPoints, breakdown } = calculateClubScore(slot.position, club, slot.matchEvent);

    let finalClubPts = totalPoints;

    // Captain ဖြစ်ခဲ့လျှင် Multiplier မြှောက်ခြင်း
    if (slot.isCaptain) {
      finalClubPts = totalPoints * captainMultiplier;
      captainBonus = finalClubPts - totalPoints;
    }

    clubBreakdowns.push({
      clubCode: slot.clubCode,
      position: slot.position,
      isStarter: slot.isStarter,
      isCaptain: slot.isCaptain,
      rawPoints: totalPoints,
      finalPoints: finalClubPts,
      breakdown
    });

    if (slot.isStarter) {
      startingScore += finalClubPts;
    } else {
      benchScore += finalClubPts;
    }
  });

  // Bench Boost သုံးထားပါက အရန်ခုံ (Bench ၄ သင်း) ရမှတ်ပါ ပေါင်းမည်
  const isBenchBoost = chipActive && chipActive.name === 'BENCH_BOOST';
  const grossScore = startingScore + (isBenchBoost ? benchScore : 0);

  // Transfer Penalty (-5 pts per extra transfer)
  const transferPenalty = paidTransfersCount * 5;
  const netGameweekScore = grossScore - transferPenalty;

  return {
    netGameweekScore,
    grossScore,
    transferPenalty,
    startingScore,
    benchScore,
    isBenchBoost,
    captainMultiplier,
    captainBonus,
    clubBreakdowns
  };
}
