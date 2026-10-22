import type { CamelId, RacingColor } from '../../../shared/game';
import { CAMEL_COLORS } from '../scene/models';
import { camelSvg, coinSvg, dieHtml, pyramidSvg } from './art';

// Tutorial interactivo en estilo cartoon. Lo presenta Kamil, un camello con fez;
// en cada paso hay que hacer algo (tocar, elegir, lanzar) para poder avanzar.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const restart = (el: Element, cls: string) => {
  el.classList.remove(cls);
  void (el as HTMLElement).offsetWidth;
  el.classList.add(cls);
};

interface StepApi {
  stage: HTMLElement;
  say(text: string): void;
  done(text?: string): void;
  /** Dedo animado señalando un elemento del escenario. */
  point(el: HTMLElement | null): void;
  /** true mientras el paso sigue en pantalla (para cortar animaciones al cambiar de paso). */
  alive(): boolean;
}

interface Step {
  title: string;
  say: string;
  build(api: StepApi): void;
}

// ---------- Pista en miniatura ----------

class MiniTrack {
  readonly el: HTMLElement;
  private stacks = new Map<number, CamelId[]>();
  private camels = new Map<CamelId, HTMLElement>();
  private spaceEls: HTMLElement[] = [];

  /** `rows`: altura máxima de pila que debe caber sobre la pista. */
  constructor(parent: HTMLElement, private n = 6, rows = 4) {
    this.el = document.createElement('div');
    this.el.className = 'mtrack';
    this.el.style.setProperty('--n', String(n));
    this.el.style.height = `${3.6 + rows * 2.3}em`;
    for (let i = 1; i <= n; i++) {
      const s = document.createElement('div');
      s.className = 'mspace';
      s.dataset.space = String(i);
      s.innerHTML = `<span class="mnum">${i}</span>`;
      this.el.appendChild(s);
      this.spaceEls.push(s);
    }
    parent.appendChild(this.el);
  }

  space(i: number) {
    return this.spaceEls[i - 1];
  }

  add(id: CamelId, space: number) {
    const c = document.createElement('div');
    c.className = `tc ${id === 'white' || id === 'black' ? 'crazy' : ''}`;
    // .tc-in lleva las animaciones; el SVG solo el volteo de los locos
    c.innerHTML = `<div class="tc-in">${camelSvg(id)}</div>`;
    this.el.appendChild(c);
    this.camels.set(id, c);
    (this.stacks.get(space) ?? this.stacks.set(space, []).get(space)!).push(id);
    this.layout();
  }

  where(id: CamelId) {
    for (const [s, st] of this.stacks) if (st.includes(id)) return s;
    return 0;
  }

  layout() {
    for (const [space, st] of this.stacks)
      st.forEach((id, i) => {
        const c = this.camels.get(id)!;
        c.style.left = `${((space - 0.5) / this.n) * 100}%`;
        c.style.bottom = `${0.5 + i * 2.15}em`;
        c.style.zIndex = String(10 + i);
      });
  }

  /** Mueve un camello (y los que lleva encima) casilla a casilla. */
  async move(id: CamelId, steps: number, alive: () => boolean, opts: { under?: boolean } = {}) {
    const dir = Math.sign(steps);
    let space = this.where(id);
    const from = this.stacks.get(space)!;
    const unit = from.slice(from.indexOf(id));
    this.stacks.set(space, from.slice(0, from.indexOf(id)));
    for (let k = 0; k < Math.abs(steps); k++) {
      if (!alive()) return;
      space = Math.max(1, Math.min(this.n, space + dir));
      const last = k === Math.abs(steps) - 1;
      const target = this.stacks.get(space) ?? [];
      this.stacks.set(space, last && opts.under ? [...unit, ...target] : [...target, ...unit]);
      for (const u of unit) {
        const c = this.camels.get(u)!;
        c.classList.add('walk');
        restart(c, 'hop');
      }
      this.layout();
      await sleep(360);
      if (!last) this.stacks.set(space, target);
    }
    for (const u of unit) {
      const c = this.camels.get(u)!;
      c.classList.remove('walk');
      restart(c, 'land');
    }
  }

