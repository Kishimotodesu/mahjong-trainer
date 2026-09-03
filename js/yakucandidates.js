/**
 * yakucandidates.js
 * まだアガっていない手牌について、「現在狙えそうな役」を大まかに検出する
 * 簡易ヒューリスティック。牌効率上のおすすめ(evaluator.js)とは独立した、
 * あくまで参考情報。完成時の正式な役判定は yaku.js / scoring.js が行う。
 */
(function (root) {
  'use strict';

  let Tiles, Shanten, Yaku;
  if (typeof module !== 'undefined' && module.exports) {
    Tiles = require('./tiles.js');
    Shanten = require('./shanten.js');
    Yaku = require('./yaku.js');
  } else {
    Tiles = root.MJ.Tiles;
    Shanten = root.MJ.Shanten;
    Yaku = root.MJ.Yaku;
  }

  /**
   * @param {number[]} counts 13枚または14枚の枚数配列
   * @param {{seatWind:number, roundWind:number}} ctx
   * @returns {Array<{key:string, name:string, note:string}>}
   */
  function detectYakuCandidates(counts, ctx) {
    const candidates = [];
    ctx = ctx || { seatWind: 27, roundWind: 27 };

    // タンヤオ
    let hasTerminalOrHonor = false;
    for (let i = 0; i < Tiles.TILE_COUNT; i++) {
      if (counts[i] > 0 && Tiles.isTerminalOrHonor(i)) hasTerminalOrHonor = true;
    }
    if (!hasTerminalOrHonor) {
      candidates.push({ key: 'tanyao', name: 'タンヤオ', note: '1・9・字牌がまだ手牌に無いため、このまま完成すれば成立します。' });
    }

    // 役牌(対子がある場合、刻子にできれば成立)
    for (const t of Yaku.DRAGONS) {
      if (counts[t] >= 2) {
        candidates.push({ key: 'yakuhai_' + t, name: `役牌:${Tiles.shortLabel(t)}`, note: `${Tiles.shortLabel(t)}の対子があります。刻子にできれば役牌が成立します。` });
      }
    }
    for (const t of Yaku.WINDS) {
      if (counts[t] >= 2 && (t === ctx.seatWind || t === ctx.roundWind)) {
        candidates.push({ key: 'yakuhai_' + t, name: `役牌:${Tiles.shortLabel(t)}`, note: `${Tiles.shortLabel(t)}(自風または場風)の対子があります。刻子にできれば役牌が成立します。` });
      }
    }

    // 混一色・清一色
    const suitsUsed = new Set();
    let usesHonor = false;
    for (let i = 0; i < Tiles.TILE_COUNT; i++) {
      if (counts[i] === 0) continue;
      if (Tiles.isHonor(i)) usesHonor = true;
      else suitsUsed.add(Tiles.suitOf(i));
    }
    if (suitsUsed.size === 1) {
      candidates.push(
        usesHonor
          ? { key: 'honitsu', name: '混一色', note: '数牌が1種類のスートと字牌だけに偏っています。このまま進めば成立します。' }
          : { key: 'chinitsu', name: '清一色', note: '数牌が1種類のスートだけに偏っています。このまま進めば成立します。' }
      );
    } else if (suitsUsed.size === 2 && !usesHonor) {
      const totalTiles = Tiles.totalCount(counts);
      const maxSuitCount = Math.max(...['m', 'p', 's'].map((s) => {
        const base = { m: 0, p: 9, s: 18 }[s];
        let c = 0;
        for (let k = 0; k < 9; k++) c += counts[base + k];
        return c;
      }));
      if (maxSuitCount >= totalTiles - 3) {
        candidates.push({ key: 'honitsu_chinitsu_close', name: '混一色/清一色', note: '数牌がほぼ1種類のスートに偏っています。あと少しで混一色・清一色が狙えます。' });
      }
    }

    // 三色同順
    for (let p = 0; p <= 6; p++) {
      let suitsWithRun = 0;
      for (const base of [0, 9, 18]) {
        if (counts[base + p] >= 1 && counts[base + p + 1] >= 1 && counts[base + p + 2] >= 1) suitsWithRun++;
      }
      if (suitsWithRun >= 2) {
        candidates.push({ key: 'sanshoku_doujun_' + p, name: '三色同順', note: `萬子・筒子・索子で${p + 1}${p + 2}${p + 3}の同じ並びが2種類そろっています。残り1種類がそろえば成立します。` });
        break;
      }
    }

    // 一気通貫
    for (const base of [0, 9, 18]) {
      let rangesPresent = 0;
      for (const start of [0, 3, 6]) {
        if (counts[base + start] >= 1 && counts[base + start + 1] >= 1 && counts[base + start + 2] >= 1) rangesPresent++;
      }
      if (rangesPresent >= 2) {
        candidates.push({ key: 'ittsu_' + base, name: '一気通貫', note: `${Tiles.SUIT_KANJI[Tiles.suitOf(base)]}で123・456・789のうち2つがそろっています。残り1つがそろえば成立します。` });
        break;
      }
    }

    // 対々和(現在の分解が刻子・対子中心で、順子がほぼ無い場合)
    const decomp = Shanten.standardShanten(counts);
    const sequenceCount = decomp.blocks.filter((b) => b.type === 'sequence').length;
    const triplety = decomp.blocks.filter((b) => b.type === 'triplet' || (b.type === 'pair' && b.role === 'taatsu')).length;
    if (sequenceCount === 0 && triplety >= 2) {
      candidates.push({ key: 'toitoi', name: '対々和', note: '順子をほとんど使わず、刻子・対子中心の形になっています。' });
    }

    return candidates;
  }

  const YakuCandidates = { detectYakuCandidates };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = YakuCandidates;
  } else {
    root.MJ = root.MJ || {};
    root.MJ.YakuCandidates = YakuCandidates;
  }
})(typeof window !== 'undefined' ? window : globalThis);
