import { Server, Socket } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import { Role, GamePhase, Player, ChatMessage, GameRoom, UserProfile, MatchRecord, RoomSettings } from '../shared/types.js';
import { calculateLevelFromStats } from '../shared/leveling.js';

const rooms = new Map<string, GameRoom>();
const userProfiles = new Map<string, UserProfile>();

const BOT_NAMES = ['Budi (AI)', 'Siti (AI)', 'Doni (AI)', 'Maya (AI)', 'Rian (AI)', 'Dewi (AI)', 'Agus (AI)', 'Putri (AI)'];
const BOT_SUSPICION_LINES = [
  'Malam tadi menegangkan sekali, siapa ya kira-kira pelakunya?',
  'Saya perhatikan gerak-gerik kalian, jangan-jangan ada serigala di antara kita.',
  'Sumpah saya warga biasa, jangan curigai saya ya!',
  'Ayo kita analisis siapa yang paling pendiam atau mencurigakan.',
  'Seer tolong beri petunjuk kalau dapat info penting!'
];

export function calculateEstimatedMinutes(playersCount: number, settings: RoomSettings, currentDay: number = 0): { total: number; remaining: number } {
  if (!settings.timerEnabled) {
    return { total: 0, remaining: 0 };
  }
  const estimatedCycles = Math.max(2, Math.min(5, Math.ceil(playersCount / 2)));
  const cycleSeconds = settings.nightTime + settings.discussionTime + settings.votingTime;
  const totalSeconds = estimatedCycles * cycleSeconds;
  const remainingCycles = Math.max(1, estimatedCycles - currentDay);
  const remainingSeconds = remainingCycles * cycleSeconds;

  return {
    total: Math.max(3, Math.ceil(totalSeconds / 60)),
    remaining: Math.max(1, Math.ceil(remainingSeconds / 60))
  };
}

export function getOrCreateProfile(userId: string, username: string, isExternal: boolean = false): UserProfile {
  let profile = userProfiles.get(userId);
  if (!profile) {
    const levelInfo = calculateLevelFromStats(0, 0);
    profile = {
      id: userId,
      username,
      externalAccount: isExternal,
      totalMatches: 0,
      totalWins: 0,
      totalLosses: 0,
      level: levelInfo.level,
      exp: levelInfo.totalExp,
      expForNextLevel: levelInfo.expForNextLevel,
      title: levelInfo.title,
      roleStats: {
        Werewolf: { wins: 0, losses: 0 },
        Villager: { wins: 0, losses: 0 },
        Seer: { wins: 0, losses: 0 },
        Doctor: { wins: 0, losses: 0 },
      },
      matchHistory: []
    };
    userProfiles.set(userId, profile);
  } else if (username && profile.username !== username) {
    profile.username = username;
    if (isExternal) profile.externalAccount = true;
  }
  return profile;
}

function handlePlayerLeave(io: Server, roomId?: string, userId?: string) {
  if (!roomId || !userId) return;
  const room = rooms.get(roomId);
  if (!room) return;

  const playerIdx = room.players.findIndex(p => p.id === userId);
  if (playerIdx === -1) return;

  const leavingPlayer = room.players[playerIdx];
  room.players.splice(playerIdx, 1);

  // Check how many human players remain
  const remainingHumans = room.players.filter(p => !p.isBot);

  // If no players left in the room, delete the room
  if (remainingHumans.length === 0) {
    rooms.delete(roomId);
    console.log(`Room ${roomId} dihapus karena tidak ada pemain di dalamnya.`);
    return;
  }

  // If the leaving player was the host (room master), transfer to the last person in the room
  if (room.hostId === userId) {
    const newHost = remainingHumans[remainingHumans.length - 1];
    room.hostId = newHost.id;
    systemMessage(room, `👑 Room Master keluar. ${newHost.name} kini diberikan akses sebagai Room Master baru!`);
  } else {
    systemMessage(room, `🚪 ${leavingPlayer.name} telah meninggalkan desa.`);
  }

  // Recalculate estimates
  const est = calculateEstimatedMinutes(room.players.length, room.settings, room.dayCount);
  room.estimatedMinutesTotal = est.total;
  room.estimatedMinutesRemaining = est.remaining;

  // If in game, clean up votes and check win condition
  if (room.phase !== 'LOBBY' && room.phase !== 'ENDED') {
    delete room.votes[userId];
    if (room.nightActions.werewolfVotes) {
      delete room.nightActions.werewolfVotes[userId];
    }
    checkWinCondition(io, room);
  }

  broadcastRoomState(io, room);
}

