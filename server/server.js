/**
 * Super Racers — Multiplayer relay server.
 *
 * A deliberately small authoritative-lite server:
 *   • rooms with 4-digit invite codes and a host
 *   • relays 20 Hz entity snapshots between clients
 *   • routes hit events to whichever client owns the target entity
 *   • tallies kills/deaths and declares the winner
 *   • also serves the built game (dist/) so one process can host everything
 *
 * Run:   node server/server.js          (defaults to port 3001)
 * Dev:   npm run dev  +  npm run server  (Vite proxies /socket.io to it)
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(__dirname, '..');
const DIST = join(ROOT, 'dist');
const PORT = process.env.PORT || 3001;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

/* ── tiny static file server for the built game ─────────────────────────── */
async function serveStatic(req, res) {
  try {
    const url = new URL(req.url, 'http://localhost');
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/') pathname = '/index.html';

    const target = normalize(join(DIST, pathname));
    if (!target.startsWith(DIST)) {
      res.writeHead(403).end('forbidden');
      return true;
    }

    const info = await stat(target).catch(() => null);
    if (!info || !info.isFile()) {
      // SPA fallback
      const index = join(DIST, 'index.html');
      const html = await readFile(index).catch(() => null);
      if (!html) return false;
      res.writeHead(200, { 'content-type': MIME['.html'] }).end(html);
      return true;
    }

    const body = await readFile(target);
    res.writeHead(200, {
      'content-type': MIME[extname(target)] || 'application/octet-stream',
      'cache-control': extname(target) === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
    }).end(body);
    return true;
  } catch {
    return false;
  }
}

/* ── state ─────────────────────────────────────────────────────────────── */
const rooms = new Map();          // code → room
const socketRoom = new Map();     // socketId → code

function makeCode() {
  let code;
  do {
    code = `SR-${Math.floor(1000 + Math.random() * 8999)}`;
  } while (rooms.has(code));
  return code;
}

function createRoom(hostSocket, player, config) {
  const code = makeCode();
  const room = {
    code,
    hostId: hostSocket.id,
    players: new Map(),
    entityOwner: new Map(),      // entityId → socketId
    entities: new Map(),         // entityId → entity meta
    score: new Map(),            // entityId → { kills, deaths, streak }
    config: sanitizeConfig(config),
    state: 'lobby',
    startedAt: 0,
  };
  rooms.set(code, room);
  return room;
}

function sanitizeConfig(config = {}) {
  return {
    mode: config.mode === 'koth' ? 'koth' : 'deathmatch',
    bots: Math.max(0, Math.min(8, parseInt(config.bots ?? 3, 10) || 0)),
    target: config.target === 'time' ? 'time' : Math.max(5, Math.min(100, parseInt(config.target ?? 15, 10) || 15)),
    arena: ['neon', 'reactor', 'skyway'].includes(config.arena) ? config.arena : 'neon',
  };
}

function roomSnapshot(room, viewerId) {
  const players = [...room.players.values()].map((p) => ({
    id: p.id,
    name: p.name,
    skin: p.skin,
    host: p.id === room.hostId,
    ready: !!p.ready,
    isBot: !!p.isBot,
    self: p.id === viewerId,
    score: room.score.get(p.id) || { kills: 0, deaths: 0, streak: 0 },
  }));
  return {
    code: room.code,
    hostId: room.hostId,
    config: room.config,
    state: room.state,
    players,
  };
}

function broadcastRoom(room) {
  for (const player of room.players.values()) {
    const socket = io.sockets.sockets.get(player.id);
    socket?.emit('room:update', roomSnapshot(room, player.id));
  }
}

function leaveRoom(socket) {
  const code = socketRoom.get(socket.id);
  if (!code) return;
  const room = rooms.get(code);
  socketRoom.delete(socket.id);
  if (!room) return;

  const owned = [...room.entityOwner.entries()].filter(([, owner]) => owner === socket.id).map(([id]) => id);
  owned.forEach((id) => {
    room.entityOwner.delete(id);
    room.entities.delete(id);
    room.score.delete(id);
  });
  room.players.delete(socket.id);
  socket.leave(code);

  if (room.players.size === 0) {
    rooms.delete(code);
    return;
  }
  if (room.hostId === socket.id) {
    room.hostId = [...room.players.keys()][0];
  }
  io.to(code).emit('player:left', { id: socket.id, entityIds: owned });
  broadcastRoom(room);
}

