import { io, type Socket } from 'socket.io-client';
import {
  CAMEL_NAMES,
  RACING,
  TRACK_LENGTH,
  canPlaceSpectator,
  type Action,
  type FinalPile,
  type GameState,
  type Player,
  type RacingColor,
  type SpectatorSide,
} from '../../shared/game';
import type { ClientToServer, RoomView, ServerToClient } from '../../shared/protocol';
import { Chat } from './chat';
import { Tutorial } from './tutorial';
import './tutorial/tutorial.css';
import { BoardScene, type Pick, type Quality } from './scene/board';
import { CAMEL_COLORS, PLAYER_COLORS } from './scene/models';

// ---------- Identidad local ----------

const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* sin almacenamiento */
    }
  },
};

// sessionStorage: cada pestaña es un jugador distinto (útil para probar en un mismo PC)
let playerId = sessionStorage.getItem('camelup.id');
if (!playerId) {
  playerId = crypto.randomUUID();
  sessionStorage.setItem('camelup.id', playerId);
}
const me = playerId;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// ---------- Conexión ----------

const socket: Socket<ServerToClient, ClientToServer> = io();
let quality: Quality = store.get('camelup.quality') === 'low' ? 'low' : 'high';
const scene = new BoardScene($('board'), quality);
if (import.meta.env.DEV) Object.assign(window, { scene });

// lanzamientos decorativos del público: se envían y reciben, pero no tocan la partida
scene.onFling = (data) => room && socket.emit('fling', data);
socket.on('fling', (data) => scene.remoteFling(data));

// tutorial: los demás jugadores ven que lo estás leyendo
const tutorial = new Tutorial((open) => room && socket.emit('tutorial', open));
$('help').onclick = () => tutorial.open();
$('intro-skip').onclick = () => scene.skipIntro();

const chat = new Chat(socket, me);
let unread = 0;
chat.onUnread = (n) => {
  unread = n;
  for (const badge of document.querySelectorAll<HTMLElement>('.chat-toggle .badge')) {
    badge.hidden = n === 0;
    badge.textContent = n > 9 ? '9+' : String(n);
    badge.classList.remove('pop');
    void badge.offsetWidth;
    badge.classList.add('pop');
  }
};
$('chat-toggle').onclick = () => chat.toggle();

let room: RoomView | null = null;
let game: GameState | null = null; // último estado ya mostrado (tras animaciones)
let queue = Promise.resolve();
let busy = false;
let mode: { kind: 'spectator'; side: SpectatorSide } | { kind: 'final'; color: RacingColor } | null = null;
let shownStage = 0;
let shownFinal = false;
const lastMoney = new Map<string, number>();
let wasMyTurn = false;

socket.on('connect', () => {
  const code = sessionStorage.getItem('camelup.room');
  if (code)
    socket.emit('joinRoom', { playerId: me, name: myName(), code }, (res) => {
      if (res.error) sessionStorage.removeItem('camelup.room');
    });
});

socket.on('room', (r) => {
  room = r;
  chat.setRoom(r);
  if (r) sessionStorage.setItem('camelup.room', r.code);
  else sessionStorage.removeItem('camelup.room');

  const next = r?.game ?? null;
  if (!next) {
    game = null;
    shownStage = 0;
    shownFinal = false;
    closeModal();
    renderLobby();
    return;
  }
  queue = queue.then(async () => {
    const first = !game;
    if (first) {
      shownStage = next.lastStage?.stage ?? 0;
      shownFinal = next.phase === 'finished';
    }
    // partida recién empezada (nadie ha jugado aún): primero el sorteo de salida con los dados
    const intro = first && next.eventSeq === 0 && next.phase === 'playing';
    if (intro) {
      $('lobby').hidden = true;
      $('intro').hidden = false;
    }
    await scene.apply(next, { intro });
    $('intro').hidden = true;
    game = next;
    mode = null;
    renderHud();
    // después del sorteo se abre el tutorial, salvo que se haya desactivado
    if (intro && !Tutorial.dismissed() && !tutorial.isOpen) tutorial.open();
    if (next.lastStage && next.lastStage.stage > shownStage) {
      shownStage = next.lastStage.stage;
      if (next.phase === 'playing') showStageSummary(next);
    }
    if (next.phase === 'finished' && !shownFinal) {
      shownFinal = true;
      showFinal(next);
    }
  });
});

function myName() {
  return store.get('camelup.name') ?? '';
}

function toast(msg: string, info = false) {
  const t = $('toast');
  t.textContent = msg;
  t.className = info ? 'toast info' : 'toast';
  t.hidden = false;
  clearTimeout((t as any)._timer);
  (t as any)._timer = setTimeout(() => (t.hidden = true), 2800);
}

