/**
 * ukeire.js
 * 有効牌(シャンテン数を進める牌)と受け入れ枚数の計算。
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
  const TILE_COUNT = Tiles.TILE_COUNT;

  /**
   * 手牌(枚数配列)から見て、まだ山や他家に残っている理論上の枚数を返す。
   * 一人用トレーニングのため、自分の手牌にある分だけを4枚から差し引いた
   * 理論値とする(他家の捨て牌・副露は考慮しない)。
   */
  function remainingCount(counts, tileIdx) {
    return 4 - counts[tileIdx];
  }

  /**
   * 指定した手牌(枚数配列)に対する有効牌の一覧を計算する。
   * 有効牌 = その牌を1枚加えるとシャンテン数が現在より進む(小さくなる)牌。
   * @param {number[]} counts 34要素の枚数配列(手の中の牌のみ。副露は含めない)
   * @param {object} [options]
   * @param {number} [options.lockedMelds] 副露によってすでに確定している面子の数
   * @param {number[]} [options.visibleCounts] 自分の手牌・副露・全員の捨て牌・ドラ表示牌など
   *   実際に見えている牌の枚数配列。指定した場合、残り枚数の計算にはこちらを使う
   *   (指定が無ければ自分の手牌のみを差し引いた理論値になる)。
   * @returns {{shanten:number, type:string, tiles:Array<{tile:number, remaining:number}>, total:number}}
   */
  function calcUkeire(counts, options) {
    options = options || {};
    const lockedMelds = options.lockedMelds || 0;
    const visible = options.visibleCounts || counts;
    const base = Shanten.calcShanten(counts, lockedMelds);
    const tiles = [];
    let total = 0;

    for (let i = 0; i < TILE_COUNT; i++) {
      if (counts[i] >= 4) continue; // これ以上増やせない
      const remaining = 4 - visible[i];
      if (remaining <= 0) continue;

      const next = counts.slice();
      next[i]++;
      const nextShanten = Shanten.calcShanten(next, lockedMelds).shanten;

      if (nextShanten < base.shanten) {
        tiles.push({ tile: i, remaining, resultShanten: nextShanten });
        total += remaining;
      }
    }

    return { shanten: base.shanten, type: base.type, tiles, total };
  }

  const Ukeire = {
    remainingCount,
    calcUkeire,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Ukeire;
  } else {
    root.MJ = root.MJ || {};
    root.MJ.Ukeire = Ukeire;
  }
})(typeof window !== 'undefined' ? window : globalThis);
