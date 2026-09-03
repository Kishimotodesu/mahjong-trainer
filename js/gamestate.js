/**
 * gamestate.js
 * CPU対局(半荘)全体の内部データモデル。JSONシリアライズ可能な設計にしており、
 * 牌譜保存・局面保存・共有はこの構造をそのまま JSON.stringify すればよい。
 */
(function (root) {
  'use strict';

  let Tiles;
  if (typeof module !== 'undefined' && module.exports) {
    Tiles = require('./tiles.js');
  } else {
    Tiles = root.MJ.Tiles;
  }

  const SCHEMA_VERSION = 1;
  const STARTING_SCORE = 25000;
  const SEAT_COUNT = 4;
  const DEAD_WALL_SIZE = 14;
  const HAND_SIZE = 13;

  function shuffle(arr, rng) {
    const random = rng || Math.random;
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function buildShuffledTileSet(rng) {
    const tiles = [];
    for (let i = 0; i < Tiles.TILE_COUNT; i++) {
      for (let k = 0; k < 4; k++) tiles.push(i);
    }
    return shuffle(tiles, rng);
  }

  /** 風の名前(東=0,南=1,西=2,北=3のインデックス)から牌インデックスへ */
  function windTileFromRoundIndex(i) {
    return 27 + (i % 4);
  }

  function createPlayer(seat, name, isHuman) {
    return {
      seat,
      name,
      isHuman: !!isHuman,
      score: STARTING_SCORE,
      handCounts: new Array(Tiles.TILE_COUNT).fill(0),
      drawnTile: null,
      fuuro: [], // melds.js形式
      discards: [], // {tile, tsumogiri, isRiichiDeclare, calledBy:seat|null}
      riichi: false,
      riichiDeclaredAtDiscardIndex: -1,
      isDoubleRiichi: false,
      ippatsuActive: false,
      furitenTemporary: false,
      furitenRiichi: false,
      seatWind: 27,
      isDealer: false,
    };
  }

  /**
   * 新しい半荘(東南戦)を作成する。
   * @param {object} [options] {rules, playerNames, humanSeat}
   */
  function createMatch(options) {
    options = options || {};
    const rules = Object.assign(
      {
        gameLength: 'tonpuusen-or-hanchan', // 'tonpuusen'(東風戦) | 'hanchan'(東南戦)
        startingScore: STARTING_SCORE,
        tobi: true, // 誰かの点数がマイナスになったら即終了
        cpuStrength: 'standard', // 'weak' | 'standard' | 'strong'
      },
      options.rules || {}
    );
    if (rules.gameLength !== 'tonpuusen') rules.gameLength = 'hanchan';

    const names = options.playerNames || ['あなた', 'CPU1', 'CPU2', 'CPU3'];
    const humanSeat = options.humanSeat === undefined ? 0 : options.humanSeat;

    const players = [];
    for (let i = 0; i < SEAT_COUNT; i++) {
      players.push(createPlayer(i, names[i], i === humanSeat));
    }

    return {
      schemaVersion: SCHEMA_VERSION,
      rules,
      roundWindIndex: 0, // 0=東, 1=南
      roundNumber: 1, // 東1局などの「1」
      honba: 0,
      kyotaku: 0,
      dealerSeat: 0,
      players,
      currentRound: null,
      isOver: false,
      finalRanking: null,
      events: [], // 牌譜(kifu.jsが利用する簡易イベントログ)
    };
  }

  /**
   * 新しい局(東1局など)を配牌から開始する。
   */
  function startRound(match, rng) {
    const wallTiles = buildShuffledTileSet(rng);

    const players = match.players.map((p) => {
      const fresh = createPlayer(p.seat, p.name, p.isHuman);
      fresh.score = p.score;
      return fresh;
    });

    for (let i = 0; i < SEAT_COUNT; i++) {
      const seat = (match.dealerSeat + i) % SEAT_COUNT;
      players[seat].isDealer = seat === match.dealerSeat;
      players[seat].seatWind = windTileFromRoundIndex(i);
    }

    // 配牌: 親から順に13枚ずつ
    for (let round = 0; round < HAND_SIZE; round++) {
      for (let i = 0; i < SEAT_COUNT; i++) {
        const seat = (match.dealerSeat + i) % SEAT_COUNT;
        const tile = wallTiles.pop();
        players[seat].handCounts[tile]++;
      }
    }

    const deadWallTiles = [];
    for (let i = 0; i < DEAD_WALL_SIZE; i++) deadWallTiles.push(wallTiles.pop());

    const deadWall = {
      rinshanTiles: deadWallTiles.slice(0, 4),
      doraIndicators: deadWallTiles.slice(4, 9),
      uraDoraIndicators: deadWallTiles.slice(9, 14),
      revealedDoraCount: 1,
      rinshanUsed: 0,
    };

    match.players = players;
    match.currentRound = {
      // 表示用: この局の開始時点での局・本場・供託(和了後に match 側の値が
      // 次局用に更新されても、画面表示は「今見えている局」のままにするため)
      roundWindIndexAtStart: match.roundWindIndex,
      roundNumberAtStart: match.roundNumber,
      honbaAtStart: match.honba,
      dealerSeatAtStart: match.dealerSeat,
      wall: wallTiles, // 残り山(生きている山)
      deadWall,
      turnSeat: match.dealerSeat,
      turnCount: 1,
      phase: 'awaiting_draw', // 'awaiting_draw' | 'awaiting_discard' | 'awaiting_calls' | 'round_over'
      pendingDiscard: null, // {seat, tile}
      callOptions: null, // 直前の捨て牌に対する各家の選択肢
      result: null,
      isFirstGoAround: true, // ダブルリーチ判定用
      anyCallMade: false, // 一発判定用(誰かが鳴いたら一発は消える)
      discardSequence: 0, // 捨て牌の通し番号(フリテン・現物判定に使う)
      pendingRinshan: false,
      justDrewRinshan: false,
      isHaitei: false,
      isHoutei: false,
    };
    match.isOver = false;
    return match;
  }

  function currentDoraIndicators(round) {
    return round.deadWall.doraIndicators.slice(0, round.deadWall.revealedDoraCount);
  }

  function currentUraDoraIndicators(round) {
    return round.deadWall.uraDoraIndicators.slice(0, round.deadWall.revealedDoraCount);
  }

  function isWallEmpty(round) {
    return round.wall.length === 0;
  }

  const GameState = {
    SCHEMA_VERSION,
    STARTING_SCORE,
    SEAT_COUNT,
    HAND_SIZE,
    createMatch,
    createPlayer,
    startRound,
    buildShuffledTileSet,
    windTileFromRoundIndex,
    currentDoraIndicators,
    currentUraDoraIndicators,
    isWallEmpty,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = GameState;
  } else {
    root.MJ = root.MJ || {};
    root.MJ.GameState = GameState;
  }
})(typeof window !== 'undefined' ? window : globalThis);
