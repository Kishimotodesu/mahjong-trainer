/**
 * yaku.js
 * 役の判定。手牌分解(1つのバリエーション)と状況(コンテキスト)を受け取り、
 * 成立する役の一覧(役名・翻数・「なぜ成立しているか」の説明)を返す。
 *
 * 前提: このアプリはV1.2時点で鳴き(ポン・チー・カン)を実装していないため、
 * 分析対象の手は常に「門前(メンゼン)」として扱う。
 */
(function (root) {
  'use strict';

  let Tiles, Decomposition;
  if (typeof module !== 'undefined' && module.exports) {
    Tiles = require('./tiles.js');
    Decomposition = require('./decomposition.js');
  } else {
    Tiles = root.MJ.Tiles;
    Decomposition = root.MJ.Decomposition;
  }

  const DRAGONS = [31, 32, 33]; // 白發中
  const WINDS = [27, 28, 29, 30]; // 東南西北
  const GREEN_TILES = new Set([19, 20, 21, 23, 25, 32]); // 2s3s4s6s8s + 發 (索子indexは18+n-1)

  function suitOfMeld(meld) {
    return Tiles.suitOf(meld.tiles[0]);
  }

  function isTerminal19(tileIdx) {
    return Tiles.isTerminal(tileIdx);
  }

  function meldTouchesTerminal(meld) {
    if (meld.type === 'triplet') return isTerminal19(meld.tiles[0]) || Tiles.isHonor(meld.tiles[0]);
    // sequence: 123 or 789 のみ端に触れる
    const lo = meld.tiles[0];
    return lo % 9 === 0 || lo % 9 === 6;
  }

  function meldTouchesTerminalNoHonor(meld) {
    if (meld.type === 'triplet') return isTerminal19(meld.tiles[0]) && !Tiles.isHonor(meld.tiles[0]);
    const lo = meld.tiles[0];
    return lo % 9 === 0 || lo % 9 === 6;
  }

  function allBlocks(variant) {
    return variant.melds.concat([{ type: 'pair', tiles: [variant.pair.tile, variant.pair.tile] }]);
  }

  function windName(tileIdx) {
    return Tiles.HONOR_NAMES[tileIdx - 27];
  }

  function isYakuhaiTriplet(meld, ctx) {
    if (meld.type !== 'triplet') return null;
    const t = meld.tiles[0];
    if (!Tiles.isHonor(t)) return null;
    const results = [];
    if (DRAGONS.includes(t)) {
      results.push({ key: 'yakuhai_' + Tiles.shortLabel(t), name: `役牌:${Tiles.shortLabel(t)}`, han: 1, isYakuman: false });
    }
    if (WINDS.includes(t)) {
      if (t === ctx.roundWind) {
        results.push({ key: 'yakuhai_round', name: `場風:${windName(t)}`, han: 1, isYakuman: false });
      }
      if (t === ctx.seatWind) {
        results.push({ key: 'yakuhai_seat', name: `自風:${windName(t)}`, han: 1, isYakuman: false });
      }
    }
    return results.length > 0 ? results : null;
  }

  /**
   * 標準形(4面子+雀頭)の1バリエーションについて、通常役(役満以外)を判定する。
   */
  function evaluateStandardYaku(variant, ctx) {
    const yaku = [];
    const melds = variant.melds;
    const blocks = allBlocks(variant);
    const isRon = ctx.isTsumo === false;

    const isMenzen = ctx.isMenzen !== false; // 未指定(V1.2までの呼び出し)は常に門前として扱う

    // ---- 状況役(リーチ・ダブルリーチは門前限定。ゲーム側で門前時のみtrueが渡される想定だが念のため確認する) ----
    if (ctx.isDoubleRiichi && isMenzen) {
      yaku.push({ key: 'double_riichi', name: 'ダブルリーチ', han: 2, explanation: '最初の自分の打牌より前(第1巡目)にリーチを宣言したため、通常のリーチより1翻多いダブルリーチになります。' });
    } else if (ctx.isRiichi && isMenzen) {
      yaku.push({ key: 'riichi', name: 'リーチ', han: 1, explanation: 'リーチを宣言してアガったため成立します。' });
    }
    if (ctx.isIppatsu && isMenzen && (ctx.isRiichi || ctx.isDoubleRiichi)) {
      yaku.push({ key: 'ippatsu', name: '一発', han: 1, explanation: 'リーチ宣言から自分の次の打牌までの間に、他家の鳴きを挟まずアガったため成立します。' });
    }
    if (ctx.isTsumo && isMenzen) {
      yaku.push({ key: 'menzen_tsumo', name: '門前清自摸和', han: 1, explanation: '門前(鳴きなし)の手を自分でツモってアガったため成立します。' });
    }
    if (ctx.isHaitei) {
      yaku.push({ key: 'haitei', name: '海底摸月', han: 1, explanation: '山の最後の1枚をツモってアガったため成立します。' });
    }
    if (ctx.isHoutei) {
      yaku.push({ key: 'houtei', name: '河底撈魚', han: 1, explanation: '最後の捨て牌をロンしてアガったため成立します。' });
    }
    if (ctx.isRinshan) {
      yaku.push({ key: 'rinshan', name: '嶺上開花', han: 1, explanation: 'カンをした後の嶺上牌でツモってアガったため成立します。' });
    }
    if (ctx.isChankan) {
      yaku.push({ key: 'chankan', name: '槍槓', han: 1, explanation: '他家が加槓した牌をロンして(槍槓)アガったため成立します。' });
    }

    // ---- 役牌 ----
    for (const meld of melds) {
      const r = isYakuhaiTriplet(meld, ctx);
      if (r) {
        for (const y of r) {
          yaku.push({
            ...y,
            explanation:
              y.key.startsWith('yakuhai_')
                ? (DRAGONS.includes(meld.tiles[0])
                    ? `${Tiles.shortLabel(meld.tiles[0])}の刻子があるため三元牌の役牌が成立します。`
                    : `${windName(meld.tiles[0])}の刻子があり、${y.key === 'yakuhai_round' ? '場風と一致する' : '自風と一致する'}ため役牌が成立します。`)
                : '',
          });
        }
      }
    }

    // ---- タンヤオ ----
    const allSimples = variant.melds.every((m) => !m.tiles.some(isTerminal19) && !m.tiles.some(Tiles.isHonor)) &&
      !isTerminal19(variant.pair.tile) && !Tiles.isHonor(variant.pair.tile);
    if (allSimples) {
      yaku.push({ key: 'tanyao', name: 'タンヤオ', han: 1, explanation: '1・9の牌や字牌を1枚も使わず、2〜8の数牌だけで手牌が構成されているため成立します。' });
    }

    // ---- 平和(ピンフ) ----
    const allSequences = melds.every((m) => m.type === 'sequence');
    const pairIsYakuhai = Tiles.isHonor(variant.pair.tile) &&
      (DRAGONS.includes(variant.pair.tile) || variant.pair.tile === ctx.roundWind || variant.pair.tile === ctx.seatWind);
    const isPinfu = isMenzen && allSequences && !pairIsYakuhai && variant.waitType === 'ryanmen';
    if (isPinfu) {
      yaku.push({ key: 'pinfu', name: '平和', han: 1, explanation: '4つとも順子で、雀頭は役牌ではなく、両面待ちでアガっているため成立します。' });
    }

    // ---- 一盃口・二盃口 ----
    const seqKeys = melds.filter((m) => m.type === 'sequence').map((m) => m.tiles.join(','));
    const seqCounts = {};
    seqKeys.forEach((k) => (seqCounts[k] = (seqCounts[k] || 0) + 1));
    const pairCount = Object.values(seqCounts).filter((c) => c >= 2).length;
    if (isMenzen && pairCount >= 2) {
      yaku.push({ key: 'ryanpeikou', name: '二盃口', han: 3, explanation: '同じ順子が2枚組×2種類(2組の一盃口)そろっているため成立します(門前限定)。' });
    } else if (isMenzen && pairCount === 1) {
      yaku.push({ key: 'iipeikou', name: '一盃口', han: 1, explanation: '同じ順子が2つそろっているため成立します(門前限定)。' });
    }

    // ---- 三色同順 ----
    for (let p = 0; p <= 6; p++) {
      const hasMan = melds.some((m) => m.type === 'sequence' && m.tiles[0] === p);
      const hasPin = melds.some((m) => m.type === 'sequence' && m.tiles[0] === p + 9);
      const hasSou = melds.some((m) => m.type === 'sequence' && m.tiles[0] === p + 18);
      if (hasMan && hasPin && hasSou) {
        yaku.push({
          key: 'sanshoku_doujun',
          name: '三色同順',
          han: 2,
          explanation: `萬子・筒子・索子すべてに${p + 1}${p + 2}${p + 3}の同じ数字の順子があるため成立します。`,
        });
        break;
      }
    }

    // ---- 三色同刻 ----
    for (let n = 0; n <= 8; n++) {
      const hasMan = melds.some((m) => m.type === 'triplet' && m.tiles[0] === n);
      const hasPin = melds.some((m) => m.type === 'triplet' && m.tiles[0] === n + 9);
      const hasSou = melds.some((m) => m.type === 'triplet' && m.tiles[0] === n + 18);
      if (hasMan && hasPin && hasSou) {
        yaku.push({
          key: 'sanshoku_doukou',
          name: '三色同刻',
          han: 2,
          explanation: `萬子・筒子・索子すべてに${n + 1}の同じ数字の刻子があるため成立します。`,
        });
        break;
      }
    }

    // ---- 一気通貫 ----
    for (const base of [0, 9, 18]) {
      const has123 = melds.some((m) => m.type === 'sequence' && m.tiles[0] === base);
      const has456 = melds.some((m) => m.type === 'sequence' && m.tiles[0] === base + 3);
      const has789 = melds.some((m) => m.type === 'sequence' && m.tiles[0] === base + 6);
      if (has123 && has456 && has789) {
        yaku.push({
          key: 'ittsu',
          name: '一気通貫',
          han: 2,
          explanation: `${Tiles.SUIT_KANJI[Tiles.suitOf(base)]}で123・456・789がすべてそろっているため成立します。`,
        });
        break;
      }
    }

    // ---- 対々和・三暗刻・四暗刻(四暗刻は役満側で扱う) ----
    const triplets = melds.filter((m) => m.type === 'triplet');
    if (triplets.length === 4) {
      yaku.push({ key: 'toitoi', name: '対々和', han: 2, explanation: '4つの面子がすべて刻子(同じ牌3枚)であるため成立します。' });
    }
    const ankouCount = triplets.filter((m) => Decomposition.isConcealedTriplet(variant, melds.indexOf(m), isRon)).length;
    if (ankouCount === 3) {
      yaku.push({ key: 'sanankou', name: '三暗刻', han: 2, explanation: '暗刻(鳴かずに揃えた刻子)が3つあるため成立します。' });
    }

    // ---- 混全帯幺九・純全帯幺九 ----
    const allBlocksTouchTerminal = blocks.every((b) =>
      b.type === 'pair' ? isTerminal19(b.tiles[0]) || Tiles.isHonor(b.tiles[0]) : meldTouchesTerminal(b)
    );
    const hasHonorTile = variant.melds.some((m) => Tiles.isHonor(m.tiles[0])) || Tiles.isHonor(variant.pair.tile);
    if (allBlocksTouchTerminal) {
      if (!hasHonorTile) {
        yaku.push({ key: 'junchan', name: '純全帯幺九', han: 3, explanation: 'すべての面子・雀頭が1か9を含み、かつ字牌を1枚も使っていないため成立します。' });
      } else {
        yaku.push({ key: 'chanta', name: '混全帯幺九', han: 2, explanation: 'すべての面子・雀頭が1・9・字牌のいずれかを含んでいるため成立します。' });
      }
    }

    // ---- 混老頭 ----
    const allTerminalOrHonor = variant.melds.every((m) => m.tiles.every(Tiles.isTerminalOrHonor)) && Tiles.isTerminalOrHonor(variant.pair.tile);
    if (allTerminalOrHonor && triplets.length === 4) {
      yaku.push({ key: 'honroutou', name: '混老頭', han: 2, explanation: 'すべての牌が1・9・字牌のみで、対々和の形になっているため成立します。' });
    }

    // ---- 小三元 ----
    const dragonMelds = melds.filter((m) => m.type === 'triplet' && DRAGONS.includes(m.tiles[0]));
    const dragonPair = DRAGONS.includes(variant.pair.tile);
    if (dragonMelds.length === 2 && dragonPair) {
      yaku.push({ key: 'shousangen', name: '小三元', han: 2, explanation: '三元牌(白發中)のうち2つが刻子、残り1つが雀頭になっているため成立します(刻子の役牌も別途加算されます)。' });
    }

    // ---- 混一色・清一色 ----
    const usedSuits = new Set();
    let usesHonor = false;
    for (const b of blocks) {
      for (const t of b.tiles) {
        if (Tiles.isHonor(t)) usesHonor = true;
        else usedSuits.add(Tiles.suitOf(t));
      }
    }
    if (usedSuits.size === 1) {
      if (usesHonor) {
        yaku.push({ key: 'honitsu', name: '混一色', han: 3, explanation: '1種類の数牌(萬子・筒子・索子のいずれか)と字牌だけで構成されているため成立します。' });
      } else {
        yaku.push({ key: 'chinitsu', name: '清一色', han: 6, explanation: '1種類の数牌だけ(字牌を使わず)で構成されているため成立します。' });
      }
    }

    return yaku;
  }

  /**
   * 役満の判定(標準形の1バリエーションについて)。
   */
  function evaluateStandardYakuman(variant, ctx, counts14, rules) {
    const yakuman = [];
    const melds = variant.melds;
    const blocks = allBlocks(variant);
    const isRon = ctx.isTsumo === false;
    const triplets = melds.filter((m) => m.type === 'triplet');
    const ankouCount = triplets.filter((m) => Decomposition.isConcealedTriplet(variant, melds.indexOf(m), isRon)).length;

    // 四暗刻・四暗刻単騎
    if (triplets.length === 4 && ankouCount === 4) {
      if (variant.waitType === 'tanki') {
        yakuman.push({ key: 'suuankou_tanki', name: '四暗刻単騎', isYakuman: true, multiple: rules.doubleYakuman ? 2 : 1, explanation: '暗刻4つ+単騎待ちで和了したため、四暗刻の中でも特に価値の高い四暗刻単騎になります。' });
      } else {
        yakuman.push({ key: 'suuankou', name: '四暗刻', isYakuman: true, multiple: 1, explanation: '4つの刻子がすべて暗刻(鳴かずに揃えた刻子)であるため成立します。' });
      }
    }

    // 大三元
    const dragonTriplets = melds.filter((m) => m.type === 'triplet' && DRAGONS.includes(m.tiles[0]));
    if (dragonTriplets.length === 3) {
      yakuman.push({ key: 'daisangen', name: '大三元', isYakuman: true, multiple: 1, explanation: '三元牌(白發中)がすべて刻子になっているため成立します。' });
    }

    // 小四喜・大四喜
    const windTriplets = melds.filter((m) => m.type === 'triplet' && WINDS.includes(m.tiles[0]));
    if (windTriplets.length === 4) {
      yakuman.push({ key: 'daisuushi', name: '大四喜', isYakuman: true, multiple: rules.doubleYakuman ? 2 : 1, explanation: '東南西北すべての風牌が刻子になっているため成立します。' });
    } else if (windTriplets.length === 3 && WINDS.includes(variant.pair.tile)) {
      yakuman.push({ key: 'shousuushi', name: '小四喜', isYakuman: true, multiple: 1, explanation: '風牌のうち3つが刻子、残り1つが雀頭になっているため成立します。' });
    }

    // 字一色
    if (blocks.every((b) => b.tiles.every(Tiles.isHonor))) {
      yakuman.push({ key: 'tsuuiisou', name: '字一色', isYakuman: true, multiple: 1, explanation: 'すべての牌が字牌のみで構成されているため成立します。' });
    }

    // 清老頭
    if (blocks.every((b) => b.tiles.every(Tiles.isTerminal))) {
      yakuman.push({ key: 'chinroutou', name: '清老頭', isYakuman: true, multiple: 1, explanation: 'すべての牌が1・9の数牌のみで構成されているため成立します。' });
    }

    // 緑一色
    if (blocks.every((b) => b.tiles.every((t) => GREEN_TILES.has(t)))) {
      yakuman.push({ key: 'ryuuiisou', name: '緑一色', isYakuman: true, multiple: 1, explanation: '2・3・4・6・8索と發だけの、緑色の牌だけで構成されているため成立します。' });
    }

    // 九蓮宝燈(清一色が前提)
    const suitsUsed = new Set(blocks.flatMap((b) => b.tiles.map(Tiles.suitOf)).filter((s) => s !== Tiles.SUIT_HONOR));
    const anyHonorUsed = blocks.some((b) => b.tiles.some(Tiles.isHonor));
    if (suitsUsed.size === 1 && !anyHonorUsed) {
      const suitBase = { m: 0, p: 9, s: 18 }[[...suitsUsed][0]];
      const lo = suitBase, hi = suitBase + 8;
      const isChuuren = counts14[lo] >= 3 && counts14[hi] >= 3 && [1, 2, 3, 4, 5, 6, 7].every((k) => counts14[suitBase + k] >= 1);
      if (isChuuren) {
        const counts13 = counts14.slice();
        counts13[ctx.winningTile]--;
        const isPure =
          counts13[lo] === 3 &&
          counts13[hi] === 3 &&
          [1, 2, 3, 4, 5, 6, 7].every((k) => counts13[suitBase + k] === 1);
        if (isPure) {
          yakuman.push({ key: 'junsei_chuuren', name: '純正九蓮宝燈', isYakuman: true, multiple: rules.doubleYakuman ? 2 : 1, explanation: '純粋な九蓮宝燈の形(1112345678999)がすでに完成しており、そこに1種を足す9面待ちの状態でアガったため成立します。' });
        } else {
          yakuman.push({ key: 'chuuren', name: '九蓮宝燈', isYakuman: true, multiple: 1, explanation: '1種類の数牌で1112345678999の形(九蓮宝燈)が成立しているため成立します。' });
        }
      }
    }

    return yakuman;
  }

  /**
   * 七対子バリエーションの役判定(通常役のみ。七対子自体もここに含む)。
   * @param {number[]} counts14
   */
  function evaluateChiitoitsuYaku(counts14, ctx) {
    const yaku = [{ key: 'chiitoitsu', name: '七対子', han: 2, explanation: '7種類の対子(同じ牌2枚)だけで手牌が構成されているため成立します。' }];

    if (ctx.isDoubleRiichi) {
      yaku.push({ key: 'double_riichi', name: 'ダブルリーチ', han: 2, explanation: '第1巡目にリーチを宣言したため、ダブルリーチになります。' });
    } else if (ctx.isRiichi) {
      yaku.push({ key: 'riichi', name: 'リーチ', han: 1, explanation: 'リーチを宣言してアガったため成立します。' });
    }
    if (ctx.isIppatsu && (ctx.isRiichi || ctx.isDoubleRiichi)) {
      yaku.push({ key: 'ippatsu', name: '一発', han: 1, explanation: 'リーチ後1巡以内、他家の鳴きを挟まずアガったため成立します。' });
    }
    if (ctx.isTsumo) yaku.push({ key: 'menzen_tsumo', name: '門前清自摸和', han: 1, explanation: '門前でツモアガりしたため成立します。' });
    if (ctx.isHaitei) yaku.push({ key: 'haitei', name: '海底摸月', han: 1, explanation: '山の最後の1枚でツモアガりしたため成立します。' });
    if (ctx.isHoutei) yaku.push({ key: 'houtei', name: '河底撈魚', han: 1, explanation: '最後の捨て牌をロンしたため成立します。' });

    let usesHonor = false;
    const suits = new Set();
    let allSimple = true;
    let allTerminalOrHonor = true;
    for (let i = 0; i < Tiles.TILE_COUNT; i++) {
      if (counts14[i] > 0) {
        if (Tiles.isHonor(i)) { usesHonor = true; allSimple = false; } else { suits.add(Tiles.suitOf(i)); if (Tiles.isTerminal(i)) allSimple = false; }
        if (!Tiles.isTerminalOrHonor(i)) allTerminalOrHonor = false;
      }
    }
    if (allSimple) yaku.push({ key: 'tanyao', name: 'タンヤオ', han: 1, explanation: '1・9・字牌を1枚も使っていないため成立します。' });
    if (suits.size === 1) {
      if (usesHonor) yaku.push({ key: 'honitsu', name: '混一色', han: 3, explanation: '1種類の数牌と字牌だけで構成されているため成立します。' });
      else yaku.push({ key: 'chinitsu', name: '清一色', han: 6, explanation: '1種類の数牌だけで構成されているため成立します。' });
    }
    if (allTerminalOrHonor) yaku.push({ key: 'honroutou', name: '混老頭', han: 2, explanation: 'すべての牌が1・9・字牌のみで構成されているため成立します。' });

    return yaku;
  }

  const Yaku = {
    evaluateStandardYaku,
    evaluateStandardYakuman,
    evaluateChiitoitsuYaku,
    isYakuhaiTriplet,
    allBlocks,
    DRAGONS,
    WINDS,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Yaku;
  } else {
    root.MJ = root.MJ || {};
    root.MJ.Yaku = Yaku;
  }
})(typeof window !== 'undefined' ? window : globalThis);
