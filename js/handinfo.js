/**
 * handinfo.js
 * V1.1で追加: 待ち牌判定、アガリ形の面子分解表示、手牌内の形のハイライト分類、
 * 「この形からどの牌を引くとどう変化するか」という発展的な解説の生成。
 *
 * 注意: 複合形(受け入れが重なる形)には複数の正しい解釈があり得るため、
 * ここでの「分解」「分類」はあくまで一例(補助的な見方)であり、
 * 唯一絶対の読み方として提示しないこと。有効牌・受け入れ枚数そのものの
 * 計算(ukeire.js)は分解の仕方に依存せず常に正確である。
 */
(function (root) {
  'use strict';

  let Tiles, Shanten, Ukeire;
  if (typeof module !== 'undefined' && module.exports) {
    Tiles = require('./tiles.js');
    Shanten = require('./shanten.js');
    Ukeire = require('./ukeire.js');
  } else {
    Tiles = root.MJ.Tiles;
    Shanten = root.MJ.Shanten;
    Ukeire = root.MJ.Ukeire;
  }

  const WAIT_TYPE_LABEL = {
    ryanmen: '両面待ち',
    kanchan: '嵌張待ち',
    penchan: '辺張待ち',
    shanpon: 'シャボ待ち',
    tanki: '単騎待ち',
    chiitoitsu: '単騎待ち(七対子)',
    kokushi13: '13面待ち(国士無双)',
    kokushitanki: '単騎待ち(国士無双)',
  };

  // ---- 牌グループの表記(例: [3,4,5]萬 -> "345萬", 白白) ----
  function formatMeldGroup(block) {
    const first = block.tiles[0];
    if (Tiles.isHonor(first)) {
      return Tiles.shortLabel(first).repeat(block.tiles.length);
    }
    const suit = Tiles.suitOf(first);
    const digits = block.tiles
      .slice()
      .sort((a, b) => a - b)
      .map((t) => Tiles.numberOf(t))
      .join('');
    return digits + Tiles.SUIT_KANJI[suit];
  }

  function meldKindLabel(type) {
    if (type === 'pair') return '雀頭';
    if (type === 'triplet') return '刻子';
    if (type === 'sequence') return '順子';
    return type;
  }

  /**
   * アガリ形(シャンテン数-1)の手牌を、面子・雀頭の組に分解して表示用データを返す。
   * @param {number[]} counts14
   * @returns {null|{type:string, groups:Array<{label:string, kind:string}>, text:string}}
   */
  function describeAgariHand(counts14) {
    const overall = Shanten.calcShanten(counts14);
    if (overall.shanten !== -1) return null;

    if (overall.type === 'chiitoitsu') {
      const groups = [];
      for (let i = 0; i < Tiles.TILE_COUNT; i++) {
        if (counts14[i] >= 2) {
          groups.push({ label: Tiles.shortLabel(i).repeat(2), kind: '対子' });
        }
      }
      return { type: 'chiitoitsu', groups, text: groups.map((g) => g.label).join('｜') };
    }

    if (overall.type === 'kokushi') {
      const groups = [];
      for (const i of Tiles.TERMINALS_AND_HONORS) {
        if (counts14[i] >= 1) {
          const isPair = counts14[i] >= 2;
          groups.push({
            label: isPair ? Tiles.shortLabel(i).repeat(2) : Tiles.shortLabel(i),
            kind: isPair ? '雀頭' : '么九牌',
          });
        }
      }
      return { type: 'kokushi', groups, text: groups.map((g) => g.label).join('｜') };
    }

    // standard
    const blocks = Shanten.standardShanten(counts14).blocks;
    const sorted = blocks.slice().sort((a, b) => Math.min(...a.tiles) - Math.min(...b.tiles));
    const groups = sorted.map((b) => ({ label: formatMeldGroup(b), kind: meldKindLabel(b.type) }));
    return { type: 'standard', groups, text: groups.map((g) => g.label).join('｜') };
  }

  /**
   * テンパイ(シャンテン数0)の手牌について、待ち牌一覧と(可能なら)待ちの形を判定する。
   * @param {number[]} counts13
   * @returns {null|{shanten:number, type:string, shapeLabel:?string, tiles:Array, total:number}}
   */
  function classifyWait(counts13) {
    const overall = Shanten.calcShanten(counts13);
    if (overall.shanten !== 0) return null;

    const ukeireInfo = Ukeire.calcUkeire(counts13);
    let shapeLabel = null;

    if (overall.type === 'chiitoitsu') {
      shapeLabel = WAIT_TYPE_LABEL.chiitoitsu;
    } else if (overall.type === 'kokushi') {
      let hasPair = false;
      for (const i of Tiles.TERMINALS_AND_HONORS) {
        if (counts13[i] >= 2) hasPair = true;
      }
      shapeLabel = hasPair ? WAIT_TYPE_LABEL.kokushitanki : WAIT_TYPE_LABEL.kokushi13;
    } else {
      const blocks = Shanten.standardShanten(counts13).blocks;
      const melds = blocks.filter((b) => b.type === 'triplet' || b.type === 'sequence');
      const headPairs = blocks.filter((b) => b.type === 'pair' && b.role === 'head');
      const taatsuPairs = blocks.filter((b) => b.type === 'pair' && b.role === 'taatsu');
      const otherTaatsu = blocks.filter((b) => ['ryanmen', 'kanchan', 'penchan'].includes(b.type));

      if (melds.length === 3 && headPairs.length === 1 && taatsuPairs.length === 1 && otherTaatsu.length === 0) {
        shapeLabel = WAIT_TYPE_LABEL.shanpon;
      } else if (melds.length === 3 && headPairs.length === 1 && otherTaatsu.length === 1) {
        shapeLabel = WAIT_TYPE_LABEL[otherTaatsu[0].type];
      } else if (melds.length === 4 && headPairs.length === 0 && taatsuPairs.length === 0 && otherTaatsu.length === 0) {
        shapeLabel = WAIT_TYPE_LABEL.tanki;
      }
    }

    return {
      shanten: 0,
      type: overall.type,
      shapeLabel,
      tiles: ukeireInfo.tiles
        .slice()
        .sort((a, b) => a.tile - b.tile)
        .map((t) => ({ tile: t.tile, label: Tiles.shortLabel(t.tile), remaining: t.remaining })),
      total: ukeireInfo.total,
    };
  }

  const CATEGORY_LABEL = {
    meld: '完成した組(面子)',
    'pair-head': '対子(雀頭候補)',
    'pair-taatsu': '対子(刻子候補)',
    ryanmen: '両面',
    kanchan: '嵌張',
    penchan: '辺張',
    isolated: '孤立牌',
  };

  function categoryOfBlock(block) {
    if (block.type === 'triplet' || block.type === 'sequence') return 'meld';
    if (block.type === 'pair') return block.role === 'head' ? 'pair-head' : 'pair-taatsu';
    return block.type; // ryanmen | kanchan | penchan
  }

  /**
   * 現在の手牌(牌インデックスの配列、位置つき)に対して、
   * 通常手としての1つの分解例をもとに各位置へカテゴリを割り当てる。
   * あくまで「一例」であることに注意(コメント参照)。
   * @param {number[]} tiles 現在表示している手牌(牌インデックスの配列)
   * @returns {Array<string>} tiles と同じ長さの、各位置のカテゴリ配列
   */
  function assignHighlights(tiles) {
    const counts = Tiles.toCounts(tiles);
    const decomp = Shanten.standardShanten(counts);
    const categories = new Array(tiles.length).fill('isolated');
    const consumed = new Array(tiles.length).fill(false);

    for (const block of decomp.blocks) {
      const category = categoryOfBlock(block);
      for (const tileValue of block.tiles) {
        for (let p = 0; p < tiles.length; p++) {
          if (!consumed[p] && tiles[p] === tileValue) {
            consumed[p] = true;
            categories[p] = category;
            break;
          }
        }
      }
    }

    return categories;
  }

  // ---- 「この形からどの牌を引くとどう変わるか」を説明する ----

  // 同スートで隣接(差2以内)する牌をひとまとめのクラスタとして検出する
  function findClusters(counts, base) {
    const present = [];
    for (let k = 0; k < 9; k++) {
      if (counts[base + k] > 0) present.push(k);
    }
    const clusters = [];
    let cur = [];
    for (const k of present) {
      if (cur.length === 0 || k - cur[cur.length - 1] <= 2) {
        cur.push(k);
      } else {
        clusters.push(cur);
        cur = [k];
      }
    }
    if (cur.length) clusters.push(cur);
    return clusters;
  }

  /**
   * 手牌の中で「複数方向に発展しうる複合形」(例: 3445萬)を検出し、
   * 隣接する牌を引いた場合にどう形が変わるかを説明するデータを作る。
   * @param {number[]} counts 現在残そうとしている手牌(枚数配列。13でも14でも可)
   * @returns {Array<{clusterLabel:string, transitions:Array<{drawLabel:string, resultLabel:string, improves:boolean}>}>}
   */
  function describeShapeGrowth(counts) {
    const ukeireInfo = Ukeire.calcUkeire(counts);
    const improvingTiles = new Set(ukeireInfo.tiles.map((t) => t.tile));

    const results = [];
    const suits = [
      { base: 0, kanji: Tiles.SUIT_KANJI.m },
      { base: 9, kanji: Tiles.SUIT_KANJI.p },
      { base: 18, kanji: Tiles.SUIT_KANJI.s },
    ];

    for (const { base, kanji } of suits) {
      const clusters = findClusters(counts, base);
      for (const cluster of clusters) {
        const totalTiles = cluster.reduce((sum, k) => sum + counts[base + k], 0);
        if (totalTiles < 3) continue; // 単純な対子・両面などは他の解説でカバー済み

        const existingAbs = [];
        for (const k of cluster) {
          for (let n = 0; n < counts[base + k]; n++) existingAbs.push(base + k);
        }

        const minK = cluster[0];
        const maxK = cluster[cluster.length - 1];
        const clusterLabel =
          existingAbs
            .map((t) => Tiles.numberOf(t))
            .sort((a, b) => a - b)
            .join('') + kanji;

        const transitions = [];
        for (let k = Math.max(0, minK - 1); k <= Math.min(8, maxK + 1); k++) {
          const absIdx = base + k;
          if (counts[absIdx] >= 4) continue;
          const newAbs = existingAbs.concat([absIdx]).sort((a, b) => a - b);
          const resultLabel = newAbs.map((t) => Tiles.numberOf(t)).join('') + kanji;
          transitions.push({
            drawLabel: Tiles.shortLabel(absIdx),
            resultLabel,
            improves: improvingTiles.has(absIdx),
          });
        }

        // どの牌を引いても改善しない(既に完成している等)クラスタは説明の対象外にする
        if (transitions.some((t) => t.improves)) {
          results.push({ clusterLabel, transitions });
        }
      }
    }

    return results;
  }

  const HandInfo = {
    WAIT_TYPE_LABEL,
    CATEGORY_LABEL,
    formatMeldGroup,
    describeAgariHand,
    classifyWait,
    assignHighlights,
    describeShapeGrowth,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = HandInfo;
  } else {
    root.MJ = root.MJ || {};
    root.MJ.HandInfo = HandInfo;
  }
})(typeof window !== 'undefined' ? window : globalThis);
