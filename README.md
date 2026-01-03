# AlgoNim - Decentralized Gaming on Algorand

A chess-like strategic gaming platform built on Algorand blockchain where players can compete asynchronously in Nim games and wager cryptocurrency.

## Features

- 🔐 **Wallet Integration**: Connect with Pera, Defly, or Lute wallets
- 🎮 **Nim Game**: Classic strategy game with proper stick visualization
- ⚔️ **Chess-Style Matchmaking**: Find opponents at specific wager levels
- 📊 **Rating System**: ELO-style ratings that go up/down with wins/losses
- 💬 **Global Chat**: Communicate with all players in the lobby
- 🎯 **Multiple Games**: Play several matches simultaneously
- 💰 **Wager Increments**: 0.0001, 0.001, 0.01, 0.1, 1, 10 ALGO
- ⏱️ **Asynchronous Play**: Take your turn anytime, like chess.com

## Quick Start (Local Development)

```bash
# Just open the file
open index.html

# Or with a server
python3 -m http.server 8000
# Visit http://localhost:8000
```

## How It Works

### Matchmaking
1. Connect your Algorand wallet (Pera/Defly/Lute)
2. Select a wager amount from the sidebar (0.0001 to 10 ALGO)
3. Click "FIND MATCH" to be paired with an opponent
4. See how many players are waiting at each wager level

### Nim Game Rules
- Three piles of sticks: Pile 1 (3), Pile 2 (5), Pile 3 (7)
- Players alternate turns
- On your turn, remove ANY NUMBER of sticks from ONE pile
- **The player who takes the LAST stick LOSES**
- Winner takes the entire pot (both wagers)

### Rating System
- Start at 1200 rating (like chess)
- Win: +25 rating
- Loss: -15 rating
- Match with players of similar skill level
- Track your wins/losses in the header

### Multiple Games
- Play multiple matches simultaneously
- See all your active games in the sidebar
- Click any game to switch to that board
- "Your Turn" indicator shows which games need attention

### Global Chat
- Chat with all players in the lobby
- Discuss strategy, find opponents, trash talk
- Real-time message updates

## Architecture

### Current Demo Features
- ✅ Proper vertical Nim stick visualization
- ✅ Chess-style matchmaking by wager
- ✅ Rating system (ELO-like)
- ✅ Global chat
- ✅ Multiple simultaneous games
- ✅ Asynchronous turn-based play
- ✅ Responsive 3-column layout

### Production Features Needed
- 🔄 Real Pera Wallet integration (@perawallet/connect)
- 🔄 Real Defly Wallet integration (@blockshake/defly-connect)
- 🔄 Lute Wallet integration
- 🔄 Algorand smart contracts for game logic
- 🔄 On-chain matchmaking
- 🔄 Persistent game state on blockchain
- 🔄 Escrow smart contract for wagers
- 🔄 Real-time WebSocket for chat and game updates

## UI Layout

```
┌─────────────────────────────────────────────────────┐
│  Header: Logo | Rating/Wins/Losses | Connect Wallet │
├──────────┬──────────────────────────┬───────────────┤
│          │                          │               │
│ Wager    │    Nim Game Board        │  Global       │
│ Selection│    (Stick Visualization) │  Chat         │
│          │                          │               │
│ 0.0001   │         🎯               │  💬           │
│ 0.001    │      ||||||||            │               │
│ 0.01     │     |||||||||            │  Player1: gg  │
│ 0.1 ⭐   │    ||||||||||            │  Player2: wp  │
│ 1        │                          │               │
│ 10       │   [Confirm] [Resign]     │  You: ...     │
│          │                          │               │
│ [FIND    │                          │  [Send]       │
│  MATCH]  │                          │               │
│          │                          │               │
│ Active   │                          │               │
│ Games:   │                          │               │
│ • vs ABC │                          │               │
│   (Your  │                          │               │
│    Turn) │                          │               │
└──────────┴──────────────────────────┴───────────────┘
```

## Nim Strategy Tips

Nim is a solved game with optimal strategy:
- Calculate the "nim-sum" (XOR of all pile sizes)
- If nim-sum is 0, you're in a losing position
- If nim-sum is non-zero, there's a winning move
- Leave your opponent with nim-sum = 0

Example:
- Piles: [3, 5, 7]
- Binary: 011, 101, 111
- XOR: 001 (non-zero = winning position)

## Integrating Real Wallets

### Pera Wallet Integration

```javascript
import { PeraWalletConnect } from '@perawallet/connect';

const peraWallet = new PeraWalletConnect();

// Connect
const accounts = await peraWallet.connect();
const address = accounts[0];

// Sign transaction
const signedTxn = await peraWallet.signTransaction([txn]);
```

### Defly Wallet Integration

```javascript
import { DeflyWalletConnect } from '@blockshake/defly-connect';

const deflyWallet = new DeflyWalletConnect();

// Connect
await deflyWallet.connect();
const accounts = deflyWallet.connectedAccounts;

// Sign transaction
const signedTxn = await deflyWallet.signTransaction([txn]);
```

### Transaction Flow

1. **Create Game**: Player 1 sends ALGO to escrow contract
2. **Join Game**: Player 2 matches wager to escrow
3. **Game Play**: Moves are recorded on-chain
4. **Winner Declaration**: Smart contract releases funds to winner

## Smart Contract Pseudo-Code

```python
# Nim Game Contract
if create_game:
    # Store game state
    # Lock player 1's wager
    
if join_game:
    # Lock player 2's wager
    # Initialize game
    
if make_move:
    # Validate move
    # Update game state
    # Check win condition
    
if declare_winner:
    # Verify game completion
    # Transfer total pot to winner
```

## Development Roadmap

### Phase 1 (Current)
- [x] UI/UX Design
- [x] Frontend game logic
- [x] Wallet connection flow

### Phase 2 (Next)
- [ ] Algorand SDK integration
- [ ] Real wallet connections
- [ ] Basic smart contract
- [ ] Testnet deployment

### Phase 3 (Future)
- [ ] Mainnet deployment
- [ ] Multiple game types
- [ ] Tournament system
- [ ] Leaderboards
- [ ] NFT rewards

## Testing on Algorand

### Testnet Testing
1. Get testnet ALGO from dispenser: https://bank.testnet.algorand.network/
2. Deploy contract to testnet
3. Test with testnet wallets

### Mainnet Deployment
1. Audit smart contracts
2. Security review
3. Gradual rollout
4. Monitor for issues

## Security Considerations

- Smart contract audits required before mainnet
- Implement timeouts for inactive games
- Protect against front-running
- Validate all moves on-chain
- Use atomic transactions for wagering

## Technologies

- **Frontend**: Vanilla JavaScript, HTML5, CSS3
- **Blockchain**: Algorand
- **Wallets**: Pera, Defly, Lute
- **Smart Contracts**: PyTeal / TEAL

## Contributing

This is a demo project. To make it production-ready:

1. Implement actual wallet SDKs
2. Deploy smart contracts
3. Add comprehensive testing
4. Security audit
5. Legal compliance review

## License

MIT

## Disclaimer

This is a demonstration project. Cryptocurrency gambling may be illegal in your jurisdiction. Always verify local laws before deploying real-money gaming applications.
