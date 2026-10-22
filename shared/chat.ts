// Chat de grupo de la sala: mensajes de texto y emojis animados.

export interface ChatMessage {
  id: number;
  playerId: string;
  name: string;
  seat: number;
  text: string;
  emoji: boolean; // mensaje que es un único emoji de la lista (se anima en grande)
  at: number;
}

export const CHAT_MAX_LENGTH = 200;
export const CHAT_HISTORY = 50;

/** Emojis disponibles. `code` es su código en Noto Animated Emoji. */
export const EMOJIS: { char: string; code: string }[] = [
  { char: '😂', code: '1f602' },
  { char: '🤣', code: '1f923' },
  { char: '😍', code: '1f60d' },
  { char: '😎', code: '1f60e' },
  { char: '🥳', code: '1f973' },
  { char: '😱', code: '1f631' },
  { char: '😭', code: '1f62d' },
  { char: '😡', code: '1f621' },
  { char: '🤔', code: '1f914' },
  { char: '🤯', code: '1f92f' },
  { char: '😴', code: '1f634' },
  { char: '😈', code: '1f608' },
  { char: '👏', code: '1f44f' },
  { char: '👍', code: '1f44d' },
  { char: '🙏', code: '1f64f' },
  { char: '🔥', code: '1f525' },
  { char: '🎉', code: '1f389' },
  { char: '💯', code: '1f4af' },
];
