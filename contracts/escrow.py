"""
AlgoNim Escrow Smart Contract (PyTeal)

This smart contract handles wager escrow for AlgoNim games.
It allows two players to deposit their wagers, and releases the pot to the winner.

Flow:
1. Player 1 creates game and deposits wager
2. Player 2 joins and deposits their wager
3. Game is played off-chain (moves validated by worker)
4. Winner is determined, contract releases funds

App State:
- player1: address of first player
- player2: address of second player
- wager: amount each player deposited (in microAlgos)
- game_id: unique game identifier
- winner: address of winner (set when game ends)
- status: 0=waiting, 1=active, 2=complete

Methods:
- create_game: Initialize game with wager amount
- join_game: Second player joins and deposits
- declare_winner: Game server declares winner
- claim_winnings: Winner withdraws pot
- timeout_claim: Claim if opponent abandoned
- cancel_game: Cancel if no opponent joined
"""

from pyteal import *


def approval_program():
    """Main approval program for AlgoNim escrow."""

    # Global state keys
    player1_key = Bytes("player1")
    player2_key = Bytes("player2")
    wager_key = Bytes("wager")
    game_id_key = Bytes("game_id")
    winner_key = Bytes("winner")
    status_key = Bytes("status")
    created_at_key = Bytes("created_at")
    last_move_key = Bytes("last_move")

    # Status values
    STATUS_WAITING = Int(0)
    STATUS_ACTIVE = Int(1)
    STATUS_COMPLETE = Int(2)

    # Timeout values (in seconds)
    JOIN_TIMEOUT = Int(3600)  # 1 hour to find opponent
    ABANDON_TIMEOUT = Int(259200)  # 3 days for casual games

    # Server/oracle address that can declare winners
    # In production, this should be a multisig or decentralized oracle
    GAME_SERVER = Addr("ALGONIM_SERVER_ADDRESS_REPLACE_ME")

    # Initialize the contract (on creation)
    @Subroutine(TealType.uint64)
    def is_creator():
        return Txn.sender() == Global.creator_address()

    # Create a new game
    on_create = Seq([
        # Store initial state
        App.globalPut(player1_key, Txn.sender()),
        App.globalPut(player2_key, Global.zero_address()),
        App.globalPut(wager_key, Btoi(Txn.application_args[0])),
        App.globalPut(game_id_key, Txn.application_args[1]),
        App.globalPut(winner_key, Global.zero_address()),
        App.globalPut(status_key, STATUS_WAITING),
        App.globalPut(created_at_key, Global.latest_timestamp()),
        App.globalPut(last_move_key, Global.latest_timestamp()),
        Return(Int(1))
    ])

    # Join an existing game (player 2)
    on_join = Seq([
        # Verify game is waiting for player
        Assert(App.globalGet(status_key) == STATUS_WAITING),
        # Verify sender is not player 1
        Assert(Txn.sender() != App.globalGet(player1_key)),
        # Verify player 2 slot is empty
        Assert(App.globalGet(player2_key) == Global.zero_address()),
        # Verify payment matches wager
        Assert(Gtxn[1].type_enum() == TxnType.Payment),
        Assert(Gtxn[1].receiver() == Global.current_application_address()),
        Assert(Gtxn[1].amount() == App.globalGet(wager_key)),

        # Update state
        App.globalPut(player2_key, Txn.sender()),
        App.globalPut(status_key, STATUS_ACTIVE),
        App.globalPut(last_move_key, Global.latest_timestamp()),
        Return(Int(1))
    ])

    # Deposit wager (for player 1 initial deposit)
    on_deposit = Seq([
        # Verify sender is player 1
        Assert(Txn.sender() == App.globalGet(player1_key)),
        # Verify payment matches wager
        Assert(Gtxn[1].type_enum() == TxnType.Payment),
        Assert(Gtxn[1].receiver() == Global.current_application_address()),
        Assert(Gtxn[1].amount() == App.globalGet(wager_key)),
        Return(Int(1))
    ])

    # Declare winner (called by game server)
    on_declare_winner = Seq([
        # Only game server can declare winner (or creator for testing)
        Assert(Or(
            Txn.sender() == GAME_SERVER,
            Txn.sender() == Global.creator_address()
        )),
        # Game must be active
        Assert(App.globalGet(status_key) == STATUS_ACTIVE),
        # Winner must be one of the players
        Assert(Or(
            Txn.application_args[1] == App.globalGet(player1_key),
            Txn.application_args[1] == App.globalGet(player2_key)
        )),

        # Set winner and complete game
        App.globalPut(winner_key, Txn.application_args[1]),
        App.globalPut(status_key, STATUS_COMPLETE),
        Return(Int(1))
    ])

    # Claim winnings (winner withdraws pot)
    on_claim = Seq([
        # Game must be complete
        Assert(App.globalGet(status_key) == STATUS_COMPLETE),
        # Sender must be the winner
        Assert(Txn.sender() == App.globalGet(winner_key)),

        # Send pot to winner (2x wager minus fees)
        InnerTxnBuilder.Begin(),
        InnerTxnBuilder.SetFields({
            TxnField.type_enum: TxnType.Payment,
            TxnField.receiver: Txn.sender(),
            TxnField.amount: App.globalGet(wager_key) * Int(2) - Int(1000),  # Reserve 1000 for fees
            TxnField.fee: Int(0),
        }),
        InnerTxnBuilder.Submit(),

        Return(Int(1))
    ])

    # Cancel game (if no opponent joined within timeout)
    on_cancel = Seq([
        # Only player 1 can cancel
        Assert(Txn.sender() == App.globalGet(player1_key)),
        # Game must be waiting
        Assert(App.globalGet(status_key) == STATUS_WAITING),
        # Must be past join timeout
        Assert(Global.latest_timestamp() > App.globalGet(created_at_key) + JOIN_TIMEOUT),

        # Refund player 1's deposit
        InnerTxnBuilder.Begin(),
        InnerTxnBuilder.SetFields({
            TxnField.type_enum: TxnType.Payment,
            TxnField.receiver: App.globalGet(player1_key),
            TxnField.amount: App.globalGet(wager_key) - Int(1000),
            TxnField.fee: Int(0),
        }),
        InnerTxnBuilder.Submit(),

        Return(Int(1))
    ])

    # Claim via timeout (opponent abandoned)
    on_timeout_claim = Seq([
        # Game must be active
        Assert(App.globalGet(status_key) == STATUS_ACTIVE),
        # Sender must be a player
        Assert(Or(
            Txn.sender() == App.globalGet(player1_key),
            Txn.sender() == App.globalGet(player2_key)
        )),
        # Must be past abandon timeout
        Assert(Global.latest_timestamp() > App.globalGet(last_move_key) + ABANDON_TIMEOUT),

        # The claimer wins by opponent abandonment
        App.globalPut(winner_key, Txn.sender()),
        App.globalPut(status_key, STATUS_COMPLETE),

        # Send pot to winner
        InnerTxnBuilder.Begin(),
        InnerTxnBuilder.SetFields({
            TxnField.type_enum: TxnType.Payment,
            TxnField.receiver: Txn.sender(),
            TxnField.amount: App.globalGet(wager_key) * Int(2) - Int(1000),
            TxnField.fee: Int(0),
        }),
        InnerTxnBuilder.Submit(),

        Return(Int(1))
    ])

    # Update last move timestamp (for timeout tracking)
    on_update_move = Seq([
        # Only game server can update move time
        Assert(Or(
            Txn.sender() == GAME_SERVER,
            Txn.sender() == Global.creator_address()
        )),
        # Game must be active
        Assert(App.globalGet(status_key) == STATUS_ACTIVE),

        App.globalPut(last_move_key, Global.latest_timestamp()),
        Return(Int(1))
    ])

    # Route based on application call
    program = Cond(
        [Txn.application_id() == Int(0), on_create],
        [Txn.on_completion() == OnComplete.DeleteApplication, Return(is_creator())],
        [Txn.on_completion() == OnComplete.UpdateApplication, Return(is_creator())],
        [Txn.on_completion() == OnComplete.CloseOut, Return(Int(1))],
        [Txn.on_completion() == OnComplete.OptIn, Return(Int(1))],
        [Txn.application_args[0] == Bytes("join"), on_join],
        [Txn.application_args[0] == Bytes("deposit"), on_deposit],
        [Txn.application_args[0] == Bytes("declare_winner"), on_declare_winner],
        [Txn.application_args[0] == Bytes("claim"), on_claim],
        [Txn.application_args[0] == Bytes("cancel"), on_cancel],
        [Txn.application_args[0] == Bytes("timeout_claim"), on_timeout_claim],
        [Txn.application_args[0] == Bytes("update_move"), on_update_move],
    )

    return program


def clear_state_program():
    """Clear state program - always approves."""
    return Return(Int(1))


if __name__ == "__main__":
    # Compile and output TEAL
    import json

    # Compile approval program
    approval_teal = compileTeal(approval_program(), mode=Mode.Application, version=8)
    print("=== APPROVAL PROGRAM ===")
    print(approval_teal)

    # Compile clear program
    clear_teal = compileTeal(clear_state_program(), mode=Mode.Application, version=8)
    print("\n=== CLEAR STATE PROGRAM ===")
    print(clear_teal)

    # Save to files
    with open("escrow_approval.teal", "w") as f:
        f.write(approval_teal)

    with open("escrow_clear.teal", "w") as f:
        f.write(clear_teal)

    print("\n✓ TEAL files saved to escrow_approval.teal and escrow_clear.teal")
