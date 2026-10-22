import { audio } from './engine';
import { syncMusic } from './music';
import { sfx } from './sfx';

// Panel de sonido: música y efectos con interruptor y volumen propios.
// También desbloquea el audio en el primer gesto del usuario (requisito de los navegadores).

export class SoundPanel {
  private el: HTMLElement;
  private buttons = new Set<HTMLElement>();

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'sound-panel';
    this.el.hidden = true;
    this.el.innerHTML = `
      <h4>Sonido</h4>
      <label class="srow"><input type="checkbox" data-k="music" /> <span>🎵 Música</span>
        <input type="range" min="0" max="100" data-v="musicVolume" /></label>
      <label class="srow"><input type="checkbox" data-k="sfx" /> <span>🔔 Efectos</span>
        <input type="range" min="0" max="100" data-v="sfxVolume" /></label>
      <p class="shint">La música es una melodía egipcia generada al momento: nunca suena igual.</p>`;
    document.body.appendChild(this.el);

    this.el.querySelectorAll<HTMLInputElement>('[data-k]').forEach((cb) => {
      cb.onchange = () => {
        audio.unlock();
        audio.update({ [cb.dataset.k!]: cb.checked });
        syncMusic();
        this.paint();
        if (cb.dataset.k === 'sfx' && cb.checked) sfx.coin();
      };
    });
    this.el.querySelectorAll<HTMLInputElement>('[data-v]').forEach((range) => {
      range.oninput = () => {
        audio.update({ [range.dataset.v!]: Number(range.value) / 100 });
        syncMusic();
        this.paint();
      };
      range.onchange = () => range.dataset.v === 'sfxVolume' && sfx.coin();
    });

    // cerrar al pulsar fuera
    document.addEventListener('pointerdown', (e) => {
      if (this.el.hidden) return;
      const t = e.target as Node;
      if (this.el.contains(t) || [...this.buttons].some((b) => b.contains(t))) return;
      this.el.hidden = true;
    });

    // el audio solo puede empezar tras un gesto del usuario
    const unlock = () => {
      audio.unlock();
      if (audio.ready) {
        window.removeEventListener('pointerdown', unlock);
        window.removeEventListener('keydown', unlock);
      }
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    audio.onReady(() => {
      // al reanudarse el contexto (tras el gesto) arranca la música
      const ctx = audio.ctx!;
      ctx.addEventListener('statechange', () => syncMusic());
      syncMusic();
    });
    this.paint();
  }

  /** Conecta un botón que abre/cierra el panel y muestra el estado (🔊/🔇). */
  attach(button: HTMLElement) {
    for (const b of this.buttons) if (!b.isConnected) this.buttons.delete(b); // botones de un lobby ya redibujado
    this.buttons.add(button);
    button.onclick = () => {
      audio.unlock();
      this.toggle(button);
    };
    this.paint();
  }

  private toggle(anchor: HTMLElement) {
    if (!this.el.hidden) {
      this.el.hidden = true;
      return;
    }
    const r = anchor.getBoundingClientRect();
    this.el.hidden = false;
    this.paint();
    // debajo del botón; si no cabe, encima
    const h = this.el.offsetHeight;
    const below = r.bottom + 8 + h <= window.innerHeight - 8;
    this.el.style.top = `${below ? r.bottom + 8 : Math.max(8, r.top - 8 - h)}px`;
    this.el.style.left = `${Math.max(8, Math.min(window.innerWidth - 268, r.right - 260))}px`;
  }

  private paint() {
    const s = audio.settings;
    this.el.querySelectorAll<HTMLInputElement>('[data-k]').forEach((cb) => (cb.checked = !!s[cb.dataset.k as 'music' | 'sfx']));
    this.el.querySelectorAll<HTMLInputElement>('[data-v]').forEach(
      (range) => (range.value = String(Math.round(s[range.dataset.v as 'musicVolume' | 'sfxVolume'] * 100))),
    );
    const silent = !(s.music && s.musicVolume > 0) && !(s.sfx && s.sfxVolume > 0);
    for (const b of this.buttons) {
      const icon = b.querySelector('.ico') ?? b;
      icon.textContent = silent ? '🔇' : '🔊';
    }
  }
}