  tile(space: number, kind: 'cheer' | 'boo') {
    const t = document.createElement('div');
    t.className = `mtile ${kind}`;
    t.textContent = kind === 'cheer' ? '+1' : '−1';
    this.space(space).appendChild(t);
    return t;
  }
}

// ---------- Pasos ----------

function bigButton(html: string, cls = '') {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `tbtn ${cls}`;
  b.innerHTML = html;
  return b;
}

/** Pirámide que se agita al tocarla y suelta el dado indicado. */
function pyramid(stage: HTMLElement) {
  const p = document.createElement('button');
  p.type = 'button';
  p.className = 'tpyr';
  p.innerHTML = pyramidSvg();
  const out = document.createElement('div');
  out.className = 'tdie-out';
  const wrap = document.createElement('div');
  wrap.className = 'tpyr-wrap';
  wrap.append(p, out);
  stage.appendChild(wrap);
  return {
    el: p,
    async roll(die: string) {
      restart(p, 'shake');
      await sleep(600);
      out.innerHTML = die;
      restart(out, 'pop');
      await sleep(550);
    },
  };
}

const STEPS: Step[] = [
  {
    title: '¡Bienvenido a Camel Up!',
    say: '¡Hola! Soy Kamil, tu guía. Antes de correr te enseño a jugar en un momento. ¡Tócame para saludar!',
    build({ stage, done, point }) {
      const m = bigButton(camelSvg('mascot'), 'mascot');
      const bubble = document.createElement('div');
      bubble.className = 'shout';
      stage.append(m, bubble);
      point(m);
      m.onclick = () => {
        restart(m, 'jump');
        bubble.textContent = ['¡Yalla! 🐪', '¡Hola, hola!', '¡Qué alegría!'][Math.floor(Math.random() * 3)];
        restart(bubble, 'show');
        point(null);
        burst(stage, ['#f2c14e', '#c73a2f', '#2f78d0', '#3d9e4a']);
        done('¡Genial! Pulsa «Siguiente» para empezar.');
      };
    },
  },
  {
    title: 'El objetivo',
    say: 'Los camellos no son de nadie: tú apuestas por ellos. Gana quien tenga más libras egipcias (LE) al final. ¡Atrapa las 3 monedas!',
    build({ stage, done, point }) {
      const counter = document.createElement('div');
      counter.className = 'tcounter';
      counter.innerHTML = `${coinSvg()}<b>0</b> LE`;
      stage.appendChild(counter);
      let got = 0;
      for (let i = 0; i < 3; i++) {
        const c = bigButton(coinSvg(), 'tcoin');
        c.style.left = `${18 + i * 28 + Math.random() * 6}%`;
        c.style.animationDelay = `${i * 0.25}s, ${i * 0.3}s`;
        stage.appendChild(c);
        if (i === 0) point(c);
        c.onclick = () => {
          if (c.classList.contains('got')) return;
          c.classList.add('got');
          point(null);
          got++;
          counter.querySelector('b')!.textContent = String(got);
          restart(counter, 'bump');
          if (got === 3) {
            burst(stage, ['#f2c14e', '#ffe08a']);
            done('¡Eso es! Empiezas la partida con 3 LE. ¡A por más!');
          }
        };
      }
    },
  },
  {
    title: 'La pirámide mueve a los camellos',
    say: 'En tu turno puedes agitar la pirámide: sale un dado y su camello avanza 1, 2 o 3 casillas. ¡Toca la pirámide!',
    build({ stage, say, done, point, alive }) {
      const row = document.createElement('div');
      row.className = 'trow';
      stage.appendChild(row);
      const pyr = pyramid(row);
      const track = new MiniTrack(row, 6, 3);
      track.add('blue', 1);
      track.add('yellow', 1);
      track.add('red', 2);
      point(pyr.el);
      let rolls = 0;
      let busy = false;
      pyr.el.onclick = async () => {
        if (busy || rolls >= 2) return;
        busy = true;
        point(null);
        if (rolls === 0) {
          await pyr.roll(dieHtml(CAMEL_COLORS.blue, 2));
          await track.move('blue', 2, alive);
          say('¡El azul avanzó 2 y se llevó al amarillo! Los camellos de encima viajan gratis. Toca otra vez la pirámide.');
          point(pyr.el);
        } else {
          await pyr.roll(dieHtml(CAMEL_COLORS.red, 1));
          await track.move('red', 1, alive);
          done('El rojo cayó encima de la pila y ahora va primero: el de arriba siempre va delante. ¡Y ganas 1 LE por agitar la pirámide!');
        }
        rolls++;
        busy = false;
      };
    },
  },
  {
    title: 'Los camellos locos',
    say: 'El blanco y el negro están locos: corren al revés y nadie apuesta por ellos. ¡Si llevan a alguien encima, lo arrastran hacia atrás! Toca el dado gris.',
    build({ stage, done, point, alive }) {
      const row = document.createElement('div');
      row.className = 'trow';
      stage.appendChild(row);
      const die = bigButton(dieHtml('#9a9a9a', 2, 'black'), 'tgrey');
      row.appendChild(die);
      const track = new MiniTrack(row, 6, 3);
      track.add('green', 3);
      track.add('black', 5);
      track.add('red', 5);
      point(die);
      let used = false;
      die.onclick = async () => {
        if (used) return;
        used = true;
        point(null);
        restart(die, 'roll');
        await sleep(700);
        await track.move('black', -2, alive);
        done('¡El negro retrocedió 2 casillas con el rojo a cuestas y cayó sobre el verde! Los locos complican mucho las apuestas.');
      };
    },
  },
  {
    title: 'Apuestas de etapa',
    say: 'Una etapa acaba cuando han salido 5 dados. Si apuestas por el que va primero ganas 5, 3 o 2 LE; si va segundo, 1 LE; si no, pierdes 1. ¿Quién va primero? ¡Toca su ficha!',
    build({ stage, say, done }) {
      const track = new MiniTrack(stage, 6, 2);
      track.add('yellow', 2);
      track.add('red', 3);
      track.add('blue', 4);
      track.add('green', 4);
      const tickets = document.createElement('div');
      tickets.className = 'ttickets';
      const hand = document.createElement('div');
      hand.className = 'thand';
      hand.innerHTML = '<span>Tu mano:</span>';
      stage.append(tickets, hand);
      const colors: RacingColor[] = ['blue', 'green', 'yellow', 'red', 'purple'];
      let solved = false;
      for (const c of colors) {
        const t = bigButton('<b>5</b><small>+1 −1</small>', 'tticket');
        t.style.setProperty('--tc', CAMEL_COLORS[c]);
        tickets.appendChild(t);
        t.onclick = () => {
          if (solved) return;
          if (c !== 'green') {
            restart(t, 'nope');
            say('Mmm… casi. Fíjate en la casilla más avanzada: allí, el que está más arriba de la pila va primero.');
            return;
          }
          solved = true;
          t.classList.add('taken');
          const copy = t.cloneNode(true) as HTMLElement;
          copy.classList.remove('taken');
          copy.classList.add('in-hand');
          hand.appendChild(copy);
          burst(stage, [CAMEL_COLORS.green, '#f2c14e']);
          done('¡Exacto! El verde va líder. Si sigue así al acabar la etapa, ganarás 5 LE.');
        };
      }
    },
  },
  {
    title: 'El público',
    say: 'Puedes poner tu ficha de público en una casilla vacía: si un camello cae ahí se mueve +1 (ánimo) o −1 (abucheo) y tú ganas 1 LE. Elige un lado…',
    build({ stage, say, done, point, alive }) {
      const sides = document.createElement('div');
      sides.className = 'tsides';
      const cheer = bigButton('📣 Animar <b>+1</b>', 'cheer');
      const boo = bigButton('👎 Abuchear <b>−1</b>', 'boo');
      sides.append(cheer, boo);
      const row = document.createElement('div');
      row.className = 'trow';
      stage.append(sides, row);
      const pyr = pyramid(row);
      pyr.el.disabled = true;
      const track = new MiniTrack(row, 6, 1.5);
      track.add('yellow', 1);
      let side: 'cheer' | 'boo' | null = null;
      let placed = false;
      point(cheer);
      const pick = (s: 'cheer' | 'boo') => {
        if (placed) return;
        side = s;
        cheer.classList.toggle('on', s === 'cheer');
        boo.classList.toggle('on', s === 'boo');
        say('…y ahora toca una casilla resaltada para colocar tu público.');
        point(track.space(4));
        for (const i of [3, 4, 5]) track.space(i).classList.add('pick');
      };
      cheer.onclick = () => pick('cheer');
      boo.onclick = () => pick('boo');
      for (const i of [3, 4, 5]) {
        track.space(i).onclick = async () => {
          if (!side || placed) return;
          placed = true;
          point(null);
          for (const j of [3, 4, 5]) track.space(j).classList.remove('pick');
          const tile = track.tile(i, side);
          restart(tile, 'drop');
          say('¡Colocado! Veamos qué pasa si el amarillo cae ahí…');
          await sleep(700);
          if (!alive()) return;
          await pyr.roll(dieHtml(CAMEL_COLORS.yellow, i - 1));
          await track.move('yellow', i - 1, alive);
          await sleep(250);
          restart(tile, 'excite');
          const coin = document.createElement('div');
          coin.className = 'tplus';
          coin.textContent = '+1 LE';
          track.space(i).appendChild(coin);
          await track.move('yellow', side === 'cheer' ? 1 : -1, alive);
          done(
            side === 'cheer'
              ? '¡El público lo animó y avanzó una casilla más! Y tú ganas 1 LE.'
              : '¡Lo abuchearon y retrocedió una casilla! Y tú ganas 1 LE igualmente.',
          );
        };
      }
    },
  },
  {
    title: 'La apuesta final',
    say: 'Puedes apostar en secreto quién ganará o perderá la carrera entera. Cuanto antes aciertes, más ganas: 8, 5, 3, 2, 1 LE. Si fallas, −1. Elige una carta…',
    build({ stage, say, done, point }) {
      const hand = document.createElement('div');
      hand.className = 'tcards';
      const piles = document.createElement('div');
      piles.className = 'tpiles';
      const win = bigButton('🏆<span>Ganador</span>', 'tpile');
      const lose = bigButton('🐢<span>Perdedor</span>', 'tpile');
      piles.append(win, lose);
      stage.append(hand, piles);
      let chosen: HTMLElement | null = null;
      let finished = false;
      const colors: RacingColor[] = ['blue', 'green', 'yellow', 'red', 'purple'];
      colors.forEach((c, i) => {
        const card = bigButton(`<div class="front">${camelSvg(c)}</div><div class="back">?</div>`, 'tcard');
        card.style.setProperty('--tc', CAMEL_COLORS[c]);
        card.style.setProperty('--i', String(i - 2));
        hand.appendChild(card);
        if (i === 1) point(card);
        card.onclick = () => {
          if (finished) return;
          hand.querySelectorAll('.tcard').forEach((x) => x.classList.remove('sel'));
          card.classList.add('sel');
          chosen = card;
          say('…y ahora toca el montón de «Ganador» o «Perdedor».');
          point(win);
        };
      });
      const send = async (pile: HTMLElement) => {
        if (!chosen || finished) return;
        finished = true;
        point(null);
        chosen.classList.add('flip');
        await sleep(450);
        pile.appendChild(chosen);
        chosen.classList.remove('sel');
        chosen.classList.add('in-pile');
        restart(pile, 'bump');
        done('¡Hecho! Tu carta está boca abajo: nadie más sabe qué camello elegiste 🤫');
      };
      win.onclick = () => send(win);
      lose.onclick = () => send(lose);
    },
  },
  {
    title: '¡Tu turno!',
    say: 'En cada turno haces UNA de estas 4 acciones. Toca las cartas para darles la vuelta.',
    build({ stage, done }) {
      const grid = document.createElement('div');
      grid.className = 'tactions';
      const cards = [
        ['🎫', 'Apuesta de etapa', 'Coge la ficha de arriba de un color: ¿quién liderará al acabar la etapa?'],
        ['📣', 'Público', 'Coloca o mueve tu ficha +1/−1 en una casilla vacía de la pista.'],
        ['🔺', 'Pirámide', 'Agítala: un camello se mueve y ganas 1 LE al final de la etapa.'],
        ['🃏', 'Apuesta final', 'Apuesta en secreto quién ganará o perderá la carrera.'],
      ];
      let flipped = 0;
      for (const [icon, name, text] of cards) {
        const c = bigButton(
          `<div class="face a"><span class="ico">${icon}</span><b>${name}</b><small>toca para ver</small></div><div class="face b"><b>${name}</b><p>${text}</p></div>`,
          'taction',
        );
        grid.appendChild(c);
        c.onclick = () => {
          if (c.classList.contains('flipped')) return;
          c.classList.add('flipped');
          if (++flipped === 4) {
            burst(stage, ['#f2c14e', '#c73a2f', '#2f78d0', '#3d9e4a', '#8547c0']);
            done('La carrera acaba cuando un camello cruza la meta. ¡Mucha suerte y a correr! 🐪');
          }
        };
      }
      stage.appendChild(grid);
    },
  },
];

