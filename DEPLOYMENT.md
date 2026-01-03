# AlgoNim Deployment Guide

## 🏠 LOCAL TESTING WITH 2 WALLETS

### Option 1: Simple Browser Testing (Easiest)

1. **Open Two Browser Profiles:**
   ```bash
   # Chrome/Brave - Create two separate profiles
   # Profile 1: Your main wallet
   # Profile 2: Your test wallet
   
   # Or use different browsers:
   # Browser 1: Chrome with Wallet A
   # Browser 2: Firefox with Wallet B
   ```

2. **Install Wallet Extensions in Each:**
   - Profile 1: Install Pera Wallet extension
   - Profile 2: Install Defly Wallet extension
   - Each connected to a different Algorand address

3. **Run Local Server:**
   ```bash
   cd algorand-gaming-platform
   python3 -m http.server 8000
   ```

4. **Access in Both Browsers:**
   - Browser 1: http://localhost:8000
   - Browser 2: http://localhost:8000
   
5. **Play Against Yourself:**
   - Browser 1: Connect Wallet A, create game
   - Browser 2: Connect Wallet B, join same wager level
   - You'll be matched!

### Option 2: Full Local Development with Backend

For real multiplayer with matchmaking, you need:

**Backend Server (Node.js/Express):**
```bash
# Install dependencies
npm install express socket.io algosdk cors

# Create server.js
```

```javascript
// server.js - Simple matchmaking server
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const algosdk = require('algosdk');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: { origin: "*" }
});

// Game state
const waitingPlayers = {}; // Organized by wager amount
const activeGames = {};

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);
  
  // Find match
  socket.on('find_match', ({ address, wager, rating }) => {
    const wagerKey = wager.toString();
    
    if (!waitingPlayers[wagerKey]) {
      waitingPlayers[wagerKey] = [];
    }
    
    // Check if someone is waiting at this wager level
    const waiting = waitingPlayers[wagerKey];
    
    if (waiting.length > 0) {
      // Match found!
      const opponent = waiting.shift();
      const gameId = `game_${Date.now()}`;
      
      activeGames[gameId] = {
        player1: opponent,
        player2: { socket: socket.id, address, rating },
        wager,
        state: [1, 3, 5, 7],
        currentTurn: 'player1'
      };
      
      // Notify both players
      io.to(opponent.socket).emit('match_found', {
        gameId,
        opponent: address,
        opponentRating: rating,
        yourTurn: true
      });
      
      socket.emit('match_found', {
        gameId,
        opponent: opponent.address,
        opponentRating: opponent.rating,
        yourTurn: false
      });
    } else {
      // Add to waiting list
      waitingPlayers[wagerKey].push({ socket: socket.id, address, rating });
      socket.emit('waiting', { wager });
    }
  });
  
  // Make move
  socket.on('make_move', ({ gameId, move }) => {
    const game = activeGames[gameId];
    if (!game) return;
    
    // Validate it's their turn
    const isPlayer1 = game.player1.socket === socket.id;
    const isPlayer2 = game.player2.socket === socket.id;
    
    if ((isPlayer1 && game.currentTurn === 'player1') ||
        (isPlayer2 && game.currentTurn === 'player2')) {
      
      // Apply move
      game.state[move.row] -= move.count;
      
      // Check win condition
      const totalSticks = game.state.reduce((a, b) => a + b, 0);
      if (totalSticks === 0) {
        // Current player took last stick = loses
        const winner = isPlayer1 ? game.player2 : game.player1;
        const loser = isPlayer1 ? game.player1 : game.player2;
        
        io.to(winner.socket).emit('game_over', { won: true, wager: game.wager * 2 });
        io.to(loser.socket).emit('game_over', { won: false, wager: game.wager });
        
        delete activeGames[gameId];
      } else {
        // Switch turns
        game.currentTurn = isPlayer1 ? 'player2' : 'player1';
        
        // Notify opponent
        const opponentSocket = isPlayer1 ? game.player2.socket : game.player1.socket;
        io.to(opponentSocket).emit('opponent_moved', {
          move,
          newState: game.state,
          yourTurn: true
        });
        
        socket.emit('move_confirmed', {
          newState: game.state,
          yourTurn: false
        });
      }
    }
  });
  
  socket.on('disconnect', () => {
    console.log('Player disconnected:', socket.id);
    // Remove from waiting lists
    Object.keys(waitingPlayers).forEach(wager => {
      waitingPlayers[wager] = waitingPlayers[wager].filter(p => p.socket !== socket.id);
    });
  });
});

server.listen(3000, () => {
  console.log('🎮 AlgoNim Server running on port 3000');
});
```