function send(action: Action) {
  if (busy) return;
  busy = true;
  renderActions();
  socket.emit('action', action, (res) => {
    busy = false;
    if (res.error) {
      toast(res.error);
      renderActions();
    }
  });
}

// ---------- Lobby ----------

function renderLobby() {
  $('hud').hidden = true;
  $('lobby').hidden = false;
  scene.setInteraction(null);
  const el = $('lobby-content');

  if (!room) {
    const preset = new URLSearchParams(location.search).get('sala') ?? '';
    el.innerHTML = `
      <label for="name">Tu nombre</label>
      <input id="name" maxlength="16" placeholder="Ej. Martina" value="${esc(myName())}" />
      <div class="row"><button class="primary" id="create" style="flex:1">Crear sala</button></div>
      <div class="divider">— o únete con un código —</div>
      <div class="row">
        <input id="code" maxlength="4" placeholder="ABCD" value="${esc(preset)}" style="text-transform:uppercase;text-align:center;letter-spacing:4px;font-weight:800" />
        <button id="join">Unirse</button>
      </div>`;
    const name = () => {
      const v = $<HTMLInputElement>('name').value.trim();
      if (!v) {
        toast('Escribe tu nombre primero.');
        $('name').focus();
        return null;
      }
      store.set('camelup.name', v);
      return v;
    };
    $('create').onclick = () => {
      const n = name();
      if (n) socket.emit('createRoom', { playerId: me, name: n }, (res) => res.error && toast(res.error));
    };
    const join = () => {
      const n = name();
      const code = $<HTMLInputElement>('code').value.trim().toUpperCase();
      if (!n) return;
      if (code.length !== 4) return toast('El código tiene 4 letras.');
      socket.emit('joinRoom', { playerId: me, name: n, code }, (res) => res.error && toast(res.error));
    };
    $('join').onclick = join;
    $('code').onkeydown = (e) => e.key === 'Enter' && join();
    if (!myName()) $('name').focus();
    return;
  }

  const host = room.hostId === me;
  const link = `${location.origin}${location.pathname}?sala=${room.code}`;
  el.innerHTML = `
    <div class="hint">Código de la sala</div>
    <div class="code">${room.code}</div>
    <button class="ghost" id="copy">Copiar enlace de invitación</button>
    <ul class="lobby-players">
      ${room.players
        .map(
          (p, i) => `<li><span class="swatch" style="background:${PLAYER_COLORS[i]}"></span>${esc(p.name)}${
            p.id === me ? ' (tú)' : ''
          }${p.id === room!.hostId ? ' 👑' : ''}</li>`,
        )
        .join('')}
      ${Array.from({ length: 4 - room.players.length }, () => `<li style="opacity:.45">Esperando jugador…</li>`).join('')}
    </ul>
    ${
      host
        ? `<button class="primary" id="start" ${room.players.length < 2 ? 'disabled' : ''}>Empezar la carrera</button>
           <p class="hint">${room.players.length < 2 ? 'Se necesitan al menos 2 jugadores.' : 'Puedes empezar ya o esperar hasta 4 jugadores.'}</p>`
        : `<p class="hint">Esperando a que el anfitrión empiece la partida…</p>`
    }
    <div class="row" style="justify-content:center;margin-top:8px">
      <button class="ghost chat-toggle" id="lobby-chat">💬 Chat de la sala<span class="badge" ${unread ? '' : 'hidden'}>${unread}</span></button>
      <button class="ghost" id="leave-lobby">Salir</button>
    </div>`;
  $('lobby-chat').onclick = () => chat.toggle();
  $('copy').onclick = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast('Enlace copiado', true);
    } catch {
      toast(link, true);
    }
  };
  if (host) $('start').onclick = () => socket.emit('startGame', (res) => res.error && toast(res.error));
  $('leave-lobby').onclick = () => socket.emit('leaveRoom');
}

// ---------- HUD ----------

const camelChip = (c: RacingColor, text: string | number = '') =>
  `<span class="chip" style="background:${CAMEL_COLORS[c]}">${text}</span>`;

