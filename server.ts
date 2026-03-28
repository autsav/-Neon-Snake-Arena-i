import express from 'express';
import { createServer as createViteServer } from 'vite';
import { Server } from 'socket.io';
import { createServer } from 'http';
import path from 'path';
import { GameState, Player, Point, Direction, PowerUpType, GameStatus } from './src/types.js';

const PORT = 3000;
const DEFAULT_GRID_SIZE = 30;
const DEFAULT_TICK_RATE = 100; // ms per tick (10 fps)
const DEFAULT_SPAWN_RATE = 0.05; // 5% chance per tick
const COUNTDOWN_TIME = 5; // seconds

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' },
});

// Game State
let gameState: GameState = {
  players: {},
  food: { x: 10, y: 10 }, // Initial dummy food
  powerUps: [],
  gridSize: DEFAULT_GRID_SIZE,
  status: 'WAITING',
  countdown: 0,
  winner: null,
  settings: {
    tickRate: DEFAULT_TICK_RATE,
    gridSize: DEFAULT_GRID_SIZE,
    powerUpSpawnRate: DEFAULT_SPAWN_RATE,
  },
  chatMessages: [],
  events: [],
};

function logEvent(type: 'SCORE' | 'POWERUP' | 'DEATH' | 'NEARMISS', message: string) {
  const event = {
    id: Math.random().toString(36).substring(7),
    type,
    message,
    timestamp: Date.now(),
  };
  gameState.events.push(event);
  if (gameState.events.length > 20) {
    gameState.events.shift();
  }
}
gameState.food = getRandomFoodPosition();

function getRandomPowerUpType(): PowerUpType {
  const types: PowerUpType[] = ['SPEED', 'INVINCIBILITY', 'GROWTH', 'SHIELD'];
  return types[Math.floor(Math.random() * types.length)];
}

function spawnPowerUp() {
  let position;
  let valid = false;
  while (!valid) {
    position = getRandomFoodPosition();
    valid = true;
    if (position.x === gameState.food.x && position.y === gameState.food.y) valid = false;
    for (const p of gameState.powerUps) {
      if (p.position.x === position.x && p.position.y === position.y) valid = false;
    }
    for (const id in gameState.players) {
      const player = gameState.players[id];
      if (player.isDead) continue;
      for (const segment of player.snake) {
        if (segment.x === position.x && segment.y === position.y) {
          valid = false;
          break;
        }
      }
      if (!valid) break;
    }
  }
  
  gameState.powerUps.push({
    id: Math.random().toString(36).substring(7),
    position,
    type: getRandomPowerUpType(),
  });
}

function getRandomFoodPosition(): Point {
  return {
    x: Math.floor(Math.random() * gameState.settings.gridSize),
    y: Math.floor(Math.random() * gameState.settings.gridSize),
  };
}

function getInitialSnake(): Point[] {
  const size = gameState.settings.gridSize;
  const x = Math.floor(Math.random() * (size - 10)) + 5;
  const y = Math.floor(Math.random() * (size - 10)) + 5;
  return [{ x, y }, { x, y: y + 1 }, { x, y: y + 2 }];
}

function startCountdown() {
  gameState.status = 'COUNTDOWN';
  gameState.countdown = COUNTDOWN_TIME;
  gameState.winner = null;
  gameState.events = []; // Clear events for new game
  
  io.emit('sound', 'countdown'); // Initial sound

  const timer = setInterval(() => {
    gameState.countdown--;
    if (gameState.countdown > 0) {
      io.emit('sound', 'countdown');
    }
    if (gameState.countdown <= 0) {
      clearInterval(timer);
      io.emit('sound', 'start');
      gameState.status = 'PLAYING';
      // Reset all players for the new game
      for (const id in gameState.players) {
        const player = gameState.players[id];
        player.snake = getInitialSnake();
        player.direction = 'UP';
        player.nextDirection = 'UP';
        player.score = 0;
        player.isDead = false;
        player.activePowerUps = {};
        player.growthQueue = 0;
      }
    }
    io.emit('gameState', gameState);
  }, 1000);
}

