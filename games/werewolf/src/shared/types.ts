export type Role = 'Villager' | 'Werewolf' | 'Seer' | 'Doctor';
export type GamePhase = 'LOBBY' | 'NIGHT' | 'DAY_DISCUSSION' | 'DAY_VOTING' | 'ENDED';

export interface RoleStats {
  wins: number;
  losses: number;
}

export interface MatchRecord {
  id: string;
  date: string;
  role: Role;
  won: boolean;
  survived: boolean;
  daysLasted: number;
  roomId: string;
}

export interface UserProfile {
  id: string;
  username: string;
  externalAccount?: boolean;
  totalMatches: number;
  totalWins: number;
  totalLosses: number;
  level: number;
  exp: number;
  expForNextLevel: number;
  title: string;
  roleStats: {
    Werewolf: RoleStats;
    Villager: RoleStats;
    Seer: RoleStats;
    Doctor: RoleStats;
  };
  matchHistory: MatchRecord[];
}

export interface Player {
  id: string;
  socketId: string;
  name: string;
  role: Role | null;
  isAlive: boolean;
  isBot?: boolean;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  isDeadChat: boolean;
  isWerewolfChat: boolean;
  system: boolean;
  timestamp: number;
}

export interface RoomSettings {
  timerEnabled: boolean;  // true for countdown, false for untimed/manual mode
  discussionTime: number; // in seconds (e.g. 30, 45, 60, 90, 120)
  votingTime: number;     // in seconds (e.g. 20, 30, 45)
  nightTime: number;      // in seconds (e.g. 20, 30, 45)
}

export interface GameRoom {
  id: string;
  name: string;
  hostId: string;
  players: Player[];
  phase: GamePhase;
  dayCount: number;
  votes: Record<string, string>; // voterId -> targetId
  nightActions: {
    werewolfTarget?: string;
    seerTarget?: string;
    doctorTarget?: string;
    werewolfVotes?: Record<string, string>; // werewolfId -> targetId
  };
  seerInspections?: Record<string, { targetName: string; isWerewolf: boolean }>;
  chatHistory: ChatMessage[];
  winner: 'Villagers' | 'Werewolves' | null;
  lastEliminated?: {
    name: string;
    role: Role | null;
    phase: 'NIGHT' | 'DAY';
  } | null;
  settings: RoomSettings;
  timerSecondsRemaining: number;
  gameStartedAt?: number;
  estimatedMinutesTotal: number;
  estimatedMinutesRemaining: number;
}
