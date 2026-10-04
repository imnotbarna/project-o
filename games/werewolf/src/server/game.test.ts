import { describe, it, expect } from 'vitest';
import { assignRoles, calculateEstimatedMinutes } from './game';
import { Player, RoomSettings } from '../shared/types';

describe('Werewolf Game Logic', () => {
  it('should assign roles correctly for 3 players', () => {
    const players: Player[] = [
      { id: '1', socketId: 's1', name: 'A', role: null, isAlive: true },
      { id: '2', socketId: 's2', name: 'B', role: null, isAlive: true },
      { id: '3', socketId: 's3', name: 'C', role: null, isAlive: true }
    ];
    assignRoles(players);
    const roles = players.map(p => p.role);
    expect(roles.includes('Werewolf')).toBe(true);
    expect(roles.includes('Seer')).toBe(true);
    expect(roles.includes('Villager')).toBe(true);
  });

  it('should assign correct number of werewolves for larger groups', () => {
    const players: Player[] = Array.from({ length: 8 }).map((_, i) => ({
      id: String(i), socketId: `s${i}`, name: `P${i}`, role: null, isAlive: true
    }));
    assignRoles(players);
    const werewolves = players.filter(p => p.role === 'Werewolf');
    expect(werewolves.length).toBe(2);
  });

  it('should calculate estimated game duration accurately based on custom settings', () => {
    const settings: RoomSettings = {
      timerEnabled: true,
      discussionTime: 60,
      votingTime: 30,
      nightTime: 30
    };
    // 6 players -> ~3 cycles * 120s = 360s = 6 minutes
    const est = calculateEstimatedMinutes(6, settings, 0);
    expect(est.total).toBe(6);
    expect(est.remaining).toBe(6);

    // After 1 day elapsed
    const estDay1 = calculateEstimatedMinutes(6, settings, 1);
    expect(estDay1.remaining).toBe(4);

    // When timer is disabled (untimed mode)
    const untimedSettings: RoomSettings = { ...settings, timerEnabled: false };
    const estUntimed = calculateEstimatedMinutes(6, untimedSettings, 0);
    expect(estUntimed.total).toBe(0);
    expect(estUntimed.remaining).toBe(0);
  });
});
