/**
 * AlgoNim Worker - Cloudflare Worker Backend
 *
 * Handles game matchmaking, state management, and Algorand mainnet integration.
 *
 * Endpoints:
 * - POST /api/find-match - Find or queue for a match
 * - POST /api/make-move - Submit a game move
 * - GET /api/game-state - Get current game state
 * - POST /api/poll-match - Check if match found while waiting
 * - POST /api/cancel-search - Cancel matchmaking
 * - GET /api/leaderboard - Get top players
 * - GET /api/player-stats - Get player statistics
 */

// Algorand mainnet configuration
const ALGO_CONFIG = {
  ALGOD_SERVER: 'https://mainnet-api.algonode.cloud',
  INDEXER_SERVER: 'https://mainnet-idx.algonode.cloud',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Route requests
      switch (url.pathname) {
        case '/api/find-match':
          return handleFindMatch(request, env, corsHeaders);

        case '/api/make-move':
          return handleMakeMove(request, env, corsHeaders);

        case '/api/game-state':
          return handleGameState(request, env, corsHeaders);

        case '/api/poll-match':
          return handlePollMatch(request, env, corsHeaders);

        case '/api/cancel-search':
          return handleCancelSearch(request, env, corsHeaders);

        case '/api/leaderboard':
          return handleLeaderboard(request, env, corsHeaders);

        case '/api/player-stats':
          return handlePlayerStats(request, env, corsHeaders);

        case '/api/game-history':
          return handleGameHistory(request, env, corsHeaders);

        default:
          return new Response(JSON.stringify({
            status: 'ok',
            message: 'AlgoNim API v2.0 - Mainnet Ready',
            endpoints: [
              'POST /api/find-match',
              'POST /api/make-move',
              'GET /api/game-state',
              'POST /api/poll-match',
              'POST /api/cancel-search',
              'GET /api/leaderboard',
              'GET /api/player-stats',
              'GET /api/game-history'
            ]
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
      }
    } catch (error) {
      console.error('Worker error:', error);
      return new Response(JSON.stringify({
        error: 'Internal server error',
        message: error.message
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }
};

/**
 * Find or create a match
 */
async function handleFindMatch(request, env, corsHeaders) {
  const data = await request.json();
  const { address, wager, rating, gameMode } = data;

  // Validate input
  if (!address || address.length !== 58) {
    return jsonResponse({ error: 'Invalid Algorand address' }, 400, corsHeaders);
  }

  if (wager < 0.001 || wager > 0.1) {
    return jsonResponse({ error: 'Wager must be between 0.001 and 0.1 ALGO' }, 400, corsHeaders);
  }

  const db = env.DB;

  // Ensure player exists in users table
  await db.prepare(`
    INSERT OR IGNORE INTO users (address, rating, wins, losses, created_at)
    VALUES (?, ?, 0, 0, ?)
  `).bind(address, rating || 1200, Date.now()).run();

  // Check if player is already waiting
  const existingWait = await db.prepare(
    'SELECT * FROM waiting_players WHERE address = ?'
  ).bind(address).first();

  if (existingWait) {
    return jsonResponse({ error: 'Already searching for match', waitingId: existingWait.id }, 409, corsHeaders);
  }

  // Look for opponent at same wager level (within 200 rating range for fair matching)
  const opponent = await db.prepare(`
    SELECT * FROM waiting_players
    WHERE wager = ?
    AND address != ?
    AND ABS(rating - ?) <= 200
    ORDER BY timestamp ASC
    LIMIT 1
  `).bind(wager, address, rating || 1200).first();

  if (opponent) {
    // Match found! Create game
    const gameId = 'game_' + Date.now() + '_' + generateId(8);

    // Randomly decide who goes first
    const player1GoesFirst = Math.random() < 0.5;

    await db.prepare(`
      INSERT INTO active_games (
        game_id, player1, player2, wager, state, current_turn,
        game_mode, created_at, last_move_time
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      gameId,
      opponent.address,
      address,
      wager,
      JSON.stringify([1, 3, 5, 7]),
      player1GoesFirst ? opponent.address : address,
      gameMode || 'CASUAL',
      Date.now(),
      Date.now()
    ).run();

    // Remove opponent from waiting queue
    await db.prepare('DELETE FROM waiting_players WHERE address = ?')
      .bind(opponent.address).run();

    return jsonResponse({
      matched: true,
      gameId,
      opponent: opponent.address,
      opponentRating: opponent.rating,
      yourTurn: !player1GoesFirst,
      wager,
      pot: wager * 2
    }, 200, corsHeaders);
  } else {
    // No match - add to waiting queue
    await db.prepare(`
      INSERT INTO waiting_players (address, wager, rating, game_mode, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `).bind(address, wager, rating || 1200, gameMode || 'CASUAL', Date.now()).run();

    return jsonResponse({
      matched: false,
      waiting: true,
      message: 'Waiting for opponent...'
    }, 200, corsHeaders);
  }
}

/**
 * Poll for match while waiting
 */
async function handlePollMatch(request, env, corsHeaders) {
  const data = await request.json();
  const { address } = data;

  const db = env.DB;

  // Check if still waiting
  const waiting = await db.prepare(
    'SELECT * FROM waiting_players WHERE address = ?'
  ).bind(address).first();

  if (waiting) {
    // Still waiting
    const waitTime = Math.floor((Date.now() - waiting.timestamp) / 1000);
    return jsonResponse({
      matched: false,
      waiting: true,
      waitTime,
      playersSearching: await countPlayersSearching(db, waiting.wager)
    }, 200, corsHeaders);
  }

  // Check if matched to a game
  const game = await db.prepare(`
    SELECT * FROM active_games
    WHERE (player1 = ? OR player2 = ?)
    AND created_at > ?
    ORDER BY created_at DESC
    LIMIT 1
  `).bind(address, address, Date.now() - 60000).first();  // Games created in last minute

  if (game) {
    const isPlayer1 = game.player1 === address;
    return jsonResponse({
      matched: true,
      gameId: game.game_id,
      opponent: isPlayer1 ? game.player2 : game.player1,
      yourTurn: game.current_turn === address,
      wager: game.wager,
      pot: game.wager * 2
    }, 200, corsHeaders);
  }

  return jsonResponse({
    matched: false,
    waiting: false,
    message: 'Not in queue. Start a new search.'
  }, 200, corsHeaders);
}

/**
 * Cancel matchmaking search
 */
async function handleCancelSearch(request, env, corsHeaders) {
  const data = await request.json();
  const { address } = data;

  const db = env.DB;

  await db.prepare('DELETE FROM waiting_players WHERE address = ?')
    .bind(address).run();

  return jsonResponse({ success: true, message: 'Search cancelled' }, 200, corsHeaders);
}

/**
 * Submit a game move
 */
async function handleMakeMove(request, env, corsHeaders) {
  const data = await request.json();
  const { gameId, address, move } = data;

  const db = env.DB;

  const game = await db.prepare('SELECT * FROM active_games WHERE game_id = ?')
    .bind(gameId).first();

  if (!game) {
    return jsonResponse({ error: 'Game not found' }, 404, corsHeaders);
  }

  if (game.current_turn !== address) {
    return jsonResponse({ error: 'Not your turn' }, 400, corsHeaders);
  }

  // Validate move
  const state = JSON.parse(game.state);
  if (move.row < 0 || move.row > 3 || move.count < 1 || move.count > state[move.row]) {
    return jsonResponse({ error: 'Invalid move' }, 400, corsHeaders);
  }

  // Apply move
  state[move.row] -= move.count;
  const totalSticks = state.reduce((a, b) => a + b, 0);

  if (totalSticks === 0) {
    // Game over - player who took last stick LOSES
    const loser = address;
    const winner = address === game.player1 ? game.player2 : game.player1;

    // Update player stats
    await updatePlayerStats(db, winner, loser);

    // Record game history
    await db.prepare(`
      INSERT INTO game_history (
        game_id, player1, player2, winner, loser, wager, game_mode, ended_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      gameId,
      game.player1,
      game.player2,
      winner,
      loser,
      game.wager,
      game.game_mode || 'CASUAL',
      Date.now()
    ).run();

    // Delete active game
    await db.prepare('DELETE FROM active_games WHERE game_id = ?')
      .bind(gameId).run();

    return jsonResponse({
      gameOver: true,
      winner,
      loser,
      pot: game.wager * 2,
      message: `${loser.substring(0, 8)}... took the last stick and loses!`
    }, 200, corsHeaders);
  }

  // Game continues
  const nextTurn = address === game.player1 ? game.player2 : game.player1;

  await db.prepare(`
    UPDATE active_games
    SET state = ?, current_turn = ?, last_move_time = ?
    WHERE game_id = ?
  `).bind(JSON.stringify(state), nextTurn, Date.now(), gameId).run();

  return jsonResponse({
    success: true,
    newState: state,
    yourTurn: false,
    sticksRemaining: totalSticks
  }, 200, corsHeaders);
}

/**
 * Get current game state
 */
async function handleGameState(request, env, corsHeaders) {
  const url = new URL(request.url);
  const gameId = url.searchParams.get('gameId');
  const address = url.searchParams.get('address');

  const db = env.DB;

  const game = await db.prepare('SELECT * FROM active_games WHERE game_id = ?')
    .bind(gameId).first();

  if (!game) {
    return jsonResponse({ error: 'Game not found' }, 404, corsHeaders);
  }

  const isPlayer1 = game.player1 === address;
  const opponent = isPlayer1 ? game.player2 : game.player1;

  return jsonResponse({
    gameId: game.game_id,
    state: JSON.parse(game.state),
    yourTurn: game.current_turn === address,
    opponent,
    wager: game.wager,
    pot: game.wager * 2,
    gameMode: game.game_mode,
    lastMoveTime: game.last_move_time
  }, 200, corsHeaders);
}

/**
 * Get leaderboard
 */
async function handleLeaderboard(request, env, corsHeaders) {
  const db = env.DB;

  const leaders = await db.prepare(`
    SELECT address, rating, wins, losses,
           (wins * 1.0 / NULLIF(wins + losses, 0)) as win_rate
    FROM users
    WHERE wins + losses >= 5
    ORDER BY rating DESC
    LIMIT 50
  `).all();

  return jsonResponse({
    leaderboard: leaders.results || []
  }, 200, corsHeaders);
}

/**
 * Get player statistics
 */
async function handlePlayerStats(request, env, corsHeaders) {
  const url = new URL(request.url);
  const address = url.searchParams.get('address');

  if (!address) {
    return jsonResponse({ error: 'Address required' }, 400, corsHeaders);
  }

  const db = env.DB;

  const stats = await db.prepare(`
    SELECT address, rating, wins, losses, created_at
    FROM users WHERE address = ?
  `).bind(address).first();

  if (!stats) {
    return jsonResponse({
      address,
      rating: 1200,
      wins: 0,
      losses: 0,
      winRate: 0,
      isNew: true
    }, 200, corsHeaders);
  }

  const totalGames = stats.wins + stats.losses;
  const winRate = totalGames > 0 ? (stats.wins / totalGames * 100).toFixed(1) : 0;

  return jsonResponse({
    address: stats.address,
    rating: stats.rating,
    wins: stats.wins,
    losses: stats.losses,
    winRate: parseFloat(winRate),
    totalGames
  }, 200, corsHeaders);
}

/**
 * Get game history for a player
 */
async function handleGameHistory(request, env, corsHeaders) {
  const url = new URL(request.url);
  const address = url.searchParams.get('address');
  const limit = parseInt(url.searchParams.get('limit')) || 20;

  if (!address) {
    return jsonResponse({ error: 'Address required' }, 400, corsHeaders);
  }

  const db = env.DB;

  const history = await db.prepare(`
    SELECT game_id, player1, player2, winner, loser, wager, game_mode, ended_at
    FROM game_history
    WHERE player1 = ? OR player2 = ?
    ORDER BY ended_at DESC
    LIMIT ?
  `).bind(address, address, limit).all();

  return jsonResponse({
    games: history.results || []
  }, 200, corsHeaders);
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Update player stats after a game
 */
async function updatePlayerStats(db, winner, loser) {
  // Winner gains rating
  await db.prepare(`
    UPDATE users
    SET wins = wins + 1,
        rating = rating + 20
    WHERE address = ?
  `).bind(winner).run();

  // Loser loses rating (minimum 100)
  await db.prepare(`
    UPDATE users
    SET losses = losses + 1,
        rating = MAX(100, rating - 15)
    WHERE address = ?
  `).bind(loser).run();
}

/**
 * Count players searching at a wager level
 */
async function countPlayersSearching(db, wager) {
  const result = await db.prepare(
    'SELECT COUNT(*) as count FROM waiting_players WHERE wager = ?'
  ).bind(wager).first();
  return result?.count || 0;
}

/**
 * Generate random ID
 */
function generateId(length) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < length; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

/**
 * JSON response helper
 */
function jsonResponse(data, status, corsHeaders) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}
