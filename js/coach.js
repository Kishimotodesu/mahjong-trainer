/**
 * coach.js
 * 対局中の「コーチ」機能。牌効率だけでなく、打点・役・安全度も別々に評価し、
 * 初心者向けの総合コメントを生成する。押し引きの参考表示も行う。
 */
(function (root) {
  'use strict';

  let Tiles, YakuCandidates, Safety, PushFold, Dora;
  if (typeof module !== 'undefined' && module.exports) {
    Tiles = require('./tiles.js');
    YakuCandidates = require('./yakucandidates.js');
    Safety = require('./safety.js');
    PushFold = require('./pushfold.js');
    Dora = require('./dora.js');
  } else {
    Tiles = root.MJ.Tiles;
    YakuCandidates = root.MJ.YakuCandidates;
    Safety = root.MJ.Safety;
    PushFold = root.MJ.PushFold;
    Dora = root.MJ.Dora;
  }

  const GRADE_ORDER = { S: 4, A: 3, B: 2, C: 1, NA: 0 };
  const GRADE_SYMBOL = { S: '◎', A: '○', B: '△', C: '×', NA: 'ー' };

  function efficiencyGrade(discard, best) {
    if (discard.tile === best.tile) return 'S';
    if (discard.resultShanten > best.resultShanten) return 'C';
    const ratio = best.ukeireTotal > 0 ? discard.ukeireTotal / best.ukeireTotal : 1;
    if (ratio >= 0.85) return 'A';
    if (ratio >= 0.5) return 'B';
    return 'C';
  }

  /** 打点(ドラ・高打点役の見込み)の評価 */
  function valueGrade(resultingCounts, doraTiles) {
    let doraCount = 0;
    doraTiles.forEach((t) => (doraCount += resultingCounts[t] || 0));
    const candidates = YakuCandidates.detectYakuCandidates(resultingCounts, { seatWind: 27, roundWind: 27 });
    const highValueHit = candidates.some((c) => ['honitsu', 'chinitsu', 'honitsu_chinitsu_close', 'toitoi'].includes(c.key));
    if (doraCount >= 2 || (doraCount >= 1 && highValueHit)) return 'S';
    if (doraCount >= 1 || highValueHit) return 'A';
    if (candidates.length > 0) return 'B';
    return 'C';
  }

  /** 役が確保できそうかの評価(牌効率上のシャンテン悪化も考慮) */
  function yakuGrade(discard, resultingCounts, ctx) {
    const candidates = YakuCandidates.detectYakuCandidates(resultingCounts, ctx);
    if (candidates.some((c) => c.key.startsWith('yakuhai_') || c.key === 'tanyao')) return 'S';
    if (candidates.length >= 2) return 'A';
    if (candidates.length === 1) return 'B';
    return 'C';
  }

  /** 安全度の評価(リーチ者がいる場合のみ意味を持つ) */
  function safetyGrade(tile, riichiPlayers, allPlayers, visibleCounts) {
    if (riichiPlayers.length === 0) return 'NA';
    let minLevel = Infinity;
    const RANK = { genbutsu: 4, dead: 4, suji_nochance: 3, nochance: 2, suji: 2, onechance: 1, normal: 0 };
    for (const rp of riichiPlayers) {
      const s = Safety.evaluateTileSafety(tile, rp, allPlayers, visibleCounts);
      minLevel = Math.min(minLevel, RANK[s.level] !== undefined ? RANK[s.level] : 0);
    }
    if (minLevel >= 4) return 'S';
    if (minLevel >= 2) return 'A';
    if (minLevel >= 1) return 'B';
    return 'C';
  }

  /**
   * 打牌候補ごとの多面的評価(牌効率/打点/役/安全度)を計算する。
   * @param {object} analysis Evaluator.analyzeHand() の結果
   * @param {number[]} counts14 現在の14枚
   * @param {object[]} riichiPlayers リーチ中の他家
   * @param {object[]} allPlayers 全プレイヤー
   * @param {number[]} visibleCounts 場に見えている全牌
   * @param {number[]} doraTiles 現在のドラ牌一覧
   * @param {{seatWind:number, roundWind:number}} windCtx
   */
  function evaluateMultiAxis(analysis, counts14, riichiPlayers, allPlayers, visibleCounts, doraTiles, windCtx) {
    const best = analysis.recommended;
    return analysis.discards.map((d) => {
      const resultingCounts = counts14.slice();
      resultingCounts[d.tile]--;
      const efficiency = efficiencyGrade(d, best);
      const value = valueGrade(resultingCounts, doraTiles);
      const yaku = yakuGrade(d, resultingCounts, windCtx);
      const safety = safetyGrade(d.tile, riichiPlayers, allPlayers, visibleCounts);
      const overallScore =
        GRADE_ORDER[efficiency] * 3 + GRADE_ORDER[value] + GRADE_ORDER[yaku] + (safety === 'NA' ? 0 : GRADE_ORDER[safety] * 2);
      return {
        tile: d.tile,
        label: d.label,
        efficiency,
        value,
        yaku,
        safety,
        overallScore,
        discard: d,
      };
    });
  }

  function gradeSymbol(grade) {
    return GRADE_SYMBOL[grade] || '?';
  }

  /**
   * 初心者向けの総合コメントを1件の評価から生成する。
   */
  function buildOverallComment(evalRow, isTopPick) {
    const parts = [];
    parts.push(`${evalRow.label}: 牌効率${gradeSymbol(evalRow.efficiency)} 打点${gradeSymbol(evalRow.value)} 役${gradeSymbol(evalRow.yaku)}`);
    if (evalRow.safety !== 'NA') parts.push(`安全度${gradeSymbol(evalRow.safety)}`);
    if (isTopPick) {
      parts.push('(総合的にはこの牌がおすすめです)');
    } else if (evalRow.safety === 'C' && evalRow.efficiency !== 'S') {
      parts.push('(危険度が高く、効率でも上位ではないため注意)');
    }
    return parts.join(' / ');
  }

  const Coach = {
    GRADE_SYMBOL,
    evaluateMultiAxis,
    gradeSymbol,
    buildOverallComment,
    evaluatePushFold: PushFold.evaluatePushFold,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Coach;
  } else {
    root.MJ = root.MJ || {};
    root.MJ.Coach = Coach;
  }
})(typeof window !== 'undefined' ? window : globalThis);