let timerIntervalStarted = false;

export function initGameServer(io: Server) {
  // Start server-wide 1-second ticker for game timers
  if (!timerIntervalStarted) {
    timerIntervalStarted = true;
    setInterval(() => {
      rooms.forEach((room) => {
        if (room.phase === 'LOBBY' || room.phase === 'ENDED') return;

        // Skip timer countdown if untimed mode is enabled
        if (!room.settings.timerEnabled) return;

        if (room.timerSecondsRemaining > 0) {
          room.timerSecondsRemaining--;
          io.to(room.id).emit('timer_tick', {
            timerSecondsRemaining: room.timerSecondsRemaining,
            estimatedMinutesRemaining: room.estimatedMinutesRemaining
          });
        }

        // Auto transition on timer expiry
        if (room.timerSecondsRemaining <= 0) {
          if (room.phase === 'DAY_DISCUSSION') {
            room.phase = 'DAY_VOTING';
            room.timerSecondsRemaining = room.settings.votingTime;
            systemMessage(room, '⌛ Waktu diskusi selesai! Memasuki tahap pemungutan suara (Voting).');
            broadcastRoomState(io, room);
            triggerBotDayVotes(io, room);
          } else if (room.phase === 'DAY_VOTING') {
            systemMessage(room, '⌛ Waktu voting telah habis! Mengkalkulasi suara yang terkumpul.');
            resolveVotingPhase(io, room);
          } else if (room.phase === 'NIGHT') {
            systemMessage(room, '⌛ Waktu malam telah habis! Fajar mulai menyingsing.');
            resolveNightPhase(io, room);
          }
        }
      });
    }, 1000);
  }

  io.on('connection', (socket: Socket) => {
    socket.on('register', (data: { username: string; isExternal?: boolean } | string, callback: (profile: UserProfile) => void) => {
      const username = typeof data === 'string' ? data : data?.username;
      const isExternal = typeof data === 'string' ? false : !!data?.isExternal;
      const cleanName = (username || '').trim() || 'Warga';
      const userId = uuidv4();
      const profile = getOrCreateProfile(userId, cleanName, isExternal);
      socket.data.userId = userId;
      callback(profile);
    });

    socket.on('get_profile', (userId: string, callback: (profile: UserProfile | null) => void) => {
      const profile = userProfiles.get(userId);
      callback(profile || null);
    });

    socket.on('get_rooms', (callback: (roomsList: Array<{ id: string; name: string; playersCount: number; phase: string; estimatedMinutes: number; timerEnabled: boolean }>) => void) => {
      const list = Array.from(rooms.values()).map(r => ({
        id: r.id,
        name: r.name,
        playersCount: r.players.length,
        phase: r.phase,
        estimatedMinutes: r.estimatedMinutesTotal,
        timerEnabled: r.settings.timerEnabled
      }));
      callback(list);
    });

    socket.on('create_room', (data: { userId: string; username: string; roomName?: string; settings?: Partial<RoomSettings> }, callback: (res: { success: boolean; roomId?: string; error?: string }) => void) => {
      getOrCreateProfile(data.userId, data.username);
      const randomCode = Math.floor(1000 + Math.random() * 9000);
      const roomId = `DESA-${randomCode}`;
      const roomName = data.roomName?.trim() || `Desa ${data.username}`;

      const defaultSettings: RoomSettings = {
        timerEnabled: data.settings?.timerEnabled !== undefined ? data.settings.timerEnabled : true,
        discussionTime: data.settings?.discussionTime || 60,
        votingTime: data.settings?.votingTime || 30,
        nightTime: data.settings?.nightTime || 30
      };

      const est = calculateEstimatedMinutes(1, defaultSettings, 0);

      const newRoom: GameRoom = {
        id: roomId,
        name: roomName,
        hostId: data.userId,
        players: [{
          id: data.userId,
          socketId: socket.id,
          name: data.username,
          role: null,
          isAlive: true,
          isBot: false
        }],
        phase: 'LOBBY',
        dayCount: 0,
        votes: {},
        nightActions: {
          werewolfVotes: {}
        },
        chatHistory: [],
        winner: null,
        seerInspections: {},
        settings: defaultSettings,
        timerSecondsRemaining: defaultSettings.discussionTime,
        estimatedMinutesTotal: est.total,
        estimatedMinutesRemaining: est.remaining
      };

      rooms.set(roomId, newRoom);
      socket.join(roomId);
      socket.data.userId = data.userId;
      socket.data.roomId = roomId;

      systemMessage(newRoom, `🏰 Desa "${roomName}" telah dibuat oleh ${data.username}.`);
      broadcastRoomState(io, newRoom);
      callback({ success: true, roomId });
    });

    socket.on('update_room_settings', (data: { roomId: string; settings: Partial<RoomSettings> }) => {
      const room = rooms.get(data.roomId);
      if (!room || room.hostId !== socket.data.userId || room.phase !== 'LOBBY') return;

      if (typeof data.settings.timerEnabled === 'boolean') {
        room.settings.timerEnabled = data.settings.timerEnabled;
      }
      if (data.settings.discussionTime) room.settings.discussionTime = Math.max(20, Math.min(180, Number(data.settings.discussionTime)));
      if (data.settings.votingTime) room.settings.votingTime = Math.max(15, Math.min(90, Number(data.settings.votingTime)));
      if (data.settings.nightTime) room.settings.nightTime = Math.max(15, Math.min(60, Number(data.settings.nightTime)));

      const est = calculateEstimatedMinutes(room.players.length, room.settings, room.dayCount);
      room.estimatedMinutesTotal = est.total;
      room.estimatedMinutesRemaining = est.remaining;

      const timerMsg = room.settings.timerEnabled
        ? `Timer Aktif (Diskusi ${room.settings.discussionTime}s | Voting ${room.settings.votingTime}s | Malam ${room.settings.nightTime}s)`
        : 'Mode Manual (Tanpa Batas Waktu)';

      systemMessage(room, `⚙️ Room Master mengubah pengaturan: ${timerMsg}.`);
      broadcastRoomState(io, room);
    });

    socket.on('join_room', (data: { roomId: string; userId: string; username: string }, callback: (res: { success: boolean; error?: string }) => void) => {
      const targetRoomId = data.roomId.trim().toUpperCase();
      let room = rooms.get(targetRoomId);

      if (!room) {
        callback({ success: false, error: `Room ${targetRoomId} tidak ditemukan.` });
        return;
      }

      if (room.phase !== 'LOBBY') {
        const existing = room.players.find(p => p.id === data.userId);
        if (existing) {
          existing.socketId = socket.id;
          socket.join(targetRoomId);
          socket.data.userId = data.userId;
          socket.data.roomId = targetRoomId;
          broadcastRoomState(io, room);
          callback({ success: true });
          return;
        }
        callback({ success: false, error: 'Permainan di room ini sudah berlangsung.' });
        return;
      }

      const existingPlayer = room.players.find(p => p.id === data.userId);
      if (existingPlayer) {
        existingPlayer.socketId = socket.id;
        existingPlayer.name = data.username;
      } else {
        if (room.players.length >= 10) {
          callback({ success: false, error: 'Room sudah penuh (maksimal 10 pemain).' });
          return;
        }
        room.players.push({
          id: data.userId,
          socketId: socket.id,
          name: data.username,
          role: null,
          isAlive: true,
          isBot: false
        });
      }

      const est = calculateEstimatedMinutes(room.players.length, room.settings, room.dayCount);
      room.estimatedMinutesTotal = est.total;
      room.estimatedMinutesRemaining = est.remaining;

      socket.join(targetRoomId);
      socket.data.userId = data.userId;
      socket.data.roomId = targetRoomId;

      systemMessage(room, `👋 ${data.username} bergabung ke desa.`);
      broadcastRoomState(io, room);
      callback({ success: true });
    });

    socket.on('leave_room', (data: { roomId: string; userId: string }) => {
      handlePlayerLeave(io, data.roomId, data.userId);
    });

    socket.on('add_bot', (roomId: string) => {
      const room = rooms.get(roomId);
      if (!room || room.hostId !== socket.data.userId || room.phase !== 'LOBBY') return;
      if (room.players.length >= 8) {
        socket.emit('error', 'Maksimal 8 pemain dalam room untuk keseimbangan permainan.');
        return;
      }

      const usedNames = new Set(room.players.map(p => p.name));
      const availableName = BOT_NAMES.find(n => !usedNames.has(n)) || `Warga Bot ${room.players.length + 1}`;
      const botId = `bot-${uuidv4().substring(0, 8)}`;

      room.players.push({
        id: botId,
        socketId: 'bot-socket',
        name: availableName,
        role: null,
        isAlive: true,
        isBot: true
      });

      const est = calculateEstimatedMinutes(room.players.length, room.settings, room.dayCount);
      room.estimatedMinutesTotal = est.total;
      room.estimatedMinutesRemaining = est.remaining;

      systemMessage(room, `🤖 ${availableName} ditambahkan oleh Room Master.`);
      broadcastRoomState(io, room);
    });

    socket.on('remove_bot', (data: { roomId: string; botId: string }) => {
      const room = rooms.get(data.roomId);
      if (!room || room.hostId !== socket.data.userId || room.phase !== 'LOBBY') return;
      const botIndex = room.players.findIndex(p => p.id === data.botId && p.isBot);
      if (botIndex !== -1) {
        const removed = room.players.splice(botIndex, 1)[0];
        const est = calculateEstimatedMinutes(room.players.length, room.settings, room.dayCount);
        room.estimatedMinutesTotal = est.total;
        room.estimatedMinutesRemaining = est.remaining;
        systemMessage(room, `🤖 ${removed.name} telah dikeluarkan.`);
        broadcastRoomState(io, room);
      }
    });

    socket.on('start_game', (roomId: string) => {
      const room = rooms.get(roomId);
      if (!room || room.hostId !== socket.data.userId || room.phase !== 'LOBBY') return;
      if (room.players.length < 3) {
        socket.emit('error', 'Minimal 3 pemain untuk memulai (Gunakan "Tambah Bot AI" jika bermain sendiri/kurang pemain).');
        return;
      }

      assignRoles(room.players);
      room.phase = 'NIGHT';
      room.dayCount = 1;
      room.nightActions = { werewolfVotes: {} };
      room.votes = {};
      room.chatHistory = [];
      room.winner = null;
      room.lastEliminated = null;
      room.seerInspections = {};
      room.timerSecondsRemaining = room.settings.nightTime;
      room.gameStartedAt = Date.now();

      const est = calculateEstimatedMinutes(room.players.length, room.settings, 1);
      room.estimatedMinutesTotal = est.total;
      room.estimatedMinutesRemaining = est.remaining;

      const timerNotice = room.settings.timerEnabled ? `(Batas waktu malam: ${room.settings.nightTime}s)` : '(Mode Santai: Tanpa Batas Waktu)';
      systemMessage(room, `🌕 Bulan purnama telah terbit. Malam telah tiba, seluruh warga tertidur lelap... ${timerNotice}`);
      systemMessage(room, '🐺 Werewolf bangun dan memilih mangsa. 🔮 Seer mengintai identitas. 💉 Dokter memilih yang dilindungi.');

      broadcastRoomState(io, room);
      triggerBotNightActions(io, room);
    });

    socket.on('send_message', (data: { roomId: string; text: string }) => {
      const room = rooms.get(data.roomId);
      if (!room) return;

      const player = room.players.find(p => p.id === socket.data.userId);
      if (!player) return;

      const trimmed = data.text.trim();
      if (!trimmed) return;

      const isDead = !player.isAlive;
      const isNight = room.phase === 'NIGHT';
      const isWW = player.role === 'Werewolf';

      if (isNight && !isWW && !isDead) {
        socket.emit('error', 'Warga tertidur di malam hari, tidak dapat berbicara.');
        return;
      }

      const msg: ChatMessage = {
        id: uuidv4(),
        senderId: player.id,
        senderName: player.name,
        text: trimmed,
        isDeadChat: isDead,
        isWerewolfChat: (isWW && isNight && !isDead),
        system: false,
        timestamp: Date.now()
      };

      room.chatHistory.push(msg);
      broadcastRoomState(io, room);
    });

    socket.on('night_action', (data: { roomId: string; targetId: string }) => {
      const room = rooms.get(data.roomId);
      if (!room || room.phase !== 'NIGHT') return;

      const player = room.players.find(p => p.id === socket.data.userId);
      if (!player || !player.isAlive) return;

      const target = room.players.find(p => p.id === data.targetId);
      if (!target || !target.isAlive) return;

      if (player.role === 'Werewolf') {
        if (!room.nightActions.werewolfVotes) room.nightActions.werewolfVotes = {};
        room.nightActions.werewolfVotes[player.id] = data.targetId;
        room.nightActions.werewolfTarget = data.targetId;
      } else if (player.role === 'Doctor') {
        room.nightActions.doctorTarget = data.targetId;
      } else if (player.role === 'Seer') {
        room.nightActions.seerTarget = data.targetId;
        const isTargetWW = target.role === 'Werewolf';
        if (!room.seerInspections) room.seerInspections = {};
        room.seerInspections[data.targetId] = {
          targetName: target.name,
          isWerewolf: isTargetWW
        };

        socket.emit('seer_result', {
          targetId: data.targetId,
          targetName: target.name,
          role: isTargetWW ? 'Werewolf' : 'Bukan Werewolf (Warga Baik)'
        });
      }

      checkNightEnd(io, room);
      broadcastRoomState(io, room);
    });

    socket.on('vote', (data: { roomId: string; targetId: string }) => {
      const room = rooms.get(data.roomId);
      if (!room || (room.phase !== 'DAY_VOTING' && room.phase !== 'DAY_DISCUSSION')) return;

      const player = room.players.find(p => p.id === socket.data.userId);
      if (!player || !player.isAlive) return;

      if (room.phase === 'DAY_DISCUSSION') {
        room.phase = 'DAY_VOTING';
        room.timerSecondsRemaining = room.settings.votingTime;
        systemMessage(room, `🗳️ Voting dimulai!`);
      }

      room.votes[player.id] = data.targetId;

      checkVoteEnd(io, room);
      broadcastRoomState(io, room);
    });

    socket.on('start_voting_phase', (roomId: string) => {
      const room = rooms.get(roomId);
      if (!room || room.phase !== 'DAY_DISCUSSION' || room.hostId !== socket.data.userId) return;
      room.phase = 'DAY_VOTING';
      room.timerSecondsRemaining = room.settings.votingTime;
      systemMessage(room, `🗳️ Room Master telah membuka tahap voting.`);
      broadcastRoomState(io, room);
      triggerBotDayVotes(io, room);
    });

    socket.on('force_next_phase', (roomId: string) => {
      const room = rooms.get(roomId);
      if (!room || room.hostId !== socket.data.userId) return;

      if (room.phase === 'NIGHT') {
        resolveNightPhase(io, room);
      } else if (room.phase === 'DAY_DISCUSSION') {
        room.phase = 'DAY_VOTING';
        room.timerSecondsRemaining = room.settings.votingTime;
        systemMessage(room, `🗳️ Tahap diskusi dipercepat ke pemungutan suara.`);
        broadcastRoomState(io, room);
        triggerBotDayVotes(io, room);
      } else if (room.phase === 'DAY_VOTING') {
        resolveVotingPhase(io, room);
      }
    });

    socket.on('restart_game', (roomId: string) => {
      const room = rooms.get(roomId);
      if (!room || room.hostId !== socket.data.userId) return;

      room.phase = 'LOBBY';
      room.dayCount = 0;
      room.votes = {};
      room.nightActions = { werewolfVotes: {} };
      room.winner = null;
      room.lastEliminated = null;
      room.seerInspections = {};
      room.timerSecondsRemaining = room.settings.discussionTime;

      const est = calculateEstimatedMinutes(room.players.length, room.settings, 0);
      room.estimatedMinutesTotal = est.total;
      room.estimatedMinutesRemaining = est.remaining;

      room.players.forEach(p => {
        p.role = null;
        p.isAlive = true;
      });

      systemMessage(room, '🔄 Permainan telah di-reset ke Lobby oleh Room Master. Bersiap untuk ronde baru!');
      broadcastRoomState(io, room);
    });

    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
      handlePlayerLeave(io, socket.data.roomId, socket.data.userId);
    });
  });
}

