/**
 * game.js
 * 1人用の練習ゲームの状態管理(山の生成、配牌、ツモ、打牌)。
 * 対人戦・鳴き・役判定は対象外(V1では牌効率の練習に特化)。
 */
(function (root) {
  'use strict';

  let Tiles, Shanten;
  if (typeof module !== 'undefined' && module.exports) {
    Tiles = require('./tiles.js');
    Shanten = require('./shanten.js');
  } else {
    Tiles = root.MJ.Tiles;
    Shanten = root.MJ.Shanten;
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function buildWall() {
    const wall = [];
    for (let i = 0; i < Tiles.TILE_COUNT; i++) {
      for (let k = 0; k < 4; k++) wall.push(i);
    }
    return shuffle(wall);
  }

  /**
   * 新しい練習ゲームを開始する。
   * @returns {object} game state
   */
  function newGame() {
    const wall = buildWall();
    const hand = wall.splice(0, 13);
    const drawn = wall.splice(0, 1)[0];
    return {
      wall,
      hand: hand.sort((a, b) => a - b),
      drawn,
      turn: 1,
      isAgari: false,
      isWallEmpty: false,
    };
  }

  function currentCounts14(state) {
    return Tiles.toCounts(state.hand.concat([state.drawn]));
  }

  /**
   * 指定した牌を打牌し、次のツモを行う。
   * @param {object} state 現在のゲーム状態
   * @param {number} discardTile 切る牌のインデックス
   * @returns {object} 新しいゲーム状態
   */
  function discardAndDraw(state, discardTile) {
    const hand14 = state.hand.concat([state.drawn]);
    const pos = hand14.indexOf(discardTile);
    if (pos === -1) throw new Error('手牌に存在しない牌は切れません');
    hand14.splice(pos, 1);
    const newHand = hand14.sort((a, b) => a - b);

    if (state.wall.length === 0) {
      return { ...state, hand: newHand, drawn: null, isWallEmpty: true };
    }

    const wall = state.wall.slice();
    const drawn = wall.shift();
    const counts14 = Tiles.toCounts(newHand.concat([drawn]));
    const shanten = Shanten.calcShanten(counts14).shanten;

    return {
      wall,
      hand: newHand,
      drawn,
      turn: state.turn + 1,
      isAgari: shanten === -1,
      isWallEmpty: false,
    };
  }

  /**
   * 「何切る」問題用に、ランダムな14枚の手牌を1組生成する(継続進行はしない)。
   */
  function generateProblem() {
    const wall = buildWall();
    const tiles14 = wall.splice(0, 14).sort((a, b) => a - b);
    return { tiles14 };
  }

  const Game = {
    buildWall,
    newGame,
    currentCounts14,
    discardAndDraw,
    generateProblem,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Game;
  } else {
    root.MJ = root.MJ || {};
    root.MJ.Game = Game;
  }
})(typeof window !== 'undefined' ? window : globalThis);
