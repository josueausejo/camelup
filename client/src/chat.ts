import type { Socket } from 'socket.io-client';
import { EMOJIS, CHAT_MAX_LENGTH, type ChatMessage } from '../../shared/chat';
import type { ClientToServer, RoomView, ServerToClient } from '../../shared/protocol';
import { PLAYER_COLORS } from './scene/models';

// Chat de grupo con emojis animados (Noto Animated Emoji de Google; si no cargan,
// se muestra el emoji normal con una animación CSS).

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const QUICK = 8; // emojis visibles en la barra rápida

const emojiCode = (char: string) => EMOJIS.find((e) => e.char === char)?.code;

/** <img> animado del emoji; si falla la carga se sustituye por el carácter. */
function emojiHtml(char: string, cls = '') {
  const code = emojiCode(char);
  if (!code) return `<span class="emo-fallback ${cls}">${esc(char)}</span>`;
  return `<img class="emo ${cls}" alt="${char}" draggable="false" src="https://fonts.gstatic.com/s/e/notoemoji/latest/${code}/512.webp" />`;
}

function fixBrokenEmojis(root: ParentNode) {
  root.querySelectorAll<HTMLImageElement>('img.emo:not([data-watch])').forEach((img) => {
    img.dataset.watch = '1';
    const swap = () => {
      const span = document.createElement('span');
      span.className = img.className.replace('emo', 'emo-fallback');
      span.textContent = img.alt;
      img.replaceWith(span);
    };
    if (img.complete && img.naturalWidth === 0) swap();
    else img.addEventListener('error', swap, { once: true });
  });
}

export class Chat {
  private panel: HTMLElement;
  private list: HTMLOListElement;
  private input: HTMLInputElement;
  private bar: HTMLElement;
  private reactions: HTMLElement;
  private peek: HTMLElement;
  private messages: ChatMessage[] = [];
  private unread = 0;
  private open = false;
  private expanded = false;
  private room: RoomView | null = null;
  private peekTimer = 0;
  /** Se llama cuando cambia el número de mensajes sin leer. */
  onUnread: (n: number) => void = () => {};