export function assignRoles(players: Player[]) {
  const count = players.length;
  let pool: Role[] = [];

  if (count === 3) {
    pool = ['Werewolf', 'Seer', 'Villager'];
  } else if (count === 4) {
    pool = ['Werewolf', 'Seer', 'Doctor', 'Villager'];
  } else if (count === 5) {
    pool = ['Werewolf', 'Seer', 'Doctor', 'Villager', 'Villager'];
  } else if (count === 6) {
    pool = ['Werewolf', 'Werewolf', 'Seer', 'Doctor', 'Villager', 'Villager'];
  } else if (count === 7) {
    pool = ['Werewolf', 'Werewolf', 'Seer', 'Doctor', 'Villager', 'Villager', 'Villager'];
  } else {
    pool = ['Werewolf', 'Werewolf', 'Seer', 'Doctor', 'Villager', 'Villager', 'Villager', 'Villager'];
    while (pool.length < count) {
      pool.push('Villager');
    }
  }

  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  players.forEach((p, idx) => {
    p.role = pool[idx];
    p.isAlive = true;
  });
}

function checkNightEnd(io: Server, room: GameRoom) {
  const aliveWWs = room.players.filter(p => p.isAlive && p.role === 'Werewolf');
  const aliveSeer = room.players.find(p => p.isAlive && p.role === 'Seer');
  const aliveDoctor = room.players.find(p => p.isAlive && p.role === 'Doctor');

  let wwReady = !aliveWWs.length || (room.nightActions.werewolfTarget !== undefined);
  let seerReady = !aliveSeer || (room.nightActions.seerTarget !== undefined);
  let doctorReady = !aliveDoctor || (room.nightActions.doctorTarget !== undefined);

  if (wwReady && seerReady && doctorReady) {
    resolveNightPhase(io, room);
  }
}