// Persist stats by name during session
const sessionStats: { [name: string]: any } = {};

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  socket.on('join', (data: { name: string; color: string }) => {
    // Ensure unique name
    let finalName = data.name || `Player ${socket.id.slice(0, 4)}`;
    const existingNames = Object.values(gameState.players).map(p => p.name);
    let counter = 1;
    while (existingNames.includes(finalName)) {
      finalName = `${data.name} (${counter++})`;
    }

    // Restore stats if they exist
    const stats = sessionStats[finalName] || {
      wins: 0,
      longestSnake: 3,
      totalScore: 0,
      achievements: [],
    };

    gameState.players[socket.id] = {
      id: socket.id,
      name: finalName,
      color: data.color || '#3b82f6',
      snake: getInitialSnake(),
      direction: 'UP',
      nextDirection: 'UP',
      score: 0,
      isDead: false,
      activePowerUps: {},
      growthQueue: 0,
      stats,
    };

    sessionStats[finalName] = stats;


    if (gameState.status === 'WAITING' && Object.keys(gameState.players).length >= 1) {
      startCountdown();
    }

    socket.emit('gameState', gameState);
  });

  socket.on('chat', (text: string) => {
    const player = gameState.players[socket.id];
    if (!player || !text.trim()) return;

    const message = {
      id: Math.random().toString(36).substring(7),
      playerId: socket.id,
      playerName: player.name,
      playerColor: player.color,
      text: text.slice(0, 100), // Limit length
      timestamp: Date.now(),
    };

    gameState.chatMessages.push(message);
    if (gameState.chatMessages.length > 50) {
      gameState.chatMessages.shift();
    }

    io.emit('gameState', gameState);
  });

  socket.on('direction', (dir: Direction) => {
    const player = gameState.players[socket.id];
    if (!player || player.isDead || gameState.status !== 'PLAYING') return;

    const isOpposite =
      (player.direction === 'UP' && dir === 'DOWN') ||
      (player.direction === 'DOWN' && dir === 'UP') ||
      (player.direction === 'LEFT' && dir === 'RIGHT') ||
      (player.direction === 'RIGHT' && dir === 'LEFT');

    if (!isOpposite) {
      player.nextDirection = dir;
    }
  });

  socket.on('updateSettings', (settings: { tickRate?: number; gridSize?: number; powerUpSpawnRate?: number }) => {
    if (gameState.status === 'WAITING' || gameState.status === 'GAMEOVER') {
      if (settings.tickRate !== undefined) {
        gameState.settings.tickRate = Math.max(50, Math.min(200, settings.tickRate));
      }
      if (settings.gridSize !== undefined) {
        gameState.settings.gridSize = Math.max(15, Math.min(50, settings.gridSize));
        gameState.gridSize = gameState.settings.gridSize;
        gameState.food = getRandomFoodPosition();
        gameState.powerUps = [];
      }
      if (settings.powerUpSpawnRate !== undefined) {
        gameState.settings.powerUpSpawnRate = Math.max(0, Math.min(0.2, settings.powerUpSpawnRate));
      }
      io.emit('gameState', gameState);
    }
  });

  socket.on('restart', () => {
    if (gameState.status === 'GAMEOVER') {
      startCountdown();
    } else {
      const player = gameState.players[socket.id];
      if (player && player.isDead && gameState.status === 'PLAYING') {
        player.snake = getInitialSnake();
        player.direction = 'UP';
        player.nextDirection = 'UP';
        player.score = 0;
        player.isDead = false;
        player.activePowerUps = {};
        player.growthQueue = 0;
      }
    }
  });

  socket.on('disconnect', () => {
    console.log('Player disconnected:', socket.id);
    delete gameState.players[socket.id];
    if (Object.keys(gameState.players).length === 0) {
      gameState.status = 'WAITING';
      gameState.powerUps = [];
    }
  });
});

// Game Loop
let lastTickTime = Date.now();
const gameLoop = () => {
  const now = Date.now();
  const tickRate = gameState.settings.tickRate;
  
  if (now - lastTickTime >= tickRate) {
    lastTickTime = now;
    updateGame();
  }
  
  setTimeout(gameLoop, 10); // Check frequently but update based on tickRate
};

