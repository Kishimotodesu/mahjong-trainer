/**
 * coach.js
 * 対局中の「コーチ」機能。牌効率だけでなく、打点・役・安全度も別々に評価し、
 * 初心者向けの総合コメントを生成する。押し引きの参考表示も行う。
 */
(function (root) {
  'use strict';

  let Tiles, YakuCandidates, Safety, PushFold, Dora, Shanten, Melds;
  if (typeof module !== 'undefined' && module.exports) {
    Tiles = require('./tiles.js');
    YakuCandidates = require('./yakucandidates.js');
    Safety = require('./safety.js');
    PushFold = require('./pushfold.js');
    Dora = require('./dora.js');
    Shanten = require('./shanten.js');
    Melds = require('./melds.js');
  } else {
    Tiles = root.MJ.Tiles;
    YakuCandidates = root.MJ.YakuCandidates;
    Safety = root.MJ.Safety;
    PushFold = root.MJ.PushFold;
    Dora = root.MJ.Dora;
    Shanten = root.MJ.Shanten;
    Melds = root.MJ.Melds;
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

  /** 手牌+副露から、その面子が「役につながる形か」を初心者向けに大まかに判定する。 */
  function hasYakuPotential(concealed, fuuro, windCtx) {
    // タンヤオ: 手牌+副露のどこにも1・9・字牌が無い
    let tanyaoOk = true;
    for (let i = 0; i < Tiles.TILE_COUNT; i++) {
      if (concealed[i] > 0 && Tiles.isTerminalOrHonor(i)) tanyaoOk = false;
    }
    fuuro.forEach((m) => m.tiles.forEach((t) => { if (Tiles.isTerminalOrHonor(t)) tanyaoOk = false; }));
    if (tanyaoOk) return { ok: true, reason: 'タンヤオ(1・9・字牌を使わない役)が狙えます' };

    // 役牌: 副露にすでに役牌の刻子がある、または手牌に役牌の対子・刻子がある
    const isYakuhaiTile = (t) => {
      if (t >= 31) return true; // 三元牌は常に役牌
      if (t >= 27) return t === windCtx.seatWind || t === windCtx.roundWind; // 風牌は自風・場風のみ
      return false;
    };
    const fuuroHasYakuhai = fuuro.some((m) => (m.type === 'pon' || m.type === 'minkan' || m.type === 'ankan') && isYakuhaiTile(m.tiles[0]));
    if (fuuroHasYakuhai) return { ok: true, reason: '役牌の刻子がすでにあります' };
    for (let t = 27; t < Tiles.TILE_COUNT; t++) {
      if (concealed[t] >= 2 && isYakuhaiTile(t)) {
        return { ok: true, reason: Tiles.shortLabel(t) + 'の対子があり、役牌になる見込みがあります' };
      }
    }
    return { ok: false, reason: null };
  }

  /**
   * ポン・チー・カンをすべきかどうかの参考ガイド。
   * @param {object} params {handCounts, fuuro, action, tile, chiTiles, windCtx}
   *   action: 'pon' | 'chi' | 'kan'
   * @returns {{grade:string, gradeLabel:string, comment:string}}
   *   grade: 'good'(鳴くのがおすすめ) | 'fair'(鳴いても悪くない) | 'caution'(役が心配) | 'bad'(見送り推奨)
   */
  function evaluateCallAdvice(params) {
    const { handCounts, fuuro, action, tile, chiTiles, windCtx } = params;
    const shantenBefore = Shanten.calcShanten(handCounts, fuuro.length).shanten;

    let applied;
    if (action === 'pon') applied = Melds.applyPon(handCounts, tile, 0);
    else if (action === 'kan') applied = Melds.applyMinkan(handCounts, tile, 0);
    else applied = Melds.applyChi(handCounts, chiTiles, tile, 0);

    const shantenAfter = Shanten.calcShanten(applied.handCounts, fuuro.length + 1).shanten;
    const newFuuro = fuuro.concat([applied.meld]);
    const yakuCheck = hasYakuPotential(applied.handCounts, newFuuro, windCtx);

    if (shantenAfter > shantenBefore) {
      return { grade: 'bad', gradeLabel: '× 見送り推奨', comment: '鳴くとかえってシャンテン数が悪くなります。見送りましょう。' };
    }
    if (shantenAfter === shantenBefore) {
      return {
        grade: 'fair',
        gradeLabel: '△ 急がなくてよい',
        comment: 'シャンテン数は変わりません。急いで鳴く理由が無ければ見送っても構いません。',
      };
    }
    // シャンテンが進む場合
    if (yakuCheck.ok) {
      return {
        grade: 'good',
        gradeLabel: '◎ 鳴くのがおすすめ',
        comment: `シャンテン数が進みます。${yakuCheck.reason}ので、鳴いてもアガリにつながります。`,
      };
    }
    return {
      grade: 'caution',
      gradeLabel: '△ 役が心配',
      comment:
        'シャンテン数は進みますが、鳴くと門前(メンゼン)でなくなるため、リーチ・平和(ピンフ)・門前清自摸和などの役が使えなくなります。' +
        '現時点ではタンヤオや役牌などの役も見えていないため、このままアガれない(役なし)形になる可能性があります。',
    };
  }

  const Coach = {
    GRADE_SYMBOL,
    evaluateMultiAxis,
    gradeSymbol,
    buildOverallComment,
    evaluatePushFold: PushFold.evaluatePushFold,
    evaluateCallAdvice,
    hasYakuPotential,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Coach;
  } else {
    root.MJ = root.MJ || {};
    root.MJ.Coach = Coach;
  }
})(typeof window !== 'undefined' ? window : globalThis);
