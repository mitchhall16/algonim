/**
 * AlgoNim Worker - Cloudflare Worker Backend
 *
 * Handles game matchmaking, state management, escrow, and Algorand mainnet integration.
 *
 * Environment Variables (set via wrangler.toml or dashboard):
 * - ESCROW_ADDRESS: Public address of escrow wallet
 * - SERVER_ADDRESS: Public address of server/reminder wallet
 *
 * Secrets (set via `wrangler secret put`):
 * - ESCROW_MNEMONIC: 25-word mnemonic for escrow wallet
 * - SERVER_MNEMONIC: 25-word mnemonic for server wallet
 *
 * Endpoints:
 * - POST /api/find-match - Find or queue for a match
 * - POST /api/make-move - Submit a game move
 * - GET /api/game-state - Get current game state
 * - POST /api/poll-match - Check if match found while waiting
 * - POST /api/cancel-search - Cancel matchmaking
 * - GET /api/leaderboard - Get top players
 * - GET /api/player-stats - Get player statistics
 * - POST /api/deposit-wager - Record wager deposit
 * - POST /api/claim-winnings - Process winner payout
 * - GET /api/escrow-info - Get escrow wallet info
 */

// Algorand mainnet configuration
const ALGO_CONFIG = {
  ALGOD_SERVER: 'https://mainnet-api.algonode.cloud',
  ALGOD_PORT: 443,
  INDEXER_SERVER: 'https://mainnet-idx.algonode.cloud',

  // Reminder configuration
  REMINDER_AMOUNT: 1000, // 0.001 ALGO in microAlgos
  REMINDER_DELAY_MS: 30 * 60 * 1000, // 30 minutes
  ABANDON_DELAY_MS: 3 * 24 * 60 * 60 * 1000, // 3 days
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

        case '/api/deposit-wager':
          return handleDepositWager(request, env, corsHeaders);

        case '/api/claim-winnings':
          return handleClaimWinnings(request, env, corsHeaders);

        case '/api/escrow-info':
          return handleEscrowInfo(request, env, corsHeaders);

        case '/api/send-reminder':
          return handleSendReminder(request, env, corsHeaders);

        default:
          return new Response(JSON.stringify({
            status: 'ok',
            message: 'AlgoNim API v2.1 - Mainnet with Escrow',
            escrowAddress: env.ESCROW_ADDRESS || 'Not configured',
            endpoints: [
              'POST /api/find-match',
              'POST /api/make-move',
              'GET /api/game-state',
              'POST /api/poll-match',
              'POST /api/cancel-search',
              'GET /api/leaderboard',
              'GET /api/player-stats',
              'GET /api/game-history',
              'POST /api/deposit-wager',
              'POST /api/claim-winnings',
              'GET /api/escrow-info',
              'POST /api/send-reminder'
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
  },

  // Scheduled task for reminders and cleanup
  async scheduled(event, env, ctx) {
    ctx.waitUntil(processRemindersAndCleanup(env));
  }
};

/**
 * Get escrow wallet information
 */
async function handleEscrowInfo(request, env, corsHeaders) {
  const escrowAddress = env.ESCROW_ADDRESS;

  if (!escrowAddress) {
    return jsonResponse({
      error: 'Escrow not configured',
      configured: false
    }, 400, corsHeaders);
  }

  try {
    // Fetch escrow balance from Algorand
    const response = await fetch(
      `${ALGO_CONFIG.ALGOD_SERVER}/v2/accounts/${escrowAddress}`
    );
    const accountInfo = await response.json();

    return jsonResponse({
      configured: true,
      address: escrowAddress,
      balance: accountInfo.amount / 1000000, // Convert to ALGO
      minBalance: accountInfo['min-balance'] / 1000000
    }, 200, corsHeaders);
  } catch (error) {
    return jsonResponse({
      configured: true,
      address: escrowAddress,
      error: 'Could not fetch balance'
    }, 200, corsHeaders);
  }
}

/**
 * Record a wager deposit (called after player sends ALGO to escrow)
 */
async function handleDepositWager(request, env, corsHeaders) {
  const data = await request.json();
  const { address, gameId, txId, amount } = data;

  if (!address || !gameId || !txId || !amount) {
    return jsonResponse({ error: 'Missing required fields' }, 400, corsHeaders);
  }

  const db = env.DB;

  // Verify the transaction on-chain
  try {
    const txResponse = await fetch(
      `${ALGO_CONFIG.INDEXER_SERVER}/v2/transactions/${txId}`
    );
    const txData = await txResponse.json();

    if (!txData.transaction) {
      return jsonResponse({ error: 'Transaction not found' }, 404, corsHeaders);
    }

    const tx = txData.transaction;

    // Verify transaction details
    if (tx.sender !== address) {
      return jsonResponse({ error: 'Transaction sender mismatch' }, 400, corsHeaders);
    }

    if (tx['payment-transaction']?.receiver !== env.ESCROW_ADDRESS) {
      return jsonResponse({ error: 'Transaction not sent to escrow' }, 400, corsHeaders);
    }

    const txAmount = tx['payment-transaction']?.amount / 1000000;
    if (Math.abs(txAmount - amount) > 0.0001) {
      return jsonResponse({ error: 'Transaction amount mismatch' }, 400, corsHeaders);
    }

    // Record the deposit
    await db.prepare(`
      INSERT INTO deposits (game_id, player_address, tx_id, amount, confirmed_at)
      VALUES (?, ?, ?, ?, ?)
    `).bind(gameId, address, txId, amount, Date.now()).run();

    // Check if both players have deposited
    const deposits = await db.prepare(`
      SELECT COUNT(*) as count FROM deposits WHERE game_id = ?
    `).bind(gameId).first();

    const bothDeposited = deposits.count >= 2;

    if (bothDeposited) {
      // Update game status to ready
      await db.prepare(`
        UPDATE active_games SET deposits_confirmed = 1 WHERE game_id = ?
      `).bind(gameId).run();
    }

    return jsonResponse({
      success: true,
      deposited: true,
      bothPlayersReady: bothDeposited,
      txId
    }, 200, corsHeaders);

  } catch (error) {
    console.error('Deposit verification error:', error);
    return jsonResponse({ error: 'Failed to verify transaction' }, 500, corsHeaders);
  }
}

/**
 * Process winner payout from escrow
 */
async function handleClaimWinnings(request, env, corsHeaders) {
  const data = await request.json();
  const { gameId, winnerAddress } = data;

  if (!gameId || !winnerAddress) {
    return jsonResponse({ error: 'Missing required fields' }, 400, corsHeaders);
  }

  const db = env.DB;

  // Verify the game and winner
  const game = await db.prepare(`
    SELECT * FROM game_history WHERE game_id = ? AND winner = ?
  `).bind(gameId, winnerAddress).first();

  if (!game) {
    return jsonResponse({ error: 'Game not found or address is not winner' }, 404, corsHeaders);
  }

  // Check if already paid out
  if (game.payout_tx_id) {
    return jsonResponse({
      success: true,
      alreadyPaid: true,
      txId: game.payout_tx_id
    }, 200, corsHeaders);
  }

  // Get escrow mnemonic from secrets
  const escrowMnemonic = env.ESCROW_MNEMONIC;
  if (!escrowMnemonic) {
    return jsonResponse({ error: 'Escrow not configured' }, 500, corsHeaders);
  }

  try {
    // Calculate payout (2x wager minus small fee for tx costs)
    const payoutAmount = (game.wager * 2) - 0.002; // Reserve 0.002 ALGO for fees

    // Create and send payout transaction
    const txId = await sendAlgoPayment(
      escrowMnemonic,
      winnerAddress,
      payoutAmount,
      `AlgoNim WIN | Game: ${gameId.substring(0, 16)} | +${payoutAmount.toFixed(4)} ALGO`
    );

    // Record the payout
    await db.prepare(`
      UPDATE game_history SET payout_tx_id = ?, payout_at = ? WHERE game_id = ?
    `).bind(txId, Date.now(), gameId).run();

    return jsonResponse({
      success: true,
      txId,
      amount: payoutAmount,
      message: `Sent ${payoutAmount.toFixed(4)} ALGO to winner`
    }, 200, corsHeaders);

  } catch (error) {
    console.error('Payout error:', error);
    return jsonResponse({ error: 'Failed to process payout: ' + error.message }, 500, corsHeaders);
  }
}

/**
 * Send reminder transaction to a player
 */
async function handleSendReminder(request, env, corsHeaders) {
  const data = await request.json();
  const { gameId, playerAddress, message } = data;

  if (!playerAddress) {
    return jsonResponse({ error: 'Missing player address' }, 400, corsHeaders);
  }

  const serverMnemonic = env.SERVER_MNEMONIC;
  if (!serverMnemonic) {
    return jsonResponse({ error: 'Server wallet not configured' }, 500, corsHeaders);
  }

  try {
    const note = message || `AlgoNim: It's your turn! Game: ${gameId || 'unknown'}`;

    const txId = await sendAlgoPayment(
      serverMnemonic,
      playerAddress,
      ALGO_CONFIG.REMINDER_AMOUNT / 1000000, // Convert microAlgos to ALGO
      note
    );

    return jsonResponse({
      success: true,
      txId,
      message: 'Reminder sent'
    }, 200, corsHeaders);

  } catch (error) {
    console.error('Reminder error:', error);
    return jsonResponse({ error: 'Failed to send reminder' }, 500, corsHeaders);
  }
}

/**
 * Process scheduled reminders and cleanup abandoned games
 */
async function processRemindersAndCleanup(env) {
  const db = env.DB;
  const now = Date.now();

  // Find games needing reminders (inactive for 30+ minutes)
  const needsReminder = await db.prepare(`
    SELECT * FROM active_games
    WHERE last_move_time < ?
    AND last_reminder_time IS NULL OR last_reminder_time < ?
    AND deposits_confirmed = 1
  `).bind(
    now - ALGO_CONFIG.REMINDER_DELAY_MS,
    now - ALGO_CONFIG.REMINDER_DELAY_MS
  ).all();

  // Send reminders
  for (const game of (needsReminder.results || [])) {
    try {
      const playerToRemind = game.current_turn;

      if (env.SERVER_MNEMONIC) {
        await sendAlgoPayment(
          env.SERVER_MNEMONIC,
          playerToRemind,
          ALGO_CONFIG.REMINDER_AMOUNT / 1000000,
          `AlgoNim Reminder: Your turn in game vs ${game.current_turn === game.player1 ? game.player2.substring(0, 8) : game.player1.substring(0, 8)}...`
        );

        await db.prepare(`
          UPDATE active_games SET last_reminder_time = ? WHERE game_id = ?
        `).bind(now, game.game_id).run();
      }
    } catch (e) {
      console.error('Failed to send reminder:', e);
    }
  }

  // Handle abandoned games (inactive for 3+ days)
  const abandoned = await db.prepare(`
    SELECT * FROM active_games
    WHERE last_move_time < ?
    AND deposits_confirmed = 1
  `).bind(now - ALGO_CONFIG.ABANDON_DELAY_MS).all();

  for (const game of (abandoned.results || [])) {
    try {
      // The player whose turn it is forfeits
      const loser = game.current_turn;
      const winner = loser === game.player1 ? game.player2 : game.player1;

      // Update stats
      await updatePlayerStats(db, winner, loser);

      // Record in history
      await db.prepare(`
        INSERT INTO game_history (
          game_id, player1, player2, winner, loser, wager, game_mode, ended_at, end_reason
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'abandoned')
      `).bind(
        game.game_id,
        game.player1,
        game.player2,
        winner,
        loser,
        game.wager,
        game.game_mode || 'CASUAL',
        now
      ).run();

      // Process payout if escrow configured
      if (env.ESCROW_MNEMONIC) {
        const payoutAmount = (game.wager * 2) - 0.002;
        await sendAlgoPayment(
          env.ESCROW_MNEMONIC,
          winner,
          payoutAmount,
          `AlgoNim WIN (opponent abandoned) | +${payoutAmount.toFixed(4)} ALGO`
        );
      }

      // Delete the active game
      await db.prepare('DELETE FROM active_games WHERE game_id = ?')
        .bind(game.game_id).run();

    } catch (e) {
      console.error('Failed to process abandoned game:', e);
    }
  }
}

/**
 * Send ALGO payment using mnemonic
 * Note: This is a simplified version - in production you'd use algosdk properly
 */
async function sendAlgoPayment(mnemonic, toAddress, amountInAlgo, note) {
  // For Cloudflare Workers, we need to use the Algorand API directly
  // since we can't use the full algosdk in this environment

  // This is a placeholder - you'll need to implement proper transaction signing
  // Options:
  // 1. Use a separate signing service
  // 2. Use Cloudflare Durable Objects with algosdk
  // 3. Use a third-party signing API

  console.log(`[PAYOUT] Would send ${amountInAlgo} ALGO to ${toAddress}`);
  console.log(`[PAYOUT] Note: ${note}`);

  // For now, return a mock txId - implement real signing in production
  const mockTxId = 'TX_' + Date.now() + '_' + Math.random().toString(36).substring(7);

  // TODO: Implement real transaction signing
  // This requires either:
  // - Running algosdk in a Node.js environment
  // - Using a signing microservice
  // - Using Algorand's REST API with proper authentication

  return mockTxId;
}

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
        game_mode, created_at, last_move_time, deposits_confirmed
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
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
      pot: wager * 2,
      escrowAddress: env.ESCROW_ADDRESS,
      requiresDeposit: true
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
      message: 'Waiting for opponent...',
      escrowAddress: env.ESCROW_ADDRESS
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
      pot: game.wager * 2,
      escrowAddress: env.ESCROW_ADDRESS,
      depositsConfirmed: game.deposits_confirmed === 1
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
      message: `${loser.substring(0, 8)}... took the last stick and loses!`,
      canClaimWinnings: true
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
    lastMoveTime: game.last_move_time,
    depositsConfirmed: game.deposits_confirmed === 1
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
    SELECT game_id, player1, player2, winner, loser, wager, game_mode, ended_at, payout_tx_id
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