function renderHud() {
  if (!game || !room) return;
  $('lobby').hidden = true;
  $('hud').hidden = false;
  const current = game.players[game.current];

  $('status').innerHTML = `
    <span class="pill room">Sala ${room.code}</span>
    <span class="pill">Etapa ${game.stage}</span>
    <span class="pill">Pirámide: ${game.pyramidLeft} fichas</span>
    ${
      game.phase === 'playing'
        ? `<span class="pill ${current.id === me ? 'turn' : ''}">${current.id === me ? '¡Tu turno!' : `Turno de ${esc(current.name)}`}</span>`
        : `<span class="pill turn">Carrera terminada</span>`
    }`;

  $('players').innerHTML = game.players.map((p) => playerCard(p)).join('');
  for (const p of game.players) lastMoney.set(p.id, p.money);

  const myTurn = game.phase === 'playing' && current.id === me;
  if (myTurn && !wasMyTurn) showTurnBanner();
  wasMyTurn = myTurn;
  $('log').innerHTML = [...game.log]
    .reverse()
    .slice(0, 30)
    .map((l) => `<li>${esc(l)}</li>`)
    .join('');
  renderActions();
}

const readingTutorial = (id: string) => id !== me && !!room?.players.find((p) => p.id === id)?.tutorial;

function playerCard(p: Player) {
  const g = game!;
  const isCurrent = g.phase === 'playing' && g.players[g.current].id === p.id;
  const spectator = p.spectator
    ? `<span class="chip plain">Público ${p.spectator.side === 'cheer' ? '+1' : '−1'} en ${p.spectator.space}</span>`
    : '';
  const before = lastMoney.get(p.id);
  const delta = before === undefined ? 0 : p.money - before;
  const deltaHtml = delta ? `<span class="delta ${delta > 0 ? 'up' : 'down'}">${delta > 0 ? '+' : ''}${delta}</span>` : '';
  return `<div class="player ${isCurrent ? 'current' : ''}" data-player="${esc(p.id)}" style="--pc:${PLAYER_COLORS[p.seat]}">
    <div class="head">
      <span class="swatch" style="background:${PLAYER_COLORS[p.seat]}"></span>
      <span class="name">${esc(p.name)}${p.id === me ? ' (tú)' : ''}</span>
      ${g.startPlayer === p.seat && g.phase === 'playing' ? '<span title="Jugador inicial de la etapa">🦁</span>' : ''}
      <span class="money ${delta ? 'bump' : ''}">${p.money} LE${deltaHtml}</span>
    </div>
    <div class="meta">
      ${p.bets.map((b) => camelChip(b.color, b.value)).join('')}
      ${p.pyramidTickets ? `<span class="chip plain" title="Fichas de pirámide">🔺×${p.pyramidTickets}</span>` : ''}
      ${spectator}
      <span class="chip plain" title="Cartas de apuesta final en la mano">🂠 ${p.handCount}</span>
      ${p.connected ? '' : '<span class="offline">desconectado</span>'}
      ${readingTutorial(p.id) ? '<span class="chip plain reading">📖 viendo el tutorial</span>' : ''}
    </div>
  </div>`;
}

function validSpectatorSpaces(g: GameState): number[] {
  const mine = g.players.find((p) => p.id === me);
  const out: number[] = [];
  for (let s = 2; s <= TRACK_LENGTH; s++)
    if (canPlaceSpectator(g, me, s) && mine?.spectator?.space !== s) out.push(s);
  return out;
}

