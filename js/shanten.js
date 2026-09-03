/**
 * shanten.js
 * シャンテン数計算(通常手・七対子・国士無双)。
 *
 * 通常手は「面子・搭子・対子への分解」を全探索し、最小シャンテン数を与える
 * 分解(blocks)を求める再帰アルゴリズムで計算する。
 * この分解結果(blocks)は evaluator.js で「なぜこの牌を残すべきか」を
 * 説明するために利用する。
 *
 * 14枚(打牌前)の手牌に対してこの関数をそのまま適用すると、
 * 「最適な1枚を切った後に得られる最小シャンテン数」と一致する
 * (analyze対象が13枚のときと同じロジックで、余った1枚は
 * 「孤立牌として無視してよい」選択肢が常に探索されるため)。
 * これにより13枚・14枚どちらの手牌にも同じ関数を使い回せる。
 */
(function (root) {
  'use strict';

  const Tiles = typeof module !== 'undefined' && module.exports ? require('./tiles.js') : root.MJ.Tiles;
  const TILE_COUNT = Tiles.TILE_COUNT;

  // ---- 通常手のシャンテン数 ----
  /**
   * @param {number[]} counts 34要素の枚数配列(鳴いた面子は含めない、手の中に残っている牌のみ)
   * @param {number} [lockedMelds] 副露(チー・ポン・カン)によってすでに確定している面子の数。
   *   0(デフォルト)なら従来通りの門前手として計算する。
   */
  function standardShanten(counts, lockedMelds) {
    lockedMelds = lockedMelds || 0;
    const blockCap = 5 - lockedMelds;
    const c = counts.slice();
    let best = { shanten: 8, blocks: [] };
    const path = [];

    function evaluate(melds, taatsu, pair) {
      let s = 8 - 2 * (melds + lockedMelds) - taatsu - pair;
      // 手牌側の残りブロック枠をすべて「面子候補」で埋めてしまい、
      // 対子(頭)が1つも無い場合は、頭を作るために1手余分にかかる
      if (melds + taatsu === blockCap && pair === 0) s += 1;
      if (s < best.shanten) {
        best = { shanten: s, blocks: path.slice() };
      }
    }

    function rec(i, melds, taatsu, pair) {
      if (i >= TILE_COUNT) {
        evaluate(melds, taatsu, pair);
        return;
      }
      if (c[i] === 0) {
        rec(i + 1, melds, taatsu, pair);
        return;
      }

      const blocksUsed = melds + taatsu + pair;
      const isSuited = i < 27;
      const posInSuit = i % 9;

      // 刻子(同じ牌3枚)
      if (blocksUsed < blockCap && c[i] >= 3) {
        c[i] -= 3;
        path.push({ type: 'triplet', tiles: [i, i, i] });
        rec(i, melds + 1, taatsu, pair);
        path.pop();
        c[i] += 3;
      }
      // 順子(連続3枚)
      if (blocksUsed < blockCap && isSuited && posInSuit <= 6 && c[i] >= 1 && c[i + 1] >= 1 && c[i + 2] >= 1) {
        c[i]--; c[i + 1]--; c[i + 2]--;
        path.push({ type: 'sequence', tiles: [i, i + 1, i + 2] });
        rec(i, melds + 1, taatsu, pair);
        path.pop();
        c[i]++; c[i + 1]++; c[i + 2]++;
      }
      // 対子(頭として使う)
      if (blocksUsed < blockCap && pair === 0 && c[i] >= 2) {
        c[i] -= 2;
        path.push({ type: 'pair', role: 'head', tiles: [i, i] });
        rec(i, melds, taatsu, 1);
        path.pop();
        c[i] += 2;
      }
      // 対子(頭にせず、刻子候補=搭子として使う。例: 頭は他の牌で作り、この対子はもう1枚引いて刻子にする)
      if (blocksUsed < blockCap && c[i] >= 2) {
        c[i] -= 2;
        path.push({ type: 'pair', role: 'taatsu', tiles: [i, i] });
        rec(i, melds, taatsu + 1, pair);
        path.pop();
        c[i] += 2;
      }
      // 両面/辺張 (i, i+1)
      if (blocksUsed < blockCap && isSuited && posInSuit <= 7 && c[i] >= 1 && c[i + 1] >= 1) {
        c[i]--; c[i + 1]--;
        const label = (posInSuit === 0 || posInSuit === 7) ? 'penchan' : 'ryanmen';
        path.push({ type: label, tiles: [i, i + 1] });
        rec(i, melds, taatsu + 1, pair);
        path.pop();
        c[i]++; c[i + 1]++;
      }
      // 嵌張 (i, i+2)
      if (blocksUsed < blockCap && isSuited && posInSuit <= 6 && c[i] >= 1 && c[i + 2] >= 1) {
        c[i]--; c[i + 2]--;
        path.push({ type: 'kanchan', tiles: [i, i + 2] });
        rec(i, melds, taatsu + 1, pair);
        path.pop();
        c[i]++; c[i + 2]++;
      }
      // 今のインデックスの残り牌はブロックを作らず孤立牌として読み飛ばす
      rec(i + 1, melds, taatsu, pair);
    }

    rec(0, 0, 0, 0);
    return best;
  }

  // ---- 七対子のシャンテン数 ----
  function chiitoitsuShanten(counts) {
    let pairs = 0;
    let kinds = 0;
    for (let i = 0; i < TILE_COUNT; i++) {
      if (counts[i] >= 1) kinds++;
      if (counts[i] >= 2) pairs++;
    }
    pairs = Math.min(pairs, 7);
    return 6 - pairs + Math.max(0, 7 - kinds);
  }

  // ---- 国士無双のシャンテン数 ----
  function kokushiShanten(counts) {
    let kinds = 0;
    let hasPair = false;
    for (const i of Tiles.TERMINALS_AND_HONORS) {
      if (counts[i] >= 1) kinds++;
      if (counts[i] >= 2) hasPair = true;
    }
    return 13 - kinds - (hasPair ? 1 : 0);
  }

  /**
   * 総合シャンテン数を計算する。
   * 通常手・七対子・国士無双のうち最小のものを採用する。
   * @param {number[]} counts 手の中に残っている牌の枚数配列(副露分は含めない)
   * @param {number} [lockedMelds] 副露によってすでに確定している面子の数。
   *   1つでも副露があれば七対子・国士無双は成立し得ないため、通常手のみで判定する。
   * @returns {{shanten:number, type:'standard'|'chiitoitsu'|'kokushi', blocks:Array}}
   */
  function calcShanten(counts, lockedMelds) {
    lockedMelds = lockedMelds || 0;
    const std = standardShanten(counts, lockedMelds);
    let result = { shanten: std.shanten, type: 'standard', blocks: std.blocks };

    if (lockedMelds === 0) {
      const chiitoi = chiitoitsuShanten(counts);
      const kokushi = kokushiShanten(counts);
      if (chiitoi < result.shanten) {
        result = { shanten: chiitoi, type: 'chiitoitsu', blocks: [] };
      }
      if (kokushi < result.shanten) {
        result = { shanten: kokushi, type: 'kokushi', blocks: [] };
      }
    }
    return result;
  }

  const Shanten = {
    standardShanten,
    chiitoitsuShanten,
    kokushiShanten,
    calcShanten,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Shanten;
  } else {
    root.MJ = root.MJ || {};
    root.MJ.Shanten = Shanten;
  }
})(typeof window !== 'undefined' ? window : globalThis);
