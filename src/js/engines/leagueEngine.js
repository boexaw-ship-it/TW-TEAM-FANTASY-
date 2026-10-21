/**
 * League အသီးသီးအတွက် Standings (အဆင့်သတ်မှတ်ချက်) တွက်ချက်ခြင်း
 * @param {Array} teamsList - [{ teamId, teamName, managerName, totalPoints, gwPoints }]
 * @returns {Array} Sort လုပ်ပြီး Rank (#1, #2, #3...) တပ်ထားသော စာရင်း
 */
export function calculateLeagueStandings(teamsList) {
  // စုစုပေါင်းရမှတ် အများဆုံးမှ အနည်းဆုံးသို့ အရင်စီမည်
  // ရမှတ်တူပါက GW points ပိုများသူကို အပေါ်တင်မည်
  const sorted = [...teamsList].sort((a, b) => {
    if (b.totalPoints !== a.totalPoints) {
      return b.totalPoints - a.totalPoints;
    }
    return b.gwPoints - a.gwPoints;
  });

  // Rank အဆင့် သတ်မှတ်ခြင်း
  return sorted.map((team, index) => ({
    rank: index + 1,
    ...team
  }));
}

/**
 * User တစ်ဦးချင်းစီအတွက် League ၃ ခုလုံး၏ လက်ရှိ Rank အကျဉ်းချုပ်ကို ထုတ်ယူခြင်း
 */
export function getUserLeagueSummary(userId, overallStandings, paidStandings, freeStandings) {
  const findRank = (list) => {
    const found = list.find(t => t.userId === userId);
    return found ? `#${found.rank}` : '-';
  };

  return {
    overallRank: findRank(overallStandings),
    paidRank: findRank(paidStandings),
    freeRank: findRank(freeStandings)
  };
}