function updateGame() {
  if (gameState.status !== 'PLAYING') return;

  let foodEaten = false;

  // Randomly spawn power-ups
  if (Math.random() < gameState.settings.powerUpSpawnRate && gameState.powerUps.length < 5) {
    spawnPowerUp();
  }

  const alivePlayers = Object.values(gameState.players).filter(p => !p.isDead);
  if (alivePlayers.length === 0 && Object.keys(gameState.players).length > 0) {
    gameState.status = 'GAMEOVER';
    // Find winner (highest score)
    const allPlayers = Object.values(gameState.players);
    if (allPlayers.length > 0) {
      const winner = allPlayers.reduce((prev, current) => (prev.score > current.score) ? prev : current);
      gameState.winner = winner.name;
      winner.stats.wins += 1;
    }
    io.emit('gameState', gameState);
    return;
  }

  for (const id in gameState.players) {
    const player = gameState.players[id];
    if (player.isDead) continue;

    // Decrement power-up timers
    if (player.activePowerUps.speed) {
      player.activePowerUps.speed--;
      if (player.activePowerUps.speed <= 0) delete player.activePowerUps.speed;
    }
    if (player.activePowerUps.invincibility) {
      player.activePowerUps.invincibility--;
      if (player.activePowerUps.invincibility <= 0) delete player.activePowerUps.invincibility;
    }
    if (player.activePowerUps.shield) {
      player.activePowerUps.shield--;
      if (player.activePowerUps.shield <= 0) delete player.activePowerUps.shield;
    }

    // Determine how many times to move this tick
    const moves = player.activePowerUps.speed ? 2 : 1;

    for (let m = 0; m < moves; m++) {
      if (player.isDead) break;

      player.direction = player.nextDirection;
      const head = player.snake[0];
      const newHead = { ...head };

      switch (player.direction) {
        case 'UP': newHead.y -= 1; break;
        case 'DOWN': newHead.y += 1; break;
        case 'LEFT': newHead.x -= 1; break;
        case 'RIGHT': newHead.x += 1; break;
      }

      // Near-miss detection for commentary
      const neighbors = [
        { x: newHead.x + 1, y: newHead.y },
        { x: newHead.x - 1, y: newHead.y },
        { x: newHead.x, y: newHead.y + 1 },
        { x: newHead.x, y: newHead.y - 1 },
      ];

      const size = gameState.settings.gridSize;
      let nearMiss = false;
      for (const neighbor of neighbors) {
        // Wall near-miss
        if (neighbor.x < 0 || neighbor.x >= size || neighbor.y < 0 || neighbor.y >= size) {
          nearMiss = true;
          break;
        }
        // Other snake near-miss
        for (const otherId in gameState.players) {
          const otherPlayer = gameState.players[otherId];
          if (otherPlayer.isDead) continue;
          for (const segment of otherPlayer.snake) {
            if (segment.x === neighbor.x && segment.y === neighbor.y) {
              nearMiss = true;
              break;
            }
          }
          if (nearMiss) break;
        }
        if (nearMiss) break;
      }

      // Power-up near-miss
      for (const p of gameState.powerUps) {
        for (const neighbor of neighbors) {
          if (p.position.x === neighbor.x && p.position.y === neighbor.y) {
            nearMiss = true;
            io.to(player.id).emit('sound', 'near-miss-powerup');
            break;
          }
        }
        if (nearMiss) break;
      }

      if (nearMiss && Math.random() < 0.1) { // 10% chance to trigger sound/event for near-miss
        io.to(player.id).emit('sound', 'near-miss');
        logEvent('NEARMISS', `${player.name} just narrowly avoided a collision!`);
      }

      // Wall collision
      if (
        newHead.x < 0 ||
        newHead.x >= size ||
        newHead.y < 0 ||
        newHead.y >= size
      ) {
        if (player.activePowerUps.invincibility || player.activePowerUps.shield) {
          // Wrap around if invincible or shielded
          if (newHead.x < 0) newHead.x = size - 1;
          else if (newHead.x >= size) newHead.x = 0;
          if (newHead.y < 0) newHead.y = size - 1;
          else if (newHead.y >= size) newHead.y = 0;
        } else {
          player.isDead = true;
          io.emit('sound', 'death'); // Broadcast death sound
          logEvent('DEATH', `${player.name} crashed into a wall!`);
          break;
        }
      }

      // Self/Other snake collision
      let collided = false;
      for (const otherId in gameState.players) {
        const otherPlayer = gameState.players[otherId];
        if (otherPlayer.isDead) continue;
        
        for (const segment of otherPlayer.snake) {
          if (segment.x === newHead.x && segment.y === newHead.y) {
            collided = true;
            break;
          }
        }
        if (collided) break;
      }

      if (collided && !player.activePowerUps.invincibility && !player.activePowerUps.shield) {
        player.isDead = true;
        io.emit('sound', 'death'); // Broadcast death sound
        logEvent('DEATH', `${player.name} collided with another snake!`);
        break;
      }

      player.snake.unshift(newHead);

      // Food collision
      if (newHead.x === gameState.food.x && newHead.y === gameState.food.y) {
        player.score += 10;
        player.stats.totalScore += 10;
        player.growthQueue += 1;
        
        if (player.score % 50 === 0) {
          logEvent('SCORE', `${player.name} reached ${player.score} points!`);
        }

        // Achievement: Score 100 points
        if (player.score >= 100 && !player.stats.achievements.includes('Centurion')) {
          player.stats.achievements.push('Centurion');
        }
        
        if (player.snake.length + 1 > player.stats.longestSnake) {
          player.stats.longestSnake = player.snake.length + 1;
          
          // Achievement: Longest snake
          if (player.stats.longestSnake >= 20 && !player.stats.achievements.includes('Giant Snake')) {
            player.stats.achievements.push('Giant Snake');
          }
        }
        foodEaten = true;
        io.to(player.id).emit('sound', 'eat');
      }

      // Power-up collision
      const powerUpIndex = gameState.powerUps.findIndex(p => p.position.x === newHead.x && p.position.y === newHead.y);
      if (powerUpIndex !== -1) {
        const powerUp = gameState.powerUps[powerUpIndex];
        if (powerUp.type === 'SPEED') {
          player.activePowerUps.speed = 50; // 5 seconds
          logEvent('POWERUP', `${player.name} activated SPEED!`);
        } else if (powerUp.type === 'INVINCIBILITY') {
          player.activePowerUps.invincibility = 50; // 5 seconds
          logEvent('POWERUP', `${player.name} activated INVINCIBILITY!`);
        } else if (powerUp.type === 'GROWTH') {
          player.growthQueue += 5;
          logEvent('POWERUP', `${player.name} grabbed a GROWTH power-up!`);
        } else if (powerUp.type === 'SHIELD') {
          player.activePowerUps.shield = 50; // 5 seconds
          logEvent('POWERUP', `${player.name} activated SHIELD!`);
        }
        gameState.powerUps.splice(powerUpIndex, 1);
        io.to(player.id).emit('sound', 'powerup');
      }

      if (player.growthQueue > 0) {
        player.growthQueue--;
      } else {
        player.snake.pop();
      }
    }
  }

  if (foodEaten) {
    // Make sure food doesn't spawn on a snake or powerup
    let newFood;
    let valid = false;
    while (!valid) {
      newFood = getRandomFoodPosition();
      valid = true;
      for (const id in gameState.players) {
        const player = gameState.players[id];
        if (player.isDead) continue;
        for (const segment of player.snake) {
          if (segment.x === newFood.x && segment.y === newFood.y) {
            valid = false;
            break;
          }
        }
        if (!valid) break;
      }
      for (const p of gameState.powerUps) {
        if (p.position.x === newFood.x && p.position.y === newFood.y) valid = false;
      }
    }
    gameState.food = newFood!;
  }

  io.emit('gameState', gameState);
}

gameLoop();

async function startServer() {
  // API routes FIRST
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
