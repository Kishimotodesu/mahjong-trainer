/**
 * melds.js
 * 副露(チー・ポン・カン)に関する判定・実行ロジック。
 * 手牌は常に「まだ鳴いていない、手の中に残っている牌」の34要素カウント配列として扱い、
 * 副露した面子は別配列(fuuro)で管理する。
 *
 * 簡略化(V1.3): 食い替え(スジ喰い替え等)の禁止ルールは実装していない。
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
   * 指定の捨て牌に対してチーできる組み合わせを列挙する。
   * @param {number[]} handCounts
   * @param {number} discardedTile
   * @returns {Array<number[]>} 各要素は完成する順子の3枚(ソート済み、discardedTileを含む)
   */
  function getChiOptions(handCounts, discardedTile) {
    if (Tiles.isHonor(discardedTile)) return [];
    const pos = discardedTile % 9;
    const base = discardedTile - pos;
    const options = [];

    // [d-2,d-1,d]
    if (pos >= 2 && handCounts[base + pos - 2] > 0 && handCounts[base + pos - 1] > 0) {
      options.push([base + pos - 2, base + pos - 1, discardedTile]);
    }
    // [d-1,d,d+1]
    if (pos >= 1 && pos <= 7 && handCounts[base + pos - 1] > 0 && handCounts[base + pos + 1] > 0) {
      options.push([base + pos - 1, discardedTile, base + pos + 1]);
    }
    // [d,d+1,d+2]
    if (pos <= 6 && handCounts[base + pos + 1] > 0 && handCounts[base + pos + 2] > 0) {
      options.push([discardedTile, base + pos + 1, base + pos + 2]);
    }
    return options;
  }

  function canPon(handCounts, discardedTile) {
    return handCounts[discardedTile] >= 2;
  }

  function canMinkan(handCounts, discardedTile) {
    return handCounts[discardedTile] >= 3;
  }

  /** 自分の手番でツモった直後などに宣言できる暗槓の候補一覧 */
  function getAnkanOptions(handCounts) {
    const options = [];
    for (let i = 0; i < Tiles.TILE_COUNT; i++) {
      if (handCounts[i] >= 4) options.push(i);
    }
    return options;
  }

  /** すでにポン済みの面子を、手の中の4枚目で加槓できる候補一覧 */
  function getKakanOptions(fuuro, handCounts) {
    const options = [];
    fuuro.forEach((meld, idx) => {
      if (meld.type === 'pon' && handCounts[meld.tiles[0]] >= 1) {
        options.push({ meldIndex: idx, tile: meld.tiles[0] });
      }
    });
    return options;
  }

  function applyChi(handCounts, chiTiles, calledTile, fromSeat) {
    const next = handCounts.slice();
    for (const t of chiTiles) {
      if (t === calledTile) continue;
      next[t]--;
    }
    const meld = {
      type: 'chi',
      tiles: chiTiles.slice().sort((a, b) => a - b),
      calledTile,
      from: fromSeat,
      concealed: false,
    };
    return { handCounts: next, meld };
  }

  function applyPon(handCounts, tile, fromSeat) {
    const next = handCounts.slice();
    next[tile] -= 2;
    const meld = { type: 'pon', tiles: [tile, tile, tile], calledTile: tile, from: fromSeat, concealed: false };
    return { handCounts: next, meld };
  }

  function applyMinkan(handCounts, tile, fromSeat) {
    const next = handCounts.slice();
    next[tile] -= 3;
    const meld = { type: 'minkan', tiles: [tile, tile, tile, tile], calledTile: tile, from: fromSeat, concealed: false };
    return { handCounts: next, meld };
  }

  function applyAnkan(handCounts, tile) {
    const next = handCounts.slice();
    next[tile] -= 4;
    const meld = { type: 'ankan', tiles: [tile, tile, tile, tile], calledTile: null, from: null, concealed: true };
    return { handCounts: next, meld };
  }

  /** 既存のポンを加槓する。fuuro配列の該当要素を書き換えるための情報を返す。 */
  function applyKakan(handCounts, tile) {
    const next = handCounts.slice();
    next[tile] -= 1;
    return { handCounts: next };
  }

  /** 副露面子の数(カンも1面子として数える) */
  function countMelds(fuuro) {
    return fuuro.length;
  }

  /**
   * 副露を含めた手牌全体(副露+手の中)を34カウント配列にまとめる(役判定・待ち判定用)。
   */
  function fullHandCounts(handCounts, fuuro) {
    const total = handCounts.slice();
    fuuro.forEach((meld) => {
      meld.tiles.forEach((t) => {
        total[t]++;
      });
    });
    return total;
  }

  const Melds = {
    getChiOptions,
    canPon,
    canMinkan,
    getAnkanOptions,
    getKakanOptions,
    applyChi,
    applyPon,
    applyMinkan,
    applyAnkan,
    applyKakan,
    countMelds,
    fullHandCounts,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Melds;
  } else {
    root.MJ = root.MJ || {};
    root.MJ.Melds = Melds;
  }
})(typeof window !== 'undefined' ? window : globalThis);