function renderActions() {
  const g = game;
  const el = $('actions');
  if (!g) return;
  const mine = g.players.find((p) => p.id === me);
  const myTurn = g.phase === 'playing' && g.players[g.current].id === me && !busy;

  const hand = mine
    ? `<div class="my-hand"><b>Tus cartas de apuesta final:</b> ${
        mine.hand.length ? mine.hand.map((c) => camelChip(c, '🂠')).join('') : 'ninguna'
      }${mine.hand.length < 5 ? ` · <span class="hint">apostadas: ${apostadas(g)}</span>` : ''}</div>`
    : '';

  if (g.phase === 'finished') {
    el.innerHTML = `<div class="waiting">La carrera ha terminado. <button id="show-final">Ver resultados</button></div>`;
    $('show-final').onclick = () => showFinal(g);
    scene.setInteraction(null);
    return;
  }

  if (!myTurn) {
    const who = g.players[g.current];
    const note = readingTutorial(who.id) ? ' (está viendo el tutorial 📖)' : '';
    el.innerHTML = `<div class="waiting">${busy ? 'Enviando…' : `Esperando a ${esc(who.name)}…${note}`}</div>${hand}`;
    scene.setInteraction(null);
    return;
  }

  const spectatorSpaces = validSpectatorSpaces(g);
  el.innerHTML = `
    <div class="action-grid">
      <div class="action">
        <h4><span class="n">1</span>Apuesta de etapa</h4>
        <div class="colors">${RACING.map((c) => {
          const top = g.betStacks[c].at(-1);
          return `<button data-bet="${c}" style="background:${CAMEL_COLORS[c]}" ${top ? '' : 'disabled'} title="Camello ${CAMEL_NAMES[c]}">${top ?? '—'}</button>`;
        }).join('')}</div>
        <p>¿Quién liderará al acabar la etapa?</p>
      </div>
      <div class="action">
        <h4><span class="n">2</span>Público</h4>
        <div class="btn-row">
          <button data-side="cheer" class="${mode?.kind === 'spectator' && mode.side === 'cheer' ? 'selected' : ''}" style="background:#3d8a3d" ${spectatorSpaces.length ? '' : 'disabled'}>Animar +1</button>
          <button data-side="boo" class="${mode?.kind === 'spectator' && mode.side === 'boo' ? 'selected' : ''}" style="background:#b3261e" ${spectatorSpaces.length ? '' : 'disabled'}>Abuchear −1</button>
        </div>
        ${
          mode?.kind === 'spectator'
            ? '<p class="keep">👉 Haz clic en una casilla resaltada del tablero.</p>'
            : `<p>${mine?.spectator ? 'Mueve tu público a otra casilla.' : 'Coloca tu público en la pista.'}</p>`
        }
      </div>
      <div class="action">
        <h4><span class="n">3</span>Pirámide</h4>
        <button class="primary" id="pyramid">Agitar la pirámide</button>
        <p>Mueve un camello y gana 1 LE al final de la etapa. También puedes hacer clic en la pirámide.</p>
      </div>
      <div class="action">
        <h4><span class="n">4</span>Apuesta final</h4>
        <div class="colors">${(mine?.hand ?? [])
          .map(
            (c) =>
              `<button data-final="${c}" class="${mode?.kind === 'final' && mode.color === c ? 'selected' : ''}" style="background:${CAMEL_COLORS[c]}" title="Camello ${CAMEL_NAMES[c]}">🂠</button>`,
          )
          .join('') || '<p>No te quedan cartas.</p>'}</div>
        ${
          mode?.kind === 'final'
            ? `<div class="btn-row"><button data-pile="winner">Ganador</button><button data-pile="loser">Perdedor</button></div>`
            : '<p>Elige un camello y apuesta en secreto.</p>'
        }
      </div>
    </div>${hand}`;

  el.querySelectorAll<HTMLButtonElement>('[data-bet]').forEach(
    (b) => (b.onclick = () => send({ type: 'takeBet', color: b.dataset.bet as RacingColor })),
  );
  el.querySelectorAll<HTMLButtonElement>('[data-side]').forEach(
    (b) =>
      (b.onclick = () => {
        const side = b.dataset.side as SpectatorSide;
        mode = mode?.kind === 'spectator' && mode.side === side ? null : { kind: 'spectator', side };
        renderActions();
      }),
  );
  el.querySelectorAll<HTMLButtonElement>('[data-final]').forEach(
    (b) =>
      (b.onclick = () => {
        const color = b.dataset.final as RacingColor;
        mode = mode?.kind === 'final' && mode.color === color ? null : { kind: 'final', color };
        renderActions();
      }),
  );
  el.querySelectorAll<HTMLButtonElement>('[data-pile]').forEach(
    (b) =>
      (b.onclick = () => {
        if (mode?.kind === 'final') send({ type: 'finalBet', pile: b.dataset.pile as FinalPile, color: mode.color });
      }),
  );
  $('pyramid').onclick = () => send({ type: 'pyramid' });

  scene.setInteraction({
    spaces: mode?.kind === 'spectator' ? spectatorSpaces : [],
    bets: true,
    pyramid: true,
    color: PLAYER_COLORS[mine?.seat ?? 0],
  });
}

function apostadas(g: GameState) {
  const mineCards = [...g.winnerPile.map((c) => ({ ...c, pile: 'G' })), ...g.loserPile.map((c) => ({ ...c, pile: 'P' }))]
    .filter((c) => c.playerId === me && c.color);
  return mineCards.map((c) => `${camelChip(c.color!, c.pile)}`).join(' ');
}

scene.onPick = (p: Pick) => {
  if (!game || busy) return;
  if (p.kind === 'pyramid') send({ type: 'pyramid' });
  else if (p.kind === 'bet') send({ type: 'takeBet', color: p.color });
  else if (p.kind === 'space' && mode?.kind === 'spectator') send({ type: 'placeSpectator', space: p.space, side: mode.side });
};

// ---------- Modales ----------

function openModal(html: string) {
  $('modal-content').innerHTML = html;
  $('modal').hidden = false;
}
function closeModal() {
  $('modal').hidden = true;
}
$('modal').onclick = (e) => {
  if (e.target === $('modal')) closeModal();
};

