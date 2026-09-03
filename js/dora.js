/**
 * dora.js
 * ドラ表示牌からドラを求める処理、および手牌中のドラ・赤ドラの枚数計算。
 *
 * 重要: ドラは役ではない。ドラだけではアガれず、他に最低1つ役が必要になる。
 * (この注記はUI側にも明示する)
 */
(function (root) {
  'use strict';

  let Tiles;
  if (typeof module !== 'undefined' && module.exports) {
    Tiles = require('./tiles.js');
  } else {
    Tiles = root.MJ.Tiles;
  }

  /**
   * ドラ表示牌からドラの牌を求める(次の牌。9の次は1、字牌は決まった順で一周する)。
   * 風牌: 東→南→西→北→東 ... 三元牌: 白→發→中→白 ...
   * @param {number} indicatorTile
   * @returns {number} ドラの牌インデックス
   */
  function doraTileFromIndicator(indicatorTile) {
    if (indicatorTile < 27) {
      const suitBase = indicatorTile - (indicatorTile % 9);
      const posInSuit = indicatorTile % 9;
      return suitBase + ((posInSuit + 1) % 9);
    }
    // 27-30: 東南西北 は東→南→西→北→東
    if (indicatorTile <= 30) {
      return 27 + ((indicatorTile - 27 + 1) % 4);
    }
    // 31-33: 白發中 は白→發→中→白
    return 31 + ((indicatorTile - 31 + 1) % 3);
  }

  /**
   * 手牌中のドラ枚数を数える(表示牌1枚分。複数ドラ表示牌がある場合は呼び出し側で合算する)。
   * @param {number[]} counts14
   * @param {number} indicatorTile
   * @returns {{doraTile:number, count:number}}
   */
  function countDoraForIndicator(counts14, indicatorTile) {
    const doraTile = doraTileFromIndicator(indicatorTile);
    return { doraTile, count: counts14[doraTile] || 0 };
  }

  /**
   * 複数のドラ表示牌に対応した合計ドラ枚数を計算する。
   * @param {number[]} counts14
   * @param {number[]} indicatorTiles
   */
  function countTotalDora(counts14, indicatorTiles) {
    let total = 0;
    const details = [];
    for (const ind of indicatorTiles) {
      const { doraTile, count } = countDoraForIndicator(counts14, ind);
      total += count;
      details.push({ indicatorTile: ind, doraTile, count });
    }
    return { total, details };
  }

  /**
   * 赤ドラの合計枚数(ユーザーが「このうち何枚が赤5か」を指定した数の合計)。
   * @param {{m:number,p:number,s:number}} akaCounts
   */
  function countAkaDora(akaCounts) {
    return (akaCounts.m || 0) + (akaCounts.p || 0) + (akaCounts.s || 0);
  }

  const Dora = {
    doraTileFromIndicator,
    countDoraForIndicator,
    countTotalDora,
    countAkaDora,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Dora;
  } else {
    root.MJ = root.MJ || {};
    root.MJ.Dora = Dora;
  }
})(typeof window !== 'undefined' ? window : globalThis);
