/**
 * AlgoNim Wallet Configuration
 *
 * IMPORTANT: Copy this file to wallets.js and fill in your real values.
 * NEVER commit wallets.js to git - it contains sensitive mnemonics!
 *
 * You need TWO wallets for AlgoNim to function:
 *
 * 1. ESCROW WALLET - Holds player wagers during games
 *    - Should have enough ALGO to cover transaction fees
 *    - Receives wagers from players
 *    - Pays out to winners
 *
 * 2. SERVER WALLET - Sends reminder/notification transactions
 *    - Used to send small ALGO payments with notes to remind players
 *    - Needs enough ALGO for reminder fees (0.001 ALGO per reminder)
 *
 * HOW TO CREATE WALLETS:
 * 1. Go to https://perawallet.app or use Pera mobile app
 * 2. Create two new accounts
 * 3. BACKUP THE 25-WORD MNEMONICS SECURELY
 * 4. Fund each wallet with at least 1 ALGO from an exchange
 * 5. Copy the addresses and mnemonics below
 */

// Escrow Wallet - Holds game wagers
export const ESCROW_WALLET = {
  // The public address (58 characters, starts with ALGO letters)
  address: 'YOUR_ESCROW_WALLET_ADDRESS_HERE',

  // The 25-word mnemonic phrase - KEEP THIS SECRET!
  // Example: "word1 word2 word3 ... word25"
  mnemonic: 'YOUR_ESCROW_WALLET_25_WORD_MNEMONIC_HERE'
};

// Server Wallet - Sends reminders and notifications
export const SERVER_WALLET = {
  // The public address
  address: 'YOUR_SERVER_WALLET_ADDRESS_HERE',

  // The 25-word mnemonic phrase - KEEP THIS SECRET!
  mnemonic: 'YOUR_SERVER_WALLET_25_WORD_MNEMONIC_HERE'
};

// Minimum balances (in ALGO)
export const WALLET_CONFIG = {
  // Minimum ALGO the escrow should maintain for fees
  ESCROW_MIN_BALANCE: 1.0,

  // Minimum ALGO the server wallet needs for reminders
  SERVER_MIN_BALANCE: 0.5,

  // Amount sent with reminder transactions
  REMINDER_AMOUNT: 0.001,

  // Platform fee percentage (0 = no fee, 0.01 = 1%)
  PLATFORM_FEE: 0,

  // Fee collection wallet (if PLATFORM_FEE > 0)
  FEE_WALLET: ''
};

/**
 * SECURITY CHECKLIST:
 *
 * [ ] Created escrow wallet and backed up mnemonic
 * [ ] Created server wallet and backed up mnemonic
 * [ ] Funded escrow wallet with at least 1 ALGO
 * [ ] Funded server wallet with at least 0.5 ALGO
 * [ ] Added wallets.js to .gitignore
 * [ ] Set mnemonics as Cloudflare Worker secrets (not env vars)
 *
 * To set secrets in Cloudflare:
 * wrangler secret put ESCROW_MNEMONIC
 * wrangler secret put SERVER_MNEMONIC
 */