  constructor(
    private socket: Socket<ServerToClient, ClientToServer>,
    private me: string,
  ) {
    this.panel = document.createElement('section');
    this.panel.className = 'chat';
    this.panel.hidden = true;
    this.panel.innerHTML = `
      <header><h3>💬 Chat de la sala</h3><button class="icon small" data-close title="Cerrar">✕</button></header>
      <ol class="chat-list"></ol>
      <div class="emoji-bar"></div>
      <form class="chat-form">
        <button type="button" class="icon small ghost" data-more title="Más emojis">😊</button>
        <input maxlength="${CHAT_MAX_LENGTH}" placeholder="Escribe un mensaje…" autocomplete="off" />
        <button type="submit" class="primary small" title="Enviar">➤</button>
      </form>`;
    document.body.appendChild(this.panel);
    this.list = this.panel.querySelector('.chat-list')!;
    this.input = this.panel.querySelector('input')!;
    this.bar = this.panel.querySelector('.emoji-bar')!;

    this.reactions = document.createElement('div');
    this.reactions.className = 'reactions';
    this.peek = document.createElement('div');
    this.peek.className = 'chat-peek';
    this.peek.hidden = true;
    this.peek.onclick = () => this.show();
    document.body.append(this.reactions, this.peek);

    this.panel.querySelector<HTMLButtonElement>('[data-close]')!.onclick = () => this.hide();
    this.panel.querySelector<HTMLButtonElement>('[data-more]')!.onclick = () => {
      this.expanded = !this.expanded;
      this.renderBar();
    };
    this.panel.querySelector('form')!.addEventListener('submit', (e) => {
      e.preventDefault();
      this.send(this.input.value, false);
      this.input.value = '';
    });
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.hide();
    });
    this.renderBar();

    socket.on('chatHistory', (msgs) => {
      this.messages = msgs;
      this.renderList();
    });
    socket.on('chat', (m) => this.receive(m));
  }

  setRoom(room: RoomView | null) {
    if (!room && this.room) {
      this.messages = [];
      this.renderList();
      this.hide();
      this.setUnread(0);
    }
    this.room = room;
  }

  toggle() {
    if (this.open) this.hide();
    else this.show();
  }

  show() {
    this.open = true;
    this.panel.hidden = false;
    this.peek.hidden = true;
    document.body.classList.add('chat-open');
    this.setUnread(0);
    this.scrollToEnd();
    if (window.matchMedia('(pointer: fine)').matches) this.input.focus();
  }

  hide() {
    this.open = false;
    this.panel.hidden = true;
    document.body.classList.remove('chat-open');
  }

  private setUnread(n: number) {
    this.unread = n;
    this.onUnread(n);
  }

  private send(text: string, emoji: boolean) {
    text = text.trim();
    if (!text || !this.room) return;
    this.socket.emit('chat', { text, emoji });
  }

  private receive(m: ChatMessage) {
    this.messages.push(m);
    if (this.messages.length > 60) this.messages.shift();
    this.appendMessage(m, true);
    if (m.emoji) this.launchReaction(m);
    if (!this.open && m.playerId !== this.me) {
      this.setUnread(this.unread + 1);
      if (!m.emoji) this.showPeek(m);
    }
  }

  // ---------- Render ----------

  private renderBar() {
    const list = this.expanded ? EMOJIS : EMOJIS.slice(0, QUICK);
    this.bar.classList.toggle('expanded', this.expanded);
    this.bar.innerHTML = list
      .map((e) => `<button type="button" class="emoji-btn" data-emoji="${e.char}" title="Enviar ${e.char}">${emojiHtml(e.char)}</button>`)
      .join('');
    this.bar.querySelectorAll<HTMLButtonElement>('[data-emoji]').forEach(
      (b) =>
        (b.onclick = () => {
          b.classList.remove('sent');
          void b.offsetWidth;
          b.classList.add('sent');
          this.send(b.dataset.emoji!, true);
        }),
    );
    fixBrokenEmojis(this.bar);
  }

  private messageHtml(m: ChatMessage) {
    const color = PLAYER_COLORS[m.seat % PLAYER_COLORS.length];
    const mine = m.playerId === this.me;
    const time = new Date(m.at).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
    const body = m.emoji ? emojiHtml(m.text, 'big') : esc(m.text);
    return `<li class="msg ${mine ? 'mine' : ''} ${m.emoji ? 'emoji-only' : ''}" style="--pc:${color}">
      <div class="meta"><span class="dot"></span><b>${esc(m.name)}</b><time>${time}</time></div>
      <div class="bubble">${body}</div>
    </li>`;
  }

  private renderList() {
    this.list.innerHTML = this.messages.length
      ? this.messages.map((m) => this.messageHtml(m)).join('')
      : '<li class="empty">Aún no hay mensajes. ¡Saluda! 👋</li>';
    fixBrokenEmojis(this.list);
    this.scrollToEnd();
  }

  private appendMessage(m: ChatMessage, animate: boolean) {
    this.list.querySelector('.empty')?.remove();
    this.list.insertAdjacentHTML('beforeend', this.messageHtml(m));
    const li = this.list.lastElementChild as HTMLElement;
    if (animate) li.classList.add('new');
    while (this.list.children.length > 60) this.list.firstElementChild?.remove();
    fixBrokenEmojis(li);
    this.scrollToEnd();
  }

  private scrollToEnd() {
    requestAnimationFrame(() => (this.list.scrollTop = this.list.scrollHeight));
  }

  private showPeek(m: ChatMessage) {
    const color = PLAYER_COLORS[m.seat % PLAYER_COLORS.length];
    this.peek.innerHTML = `<b style="color:${color}">${esc(m.name)}:</b> ${esc(m.text)}`;
    this.peek.hidden = false;
    this.peek.classList.remove('show');
    void this.peek.offsetWidth;
    this.peek.classList.add('show');
    clearTimeout(this.peekTimer);
    this.peekTimer = window.setTimeout(() => (this.peek.hidden = true), 4000);
  }

  /** El emoji sube flotando por la pantalla y aparece junto al nombre del jugador. */
  private launchReaction(m: ChatMessage) {
    const color = PLAYER_COLORS[m.seat % PLAYER_COLORS.length];
    const el = document.createElement('div');
    el.className = 'reaction';
    el.style.left = `${8 + Math.random() * 84}%`;
    el.style.setProperty('--pc', color);
    el.style.setProperty('--drift', `${(Math.random() - 0.5) * 120}px`);
    el.innerHTML = `<div class="sway">${emojiHtml(m.text)}<span class="who">${esc(m.name)}</span></div>`;
    fixBrokenEmojis(el);
    this.reactions.appendChild(el);
    setTimeout(() => el.remove(), 3300);

    const head = document.querySelector(`.player[data-player="${CSS.escape(m.playerId)}"] .head`);
    if (head) {
      head.querySelector('.card-emoji')?.remove();
      head.insertAdjacentHTML('beforeend', `<span class="card-emoji">${emojiHtml(m.text)}</span>`);
      const badge = head.querySelector('.card-emoji')!;
      fixBrokenEmojis(badge);
      setTimeout(() => badge.remove(), 2800);
    }
  }
}