**Run the server:**
```bash
node server.js
```

**Update frontend to connect:**
```javascript
// In your HTML file, add socket.io client
<script src="https://cdn.socket.io/4.5.4/socket.io.min.js"></script>

<script>
const socket = io('http://localhost:3000');

// When finding match
socket.emit('find_match', {
  address: walletAddress,
  wager: selectedWager,
  rating: userRating
});

// Listen for match
socket.on('match_found', (data) => {
  startGame(data);
});

// Make move
socket.emit('make_move', {
  gameId: currentGameId,
  move: { row: selectedRow, count: stickCount }
});
</script>
```

---

## 🚀 MAINNET DEPLOYMENT

### Phase 1: Smart Contracts (Required)

You need Algorand smart contracts for:
1. **Escrow Contract** - Holds wagers
2. **Game State Contract** - Validates moves on-chain
3. **Matchmaking Contract** - Pairs players

**Create Smart Contract (PyTeal):**

```python
# nim_escrow.py
from pyteal import *

def nim_escrow():
    """
    Escrow contract that holds both players' wagers
    and releases to winner when game concludes
    """
    
    # Game creator
    creator = Txn.sender()
    
    # Opponent joins
    opponent = App.globalGet(Bytes("opponent"))
    
    # Wager amount
    wager = App.globalGet(Bytes("wager"))
    
    # Game state: 4 rows
    row1 = App.globalGet(Bytes("row1"))
    row2 = App.globalGet(Bytes("row2"))
    row3 = App.globalGet(Bytes("row3"))
    row4 = App.globalGet(Bytes("row4"))
    
    # Current turn (0 = creator, 1 = opponent)
    current_turn = App.globalGet(Bytes("turn"))
    
    on_creation = Seq([
        App.globalPut(Bytes("creator"), creator),
        App.globalPut(Bytes("wager"), Txn.application_args[0]),
        App.globalPut(Bytes("row1"), Int(1)),
        App.globalPut(Bytes("row2"), Int(3)),
        App.globalPut(Bytes("row3"), Int(5)),
        App.globalPut(Bytes("row4"), Int(7)),
        App.globalPut(Bytes("turn"), Int(0)),
        Return(Int(1))
    ])
    
    # Join game - opponent matches wager
    join_game = Seq([
        Assert(App.globalGet(Bytes("opponent")) == Bytes("")),
        Assert(Gtxn[0].amount() == App.globalGet(Bytes("wager"))),
        App.globalPut(Bytes("opponent"), Txn.sender()),
        Return(Int(1))
    ])
    
    # Make move
    make_move = Seq([
        # Verify it's your turn
        Assert(Or(
            And(current_turn == Int(0), Txn.sender() == creator),
            And(current_turn == Int(1), Txn.sender() == opponent)
        )),
        
        # Get move parameters
        # arg[0] = row index (0-3)
        # arg[1] = count to remove
        
        # Update game state
        # ... validate and update rows ...
        
        # Check win condition
        If(And(row1 == Int(0), row2 == Int(0), row3 == Int(0), row4 == Int(0)),
            # Current player took last stick = loses
            # Transfer total pot to other player
            Seq([
                # Winner gets 2x wager
                # ... payment transaction ...
                Return(Int(1))
            ]),
            # Game continues, switch turn
            Seq([
                App.globalPut(Bytes("turn"), Int(1) - current_turn),
                Return(Int(1))
            ])
        )
    ])
    
    program = Cond(
        [Txn.application_id() == Int(0), on_creation],
        [Txn.application_args[0] == Bytes("join"), join_game],
        [Txn.application_args[0] == Bytes("move"), make_move]
    )
    
    return program

if __name__ == "__main__":
    print(compileTeal(nim_escrow(), Mode.Application, version=6))
```

