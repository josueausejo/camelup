// Motor de reglas de Camel Up 2.0 (2-4 jugadores). Puro y determinista dado un RNG,
// lo usan tanto el servidor (autoridad) como el cliente (tipos y utilidades).

export const RACING = ['blue', 'green', 'yellow', 'red', 'purple'] as const;
export const CRAZY = ['white', 'black'] as const;
export type RacingColor = (typeof RACING)[number];
export type CrazyColor = (typeof CRAZY)[number];
export type CamelId = RacingColor | CrazyColor;
export type DieId = RacingColor | 'grey';

export const TRACK_LENGTH = 16;
export const START_MONEY = 3;
export const STAGE_TICKET_VALUES = [5, 3, 2, 2];
export const PYRAMID_TICKETS = 5;
export const FINAL_PAYOUTS = [8, 5, 3, 2];
export const MAX_PLAYERS = 4;
export const MIN_PLAYERS = 2;

export const CAMEL_NAMES: Record<CamelId, string> = {
  blue: 'azul',
  green: 'verde',
  yellow: 'amarillo',
  red: 'rojo',
  purple: 'morado',
  white: 'blanco',
  black: 'negro',
};

export const isRacing = (c: CamelId): c is RacingColor => (RACING as readonly string[]).includes(c);

export type SpectatorSide = 'cheer' | 'boo';
export type FinalPile = 'winner' | 'loser';

export interface StageBet {
  color: RacingColor;
  value: number;
}

export interface Player {
  id: string;
  name: string;
  seat: number; // 0-3, define el color del jugador
  money: number;
  hand: RacingColor[]; // cartas de apuesta final que quedan en la mano (vacía si es de otro jugador)
  handCount: number;
  bets: StageBet[];
  pyramidTickets: number;
  spectator: { space: number; side: SpectatorSide } | null;
  connected: boolean;
}

export interface FinalCard {
  playerId: string;
  color: RacingColor | null; // null cuando está oculta para quien la recibe
}

export interface RevealedDie {
  die: DieId;
  value: number;
  crazy?: CrazyColor; // color del número del dado gris
}

/** Un salto de una unidad de camellos, para animarlo en el cliente. */
export interface MoveStep {
  unit: CamelId[]; // de abajo a arriba
  from: number;
  to: number;
  under: boolean; // se coloca debajo de la unidad de destino (abucheo)
  spectatorOwner?: string;
}

export type GameEvent =
  | { type: 'pyramid'; playerId: string; die: RevealedDie; camel: CamelId; moves: MoveStep[] }
  | { type: 'bet'; playerId: string; bet: StageBet }
  | { type: 'spectator'; playerId: string; space: number; side: SpectatorSide }
  | { type: 'final'; playerId: string; pile: FinalPile };

export interface ScoreLine {
  playerId: string;
  items: { label: string; amount: number }[];
  total: number;
}

export interface StageSummary {
  stage: number;
  leader: RacingColor;
  second: RacingColor;
  lines: ScoreLine[];
}

export interface FinalSummary {
  winner: RacingColor;
  loser: RacingColor;
  winnerPile: { playerId: string; color: RacingColor; amount: number }[];
  loserPile: { playerId: string; color: RacingColor; amount: number }[];
  ranking: { playerId: string; money: number }[];
  champions: string[];
}

/** Una tirada del sorteo de salida (en el orden en que se colocaron los camellos). */
export interface SetupRoll {
  die: DieId;
  value: number;
  crazy?: CrazyColor; // color del número en el dado gris
  camel: CamelId;
  space: number;
}

export interface GameState {
  phase: 'playing' | 'finished';
  setup: SetupRoll[];
  players: Player[];
  current: number; // índice del jugador en turno
  startPlayer: number; // jugador inicial de la etapa
  stage: number;
  track: Record<number, CamelId[]>; // casilla -> pila de abajo a arriba (puede estar fuera de 1..16 al acabar)
  betStacks: Record<RacingColor, number[]>; // el último elemento es la ficha de arriba
  pyramid: DieId[]; // dados que siguen dentro
  revealed: RevealedDie[];
  pyramidLeft: number;
  winnerPile: FinalCard[]; // en orden de colocación (el primero, abajo)
  loserPile: FinalCard[];
  event: GameEvent | null;
  eventSeq: number;
  log: string[];
  lastStage: StageSummary | null;
  final: FinalSummary | null;
}

