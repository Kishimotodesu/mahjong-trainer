/**
 * handbuilder.js
 * 「手牌分析」タブでの任意手牌入力(34種パレットからのクリック入力)を
 * 検証するための純粋関数群。DOM操作は行わない。
 */
(function (root) {
  'use strict';

  let Tiles;
  if (typeof module !== 'undefined' && module.exports) {
    Tiles = require('./tiles.js');
  } else {
    Tiles = root.MJ.Tiles;
  }

  const MAX_PER_TILE = 4;
  const MAX_HAND_SIZE = 14;
  const MIN_ANALYZABLE_SIZE = 13;

  function createEmptyCounts() {
    return new Array(Tiles.TILE_COUNT).fill(0);
  }

  function canAdd(counts, tileIdx) {
    if (Tiles.totalCount(counts) >= MAX_HAND_SIZE) return false;
    if (counts[tileIdx] >= MAX_PER_TILE) return false;
    return true;
  }

  /** @returns {number[]} 新しいcounts配列(不変更新) */
  function addTile(counts, tileIdx) {
    if (!canAdd(counts, tileIdx)) return counts;
    const next = counts.slice();
    next[tileIdx]++;
    return next;
  }

  function canRemove(counts, tileIdx) {
    return counts[tileIdx] > 0;
  }

  function removeTile(counts, tileIdx) {
    if (!canRemove(counts, tileIdx)) return counts;
    const next = counts.slice();
    next[tileIdx]--;
    return next;
  }

  function reset() {
    return createEmptyCounts();
  }

  /**
   * 分析可能な状態かどうかを判定する。
   * 13枚(現在の受けの確認のみ)または14枚(打牌候補ランキングまで表示)を許可する。
   */
  function isAnalyzable(counts) {
    const total = Tiles.totalCount(counts);
    return total === MIN_ANALYZABLE_SIZE || total === MAX_HAND_SIZE;
  }

  function statusText(counts) {
    const total = Tiles.totalCount(counts);
    if (total < MIN_ANALYZABLE_SIZE) return `現在${total}枚(あと${MIN_ANALYZABLE_SIZE - total}枚で分析できます)`;
    if (total === MIN_ANALYZABLE_SIZE) return `現在${total}枚(このまま分析できます。もう1枚追加すると打牌候補まで分析できます)`;
    if (total === MAX_HAND_SIZE) return `現在${total}枚(分析できます)`;
    return `現在${total}枚(14枚を超えています。牌を減らしてください)`;
  }

  const HandBuilder = {
    MAX_PER_TILE,
    MAX_HAND_SIZE,
    MIN_ANALYZABLE_SIZE,
    createEmptyCounts,
    canAdd,
    addTile,
    canRemove,
    removeTile,
    reset,
    isAnalyzable,
    statusText,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = HandBuilder;
  } else {
    root.MJ = root.MJ || {};
    root.MJ.HandBuilder = HandBuilder;
  }
})(typeof window !== 'undefined' ? window : globalThis);
