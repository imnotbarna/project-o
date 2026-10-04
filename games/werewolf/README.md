# Werewolf Online - Multiplayer Digital Board Game

Werewolf Online adalah game social deduction real-time yang dirancang khusus agar dapat di-embed atau diintegrasikan langsung ke dalam website utama buatan tim/teman Anda.

## Tech Stack & Architecture
- **Frontend**: React, Vite, TailwindCSS (Desain dominan Biru / Midnight Blue & Sapphire)
- **Backend**: Node.js, Express, Socket.io
- **Data Storage**: In-memory data store dengan dukungan MongoDB schema untuk produksi
- **Real-Time Communication**: WebSocket via `socket.io`

## Integrasi Akun dari Website Teman
Game ini mendukung integrasi otomatis nama akun dari website induk melalui dua cara:
1. **URL Query Parameter**:
   Tautkan game dengan parameter:
   ```
   https://your-domain/?username=NamaPlayer&roomId=DESA-1234
   ```
   Game otomatis login dengan nama akun tersebut dan langsung bergabung ke room yang ditentukan.
2. **Iframe `postMessage`**:
   Jika di-embed dalam `<iframe>`:
   ```javascript
   iframe.contentWindow.postMessage({
     type: 'WEREWOLF_AUTH',
     username: 'NamaPlayer',
     roomId: 'DESA-1234'
   }, '*');
   ```

## Fitur Unggulan
- **Custom Waktu Diskusi**: Host dapat mengatur durasi diskusi siang (30s, 45s, 60s, 90s, 120s), voting, dan malam.
- **Kalkulasi Estimasi Beres Game**: Sistem menghitung estimasi menit selesai secara dinamis berdasarkan jumlah pemain dan durasi per siklus.
- **Countdown Real-Time**: Timer berjalan otomatis detik demi detik dengan transisi fase otomatis ketika waktu habis.
- **Level & Statistik Per Role**: Melacak rekor menang/kalah untuk Werewolf, Villager, Seer, dan Doctor, serta sistem Level & Rank.
- **Bot AI Testing**: Host dapat menambahkan bot untuk menguji fungsionalitas seluruh role secara mandiri.
