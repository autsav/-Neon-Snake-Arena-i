/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { GameState, Direction, Player } from './types';
import { Trophy, Skull, Play, Zap, Shield, PlusCircle, Eye, Music, MessageSquare, Settings, User, Target } from 'lucide-react';
import { GoogleGenAI, Modality } from "@google/genai";
import Markdown from 'react-markdown';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Utility for Tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const CELL_SIZE = 20;
const COLORS = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#ffffff'];

// Sound utility
let audioCtx: AudioContext | null = null;
const playSound = (type: 'eat' | 'powerup' | 'death' | 'near-miss' | 'near-miss-powerup' | 'countdown' | 'start', muted: boolean) => {
  if (muted) return;
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  const ctx = audioCtx;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  
  osc.connect(gain);
  gain.connect(ctx.destination);
  
  const now = ctx.currentTime;
  
  if (type === 'eat') {
    osc.type = 'sine';
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.1);
    gain.gain.setValueAtTime(0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
    osc.start(now);
    osc.stop(now + 0.1);
  } else if (type === 'powerup' || type === 'near-miss-powerup') {
    osc.type = 'square';
    osc.frequency.setValueAtTime(type === 'powerup' ? 220 : 440, now);
    osc.frequency.exponentialRampToValueAtTime(type === 'powerup' ? 660 : 880, now + 0.2);
    gain.gain.setValueAtTime(0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
    osc.start(now);
    osc.stop(now + 0.2);
  } else if (type === 'death') {
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(55, now + 0.3);
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
    osc.start(now);
    osc.stop(now + 0.3);
  } else if (type === 'near-miss') {
    osc.type = 'sine';
    osc.frequency.setValueAtTime(110, now);
    osc.frequency.exponentialRampToValueAtTime(220, now + 0.1);
    gain.gain.setValueAtTime(0.05, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
    osc.start(now);
    osc.stop(now + 0.1);
  } else if (type === 'countdown') {
    osc.type = 'sine';
    osc.frequency.setValueAtTime(440, now);
    gain.gain.setValueAtTime(0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
    osc.start(now);
    osc.stop(now + 0.1);
  } else if (type === 'start') {
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, now);
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
    osc.start(now);
    osc.stop(now + 0.3);
  }
};

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [myId, setMyId] = useState<string>('');
  const [hasJoined, setHasJoined] = useState(false);
  const [playerName, setPlayerName] = useState('');
  const [playerColor, setPlayerColor] = useState(COLORS[1]);
  const [isMuted, setIsMuted] = useState(false);
  const [activeTab, setActiveTab] = useState<'JOIN' | 'STATS' | 'SETTINGS'>('JOIN');
  const [chatInput, setChatInput] = useState('');
  const [musicGenre, setMusicGenre] = useState('8-bit synthwave');
  const [musicMood, setMusicMood] = useState('high-energy');
  const [personalStats, setPersonalStats] = useState({
    wins: 0,
    longestSnake: 0,
    totalScore: 0,
    achievements: [] as string[]
  });
  
  // AI & Music states
  const [commentary, setCommentary] = useState<string[]>([]);
  const [isGeneratingMusic, setIsGeneratingMusic] = useState(false);
  const [musicUrl, setMusicUrl] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const prevStatusRef = useRef<string>('');

  // Viral monetization state
  const [deathRoast, setDeathRoast] = useState<string | null>(null);
  const [isGeneratingRoast, setIsGeneratingRoast] = useState(false);

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [gameState?.chatMessages]);

  useEffect(() => {
    const savedStats = localStorage.getItem('snake_stats');
    if (savedStats) {
      setPersonalStats(JSON.parse(savedStats));
    }
  }, []);

  useEffect(() => {
    if (gameState && myId && gameState.players[myId]) {
      const myStats = gameState.players[myId].stats;
      if (myStats.wins > personalStats.wins || 
          myStats.longestSnake > personalStats.longestSnake || 
          myStats.totalScore > personalStats.totalScore ||
          (myStats.achievements?.length || 0) > (personalStats.achievements?.length || 0)) {
        const newStats = {
          wins: Math.max(personalStats.wins, myStats.wins),
          longestSnake: Math.max(personalStats.longestSnake, myStats.longestSnake),
          totalScore: Math.max(personalStats.totalScore, myStats.totalScore),
          achievements: Array.from(new Set([...personalStats.achievements, ...myStats.achievements]))
        };
        setPersonalStats(newStats);
        localStorage.setItem('snake_stats', JSON.stringify(newStats));
      }
    }
  }, [gameState, myId]);

  useEffect(() => {
    const newSocket = io();
    setSocket(newSocket);

    newSocket.on('connect', () => {
      setMyId(newSocket.id || '');
    });

    newSocket.on('gameState', (state: GameState) => {
      setGameState(state);
    });

    newSocket.on('sound', (type: 'eat' | 'powerup' | 'death' | 'near-miss' | 'near-miss-powerup' | 'countdown' | 'start') => {
      playSound(type as any, isMuted);
      if (type === 'death' || type === 'powerup' || type === 'near-miss' || type === 'near-miss-powerup') {
        let eventMsg = "";
        if (type === 'death') eventMsg = "A player just died!";
        if (type === 'powerup') eventMsg = "A player collected a power-up!";
        if (type === 'near-miss') eventMsg = "Whoa! That was a close call!";
        if (type === 'near-miss-powerup') eventMsg = "Someone almost grabbed a power-up!";
        getCommentary(eventMsg);
      }
    });

    return () => {
      newSocket.disconnect();
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!socket || !hasJoined) return;
      
      // Chat focus check
      if (document.activeElement?.tagName === 'INPUT') return;

      if (e.key.toLowerCase() === 'r') {
        handleRestart();
        return;
      }
      
      let dir: Direction | null = null;
      switch (e.key) {
        case 'ArrowUp': case 'w': case 'W': dir = 'UP'; break;
        case 'ArrowDown': case 's': case 'S': dir = 'DOWN'; break;
        case 'ArrowLeft': case 'a': case 'A': dir = 'LEFT'; break;
        case 'ArrowRight': case 'd': case 'D': dir = 'RIGHT'; break;
      }

      if (dir) {
        e.preventDefault();
        socket.emit('direction', dir);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [socket, hasJoined]);

  useEffect(() => {
    if (!gameState || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#1e1e1e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Grid
    ctx.strokeStyle = '#2d2d2d';
    ctx.lineWidth = 1;
    for (let i = 0; i <= gameState.gridSize; i++) {
      ctx.beginPath();
      ctx.moveTo(i * CELL_SIZE, 0);
      ctx.lineTo(i * CELL_SIZE, canvas.height);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i * CELL_SIZE);
      ctx.lineTo(canvas.width, i * CELL_SIZE);
      ctx.stroke();
    }

    // Food
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.arc(gameState.food.x * CELL_SIZE + CELL_SIZE / 2, gameState.food.y * CELL_SIZE + CELL_SIZE / 2, CELL_SIZE / 2 - 2, 0, 2 * Math.PI);
    ctx.fill();

    // Power-ups
    gameState.powerUps?.forEach((powerUp) => {
      ctx.beginPath();
      if (powerUp.type === 'SPEED') {
        ctx.fillStyle = '#3b82f6';
        ctx.moveTo(powerUp.position.x * CELL_SIZE + CELL_SIZE / 2, powerUp.position.y * CELL_SIZE + 2);
        ctx.lineTo(powerUp.position.x * CELL_SIZE + CELL_SIZE - 2, powerUp.position.y * CELL_SIZE + CELL_SIZE - 2);
        ctx.lineTo(powerUp.position.x * CELL_SIZE + 2, powerUp.position.y * CELL_SIZE + CELL_SIZE - 2);
      } else if (powerUp.type === 'INVINCIBILITY') {
        ctx.fillStyle = '#eab308';
        ctx.rect(powerUp.position.x * CELL_SIZE + 4, powerUp.position.y * CELL_SIZE + 4, CELL_SIZE - 8, CELL_SIZE - 8);
      } else if (powerUp.type === 'GROWTH') {
        ctx.fillStyle = '#a855f7';
        ctx.rect(powerUp.position.x * CELL_SIZE + CELL_SIZE / 2 - 2, powerUp.position.y * CELL_SIZE + 2, 4, CELL_SIZE - 4);
        ctx.rect(powerUp.position.x * CELL_SIZE + 2, powerUp.position.y * CELL_SIZE + CELL_SIZE / 2 - 2, CELL_SIZE - 4, 4);
      } else if (powerUp.type === 'SHIELD') {
        ctx.fillStyle = '#10b981';
        ctx.beginPath();
        ctx.arc(powerUp.position.x * CELL_SIZE + CELL_SIZE / 2, powerUp.position.y * CELL_SIZE + CELL_SIZE / 2, CELL_SIZE / 2 - 4, 0, 2 * Math.PI);
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ctx.fill();
    });

    // Snakes
    const time = Date.now() / 1000;
    for (const id in gameState.players) {
      const player = gameState.players[id];
      const x = player.snake[0].x * CELL_SIZE;
      const y = player.snake[0].y * CELL_SIZE;

      if (player.isDead) {
        // Draw skull or cross on dead snake head
        ctx.fillStyle = '#ef4444';
        ctx.font = '16px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('💀', x + CELL_SIZE / 2, y + CELL_SIZE / 2 + 5);
        continue;
      }

      const isIdle = gameState.status !== 'PLAYING';
      const pulse = Math.sin(time * 5) * 2;
      const breathe = Math.sin(time * 2) * 1.5;

      ctx.fillStyle = player.color;
      player.snake.forEach((segment, index) => {
        const x = segment.x * CELL_SIZE;
        const y = segment.y * CELL_SIZE;
        
        // Subtle animation for segments
        const segmentPulse = Math.sin(time * 4 - index * 0.5) * 1;
        const sizeOffset = isIdle ? breathe : segmentPulse;

        if (index === 0) {
          // Power-up effects on head
          if (player.activePowerUps?.invincibility) {
            ctx.shadowBlur = 15 + pulse;
            ctx.shadowColor = '#eab308';
            // Aura
            ctx.strokeStyle = '#eab308';
            ctx.lineWidth = 2;
            ctx.strokeRect(x - 2, y - 2, CELL_SIZE + 4, CELL_SIZE + 4);
          } else if (player.activePowerUps?.speed) {
            ctx.shadowBlur = 15 + pulse;
            ctx.shadowColor = '#3b82f6';
            // Aura
            ctx.strokeStyle = '#3b82f6';
            ctx.lineWidth = 2;
            ctx.strokeRect(x - 2, y - 2, CELL_SIZE + 4, CELL_SIZE + 4);
          } else if (player.activePowerUps?.shield) {
            ctx.shadowBlur = 15 + pulse;
            ctx.shadowColor = '#10b981';
            // Aura
            ctx.strokeStyle = '#10b981';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(x + CELL_SIZE / 2, y + CELL_SIZE / 2, CELL_SIZE / 2 + 4, 0, 2 * Math.PI);
            ctx.stroke();
          }

          ctx.fillRect(x + 1 - sizeOffset, y + 1 - sizeOffset, CELL_SIZE - 2 + sizeOffset * 2, CELL_SIZE - 2 + sizeOffset * 2);
          
          if (player.growthQueue > 0) {
            ctx.fillStyle = '#a855f7';
            ctx.font = '10px sans-serif';
            ctx.fillText('+', x + CELL_SIZE / 2, y + CELL_SIZE / 2 + 4);
            ctx.fillStyle = player.color;
          }
          
          // Reset shadow
          ctx.shadowBlur = 0;
          ctx.shadowColor = 'transparent';

          // Eyes
          ctx.fillStyle = '#fff';
          const eyeSize = 3;
          let ex1, ey1, ex2, ey2;
          if (player.direction === 'UP') { ex1 = x + 4; ey1 = y + 4; ex2 = x + CELL_SIZE - 4 - eyeSize; ey2 = y + 4; }
          else if (player.direction === 'DOWN') { ex1 = x + 4; ey1 = y + CELL_SIZE - 4 - eyeSize; ex2 = x + CELL_SIZE - 4 - eyeSize; ey2 = y + CELL_SIZE - 4 - eyeSize; }
          else if (player.direction === 'LEFT') { ex1 = x + 4; ey1 = y + 4; ex2 = x + 4; ey2 = y + CELL_SIZE - 4 - eyeSize; }
          else { ex1 = x + CELL_SIZE - 4 - eyeSize; ey1 = y + 4; ex2 = x + CELL_SIZE - 4 - eyeSize; ey2 = y + CELL_SIZE - 4 - eyeSize; }
          ctx.fillRect(ex1, ey1, eyeSize, eyeSize);
          ctx.fillRect(ex2, ey2, eyeSize, eyeSize);
          
          // Name above snake
          ctx.fillStyle = '#fff';
          ctx.font = '10px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(player.name, x + CELL_SIZE / 2, y - 5);
          
          ctx.fillStyle = player.color;
        } else {
          ctx.fillRect(x + 1 - sizeOffset / 2, y + 1 - sizeOffset / 2, CELL_SIZE - 2 + sizeOffset, CELL_SIZE - 2 + sizeOffset);
        }
      });
    }
  }, [gameState]);

  const handleJoin = () => {
    if (socket && playerName.trim()) {
      socket.emit('join', { name: playerName, color: playerColor });
      setHasJoined(true);
    }
  };

  const handleRestart = () => {
    if (socket) socket.emit('restart');
  };

  const handleUpdateSettings = (settings: { tickRate?: number; gridSize?: number; powerUpSpawnRate?: number }) => {
    if (socket) {
      socket.emit('updateSettings', settings);
    }
  };

  const sendChat = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (socket && chatInput.trim()) {
      socket.emit('chat', chatInput);
      setChatInput('');
    }
  };

  const generateMusic = async () => {
    if (isGeneratingMusic) return;

    // Check for API key selection for Lyria model
    if (typeof window !== 'undefined' && (window as any).aistudio) {
      const hasKey = await (window as any).aistudio.hasSelectedApiKey();
      if (!hasKey) {
        await (window as any).aistudio.openSelectKey();
        return;
      }
    }

    setIsGeneratingMusic(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContentStream({
        model: "lyria-3-clip-preview",
        contents: `Generate a ${musicMood}, ${musicGenre} track for a fast-paced snake game. 30 seconds.`,
      });

      let audioBase64 = "";
      let mimeType = "audio/wav";

      for await (const chunk of response) {
        const parts = chunk.candidates?.[0]?.content?.parts;
        if (!parts) continue;
        for (const part of parts) {
          if (part.inlineData?.data) {
            if (!audioBase64 && part.inlineData.mimeType) mimeType = part.inlineData.mimeType;
            audioBase64 += part.inlineData.data;
          }
        }
      }

      const binary = atob(audioBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: mimeType });
      const url = URL.createObjectURL(blob);
      setMusicUrl(url);
    } catch (err) {
      console.error("Music generation failed", err);
    } finally {
      setIsGeneratingMusic(false);
    }
  };

  const getCommentary = async (event?: string) => {
    if (!gameState) return;
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const players = Object.values(gameState.players || {}) as Player[];
      const playersInfo = players.map(p => `${p.name}: ${p.score} points, length: ${p.snake?.length || 0}`).join(', ');
      
      // Enhanced prompt with more context
      let context = `Current status: ${gameState.status}. Players: ${playersInfo}.`;
      
      // Add recent events to context
      if (gameState.events && (gameState.events?.length || 0) > 0) {
        const recentEvents = gameState.events.slice(-3).map(e => e.message).join('. ');
        context += ` Recent events: ${recentEvents}.`;
      }

      if (event) context += ` Special event: ${event}.`;
      
      // Check for specific game states to make commentary more dynamic
      const longSnakes = players.filter(p => (p.snake?.length || 0) > 15);
      if (longSnakes.length > 0) context += ` Note: ${longSnakes.map(p => p.name).join(', ')} are getting massive!`;
      
      // Check for near-misses or narrowly missed power-ups (passed via event)
      if (event?.includes('close call')) context += " A player just barely dodged a disaster!";
      if (event?.includes('power-up')) context += " Someone almost grabbed a game-changing power-up!";

      const prompt = `You are a hype-man commentator for a multiplayer snake game. ${context} Give a short, punchy 1-sentence commentary about the current state of the game. Be funny, energetic, and use gamer slang. Mention specific players by name frequently. Use varied exclamations like "HOLY SNAKE!", "ABSOLUTE MADMAN!", "NEON GOD!", "WHAT A DODGE!". If it's a near miss, be extra dramatic. If someone is on a kill streak or has a huge lead, call them out!`;
      
      const response = await ai.models.generateContent({
        model: "gemini-3.1-flash-lite-preview",
        contents: prompt,
      });
      
      if (response.text) {
        setCommentary(prev => [response.text!, ...prev].slice(0, 5));
      }
    } catch (err) {
      console.error("Commentary failed", err);
    }
  };

  // --- Viral feature: AI Death Roast ---

  const generateDeathRoast = async (playerName: string, score: number, snakeLength: number, rank: number, totalPlayers: number) => {
    setIsGeneratingRoast(true);
    setDeathRoast(null);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const prompt = `You are a brutally funny but affectionate esports commentator. Write a 1-2 sentence "death epitaph" roast for a player who just lost a multiplayer neon snake game. Player: "${playerName}", Score: ${score} pts, Snake length: ${snakeLength} segments, Final rank: #${rank} out of ${totalPlayers} players. Be specific about their stats. Use gaming slang. Keep it under 35 words. Do NOT use quotes in your response.`;
      const response = await ai.models.generateContent({
        model: "gemini-3.1-flash-lite-preview",
        contents: prompt,
      });
      if (response.text) {
        setDeathRoast(response.text.trim());
      }
    } catch {
      setDeathRoast(`${playerName} played valiantly. The wall had other plans.`);
    } finally {
      setIsGeneratingRoast(false);
    }
  };

  const generateShareCard = (
    playerName: string,
    playerColor: string,
    score: number,
    snakeLength: number,
    rank: number,
    totalPlayers: number,
    roast: string
  ): string => {
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 370;
    const ctx = canvas.getContext('2d')!;

    // Background
    ctx.fillStyle = '#09090b';
    ctx.fillRect(0, 0, 600, 370);

    // Neon border glow
    ctx.shadowBlur = 18;
    ctx.shadowColor = '#10b981';
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 2;
    ctx.strokeRect(8, 8, 584, 354);
    ctx.shadowBlur = 0;

    // Title
    ctx.fillStyle = '#10b981';
    ctx.font = 'bold 26px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('NEON SNAKE ARENA', 300, 52);

    ctx.fillStyle = '#52525b';
    ctx.font = '11px monospace';
    ctx.fillText('POST-GAME AUTOPSY', 300, 72);

    // Divider
    ctx.strokeStyle = '#27272a';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(40, 85); ctx.lineTo(560, 85); ctx.stroke();

    // Player colour swatch + name
    ctx.fillStyle = playerColor;
    ctx.shadowBlur = 10;
    ctx.shadowColor = playerColor;
    ctx.fillRect(40, 100, 28, 28);
    ctx.shadowBlur = 0;

    ctx.fillStyle = playerColor;
    ctx.font = 'bold 22px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(playerName, 80, 120);

    // Stat boxes
    const statBoxes = [
      { label: 'SCORE', value: String(score), color: '#a78bfa' },
      { label: 'LENGTH', value: String(snakeLength), color: '#38bdf8' },
      { label: 'RANK', value: `#${rank}/${totalPlayers}`, color: '#fb923c' },
    ];
    statBoxes.forEach((s, i) => {
      const bx = 40 + i * 185;
      const by = 148;
      ctx.strokeStyle = '#3f3f46';
      ctx.lineWidth = 1;
      ctx.strokeRect(bx, by, 170, 56);
      ctx.fillStyle = s.color;
      ctx.font = 'bold 20px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(s.value, bx + 85, by + 35);
      ctx.fillStyle = '#52525b';
      ctx.font = '9px monospace';
      ctx.fillText(s.label, bx + 85, by + 50);
    });

    // AI Roast section
    ctx.strokeStyle = '#27272a';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(40, 220); ctx.lineTo(560, 220); ctx.stroke();

    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('AI VERDICT:', 40, 240);

    // Word-wrap roast text
    ctx.fillStyle = '#e4e4e7';
    ctx.font = '13px sans-serif';
    const words = roast.split(' ');
    let line = '';
    let ty = 262;
    for (const word of words) {
      const test = line + word + ' ';
      if (ctx.measureText(test).width > 520 && line) {
        ctx.fillText(line.trim(), 40, ty);
        line = word + ' ';
        ty += 22;
      } else {
        line = test;
      }
    }
    if (line.trim()) ctx.fillText(line.trim(), 40, ty);

    // Footer
    ctx.strokeStyle = '#27272a';
    ctx.beginPath(); ctx.moveTo(40, 338); ctx.lineTo(560, 338); ctx.stroke();

    ctx.fillStyle = '#10b981';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('#NeonSnakeArena', 40, 358);

    ctx.fillStyle = '#52525b';
    ctx.font = '10px monospace';
    ctx.textAlign = 'right';
    ctx.fillText('Can you beat this? Play now!', 560, 358);

    return canvas.toDataURL('image/png');
  };

  // Auto-commentate every 10 seconds if playing
  useEffect(() => {
    if (gameState?.status === 'PLAYING') {
      const interval = setInterval(() => getCommentary(), 10000);
      return () => clearInterval(interval);
    }
  }, [gameState?.status]);

  // Trigger AI death roast when game transitions to GAMEOVER
  useEffect(() => {
    if (!gameState || !myId) return;
    const status = gameState.status;
    if (status === 'GAMEOVER' && prevStatusRef.current !== 'GAMEOVER') {
      const me = gameState.players[myId];
      if (me) {
        const sorted = Object.values(gameState.players).sort((a, b) => b.score - a.score);
        const rank = sorted.findIndex(p => p.id === myId) + 1;
        generateDeathRoast(me.name, me.score, me.snake?.length || 0, rank, sorted.length);
      }
    }
    prevStatusRef.current = status;
  }, [gameState?.status]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.muted = isMuted;
    }
  }, [isMuted]);

  const toggleMute = () => setIsMuted(!isMuted);

  if (!hasJoined) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center text-white p-4">
        <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-8 shadow-2xl w-full max-w-md space-y-8">
          <div className="text-center space-y-2">
            <h1 className="text-4xl font-black tracking-tighter text-emerald-400">SNAKE.IO</h1>
            <p className="text-zinc-500 font-medium">Enter the arena</p>
          </div>

          <div className="flex bg-zinc-950 p-1 rounded-xl border border-zinc-800">
            <button 
              onClick={() => setActiveTab('JOIN')}
              className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${activeTab === 'JOIN' ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              JOIN
            </button>
            <button 
              onClick={() => setActiveTab('STATS')}
              className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${activeTab === 'STATS' ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              STATS
            </button>
            <button 
              onClick={() => setActiveTab('SETTINGS')}
              className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${activeTab === 'SETTINGS' ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              SETTINGS
            </button>
          </div>
          
          {activeTab === 'JOIN' && (
            <div className="space-y-6">
              <div className="space-y-2">
                <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                  <User size={14} /> Player Name
                </label>
                <input 
                  type="text" 
                  value={playerName}
                  onChange={(e) => setPlayerName(e.target.value)}
                  placeholder="Enter your name..."
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 focus:outline-none focus:border-emerald-500 transition-colors"
                  maxLength={15}
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                  <Settings size={14} /> Choose Color
                </label>
                <div className="grid grid-cols-4 gap-3">
                  {COLORS.map(color => (
                    <button
                      key={color}
                      onClick={() => setPlayerColor(color)}
                      className={`h-10 rounded-lg transition-all ${playerColor === color ? 'ring-2 ring-white ring-offset-2 ring-offset-zinc-900 scale-110' : 'opacity-50 hover:opacity-100'}`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>

              <div className="flex gap-3">
                <button 
                  onClick={handleJoin}
                  disabled={!playerName.trim()}
                  className="flex-[2] py-4 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-2xl font-bold text-lg shadow-lg shadow-emerald-500/20 transition-all active:scale-95 flex items-center justify-center gap-2"
                >
                  <Play size={20} fill="currentColor" /> START GAME
                </button>
                <button 
                  onClick={() => setHasJoined(true)}
                  className="flex-1 py-4 bg-zinc-800 hover:bg-zinc-700 text-white rounded-2xl font-bold text-lg transition-all active:scale-95 flex items-center justify-center gap-2"
                  title="Spectate without joining"
                >
                  <Eye size={20} />
                </button>
              </div>
            </div>
          )}

          {activeTab === 'STATS' && (
            <div className="space-y-4">
              <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-6 text-center">
                <Trophy size={48} className="text-yellow-500 mx-auto mb-4" />
                <h2 className="text-xl font-black text-white mb-2">Your Hall of Fame</h2>
                <p className="text-zinc-500 text-sm">Stats are tracked across sessions</p>
              </div>
              
              <div className="grid grid-cols-1 gap-3">
                <div className="space-y-3">
                  <div className="flex justify-between items-center bg-zinc-950 p-4 rounded-xl border border-zinc-800">
                    <span className="text-zinc-500 text-xs font-bold uppercase">Wins</span>
                    <span className="text-xl font-black text-emerald-400">{personalStats.wins}</span>
                  </div>
                  <div className="flex justify-between items-center bg-zinc-950 p-4 rounded-xl border border-zinc-800">
                    <span className="text-zinc-500 text-xs font-bold uppercase">Longest Snake</span>
                    <span className="text-xl font-black text-blue-400">{personalStats.longestSnake}</span>
                  </div>
                  <div className="flex justify-between items-center bg-zinc-950 p-4 rounded-xl border border-zinc-800">
                    <span className="text-zinc-500 text-xs font-bold uppercase">Total Score</span>
                    <span className="text-xl font-black text-purple-400">{personalStats.totalScore}</span>
                  </div>
                </div>
              </div>

              {personalStats.achievements.length > 0 && (
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Achievements</label>
                  <div className="flex flex-wrap gap-2">
                    {personalStats.achievements.map(achievement => (
                      <span key={achievement} className="px-2 py-1 bg-zinc-800 border border-zinc-700 rounded-md text-[10px] font-bold text-yellow-500 flex items-center gap-1">
                        <Trophy size={10} /> {achievement}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'SETTINGS' && (
            <div className="space-y-6">
              <div className="space-y-4">
                <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest flex items-center justify-between">
                  <div className="flex items-center gap-2"><Zap size={14} /> Game Speed</div>
                  <span className="text-emerald-400 font-mono">{gameState.settings.tickRate}ms</span>
                </label>
                <input 
                  type="range" 
                  min="50" 
                  max="200" 
                  step="10"
                  value={gameState.settings.tickRate}
                  onChange={(e) => handleUpdateSettings({ tickRate: parseInt(e.target.value) })}
                  className="w-full accent-emerald-500"
                />
                <div className="flex justify-between text-[10px] text-zinc-600 font-bold uppercase">
                  <span>Fast (50ms)</span>
                  <span>Slow (200ms)</span>
                </div>
              </div>

              <div className="space-y-4">
                <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest flex items-center justify-between">
                  <div className="flex items-center gap-2"><Settings size={14} /> Grid Size</div>
                  <span className="text-emerald-400 font-mono">{gameState.settings.gridSize}x{gameState.settings.gridSize}</span>
                </label>
                <input 
                  type="range" 
                  min="15" 
                  max="50" 
                  step="5"
                  value={gameState.settings.gridSize}
                  onChange={(e) => handleUpdateSettings({ gridSize: parseInt(e.target.value) })}
                  className="w-full accent-emerald-500"
                />
                <div className="flex justify-between text-[10px] text-zinc-600 font-bold uppercase">
                  <span>Small (15)</span>
                  <span>Large (50)</span>
                </div>
              </div>

              <div className="space-y-4">
                <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest flex items-center justify-between">
                  <div className="flex items-center gap-2"><PlusCircle size={14} /> Power-up Rate</div>
                  <span className="text-emerald-400 font-mono">{(gameState.settings.powerUpSpawnRate * 100).toFixed(0)}%</span>
                </label>
                <input 
                  type="range" 
                  min="0" 
                  max="0.2" 
                  step="0.01"
                  value={gameState.settings.powerUpSpawnRate}
                  onChange={(e) => handleUpdateSettings({ powerUpSpawnRate: parseFloat(e.target.value) })}
                  className="w-full accent-emerald-500"
                />
                <div className="flex justify-between text-[10px] text-zinc-600 font-bold uppercase">
                  <span>Rare (0%)</span>
                  <span>Frequent (20%)</span>
                </div>
              </div>

              <div className="p-4 bg-zinc-950 border border-zinc-800 rounded-xl text-xs text-zinc-500 leading-relaxed">
                <p>Settings can only be adjusted while waiting for players or after a game ends.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (!gameState) return null;

  const myPlayer = gameState.players?.[myId];
  const sortedPlayers = (Object.values(gameState.players || {}) as Player[]).sort((a, b) => b.score - a.score);

  return (
    <div className="min-h-screen bg-zinc-950 text-white flex flex-col lg:flex-row items-center justify-center p-4 gap-8 font-sans">
      
      {/* Left Panel */}
      <div className="flex flex-col gap-6 w-full max-w-xs">
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-xl relative overflow-hidden">
          <button 
            onClick={toggleMute}
            className="absolute top-4 right-4 p-2 bg-zinc-800 hover:bg-zinc-700 rounded-full transition-colors z-10"
          >
            {isMuted ? <Skull size={16} className="text-red-500" /> : <Zap size={16} className="text-yellow-500" />}
          </button>
          <div className="absolute top-0 right-0 p-2 opacity-10">
            <Settings size={64} />
          </div>
          <h1 className="text-3xl font-black tracking-tighter text-emerald-400 mb-1">Snake.io</h1>
          <p className="text-zinc-500 text-xs font-bold uppercase tracking-widest mb-6">Multiplayer Arena</p>
          
          {myPlayer ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between bg-zinc-950 rounded-xl p-4 border border-zinc-800">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-black text-xl shadow-lg" style={{ backgroundColor: myPlayer.color }}>
                    {myPlayer.name.charAt(0)}
                  </div>
                  <div>
                    <p className="text-xs font-black text-zinc-100 uppercase tracking-tighter">{myPlayer.name}</p>
                    <p className="text-[10px] text-zinc-500 font-bold">RANK #{(Object.values(gameState.players || {}).sort((a, b) => b.score - a.score).findIndex(p => p.id === myId) + 1) || '?'}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-black font-mono" style={{ color: myPlayer.color }}>{myPlayer.score}</p>
                  <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">Points</p>
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-3">
                  <div className="flex items-center gap-2 text-zinc-500 mb-1">
                    <Target size={12} />
                    <span className="text-[10px] font-bold uppercase tracking-widest">Length</span>
                  </div>
                  <p className="text-lg font-black text-zinc-100">{myPlayer.snake?.length || 0}</p>
                </div>
                <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-3">
                  <div className="flex items-center gap-2 text-zinc-500 mb-1">
                    <Zap size={12} />
                    <span className="text-[10px] font-bold uppercase tracking-widest">Growth</span>
                  </div>
                  <p className="text-lg font-black text-zinc-100">{myPlayer.growthQueue || 0}</p>
                </div>
              </div>

              {!myPlayer.isDead && (
                <div className="space-y-2">
                  {myPlayer.activePowerUps?.speed && (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between gap-1 bg-blue-500/20 text-blue-400 px-2 py-1 rounded-md text-[10px] font-black border border-blue-500/30">
                        <div className="flex items-center gap-1"><Zap size={10} /> SPEED</div>
                        <span>{(myPlayer.activePowerUps.speed / 10).toFixed(1)}s</span>
                      </div>
                      <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-blue-500 transition-all duration-100" 
                          style={{ width: `${(myPlayer.activePowerUps.speed / 50) * 100}%` }}
                        />
                      </div>
                    </div>
                  )}
                  {myPlayer.activePowerUps?.shield && (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between gap-1 bg-emerald-500/20 text-emerald-400 px-2 py-1 rounded-md text-[10px] font-black border border-emerald-500/30">
                        <div className="flex items-center gap-1"><Shield size={10} /> SHIELD</div>
                        <span>{(myPlayer.activePowerUps.shield / 10).toFixed(1)}s</span>
                      </div>
                      <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-emerald-500 transition-all duration-100" 
                          style={{ width: `${(myPlayer.activePowerUps.shield / 50) * 100}%` }}
                        />
                      </div>
                    </div>
                  )}
                  {myPlayer.activePowerUps?.invincibility && (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between gap-1 bg-yellow-500/20 text-yellow-400 px-2 py-1 rounded-md text-[10px] font-black border border-yellow-500/30">
                        <div className="flex items-center gap-1"><Shield size={10} /> INVINCIBLE</div>
                        <span>{(myPlayer.activePowerUps.invincibility / 10).toFixed(1)}s</span>
                      </div>
                      <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-yellow-500 transition-all duration-100" 
                          style={{ width: `${(myPlayer.activePowerUps.invincibility / 50) * 100}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="bg-zinc-950 rounded-xl p-4 border border-zinc-800 text-center">
                <p className="text-zinc-500 text-[10px] font-black uppercase tracking-widest mb-2">You are currently</p>
                <div className="flex items-center justify-center gap-2 text-emerald-400">
                  <Eye size={16} />
                  <span className="text-lg font-black uppercase">Spectating</span>
                </div>
              </div>
              <button 
                onClick={() => setHasJoined(false)}
                className="w-full py-3 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl font-black text-xs transition-all shadow-lg shadow-emerald-500/20"
              >
                JOIN THE BATTLE
              </button>
            </div>
          )}

          {!myPlayer && (
            <div className="space-y-4">
              <div className="bg-zinc-950 rounded-xl p-4 border border-zinc-800 text-center">
                <p className="text-[10px] text-zinc-500 font-bold uppercase mb-2">Spectating Mode</p>
                <button 
                  onClick={() => setHasJoined(false)}
                  className="w-full py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg font-bold text-xs transition-all"
                >
                  JOIN THE BATTLE
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Leaderboard */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-xl flex-1 flex flex-col min-h-0">
          <div className="flex items-center gap-2 mb-4 text-zinc-100">
            <Trophy size={18} className="text-yellow-500" />
            <h2 className="text-sm font-black uppercase tracking-widest">Leaderboard</h2>
          </div>
          
          <div className="space-y-2 overflow-y-auto pr-2 custom-scrollbar flex-1">
            {sortedPlayers.map((player, idx) => (
              <div 
                key={player.id} 
                className={`flex items-center justify-between p-3 rounded-xl border transition-colors ${player.id === myId ? 'bg-zinc-800 border-zinc-700' : 'bg-zinc-950/50 border-zinc-800/50'}`}
              >
                <div className="flex items-center gap-3">
                  <span className="text-zinc-600 font-mono text-xs w-4">{idx + 1}.</span>
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: player.color }}></div>
                  <span className="font-bold text-xs truncate max-w-[100px]">
                    {player.name}
                    {player.isDead && ' 💀'}
                  </span>
                </div>
                <div className="flex flex-col items-end">
                  <span className="font-mono font-black text-xs text-zinc-400">{player.score}</span>
                  <span className={`text-[8px] font-bold uppercase ${player.isDead ? 'text-zinc-500' : (gameState.status === 'PLAYING' ? 'text-emerald-500' : 'text-zinc-500')}`}>
                    {player.isDead ? 'Spectating' : (gameState.status === 'PLAYING' ? 'Playing' : 'Waiting')}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Event Log / Kill Feed */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-xl flex-1 flex flex-col min-h-0">
          <div className="flex items-center gap-2 mb-4 text-zinc-100">
            <Zap size={18} className="text-yellow-500" />
            <h2 className="text-sm font-black uppercase tracking-widest">Arena Events</h2>
          </div>
          <div className="space-y-2 overflow-y-auto pr-2 custom-scrollbar flex-1">
            {(gameState.events?.length || 0) === 0 ? (
              <p className="text-zinc-600 text-[10px] italic">No events yet...</p>
            ) : (
              [...gameState.events].reverse().map((event) => (
                <div key={event.id} className="flex items-start gap-2 p-2 bg-zinc-950/50 border border-zinc-800/50 rounded-lg">
                  <div className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${
                    event.type === 'DEATH' ? 'bg-red-500' : 
                    event.type === 'SCORE' ? 'bg-emerald-500' : 
                    event.type === 'POWERUP' ? 'bg-blue-500' : 'bg-yellow-500'
                  }`} />
                  <p className="text-[10px] leading-tight text-zinc-400">
                    <span className="text-zinc-500 font-mono mr-1">[{new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}]</span>
                    {event.message}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>

        {/* AI Commentator */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-xl">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2 text-zinc-100">
              <MessageSquare size={18} className="text-emerald-500" />
              <h2 className="text-sm font-black uppercase tracking-widest">Live Commentary</h2>
            </div>
            <button 
              onClick={() => getCommentary('User requested a hot take!')}
              className="p-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-zinc-400 hover:text-emerald-400 transition-colors"
              title="Request Hot Take"
            >
              <PlusCircle size={14} />
            </button>
          </div>
          <div className="space-y-2 max-h-32 overflow-y-auto pr-2 custom-scrollbar">
            {(commentary?.length || 0) === 0 ? (
              <p className="text-zinc-600 text-[10px] italic">Waiting for action...</p>
            ) : (
              commentary.map((c, i) => (
                <p key={i} className={`text-[11px] leading-tight ${i === 0 ? 'text-emerald-400 font-bold' : 'text-zinc-500'}`}>
                  {c}
                </p>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Center Panel: Game Canvas */}
      <div className="relative bg-zinc-900 p-4 rounded-3xl border border-zinc-800 shadow-2xl">
        {/* Overlays */}
        {gameState.status === 'COUNTDOWN' && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/40 backdrop-blur-sm rounded-3xl">
            <div className="text-center animate-bounce">
              <p className="text-emerald-400 font-black text-8xl drop-shadow-2xl">{gameState.countdown}</p>
              <p className="text-white font-black tracking-[0.5em] uppercase mt-4">Get Ready!</p>
            </div>
          </div>
        )}

        {gameState.status === 'GAMEOVER' && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/80 backdrop-blur-md rounded-3xl p-6">
            <div className="text-center space-y-4 max-w-sm w-full overflow-y-auto max-h-full">
              <div className="space-y-1">
                <Trophy size={48} className="text-yellow-500 mx-auto animate-pulse" />
                <h2 className="text-4xl font-black text-white">GAME OVER</h2>
                <p className="text-zinc-400 font-bold text-sm">Winner: <span className="text-emerald-400">{gameState.winner}</span></p>
              </div>

              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 space-y-2">
                {sortedPlayers.slice(0, 5).map((p, i) => (
                  <div key={p.id} className={`flex justify-between items-center ${i === 0 ? 'text-emerald-400 font-black' : 'text-zinc-500 text-sm'}`}>
                    <span>{i + 1}. {p.name}</span>
                    <span className="font-mono font-bold">{p.score}</span>
                  </div>
                ))}
              </div>

              {/* AI Death Roast */}
              {myPlayer && (
                <div className="bg-zinc-900 border border-yellow-500/30 rounded-2xl p-4 text-left space-y-2">
                  <p className="text-yellow-400 text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5">
                    <Skull size={10} /> AI Verdict — {myPlayer.name}
                  </p>
                  {isGeneratingRoast ? (
                    <div className="flex items-center gap-2 text-zinc-500 text-xs py-1">
                      <div className="w-3 h-3 border-2 border-yellow-500 border-t-transparent rounded-full animate-spin" />
                      Generating roast...
                    </div>
                  ) : deathRoast ? (
                    <p className="text-zinc-300 text-xs leading-relaxed italic">"{deathRoast}"</p>
                  ) : null}
                </div>
              )}

              {/* Share Your Shame button */}
              {myPlayer && deathRoast && (
                <button
                  className="w-full py-2.5 bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-2"
                  onClick={() => {
                    const sorted = Object.values(gameState.players).sort((a, b) => b.score - a.score);
                    const rank = sorted.findIndex(p => p.id === myId) + 1;
                    const url = generateShareCard(
                      myPlayer.name, myPlayer.color, myPlayer.score,
                      myPlayer.snake?.length || 0, rank, sorted.length, deathRoast
                    );
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `neon-snake-${myPlayer.name}-roast.png`;
                    a.click();
                  }}
                >
                  <Trophy size={13} /> SHARE YOUR SHAME
                </button>
              )}

              {/* Neon Pro CTA */}
              <div className="bg-gradient-to-r from-purple-900/40 to-emerald-900/40 border border-purple-500/25 rounded-2xl p-4 text-left">
                <p className="text-purple-400 font-black text-[10px] uppercase tracking-widest mb-1">Neon Pro</p>
                <p className="text-zinc-400 text-[10px] leading-relaxed mb-3">
                  Unlock custom snake trails, exclusive AI commentator voices, premium skins &amp; unlimited music generation.
                </p>
                <button
                  onClick={() => window.open('https://ko-fi.com', '_blank')}
                  className="w-full py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl font-bold text-xs transition-all"
                >
                  Support &amp; Go Pro — $3/mo
                </button>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={handleRestart}
                  className="flex-1 py-4 bg-emerald-500 hover:bg-emerald-600 text-white rounded-2xl font-black text-lg shadow-xl shadow-emerald-500/20 transition-all active:scale-95"
                >
                  RESTART
                </button>
                <button
                  onClick={() => setHasJoined(false)}
                  className="flex-1 py-4 bg-zinc-800 hover:bg-zinc-700 text-white rounded-2xl font-black text-lg transition-all active:scale-95"
                >
                  LEAVE
                </button>
              </div>
            </div>
          </div>
        )}

        {myPlayer?.isDead && gameState.status === 'PLAYING' && (
          <div className="absolute top-8 left-1/2 -translate-x-1/2 bg-black/60 backdrop-blur-sm text-white px-4 py-2 rounded-full font-black tracking-widest text-[10px] z-10 border border-white/10 flex items-center gap-2">
            <Eye size={14} className="text-emerald-400" /> SPECTATING
          </div>
        )}

        <canvas
          ref={canvasRef}
          width={gameState.gridSize * CELL_SIZE}
          height={gameState.gridSize * CELL_SIZE}
          className={`bg-[#1e1e1e] rounded-2xl shadow-inner block transition-all duration-500 ${gameState.status !== 'PLAYING' ? 'blur-sm' : ''} ${myPlayer?.isDead ? 'opacity-50 grayscale-[50%]' : ''}`}
        />
      </div>

      {/* Right Panel: Audio & Chat */}
      <div className="flex flex-col gap-6 w-full max-w-xs h-full lg:h-[600px]">
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-xl">
          <div className="flex items-center gap-2 mb-4 text-zinc-100">
            <Music size={18} className="text-purple-500" />
            <h2 className="text-sm font-black uppercase tracking-widest">Game Music</h2>
          </div>
          
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-[10px] text-zinc-500 font-bold uppercase">Genre</label>
                <select 
                  value={musicGenre}
                  onChange={(e) => setMusicGenre(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-1.5 text-[10px] focus:outline-none focus:border-purple-500"
                >
                  <option value="8-bit synthwave">8-bit Synth</option>
                  <option value="cyberpunk techno">Cyberpunk</option>
                  <option value="lo-fi hiphop">Lo-Fi</option>
                  <option value="heavy metal">Metal</option>
                  <option value="orchestral epic">Epic</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-zinc-500 font-bold uppercase">Mood</label>
                <select 
                  value={musicMood}
                  onChange={(e) => setMusicMood(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-1.5 text-[10px] focus:outline-none focus:border-purple-500"
                >
                  <option value="high-energy">High Energy</option>
                  <option value="chill">Chill</option>
                  <option value="dark">Dark</option>
                  <option value="triumphant">Triumphant</option>
                  <option value="chaotic">Chaotic</option>
                </select>
              </div>
            </div>

            <button 
              onClick={generateMusic}
              disabled={isGeneratingMusic}
              className="w-full py-3 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-2"
            >
              {isGeneratingMusic ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Music size={14} />}
              {isGeneratingMusic ? 'GENERATING...' : 'GENERATE THEME'}
            </button>

            {musicUrl && (
              <div className="space-y-2">
                <audio ref={audioRef} src={musicUrl} controls className="w-full h-8" loop autoPlay />
                <p className="text-[10px] text-zinc-500 text-center">Generated by Lyria AI</p>
              </div>
            )}
          </div>
        </div>

        {/* Chat Feature */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-xl flex-1 flex flex-col min-h-0">
          <div className="flex items-center gap-2 mb-4 text-zinc-100">
            <MessageSquare size={18} className="text-blue-500" />
            <h2 className="text-sm font-black uppercase tracking-widest">Arena Chat</h2>
          </div>
          
          <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-2 mb-4">
            {(gameState.chatMessages?.length || 0) === 0 ? (
              <p className="text-zinc-600 text-[10px] italic text-center py-4">No messages yet. Say hi!</p>
            ) : (
              gameState.chatMessages.map((msg) => (
                <div key={msg.id} className="text-[11px] break-words">
                  <span className="font-black" style={{ color: msg.playerColor }}>{msg.playerName}: </span>
                  <span className="text-zinc-300">{msg.text}</span>
                </div>
              ))
            )}
            <div ref={chatEndRef} />
          </div>

          <form onSubmit={sendChat} className="flex gap-2">
            <input 
              type="text" 
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="Type a message..."
              className="flex-1 bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-[11px] focus:outline-none focus:border-blue-500 transition-colors"
              maxLength={100}
            />
            <button 
              type="submit"
              className="p-2 bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors"
            >
              <Zap size={14} fill="currentColor" />
            </button>
          </form>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-xl">
          <h2 className="text-xs font-black text-zinc-500 uppercase tracking-widest mb-4">Controls</h2>
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-zinc-950 p-2 rounded-lg border border-zinc-800 text-center">
              <span className="text-[10px] text-zinc-600 block uppercase">Move</span>
              <span className="text-xs font-bold">WASD / ARROWS</span>
            </div>
            <div className="bg-zinc-950 p-2 rounded-lg border border-zinc-800 text-center">
              <span className="text-[10px] text-zinc-600 block uppercase">Restart</span>
              <span className="text-xs font-bold">R</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
