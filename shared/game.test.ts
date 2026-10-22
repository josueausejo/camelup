import assert from 'node:assert/strict';
import {
  applyAction,
  canPlaceSpectator,
  crazyToMove,
  createGame,
  ranking,
  viewFor,
  RACING,
  type Action,
  type GameState,
  type Rng,
} from './game.ts';

let passed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
  } catch (e) {
    console.error(`✗ ${name}`);
    throw e;
  }
}

/** RNG que devuelve una secuencia fija (y luego 0). */
const seq = (...values: number[]): Rng => () => values.shift() ?? 0;

/** RNG pseudoaleatorio reproducible (mulberry32). */
function seeded(seed: number): Rng {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function game(): GameState {
  const g = createGame([
    { id: 'a', name: 'Ana' },
    { id: 'b', name: 'Beto' },
  ], seeded(1));
  g.current = 0;
  return g;
}

// rng para la acción de pirámide: [elegir dado, valor, (color gris)]
// dado: índice / longitud de g.pyramid; valor: (v-1)/3
const dieRng = (g: GameState, die: string, value: number, crazy?: 'white' | 'black') => {
  const i = g.pyramid.indexOf(die as never);
  const vals = [(i + 0.5) / g.pyramid.length, (value - 1 + 0.5) / 3];
  if (crazy) vals.push(crazy === 'white' ? 0.25 : 0.75);
  return seq(...vals);
};

test('el sorteo de salida registrado reproduce la colocación inicial', () => {
  for (let s = 0; s < 50; s++) {
    const g = createGame([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], seeded(s));
    assert.equal(g.setup.length, 7);
    const rebuilt: Record<number, string[]> = {};
    for (const r of g.setup) {
      if (r.die === 'grey') {
        assert.ok(r.crazy === r.camel && r.space === 17 - r.value);
      } else {
        assert.ok(r.die === r.camel && r.space === r.value && r.value >= 1 && r.value <= 3);
      }
      (rebuilt[r.space] ??= []).push(r.camel);
    }
    assert.deepEqual(rebuilt, g.track);
  }
});

test('ejemplo del reglamento: la unidad salta encima de otra', () => {
  const g = game();
  g.track = { 3: ['purple', 'green'], 5: ['yellow'], 1: ['blue', 'red'], 16: ['white', 'black'] };
  applyAction(g, 'a', { type: 'pyramid' }, dieRng(g, 'purple', 2));
  assert.deepEqual(g.track[5], ['yellow', 'purple', 'green']);
  assert.equal(g.track[3], undefined);
});

test('mover un camello del medio deja los de abajo', () => {
  const g = game();
  g.track = { 2: ['blue', 'red', 'green'], 1: ['yellow', 'purple'], 16: ['white', 'black'] };
  applyAction(g, 'a', { type: 'pyramid' }, dieRng(g, 'red', 1));
  assert.deepEqual(g.track[2], ['blue']);
  assert.deepEqual(g.track[3], ['red', 'green']);
});

test('público animando: +1 casilla y 1 LE para el dueño', () => {
  const g = game();
  g.track = { 1: ['blue', 'red', 'yellow', 'purple'], 4: ['green'], 16: ['white', 'black'] };
  g.players[1].spectator = { space: 3, side: 'cheer' };
  applyAction(g, 'a', { type: 'pyramid' }, dieRng(g, 'purple', 2));
  assert.deepEqual(g.track[4], ['green', 'purple']);
  assert.equal(g.players[1].money, 4);
});

test('público abucheando: -1 casilla y se coloca debajo', () => {
  const g = game();
  g.track = { 1: ['blue', 'red', 'yellow', 'purple'], 2: ['green'], 16: ['white', 'black'] };
  g.players[1].spectator = { space: 3, side: 'boo' };
  applyAction(g, 'a', { type: 'pyramid' }, dieRng(g, 'purple', 2));
  assert.deepEqual(g.track[2], ['purple', 'green']);
});

test('camello loco que pisa público se mueve en sentido contrario', () => {
  const g = game();
  g.track = { 1: [...RACING], 16: ['white'], 15: ['black'] };
  g.players[1].spectator = { space: 14, side: 'cheer' };
  applyAction(g, 'a', { type: 'pyramid' }, dieRng(g, 'grey', 2, 'white'));
  assert.deepEqual(g.track[13], ['white']);
});

test('dado gris: mueve el único camello loco que carga corredores', () => {
  const g = game();
  g.track = { 1: ['blue', 'red', 'yellow', 'purple'], 10: ['white', 'green'], 14: ['black'] };
  assert.equal(crazyToMove(g, 'black'), 'white');
  g.track = { 1: ['blue', 'red', 'yellow'], 10: ['white', 'green'], 14: ['black', 'purple'] };
  assert.equal(crazyToMove(g, 'black'), 'black');
});

test('dado gris: si uno está directamente encima del otro, mueve el de arriba', () => {
  const g = game();
  g.track = { 1: [...RACING], 15: ['black', 'white'] };
  assert.equal(crazyToMove(g, 'black'), 'white');
});

test('ranking: arriba de la pila va delante; los locos no cuentan', () => {
  const g = game();
  g.track = { 2: ['blue', 'white'], 5: ['red', 'green'], 4: ['yellow', 'purple'], 16: ['black'] };
  assert.deepEqual(ranking(g), ['green', 'red', 'purple', 'yellow', 'blue']);
});

test('reglas de colocación del público', () => {
  const g = game();
  g.track = { 1: [...RACING], 16: ['white', 'black'] };
  assert.equal(canPlaceSpectator(g, 'a', 1), false);
  assert.equal(canPlaceSpectator(g, 'a', 16), false);
  assert.equal(canPlaceSpectator(g, 'a', 5), true);
  g.players[1].spectator = { space: 6, side: 'boo' };
  assert.equal(canPlaceSpectator(g, 'a', 5), false);
  assert.equal(canPlaceSpectator(g, 'a', 6), false);
  assert.equal(canPlaceSpectator(g, 'a', 8), true);
  // Mover el propio público: se ignora su posición actual
  g.players[0].spectator = { space: 9, side: 'boo' };
  assert.equal(canPlaceSpectator(g, 'a', 10), true);
});

test('fichas de etapa: 5, 3, 2, 2 y luego se agotan', () => {
  const g = game();
  const take = (who: string) => applyAction(g, who, { type: 'takeBet', color: 'red' });
  take('a'); take('b'); take('a'); take('b');
  assert.deepEqual(g.players[0].bets.map((b) => b.value), [5, 2]);
  assert.deepEqual(g.players[1].bets.map((b) => b.value), [3, 2]);
  assert.throws(() => take('a'));
});

test('ejemplo de puntuación de etapa: Martina gana 9 LE', () => {
  const g = game();
  g.track = { 8: ['blue', 'yellow', 'green'], 6: ['red', 'purple'], 15: ['white', 'black'] };
  const m = g.players[0];
  m.bets = [
    { color: 'green', value: 5 },
    { color: 'green', value: 2 },
    { color: 'yellow', value: 5 },
    { color: 'blue', value: 5 },
  ];
  m.pyramidTickets = 1; // + la que toma ahora = 2
  g.pyramidLeft = 1;
  g.pyramid = ['grey'];
  m.money = 0;
  // El dado gris mueve un loco lejos sin afectar la cabeza
  applyAction(g, 'a', { type: 'pyramid' }, seq(0, 0, 0.75));
  assert.equal(g.lastStage!.lines[0].total, 9);
  assert.equal(m.money, 9);
  assert.equal(g.stage, 2);
  assert.equal(g.current, 1, 'empieza el jugador a la izquierda del que tomó la última ficha');
  assert.equal(m.bets.length, 0);
  assert.equal(g.pyramid.length, 6);
});

test('el dinero nunca baja de 0', () => {
  const g = game();
  g.track = { 8: ['blue'], 6: ['red', 'purple', 'yellow', 'green'], 15: ['white', 'black'] };
  g.players[0].money = 0;
  g.players[0].bets = [{ color: 'red', value: 5 }, { color: 'yellow', value: 5 }];
  g.pyramidLeft = 1;
  g.pyramid = ['grey'];
  applyAction(g, 'a', { type: 'pyramid' }, seq(0, 0, 0.75));
  assert.equal(g.players[0].money, 0);
});

test('fin de carrera y puntuación final', () => {
  const g = game();
  g.track = { 15: ['blue', 'red'], 10: ['green', 'yellow', 'purple'], 3: ['white', 'black'] };
  for (const p of g.players) p.money = 10;
  applyAction(g, 'a', { type: 'finalBet', pile: 'winner', color: 'red' });
  applyAction(g, 'b', { type: 'finalBet', pile: 'winner', color: 'red' });
  applyAction(g, 'a', { type: 'finalBet', pile: 'loser', color: 'blue' });
  applyAction(g, 'b', { type: 'finalBet', pile: 'loser', color: 'green' });
  applyAction(g, 'a', { type: 'pyramid' }, dieRng(g, 'blue', 3));
  assert.equal(g.phase, 'finished');
  assert.equal(g.final!.winner, 'red');
  assert.equal(g.final!.loser, 'green');
  // Ana: ganador 8, perdedor -1, +1 pirámide => 18. Beto: ganador 5, perdedor 8 => 23
  assert.equal(g.players[0].money, 18);
  assert.equal(g.players[1].money, 23);
  assert.deepEqual(g.final!.champions, ['b']);
});

test('camello loco que cruza la meta hacia atrás termina la carrera; sus pasajeros son últimos', () => {
  const g = game();
  g.track = { 2: ['white', 'purple'], 9: ['blue', 'red', 'green', 'yellow'], 12: ['black'] };
  applyAction(g, 'a', { type: 'pyramid' }, dieRng(g, 'grey', 3, 'black'));
  assert.equal(g.phase, 'finished');
  assert.equal(g.final!.loser, 'purple');
});

test('las vistas ocultan cartas y manos ajenas', () => {
  const g = game();
  applyAction(g, 'a', { type: 'finalBet', pile: 'winner', color: 'red' });
  const vb = viewFor(g, 'b');
  assert.equal(vb.winnerPile[0].color, null);
  assert.deepEqual(vb.players[0].hand, []);
  assert.equal(vb.players[0].handCount, 4);
  assert.equal(viewFor(g, 'a').winnerPile[0].color, 'red');
});

test('500 partidas aleatorias terminan sin errores y conservan los 7 camellos', () => {
  for (let s = 0; s < 500; s++) {
    const rng = seeded(s);
    const n = 2 + (s % 3);
    const g = createGame(
      Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `J${i}` })),
      rng,
    );
    let turns = 0;
    while (g.phase === 'playing') {
      assert.ok(turns++ < 2000, 'partida demasiado larga');
      const p = g.players[g.current];
      const options: Action[] = [{ type: 'pyramid' }];
      for (const c of RACING) {
        if (g.betStacks[c].length) options.push({ type: 'takeBet', color: c });
        if (p.hand.includes(c)) options.push({ type: 'finalBet', pile: rng() < 0.5 ? 'winner' : 'loser', color: c });
      }
      for (let sp = 2; sp <= 16; sp++)
        if (canPlaceSpectator(g, p.id, sp) && p.spectator?.space !== sp)
          options.push({ type: 'placeSpectator', space: sp, side: rng() < 0.5 ? 'cheer' : 'boo' });
      applyAction(g, p.id, options[Math.floor(rng() * options.length)], rng);
      const all = Object.values(g.track).flat();
      assert.equal(all.length, 7);
      assert.equal(new Set(all).size, 7);
      assert.ok(g.players.every((pl) => pl.money >= 0));
    }
    assert.ok(g.final);
  }
});

console.log(`✓ ${passed} tests superados`);