function resolveNightPhase(io: Server, room: GameRoom) {
  let deadPlayerId: string | null = null;
  const targetId = room.nightActions.werewolfTarget;
  const doctorTargetId = room.nightActions.doctorTarget;

  if (targetId) {
    if (targetId === doctorTargetId) {
      deadPlayerId = null;
    } else {
      deadPlayerId = targetId;
      const victim = room.players.find(p => p.id === targetId);
      if (victim) {
        victim.isAlive = false;
        room.lastEliminated = {
          name: victim.name,
          role: victim.role,
          phase: 'NIGHT'
        };
      }
    }
  }

  room.phase = 'DAY_DISCUSSION';
  room.nightActions = { werewolfVotes: {} };
  room.votes = {};
  room.timerSecondsRemaining = room.settings.discussionTime;

  const est = calculateEstimatedMinutes(room.players.length, room.settings, room.dayCount);
  room.estimatedMinutesRemaining = est.remaining;

  if (deadPlayerId) {
    const victim = room.players.find(p => p.id === deadPlayerId);
    systemMessage(room, `🌅 Fajar menyingsing di desa. Kabar duka: ${victim?.name} ditemukan tewas semalam!`);
  } else if (targetId && targetId === doctorTargetId) {
    systemMessage(room, `🌅 Fajar menyingsing di desa. Tabib/Dokter berhasil melindungi mangsa serigala! Tidak ada korban jiwa.`);
  } else {
    systemMessage(room, `🌅 Fajar menyingsing di desa dengan damai. Tidak ada korban semalam.`);
  }

  const isGameOver = checkWinCondition(io, room);
  if (!isGameOver) {
    const timerNotice = room.settings.timerEnabled ? `(${room.settings.discussionTime} detik)` : '(Mode Santai / Manual)';
    systemMessage(room, `🗣️ Diskusi warga dimulai ${timerNotice}. Saling bertukar analisis sebelum voting.`);
    broadcastRoomState(io, room);
    triggerBotDayDiscussion(io, room);
  } else {
    broadcastRoomState(io, room);
  }
}