export type Action =
  | { type: 'takeBet'; color: RacingColor }
  | { type: 'placeSpectator'; space: number; side: SpectatorSide }
  | { type: 'pyramid' }
  | { type: 'finalBet'; pile: FinalPile; color: RacingColor };

export type Rng = () => number;

const rollD3 = (rng: Rng) => 1 + Math.floor(rng() * 3);
const pick = <T>(arr: T[], rng: Rng) => arr[Math.floor(rng() * arr.length)];

function shuffle<T>(arr: T[], rng: Rng): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- Preparación ----------

export function createGame(
  players: { id: string; name: string }[],
  rng: Rng = Math.random,
): GameState {
  const track: Record<number, CamelId[]> = {};
  const setup: SetupRoll[] = [];
  const put = (space: number, camel: CamelId) => (track[space] ??= []).push(camel);

  // Camellos de carrera: su dado indica la casilla (1-3); se apilan en el orden del sorteo.
  for (const c of shuffle([...RACING], rng)) {
    const value = rollD3(rng);
    put(value, c);
    setup.push({ die: c, value, camel: c, space: value });
  }
  // Camellos locos con el dado gris: 1 -> 16, 2 -> 15, 3 -> 14. El segundo se apila encima.
  for (const c of CRAZY) {
    const value = rollD3(rng);
    const space = TRACK_LENGTH + 1 - value;
    put(space, c);
    setup.push({ die: 'grey', value, crazy: c, camel: c, space });
  }
  const draw = setup
    .filter((s) => s.die !== 'grey')
    .map((s) => `${CAMEL_NAMES[s.camel]} ${s.value}`)
    .join(', ');

  const betStacks = {} as Record<RacingColor, number[]>;
  for (const c of RACING) betStacks[c] = [...STAGE_TICKET_VALUES].reverse();

  const start = Math.floor(rng() * players.length);
  return {
    phase: 'playing',
    setup,
    players: players.map((p, seat) => ({
      id: p.id,
      name: p.name,
      seat,
      money: START_MONEY,
      hand: [...RACING],
      handCount: RACING.length,
      bets: [],
      pyramidTickets: 0,
      spectator: null,
      connected: true,
    })),
    current: start,
    startPlayer: start,
    stage: 1,
    track,
    betStacks,
    pyramid: [...RACING, 'grey'],
    revealed: [],
    pyramidLeft: PYRAMID_TICKETS,
    winnerPile: [],
    loserPile: [],
    event: null,
    eventSeq: 0,
    log: [
      `Sorteo de salida: ${draw}. Los locos salen en las casillas ${setup
        .filter((s) => s.die === 'grey')
        .map((s) => `${s.space} (${CAMEL_NAMES[s.camel]})`)
        .join(' y ')}.`,
      `Empieza la carrera. Comienza ${players[start].name}.`,
    ],
    lastStage: null,
    final: null,
  };
}

// ---------- Consultas ----------

export function findCamel(state: GameState, camel: CamelId): { space: number; index: number } {
  for (const [k, stack] of Object.entries(state.track)) {
    const index = stack.indexOf(camel);
    if (index >= 0) return { space: Number(k), index };
  }
  throw new Error(`Camello ${camel} no encontrado`);
}

/** Camellos de carrera del primero al último. Los de arriba de la pila van delante. */
export function ranking(state: GameState): RacingColor[] {
  return Object.keys(state.track)
    .map(Number)
    .sort((a, b) => b - a)
    .flatMap((space) => [...state.track[space]].reverse().filter(isRacing));
}

export function spectatorAt(state: GameState, space: number): Player | undefined {
  return state.players.find((p) => p.spectator?.space === space);
}

export function canPlaceSpectator(state: GameState, playerId: string, space: number): boolean {
  if (!Number.isInteger(space) || space < 2 || space > TRACK_LENGTH) return false;
  if (state.track[space]?.length) return false;
  return !state.players.some(
    (p) => p.id !== playerId && p.spectator && Math.abs(p.spectator.space - space) <= 1,
  );
}

// ---------- Movimiento ----------

const offTrack = (space: number) => space < 1 || space > TRACK_LENGTH;