/** Confeti de celebración dentro del escenario. */
function burst(stage: HTMLElement, colors: string[]) {
  for (let i = 0; i < 26; i++) {
    const p = document.createElement('i');
    p.className = 'tconfetti';
    p.style.background = colors[i % colors.length];
    p.style.left = `${50 + (Math.random() - 0.5) * 20}%`;
    p.style.setProperty('--dx', `${(Math.random() - 0.5) * 420}px`);
    p.style.setProperty('--dy', `${-120 - Math.random() * 160}px`);
    p.style.setProperty('--r', `${Math.random() * 720}deg`);
    stage.appendChild(p);
    setTimeout(() => p.remove(), 1400);
  }
}

// ---------- Ventana del tutorial ----------

export class Tutorial {
  private root: HTMLElement;
  private stage!: HTMLElement;
  private bubble!: HTMLElement;
  private next!: HTMLButtonElement;
  private back!: HTMLButtonElement;
  private finger!: HTMLElement;
  private index = 0;
  private token = 0;
  private typing = 0;
  private completed = new Set<number>();
  isOpen = false;

  constructor(private onOpenChange: (open: boolean) => void = () => {}) {
    this.root = document.createElement('div');
    this.root.className = 'tut';
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="tut-card">
        <button class="tut-skip" type="button">Saltar tutorial ✕</button>
        <div class="tut-dots">${STEPS.map(() => '<i></i>').join('')}</div>
        <h2 class="tut-title"></h2>
        <div class="tut-stage"></div>
        <div class="tut-talk">
          <div class="tut-mascot">${camelSvg('mascot')}</div>
          <div class="tut-bubble"></div>
        </div>
        <div class="tut-nav">
          <button type="button" class="ghost tut-back">← Atrás</button>
          <label class="tut-never" hidden><input type="checkbox" /> No volver a mostrar</label>
          <button type="button" class="primary tut-next">Siguiente →</button>
        </div>
        <div class="tut-finger">👆</div>
      </div>`;
    document.body.appendChild(this.root);
    const $ = <T extends HTMLElement>(s: string) => this.root.querySelector(s) as T;
    this.stage = $('.tut-stage');
    this.bubble = $('.tut-bubble');
    this.next = $('.tut-next');
    this.back = $('.tut-back');
    this.finger = $('.tut-finger');
    $('.tut-skip').onclick = () => this.close();
    this.back.onclick = () => this.go(this.index - 1);
    this.next.onclick = () => (this.index === STEPS.length - 1 ? this.close() : this.go(this.index + 1));
    this.bubble.onclick = () => this.finishTyping();
    document.addEventListener('keydown', (e) => {
      if (this.isOpen && e.key === 'Escape') this.close();
    });

  }

  /** ¿El usuario pidió no volver a ver el tutorial? */
  static dismissed(): boolean {
    try {
      return localStorage.getItem('camelup.tutorial') === 'no';
    } catch {
      return false;
    }
  }

  open() {
    this.isOpen = true;
    this.root.hidden = false;
    restart(this.root.querySelector('.tut-card')!, 'enter');
    this.go(0);
    this.onOpenChange(true);
  }

  close() {
    if (!this.isOpen) return;
    const never = this.root.querySelector<HTMLInputElement>('.tut-never input')!;
    if (never.checked)
      try {
        localStorage.setItem('camelup.tutorial', 'no');
      } catch {
        /* sin almacenamiento */
      }
    this.isOpen = false;
    this.token++;
    this.root.hidden = true;
    this.stage.innerHTML = '';
    this.onOpenChange(false);
  }

  private go(i: number) {
    if (i < 0 || i >= STEPS.length) return;
    this.index = i;
    const token = ++this.token;
    const step = STEPS[i];
    const last = i === STEPS.length - 1;
    this.root.querySelector('.tut-title')!.textContent = step.title;
    this.root.querySelectorAll('.tut-dots i').forEach((d, k) => {
      d.classList.toggle('on', k === i);
      d.classList.toggle('done', this.completed.has(k));
    });
    this.back.style.visibility = i === 0 ? 'hidden' : 'visible';
    this.root.querySelector<HTMLElement>('.tut-never')!.hidden = !last;
    this.next.textContent = last ? '¡A jugar! 🐪' : 'Siguiente →';
    this.setNext(this.completed.has(i));
    this.stage.innerHTML = '';
    restart(this.stage, 'enter');
    this.pointAt(null);
    this.say(step.say);
    step.build({
      stage: this.stage,
      say: (t) => token === this.token && this.say(t),
      done: (t) => {
        if (token !== this.token) return;
        this.completed.add(i);
        this.root.querySelectorAll('.tut-dots i')[i]?.classList.add('done');
        this.setNext(true);
        if (t) this.say(t);
      },
      point: (el) => token === this.token && this.pointAt(el),
      alive: () => token === this.token && this.isOpen,
    });
  }

  private setNext(enabled: boolean) {
    this.next.disabled = !enabled;
    this.next.classList.toggle('ready', enabled);
  }

  private say(text: string) {
    const mascot = this.root.querySelector('.tut-mascot')!;
    restart(mascot, 'talk');
    clearInterval(this.typing);
    this.bubble.dataset.full = text;
    this.bubble.textContent = '';
    restart(this.bubble, 'pop');
    let n = 0;
    this.typing = window.setInterval(() => {
      n += 2;
      this.bubble.textContent = text.slice(0, n);
      if (n >= text.length) this.finishTyping();
    }, 22);
  }

  private finishTyping() {
    clearInterval(this.typing);
    this.bubble.textContent = this.bubble.dataset.full ?? '';
    this.root.querySelector('.tut-mascot')!.classList.remove('talk');
  }

  private pointed: HTMLElement | null = null;
  private pointAt(el: HTMLElement | null) {
    this.pointed = el;
    this.finger.hidden = !el;
    this.placeFinger();
  }

  /** El dedo sigue a su objetivo en cada fotograma (se mueve con las animaciones y al cambiar de tamaño). */
  private placeFinger() {
    const el = this.pointed;
    if (!el || !this.isOpen) return;
    const card = this.root.querySelector('.tut-card')!;
    const c = card.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    this.finger.style.left = `${r.left - c.left + card.scrollLeft + r.width / 2}px`;
    this.finger.style.top = `${r.top - c.top + card.scrollTop + r.height * 0.6}px`;
    requestAnimationFrame(() => this.pointed === el && this.placeFinger());
  }
}