const signed = (n: number) => `<span class="${n > 0 ? 'pos' : n < 0 ? 'neg' : ''}">${n > 0 ? '+' : ''}${n}</span>`;
const nameOf = (g: GameState, id: string) => esc(g.players.find((p) => p.id === id)?.name ?? '?');

function stageTable(g: GameState) {
  const s = g.lastStage!;
  return `<p>Lidera ${camelChip(s.leader, '1º')} <b>${CAMEL_NAMES[s.leader]}</b> · segundo ${camelChip(s.second, '2º')} <b>${CAMEL_NAMES[s.second]}</b></p>
    <table>
      <tr><th>Jugador</th><th>Fichas</th><th class="num">Total</th></tr>
      ${s.lines
        .map(
          (l) => `<tr><td><b>${nameOf(g, l.playerId)}</b></td><td>${
            l.items.map((i) => `${esc(i.label)}: ${signed(i.amount)}`).join('<br>') || '—'
          }</td><td class="num">${signed(l.total)}</td></tr>`,
        )
        .join('')}
    </table>`;
}

function showStageSummary(g: GameState) {
  openModal(`<h2>Fin de la etapa ${g.lastStage!.stage}</h2>${stageTable(g)}
    <div class="modal-actions"><button class="primary" id="close-modal">Continuar</button></div>`);
  $('close-modal').onclick = closeModal;
}

function showFinal(g: GameState) {
  const f = g.final!;
  const pileRows = (pile: typeof f.winnerPile) =>
    pile.length
      ? pile
          .map((c, i) => `<tr><td>${i + 1}º</td><td>${nameOf(g, c.playerId)}</td><td>${camelChip(c.color, '')} ${CAMEL_NAMES[c.color]}</td><td class="num">${signed(c.amount)}</td></tr>`)
          .join('')
      : '<tr><td colspan="4">Nadie apostó aquí.</td></tr>';
  const host = room?.hostId === me;
  openModal(`<h2>¡Fin de la carrera!</h2>
    <div class="champion">🏆 ${f.champions.map((id) => nameOf(g, id)).join(' y ')}</div>
    <table>
      ${f.ranking.map((r, i) => `<tr><td>${i + 1}º</td><td><b>${nameOf(g, r.playerId)}</b></td><td class="num">${r.money} LE</td></tr>`).join('')}
    </table>
    <h3>Última etapa</h3>${stageTable(g)}
    <h3>Ganador final: ${camelChip(f.winner)} ${CAMEL_NAMES[f.winner]}</h3>
    <table>${pileRows(f.winnerPile)}</table>
    <h3>Perdedor final: ${camelChip(f.loser)} ${CAMEL_NAMES[f.loser]}</h3>
    <table>${pileRows(f.loserPile)}</table>
    <div class="modal-actions">
      <button class="ghost" id="close-modal">Ver tablero</button>
      ${host ? '<button class="primary" id="again">Volver a la sala</button>' : ''}
    </div>`);
  $('close-modal').onclick = closeModal;
  if (host) $('again').onclick = () => socket.emit('playAgain');
}

function showTurnBanner() {
  const b = $('turn-banner');
  b.hidden = false;
  b.classList.remove('show');
  void b.offsetWidth; // reinicia la animación CSS
  b.classList.add('show');
  clearTimeout((b as any)._timer);
  (b as any)._timer = setTimeout(() => (b.hidden = true), 1700);
}

// ---------- Controles de vista ----------

const qualityButton = $<HTMLButtonElement>('quality');
const paintQuality = () => {
  qualityButton.title = quality === 'high' ? 'Calidad gráfica: alta (pulsa para baja)' : 'Calidad gráfica: baja (pulsa para alta)';
  qualityButton.style.opacity = quality === 'high' ? '1' : '0.55';
};
paintQuality();
qualityButton.onclick = () => {
  quality = quality === 'high' ? 'low' : 'high';
  store.set('camelup.quality', quality);
  scene.setQuality(quality);
  paintQuality();
  toast(quality === 'high' ? 'Calidad gráfica alta' : 'Calidad gráfica baja', true);
};

$('rot-left').onclick = () => scene.rotateView(-1);
$('rot-right').onclick = () => scene.rotateView(1);
$('reset-view').onclick = () => scene.resetView();
$('leave').onclick = () => {
  if (confirm('¿Salir de la sala? Si la partida está en marcha podrás volver con el mismo código desde esta pestaña.')) {
    socket.emit('leaveRoom');
  }
};

renderLobby();
