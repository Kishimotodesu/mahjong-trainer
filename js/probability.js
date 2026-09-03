/**
 * probability.js
 * 「あとどのくらいの確率で手が進む/アガれるのか」を計算する独立モジュール。
 *
 * 設計方針(V1.5):
 *  - 牌の意味(牌効率・役・フリテンなど)は一切知らない。渡された「見えていない牌の総数」と
 *    「欲しい牌の枚数」だけから、超幾何分布ベースの確率を計算する。
 *  - UI側やコーチ・教材側は、この結果をそのまま表示するだけにし、確率式を自前で書かない。
 *  - 「ロンできない」と「アガれない」を混同しないよう、確率とロン/ツモ可否は必ず別の値として扱う
 *    (このモジュール自身はロン可否を判定しない。呼び出し側の責務)。
 */
(function (root) {
  'use strict';

  const TOTAL_TILES = 136;

  /**
   * 見えている牌の枚数配列(34要素)から、見えていない牌の総数を求める。
   * 見えている牌 = 自分の手牌 + 自分と全員の捨て牌 + 副露 + 公開されているドラ表示牌 など。
   * @param {number[]} visibleCounts
   */
  function unseenTotalFromVisible(visibleCounts) {
    const seen = visibleCounts.reduce((a, b) => a + b, 0);
    return Math.max(TOTAL_TILES - seen, 0);
  }

  /**
   * 手牌のみを考慮した理論値としての見えていない牌の総数
   * (他家の捨て牌・副露などの局面情報が無いモードで使う)。
   * @param {number[]} handCounts 自分の手牌の枚数配列
   */
  function unseenTotalFromHandOnly(handCounts) {
    const own = handCounts.reduce((a, b) => a + b, 0);
    return Math.max(TOTAL_TILES - own, 0);
  }

  /**
   * 見えていない unseenTotal 枚の中に wantCount 枚だけ「欲しい牌」がある状態で、
   * draws 回引いたときに、少なくとも1枚は引ける確率(超幾何分布)。
   * P(1枚も引けない) = Π_{k=0}^{draws-1} (unseen-want-k)/(unseen-k) を安全に計算し、1から引く。
   *
   * @param {number} wantCount 欲しい牌の残り枚数(0以上)
   * @param {number} unseenTotal 見えていない牌の総数
   * @param {number} [draws] 引く回数(既定1)
   * @returns {number} 0〜1の確率。計算不能な場合は0。
   */
  function atLeastOneProbability(wantCount, unseenTotal, draws) {
    draws = draws === undefined ? 1 : draws;
    if (wantCount <= 0 || unseenTotal <= 0 || draws <= 0) return 0;
    const want = Math.min(wantCount, unseenTotal);
    const n = Math.min(draws, unseenTotal); // これ以上引ける回数は無い

    let pNone = 1;
    for (let k = 0; k < n; k++) {
      const numerator = unseenTotal - want - k;
      const denominator = unseenTotal - k;
      if (numerator <= 0) {
        pNone = 0;
        break;
      }
      pNone *= numerator / denominator;
    }
    const p = 1 - pNone;
    // 浮動小数の誤差で 1 をわずかに超える/0を下回ることがあるため丸める
    return Math.min(1, Math.max(0, p));
  }

  /** 次の1回の抽選(ツモ)で少なくとも1枚引ける確率。atLeastOneProbabilityのdraws=1相当。 */
  function nextDrawProbability(wantCount, unseenTotal) {
    return atLeastOneProbability(wantCount, unseenTotal, 1);
  }

  /**
   * 「次の1回」「3回以内」「5回以内」をまとめて計算する。
   * @returns {{next:number, within3:number, within5:number}}
   */
  function drawWindow(wantCount, unseenTotal) {
    return {
      next: atLeastOneProbability(wantCount, unseenTotal, 1),
      within3: atLeastOneProbability(wantCount, unseenTotal, 3),
      within5: atLeastOneProbability(wantCount, unseenTotal, 5),
    };
  }

  /**
   * 有効牌(受け入れ)の情報から「次のツモで手が進む確率」を計算する。
   * @param {{ukeireTotal:number}} ukeireInfo evaluator.js/ukeire.js の結果(またはそれに準ずるオブジェクト)
   * @param {number[]} [visibleCounts] 省略時は手牌のみの理論値(unseenTotal計算にhandCountsが必要)
   * @param {number[]} [handCounts] visibleCountsを省略した場合に使う自分の手牌
   */
  function improvementProbability(ukeireInfo, visibleCounts, handCounts) {
    const unseenTotal = visibleCounts ? unseenTotalFromVisible(visibleCounts) : unseenTotalFromHandOnly(handCounts || []);
    return Object.assign({ unseenTotal, wantCount: ukeireInfo.ukeireTotal || 0, basis: visibleCounts ? 'observed' : 'hand-only' }, drawWindow(ukeireInfo.ukeireTotal || 0, unseenTotal));
  }

  /**
   * 待ち牌の残り枚数から「次のツモでアガる確率」を計算する。
   * @param {number} waitTotal 待ち牌の残り合計枚数
   */
  function tsumoProbability(waitTotal, visibleCounts, handCounts) {
    const unseenTotal = visibleCounts ? unseenTotalFromVisible(visibleCounts) : unseenTotalFromHandOnly(handCounts || []);
    return Object.assign({ unseenTotal, wantCount: waitTotal, basis: visibleCounts ? 'observed' : 'hand-only' }, drawWindow(waitTotal, unseenTotal));
  }

  /**
   * 「約18%」を「だいたい何回に1回」という初心者向けの言葉に変換する。
   * 過度な丸めで誤解を生まないよう、%表示を主とし、これは補助情報として使う。
   */
  function describeAsFrequency(p) {
    if (p <= 0) return null;
    if (p >= 0.995) return 'ほぼ確実です。';
    const times = Math.round(1 / p);
    if (times <= 1) return 'ほぼ確実です。';
    return `だいたい${times}回に1回くらいです。`;
  }

  /** パーセント表示用に丸める(小数第1位まで)。 */
  function toPercentLabel(p) {
    return (Math.round(p * 1000) / 10).toFixed(1) + '%';
  }

  const Probability = {
    TOTAL_TILES,
    unseenTotalFromVisible,
    unseenTotalFromHandOnly,
    atLeastOneProbability,
    nextDrawProbability,
    drawWindow,
    improvementProbability,
    tsumoProbability,
    describeAsFrequency,
    toPercentLabel,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Probability;
  } else {
    root.MJ = root.MJ || {};
    root.MJ.Probability = Probability;
  }
})(typeof window !== 'undefined' ? window : globalThis);
