/**
 * scoring.js
 * 符計算・点数計算、および「どの分解(読み方)が最も点数が高くなるか」を
 * 選ぶオーケストレーション処理。
 */
(function (root) {
  'use strict';

  let Tiles, Shanten, Decomposition, Yaku, Dora, Melds;
  if (typeof module !== 'undefined' && module.exports) {
    Tiles = require('./tiles.js');
    Shanten = require('./shanten.js');
    Decomposition = require('./decomposition.js');
    Yaku = require('./yaku.js');
    Dora = require('./dora.js');
    Melds = require('./melds.js');
  } else {
    Tiles = root.MJ.Tiles;
    Shanten = root.MJ.Shanten;
    Decomposition = root.MJ.Decomposition;
    Yaku = root.MJ.Yaku;
    Dora = root.MJ.Dora;
    Melds = root.MJ.Melds;
  }

  const WAIT_FU = { ryanmen: 0, shanpon: 0, kanchan: 2, penchan: 2, tanki: 2 };
  const WAIT_LABEL = { ryanmen: '両面', shanpon: 'シャボ', kanchan: '嵌張', penchan: '辺張', tanki: '単騎' };
  // 鳴くと翻数が下がる役(食い下がり)。門前のときのみフルの翻数になる。
  const KUISAGARI = { sanshoku_doujun: 1, ittsu: 1, chanta: 1, junchan: 1, honitsu: 1, chinitsu: 1 };

  /** 副露(melds.jsの形式)を、役・符判定で使う面子の形式に変換する */
  function convertFuuroToMelds(fuuro) {
    return (fuuro || []).map((m) => {
      if (m.type === 'chi') return { type: 'sequence', tiles: m.tiles.slice(), concealed: false };
      if (m.type === 'pon') return { type: 'triplet', tiles: m.tiles.slice(), concealed: false };
      if (m.type === 'minkan' || m.type === 'kakan') {
        return { type: 'triplet', tiles: m.tiles.slice(), concealed: false, isKan: true };
      }
      if (m.type === 'ankan') return { type: 'triplet', tiles: m.tiles.slice(), concealed: true, isKan: true };
      return { type: m.type, tiles: m.tiles.slice(), concealed: !!m.concealed };
    });
  }

  function defaultRules() {
    return {
      kuitan: true, // 喰いタン(現状鳴き未実装のため実質無効。将来のための設定)
      akaDora: true,
      kiriageMangan: false,
      kazoeYakuman: true,
      doubleYakuman: true,
    };
  }

  // ---- 符計算 ----
  function computeFuForVariant(variant, ctx, hasPinfu) {
    const breakdown = [];
    let total = 20;
    breakdown.push({ label: '基本符', value: 20 });

    if (ctx.isTsumo) {
      if (!hasPinfu) {
        total += 2;
        breakdown.push({ label: 'ツモ', value: 2 });
      }
    } else if (ctx.isMenzen !== false) {
      total += 10;
      breakdown.push({ label: '門前ロン', value: 10 });
    }

    variant.melds.forEach((meld, idx) => {
      if (meld.type !== 'triplet') return;
      const tile = meld.tiles[0];
      const isTerminalOrHonor = Tiles.isTerminalOrHonor(tile);
      const isConcealed = Decomposition.isConcealedTriplet(variant, idx, !ctx.isTsumo);
      let value;
      let kindLabel;
      if (meld.isKan) {
        value = isTerminalOrHonor ? (isConcealed ? 32 : 16) : isConcealed ? 16 : 8;
        kindLabel = isConcealed ? '暗槓' : '明槓';
      } else {
        value = isTerminalOrHonor ? (isConcealed ? 8 : 4) : isConcealed ? 4 : 2;
        kindLabel = isConcealed ? '暗刻' : '明刻';
      }
      total += value;
      breakdown.push({
        label: `${Tiles.shortLabel(tile)}の${kindLabel}${isTerminalOrHonor ? '(幺九牌)' : ''}`,
        value,
      });
    });

    const pairTile = variant.pair.tile;
    let pairFu = 0;
    if (Yaku.DRAGONS.includes(pairTile)) pairFu += 2;
    if (pairTile === ctx.roundWind) pairFu += 2;
    if (pairTile === ctx.seatWind) pairFu += 2;
    if (pairFu > 0) {
      total += pairFu;
      breakdown.push({ label: `${Tiles.shortLabel(pairTile)}の雀頭(役牌)`, value: pairFu });
    }

    const waitFu = WAIT_FU[variant.waitType] || 0;
    breakdown.push({ label: `待ち(${WAIT_LABEL[variant.waitType] || variant.waitType})`, value: waitFu });
    total += waitFu;

    const rounded = Math.ceil(total / 10) * 10;
    if (rounded !== total) {
      breakdown.push({ label: '切り上げ', value: rounded - total });
    }

    return { total: rounded, breakdown };
  }

  // ---- 点数計算(翻・符から) ----
  function baseScoreFromHanFu(han, fu, rules) {
    if (han >= 13 && rules.kazoeYakuman) return { base: 8000, tier: '数え役満' };
    if (han >= 11) return { base: 6000, tier: '三倍満' };
    if (han >= 8) return { base: 4000, tier: '倍満' };
    if (han >= 6) return { base: 3000, tier: '跳満' };

    let base = fu * Math.pow(2, 2 + han);
    const isKiriageCase = rules.kiriageMangan && ((han === 4 && fu === 30) || (han === 3 && fu === 60));
    if (isKiriageCase || base > 2000) base = 2000;
    let tier = base === 2000 ? '満貫' : '';
    return { base, tier };
  }

  function ceilTo100(n) {
    return Math.ceil(n / 100) * 100;
  }

  /**
   * @returns {{base:number, tier:string, ron:?number, tsumoNonDealer:?number, tsumoDealer:?number, tsumoTotal:?number, paymentText:string}}
   */
  function computeScoreFromHanFu(han, fu, isDealer, isTsumo, rules) {
    const { base, tier } = baseScoreFromHanFu(han, fu, rules);
    const result = { base, tier, han, fu };

    if (isTsumo) {
      if (isDealer) {
        const each = ceilTo100(base * 2);
        result.tsumoDealer = null;
        result.tsumoNonDealer = each;
        result.total = each * 3;
        result.paymentText = `子は全員 ${each}点ずつ支払い(合計${result.total}点)`;
      } else {
        const fromDealer = ceilTo100(base * 2);
        const fromChild = ceilTo100(base * 1);
        result.tsumoDealer = fromDealer;
        result.tsumoNonDealer = fromChild;
        result.total = fromDealer + fromChild * 2;
        result.paymentText = `親は${fromDealer}点、子は${fromChild}点ずつ支払い(合計${result.total}点)`;
      }
    } else {
      const multiplier = isDealer ? 6 : 4;
      const points = ceilTo100(base * multiplier);
      result.ron = points;
      result.total = points;
      result.paymentText = `ロンした相手から${points}点`;
    }

    return result;
  }

  function yakumanScore(totalMultiple, isDealer, isTsumo) {
    const base = 8000 * totalMultiple;
    if (isTsumo) {
      // 通常役と同じく tsumoDealer / tsumoNonDealer を必ず埋める
      // (未設定だと点棒移動の計算がNaNになるため)
      if (isDealer) {
        const each = base * 2;
        return {
          base,
          tier: '役満',
          total: each * 3,
          paymentText: `子は全員 ${each}点ずつ支払い(合計${each * 3}点)`,
          isYakuman: true,
          tsumoDealer: null,
          tsumoNonDealer: each,
        };
      }
      const fromDealer = base * 2;
      const fromChild = base * 1;
      return {
        base,
        tier: '役満',
        total: fromDealer + fromChild * 2,
        paymentText: `親は${fromDealer}点、子は${fromChild}点ずつ支払い(合計${fromDealer + fromChild * 2}点)`,
        isYakuman: true,
        tsumoDealer: fromDealer,
        tsumoNonDealer: fromChild,
      };
    }
    const multiplier = isDealer ? 6 : 4;
    const points = base * multiplier;
    return { base, tier: '役満', total: points, paymentText: `ロンした相手から${points}点`, isYakuman: true, ron: points };
  }

  /**
   * 標準形の1バリエーションについて、役・翻・符・点数をまとめて評価する。
   */
  function evaluateVariant(variant, ctx, counts14, rules, doraInfo, uraDoraInfo) {
    const yakumanList = Yaku.evaluateStandardYakuman(variant, ctx, counts14, rules);
    if (yakumanList.length > 0) {
      const totalMultiple = yakumanList.reduce((sum, y) => sum + y.multiple, 0);
      const score = yakumanScore(totalMultiple, ctx.isDealer, ctx.isTsumo);
      return {
        isYakuman: true,
        yakuList: yakumanList,
        han: totalMultiple * 13,
        fu: null,
        fuBreakdown: [],
        score,
        variant,
      };
    }

    const yakuList = Yaku.evaluateStandardYaku(variant, ctx);
    if (ctx.isMenzen === false) {
      yakuList.forEach((y) => {
        if (KUISAGARI[y.key]) y.han -= KUISAGARI[y.key];
      });
    }
    if (yakuList.length === 0) {
      return { isYakuman: false, yakuList: [], han: 0, fu: null, fuBreakdown: [], score: null, variant, noYaku: true };
    }

    const hasPinfu = yakuList.some((y) => y.key === 'pinfu');
    const { total: fu, breakdown: fuBreakdown } = computeFuForVariant(variant, ctx, hasPinfu);

    let han = yakuList.reduce((sum, y) => sum + y.han, 0);
    const doraHan = doraInfo.total;
    const akaHan = doraInfo.aka;
    if (doraHan > 0) yakuList.push({ key: 'dora', name: 'ドラ', han: doraHan, explanation: `ドラを${doraHan}枚使っているため、翻数に加算されます(ドラ自体は役ではありません)。` });
    if (akaHan > 0) yakuList.push({ key: 'aka_dora', name: '赤ドラ', han: akaHan, explanation: `赤ドラを${akaHan}枚使っているため、翻数に加算されます(ドラ自体は役ではありません)。` });
    han += doraHan + akaHan;
    const uraHan = (uraDoraInfo && uraDoraInfo.total) || 0;
    if (uraHan > 0) {
      yakuList.push({ key: 'ura_dora', name: '裏ドラ', han: uraHan, explanation: `リーチしてアガったため裏ドラ表示牌が公開され、${uraHan}枚該当したため加算されます(裏ドラ自体は役ではありません)。` });
      han += uraHan;
    }

    const isKazoe = han >= 13 && rules.kazoeYakuman;
    let score;
    if (isKazoe) {
      score = yakumanScore(1, ctx.isDealer, ctx.isTsumo);
      score.tier = '数え役満';
    } else {
      score = computeScoreFromHanFu(han, fu, ctx.isDealer, ctx.isTsumo, rules);
    }

    return { isYakuman: false, yakuList, han, fu, fuBreakdown, score, variant };
  }

  function scoreForKokushi(counts14, ctx, rules) {
    const isThirteenWait = (() => {
      const pre = counts14.slice();
      pre[ctx.winningTile]--;
      return Tiles.TERMINALS_AND_HONORS.every((t) => pre[t] <= 1) && Tiles.TERMINALS_AND_HONORS.every((t) => pre[t] >= 1);
    })();
    const key = isThirteenWait ? 'kokushi_13' : 'kokushi';
    const name = isThirteenWait ? '国士無双十三面待ち' : '国士無双';
    const multiple = isThirteenWait && rules.doubleYakuman ? 2 : 1;
    const yakuList = [{ key, name, isYakuman: true, multiple, explanation: '么九牌(1・9・字牌)を13種類すべて集め、そのうち1種類を対子にしているため成立します。' }];
    const score = yakumanScore(multiple, ctx.isDealer, ctx.isTsumo);
    return { isYakuman: true, yakuList, han: multiple * 13, fu: null, fuBreakdown: [], score, variant: null, handType: 'kokushi' };
  }

  function scoreForChiitoitsu(counts14, ctx, rules, doraInfo, uraDoraInfo) {
    const yakuList = Yaku.evaluateChiitoitsuYaku(counts14, ctx);
    let han = yakuList.reduce((sum, y) => sum + y.han, 0);
    if (doraInfo.total > 0) {
      yakuList.push({ key: 'dora', name: 'ドラ', han: doraInfo.total, explanation: `ドラを${doraInfo.total}枚使っています(ドラ自体は役ではありません)。` });
      han += doraInfo.total;
    }
    if (doraInfo.aka > 0) {
      yakuList.push({ key: 'aka_dora', name: '赤ドラ', han: doraInfo.aka, explanation: `赤ドラを${doraInfo.aka}枚使っています。` });
      han += doraInfo.aka;
    }
    const uraHan = (uraDoraInfo && uraDoraInfo.total) || 0;
    if (uraHan > 0) {
      yakuList.push({ key: 'ura_dora', name: '裏ドラ', han: uraHan, explanation: `裏ドラが${uraHan}枚該当したため加算されます。` });
      han += uraHan;
    }
    const fu = 25;
    const fuBreakdown = [{ label: '七対子固定', value: 25 }];
    const isKazoe = han >= 13 && rules.kazoeYakuman;
    const score = isKazoe ? { ...yakumanScore(1, ctx.isDealer, ctx.isTsumo), tier: '数え役満' } : computeScoreFromHanFu(han, fu, ctx.isDealer, ctx.isTsumo, rules);
    return { isYakuman: false, yakuList, han, fu, fuBreakdown, score, variant: null, handType: 'chiitoitsu' };
  }

  /**
   * 完成した手牌について、最も点数が高くなる読み方を選んで
   * 役・翻・符・点数をまとめて返す。役が1つも無い場合は noYaku 情報を返す。
   *
   * @param {number[]} concealedCounts 手の中に残っている牌の枚数配列(副露分は含めない)。
   *   副露が無ければ従来通り14枚分の手牌をそのまま渡せばよい。
   * @param {object} ctx {winningTile, isTsumo, isRiichi, isDoubleRiichi, isIppatsu, isHaitei, isHoutei,
   *                       isRinshan, isChankan, isDealer, seatWind, roundWind}
   * @param {object} [rulesOverride]
   * @param {{indicatorTiles:number[], uraIndicatorTiles?:number[], aka:{m,p,s}}} [doraSetting]
   *   uraIndicatorTiles はリーチ時のみ意味を持つ裏ドラ表示牌(省略可)。
   * @param {Array} [fuuro] melds.js形式の副露一覧(チー・ポン・カン)。省略すれば門前として扱う。
   */
  function scoreHand(concealedCounts, ctx, rulesOverride, doraSetting, fuuro) {
    fuuro = fuuro || [];
    const rules = Object.assign(defaultRules(), rulesOverride || {});
    const setting = doraSetting || { indicatorTiles: [], aka: { m: 0, p: 0, s: 0 } };
    const lockedMelds = fuuro.length;
    const isMenzen = fuuro.every((m) => m.concealed === true);
    const fullCounts = lockedMelds > 0 ? Melds.fullHandCounts(concealedCounts, fuuro) : concealedCounts;
    const scoringCtx = Object.assign({}, ctx, { isMenzen });

    const doraCount = Dora.countTotalDora(fullCounts, setting.indicatorTiles || []);
    const akaCount = Dora.countAkaDora(setting.aka || {});
    const doraInfo = { total: doraCount.total, aka: akaCount, details: doraCount.details };

    let uraDoraInfo = { total: 0, details: [] };
    if ((scoringCtx.isRiichi || scoringCtx.isDoubleRiichi) && setting.uraIndicatorTiles && setting.uraIndicatorTiles.length > 0) {
      const uraCount = Dora.countTotalDora(fullCounts, setting.uraIndicatorTiles);
      uraDoraInfo = { total: uraCount.total, details: uraCount.details };
    }

    const overall = Shanten.calcShanten(concealedCounts, lockedMelds);
    if (overall.shanten !== -1) {
      return { complete: false };
    }

    const candidates = [];
    const convertedFuuro = convertFuuroToMelds(fuuro);

    if (overall.type === 'kokushi') {
      candidates.push(scoreForKokushi(concealedCounts, scoringCtx, rules));
    } else {
      // 標準形として読める場合と七対子として読める場合の両方を試す(高い方を採用)
      const decomps = Decomposition.enumerateWinningDecompositions(concealedCounts, 4 - lockedMelds);
      for (const decomp of decomps) {
        const rawVariants = Decomposition.enumerateVariants(decomp, scoringCtx.winningTile, !scoringCtx.isTsumo);
        for (const rv of rawVariants) {
          const mergedVariant = {
            pair: rv.pair,
            melds: rv.melds.concat(convertedFuuro),
            waitType: rv.waitType,
            completedBlock: rv.completedBlock,
          };
          candidates.push(evaluateVariant(mergedVariant, scoringCtx, fullCounts, rules, doraInfo, uraDoraInfo));
        }
      }

      if (lockedMelds === 0) {
        let pairsCount = 0;
        for (let i = 0; i < Tiles.TILE_COUNT; i++) if (concealedCounts[i] >= 2) pairsCount++;
        if (pairsCount === 7) {
          candidates.push(scoreForChiitoitsu(concealedCounts, scoringCtx, rules, doraInfo, uraDoraInfo));
        }
      }
    }

    const withScore = candidates.filter((c) => c.score);
    if (withScore.length === 0) {
      // 役が無い(アガリの形はできているが、役満・通常役ともに1つも成立しない)
      const best = candidates.find((c) => c.noYaku) || null;
      return { complete: true, hasYaku: false, best, doraInfo, uraDoraInfo };
    }

    withScore.sort((a, b) => (b.score.total || 0) - (a.score.total || 0));
    return { complete: true, hasYaku: true, best: withScore[0], all: withScore, doraInfo, uraDoraInfo };
  }

  const Scoring = {
    defaultRules,
    computeFuForVariant,
    computeScoreFromHanFu,
    baseScoreFromHanFu,
    yakumanScore,
    scoreHand,
    WAIT_FU,
    WAIT_LABEL,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Scoring;
  } else {
    root.MJ = root.MJ || {};
    root.MJ.Scoring = Scoring;
  }
})(typeof window !== 'undefined' ? window : globalThis);
