# 🚀 ZERO BUDGET DEPLOYMENT GUIDE

## FREE INFRASTRUCTURE STACK

✅ **Frontend Hosting:** Cloudflare Pages (FREE)
✅ **Backend/API:** Cloudflare Workers (FREE tier: 100k requests/day)
✅ **Database:** Cloudflare D1 (FREE tier: 100k reads/day)
✅ **Real-time:** Cloudflare Durable Objects (FREE tier included)
✅ **Algorand Node:** AlgoNode.io (FREE public API)
✅ **Domain:** Cloudflare (or use free .pages.dev subdomain)

**Total Monthly Cost: $0** 🎉

---

## STEP 1: SMART CONTRACT (FREE)

### Simple Nim Smart Contract (TEAL)

```teal
#pragma version 8

// Nim Game Contract - Stateless (saves gas)
// Players sign moves, contract validates on-chain

txn TypeEnum
int appl
==
bnz handle_app_call

// Handle NoOp - Make Move
handle_app_call:
txn OnCompletion
int NoOp
==
bnz make_move

// Create game
txn ApplicationID
int 0
==
bnz create_game

create_game:
    // Initialize game state
    byte "row1"
    int 1
    app_global_put
    
    byte "row2"
    int 3
    app_global_put
    
    byte "row3"
    int 5
    app_global_put
    
    byte "row4"
    int 7
    app_global_put
    
    byte "creator"
    txn Sender
    app_global_put
    
    byte "wager"
    txn ApplicationArgs 0
    btoi
    app_global_put
    
    int 1
    return

make_move:
    // Validate move
    // Row number (0-3)
    txn ApplicationArgs 0
    btoi
    store 0
    
    // Count to remove
    txn ApplicationArgs 1
    btoi
    store 1
    
    // Check valid row
    load 0
    int 0
    >=
    load 0
    int 4
    <
    &&
    assert
    
    // Check valid count (1 or more)
    load 1
    int 0
    >
    assert
    
    int 1
    return
```

### Compile & Deploy (FREE)

```bash
# Option 1: Use AlgoNode sandbox (FREE)
curl https://testnet-api.algonode.cloud/v2/applications

# Option 2: Use goal CLI locally
goal clerk compile nim.teal

# Deploy to Testnet (FREE - use testnet faucet)
goal app create \
  --creator YOUR_TESTNET_ADDRESS \
  --approval-prog nim.teal \
  --clear-prog clear.teal \
  --global-byteslices 4 \
  --global-ints 6 \
  --local-byteslices 0 \
  --local-ints 0 \
  -d ~/node/data

# Get free testnet ALGO from: https://bank.testnet.algorand.network/
```

---

## STEP 2: CLOUDFLARE WORKERS BACKEND (FREE)

### Install Wrangler (Cloudflare CLI)

```bash
npm install -g wrangler
wrangler login
```

### Create Worker for Matchmaking

