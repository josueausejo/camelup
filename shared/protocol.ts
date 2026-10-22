import type { ChatMessage } from './chat';
import type { Action, GameState } from './game';

export interface LobbyPlayer {
  id: string;
  name: string;
  connected: boolean;
  tutorial?: boolean; // está viendo el tutorial (solo informativo)
}

export interface RoomView {
  code: string;
  hostId: string;
  players: LobbyPlayer[];
  game: GameState | null;
}

/** Lanzamiento decorativo de una persona del público (no afecta a la partida). */
export interface FlingData {
  seat: number;
  pos: [number, number, number];
  vel: [number, number, number];
  spin: [number, number, number];
}

export interface ClientToServer {
  createRoom: (data: { playerId: string; name: string }, ack: (res: { code?: string; error?: string }) => void) => void;
  joinRoom: (
    data: { playerId: string; name: string; code: string },
    ack: (res: { code?: string; error?: string }) => void,
  ) => void;
  leaveRoom: () => void;
  startGame: (ack: (res: { error?: string }) => void) => void;
  action: (action: Action, ack: (res: { error?: string }) => void) => void;
  playAgain: () => void;
  chat: (data: { text: string; emoji: boolean }) => void;
  tutorial: (open: boolean) => void;
  fling: (data: FlingData) => void;
}

export interface ServerToClient {
  room: (room: RoomView | null) => void;
  chat: (message: ChatMessage) => void;
  chatHistory: (messages: ChatMessage[]) => void;
  fling: (data: FlingData) => void;
}