/** Mueve el camello y todo lo que lleva encima. Devuelve los saltos y si la carrera terminó. */
function moveCamel(state: GameState, camel: CamelId, steps: number): { moves: MoveStep[]; finished: boolean } {
  const dir = isRacing(camel) ? 1 : -1;
  const { space: from, index } = findCamel(state, camel);
  const stack = state.track[from];
  const unit = stack.slice(index);
  setStack(state, from, stack.slice(0, index));

  const moves: MoveStep[] = [];
  let to = from + dir * steps;
  const step: MoveStep = { unit, from, to, under: false };
  moves.push(step);

  if (!offTrack(to)) {
    const owner = spectatorAt(state, to);
    if (owner?.spectator) {
      step.spectatorOwner = owner.id;
      owner.money += 1;
      const side = owner.spectator.side;
      const next = to + (side === 'cheer' ? dir : -dir);
      state.log.push(
        `${owner.name} gana 1 LE: su público ${side === 'cheer' ? 'anima' : 'abuchea'} a la unidad de ${CAMEL_NAMES[camel]}.`,
      );
      moves.push({ unit, from: to, to: next, under: side === 'boo' });
      to = next;
    }
  }

  const under = moves[moves.length - 1].under;
  const target = state.track[to] ?? [];
  setStack(state, to, under ? [...unit, ...target] : [...target, ...unit]);
  return { moves, finished: offTrack(to) };
}

function setStack(state: GameState, space: number, stack: CamelId[]) {
  if (stack.length) state.track[space] = stack;
  else delete state.track[space];
}

/** Elige qué camello loco mueve el dado gris según las excepciones del reglamento. */
export function crazyToMove(state: GameState, rolled: CrazyColor): CrazyColor {
  const carrying = CRAZY.filter((c) => {
    const { space, index } = findCamel(state, c);
    return state.track[space].slice(index + 1).some(isRacing);
  });
  if (carrying.length === 1) return carrying[0];

  const w = findCamel(state, 'white');
  const b = findCamel(state, 'black');
  if (w.space === b.space && Math.abs(w.index - b.index) === 1) return w.index > b.index ? 'white' : 'black';
  return rolled;
}

// ---------- Acciones ----------

export class RuleError extends Error {}

export function applyAction(state: GameState, playerId: string, action: Action, rng: Rng = Math.random): void {
  if (state.phase !== 'playing') throw new RuleError('La partida ha terminado.');
  const player = state.players[state.current];
  if (player.id !== playerId) throw new RuleError('No es tu turno.');

  switch (action.type) {
    case 'takeBet': {
      const stack = state.betStacks[action.color];
      if (!stack?.length) throw new RuleError('No quedan fichas de ese color.');
      const value = stack.pop()!;
      player.bets.push({ color: action.color, value });
      state.event = { type: 'bet', playerId, bet: { color: action.color, value } };
      state.log.push(`${player.name} apuesta por el camello ${CAMEL_NAMES[action.color]} (${value} LE).`);
      break;
    }
    case 'placeSpectator': {
      if (action.side !== 'cheer' && action.side !== 'boo') throw new RuleError('Lado no válido.');
      if (player.spectator?.space === action.space) throw new RuleError('Debes moverla a una casilla diferente.');
      if (!canPlaceSpectator(state, playerId, action.space)) throw new RuleError('No puedes colocar el público ahí.');
      player.spectator = { space: action.space, side: action.side };
      state.event = { type: 'spectator', playerId, space: action.space, side: action.side };
      state.log.push(
        `${player.name} coloca su público (${action.side === 'cheer' ? 'animando +1' : 'abucheando -1'}) en la casilla ${action.space}.`,
      );
      break;
    }
    case 'pyramid': {
      player.pyramidTickets += 1;
      state.pyramidLeft -= 1;
      const die = pick(state.pyramid, rng);
      state.pyramid = state.pyramid.filter((d) => d !== die);
      const value = rollD3(rng);
      let camel: CamelId;
      let revealed: RevealedDie;
      if (die === 'grey') {
        const rolled = pick([...CRAZY], rng);
        revealed = { die, value, crazy: rolled };
        camel = crazyToMove(state, rolled);
      } else {
        revealed = { die, value };
        camel = die;
      }
      state.revealed.push(revealed);
      state.log.push(
        `${player.name} agita la pirámide: dado ${die === 'grey' ? `gris (${CAMEL_NAMES[revealed.crazy!]})` : CAMEL_NAMES[die]} con un ${value}. Se mueve el camello ${CAMEL_NAMES[camel]}.`,
      );
      const { moves, finished } = moveCamel(state, camel, value);
      state.event = { type: 'pyramid', playerId, die: revealed, camel, moves };
      if (finished) {
        state.log.push('¡Una unidad de camellos ha cruzado la meta!');
        scoreStage(state);
        scoreFinal(state);
        state.eventSeq++;
        return;
      }
      if (state.pyramidLeft === 0) {
        state.startPlayer = (state.current + 1) % state.players.length;
        scoreStage(state);
        newStage(state);
        state.current = state.startPlayer;
        state.eventSeq++;
        return;
      }
      break;
    }
    case 'finalBet': {
      if (action.pile !== 'winner' && action.pile !== 'loser') throw new RuleError('Montón no válido.');
      if (!player.hand.includes(action.color)) throw new RuleError('Ya no tienes esa carta.');
      player.hand = player.hand.filter((c) => c !== action.color);
      player.handCount = player.hand.length;
      (action.pile === 'winner' ? state.winnerPile : state.loserPile).push({ playerId, color: action.color });
      state.event = { type: 'final', playerId, pile: action.pile };
      state.log.push(`${player.name} apuesta en secreto por el ${action.pile === 'winner' ? 'ganador' : 'perdedor'} final.`);
      break;
    }
    default:
      throw new RuleError('Acción desconocida.');
  }

  state.current = (state.current + 1) % state.players.length;
  state.eventSeq++;
}

