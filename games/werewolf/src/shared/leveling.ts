export function calculateLevelFromStats(wins: number, losses: number) {
  const totalExp = (wins * 120) + (losses * 45);
  let level = 1;
  let requiredExp = 150;
  let prevTotalRequired = 0;
  
  while (totalExp >= prevTotalRequired + requiredExp) {
    prevTotalRequired += requiredExp;
    level++;
    requiredExp = 100 + level * 75;
  }
  
  const currentLevelExp = totalExp - prevTotalRequired;
  const expForNextLevel = requiredExp;

  let title = 'Warga Pemula';
  let badgeColor = 'bg-stone-600 text-stone-200 border-stone-500';
  
  if (level >= 20) {
    title = 'Legenda Desa';
    badgeColor = 'bg-amber-500/20 text-amber-300 border-amber-500/50';
  } else if (level >= 15) {
    title = 'Alpha Lycan';
    badgeColor = 'bg-red-500/20 text-red-300 border-red-500/50';
  } else if (level >= 10) {
    title = 'Peramal Bijak';
    badgeColor = 'bg-purple-500/20 text-purple-300 border-purple-500/50';
  } else if (level >= 7) {
    title = 'Tabib Terpilih';
    badgeColor = 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50';
  } else if (level >= 4) {
    title = 'Pemburu Bayangan';
    badgeColor = 'bg-blue-500/20 text-blue-300 border-blue-500/50';
  } else if (level >= 2) {
    title = 'Warga Waspada';
    badgeColor = 'bg-indigo-500/20 text-indigo-300 border-indigo-500/50';
  }

  return {
    level,
    totalExp,
    currentLevelExp,
    expForNextLevel,
    progressPercentage: Math.min(100, Math.round((currentLevelExp / expForNextLevel) * 100)),
    title,
    badgeColor
  };
}
