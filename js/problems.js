/**
 * problems.js
 * 「何切る」問題モードの出題ロジック。
 * 継続進行はせず、毎回ランダムな14枚の問題を1つ生成する。
 */
(function (root) {
  'use strict';

  let Tiles, Game, Evaluator;
  if (typeof module !== 'undefined' && module.exports) {
    Tiles = require('./tiles.js');
    Game = require('./game.js');
    Evaluator = require('./evaluator.js');
  } else {
    Tiles = root.MJ.Tiles;
    Game = root.MJ.Game;
    Evaluator = root.MJ.Evaluator;
  }

  /**
   * 新しい問題を1問生成し、あわせて分析結果も返す。
   */
  function nextProblem() {
    const problem = Game.generateProblem();
    const counts14 = Tiles.toCounts(problem.tiles14);
    const analysis = Evaluator.analyzeHand(counts14);
    return {
      tiles14: problem.tiles14,
      counts14,
      analysis,
      answered: false,
    };
  }

  const Problems = { nextProblem };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Problems;
  } else {
    root.MJ = root.MJ || {};
    root.MJ.Problems = Problems;
  }
})(typeof window !== 'undefined' ? window : globalThis);