function checkVoteEnd(io: Server, room: GameRoom) {
  const alivePlayers = room.players.filter(p => p.isAlive);
  const totalVotesCast = Object.keys(room.votes).length;

  if (totalVotesCast >= alivePlayers.length) {
    resolveVotingPhase(io, room);
  }
}

function resolveVotingPhase(io: Server, room: GameRoom) {
  const voteCounts: Record<string, number> = {};
  Object.values(room.votes).forEach(targetId => {
    voteCounts[targetId] = (voteCounts[targetId] || 0) + 1;
  });

  let maxVotes = 0;
  let lynchedId: string | null = null;
  let isTie = false;

  for (const [targetId, count] of Object.entries(voteCounts)) {
    if (count > maxVotes) {
      maxVotes = count;
      lynchedId = targetId;
      isTie = false;
    } else if (count === maxVotes) {
      isTie = true;
    }
  }

  if (lynchedId && !isTie && maxVotes > 0) {
    const lynched = room.players.find(p => p.id === lynchedId);
    if (lynched) {
      lynched.isAlive = false;
      room.lastEliminated = {
        name: lynched.name,
        role: lynched.role,
        phase: 'DAY'
      };
      systemMessage(room, `⚖️ Hasil voting: Warga sepakat mengeliminasi ${lynched.name} (Role: ${lynched.role})!`);
    }
  } else {
    systemMessage(room, '⚖️ Suara berimbang atau tidak ada kesepakatan mayoritas. Tidak ada warga yang dieksekusi hari ini.');
  }

  const isGameOver = checkWinCondition(io, room);
  if (!isGameOver) {
    room.phase = 'NIGHT';
    room.dayCount++;
    room.votes = {};
    room.nightActions = { werewolfVotes: {} };
    room.timerSecondsRemaining = room.settings.nightTime;

    const est = calculateEstimatedMinutes(room.players.length, room.settings, room.dayCount);
    room.estimatedMinutesRemaining = est.remaining;

    systemMessage(room, `🌑 Malam ke-${room.dayCount} telah tiba. Semua warga kembali beristirahat.`);
    broadcastRoomState(io, room);
    triggerBotNightActions(io, room);
  } else {
    broadcastRoomState(io, room);
  }
}

