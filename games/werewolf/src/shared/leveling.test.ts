import { describe, it, expect } from 'vitest';
import { calculateLevelFromStats } from './leveling';

describe('Leveling System', () => {
  it('should start at Level 1 with 0 wins and 0 losses', () => {
    const stats = calculateLevelFromStats(0, 0);
    expect(stats.level).toBe(1);
    expect(stats.totalExp).toBe(0);
    expect(stats.title).toBe('Warga Pemula');
  });

  it('should increase level and grant EXP for wins and losses', () => {
    // 5 wins (5 * 120 = 600) + 2 losses (2 * 45 = 90) = 690 EXP
    const stats = calculateLevelFromStats(5, 2);
    expect(stats.level).toBeGreaterThan(1);
    expect(stats.totalExp).toBe(690);
  });

  it('should grant veteran titles at high levels', () => {
    const stats = calculateLevelFromStats(30, 10);
    expect(stats.level).toBeGreaterThanOrEqual(7);
    expect(['Tabib Terpilih', 'Peramal Bijak', 'Alpha Lycan', 'Legenda Desa'].includes(stats.title)).toBe(true);
  });
});
