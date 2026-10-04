import { useState, useEffect, useRef } from 'react';
import io, { Socket } from 'socket.io-client';
import { GameRoom, UserProfile } from './shared/types';
import { calculateLevelFromStats } from './shared/leveling';
import { soundFx } from './utils/audio';
import {
  Play, Users, MessageSquare, AlertCircle, Eye, Moon, Sun, Shield,
  LogOut, Plus, Copy, Check, Trophy, BookOpen, Volume2, VolumeX,
  FastForward, Skull, Sparkles, ChevronRight,
  RefreshCw, Bot, Sliders, CheckCircle2, Globe, Crown,
  PawPrint, HeartPulse, Gavel, Hourglass, Clock
} from 'lucide-react';

const socket: Socket = io();

export default function App() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [usernameInput, setUsernameInput] = useState('');
  const [roomIdInput, setRoomIdInput] = useState('');
  const [newRoomName, setNewRoomName] = useState('');
  const [room, setRoom] = useState<GameRoom | null>(null);
  const [error, setError] = useState('');
  const [toastMessage, setToastMessage] = useState('');
  
  // Real-time timer state
  const [timerRemaining, setTimerRemaining] = useState<number>(0);
  const [estimatedMinutesRemaining, setEstimatedMinutesRemaining] = useState<number>(0);

  // Modals & Panels
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showGuideModal, setShowGuideModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);

  // Custom Time Settings State (for Host)
  const [timerEnabled, setTimerEnabled] = useState<boolean>(true);
  const [customDiscussionTime, setCustomDiscussionTime] = useState<number>(60);
  const [customVotingTime, setCustomVotingTime] = useState<number>(30);
  const [customNightTime, setCustomNightTime] = useState<number>(30);

  // In-Game state
  const [chatMessage, setChatMessage] = useState('');
  const [seerResult, setSeerResult] = useState<{ targetId: string; targetName: string; role: string } | null>(null);
  const [publicRooms, setPublicRooms] = useState<Array<{ id: string; name: string; playersCount: number; phase: string; estimatedMinutes: number; timerEnabled: boolean }>>([]);

  const chatBottomRef = useRef<HTMLDivElement>(null);
  const prevPhaseRef = useRef<string | null>(null);

  // Detect query params from parent website (e.g. ?username=Adit&roomId=DESA-1234)
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const urlParams = new URLSearchParams(window.location.search);
    const accountName = urlParams.get('username') || urlParams.get('name') || urlParams.get('user') || urlParams.get('account');
    const autoRoomId = urlParams.get('roomId') || urlParams.get('room');

    if (accountName && !profile) {
      const cleanAccount = accountName.trim();
      setUsernameInput(cleanAccount);
      socket.emit('register', { username: cleanAccount, isExternal: true }, (prof: UserProfile) => {
        setProfile(prof);
        showToast(`Akun website terhubung: ${prof.username}`);
        if (autoRoomId) {
          handleJoinRoomWithId(autoRoomId.trim(), prof);
        }
      });
    }

    // Listen to postMessage from parent website iframe
    const messageListener = (event: MessageEvent) => {
      if (event.data?.type === 'WEREWOLF_AUTH' && event.data?.username) {
        const cleanName = event.data.username.trim();
        socket.emit('register', { username: cleanName, isExternal: true }, (prof: UserProfile) => {
          setProfile(prof);
          showToast(`Akun terautentikasi: ${prof.username}`);
          if (event.data?.roomId) {
            handleJoinRoomWithId(event.data.roomId.trim(), prof);
          }
        });
      }
    };

    window.addEventListener('message', messageListener);
    return () => window.removeEventListener('message', messageListener);
  }, []);

  // Initialize socket listeners
  useEffect(() => {
    socket.on('room_state', (r: GameRoom) => {
      setRoom(r);
      setTimerRemaining(r.timerSecondsRemaining);
      setEstimatedMinutesRemaining(r.estimatedMinutesRemaining);

      if (r.settings) {
        setTimerEnabled(r.settings.timerEnabled !== false);
        setCustomDiscussionTime(r.settings.discussionTime);
        setCustomVotingTime(r.settings.votingTime);
        setCustomNightTime(r.settings.nightTime);
      }

      // Play audio cues on phase change
      if (prevPhaseRef.current !== r.phase) {
        if (r.phase === 'NIGHT') {
          soundFx.playNight();
        } else if (r.phase === 'DAY_DISCUSSION' || r.phase === 'DAY_VOTING') {
          soundFx.playDay();
        } else if (r.phase === 'ENDED') {
          soundFx.playVictory();
        }
        prevPhaseRef.current = r.phase;
      }
    });

    socket.on('timer_tick', (data: { timerSecondsRemaining: number; estimatedMinutesRemaining: number }) => {
      setTimerRemaining(data.timerSecondsRemaining);
      setEstimatedMinutesRemaining(data.estimatedMinutesRemaining);
    });

    socket.on('profile_updated', (updatedProfile: UserProfile) => {
      setProfile(updatedProfile);
      showToast('Statistik & Level kamu telah diperbarui!');
    });

    socket.on('seer_result', (data) => {
      setSeerResult(data);
      soundFx.playNight();
      showToast(`Penerawangan: ${data.targetName} adalah ${data.role}!`);
    });

    socket.on('error', (err: string) => {
      setError(err);
      setTimeout(() => setError(''), 4000);
    });

    return () => {
      socket.off('room_state');
      socket.off('timer_tick');
      socket.off('profile_updated');
      socket.off('seer_result');
      socket.off('error');
    };
  }, []);

  // Fetch active rooms periodically when in dashboard
  useEffect(() => {
    if (profile && !room) {
      const fetchRooms = () => {
        socket.emit('get_rooms', (roomsList: any) => {
          setPublicRooms(roomsList || []);
        });
      };
      fetchRooms();
      const interval = setInterval(fetchRooms, 4000);
      return () => clearInterval(interval);
    }
  }, [profile, room]);

  // Auto-scroll chat internally
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [room?.chatHistory]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(''), 3500);
  };

  const handleRegister = (e: React.FormEvent) => {
    e.preventDefault();
    if (!usernameInput.trim()) return;
    socket.emit('register', { username: usernameInput.trim(), isExternal: false }, (prof: UserProfile) => {
      setProfile(prof);
      showToast(`Selamat datang, ${prof.username}!`);
    });
  };

  const handleCreateRoom = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!profile) return;
    socket.emit('create_room', {
      userId: profile.id,
      username: profile.username,
      roomName: newRoomName.trim() || `Desa ${profile.username}`,
      settings: {
        timerEnabled,
        discussionTime: customDiscussionTime,
        votingTime: customVotingTime,
        nightTime: customNightTime
      }
    }, (res: any) => {
      if (res.success) {
        showToast(`Desa ${res.roomId} berhasil dibuat!`);
        setNewRoomName('');
      } else {
        setError(res.error || 'Gagal membuat room.');
      }
    });
  };

  const handleSaveSettings = () => {
    if (!room) return;
    socket.emit('update_room_settings', {
      roomId: room.id,
      settings: {
        timerEnabled,
        discussionTime: customDiscussionTime,
        votingTime: customVotingTime,
        nightTime: customNightTime
      }
    });
    setShowSettingsModal(false);
    showToast(timerEnabled ? 'Pengaturan waktu berhasil disimpan.' : 'Mode Santai (Tanpa Timer) aktif.');
  };

  const handleJoinRoomWithId = (targetId: string, currentProfile: UserProfile) => {
    const code = targetId.trim().toUpperCase();
    if (!code) return;
    socket.emit('join_room', {
      roomId: code,
      userId: currentProfile.id,
      username: currentProfile.username
    }, (res: any) => {
      if (res.success) {
        showToast(`Bergabung ke Desa ${code}`);
      } else {
        setError(res.error || 'Gagal bergabung ke room.');
      }
    });
  };

  const handleJoinRoom = (targetId?: string) => {
    if (!profile) return;
    handleJoinRoomWithId(targetId || roomIdInput, profile);
  };

  const handleLeaveRoom = () => {
    if (room && profile) {
      socket.emit('leave_room', { roomId: room.id, userId: profile.id });
    }
    setRoom(null);
    setSeerResult(null);
  };

  const handleAddBot = () => {
    if (!room) return;
    socket.emit('add_bot', room.id);
  };

  const handleRemoveBot = (botId: string) => {
    if (!room) return;
    socket.emit('remove_bot', { roomId: room.id, botId });
  };

  const startGame = () => {
    if (room) {
      socket.emit('start_game', room.id);
    }
  };

  const forceNextPhase = () => {
    if (room) {
      socket.emit('force_next_phase', room.id);
    }
  };

  const startVoting = () => {
    if (room) {
      socket.emit('start_voting_phase', room.id);
    }
  };

  const restartGame = () => {
    if (room) {
      socket.emit('restart_game', room.id);
    }
  };

  const sendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatMessage.trim() || !room) return;
    socket.emit('send_message', { roomId: room.id, text: chatMessage });
    setChatMessage('');
  };

  const handleNightAction = (targetId: string) => {
    if (!room) return;
    socket.emit('night_action', { roomId: room.id, targetId });
    soundFx.playVote();
  };

  const handleVote = (targetId: string) => {
    if (!room) return;
    socket.emit('vote', { roomId: room.id, targetId });
    soundFx.playVote();
  };

  const copyRoomCode = () => {
    if (!room) return;
    navigator.clipboard.writeText(room.id);
    setCopiedCode(true);
    showToast(`Kode ${room.id} disalin!`);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const toggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    soundFx.enabled = next;
    showToast(next ? 'Suara Aktif' : 'Suara Mati');
  };

  // Level statistics calculation
  const levelInfo = profile ? calculateLevelFromStats(profile.totalWins, profile.totalLosses) : null;

  // Format seconds to MM:SS
  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // -------------------------------------------------------------
  // VIEW: REGISTER SCREEN (HITAM, PUTIH, BIRU)
  // -------------------------------------------------------------
  if (!profile) {
    return (
      <div className="min-h-screen bg-black text-zinc-100 flex flex-col items-center justify-center p-4 relative font-sans">
        {/* Soft deep-blue glow effect */}
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl pointer-events-none" />

        <div className="max-w-md w-full bg-gradient-to-b from-zinc-900 via-zinc-950 to-black p-8 rounded-2xl shadow-2xl border border-zinc-800 relative z-10">
          <div className="text-center mb-8">
            <div className="inline-flex p-3 bg-zinc-900 border border-blue-900/60 text-blue-400 rounded-2xl mb-4 shadow-sm">
              <PawPrint size={32} />
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight text-white mb-1">
              WEREWOLF
            </h1>
            <p className="text-zinc-400 text-xs">Multiplayer Social Deduction Game</p>
          </div>

          <form onSubmit={handleRegister} className="space-y-4">
            <div>
              <div className="flex justify-between items-center mb-1.5">
                <label className="text-xs font-semibold text-zinc-200">
                  Nama Akun Pemain
                </label>
                <span className="text-[11px] text-blue-400 flex items-center space-x-1">
                  <Globe size={11} />
                  <span>Dapat dari website induk</span>
                </span>
              </div>
              <input
                type="text"
                value={usernameInput}
                onChange={(e) => setUsernameInput(e.target.value)}
                className="w-full px-4 py-3 bg-zinc-950 border border-zinc-800 focus:border-blue-500 rounded-xl focus:outline-none text-white text-sm transition-all"
                placeholder="Masukkan nama akun..."
                maxLength={20}
                autoFocus
              />
              <p className="text-[11px] text-zinc-500 mt-2 leading-relaxed">
                Tersambung otomatis bila dibuka lewat parameter <code>?username=NamaPlayer</code> dari website utama.
              </p>
            </div>

            <button
              type="submit"
              disabled={!usernameInput.trim()}
              className="w-full py-3 bg-white hover:bg-zinc-200 disabled:opacity-30 text-black font-bold rounded-xl transition-all cursor-pointer flex items-center justify-center space-x-2 shadow-lg"
            >
              <span>Masuk ke Permainan</span>
              <ChevronRight size={16} />
            </button>
          </form>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------
  // VIEW: LOBBY / DASHBOARD (KOMBINASI HITAM, PUTIH, BIRU)
  // -------------------------------------------------------------
  if (!room) {
    return (
      <div className="min-h-screen bg-black text-zinc-100 p-4 lg:p-8 flex flex-col font-sans relative overflow-x-hidden">
        {/* Subtle ambient blue lighting */}
        <div className="absolute top-0 right-1/4 w-96 h-96 bg-blue-600/5 rounded-full blur-3xl pointer-events-none" />

        {/* Top Header */}
        <header className="flex flex-wrap justify-between items-center gap-4 mb-8 max-w-6xl mx-auto w-full bg-zinc-950/80 backdrop-blur-md px-6 py-4 rounded-2xl border border-zinc-800 shadow-md">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-zinc-900 border border-blue-900/40 rounded-xl text-blue-400">
              <PawPrint size={22} />
            </div>
            <div>
              <h1 className="text-xl font-black tracking-tight text-white flex items-center space-x-2">
                <span>WEREWOLF</span>
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
              </h1>
              <div className="flex items-center space-x-2">
                <span className="text-xs text-zinc-400">Desa Online Real-Time</span>
                {profile.externalAccount && (
                  <span className="text-[10px] bg-blue-950/60 text-blue-300 border border-blue-800/60 px-1.5 py-0.5 rounded font-mono">
                    Akun Web
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center flex-wrap gap-2.5">
            {/* Player Level Badge */}
            <button
              onClick={() => setShowProfileModal(true)}
              className="flex items-center space-x-3 bg-zinc-900 hover:bg-zinc-850 px-4 py-2 rounded-xl border border-zinc-800 hover:border-blue-900/50 transition-all text-left shadow-sm group cursor-pointer"
            >
              <div className="w-7 h-7 rounded-lg bg-zinc-800 border border-blue-900/50 flex items-center justify-center text-blue-400 font-bold text-xs">
                {levelInfo?.level}
              </div>
              <div>
                <div className="flex items-center space-x-2">
                  <span className="font-semibold text-xs text-zinc-200 group-hover:text-white">
                    {profile.username}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.2 rounded border border-blue-900/40 bg-zinc-950 text-blue-300">
                    {levelInfo?.title}
                  </span>
                </div>
                <div className="w-24 bg-zinc-800 h-1.5 rounded-full overflow-hidden mt-1">
                  <div
                    className="bg-blue-500 h-full rounded-full transition-all duration-500"
                    style={{ width: `${levelInfo?.progressPercentage}%` }}
                  />
                </div>
              </div>
              <Trophy size={14} className="text-blue-400/80 ml-1" />
            </button>

            {/* Quick Actions */}
            <button
              onClick={() => setShowGuideModal(true)}
              className="p-2.5 bg-zinc-900 hover:bg-zinc-800 rounded-xl border border-zinc-800 text-zinc-300 hover:text-white transition-colors cursor-pointer"
              title="Panduan Cara Bermain"
            >
              <BookOpen size={16} />
            </button>
            <button
              onClick={toggleSound}
              className="p-2.5 bg-zinc-900 hover:bg-zinc-800 rounded-xl border border-zinc-800 text-zinc-300 hover:text-white transition-colors cursor-pointer"
              title={soundEnabled ? 'Matikan Suara' : 'Nyalakan Suara'}
            >
              {soundEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
            </button>
          </div>
        </header>

        {/* Global Toast Error / Banner */}
        {error && (
          <div className="max-w-6xl mx-auto w-full mb-6 p-4 bg-zinc-900 border border-zinc-700 text-zinc-200 rounded-xl text-center text-sm flex items-center justify-center space-x-2">
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}
        {toastMessage && (
          <div className="fixed bottom-6 right-6 z-50 bg-white text-black font-bold px-4 py-2.5 rounded-xl shadow-2xl flex items-center space-x-2 border border-zinc-300 text-xs">
            <Sparkles size={14} className="text-blue-600" />
            <span>{toastMessage}</span>
          </div>
        )}

        {/* Main Content Grid */}
        <main className="max-w-6xl mx-auto w-full flex-1 grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Werewolf Game Card (2 Cols) */}
          <div className="lg:col-span-2 bg-gradient-to-b from-zinc-900 via-zinc-900/95 to-black rounded-2xl p-6 sm:p-8 border border-zinc-800 shadow-xl flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-4">
                <span className="px-3 py-1 bg-zinc-800 text-zinc-300 border border-blue-900/40 rounded-full text-xs font-semibold uppercase tracking-wider flex items-center space-x-1.5">
                  <PawPrint size={13} className="text-blue-400" />
                  <span>Werewolf Arena</span>
                </span>
                <span className="text-xs text-blue-400 flex items-center space-x-1">
                  <Hourglass size={12} />
                  <span>{timerEnabled ? `Estimasi: ~${Math.ceil(3 * (customDiscussionTime + customVotingTime + customNightTime) / 60)} Menit` : 'Mode Manual (Tanpa Timer)'}</span>
                </span>
              </div>

              <h2 className="text-2xl sm:text-3xl font-extrabold text-white mb-2 tracking-tight">
                Papan Permainan Desa
              </h2>
              <p className="text-zinc-400 text-xs sm:text-sm leading-relaxed mb-6 max-w-xl">
                Temukan para serigala sebelum terlambat! Anda dapat mengatur durasi diskusi secara custom atau mematikan waktu (Mode Santai). Room yang kosong akan otomatis dihapus.
              </p>

              {/* Time Configuration Snapshot */}
              <div className="bg-zinc-950 p-4 rounded-xl border border-zinc-800 mb-6 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex items-center space-x-2.5 text-zinc-300">
                  <Clock size={16} className="text-blue-400" />
                  <span>
                    Status Waktu: <strong className="text-white">{timerEnabled ? `Aktif (${customDiscussionTime}s diskusi)` : 'Tanpa Batas Waktu'}</strong>
                  </span>
                </div>
                <button
                  onClick={() => setShowSettingsModal(true)}
                  className="text-blue-400 hover:text-blue-300 font-medium underline text-xs cursor-pointer"
                >
                  Ubah Pengaturan Waktu
                </button>
              </div>

              {/* Roles Badge Pills with Authentic Icons */}
              <div className="flex flex-wrap gap-2 mb-8 text-xs">
                <span className="px-2.5 py-1 bg-zinc-950 border border-zinc-800 text-zinc-200 rounded-lg flex items-center space-x-1.5">
                  <PawPrint size={13} className="text-blue-400" /> <span>Werewolf</span>
                </span>
                <span className="px-2.5 py-1 bg-zinc-950 border border-zinc-800 text-zinc-200 rounded-lg flex items-center space-x-1.5">
                  <Eye size={13} className="text-blue-400" /> <span>Seer (Peramal)</span>
                </span>
                <span className="px-2.5 py-1 bg-zinc-950 border border-zinc-800 text-zinc-200 rounded-lg flex items-center space-x-1.5">
                  <HeartPulse size={13} className="text-blue-400" /> <span>Dokter (Tabib)</span>
                </span>
                <span className="px-2.5 py-1 bg-zinc-950 border border-zinc-800 text-zinc-200 rounded-lg flex items-center space-x-1.5">
                  <Users size={13} className="text-blue-400" /> <span>Warga Desa</span>
                </span>
              </div>
            </div>

            {/* Room Creation & Join Controls */}
            <div className="pt-6 border-t border-zinc-800/80 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* 1-Click Create Room Button */}
                <button
                  onClick={() => handleCreateRoom()}
                  className="w-full py-3.5 px-5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold transition-all flex items-center justify-center space-x-2 cursor-pointer shadow-lg shadow-blue-950/50"
                >
                  <Plus size={18} />
                  <span className="text-sm">Buat Room Baru</span>
                </button>

                {/* Join Code Input Form */}
                <form onSubmit={(e) => { e.preventDefault(); handleJoinRoom(); }} className="flex space-x-2">
                  <input
                    type="text"
                    value={roomIdInput}
                    onChange={(e) => setRoomIdInput(e.target.value.toUpperCase())}
                    placeholder="Kode Room (DESA-XXXX)"
                    className="flex-1 px-4 py-3 bg-zinc-950 border border-zinc-800 focus:border-blue-500 rounded-xl focus:outline-none text-white font-mono placeholder:text-zinc-600 text-xs"
                  />
                  <button
                    type="submit"
                    disabled={!roomIdInput.trim()}
                    className="px-4 py-3 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 hover:border-blue-500 disabled:opacity-40 text-white rounded-xl font-medium text-xs transition-colors flex items-center space-x-1 cursor-pointer"
                  >
                    <Play size={14} />
                    <span>Gabung</span>
                  </button>
                </form>
              </div>
            </div>
          </div>

          {/* Right Column: Active Public Rooms & Account Info */}
          <div className="space-y-6 flex flex-col justify-between">
            {/* Active Rooms */}
            <div className="bg-zinc-900/80 rounded-2xl p-6 border border-zinc-800 shadow-md flex-1 flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-zinc-200 text-sm flex items-center space-x-2">
                  <Users size={16} className="text-blue-400" />
                  <span>Daftar Room Aktif</span>
                </h3>
                <span className="text-xs text-zinc-400">{publicRooms.length} room</span>
              </div>

              <div className="space-y-2 overflow-y-auto flex-1 max-h-56 pr-1">
                {publicRooms.length === 0 ? (
                  <div className="text-center py-8 text-zinc-500 text-xs">
                    <p>Tidak ada room yang terbuka.</p>
                    <p className="mt-1">Room otomatis dihapus bila sudah kosong.</p>
                  </div>
                ) : (
                  publicRooms.map(r => (
                    <div
                      key={r.id}
                      className="p-3 bg-zinc-950 border border-zinc-800 hover:border-blue-500/50 rounded-xl flex items-center justify-between transition-colors"
                    >
                      <div>
                        <div className="font-semibold text-xs text-zinc-200">{r.name}</div>
                        <div className="flex items-center space-x-2 text-[11px] text-zinc-400 font-mono mt-0.5">
                          <span>{r.id}</span>
                          <span>•</span>
                          <span className="text-blue-400">{r.timerEnabled ? `~${r.estimatedMinutes || 6}m` : 'Manual'}</span>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        <span className="text-[11px] bg-zinc-900 text-zinc-400 px-2 py-1 rounded">
                          {r.playersCount}P
                        </span>
                        <button
                          onClick={() => handleJoinRoom(r.id)}
                          className="px-3 py-1 bg-white hover:bg-zinc-200 text-black rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                        >
                          Masuk
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Platform Notes */}
            <div className="bg-zinc-950 p-4 rounded-2xl border border-zinc-800 text-zinc-400 text-xs space-y-1.5">
              <div className="font-semibold text-zinc-200 flex items-center space-x-1.5">
                <Crown size={14} className="text-blue-400" />
                <span>Aturan Room Master & Keberadaan Room</span>
              </div>
              <p className="text-[11px] leading-relaxed">
                Bila Room Master keluar dari permainan, kepemilikan Room Master otomatis dialihkan ke pemain terakhir di dalam room. Jika seluruh pemain keluar, room langsung dihapus secara otomatis.
              </p>
            </div>
          </div>
        </main>

        {/* PROFILE & STATS MODAL */}
        {showProfileModal && (
          <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-xl w-full p-6 sm:p-8 max-h-[90vh] overflow-y-auto shadow-2xl relative">
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h3 className="text-xl font-bold text-white flex items-center space-x-2">
                    <Trophy className="text-blue-400" size={20} />
                    <span>Statistik & Level Pemain</span>
                  </h3>
                  <p className="text-zinc-400 text-xs">Rekor menang dan kalah per peran Werewolf</p>
                </div>
                <button
                  onClick={() => setShowProfileModal(false)}
                  className="text-zinc-400 hover:text-white text-lg p-1 cursor-pointer"
                >
                  ✕
                </button>
              </div>

              {/* Level Progress Banner */}
              <div className="bg-zinc-950 p-5 rounded-xl border border-zinc-800 mb-6">
                <div className="flex justify-between items-center mb-2">
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 rounded-xl bg-blue-600 border border-blue-400 flex items-center justify-center text-white font-extrabold text-base shadow">
                      {levelInfo?.level}
                    </div>
                    <div>
                      <div className="font-bold text-sm text-white">{profile.username}</div>
                      <div className="inline-block text-[11px] px-2 py-0.5 rounded border border-blue-900/60 bg-blue-950/40 text-blue-300 mt-0.5">
                        {levelInfo?.title}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-[11px] text-zinc-400">Total EXP</span>
                    <div className="text-base font-bold text-blue-400">{profile.exp} XP</div>
                  </div>
                </div>

                <div className="mt-3">
                  <div className="flex justify-between text-[11px] text-zinc-400 mb-1">
                    <span>Level {levelInfo?.level}</span>
                    <span>{levelInfo?.currentLevelExp} / {levelInfo?.expForNextLevel} XP</span>
                  </div>
                  <div className="w-full bg-zinc-800 h-2 rounded-full overflow-hidden">
                    <div
                      className="bg-blue-500 h-full rounded-full transition-all duration-500"
                      style={{ width: `${levelInfo?.progressPercentage}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Total Match Stats */}
              <div className="grid grid-cols-3 gap-3 mb-6 text-center text-xs">
                <div className="bg-zinc-950 p-3 rounded-xl border border-zinc-800">
                  <span className="text-zinc-400">Total Main</span>
                  <div className="text-lg font-bold text-white mt-0.5">{profile.totalMatches}</div>
                </div>
                <div className="bg-zinc-950 p-3 rounded-xl border border-zinc-800">
                  <span className="text-zinc-400">Menang</span>
                  <div className="text-lg font-bold text-emerald-400 mt-0.5">{profile.totalWins}</div>
                </div>
                <div className="bg-zinc-950 p-3 rounded-xl border border-zinc-800">
                  <span className="text-zinc-400">Kalah</span>
                  <div className="text-lg font-bold text-red-400 mt-0.5">{profile.totalLosses}</div>
                </div>
              </div>

              {/* Breakdown Status Menang & Kalah per Role with icons */}
              <div className="mb-6">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-3">
                  Rekor Berdasarkan Role (Menang / Kalah)
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  {/* Werewolf */}
                  <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-xl flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <PawPrint size={16} className="text-blue-400" />
                      <span className="font-semibold text-zinc-200">Werewolf</span>
                    </div>
                    <div className="text-right">
                      <span className="font-semibold text-white">{profile.roleStats.Werewolf.wins}W / {profile.roleStats.Werewolf.losses}L</span>
                    </div>
                  </div>

                  {/* Villager */}
                  <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-xl flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Users size={16} className="text-blue-400" />
                      <span className="font-semibold text-zinc-200">Warga (Villager)</span>
                    </div>
                    <div className="text-right">
                      <span className="font-semibold text-white">{profile.roleStats.Villager.wins}W / {profile.roleStats.Villager.losses}L</span>
                    </div>
                  </div>

                  {/* Seer */}
                  <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-xl flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Eye size={16} className="text-blue-400" />
                      <span className="font-semibold text-zinc-200">Seer (Peramal)</span>
                    </div>
                    <div className="text-right">
                      <span className="font-semibold text-white">{profile.roleStats.Seer.wins}W / {profile.roleStats.Seer.losses}L</span>
                    </div>
                  </div>

                  {/* Doctor */}
                  <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-xl flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <HeartPulse size={16} className="text-blue-400" />
                      <span className="font-semibold text-zinc-200">Dokter (Tabib)</span>
                    </div>
                    <div className="text-right">
                      <span className="font-semibold text-white">{profile.roleStats.Doctor.wins}W / {profile.roleStats.Doctor.losses}L</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* GUIDE MODAL */}
        {showGuideModal && (
          <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-lg w-full p-6 max-h-[85vh] overflow-y-auto shadow-2xl">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-bold text-white flex items-center space-x-2">
                  <BookOpen className="text-blue-400" size={18} />
                  <span>Panduan Bermain Werewolf</span>
                </h3>
                <button onClick={() => setShowGuideModal(false)} className="text-zinc-400 hover:text-white cursor-pointer">✕</button>
              </div>

              <div className="space-y-3.5 text-xs text-zinc-300 leading-relaxed">
                <div className="bg-zinc-950 p-3 rounded-xl border border-zinc-800">
                  <h4 className="font-bold text-white mb-1">Mekanisme Waktu & Pemilik Room</h4>
                  <p>• Room Master dapat mengaktifkan Mode Santai (tanpa batas waktu countdown).</p>
                  <p className="mt-1">• Jika Room Master keluar, akses Room Master otomatis dialihkan kepada pemain terakhir di dalam room.</p>
                </div>

                <div className="space-y-2">
                  <h4 className="font-bold text-white">Penjelasan Role:</h4>
                  <div className="p-2.5 bg-zinc-950 border border-zinc-800 rounded-lg flex items-center space-x-2">
                    <PawPrint size={15} className="text-blue-400 shrink-0" />
                    <div><strong className="text-white">Werewolf:</strong> Memilih satu mangsa untuk dieliminasi di malam hari.</div>
                  </div>
                  <div className="p-2.5 bg-zinc-950 border border-zinc-800 rounded-lg flex items-center space-x-2">
                    <Eye size={15} className="text-blue-400 shrink-0" />
                    <div><strong className="text-white">Seer (Peramal):</strong> Menerawang identitas satu pemain setiap malam.</div>
                  </div>
                  <div className="p-2.5 bg-zinc-950 border border-zinc-800 rounded-lg flex items-center space-x-2">
                    <HeartPulse size={15} className="text-blue-400 shrink-0" />
                    <div><strong className="text-white">Dokter (Tabib):</strong> Melindungi satu pemain dari serangan serigala.</div>
                  </div>
                  <div className="p-2.5 bg-zinc-950 border border-zinc-800 rounded-lg flex items-center space-x-2">
                    <Users size={15} className="text-blue-400 shrink-0" />
                    <div><strong className="text-white">Villager (Warga):</strong> Berdiskusi dan melakukan pemungutan suara di siang hari.</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // -------------------------------------------------------------
  // VIEW: INSIDE GAME ROOM (HITAM, PUTIH, BIRU + DEDICATED FIXED CHAT)
  // -------------------------------------------------------------
  const me = room.players.find(p => p.id === profile.id);
  const isHost = room.hostId === profile.id;
  const isDead = me ? !me.isAlive : false;
  const myRole = me?.role;

  const canActNight = me?.isAlive && room.phase === 'NIGHT' && (myRole === 'Werewolf' || myRole === 'Doctor' || myRole === 'Seer');
  const canVoteDay = me?.isAlive && (room.phase === 'DAY_VOTING' || room.phase === 'DAY_DISCUSSION');

  return (
    <div className="h-screen max-h-screen overflow-hidden bg-black text-zinc-100 flex flex-col font-sans select-none">
      {/* Room Header (Shrink-0) */}
      <header className="bg-zinc-950 border-b border-zinc-800 py-3 px-4 sm:px-6 flex justify-between items-center shrink-0 z-20">
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-2">
            <PawPrint size={18} className="text-blue-400" />
            <span className="font-bold text-sm sm:text-base tracking-tight text-white hidden sm:inline">
              {room.name}
            </span>
          </div>

          {/* Copyable Room Code */}
          <button
            onClick={copyRoomCode}
            className="flex items-center space-x-1.5 bg-zinc-900 hover:bg-zinc-850 px-2.5 py-1.5 rounded-lg border border-zinc-800 text-xs font-mono text-blue-300 transition-all cursor-pointer"
            title="Salin kode room"
          >
            <span>{room.id}</span>
            {copiedCode ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} className="text-zinc-500" />}
          </button>
        </div>

        {/* Status in Room */}
        <div className="flex items-center space-x-2 sm:space-x-3">
          {/* Time mode badge */}
          <div className="hidden md:flex items-center space-x-1.5 bg-zinc-900 px-3 py-1.5 rounded-xl border border-zinc-800 text-xs text-zinc-300">
            <Hourglass size={12} className="text-blue-400" />
            <span>
              {room.settings?.timerEnabled === false
                ? 'Tanpa Batas Waktu'
                : room.phase === 'LOBBY'
                ? `Estimasi: ~${room.estimatedMinutesTotal}m`
                : `Selesai: ~${estimatedMinutesRemaining || 2}m`}
            </span>
          </div>

          {/* Room Master Settings in Lobby */}
          {isHost && room.phase === 'LOBBY' && (
            <button
              onClick={() => setShowSettingsModal(true)}
              className="flex items-center space-x-1.5 bg-zinc-900 hover:bg-zinc-800 px-3 py-1.5 rounded-xl border border-zinc-700 text-xs text-white cursor-pointer"
            >
              <Sliders size={13} className="text-blue-400" />
              <span className="hidden sm:inline">Atur Waktu</span>
            </button>
          )}

          {me && (
            <div className="flex items-center space-x-2 bg-zinc-900 px-3 py-1.5 rounded-xl border border-zinc-800">
              <div className={`w-2 h-2 rounded-full ${me.isAlive ? 'bg-blue-400' : 'bg-zinc-600'}`} />
              <span className="font-medium text-xs sm:text-sm text-zinc-200">{me.name}</span>
              {me.role && (
                <span className="text-[10px] px-1.5 py-0.2 rounded font-semibold bg-zinc-950 border border-blue-900/60 text-blue-300 uppercase tracking-wider">
                  {me.role}
                </span>
              )}
            </div>
          )}

          <button
            onClick={toggleSound}
            className="p-2 bg-zinc-900 hover:bg-zinc-800 rounded-xl border border-zinc-800 text-zinc-300 cursor-pointer"
          >
            {soundEnabled ? <Volume2 size={15} /> : <VolumeX size={15} />}
          </button>

          <button
            onClick={handleLeaveRoom}
            className="p-2 bg-zinc-900 hover:bg-zinc-800 rounded-xl border border-zinc-800 text-zinc-400 hover:text-white transition-colors cursor-pointer"
            title="Tinggalkan Desa"
          >
            <LogOut size={15} />
          </button>
        </div>
      </header>

      {/* Main Game Interface Area - Strict Fixed Flex Layout */}
      <div className="flex-1 min-h-0 flex flex-col md:flex-row overflow-hidden relative">
        {/* Left Side: Game Board (Scrollable independently) */}
        <div className="flex-1 min-h-0 flex flex-col p-4 sm:p-6 overflow-y-auto">
          {/* Phase Banner */}
          <div className="rounded-2xl p-5 mb-5 text-center border shadow-xl bg-gradient-to-b from-zinc-900 to-zinc-950 border-zinc-800 shrink-0">
            <div className="flex items-center justify-center space-x-2 mb-1">
              {room.phase === 'LOBBY' && <Users className="text-blue-400" size={20} />}
              {room.phase === 'NIGHT' && <Moon className="text-blue-400 animate-pulse" size={20} />}
              {room.phase === 'DAY_DISCUSSION' && <Sun className="text-white" size={20} />}
              {room.phase === 'DAY_VOTING' && <Gavel className="text-blue-400" size={20} />}
              {room.phase === 'ENDED' && <Trophy className="text-blue-300" size={22} />}

              <h2 className="text-lg sm:text-xl font-bold tracking-tight text-white">
                {room.phase === 'LOBBY' && 'Menunggu Pemain di Desa'}
                {room.phase === 'NIGHT' && `Malam ke-${room.dayCount}`}
                {room.phase === 'DAY_DISCUSSION' && `Hari ke-${room.dayCount} - Diskusi Warga`}
                {room.phase === 'DAY_VOTING' && `Hari ke-${room.dayCount} - Pemungutan Suara (Voting)`}
                {room.phase === 'ENDED' && 'Permainan Selesai'}
              </h2>
            </div>

            {/* Countdown or Manual Mode Status */}
            {room.phase !== 'LOBBY' && room.phase !== 'ENDED' && (
              <div className="my-2 inline-flex items-center space-x-2 bg-zinc-950 px-3.5 py-1 rounded-full border border-blue-900/40 text-xs">
                {room.settings?.timerEnabled === false ? (
                  <span className="text-zinc-400 font-medium">Mode Santai (Tanpa Batas Waktu)</span>
                ) : (
                  <>
                    <Hourglass size={13} className={timerRemaining <= 10 ? 'text-blue-300 animate-pulse' : 'text-blue-400'} />
                    <span className="text-zinc-400">
                      {room.phase === 'DAY_DISCUSSION' ? 'Sisa Diskusi:' : room.phase === 'DAY_VOTING' ? 'Sisa Voting:' : 'Sisa Malam:'}
                    </span>
                    <span className="font-mono font-bold text-white">
                      {formatTimer(timerRemaining)}
                    </span>
                  </>
                )}
              </div>
            )}

            <p className="text-xs text-zinc-400 max-w-xl mx-auto mt-1 leading-relaxed">
              {room.phase === 'LOBBY' && 'Bagikan Kode Room atau gunakan tombol Bot AI untuk uji coba mandiri.'}
              {room.phase === 'NIGHT' && (
                me?.isAlive ? (
                  myRole === 'Werewolf' ? 'Pilih satu mangsa bersama kawanan serigala.' :
                  myRole === 'Seer' ? 'Pilih satu warga untuk diterawang identitasnya.' :
                  myRole === 'Doctor' ? 'Pilih satu pemain untuk dilindungi malam ini.' :
                  'Seluruh warga sedang tertidur lelap...'
                ) : 'Kamu adalah arwah (Spectator). Memantau jalannya malam.'
              )}
              {room.phase === 'DAY_DISCUSSION' && 'Fajar telah tiba. Manfaatkan kolom obrolan untuk berdiskusi.'}
              {room.phase === 'DAY_VOTING' && 'Pilih satu pemain yang dicurigai sebagai serigala.'}
              {room.phase === 'ENDED' && (
                room.winner === 'Villagers'
                  ? 'Kemenangan Tim Warga Desa!'
                  : 'Kemenangan Kawanan Werewolf!'
              )}
            </p>

            {/* Host Action Buttons */}
            {isHost && (
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2 pt-3 border-t border-zinc-800">
                {room.phase === 'LOBBY' && (
                  <>
                    <button
                      onClick={startGame}
                      disabled={room.players.length < 3}
                      className="px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-30 text-white font-bold rounded-xl text-xs cursor-pointer shadow-lg shadow-blue-950/50"
                    >
                      Mulai Permainan ({room.players.length}/10 Pemain)
                    </button>
                    <button
                      onClick={handleAddBot}
                      className="px-3.5 py-2 bg-zinc-800 hover:bg-zinc-750 text-zinc-200 border border-zinc-700 rounded-xl text-xs flex items-center space-x-1.5 cursor-pointer"
                    >
                      <Bot size={14} className="text-blue-400" />
                      <span>+ Bot AI</span>
                    </button>
                    <button
                      onClick={() => setShowSettingsModal(true)}
                      className="px-3.5 py-2 bg-zinc-800 hover:bg-zinc-750 text-zinc-200 border border-zinc-700 rounded-xl text-xs flex items-center space-x-1.5 cursor-pointer"
                    >
                      <Sliders size={14} className="text-blue-400" />
                      <span>Atur Waktu</span>
                    </button>
                  </>
                )}

                {room.phase === 'DAY_DISCUSSION' && (
                  <button
                    onClick={startVoting}
                    className="px-4 py-2 bg-white hover:bg-zinc-200 text-black font-semibold rounded-xl text-xs flex items-center space-x-1.5 cursor-pointer"
                  >
                    <span>Mulai Voting Sekarang</span>
                    <FastForward size={14} />
                  </button>
                )}

                {(room.phase === 'NIGHT' || room.phase === 'DAY_DISCUSSION' || room.phase === 'DAY_VOTING') && (
                  <button
                    onClick={forceNextPhase}
                    className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-[11px] border border-zinc-700 cursor-pointer"
                  >
                    Selesaikan / Percepat Fase
                  </button>
                )}

                {room.phase === 'ENDED' && (
                  <button
                    onClick={restartGame}
                    className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-xs flex items-center space-x-1.5 cursor-pointer shadow"
                  >
                    <RefreshCw size={14} />
                    <span>Kembali ke Lobby</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Seer Private Result Banner */}
          {seerResult && room.phase === 'NIGHT' && myRole === 'Seer' && (
            <div className="mb-4 p-3.5 bg-zinc-900 border border-blue-900/60 rounded-xl text-zinc-200 text-xs flex items-center space-x-2.5 shrink-0">
              <Eye size={18} className="text-blue-400 shrink-0" />
              <div>
                <strong className="text-white">Hasil Penerawangan: </strong>
                <span>Pemain <strong>{seerResult.targetName}</strong> berpihak sebagai <strong>{seerResult.role}</strong>.</span>
              </div>
            </div>
          )}

          {/* Grid of Players with Appropriate Icons */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {room.players.map(p => {
              const isMe = p.id === me?.id;
              const isTargetDead = !p.isAlive;
              const amIAlive = me?.isAlive;

              const actedOnThem =
                (myRole === 'Werewolf' && room.nightActions.werewolfTarget === p.id) ||
                (myRole === 'Doctor' && room.nightActions.doctorTarget === p.id) ||
                (myRole === 'Seer' && room.nightActions.seerTarget === p.id) ||
                ((room.phase === 'DAY_VOTING' || room.phase === 'DAY_DISCUSSION') && room.votes[me?.id || ''] === p.id);

              const seerKnowledge = room.seerInspections?.[p.id];

              let actionBtnLabel = '';
              let actionDisabled = false;

              if (canActNight && !isTargetDead) {
                if (myRole === 'Werewolf') {
                  if (p.role === 'Werewolf') {
                    actionDisabled = true;
                  } else {
                    actionBtnLabel = 'Bunuh Mangsa 🐺';
                  }
                } else if (myRole === 'Doctor') {
                  actionBtnLabel = isMe ? 'Lindungi Diri 💉' : 'Lindungi 💉';
                } else if (myRole === 'Seer') {
                  if (isMe) {
                    actionDisabled = true;
                  } else {
                    actionBtnLabel = 'Terawang Identitas 🔮';
                  }
                }
              } else if (canVoteDay && !isTargetDead) {
                actionBtnLabel = isMe ? 'Vote Diri' : 'Vote Eliminasi ⚖️';
              }

              return (
                <div
                  key={p.id}
                  className={`p-3.5 rounded-xl border flex flex-col justify-between transition-all relative ${
                    isTargetDead
                      ? 'bg-zinc-950/70 border-zinc-900 opacity-50'
                      : isMe
                      ? 'bg-zinc-900 border-blue-500/80 shadow-md ring-1 ring-blue-500/30'
                      : 'bg-zinc-900/90 border-zinc-800'
                  }`}
                >
                  {/* Card Header */}
                  <div>
                    <div className="flex items-center justify-between gap-1 mb-2">
                      <div className="flex items-center space-x-1.5 truncate">
                        <span className="font-semibold text-xs sm:text-sm text-white truncate">{p.name}</span>
                        {p.isBot && (
                          <span className="text-[10px] bg-zinc-800 text-zinc-400 px-1 py-0.2 rounded border border-zinc-700">
                            BOT
                          </span>
                        )}
                      </div>

                      {/* Status badge */}
                      {isTargetDead ? (
                        <span className="text-[10px] bg-zinc-950 text-zinc-500 border border-zinc-800 px-1.5 py-0.5 rounded font-bold flex items-center space-x-1">
                          <Skull size={10} /> <span>GUGUR</span>
                        </span>
                      ) : (
                        p.id === room.hostId && (
                          <span className="text-[10px] bg-blue-950 text-blue-300 border border-blue-800 px-1.5 py-0.5 rounded font-bold flex items-center space-x-1">
                            <Crown size={10} /> <span>MASTER</span>
                          </span>
                        )
                      )}
                    </div>

                    {/* Role Display with Proper Thematic Icons */}
                    {p.role ? (
                      <div className="inline-flex items-center space-x-1 text-[11px] font-medium px-2 py-0.5 rounded bg-zinc-950 border border-blue-900/40 text-zinc-200 mt-1">
                        {p.role === 'Werewolf' && <PawPrint size={12} className="text-blue-400" />}
                        {p.role === 'Villager' && <Users size={12} className="text-zinc-400" />}
                        {p.role === 'Seer' && <Eye size={12} className="text-blue-400" />}
                        {p.role === 'Doctor' && <HeartPulse size={12} className="text-emerald-400" />}
                        <span>{p.role}</span>
                      </div>
                    ) : (
                      !isTargetDead && room.phase !== 'LOBBY' && (
                        <div className="text-[11px] text-zinc-500 italic mt-1">
                          Identitas Rahasia
                        </div>
                      )
                    )}

                    {/* Seer Knowledge */}
                    {seerKnowledge && (
                      <div className="mt-2 text-[10px] px-1.5 py-0.5 rounded bg-zinc-950 border border-blue-900/50 text-blue-300">
                        Hasil: {seerKnowledge.isWerewolf ? 'Serigala 🐺' : 'Warga Baik 🌾'}
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="mt-3 pt-2.5 border-t border-zinc-800/80">
                    {room.phase === 'LOBBY' && isHost && p.isBot && (
                      <button
                        onClick={() => handleRemoveBot(p.id)}
                        className="w-full py-1 text-[11px] text-zinc-400 hover:text-white border border-zinc-800 hover:bg-zinc-800 rounded-lg cursor-pointer"
                      >
                        Hapus Bot
                      </button>
                    )}

                    {actionBtnLabel && !actionDisabled && amIAlive && (
                      <button
                        onClick={() => {
                          if (room.phase === 'NIGHT') {
                            handleNightAction(p.id);
                          } else {
                            handleVote(p.id);
                          }
                        }}
                        className={`w-full py-1.5 px-2 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                          actedOnThem
                            ? 'bg-blue-600 text-white'
                            : 'bg-zinc-800 hover:bg-zinc-750 text-zinc-200 border border-zinc-700'
                        }`}
                      >
                        {actedOnThem ? '✓ Dipilih' : actionBtnLabel}
                      </button>
                    )}

                    {room.phase === 'DAY_VOTING' && (
                      <div className="text-[11px] text-zinc-400 mt-2 flex justify-between items-center">
                        <span className="flex items-center space-x-1">
                          <Gavel size={11} className="text-blue-400" />
                          <span>Suara:</span>
                        </span>
                        <span className="font-bold text-white bg-zinc-950 px-2 py-0.5 rounded border border-zinc-800">
                          {Object.values(room.votes).filter(v => v === p.id).length}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Side: DEDICATED FIXED CHAT COLUMN (Never expands or stretches website) */}
        <div className="w-full md:w-80 lg:w-96 bg-zinc-950 border-t md:border-t-0 md:border-l border-zinc-800 flex flex-col shrink-0 h-64 md:h-full overflow-hidden">
          {/* Chat Header (Fixed height) */}
          <div className="p-3 border-b border-zinc-800 bg-zinc-900/90 flex justify-between items-center shrink-0">
            <div className="flex items-center space-x-2">
              <MessageSquare size={15} className="text-blue-400" />
              <span className="font-bold text-xs text-white">
                {room.phase === 'NIGHT' && myRole === 'Werewolf' ? 'Obrolan Kawanan Serigala' : 'Obrolan Desa'}
              </span>
            </div>
            {isDead && (
              <span className="text-[10px] font-bold bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded border border-zinc-700">
                Spectator (Arwah)
              </span>
            )}
          </div>

          {/* Chat Messages List (Internal Scroll only) */}
          <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2.5 flex flex-col text-xs">
            {room.chatHistory.map(msg => (
              <div key={msg.id} className={`flex flex-col ${msg.system ? 'items-center my-1' : 'items-start'}`}>
                {msg.system ? (
                  <span className="text-[10px] text-zinc-400 bg-zinc-900 border border-zinc-800 px-2.5 py-1 rounded-lg text-center leading-relaxed max-w-[95%]">
                    {msg.text}
                  </span>
                ) : (
                  <div className={`max-w-[88%] ${msg.senderId === profile.id ? 'ml-auto text-right' : ''}`}>
                    <div className="flex items-center space-x-1 mb-0.5">
                      <span className={`text-[10px] font-medium ${msg.senderId === profile.id ? 'text-blue-400 font-bold' : 'text-zinc-400'}`}>
                        {msg.senderName}
                      </span>
                      {msg.isDeadChat && <span className="text-[9px] text-zinc-500">(Arwah)</span>}
                      {msg.isWerewolfChat && <span className="text-[9px] text-blue-300">(Serigala)</span>}
                    </div>

                    <div className={`p-2 rounded-xl text-xs leading-relaxed ${
                      msg.senderId === profile.id
                        ? 'bg-blue-600 text-white font-medium rounded-tr-none'
                        : msg.isDeadChat
                        ? 'bg-zinc-900/60 text-zinc-400 border border-zinc-800 rounded-tl-none italic'
                        : msg.isWerewolfChat
                        ? 'bg-blue-950/40 text-blue-200 border border-blue-900/50 rounded-tl-none'
                        : 'bg-zinc-900 text-zinc-200 border border-zinc-800 rounded-tl-none'
                    }`}>
                      {msg.text}
                    </div>
                  </div>
                )}
              </div>
            ))}
            <div ref={chatBottomRef} />
          </div>

          {/* Chat Input (Fixed at bottom of column) */}
          <form onSubmit={sendMessage} className="p-2.5 border-t border-zinc-800 bg-zinc-900/80 shrink-0">
            <input
              type="text"
              value={chatMessage}
              onChange={(e) => setChatMessage(e.target.value)}
              placeholder={
                isDead
                  ? "Ketik pesan sesama arwah..."
                  : room.phase === 'NIGHT' && myRole === 'Werewolf'
                  ? "Pesan rahasia serigala..."
                  : room.phase === 'NIGHT'
                  ? "Tertidur lelap..."
                  : "Ketik pesan diskusi..."
              }
              disabled={!isDead && room.phase === 'NIGHT' && myRole !== 'Werewolf'}
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 focus:border-blue-500 rounded-xl text-xs focus:outline-none text-white disabled:opacity-40"
            />
          </form>
        </div>
      </div>

      {/* HOST CUSTOM TIME SETTINGS MODAL */}
      {showSettingsModal && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full p-6 shadow-2xl relative">
            <div className="flex justify-between items-center mb-5">
              <h3 className="text-base font-bold text-white flex items-center space-x-2">
                <Sliders size={18} className="text-blue-400" />
                <span>Pengaturan Waktu Permainan</span>
              </h3>
              <button onClick={() => setShowSettingsModal(false)} className="text-zinc-400 hover:text-white cursor-pointer">✕</button>
            </div>

            <div className="space-y-4 text-xs text-zinc-300">
              {/* Untimed Mode Toggle */}
              <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-xl flex items-center justify-between">
                <div>
                  <div className="font-semibold text-white">Gunakan Batas Waktu Otomatis</div>
                  <div className="text-[11px] text-zinc-400">
                    {timerEnabled ? 'Fase berganti otomatis dengan countdown' : 'Mode Santai: Fase diganti manual oleh Room Master'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setTimerEnabled(!timerEnabled)}
                  className={`w-12 h-6 rounded-full transition-colors relative cursor-pointer ${
                    timerEnabled ? 'bg-blue-600' : 'bg-zinc-800'
                  }`}
                >
                  <div className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-transform ${
                    timerEnabled ? 'left-7' : 'left-1'
                  }`} />
                </button>
              </div>

              {timerEnabled && (
                <>
                  {/* Discussion Duration */}
                  <div>
                    <div className="flex justify-between items-center mb-1.5">
                      <label className="font-medium text-zinc-200">Waktu Diskusi Siang:</label>
                      <span className="font-mono font-bold text-blue-400">{customDiscussionTime}s</span>
                    </div>
                    <div className="flex gap-1.5">
                      {[30, 45, 60, 90, 120].map(sec => (
                        <button
                          key={sec}
                          type="button"
                          onClick={() => setCustomDiscussionTime(sec)}
                          className={`flex-1 py-1.5 rounded-lg border font-medium cursor-pointer transition-colors ${
                            customDiscussionTime === sec
                              ? 'bg-blue-600 border-blue-500 text-white'
                              : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-white'
                          }`}
                        >
                          {sec}s
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Voting Duration */}
                  <div>
                    <div className="flex justify-between items-center mb-1.5">
                      <label className="font-medium text-zinc-200">Waktu Voting:</label>
                      <span className="font-mono font-bold text-blue-400">{customVotingTime}s</span>
                    </div>
                    <div className="flex gap-1.5">
                      {[20, 30, 45, 60].map(sec => (
                        <button
                          key={sec}
                          type="button"
                          onClick={() => setCustomVotingTime(sec)}
                          className={`flex-1 py-1.5 rounded-lg border font-medium cursor-pointer transition-colors ${
                            customVotingTime === sec
                              ? 'bg-blue-600 border-blue-500 text-white'
                              : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-white'
                          }`}
                        >
                          {sec}s
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Night Duration */}
                  <div>
                    <div className="flex justify-between items-center mb-1.5">
                      <label className="font-medium text-zinc-200">Waktu Aksi Malam:</label>
                      <span className="font-mono font-bold text-blue-400">{customNightTime}s</span>
                    </div>
                    <div className="flex gap-1.5">
                      {[20, 30, 45].map(sec => (
                        <button
                          key={sec}
                          type="button"
                          onClick={() => setCustomNightTime(sec)}
                          className={`flex-1 py-1.5 rounded-lg border font-medium cursor-pointer transition-colors ${
                            customNightTime === sec
                              ? 'bg-blue-600 border-blue-500 text-white'
                              : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-white'
                          }`}
                        >
                          {sec}s
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}

              <div className="flex space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowSettingsModal(false)}
                  className="flex-1 py-2.5 bg-zinc-800 hover:bg-zinc-750 text-zinc-300 font-medium rounded-xl cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={handleSaveSettings}
                  className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl flex items-center justify-center space-x-1.5 cursor-pointer shadow-lg shadow-blue-950/50"
                >
                  <CheckCircle2 size={15} />
                  <span>Simpan Pengaturan</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