function checkWinCondition(io: Server, room: GameRoom): boolean {
  if (room.phase === 'ENDED') return true;

  const alivePlayers = room.players.filter(p => p.isAlive);
  const aliveWWs = alivePlayers.filter(p => p.role === 'Werewolf');
  const aliveVillagers = alivePlayers.filter(p => p.role !== 'Werewolf');

  if (aliveWWs.length === 0) {
    room.phase = 'ENDED';
    room.winner = 'Villagers';
    systemMessage(room, '🎉 KEMENANGAN WARGA DESA! Seluruh Werewolf telah musnah dari desa.');
    updateAllPlayersStats(io, room, 'Villagers');
    return true;
  } else if (aliveWWs.length >= aliveVillagers.length) {
    room.phase = 'ENDED';
    room.winner = 'Werewolves';
    systemMessage(room, '🐺 KEMENANGAN WEREWOLF! Kawanan serigala telah menguasai seluruh desa.');
    updateAllPlayersStats(io, room, 'Werewolves');
    return true;
  }

  return false;
}

function updateAllPlayersStats(io: Server, room: GameRoom, winningSide: 'Villagers' | 'Werewolves') {
  room.players.forEach(p => {
    if (p.isBot) return;

    const profile = getOrCreateProfile(p.id, p.name);
    const role = p.role || 'Villager';
    const isWW = role === 'Werewolf';
    const playerWon = (winningSide === 'Werewolves' && isWW) || (winningSide === 'Villagers' && !isWW);

    profile.totalMatches++;
    if (playerWon) {
      profile.totalWins++;
      profile.roleStats[role].wins++;
    } else {
      profile.totalLosses++;
      profile.roleStats[role].losses++;
    }

    const levelData = calculateLevelFromStats(profile.totalWins, profile.totalLosses);
    profile.level = levelData.level;
    profile.exp = levelData.totalExp;
    profile.expForNextLevel = levelData.expForNextLevel;
    profile.title = levelData.title;

    const matchRec: MatchRecord = {
      id: uuidv4(),
      date: new Date().toLocaleDateString('id-ID', { hour: '2-digit', minute: '2-digit' }),
      role,
      won: playerWon,
      survived: p.isAlive,
      daysLasted: room.dayCount,
      roomId: room.id
    };
    profile.matchHistory.unshift(matchRec);
    if (profile.matchHistory.length > 20) profile.matchHistory.pop();

    userProfiles.set(p.id, profile);
    io.to(p.socketId).emit('profile_updated', profile);
  });
}