function pay(player: Player, amount: number) {
  player.money = Math.max(0, player.money + amount);
}

function scoreStage(state: GameState) {
  const [leader, second] = ranking(state);
  const lines: ScoreLine[] = state.players.map((p) => {
    const items = p.bets.map((b) => ({
      label: `Apuesta ${CAMEL_NAMES[b.color]} (${b.value})`,
      amount: b.color === leader ? b.value : b.color === second ? 1 : -1,
    }));
    if (p.pyramidTickets) items.push({ label: `Fichas de pirámide ×${p.pyramidTickets}`, amount: p.pyramidTickets });
    const total = items.reduce((s, i) => s + i.amount, 0);
    pay(p, total);
    return { playerId: p.id, items, total };
  });
  state.lastStage = { stage: state.stage, leader, second, lines };
  state.log.push(
    `Fin de la etapa ${state.stage}: lidera ${CAMEL_NAMES[leader]}, segundo ${CAMEL_NAMES[second]}.`,
  );
}

function newStage(state: GameState) {
  state.stage += 1;
  for (const p of state.players) {
    p.bets = [];
    p.pyramidTickets = 0;
    p.spectator = null;
  }
  for (const c of RACING) state.betStacks[c] = [...STAGE_TICKET_VALUES].reverse();
  state.pyramid = [...RACING, 'grey'];
  state.revealed = [];
  state.pyramidLeft = PYRAMID_TICKETS;
  state.log.push(`Comienza la etapa ${state.stage}. Empieza ${state.players[state.startPlayer].name}.`);
}

function scorePile(state: GameState, pile: FinalCard[], target: RacingColor) {
  let hits = 0;
  return pile.map((card) => {
    const player = state.players.find((p) => p.id === card.playerId)!;
    const amount = card.color === target ? (FINAL_PAYOUTS[hits++] ?? 1) : -1;
    pay(player, amount);
    return { playerId: card.playerId, color: card.color!, amount };
  });
}

function scoreFinal(state: GameState) {
  const order = ranking(state);
  const winner = order[0];
  const loser = order[order.length - 1];
  const winnerPile = scorePile(state, state.winnerPile, winner);
  const loserPile = scorePile(state, state.loserPile, loser);
  const ranked = [...state.players].sort((a, b) => b.money - a.money);
  const best = ranked[0].money;
  state.final = {
    winner,
    loser,
    winnerPile,
    loserPile,
    ranking: ranked.map((p) => ({ playerId: p.id, money: p.money })),
    champions: ranked.filter((p) => p.money === best).map((p) => p.id),
  };
  state.phase = 'finished';
  state.log.push(
    `Fin de la carrera: gana ${CAMEL_NAMES[winner]}, último ${CAMEL_NAMES[loser]}. ¡Victoria para ${ranked
      .filter((p) => p.money === best)
      .map((p) => p.name)
      .join(' y ')}!`,
  );
}

/** Copia del estado que ve un jugador concreto: oculta las cartas y manos ajenas. */
export function viewFor(state: GameState, playerId: string): GameState {
  const view: GameState = structuredClone(state);
  if (view.phase === 'playing') {
    const hide = (pile: FinalCard[]) => pile.forEach((c) => c.playerId !== playerId && (c.color = null));
    hide(view.winnerPile);
    hide(view.loserPile);
  }
  for (const p of view.players) if (p.id !== playerId && view.phase === 'playing') p.hand = [];
  return view;
}
