/**
 * pushfold.js
 * 初心者向けの押し引き参考表示。
 * 「絶対にこうするべき」という断定はせず、あくまで参考の傾向(押し寄り/判断が難しい/オリ寄り)を示す。
 */
(function (root) {
  'use strict';

  /**
   * @param {object} context
   * @param {number} context.shanten 自分の現在のシャンテン数(-1=アガリ,0=テンパイ)
   * @param {number} context.riichiCount 現在リーチしている他家の人数
   * @param {number} context.turnCount 現在の巡目
   * @param {boolean} context.isDealer 自分が親かどうか
   * @param {number} context.roughHanValue 自分の手のおおよその想定翻数(役牌・ドラ等から概算)
   * @param {number} context.safeTileCount 現在確保できている安全牌(現物等)の枚数
   * @returns {{verdict:'push'|'difficult'|'fold', score:number, comment:string}}
   */
  function evaluatePushFold(context) {
    const isTenpai = context.shanten <= 0;
    let score = 0;

    if (isTenpai) score += 3;
    else if (context.shanten === 1) score += 1;
    else score -= 2;

    score -= context.riichiCount * 1.5;
    if (context.turnCount >= 13) score -= 1;
    if (context.roughHanValue >= 3) score += 1;
    if (context.isDealer) score += 0.5;
    if (context.riichiCount > 0 && context.safeTileCount === 0) score -= 1;

    let verdict;
    if (score >= 2) verdict = 'push';
    else if (score <= -2) verdict = 'fold';
    else verdict = 'difficult';

    return { verdict, score, comment: buildComment(verdict, context, isTenpai) };
  }

  function buildComment(verdict, context, isTenpai) {
    const parts = [];
    parts.push(
      isTenpai ? '現在テンパイしています。' : `現在${context.shanten}シャンテンです。`
    );
    if (context.riichiCount > 0) {
      parts.push(`${context.riichiCount}人からリーチ(または高い手の気配)を受けています。`);
    }
    if (context.safeTileCount > 0) {
      parts.push(`現物などの安全牌が${context.safeTileCount}枚あります。`);
    } else if (context.riichiCount > 0) {
      parts.push('現時点で確実な安全牌がありません。');
    }

    if (verdict === 'push') {
      parts.push('初心者向けには、このまま押して手を進める選択を考えやすい状況です。');
    } else if (verdict === 'fold') {
      parts.push('初心者向けには、安全牌を切って守備寄りに進める選択を考えやすい状況です。');
    } else {
      parts.push('押すか引くか判断が難しい状況です。安全牌があるなら1枚だけ様子見で切るのも一案です。');
    }

    return parts.join('');
  }

  const PushFold = { evaluatePushFold };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PushFold;
  } else {
    root.MJ = root.MJ || {};
    root.MJ.PushFold = PushFold;
  }
})(typeof window !== 'undefined' ? window : globalThis);
