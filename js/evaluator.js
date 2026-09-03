/**
 * evaluator.js
 * 14枚の手牌について、各打牌候補を評価し、
 * おすすめランキングと初心者向けの理由説明を生成する。
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

  const SHAPE_LABEL = {
    triplet: '刻子',
    sequence: '順子',
    pair: '対子(雀頭)',
    ryanmen: '両面',
    penchan: '辺張',
    kanchan: '嵌張',
  };

  // 34枚配列上で、指定した牌が best.blocks のどの塊に属しているかを調べる
  function findBlockContaining(blocks, tileIdx) {
    for (const b of blocks) {
      if (b.tiles.includes(tileIdx)) return b;
    }
    return null;
  }

  // ある牌が「孤立牌」かどうかを判定する(同種の対子/刻子/両面/嵌張/辺張のいずれにも属さない)
  function isIsolated(decompBlocks, tileIdx) {
    return findBlockContaining(decompBlocks, tileIdx) === null;
  }

  function formatUkeireList(tilesInfo) {
    return tilesInfo
      .slice()
      .sort((a, b) => a.tile - b.tile)
      .map((t) => ({
        tile: t.tile,
        label: Tiles.shortLabel(t.tile),
        remaining: t.remaining,
        resultShanten: t.resultShanten,
      }));
  }

  /**
   * 1枚の打牌を評価する。
   * @param {number[]} counts14 打牌前(14枚。副露は含めない手の中の牌)の枚数配列
   * @param {number} discardIdx 切る牌のインデックス
   * @param {object} baseDecomp counts14 に対する standardShanten 相当の分解(理由説明用)
   * @param {object} options {lockedMelds, visibleCounts} (省略時は門前・自分の手牌のみを基準にする)
   */
  function evaluateDiscard(counts14, discardIdx, baseDecomp, options) {
    options = options || {};
    const lockedMelds = options.lockedMelds || 0;
    const counts13 = counts14.slice();
    counts13[discardIdx]--;

    const ukeireInfo = Ukeire.calcUkeire(counts13, { lockedMelds, visibleCounts: options.visibleCounts });
    const afterDecomp = Shanten.calcShanten(counts13, lockedMelds);

    const discardedIsIsolatedBefore = isIsolated(baseDecomp.blocks, discardIdx);
    const discardedBlockBefore = findBlockContaining(baseDecomp.blocks, discardIdx);

    return {
      tile: discardIdx,
      label: Tiles.shortLabel(discardIdx),
      fullName: Tiles.fullName(discardIdx),
      resultShanten: ukeireInfo.shanten,
      resultType: ukeireInfo.type,
      ukeireTiles: formatUkeireList(ukeireInfo.tiles),
      ukeireKinds: ukeireInfo.tiles.length,
      ukeireTotal: ukeireInfo.total,
      wasIsolated: discardedIsIsolatedBefore,
      wasBlockType: discardedBlockBefore ? discardedBlockBefore.type : null,
      afterBlocks: afterDecomp.blocks,
    };
  }

  function describeBlockJa(block) {
    if (!block) return null;
    const names = block.tiles.map((t) => Tiles.shortLabel(t));
    if (block.type === 'pair') return `${names[0]}の対子`;
    if (block.type === 'triplet') return `${names[0]}の刻子`;
    if (block.type === 'sequence') return `${names.join('')}の順子`;
    if (block.type === 'ryanmen') return `${names.join('')}の両面`;
    if (block.type === 'kanchan') return `${names.join('')}の嵌張`;
    if (block.type === 'penchan') return `${names.join('')}の辺張`;
    return names.join('');
  }

  /**
   * 打牌候補それぞれについて、初心者向けの理由テキストを生成する。
   */
  function buildReason(candidate, best, currentShanten) {
    const lines = [];

    if (candidate.resultType !== 'standard') {
      const typeName = candidate.resultType === 'chiitoitsu' ? '七対子' : '国士無双';
      lines.push(`この切り方では${typeName}での進行が最も有効です。`);
    }

    if (candidate.wasIsolated) {
      lines.push(
        `${candidate.label}は周りとつながっていない孤立牌のため、他の牌より使い道が少なく、優先して切りやすい牌です。`
      );
    } else if (candidate.wasBlockType === 'kanchan' || candidate.wasBlockType === 'penchan') {
      const shapeName = candidate.wasBlockType === 'kanchan' ? '嵌張' : '辺張';
      lines.push(`${candidate.label}は${shapeName}の一部ですが、他により受け入れの広い形が残っているため切ることができます。`);
    } else if (candidate.wasBlockType === 'ryanmen') {
      lines.push(`${candidate.label}は両面の一部です。両面は受け入れが広い強い形なので、本来は残したい形です。`);
    } else if (candidate.wasBlockType === 'pair') {
      lines.push(`${candidate.label}は対子の一部です。対子は雀頭や刻子の候補になる大切な形です。`);
    } else if (candidate.wasBlockType === 'triplet' || candidate.wasBlockType === 'sequence') {
      lines.push(`${candidate.label}はすでに完成した組(面子)の一部です。崩すと受け入れが大きく減る可能性があります。`);
    }

    if (candidate.resultShanten < currentShanten) {
      lines.push(`この牌を切るとシャンテン数が${currentShanten}から${candidate.resultShanten}に進みます。`);
    } else if (candidate.resultShanten === currentShanten) {
      lines.push(`この牌を切ってもシャンテン数は${candidate.resultShanten}のまま変わりません。`);
    } else {
      lines.push(`この牌を切るとシャンテン数が${candidate.resultShanten}に後退してしまいます。牌効率上はおすすめできません。`);
    }

    if (candidate.ukeireTotal > 0) {
      lines.push(`有効牌は${candidate.ukeireKinds}種類、合計${candidate.ukeireTotal}枚です。`);
    } else {
      lines.push('この形からはシャンテン数を進める有効牌がありません。');
    }

    if (best && candidate.tile !== best.tile) {
      if (candidate.resultShanten === best.resultShanten && candidate.ukeireTotal < best.ukeireTotal) {
        lines.push(
          `牌効率上のおすすめである${best.label}(受け入れ${best.ukeireTotal}枚)と比べると、こちらは受け入れが${best.ukeireTotal - candidate.ukeireTotal}枚少なくなります。`
        );
      }
    }

    return lines.join(' ');
  }

  /**
   * 打牌候補1件を、牌効率上のおすすめ(best)と比較して評価する。
   * @returns {{grade:string, gradeLabel:string, comment:string}}
   */
  function computeGrade(chosen, best) {
    if (chosen.tile === best.tile) {
      return {
        grade: 'excellent',
        gradeLabel: '◎ とても良い',
        comment: `牌効率上のおすすめと一致しています。受け入れ${chosen.ukeireTotal}枚を確保できています。`,
      };
    }

    if (chosen.resultShanten > best.resultShanten) {
      return {
        grade: 'bad',
        gradeLabel: '× 受け入れを大きく減らしています',
        comment: `この牌を切るとシャンテン数が${chosen.resultShanten}に後退します。牌効率上のおすすめは${best.label}(シャンテン${best.resultShanten}、受け入れ${best.ukeireTotal}枚)でした。`,
      };
    }

    const ratio = best.ukeireTotal > 0 ? chosen.ukeireTotal / best.ukeireTotal : 1;
    if (ratio >= 0.8) {
      return {
        grade: 'good',
        gradeLabel: '○ 悪くない',
        comment: `シャンテン数は${chosen.resultShanten}を維持できています。受け入れは${chosen.ukeireTotal}枚(牌効率上のおすすめの${best.label}は${best.ukeireTotal}枚)です。`,
      };
    }

    return {
      grade: 'fair',
      gradeLabel: '△ 他により良い選択あり',
      comment: `シャンテン数は変わりませんが、受け入れが${chosen.ukeireTotal}枚と牌効率上のおすすめの${best.label}(${best.ukeireTotal}枚)より少なくなっています。`,
    };
  }

  /**
   * 14枚の手牌全体を分析し、打牌候補のランキングを返す。
   * @param {number[]} counts14 手の中の牌(副露は含めない)。副露がある場合は13-3*副露数+1枚になる
   * @param {object} [options] {lockedMelds, visibleCounts} 副露がある場合や実戦局面の分析に使う
   */
  function analyzeHand(counts14, options) {
    options = options || {};
    const lockedMelds = options.lockedMelds || 0;
    const overall = Shanten.calcShanten(counts14, lockedMelds); // 総合シャンテン数
    const currentShanten = overall.shanten;
    // 理由説明(孤立牌・両面など)は常に通常手としての分解を基準にする。
    // 七対子/国士無双が総合最良の場合は overall.blocks が空になるため、そのまま使うと
    // 「対子なのに孤立牌」等の誤った説明になってしまう。
    const baseDecomp = { type: overall.type, blocks: Shanten.standardShanten(counts14, lockedMelds).blocks };

    const candidateIdxs = [];
    for (let i = 0; i < Tiles.TILE_COUNT; i++) {
      if (counts14[i] > 0) candidateIdxs.push(i);
    }

    const discards = candidateIdxs.map((idx) => evaluateDiscard(counts14, idx, baseDecomp, options));

    discards.sort((a, b) => {
      if (a.resultShanten !== b.resultShanten) return a.resultShanten - b.resultShanten;
      if (a.ukeireTotal !== b.ukeireTotal) return b.ukeireTotal - a.ukeireTotal;
      return a.tile - b.tile;
    });

    const best = discards[0];
    for (const d of discards) {
      d.reason = buildReason(d, best, currentShanten);
      d.grade = computeGrade(d, best);
    }

    return {
      currentShanten,
      currentType: baseDecomp.type,
      baseBlocks: baseDecomp.blocks,
      discards,
      top3: discards.slice(0, 3),
      recommended: best,
    };
  }

  /**
   * 「自分で考えるモード」などで、ユーザーが選んだ打牌を評価する。
   * @returns {{grade:string, gradeLabel:string, comment:string}}
   */
  function gradeUserChoice(analysis, chosenTile) {
    const chosen = analysis.discards.find((d) => d.tile === chosenTile);
    if (!chosen) {
      return { grade: 'unknown', gradeLabel: '?', comment: '評価できませんでした。' };
    }
    return chosen.grade || computeGrade(chosen, analysis.recommended);
  }

  const Evaluator = {
    analyzeHand,
    gradeUserChoice,
    computeGrade,
    describeBlockJa,
    findBlockContaining,
    SHAPE_LABEL,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Evaluator;
  } else {
    root.MJ = root.MJ || {};
    root.MJ.Evaluator = Evaluator;
  }
})(typeof window !== 'undefined' ? window : globalThis);