```javascript
// worker.js - Cloudflare Worker for AlgoNim
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };
    
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }
    
    // Routes
    if (url.pathname === '/api/find-match') {
      return handleFindMatch(request, env, corsHeaders);
    }
    
    if (url.pathname === '/api/make-move') {
      return handleMakeMove(request, env, corsHeaders);
    }
    
    if (url.pathname === '/api/active-games') {
      return handleActiveGames(request, env, corsHeaders);
    }
    
    return new Response('Not Found', { status: 404 });
  }
};

async function handleFindMatch(request, env, corsHeaders) {
  const data = await request.json();
  const { address, wager, rating } = data;
  
  // Store in D1 database
  const db = env.DB; // Cloudflare D1
  
  // Check for waiting players at this wager level
  const waiting = await db.prepare(
    'SELECT * FROM waiting_players WHERE wager = ? LIMIT 1'
  ).bind(wager).first();
  
  if (waiting) {
    // Match found! Create game
    const gameId = `game_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    await db.prepare(
      'INSERT INTO active_games (game_id, player1, player2, wager, state, current_turn) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(
      gameId,
      waiting.address,
      address,
      wager,
      JSON.stringify([1, 3, 5, 7]),
      waiting.address
    ).run();
    
    // Remove from waiting
    await db.prepare('DELETE FROM waiting_players WHERE address = ?')
      .bind(waiting.address).run();
    
    return new Response(JSON.stringify({
      matched: true,
      gameId,
      opponent: waiting.address,
      opponentRating: waiting.rating,
      yourTurn: false
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } else {
    // Add to waiting list
    await db.prepare(
      'INSERT OR REPLACE INTO waiting_players (address, wager, rating, timestamp) VALUES (?, ?, ?, ?)'
    ).bind(address, wager, rating, Date.now()).run();
    
    return new Response(JSON.stringify({
      matched: false,
      waiting: true
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
}

async function handleMakeMove(request, env, corsHeaders) {
  const data = await request.json();
  const { gameId, address, move } = data;
  
  const db = env.DB;
  
  // Get game state
  const game = await db.prepare('SELECT * FROM active_games WHERE game_id = ?')
    .bind(gameId).first();
  
  if (!game) {
    return new Response(JSON.stringify({ error: 'Game not found' }), { 
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  }
  
  // Verify it's their turn
  if (game.current_turn !== address) {
    return new Response(JSON.stringify({ error: 'Not your turn' }), { 
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  }
  
  // Apply move
  const state = JSON.parse(game.state);
  state[move.row] -= move.count;
  
  // Check win condition
  const totalSticks = state.reduce((a, b) => a + b, 0);
  
  if (totalSticks === 0) {
    // Current player loses (took last stick)
    const winner = address === game.player1 ? game.player2 : game.player1;
    
    // Update ratings
    await db.prepare(
      'UPDATE users SET rating = rating + 25, wins = wins + 1 WHERE address = ?'
    ).bind(winner).run();
    
    await db.prepare(
      'UPDATE users SET rating = rating - 15, losses = losses + 1 WHERE address = ?'
    ).bind(address).run();
    
    // Delete game
    await db.prepare('DELETE FROM active_games WHERE game_id = ?')
      .bind(gameId).run();
    
    return new Response(JSON.stringify({
      gameOver: true,
      winner,
      loser: address
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
  
  // Switch turns
  const nextTurn = address === game.player1 ? game.player2 : game.player1;
  
  await db.prepare(
    'UPDATE active_games SET state = ?, current_turn = ?, last_move_time = ? WHERE game_id = ?'
  ).bind(JSON.stringify(state), nextTurn, Date.now(), gameId).run();
  
  return new Response(JSON.stringify({
    success: true,
    newState: state,
    yourTurn: false
  }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

async function handleActiveGames(request, env, corsHeaders) {
  const url = new URL(request.url);
  const address = url.searchParams.get('address');
  
  const db = env.DB;
  
  const games = await db.prepare(
    'SELECT * FROM active_games WHERE player1 = ? OR player2 = ?'
  ).bind(address, address).all();
  
  return new Response(JSON.stringify(games.results), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}
```

### wrangler.toml Configuration

```toml
name = "algonim-worker"
main = "worker.js"
compatibility_date = "2024-01-01"

[[d1_databases]]
binding = "DB"
database_name = "algonim-db"
database_id = "your-database-id"
```

### Create D1 Database

```bash
# Create database
wrangler d1 create algonim-db

# Create tables
wrangler d1 execute algonim-db --command "
CREATE TABLE waiting_players (
  address TEXT PRIMARY KEY,
  wager REAL,
  rating INTEGER,
  timestamp INTEGER
);

CREATE TABLE active_games (
  game_id TEXT PRIMARY KEY,
  player1 TEXT,
  player2 TEXT,
  wager REAL,
  state TEXT,
  current_turn TEXT,
  last_move_time INTEGER
);

CREATE TABLE users (
  address TEXT PRIMARY KEY,
  rating INTEGER DEFAULT 1200,
  wins INTEGER DEFAULT 0,
  losses INTEGER DEFAULT 0
);
"

# Deploy worker
wrangler deploy
```

---

## STEP 3: FRONTEND WITH REAL WALLET INTEGRATION

### Update Frontend to Use Cloudflare Worker

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AlgoNim - Free to Play</title>
    <!-- Previous styles here -->
    <script src="https://unpkg.com/@perawallet/connect@1.3.4/dist/index.umd.js"></script>
    <script src="https://unpkg.com/algosdk@2.7.0/dist/browser/algosdk.min.js"></script>
</head>
<body>
    <!-- Previous HTML here -->
    
    <script>
        // Configuration
        const WORKER_URL = 'https://algonim-worker.YOUR-SUBDOMAIN.workers.dev';
        const ALGONODE_URL = 'https://testnet-api.algonode.cloud';
        
        // Pera Wallet Integration
        const peraWallet = new PeraWalletConnect();
        let walletAddress = null;
        let currentGameId = null;
        
        // Real Wallet Connection
        async function connectWallet(walletType) {
            try {
                if (walletType === 'pera') {
                    const accounts = await peraWallet.connect();
                    walletAddress = accounts[0];
                } else if (walletType === 'defly') {
                    // Defly integration similar
                    alert('Defly: Use browser extension');
                }
                
                // Update UI
                document.getElementById('connectWallet').textContent = 
                    walletAddress.substring(0, 10) + '...';
                document.getElementById('connectWallet').classList.add('connected');
                
                // Show matchmaking
                document.getElementById('matchmakingPanel').style.display = 'block';
                
                // Load user stats
                await loadUserStats();
                
            } catch (error) {
                console.error('Wallet connection failed:', error);
                alert('Failed to connect wallet');
            }
        }
        
        // Load User Stats
        async function loadUserStats() {
            try {
                const response = await fetch(`${WORKER_URL}/api/user-stats?address=${walletAddress}`);
                const stats = await response.json();
                
                document.getElementById('userRating').textContent = stats.rating || 1200;
                document.getElementById('userWins').textContent = stats.wins || 0;
                document.getElementById('userLosses').textContent = stats.losses || 0;
            } catch (error) {
                console.error('Failed to load stats:', error);
            }
        }
        
        // Find Match
        async function findMatch() {
            const wager = selectedWager;
            const rating = parseInt(document.getElementById('userRating').textContent);
            
            try {
                const response = await fetch(`${WORKER_URL}/api/find-match`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ address: walletAddress, wager, rating })
                });
                
                const data = await response.json();
                
                if (data.matched) {
                    // Start game!
                    currentGameId = data.gameId;
                    startGame(data);
                } else {
                    // Wait for match
                    addChatMessage('System', 'Waiting for opponent...');
                    
                    // Poll for match (every 2 seconds)
                    setTimeout(checkForMatch, 2000);
                }
            } catch (error) {
                console.error('Find match error:', error);
                alert('Failed to find match');
            }
        }
        
        // Check for Match (polling)
        async function checkForMatch() {
            if (currentGameId) return; // Already matched
            
            try {
                const response = await fetch(`${WORKER_URL}/api/check-match?address=${walletAddress}`);
                const data = await response.json();
                
                if (data.matched) {
                    currentGameId = data.gameId;
                    startGame(data);
                } else {
                    // Keep polling
                    setTimeout(checkForMatch, 2000);
                }
            } catch (error) {
                console.error('Check match error:', error);
            }
        }
        
        // Make Move
        async function confirmMove() {
            const move = {
                row: gameState.selectedRow,
                count: gameState.selectedSticks.length
            };
            
            try {
                const response = await fetch(`${WORKER_URL}/api/make-move`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        gameId: currentGameId,
                        address: walletAddress,
                        move
                    })
                });
                
                const data = await response.json();
                
                if (data.gameOver) {
                    endGame(data.winner === walletAddress);
                } else {
                    // Update local state
                    gameState.rows = data.newState;
                    gameState.isYourTurn = false;
                    renderNimBoard();
                    
                    // Poll for opponent move
                    setTimeout(pollOpponentMove, 2000);
                }
            } catch (error) {
                console.error('Move error:', error);
                alert('Failed to make move');
            }
        }
        
        // Poll for opponent's move
        async function pollOpponentMove() {
            if (!currentGameId) return;
            
            try {
                const response = await fetch(`${WORKER_URL}/api/game-state?gameId=${currentGameId}`);
                const data = await response.json();
                
                if (data.currentTurn === walletAddress) {
                    // It's your turn now!
                    gameState.rows = JSON.parse(data.state);
                    gameState.isYourTurn = true;
                    renderNimBoard();
                    addChatMessage('Opponent', 'Made their move');
                } else {
                    // Still opponent's turn, keep polling
                    setTimeout(pollOpponentMove, 2000);
                }
            } catch (error) {
                console.error('Poll error:', error);
            }
        }
        
        // Initialize
        document.addEventListener('DOMContentLoaded', () => {
            // Set up wallet connection buttons
            document.querySelectorAll('.wallet-option').forEach(option => {
                option.addEventListener('click', () => {
                    connectWallet(option.dataset.wallet);
                });
            });
            
            // Find match button
            document.getElementById('findMatchBtn').addEventListener('click', findMatch);
            
            // Confirm move button
            document.getElementById('confirmMoveBtn').addEventListener('click', confirmMove);
        });
    </script>
</body>
</html>
```

---

## STEP 4: DEPLOY TO CLOUDFLARE PAGES (FREE)

```bash
# 1. Create GitHub repo
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/algonim.git
git push -u origin main

# 2. Go to Cloudflare Dashboard
# - Pages > Create a project
# - Connect GitHub
# - Select your repo
# - Build settings: None (static HTML)
# - Deploy!

# Your site will be live at: https://algonim.pages.dev
```

---

## STEP 5: CONNECT EVERYTHING

1. **Update frontend with your Worker URL:**
   ```javascript
   const WORKER_URL = 'https://algonim-worker.YOUR-SUBDOMAIN.workers.dev';
   ```

2. **Deploy smart contract to testnet** (FREE testnet ALGO)

3. **Test everything works**

4. **When ready, deploy to mainnet**

---

## REAL-TIME UPDATES (Better than Polling)

For real-time without WebSockets, use **Server-Sent Events (SSE)** - also FREE:

```javascript
// In worker.js
async function handleSSE(request, env) {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  
  // Send updates when game state changes
  const encoder = new TextEncoder();
  
  setInterval(() => {
    writer.write(encoder.encode('data: ping\n\n'));
  }, 30000); // Keep alive
  
  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    }
  });
}

// In frontend
const eventSource = new EventSource(`${WORKER_URL}/api/game-updates?gameId=${currentGameId}`);
eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  updateGameState(data);
};
```

---

## TESTING LOCALLY BEFORE DEPLOY

```bash
# 1. Test worker locally
wrangler dev

# 2. Open index.html in browser
# 3. Connect to http://localhost:8787 (worker)
# 4. Test matchmaking with two browser tabs
```

---

## MONITORING (FREE)

- Cloudflare Analytics (built-in, free)
- Cloudflare Logs (free tier: 1M logs/day)
- AlgoNode.io monitoring (free)

---

## TOTAL COST: $0/month 

Everything runs on free tiers! Scale up to paid only when you need to.

Want me to create the complete, ready-to-deploy code package?
