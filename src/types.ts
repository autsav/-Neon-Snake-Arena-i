export type Point = { x: number; y: number };
export type Direction = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';
export type PowerUpType = 'SPEED' | 'INVINCIBILITY' | 'GROWTH' | 'SHIELD';
export type GameStatus = 'WAITING' | 'COUNTDOWN' | 'PLAYING' | 'GAMEOVER';

export interface PowerUp {
  id: string;
  position: Point;
  type: PowerUpType;
}

export interface Player {
  id: string;
  name: string;
  color: string;
  snake: Point[];
  direction: Direction;
  nextDirection: Direction;
  score: number;
  isDead: boolean;
  activePowerUps: {
    speed?: number;
    invincibility?: number;
    shield?: number;
  };
  growthQueue: number;
  stats: {
    wins: number;
    longestSnake: number;
    totalScore: number;
    achievements: string[];
  };
}

export interface GameSettings {
  tickRate: number;
  gridSize: number;
  powerUpSpawnRate: number;
}

export interface GameState {
  players: Record<string, Player>;
  food: Point;
  powerUps: PowerUp[];
  gridSize: number;
  status: GameStatus;
  countdown: number;
  winner: string | null;
  settings: GameSettings;
  chatMessages: ChatMessage[];
  events: GameEvent[];
}

export interface GameEvent {
  id: string;
  type: 'SCORE' | 'POWERUP' | 'DEATH' | 'NEARMISS';
  message: string;
  timestamp: number;
}

export interface ChatMessage {
  id: string;
  playerId: string;
  playerName: string;
  playerColor: string;
  text: string;
  timestamp: number;
}

