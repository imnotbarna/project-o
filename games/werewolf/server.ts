import express from 'express';
import { createServer as createViteServer } from 'vite';
import { Server } from 'socket.io';
import http from 'http';
import { initGameServer } from './src/server/game.js';

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  const PORT = Number(process.env.PORT ?? 3000);
  
  // Setup Socket.IO
  const io = new Server(server, { 
    cors: { origin: '*' }
  });

  // Initialize Game Logic
  initGameServer(io);

  // Set up Vite Middleware for serving frontend
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa'
  });
  
  app.use(vite.middlewares);

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on port ${PORT} (http://0.0.0.0:${PORT})`);
  });
}

startServer();