function systemMessage(room: GameRoom, text: string) {
  room.chatHistory.push({
    id: uuidv4(),
    senderId: 'SYSTEM',
    senderName: 'Sistem',
    text,
    isDeadChat: false,
    isWerewolfChat: false,
    system: true,
    timestamp: Date.now()
  });
}

function triggerBotNightActions(io: Server, room: GameRoom) {
  const bots = room.players.filter(p => p.isBot && p.isAlive);
  if (!bots.length) return;

  setTimeout(() => {
    if (room.phase !== 'NIGHT') return;

    const aliveHumansAndBots = room.players.filter(p => p.isAlive);

    bots.forEach(bot => {
      if (bot.role === 'Werewolf') {
        const nonWWTargets = aliveHumansAndBots.filter(p => p.role !== 'Werewolf');
        if (nonWWTargets.length) {
          const chosen = nonWWTargets[Math.floor(Math.random() * nonWWTargets.length)];
          room.nightActions.werewolfTarget = chosen.id;
          if (!room.nightActions.werewolfVotes) room.nightActions.werewolfVotes = {};
          room.nightActions.werewolfVotes[bot.id] = chosen.id;
        }
      } else if (bot.role === 'Doctor') {
        const chosen = aliveHumansAndBots[Math.floor(Math.random() * aliveHumansAndBots.length)];
        room.nightActions.doctorTarget = chosen.id;
      } else if (bot.role === 'Seer') {
        const otherTargets = aliveHumansAndBots.filter(p => p.id !== bot.id);
        if (otherTargets.length) {
          const chosen = otherTargets[Math.floor(Math.random() * otherTargets.length)];
          room.nightActions.seerTarget = chosen.id;
        }
      }
    });

    checkNightEnd(io, room);
    broadcastRoomState(io, room);
  }, 2200);
}

