# AlgoNim Deployment Guide

This guide walks you through deploying AlgoNim with full mainnet functionality.

## Prerequisites

1. **Cloudflare Account** - Free tier works
2. **Wrangler CLI** - `npm install -g wrangler`
3. **Two Algorand Wallets** with mainnet ALGO:
   - **Escrow Wallet** - Holds player wagers (~1+ ALGO recommended)
   - **Server Wallet** - Sends reminders (~0.5 ALGO recommended)

## Step 1: Create Wallets

### Option A: Using Pera Wallet (Recommended)
1. Download Pera Wallet app on your phone
2. Create TWO new accounts
3. **WRITE DOWN THE 25-WORD MNEMONICS** - Store securely!
4. Fund each wallet with ALGO from an exchange

### Option B: Using algosdk CLI
```bash
# Generate escrow wallet
node -e "const algosdk = require('algosdk'); const acc = algosdk.generateAccount(); console.log('Address:', acc.addr); console.log('Mnemonic:', algosdk.secretKeyToMnemonic(acc.sk));"

# Generate server wallet (run again)
node -e "const algosdk = require('algosdk'); const acc = algosdk.generateAccount(); console.log('Address:', acc.addr); console.log('Mnemonic:', algosdk.secretKeyToMnemonic(acc.sk));"
```

## Step 2: Configure Cloudflare

### Login to Wrangler
```bash
wrangler login
```

### Create D1 Database (if not exists)
```bash
wrangler d1 create algonim-db
```

Update `wrangler.toml` with the database_id from the output.

### Initialize Database Schema
```bash
wrangler d1 execute algonim-db --file=schema.sql
```

## Step 3: Set Environment Variables

### Public Variables
Edit `wrangler.toml` and add your wallet addresses:
```toml
[vars]
ESCROW_ADDRESS = "YOUR_ESCROW_WALLET_ADDRESS_HERE"
SERVER_ADDRESS = "YOUR_SERVER_WALLET_ADDRESS_HERE"
```

### Secret Variables (Mnemonics)
```bash
# Set escrow mnemonic (paste your 25 words when prompted)
wrangler secret put ESCROW_MNEMONIC

# Set server mnemonic
wrangler secret put SERVER_MNEMONIC
```

## Step 4: Deploy Worker

```bash
wrangler deploy
```

Note the URL output, e.g., `https://algonim-worker.YOUR_USERNAME.workers.dev`

## Step 5: Update Frontend

Edit `index.html` and update the WORKER_URL:
```javascript
const ALGO_CONFIG = {
    // ...
    WORKER_URL: 'https://algonim-worker.YOUR_USERNAME.workers.dev',
    // ...
};
```

## Step 6: Deploy Frontend

### Option A: Cloudflare Pages (Recommended)
```bash
# Connect your GitHub repo to Cloudflare Pages
# Or use direct upload:
wrangler pages deploy . --project-name=algonim
```

### Option B: GitHub Pages
Just push to GitHub and enable Pages in repo settings.

## Step 7: Test

1. Open your deployed site
2. Connect with Pera Wallet
3. Check that your balance shows correctly
4. Try finding a match (will wait for opponent)
5. Check worker logs: `wrangler tail`

## Wallet Funding Requirements

| Wallet | Minimum | Recommended | Purpose |
|--------|---------|-------------|---------|
| Escrow | 0.5 ALGO | 2+ ALGO | Hold wagers, pay winners |
| Server | 0.1 ALGO | 0.5 ALGO | Send reminders (0.001 each) |

## Monitoring

### View Worker Logs
```bash
wrangler tail
```

### Check Database
```bash
# List users
wrangler d1 execute algonim-db --command "SELECT * FROM users LIMIT 10"

# List active games
wrangler d1 execute algonim-db --command "SELECT * FROM active_games"

# Check escrow balance
curl https://mainnet-api.algonode.cloud/v2/accounts/YOUR_ESCROW_ADDRESS
```

## Troubleshooting

### "Escrow not configured"
- Make sure ESCROW_ADDRESS is set in wrangler.toml
- Run `wrangler deploy` after changes

### "Failed to process payout"
- Check escrow wallet has enough ALGO
- Verify ESCROW_MNEMONIC secret is set correctly

### Wallet won't connect
- Make sure you're on HTTPS (not localhost unless testing)
- Check browser console for errors
- Try clearing Pera Wallet connection and reconnecting

## Security Checklist

- [ ] Mnemonics stored as secrets, NOT in code
- [ ] .gitignore includes wallet files
- [ ] Escrow wallet is dedicated (not personal wallet)
- [ ] Regular monitoring of escrow balance
- [ ] Backup of wallet mnemonics in secure location

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Frontend      │────▶│  Cloudflare      │────▶│   Algorand      │
│   (index.html)  │     │  Worker          │     │   Mainnet       │
│                 │     │                  │     │                 │
│  - Pera Wallet  │     │  - Matchmaking   │     │  - Escrow Txns  │
│  - Defly Wallet │     │  - Game State    │     │  - Reminders    │
│  - Lute Wallet  │     │  - Payouts       │     │  - Payouts      │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                               │
                               ▼
                        ┌──────────────────┐
                        │  Cloudflare D1   │
                        │  (SQLite)        │
                        │                  │
                        │  - Users         │
                        │  - Games         │
                        │  - History       │
                        └──────────────────┘
```

## Support

If you encounter issues:
1. Check `wrangler tail` for errors
2. Verify wallet balances
3. Test API endpoints directly
4. Open an issue on GitHub