**Compile and Deploy:**
```bash
# Install PyTeal
pip install pyteal

# Compile
python3 nim_escrow.py > nim_escrow.teal

# Compile to bytecode
goal clerk compile nim_escrow.teal

# Deploy to testnet first
goal app create \
  --creator YOUR_ADDRESS \
  --approval-prog nim_escrow.teal \
  --clear-prog clear_program.teal \
  --global-byteslices 10 \
  --global-ints 10 \
  --local-byteslices 0 \
  --local-ints 0
```

### Phase 2: Real Wallet Integration

**Pera Wallet:**
```javascript
import { PeraWalletConnect } from '@perawallet/connect';

const peraWallet = new PeraWalletConnect();

// Connect
async function connectPera() {
  const accounts = await peraWallet.connect();
  return accounts[0];
}

// Sign transaction
async function signTransaction(txn) {
  const signedTxn = await peraWallet.signTransaction([[{ txn }]]);
  return signedTxn;
}
```

**Defly Wallet:**
```javascript
import { DeflyWalletConnect } from '@blockshake/defly-connect';

const deflyWallet = new DeflyWalletConnect();

async function connectDefly() {
  await deflyWallet.connect();
  return deflyWallet.connectedAccounts[0];
}
```

### Phase 3: Backend Infrastructure

**Requirements:**
- WebSocket server (for real-time gameplay)
- Database (PostgreSQL for game history, ratings)
- Algorand node (or use AlgoNode API)

**Tech Stack:**
```
Frontend: React + Algorand wallet SDKs
Backend: Node.js/Express + Socket.io
Database: PostgreSQL
Blockchain: Algorand Mainnet
Hosting: AWS/Vercel/Railway
```

### Phase 4: Deploy to Mainnet

**Checklist:**
```
✅ Smart contracts audited
✅ Testnet fully tested (at least 100 games)
✅ Security review completed
✅ Rate limiting implemented
✅ Error handling robust
✅ Legal compliance checked
✅ Terms of service created
✅ Privacy policy created
✅ Monitoring/logging setup
✅ Backup systems ready
```

**Deployment Steps:**
```bash
# 1. Deploy smart contracts to mainnet
goal app create --creator YOUR_ADDRESS ... --network mainnet

# 2. Deploy backend to production server
# (AWS, Railway, Heroku, etc.)

# 3. Deploy frontend to CDN
# (Vercel, Netlify, Cloudflare Pages)

# 4. Point domain to frontend
# 5. Enable SSL certificate
# 6. Test with small wagers first
# 7. Monitor closely for first 48 hours
```

---

## 📋 ESTIMATED COSTS

### Development:
- Smart contract audit: $5,000 - $15,000
- Legal review: $2,000 - $5,000
- Development time: 200-400 hours

### Monthly Operations:
- Server hosting: $50-200/month
- Database: $20-100/month
- Algorand transaction fees: Variable (0.001 ALGO per txn)
- Monitoring tools: $50/month
- Domain: $10-20/year

### Initial Launch:
- Marketing: $1,000+
- Liquidity pool: $5,000+ (for instant payouts)

---

## 🔒 SECURITY CONSIDERATIONS

1. **Smart Contract Security:**
   - Use formal verification
   - Multiple audits
   - Bug bounty program
   - Timelock for major changes

2. **Frontend Security:**
   - Never store private keys
   - Validate all inputs
   - Rate limit API calls
   - HTTPS only

3. **Backend Security:**
   - Validate all moves on-chain
   - Prevent replay attacks
   - Monitor for suspicious patterns
   - Implement withdrawal limits

4. **Legal:**
   - Check gambling laws in jurisdictions
   - Implement age verification
   - KYC/AML for large amounts
   - Terms of Service
   - Privacy Policy

---

## 🎯 QUICK START FOR LOCAL TESTING

**Simplest way to test locally right now:**

```bash
# 1. Open index.html in two browsers
# 2. Each connects different wallet
# 3. Currently plays against AI
# 4. To play against yourself, you need the backend server above
```

**To enable real multiplayer locally:**
1. Set up the Node.js server (server.js above)
2. Modify frontend to use Socket.io
3. Both browsers connect to localhost:3000
4. Matchmaking works between browsers

Would you like me to create the complete backend server code or help with a specific part of the deployment?
