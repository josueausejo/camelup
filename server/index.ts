import express from 'express';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Server, type Socket } from 'socket.io';
import { applyAction, createGame, viewFor, RuleError, MAX_PLAYERS, MIN_PLAYERS, type GameState } from '../shared/game';
import { CHAT_HISTORY, CHAT_MAX_LENGTH, EMOJIS, type ChatMessage } from '../shared/chat';
import type { ClientToServer, LobbyPlayer, RoomView, ServerToClient } from '../shared/protocol';

// En desarrollo el puerto es fijo (Vite redirige /socket.io al 3210); en producción se respeta PORT.
const PORT = process.argv.includes('--dev') ? 3210 : Number(process.env.PORT ?? 3210);

interface Room {
  code: string;
  hostId: string;
  players: LobbyPlayer[];
  game: GameState | null;
  cleanup?: NodeJS.Timeout;
  chat: ChatMessage[];
  chatSeq: number;
}

// Una sala sin nadie conectado se conserva un rato para sobrevivir a recargas y cortes breves.
const EMPTY_ROOM_TTL = 10 * 60 * 1000;

type Client = Socket<ClientToServer, ServerToClient> & { data: { playerId?: string; code?: string; lastChat?: number; lastFling?: number } };

const rooms = new Map<string, Room>();

const app = express();
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
if (existsSync(dist)) app.use(express.static(dist));

const http = createServer(app);
const io = new Server<ClientToServer, ServerToClient>(http, { cors: { origin: '*' } });

function newCode(): string {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code: string;
  do code = Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join('');
  while (rooms.has(code));
  return code;
}

const cleanName = (name: unknown) => String(name ?? '').trim().slice(0, 16) || 'Jugador';

function broadcast(room: Room) {
  for (const socket of io.sockets.sockets.values() as IterableIterator<Client>) {
    const id = socket.data.playerId;
    if (socket.data.code !== room.code || !id) continue;
    const view: RoomView = {
      code: room.code,
      hostId: room.hostId,
      players: room.players,
      game: room.game ? viewFor(room.game, id) : null,
    };
    socket.emit('room', view);
  }
}

function setConnected(room: Room, playerId: string, connected: boolean) {
  const lp = room.players.find((p) => p.id === playerId);
  if (lp) {
    lp.connected = connected;
    if (!connected) lp.tutorial = false;
  }
  const gp = room.game?.players.find((p) => p.id === playerId);
  if (gp) gp.connected = connected;
}

function leave(socket: Client) {
  const { code, playerId } = socket.data;
  socket.data.code = undefined;
  const room = code ? rooms.get(code) : undefined;
  if (!room || !playerId) return;
  if (room.game) {
    // Con partida (en curso o en resultados) el asiento se conserva para poder volver.
    setConnected(room, playerId, false);
  } else {
    room.players = room.players.filter((p) => p.id !== playerId);
    if (room.hostId === playerId && room.players[0]) room.hostId = room.players[0].id;
  }
  if (!room.players.some((p) => p.connected)) {
    clearTimeout(room.cleanup);
    room.cleanup = setTimeout(() => rooms.delete(room.code), EMPTY_ROOM_TTL);
  } else broadcast(room);
}

/**
 * La conexión nueva de un jugador sustituye a la anterior. Al recargar, la conexión vieja
 * puede seguir abierta un instante; así su desconexión posterior ya no afecta a la sala.
 */
function takeOver(playerId: string, current: Client) {
  for (const s of io.sockets.sockets.values() as IterableIterator<Client>)
    if (s !== current && s.data.playerId === playerId && s.data.code) {
      s.data.code = undefined;
      s.emit('room', null);
    }
}