function triggerBotDayDiscussion(io: Server, room: GameRoom) {
  const aliveBots = room.players.filter(p => p.isBot && p.isAlive);
  if (!aliveBots.length) return;

  const bot = aliveBots[Math.floor(Math.random() * aliveBots.length)];
  const line = BOT_SUSPICION_LINES[Math.floor(Math.random() * BOT_SUSPICION_LINES.length)];

  setTimeout(() => {
    if (room.phase !== 'DAY_DISCUSSION' && room.phase !== 'DAY_VOTING') return;
    room.chatHistory.push({
      id: uuidv4(),
      senderId: bot.id,
      senderName: bot.name,
      text: line,
      isDeadChat: false,
      isWerewolfChat: false,
      system: false,
      timestamp: Date.now()
    });
    broadcastRoomState(io, room);
  }, 2500);
}

function triggerBotDayVotes(io: Server, room: GameRoom) {
  const aliveBots = room.players.filter(p => p.isBot && p.isAlive);
  if (!aliveBots.length) return;

  aliveBots.forEach((bot, index) => {
    setTimeout(() => {
      if (room.phase !== 'DAY_VOTING') return;
      const aliveCandidates = room.players.filter(p => p.isAlive && p.id !== bot.id);
      if (aliveCandidates.length) {
        const target = aliveCandidates[Math.floor(Math.random() * aliveCandidates.length)];
        room.votes[bot.id] = target.id;
        checkVoteEnd(io, room);
        broadcastRoomState(io, room);
      }
    }, 1500 + index * 1000);
  });
}

function broadcastRoomState(io: Server, room: GameRoom) {
  room.players.forEach(p => {
    if (p.isBot) return;

    const sanitizedRoom = JSON.parse(JSON.stringify(room)) as GameRoom;
    const viewer = room.players.find(x => x.id === p.id);
    const isViewerDead = viewer && !viewer.isAlive;
    const isViewerWW = viewer && viewer.role === 'Werewolf';

    sanitizedRoom.players.forEach(sp => {
      if (room.phase !== 'ENDED' && !isViewerDead) {
        if (sp.id !== p.id) {
          if (!(isViewerWW && sp.role === 'Werewolf')) {
            sp.role = null;
          }
        }
      }
    });

    sanitizedRoom.chatHistory = sanitizedRoom.chatHistory.filter(c => {
      if (c.system) return true;
      if (c.isDeadChat && viewer && viewer.isAlive && room.phase !== 'ENDED') return false;
      if (c.isWerewolfChat && viewer && viewer.role !== 'Werewolf' && room.phase !== 'ENDED') return false;
      return true;
    });

    io.to(p.socketId).emit('room_state', sanitizedRoom);
  });
}
