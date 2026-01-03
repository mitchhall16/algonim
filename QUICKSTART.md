# 🚀 QUICK START GUIDE

## Run Locally in 30 Seconds

### Method 1: Just Open the File (Easiest)
```bash
# Navigate to the folder
cd algorand-gaming-platform

# Open index.html in your browser
# Mac:
open index.html

# Linux:
xdg-open index.html

# Windows:
start index.html
```

### Method 2: With Local Server (Recommended)
```bash
# Navigate to the folder
cd algorand-gaming-platform

# Start a simple Python server
python3 -m http.server 8000

# Open your browser to:
http://localhost:8000
```

## What You'll See

### 1. Header
- **AlgoNim Logo** on the left
- **Your Stats** (Rating, Wins, Losses) in the middle
- **Connect Wallet** button on the right

### 2. Three-Column Layout

**Left Sidebar - Matchmaking:**
- Choose wager amount (0.0001 to 10 ALGO)
- See how many players waiting at each level
- Click "FIND MATCH" button
- View your active games below

**Center - Game Board:**
- Beautiful vertical Nim sticks (like your image!)
- Three piles arranged horizontally
- Click sticks from top to remove them
- Only remove from ONE pile per turn
- Turn indicator shows whose turn it is

**Right Sidebar - Global Chat:**
- Chat with all players in the lobby
- Real-time messages
- Type and hit Enter or click Send

## Game Flow

1. **Connect Wallet** → Choose Pera, Defly, or Lute
2. **Select Wager** → Pick from 0.0001 to 10 ALGO in left sidebar
3. **Find Match** → Click button, wait 2 seconds for opponent
4. **Play Nim** → Click sticks from top, only from one pile
5. **Win or Lose** → Last stick loses! Rating goes up/down
6. **Multiple Games** → Start another match while playing!

## Game Rules - Nim

- **Setup**: 3 piles with 3, 5, and 7 sticks
- **Turn**: Remove ANY NUMBER from ONE pile
- **Goal**: DON'T take the last stick
- **Winner**: Takes both players' wagers!

### Visual Example:
```
Pile 1    Pile 2      Pile 3
  |        |            |
  |        |            |
  |        |            |
           |            |
           |            |
                        |
                        |
(3)       (5)          (7)
```

Click from the top down on any pile to select sticks.

## Features Working Now

✅ **Proper Nim Board** - Vertical sticks just like you wanted
✅ **Chess-Style Matching** - Find opponents at specific wager levels  
✅ **Rating System** - 1200 starting, +25 win, -15 loss
✅ **Global Chat** - Talk to everyone in the lobby
✅ **Multiple Games** - Play several matches at once
✅ **Asynchronous Play** - Take your turn anytime
✅ **Beautiful UI** - Cyberpunk neon theme

## Current Status

This is a **fully functional demo** with:
- Simulated wallet connections
- AI opponent (makes random moves)
- All UI/UX complete
- Full game logic working

## Next Steps for Production

1. **Real Wallet SDKs**: Integrate actual Pera/Defly/Lute connections
2. **Smart Contracts**: Deploy Algorand smart contracts for game logic
3. **Backend**: Add WebSocket server for real-time multiplayer
4. **Database**: Store games, ratings, chat persistently
5. **Mainnet**: Deploy to Algorand mainnet with real wagers

## Pro Tips

- Try the optimal Nim strategy (Google "Nim strategy XOR")
- Lower wagers = more casual players
- Higher wagers = more competitive players
- Chat to find regular opponents
- Your rating affects matchmaking

## Need Help?

Check the **README.md** for:
- Full architecture details
- Smart contract pseudo-code
- Security considerations
- Real wallet integration examples

Enjoy! The game is fully playable right now! 🎮✨
