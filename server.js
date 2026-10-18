// Shark Bait server — Express + Socket.IO (Render Web Service).
// - Serves the game from public/ (every library is local in public/vendor, no CDNs),
//   so only this one domain has to get through the academy proxy.
// - Relays messages between the host screen (projector) and the phones through rooms.
// - Phones and host reconnect on their own; a room survives short host drops.
// - GET /healthz for Render health checks.
'use strict';
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const compression = require('compression');
const { Server } = require('socket.io');

const PORT = Number(process.env.PORT) || 3000;
const HOST_GRACE_MS = 3 * 60 * 1000;   // keep a room alive this long after the host screen drops
const MAX_PLAYERS = 40;
const started = Date.now();

const app = express();
app.disable('x-powered-by');
app.use(compression());

app.get('/healthz', (req, res) => {
  res.set('Cache-Control', 'no-store').json({ ok: true, uptime: Math.round((Date.now() - started) / 1000), rooms: rooms.size, sockets: io.engine.clientsCount });
});
app.get('/host', (req, res) => res.redirect('/'));
app.get('/join', (req, res) => res.redirect('/play.html' + (req.query.room ? '?room=' + encodeURIComponent(String(req.query.room)) : '')));

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, file) {
    if (/\.(html|webmanifest)$/.test(file)) res.setHeader('Cache-Control', 'no-cache');
    else if (/\.(glb|gltf|bin|png|mp3|woff2)$/.test(file)) res.setHeader('Cache-Control', 'public, max-age=604800');
    else res.setHeader('Cache-Control', 'public, max-age=600');
  }
}));

// ---- Rooms ---------------------------------------------------------------------
const server = http.createServer(app);
const io = new Server(server, {
  pingInterval: 10000, pingTimeout: 15000, maxHttpBufferSize: 256 * 1024,
  cors: { origin: true }
});
// code -> { code, token, hostId, clients: Map<sid, {socketId, clientId}>, hostGoneTimer }
const rooms = new Map();
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function newCode() { let c; do { c = Array.from(crypto.randomBytes(4), b => ALPHABET[b % ALPHABET.length]).join(''); } while (rooms.has(c)); return c; }
function closeRoom(room) { for (const c of room.clients.values()) io.to(c.socketId).emit('c:hostgone', { closed: true }); rooms.delete(room.code); }

io.on('connection', socket => {
  // Host screen creates a room, or reclaims it after a reconnect with its token.
  socket.on('h:create', (msg, ack) => {
    if (typeof ack !== 'function') return;
    let room = msg && rooms.get(String(msg.room || '').toUpperCase());
    if (room && room.token === msg.token) {
      clearTimeout(room.hostGoneTimer); room.hostGoneTimer = null;
      room.hostId = socket.id;
    } else {
      // After a server restart the room is gone: give the host its old code back when free,
      // so phones that keep retrying that code can join again without a new QR.
      const wanted = String(msg?.room || '').toUpperCase();
      const code = /^[A-Z0-9]{4}$/.test(wanted) && !rooms.has(wanted) ? wanted : newCode();
      room = { code, token: crypto.randomBytes(16).toString('hex'), hostId: socket.id, clients: new Map(), hostGoneTimer: null };
      rooms.set(room.code, room);
    }
    socket.data.role = 'host'; socket.data.room = room.code;
    ack({ ok: true, room: room.code, token: room.token });
    for (const [sid, c] of room.clients) { socket.emit('h:open', { sid }); io.to(c.socketId).emit('c:rejoin'); }
    console.log(`[room ${room.code}] host connected (${room.clients.size} phones)`);
  });

  // Phone joins a room.
  socket.on('c:join', (msg, ack) => {
    if (typeof ack !== 'function') return;
    const room = rooms.get(String(msg?.room || '').toUpperCase().trim());
    if (!room) return ack({ ok: false, error: 'no-room' });
    const clientId = String(msg.clientId || '').slice(0, 80);
    const returning = [...room.clients.values()].some(c => clientId && c.clientId === clientId);
    if (!room.clients.has(socket.id) && !returning && room.clients.size >= MAX_PLAYERS) return ack({ ok: false, error: 'full' });
    // A phone that comes back with the same clientId replaces its old socket.
    for (const [sid, c] of room.clients) if (clientId && c.clientId === clientId && sid !== socket.id) {
      room.clients.delete(sid); io.to(room.hostId).emit('h:close', { sid }); io.sockets.sockets.get(c.socketId)?.disconnect(true);
    }
    room.clients.set(socket.id, { socketId: socket.id, clientId });
    socket.data.role = 'client'; socket.data.room = room.code;
    socket.join('room:' + room.code);
    ack({ ok: true, hostOnline: !room.hostGoneTimer });
    if (!room.hostGoneTimer) io.to(room.hostId).emit('h:open', { sid: socket.id });
  });

  // Data: phone -> host, host -> one phone, host -> every phone.
  socket.on('c:d', d => {
    const room = rooms.get(socket.data.room);
    if (!room || socket.data.role !== 'client' || room.hostGoneTimer) return;
    io.to(room.hostId).emit('h:d', { sid: socket.id, d });
  });
  socket.on('h:d', msg => {
    const room = rooms.get(socket.data.room);
    if (!room || room.hostId !== socket.id || !msg || !room.clients.has(msg.sid)) return;
    io.to(msg.sid).emit('c:d', msg.d);
  });
  socket.on('h:all', d => {
    const room = rooms.get(socket.data.room);
    if (!room || room.hostId !== socket.id) return;
    io.to('room:' + room.code).emit('c:d', d);
  });
  socket.on('h:kick', msg => {
    const room = rooms.get(socket.data.room);
    if (!room || room.hostId !== socket.id || !msg) return;
    const c = room.clients.get(msg.sid);
    if (c) { io.to(c.socketId).emit('c:kicked'); room.clients.delete(msg.sid); io.sockets.sockets.get(c.socketId)?.disconnect(true); }
  });

  socket.on('disconnect', () => {
    const room = rooms.get(socket.data.room);
    if (!room) return;
    if (socket.data.role === 'client' && room.clients.get(socket.id)) {
      room.clients.delete(socket.id);
      io.to(room.hostId).emit('h:close', { sid: socket.id });
    } else if (socket.data.role === 'host' && room.hostId === socket.id) {
      for (const c of room.clients.values()) io.to(c.socketId).emit('c:hostgone', { closed: false });
      room.hostGoneTimer = setTimeout(() => closeRoom(room), HOST_GRACE_MS);
      console.log(`[room ${room.code}] host disconnected — waiting ${HOST_GRACE_MS / 1000}s`);
    }
  });
});

server.listen(PORT, () => console.log(`Shark Bait server on :${PORT}`));