io.on('connection', (socket: Client) => {
  socket.on('createRoom', ({ playerId, name }, ack) => {
    if (typeof playerId !== 'string' || !playerId) return ack({ error: 'Identificador no válido.' });
    leave(socket);
    const room: Room = { code: newCode(), hostId: playerId, players: [{ id: playerId, name: cleanName(name), connected: true }], game: null, chat: [], chatSeq: 0 };
    rooms.set(room.code, room);
    socket.data = { playerId, code: room.code };
    socket.emit('chatHistory', room.chat);
    ack({ code: room.code });
    broadcast(room);
  });

  socket.on('joinRoom', ({ playerId, name, code }, ack) => {
    const room = rooms.get(String(code ?? '').toUpperCase().trim());
    if (!room) return ack({ error: 'No existe ninguna sala con ese código.' });
    if (typeof playerId !== 'string' || !playerId) return ack({ error: 'Identificador no válido.' });
    takeOver(playerId, socket);
    leave(socket);
    const existing = room.players.find((p) => p.id === playerId);
    if (existing) {
      setConnected(room, playerId, true);
      existing.tutorial = false; // una recarga cierra el tutorial
    } else {
      if (room.game) return ack({ error: 'La partida ya ha empezado.' });
      if (room.players.length >= MAX_PLAYERS) return ack({ error: 'La sala está llena (máximo 4).' });
      room.players.push({ id: playerId, name: cleanName(name), connected: true });
    }
    clearTimeout(room.cleanup);
    if (!room.players.some((p) => p.id === room.hostId && p.connected)) room.hostId = playerId;
    socket.data = { playerId, code: room.code };
    socket.emit('chatHistory', room.chat);
    ack({ code: room.code });
    broadcast(room);
  });

  socket.on('leaveRoom', () => {
    leave(socket);
    socket.emit('room', null);
  });

  socket.on('startGame', (ack) => {
    const room = rooms.get(socket.data.code ?? '');
    if (!room) return ack({ error: 'No estás en ninguna sala.' });
    if (room.hostId !== socket.data.playerId) return ack({ error: 'Solo el anfitrión puede empezar.' });
    if (room.game?.phase === 'playing') return ack({ error: 'La partida ya está en marcha.' });
    const players = room.players.filter((p) => p.connected);
    if (players.length < MIN_PLAYERS) return ack({ error: 'Se necesitan al menos 2 jugadores.' });
    room.players = players;
    room.game = createGame(players);
    ack({});
    broadcast(room);
  });

  socket.on('playAgain', () => {
    const room = rooms.get(socket.data.code ?? '');
    if (!room || room.hostId !== socket.data.playerId || room.game?.phase !== 'finished') return;
    room.game = null;
    room.players = room.players.filter((p) => p.connected);
    broadcast(room);
  });

  socket.on('action', (action, ack) => {
    const room = rooms.get(socket.data.code ?? '');
    if (!room?.game) return ack({ error: 'No hay partida en curso.' });
    try {
      applyAction(room.game, socket.data.playerId!, action);
      ack({});
      broadcast(room);
    } catch (e) {
      ack({ error: e instanceof RuleError ? e.message : 'Acción no válida.' });
      if (!(e instanceof RuleError)) console.error(e);
    }
  });

  socket.on('chat', (data) => {
    const room = rooms.get(socket.data.code ?? '');
    const seat = room ? room.players.findIndex((p) => p.id === socket.data.playerId) : -1;
    if (!room || seat < 0) return;
    // como mucho un mensaje cada 350 ms por conexión
    const now = Date.now();
    if (now - (socket.data.lastChat ?? 0) < 350) return;
    socket.data.lastChat = now;
    const text = String(data?.text ?? '').replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX_LENGTH);
    if (!text) return;
    const message: ChatMessage = {
      id: ++room.chatSeq,
      playerId: room.players[seat].id,
      name: room.players[seat].name,
      seat,
      text,
      emoji: !!data?.emoji && EMOJIS.some((e) => e.char === text),
      at: now,
    };
    room.chat.push(message);
    if (room.chat.length > CHAT_HISTORY) room.chat.shift();
    for (const s of io.sockets.sockets.values() as IterableIterator<Client>)
      if (s.data.code === room.code) s.emit('chat', message);
  });

  // Aviso informativo: el jugador está viendo el tutorial (los demás lo ven junto a su nombre).
  socket.on('tutorial', (open) => {
    const room = rooms.get(socket.data.code ?? '');
    const p = room?.players.find((x) => x.id === socket.data.playerId);
    if (!room || !p || p.tutorial === !!open) return;
    p.tutorial = !!open;
    broadcast(room);
  });

  // Lanzamientos decorativos del público: solo se reenvían a los demás jugadores de la sala.
  socket.on('fling', (data) => {
    const room = rooms.get(socket.data.code ?? '');
    if (!room) return;
    const now = Date.now();
    if (now - (socket.data.lastFling ?? 0) < 200) return;
    socket.data.lastFling = now;
    const vec = (v: unknown, limit: number) =>
      Array.isArray(v) && v.length === 3 && v.every((n) => Number.isFinite(n))
        ? (v.map((n: number) => Math.max(-limit, Math.min(limit, n))) as [number, number, number])
        : null;
    const pos = vec(data?.pos, 50);
    const vel = vec(data?.vel, 30);
    const spin = vec(data?.spin, 40);
    const seat = Number(data?.seat);
    if (!pos || !vel || !spin || !Number.isInteger(seat) || seat < 0 || seat > 500) return;
    for (const s of io.sockets.sockets.values() as IterableIterator<Client>)
      if (s !== socket && s.data.code === room.code) s.emit('fling', { seat, pos, vel, spin });
  });

  socket.on('disconnect', () => leave(socket));
});

http.listen(PORT, () => {
  console.log(`\n🐪 Camel Up online en http://localhost:${PORT}`);
  for (const nets of Object.values(networkInterfaces()))
    for (const net of nets ?? [])
      if (net.family === 'IPv4' && !net.internal) console.log(`   En tu red local: http://${net.address}:${PORT}`);
  if (!existsSync(dist)) console.log('   (modo desarrollo: abre el cliente de Vite en el puerto 5173)');
});