/* ── http + socket.io ──────────────────────────────────────────────────── */
const httpServer = createServer(async (req, res) => {
  if (req.url === '/health' || req.url?.startsWith('/health')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      rooms: rooms.size,
      players: [...rooms.values()].reduce((n, r) => n + r.players.size, 0),
      uptime: Math.round(process.uptime()),
    }));
    return;
  }
  if (req.url?.startsWith('/rooms')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify([...rooms.values()].map((r) => ({
      code: r.code, players: r.players.size, state: r.state, config: r.config,
    }))));
    return;
  }
  const served = await serveStatic(req, res);
  if (!served) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><meta charset="utf-8"><title>Super Racers server</title>
      <body style="font-family:system-ui;background:#05010f;color:#9fb4d6;padding:40px">
      <h1 style="color:#22e1ff">SUPER RACERS relay is live 🏁</h1>
      <p>Socket.IO is listening on this port. Run <code>npm run build</code> and restart to serve the game from here.</p>
      <p>Rooms open: <b>${rooms.size}</b></p></body>`);
  }
});

const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingInterval: 12000,
  pingTimeout: 10000,
});

io.on('connection', (socket) => {
  socket.on('net:ping', (t) => socket.emit('net:pong', t));

  /* ── rooms ── */
  socket.on('room:create', ({ player = {}, config = {} } = {}) => {
    leaveRoom(socket);
    const room = createRoom(socket, player, config);
    room.players.set(socket.id, {
      id: socket.id,
      name: String(player.name || 'Racer').slice(0, 14),
      skin: String(player.skin || 'comet'),
      ready: true,
    });
    socketRoom.set(socket.id, room.code);
    socket.join(room.code);
    socket.emit('room:update', roomSnapshot(room, socket.id));
  });

  socket.on('room:join', ({ code, player = {} } = {}) => {
    const room = rooms.get(String(code || '').toUpperCase());
    if (!room) {
      socket.emit('server:error', { message: `Room ${code} not found`, code: 'no-room' });
      return;
    }
    if (room.players.size >= 8) {
      socket.emit('server:error', { message: `Room ${room.code} is full (8 racers max)`, code: 'full' });
      return;
    }
    if (room.state === 'playing') {
      socket.emit('server:error', { message: 'That match already started', code: 'in-progress' });
      return;
    }
    leaveRoom(socket);
    room.players.set(socket.id, {
      id: socket.id,
      name: String(player.name || 'Racer').slice(0, 14),
      skin: String(player.skin || 'comet'),
      ready: true,
    });
    socketRoom.set(socket.id, room.code);
    socket.join(room.code);
    broadcastRoom(room);
  });

  socket.on('room:config', (config = {}) => {
    const room = rooms.get(socketRoom.get(socket.id));
    if (!room || room.hostId !== socket.id) return;
    room.config = sanitizeConfig({ ...room.config, ...config });
    broadcastRoom(room);
  });

  socket.on('room:leave', () => leaveRoom(socket));

  /* ── match start (host) ── */
  socket.on('match:start', ({ config = {}, entities = [] } = {}) => {
    const room = rooms.get(socketRoom.get(socket.id));
    if (!room || room.hostId !== socket.id) return;
    room.config = sanitizeConfig({ ...room.config, ...config });
    room.state = 'playing';
    room.startedAt = Date.now();
    room.entities.clear();
    room.entityOwner.clear();
    room.score.clear();

    // every player owns at least their own entity
    for (const p of room.players.values()) {
      const own = entities.find((e) => e.ownerId === p.id || (e.id === p.id));
      const id = own?.id || p.id;
      room.entities.set(id, { id, ownerId: p.id, name: own?.name || p.name, skin: own?.skin || p.skin, isBot: !!own?.isBot });
      room.entityOwner.set(id, p.id);
      room.score.set(id, { kills: 0, deaths: 0, streak: 0 });
    }
    // extra (bot) entities declared by the host
    for (const e of entities) {
      if (room.entities.has(e.id)) continue;
      if (e.ownerId !== socket.id) continue;
      room.entities.set(e.id, { id: e.id, ownerId: e.ownerId, name: e.name, skin: e.skin, isBot: true });
      room.entityOwner.set(e.id, e.ownerId);
      room.score.set(e.id, { kills: 0, deaths: 0, streak: 0 });
    }

    const payload = {
      config: room.config,
      startAt: Date.now() + 1500,
      entities: [...room.entities.values()],
      hostId: room.hostId,
    };
    io.to(room.code).emit('match:start', payload);
    broadcastRoom(room);
  });

  /* ── snapshot relay ── */
  socket.on('net:state', (payload = {}) => {
    const code = socketRoom.get(socket.id);
    if (!code) return;
    socket.to(code).emit('net:snapshot', payload);
  });

  /* ── hit routing → the client that owns the target applies it ── */
  socket.on('net:hit', ({ target, dmg = 0, kind = 'rocket', from = null } = {}) => {
    const code = socketRoom.get(socket.id);
    const room = rooms.get(code);
    if (!room) return;
    const ownerId = room.entityOwner.get(target);
    const clamped = Math.max(0, Math.min(60, Number(dmg) || 0));
    if (ownerId && ownerId !== socket.id) {
      io.to(ownerId).emit('net:hit', { from, target, dmg: clamped, kind });
    }
    // mirror to everyone else purely for visual feedback (spark bursts)
    socket.to(room.code).emit('net:fx', { type: 'hit', target, kind });
  });

  socket.on('net:crate', (payload = {}) => {
    const code = socketRoom.get(socket.id);
    if (!code) return;
    socket.to(code).emit('net:crate', payload);
  });

  socket.on('net:ability', (payload = {}) => {
    const code = socketRoom.get(socket.id);
    if (!code) return;
    socket.to(code).emit('net:ability', payload);
  });

  /* ── death / scoring ── */
  socket.on('net:death', ({ victim, killer, weapon = 'crash' } = {}) => {
    const room = rooms.get(socketRoom.get(socket.id));
    if (!room) return;

    const v = room.score.get(victim) || { kills: 0, deaths: 0, streak: 0 };
    v.deaths += 1;
    v.streak = 0;
    room.score.set(victim, v);

    let killerMeta = null;
    if (killer && killer !== victim) {
      const k = room.score.get(killer) || { kills: 0, deaths: 0, streak: 0 };
      k.kills += 1;
      k.streak += 1;
      room.score.set(killer, k);
      killerMeta = room.entities.get(killer) || null;
    }

    io.to(room.code).emit('net:kill', {
      killer: killerMeta ? { id: killerMeta.id, name: killerMeta.name } : null,
      victim: { id: victim, name: room.entities.get(victim)?.name || 'Racer' },
      weapon,
      scores: [...room.score.entries()].map(([id, s]) => ({ id, name: room.entities.get(id)?.name, ...s })),
    });

    // win condition (kill target only; time-mode ends are client driven)
    const target = room.config.target;
    if (typeof target === 'number' && killerMeta) {
      const killerScore = room.score.get(killer);
      if (killerScore && killerScore.kills >= target) {
        room.state = 'lobby';
        io.to(room.code).emit('match:end', {
          reason: 'target-reached',
          winner: { id: killerMeta.id, name: killerMeta.name },
          standings: [...room.score.entries()]
            .map(([id, s]) => ({ id, name: room.entities.get(id)?.name, ...s }))
            .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths),
        });
      }
    }
  });

  socket.on('disconnect', () => leaveRoom(socket));
});

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  🏁  SUPER RACERS relay listening on http://0.0.0.0:${PORT}`);
  console.log(`      health:  http://localhost:${PORT}/health`);
  console.log(`      rooms:   http://localhost:${PORT}/rooms\n`);
});

export { io, rooms };
