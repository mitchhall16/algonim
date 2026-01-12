-- AlgoNim Database Schema for Cloudflare D1
-- Run this to initialize the database:
-- wrangler d1 execute algonim-db --file=schema.sql

-- Users table - stores player stats
CREATE TABLE IF NOT EXISTS users (
    address TEXT PRIMARY KEY,
    rating INTEGER DEFAULT 1200,
    wins INTEGER DEFAULT 0,
    losses INTEGER DEFAULT 0,
    created_at INTEGER
);

-- Waiting players - matchmaking queue
CREATE TABLE IF NOT EXISTS waiting_players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    address TEXT UNIQUE NOT NULL,
    wager REAL NOT NULL,
    rating INTEGER DEFAULT 1200,
    game_mode TEXT DEFAULT 'CASUAL',
    timestamp INTEGER NOT NULL
);

-- Active games - games in progress
CREATE TABLE IF NOT EXISTS active_games (
    game_id TEXT PRIMARY KEY,
    player1 TEXT NOT NULL,
    player2 TEXT NOT NULL,
    wager REAL NOT NULL,
    state TEXT NOT NULL,
    current_turn TEXT NOT NULL,
    game_mode TEXT DEFAULT 'CASUAL',
    created_at INTEGER,
    last_move_time INTEGER,
    last_reminder_time INTEGER,
    deposits_confirmed INTEGER DEFAULT 0
);

-- Deposits - track wager deposits to escrow
CREATE TABLE IF NOT EXISTS deposits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id TEXT NOT NULL,
    player_address TEXT NOT NULL,
    tx_id TEXT NOT NULL UNIQUE,
    amount REAL NOT NULL,
    confirmed_at INTEGER
);

-- Game history - completed games
CREATE TABLE IF NOT EXISTS game_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id TEXT NOT NULL,
    player1 TEXT NOT NULL,
    player2 TEXT NOT NULL,
    winner TEXT NOT NULL,
    loser TEXT NOT NULL,
    wager REAL NOT NULL,
    game_mode TEXT DEFAULT 'CASUAL',
    ended_at INTEGER,
    end_reason TEXT DEFAULT 'normal',
    payout_tx_id TEXT,
    payout_at INTEGER
);

-- Indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_waiting_wager ON waiting_players(wager);
CREATE INDEX IF NOT EXISTS idx_waiting_rating ON waiting_players(rating);
CREATE INDEX IF NOT EXISTS idx_games_players ON active_games(player1, player2);
CREATE INDEX IF NOT EXISTS idx_games_turn ON active_games(current_turn);
CREATE INDEX IF NOT EXISTS idx_games_move_time ON active_games(last_move_time);
CREATE INDEX IF NOT EXISTS idx_history_players ON game_history(player1, player2);
CREATE INDEX IF NOT EXISTS idx_history_ended ON game_history(ended_at);
CREATE INDEX IF NOT EXISTS idx_history_winner ON game_history(winner);
CREATE INDEX IF NOT EXISTS idx_users_rating ON users(rating);
CREATE INDEX IF NOT EXISTS idx_deposits_game ON deposits(game_id);
CREATE INDEX IF NOT EXISTS idx_deposits_tx ON deposits(tx_id);
