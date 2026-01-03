export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };
    
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }
    
    if (url.pathname === '/api/find-match') {
      return handleFindMatch(request, env, corsHeaders);
    }
    
    if (url.pathname === '/api/make-move') {
      return handleMakeMove(request, env, corsHeaders);
    }
    
    if (url.pathname === '/api/game-state') {
      return handleGameState(request, env, corsHeaders);
    }
    
    return new Response('AlgoNim API Running', { headers: corsHeaders });
  }
};

async function handleFindMatch(request, env, corsHeaders) {
  const data = await request.json();
  const { address, wager, rating } = data;
  
  const db = env.DB;
  
  const waiting = await db.prepare(
    'SELECT * FROM waiting_players WHERE wager = ? LIMIT 1'
  ).bind(wager).first();
  
  if (waiting) {
    const gameId = 'game_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    
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
  
  const game = await db.prepare('SELECT * FROM active_games WHERE game_id = ?')
    .bind(gameId).first();
  
  if (!game) {
    return new Response(JSON.stringify({ error: 'Game not found' }), { 
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  }
  
  if (game.current_turn !== address) {
    return new Response(JSON.stringify({ error: 'Not your turn' }), { 
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  }
  
  const state = JSON.parse(game.state);
  state[move.row] -= move.count;
  
  const totalSticks = state.reduce((a, b) => a + b, 0);
  
  if (totalSticks === 0) {
    const winner = address === game.player1 ? game.player2 : game.player1;
    
    await db.prepare('DELETE FROM active_games WHERE game_id = ?')
      .bind(gameId).run();
    
    return new Response(JSON.stringify({
      gameOver: true,
      winner,
      loser: address
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
  
  const nextTurn = address === game.player1 ? game.player2 : game.player1;
  
  await db.prepare(
    'UPDATE active_games SET state = ?, current_turn = ? WHERE game_id = ?'
  ).bind(JSON.stringify(state), nextTurn, gameId).run();
  
  return new Response(JSON.stringify({
    success: true,
    newState: state,
    yourTurn: false
  }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

async function handleGameState(request, env, corsHeaders) {
  const url = new URL(request.url);
  const gameId = url.searchParams.get('gameId');
  
  const db = env.DB;
  
  const game = await db.prepare('SELECT * FROM active_games WHERE game_id = ?')
    .bind(gameId).first();
  
  if (!game) {
    return new Response(JSON.stringify({ error: 'Game not found' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
  
  return new Response(JSON.stringify(game), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}
