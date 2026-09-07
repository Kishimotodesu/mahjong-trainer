/**
 * quizengine.js
 * 「クイズ・学習」タブ(初心者向けクイズ第一弾)のルール判定層。
 *
 * 最重要方針: クイズの正解は、このファイルの resolver が
 * 本番と同じロジック(shanten.js / decomposition.js / yaku.js / scoring.js /
 * furiten.js / safety.js)を呼び出して都度計算する。
 * quizdata.js 側の expected は「データが正しいか」をテストで突き合わせるための
 * 参照値であり、実行時の採点には使わない(本番エンジンと教材の判定がずれるのを防ぐため)。
 *
 * 表示処理(appquiz.js)はこのファイルの結果を描画するだけで、
 * 待ち・フリテン・現物の判定を自前で行わないこと。
 */
(function (root) {
  'use strict';

  let Tiles, Shanten, HandInfo, Decomposition, Melds, Yaku, Scoring, Furiten, Safety, YakuReadings, Defense, Reading;
  if (typeof module !== 'undefined' && module.exports) {
    Tiles = require('./tiles.js');
    Shanten = require('./shanten.js');
    HandInfo = require('./handinfo.js');
    Decomposition = require('./decomposition.js');
    Melds = require('./melds.js');
    Yaku = require('./yaku.js');
    Scoring = require('./scoring.js');
    Furiten = require('./furiten.js');
    Safety = require('./safety.js');
    YakuReadings = require('./yakureadings.js');
    Defense = require('./defense.js');
    Reading = require('./reading.js');
  } else {
    Tiles = root.MJ.Tiles;
    Shanten = root.MJ.Shanten;
    HandInfo = root.MJ.HandInfo;
    Decomposition = root.MJ.Decomposition;
    Melds = root.MJ.Melds;
    Yaku = root.MJ.Yaku;
    Scoring = root.MJ.Scoring;
    Furiten = root.MJ.Furiten;
    Safety = root.MJ.Safety;
    YakuReadings = root.MJ.YakuReadings;
    Defense = root.MJ.Defense;
    Reading = root.MJ.Reading;
  }

  // ==================================================
  // 初心者向けの読み方(カタカナ)辞書
  // ==================================================

  /**
   * 漢字だけでは読めない麻雀用語に、カタカナの読みを併記するための辞書。
   * 表示専用。ルール判定には一切影響しない。
   */
  const TERM_READINGS = {
    立直: 'リーチ',
    門前清自摸和: 'メンゼンツモ',
    断么九: 'タンヤオ',
    平和: 'ピンフ',
    役牌: 'ヤクハイ',
    一盃口: 'イーペーコー',
    七対子: 'チートイツ',
    対々和: 'トイトイ',
    混一色: 'ホンイツ',
    清一色: 'チンイツ',
    混老頭: 'ホンロートー',
    三色同順: 'サンショクドウジュン',
    一気通貫: 'イッキツウカン',
    両面待ち: 'リャンメンマチ',
    嵌張待ち: 'カンチャンマチ',
    辺張待ち: 'ペンチャンマチ',
    双碰待ち: 'シャンポンマチ',
    単騎待ち: 'タンキマチ',
    現物: 'ゲンブツ',
    河: 'カワ',
    門前: 'メンゼン',
    翻: 'ハン',
    符: 'フ',
    副露: 'フーロ',
    聴牌: 'テンパイ',
    振聴: 'フリテン',
    雀頭: 'ジャントウ',
    面子: 'メンツ',
    順子: 'シュンツ',
    刻子: 'コーツ',
    対子: 'トイツ',
    場風: 'バカゼ',
    自風: 'ジカゼ',
    么九牌: 'ヤオチューハイ',
    和了: 'ホーラ',
  };

  /** 「立直」→「立直(リーチ)」。辞書に無ければそのまま返す。 */
  function withReading(term) {
    const reading = TERM_READINGS[term];
    return reading ? term + '(' + reading + ')' : term;
  }

  // ==================================================
  // 役のメタ情報(門前限定か・鳴くと何翻下がるか)
  // ==================================================

  /**
   * 役の性質。食い下がり幅は scoring.js の KUISAGARI(いずれも1翻減)に合わせている。
   * naki: 'menzen-only'(鳴くと不成立) | 'kuisagari'(鳴くと翻が下がる) | 'same'(鳴いても同じ)
   */
  const YAKU_META = {
    riichi: { name: '立直', reading: 'リーチ', han: 1, naki: 'menzen-only' },
    ippatsu: { name: '一発', reading: 'イッパツ', han: 1, naki: 'menzen-only' },
    menzen_tsumo: { name: '門前清自摸和', reading: 'メンゼンツモ', han: 1, naki: 'menzen-only' },
    pinfu: { name: '平和', reading: 'ピンフ', han: 1, naki: 'menzen-only' },
    iipeikou: { name: '一盃口', reading: 'イーペーコー', han: 1, naki: 'menzen-only' },
    ryanpeikou: { name: '二盃口', reading: 'リャンペーコー', han: 3, naki: 'menzen-only' },
    chiitoitsu: { name: '七対子', reading: 'チートイツ', han: 2, naki: 'menzen-only' },
    tanyao: { name: '断么九', reading: 'タンヤオ', han: 1, naki: 'same' },
    toitoi: { name: '対々和', reading: 'トイトイ', han: 2, naki: 'same' },
    sanankou: { name: '三暗刻', reading: 'サンアンコー', han: 2, naki: 'same' },
    honroutou: { name: '混老頭', reading: 'ホンロートー', han: 2, naki: 'same' },
    shousangen: { name: '小三元', reading: 'ショウサンゲン', han: 2, naki: 'same' },
    honitsu: { name: '混一色', reading: 'ホンイツ', han: 3, naki: 'kuisagari' },
    chinitsu: { name: '清一色', reading: 'チンイツ', han: 6, naki: 'kuisagari' },
    sanshoku_doujun: { name: '三色同順', reading: 'サンショクドウジュン', han: 2, naki: 'kuisagari' },
    ittsu: { name: '一気通貫', reading: 'イッキツウカン', han: 2, naki: 'kuisagari' },
    chanta: { name: '混全帯幺九', reading: 'チャンタ', han: 2, naki: 'kuisagari' },
    junchan: { name: '純全帯幺九', reading: 'ジュンチャン', han: 3, naki: 'kuisagari' },
    yakuhai: { name: '役牌', reading: 'ヤクハイ', han: 1, naki: 'same' },
  };

  /** yaku.js の key(yakuhai_東 などを含む)から表示用メタを引く。 */
  function metaForYakuKey(key) {
    if (!key) return null;
    if (YAKU_META[key]) return YAKU_META[key];
    if (key.indexOf('yakuhai') === 0) return YAKU_META.yakuhai;
    return null;
  }

  /** 役キーの表示名(読み付き)。yakureadings.js の辞書も併用する。 */
  function yakuDisplayName(key, fallbackName) {
    const meta = metaForYakuKey(key);
    if (meta && key.indexOf('yakuhai') !== 0) return meta.name + '(' + meta.reading + ')';
    return YakuReadings.displayNameWithReading(fallbackName || (meta ? meta.name : key), key);
  }

  // ==================================================
  // 盤面(board)の正規化
  // ==================================================

  /**
   * 問題データの board を、判定しやすい形に正規化する。
   *
   * board の入力形式:
   *  - hand: 手の中の牌(牌インデックス配列)。和了牌は含めない。
   *  - winTile: ツモ牌/ロン牌(役クイズ・フリテンクイズで使用)
   *  - isTsumo: true=ツモ, false=ロン
   *  - fuuro: melds.js形式の副露一覧([{type,tiles,concealed}])
   *  - roundWind / seatWind: 牌インデックス(27=東)
   *  - doraIndicators: ドラ表示牌の配列
   *  - isRiichi / furitenTemporary / furitenRiichi: 自分の状態
   *  - ownDiscards: 自分の河(牌インデックス配列)。players を使う場合は省略可。
   *  - players: [{seat,label,isSelf,riichi,riichiIndex,discards:[牌 or {tile,aka}]}]
   *  - targetSeat: 現物クイズで「誰に対して」を指定する席
   */
  function normalizeBoard(rawBoard) {
    const board = Object.assign({}, rawBoard);
    board.hand = (rawBoard.hand || []).slice().sort((a, b) => a - b);
    board.fuuro = (rawBoard.fuuro || []).map((m) => Object.assign({}, m, { tiles: m.tiles.slice() }));
    board.doraIndicators = (rawBoard.doraIndicators || []).slice();
    board.roundWind = rawBoard.roundWind === undefined ? 27 : rawBoard.roundWind;
    board.seatWind = rawBoard.seatWind === undefined ? 27 : rawBoard.seatWind;
    board.isTsumo = !!rawBoard.isTsumo;
    board.isRiichi = !!rawBoard.isRiichi;
    board.players = buildPlayers(rawBoard);
    const self = board.players.find((p) => p.isSelf);
    board.ownDiscards = self ? self.discards.map((d) => d.tile) : (rawBoard.ownDiscards || []).slice();
    return board;
  }

  /**
   * players 定義(または ownDiscards)から、safety.js / furiten.js が期待する
   * プレイヤーオブジェクトを組み立てる。
   *
   * turnIndex(全員の捨て牌を通した順番)は、
   *   turnIndex = 河の何番目か * 4 + 席順
   * として決定論的に割り当てる。これにより
   * 「リーチ宣言より後に場に出て、ロンされずに通った牌」を
   * 本番と同じ基準(safety.js)で現物として扱える。
   */
  function buildPlayers(rawBoard) {
    const specs = rawBoard.players
      ? rawBoard.players.slice()
      : [{ seat: 0, label: '自分', isSelf: true, discards: rawBoard.ownDiscards || [] }];

    return specs.map((spec, seatOrder) => {
      const discards = (spec.discards || []).map((d, i) => {
        const entry = typeof d === 'number' ? { tile: d } : Object.assign({}, d);
        entry.turnIndex = i * 4 + seatOrder;
        entry.isRiichiDeclare = spec.riichiIndex === i;
        entry.calledBy = entry.calledBy === undefined ? null : entry.calledBy;
        return entry;
      });
      return {
        seat: spec.seat === undefined ? seatOrder : spec.seat,
        seatOrder,
        label: spec.label || (spec.isSelf ? '自分' : '他家'),
        isSelf: !!spec.isSelf,
        riichi: !!spec.riichi,
        riichiIndex: spec.riichiIndex === undefined ? -1 : spec.riichiIndex,
        riichiDeclaredAtTurnIndex: spec.riichiIndex === undefined ? -1 : spec.riichiIndex * 4 + seatOrder,
        // 相手の副露(V1.9で追加)。鳴いた面子は全員から見えているため公開情報として扱う。
        melds: (spec.melds || []).map((m) => Object.assign({}, m, { tiles: m.tiles.slice() })),
        discards,
        furitenTemporary: !!rawBoard.furitenTemporary && !!spec.isSelf,
        furitenRiichi: !!rawBoard.furitenRiichi && !!spec.isSelf,
      };
    });
  }

  /** 手の中に残っている牌の枚数配列(副露は含まない) */
  function concealedCounts(board, includeWinTile) {
    const counts = Tiles.toCounts(board.hand);
    if (includeWinTile && board.winTile !== undefined && board.winTile !== null) counts[board.winTile]++;
    return counts;
  }

  /** 手牌全体(副露込み)の枚数配列 */
  function fullCounts(board, includeWinTile) {
    return Melds.fullHandCounts(concealedCounts(board, includeWinTile), board.fuuro);
  }

  /**
   * 画面上に見えている牌すべての枚数配列。
   * 残り枚数(「あと何枚残っているか」)の計算に使う。
   * = 自分の手牌 + 副露 + 全員の河 + ドラ表示牌 (+ 表示中の和了牌)
   */
  function visibleCounts(board, includeWinTile) {
    const counts = fullCounts(board, includeWinTile);
    board.players.forEach((p) => {
      p.discards.forEach((d) => {
        counts[d.tile]++;
      });
      // 相手が鳴いた面子も場に見えている
      (p.melds || []).forEach((m) => m.tiles.forEach((t) => counts[t]++));
    });
    board.doraIndicators.forEach((t) => {
      counts[t]++;
    });
    return counts;
  }

  // ==================================================
  // 待ち牌の計算
  // ==================================================

  const WAIT_LABEL = {
    ryanmen: '両面待ち(リャンメンマチ)',
    kanchan: '嵌張待ち(カンチャンマチ)',
    penchan: '辺張待ち(ペンチャンマチ)',
    shanpon: '双碰待ち(シャンポンマチ)',
    tanki: '単騎待ち(タンキマチ)',
    chiitoitsu: '七対子の単騎待ち(チートイツのタンキマチ)',
  };

  /**
   * 13枚(+副露)の手牌に対する待ち牌を求める。
   * 定義: その牌を1枚加えると4面子1雀頭または七対子などの和了形が完成する牌。
   * 役の有無・フリテンは考慮しない(形としての待ち)。
   * @param {number[]} counts13 手の中の牌の枚数配列
   * @param {number} lockedMelds 副露で確定している面子数
   * @returns {number[]} 待ち牌(牌インデックス、昇順)
   */
  function computeWinningTiles(counts13, lockedMelds) {
    lockedMelds = lockedMelds || 0;
    const result = [];
    for (let i = 0; i < Tiles.TILE_COUNT; i++) {
      if (counts13[i] >= 4) continue; // 5枚目は存在しないので待ちにならない
      const next = counts13.slice();
      next[i]++;
      if (Shanten.calcShanten(next, lockedMelds).shanten === -1) result.push(i);
    }
    return result;
  }

  /**
   * 1つの待ち牌について、その牌で完成する部分(面子・雀頭)と待ちの種類を求める。
   * 複数の解釈があり得る場合はすべて返す。
   * @returns {{types:string[], labels:string[], blocks:Array<number[]>}}
   */
  function waitDetailForTile(counts13, tile, lockedMelds) {
    lockedMelds = lockedMelds || 0;
    const counts14 = counts13.slice();
    counts14[tile]++;
    const types = new Set();
    const blocks = [];

    // 七対子として和了できるか(副露があれば七対子にはならない)
    if (lockedMelds === 0 && Shanten.chiitoitsuShanten(counts14) === -1) {
      types.add('chiitoitsu');
      blocks.push([tile, tile]);
    }

    const decomps = Decomposition.enumerateWinningDecompositions(counts14, 4 - lockedMelds);
    for (const decomp of decomps) {
      const variants = Decomposition.enumerateVariants(decomp, tile, true);
      for (const v of variants) {
        if (v.waitType) types.add(v.waitType);
        // completedBlock は 'pair' か melds のインデックス
        if (v.completedBlock === 'pair') blocks.push([v.pair.tile, v.pair.tile]);
        else if (typeof v.completedBlock === 'number') blocks.push(v.melds[v.completedBlock].tiles.slice());
      }
    }

    const labels = [...types].map((t) => WAIT_LABEL[t] || t);
    return { types: [...types], labels, blocks };
  }

  /**
   * 待ち全体を1行で表す名前を作る。
   * 複合形(例: 34索+55索)は「単騎待ち」など1つの読み方に断定できないため、
   * 待ち牌ごとの形をすべて集めてから、1種類のときだけ形の名前を断定する。
   * (handinfo.js の classifyWait が返すラベルは「分解の一例」であり、
   *  初心者向けの見出しとしてそのまま断定表示すると誤解を招くため)
   */
  function summarizeWaitShape(details) {
    const types = new Set();
    details.forEach((d) => d.waitTypes.forEach((t) => types.add(t)));
    if (types.size === 0) return null;
    if (types.size === 1) return WAIT_LABEL[[...types][0]];
    const labels = [...types].map((t) => WAIT_LABEL[t] || t).join('・');
    const head = details.length >= 3 ? '多面待ち(タメンマチ)' : '複数の読み方ができる形';
    return head + ' … ' + labels + ' が重なっています';
  }

  /**
   * 待ち全体の情報(表示・解説用)。
   * @returns {{
   *   tiles: Array<{tile:number,label:string,remaining:number,waitTypes:string[],waitLabels:string[],blocks:Array}>,
   *   kinds:number, totalRemaining:number, shapeLabel:?string, valid:boolean
   * }}
   */
  function analyzeWaits(board) {
    const counts13 = concealedCounts(board, false);
    const lockedMelds = board.fuuro.length;
    const tiles = computeWinningTiles(counts13, lockedMelds);
    const visible = visibleCounts(board, false);

    const details = tiles.map((tile) => {
      const d = waitDetailForTile(counts13, tile, lockedMelds);
      return {
        tile,
        label: Tiles.shortLabel(tile),
        remaining: Math.max(0, 4 - visible[tile]),
        waitTypes: d.types,
        waitLabels: d.labels,
        blocks: d.blocks,
      };
    });

    let shapeLabel = null;
    if (lockedMelds === 0) {
      const classified = HandInfo.classifyWait(counts13);
      if (classified) shapeLabel = classified.shapeLabel;
    }

    return {
      tiles: details,
      kinds: details.length,
      totalRemaining: details.reduce((s, d) => s + d.remaining, 0),
      shapeLabel,
      shapeSummary: summarizeWaitShape(details),
      valid: details.length > 0,
    };
  }

  // ==================================================
  // 役・点数の判定(既存の scoring.js をそのまま利用)
  // ==================================================

  function scoringContext(board, isTsumo) {
    return {
      winningTile: board.winTile,
      isTsumo: isTsumo === undefined ? board.isTsumo : isTsumo,
      isRiichi: !!board.isRiichi,
      isDoubleRiichi: false,
      isIppatsu: false,
      isHaitei: false,
      isHoutei: false,
      isRinshan: false,
      isChankan: false,
      isDealer: board.seatWind === 27,
      seatWind: board.seatWind,
      roundWind: board.roundWind,
    };
  }

  function doraSetting(board) {
    return { indicatorTiles: board.doraIndicators, aka: board.aka || { m: 0, p: 0, s: 0 } };
  }

  /**
   * 和了形の役・翻を判定する。役が1つも無ければ hasYaku:false。
   * @returns {{complete:boolean, hasYaku:boolean, yakuKeys:string[], yakuList:Array,
   *            han:number, fu:?number, score:?object, doraTotal:number, isMenzen:boolean}}
   */
  function analyzeYaku(board, isTsumoOverride) {
    const counts14 = concealedCounts(board, true);
    const ctx = scoringContext(board, isTsumoOverride);
    const result = Scoring.scoreHand(counts14, ctx, null, doraSetting(board), board.fuuro);
    const isMenzen = board.fuuro.every((m) => m.concealed === true);

    if (!result.complete) {
      return { complete: false, hasYaku: false, yakuKeys: [], yakuList: [], han: 0, fu: null, score: null, doraTotal: 0, isMenzen };
    }
    const best = result.best || {};
    const yakuList = best.yakuList || [];
    // ドラ・赤ドラ・裏ドラは「役」ではないため、役キー一覧からは除外する
    const yakuKeys = yakuList.map((y) => y.key).filter((k) => k !== 'dora' && k !== 'aka_dora' && k !== 'ura_dora');
    return {
      complete: true,
      hasYaku: !!result.hasYaku,
      yakuKeys,
      yakuList,
      han: best.han || 0,
      fu: best.fu === undefined ? null : best.fu,
      score: best.score || null,
      doraTotal: (result.doraInfo && result.doraInfo.total) || 0,
      isMenzen,
    };
  }

  /** ある牌がこの場況で役牌になるか(yaku.js の判定をそのまま使う) */
  function isYakuhaiTile(tile, count, board) {
    if (count < 3) return false;
    const meld = { type: 'triplet', tiles: [tile, tile, tile] };
    const r = Yaku.isYakuhaiTriplet(meld, { roundWind: board.roundWind, seatWind: board.seatWind });
    return !!(r && r.length > 0);
  }

  // ==================================================
  // フリテン判定
  // ==================================================

  function ronReasonText(reason, furiten) {
    switch (reason) {
      case 'none':
        return '振聴(フリテン)でもなく役もあるため、通常どおりロンできます。';
      case 'not-wait':
        return 'この牌は待ち牌ではないため、そもそも和了(ホーラ)の形になりません。';
      case 'no-yaku':
        return '待ち牌ではありますが、役が1つも無いためロンできません(役なし)。ドラは役ではないので、ドラだけではアガれません。';
      case 'furiten-and-no-yaku':
        return (furiten.beginnerMessage || '') + ' さらに、この手には役が1つも無いため、いずれにせよロンはできません。';
      case 'furiten':
      default:
        return furiten.beginnerMessage || '振聴(フリテン)のためロンできません。';
    }
  }

  /**
   * 自分がロン/ツモできるかを、待ち・フリテン・役の3点から判定する。
   *
   * ルールの要点(誤実装しやすい箇所):
   *  - 複数待ちの場合、待ち牌が1種類でも自分の河にあれば、
   *    「待ち牌すべて」でロンできない。ただしツモは可能。
   *  - 同巡内フリテン・リーチ後の見逃しフリテンは、河とは別の状態として扱う。
   *  - フリテンでなくても、役が1つも無ければロンできない(役なし)。
   */
  function analyzeFuriten(board) {
    const waits = analyzeWaits(board);
    const waitTiles = waits.tiles.map((t) => t.tile);
    const selfPlayer = board.players.find((p) => p.isSelf) || { discards: (board.ownDiscards || []).map((t) => ({ tile: t })) };
    const player = {
      discards: selfPlayer.discards,
      furitenTemporary: !!board.furitenTemporary,
      furitenRiichi: !!board.furitenRiichi,
    };
    const furiten = Furiten.getFuritenState(player, waitTiles);

    const winTileIsWait = board.winTile !== undefined && board.winTile !== null && waitTiles.indexOf(board.winTile) !== -1;
    const emptyYaku = { hasYaku: false, yakuKeys: [], yakuList: [], han: 0 };
    const ronYaku = winTileIsWait ? analyzeYaku(board, false) : emptyYaku;
    const tsumoYaku = winTileIsWait ? analyzeYaku(board, true) : emptyYaku;

    let ronBlockReason = 'none';
    if (!winTileIsWait) ronBlockReason = 'not-wait';
    else if (!furiten.canRon && !ronYaku.hasYaku) ronBlockReason = 'furiten-and-no-yaku';
    else if (!furiten.canRon) ronBlockReason = 'furiten';
    else if (!ronYaku.hasYaku) ronBlockReason = 'no-yaku';

    return {
      waitTiles,
      waitDetails: waits.tiles,
      shapeLabel: waits.shapeLabel,
      furiten,
      isFuriten: furiten.type !== 'none',
      furitenType: furiten.type,
      blockingOwnDiscards: furiten.blockingOwnDiscards,
      winTileIsWait,
      ronYaku,
      tsumoYaku,
      canRon: ronBlockReason === 'none',
      canTsumo: winTileIsWait && tsumoYaku.hasYaku,
      ronBlockReason,
      reasonText: ronReasonText(ronBlockReason, furiten),
    };
  }

  // ==================================================
  // 現物(ゲンブツ)判定
  // ==================================================

  /** その牌が「どの河の、どの牌」と一致して現物になっているのかを探す(解説表示用) */
  function findGenbutsuSource(tile, target, allPlayers) {
    const ownIndex = target.discards.findIndex((d) => d.tile === tile);
    if (ownIndex >= 0) {
      return {
        kind: 'target-river',
        playerLabel: target.label,
        position: ownIndex + 1,
        afterRiichi: target.riichiIndex >= 0 && ownIndex > target.riichiIndex,
        text:
          target.label + 'の河(カワ)の' + (ownIndex + 1) + '枚目にある' + Tiles.shortLabel(tile) + 'と同じ牌です。' +
          target.label + '自身が捨てた牌なので、' + target.label + 'はこの牌でロンできません(振聴)。',
      };
    }
    for (const p of allPlayers) {
      for (let i = 0; i < p.discards.length; i++) {
        const d = p.discards[i];
        if (d.tile === tile && target.riichiDeclaredAtTurnIndex >= 0 && d.turnIndex > target.riichiDeclaredAtTurnIndex) {
          return {
            kind: 'passed-after-riichi',
            playerLabel: p.label,
            position: i + 1,
            afterRiichi: true,
            text:
              target.label + 'の立直(リーチ)宣言より後に' + p.label + 'が捨てた' + Tiles.shortLabel(tile) +
              'が、ロンされずに通っています。一度見逃した牌ではロンできない(振聴)ため、この牌も安全です。',
          };
        }
      }
    }
    return null;
  }

  /**
   * 指定した相手(リーチ者)に対する現物を判定する。
   * 判定基準は本番の safety.js(computeGenbutsuSet)に完全に委ねる:
   *   - その相手自身が捨てた牌
   *   - その相手のリーチ宣言より後に場に出て、ロンされずに通った牌
   * 「赤5と通常の5は同じ牌種」である点は、牌を34種のインデックスで扱っているため
   * 自動的に満たされる(赤かどうかは表示用の flag に過ぎない)。
   */
  function analyzeGenbutsu(board, candidateTiles) {
    const target = board.players.find((p) => p.seat === board.targetSeat);
    if (!target) throw new Error('targetSeat に対応するプレイヤーがいません: ' + board.targetSeat);
    const safeSet = Safety.computeGenbutsuSet(target, board.players);

    const otherRiichi = board.players.filter((p) => p.riichi && p.seat !== target.seat);
    const otherSafeSets = otherRiichi.map((p) => ({ player: p, set: Safety.computeGenbutsuSet(p, board.players) }));

    const candidates = (candidateTiles || []).map((c) => {
      const tile = typeof c === 'number' ? c : c.tile;
      const aka = typeof c === 'number' ? false : !!c.aka;
      const isGenbutsu = safeSet.has(tile);
      return {
        tile,
        label: Tiles.shortLabel(tile),
        aka,
        isGenbutsu,
        matchedFrom: isGenbutsu ? findGenbutsuSource(tile, target, board.players) : null,
        alsoSafeAgainst: otherSafeSets.filter((o) => o.set.has(tile)).map((o) => o.player.label),
        dangerAgainst: otherSafeSets.filter((o) => !o.set.has(tile)).map((o) => o.player.label),
      };
    });

    return {
      targetLabel: target.label,
      targetSeat: target.seat,
      safeTiles: [...safeSet].sort((a, b) => a - b),
      candidates,
      otherRiichiLabels: otherRiichi.map((p) => p.label),
    };
  }

  // ==================================================
  // 守備判断(V1.8)
  // ==================================================

  /**
   * 守備判断クイズの盤面を defense.js に渡して、候補牌ごとの安全度を評価する。
   * 「どの牌が安全か」の判断そのものは defense.js が持ち、ここでは
   * クイズの盤面(自分の手牌・全員の河・ドラ表示牌)から見えている牌を組み立てるだけ。
   * @param {object} board normalizeBoard 済みの盤面
   * @param {Array<number|{tile:number,aka:boolean}>} [candidates] 省略時は board.candidates
   */
  function analyzeDefense(board, candidates) {
    const ctx = Defense.buildContext({
      players: board.players,
      targetSeat: board.targetSeat,
      visibleCounts: visibleCounts(board, false),
      doraIndicators: board.doraIndicators,
      roundWind: board.roundWind,
      seatWind: board.seatWind,
    });
    const result = Defense.evaluateCandidates(candidates || board.candidates || [], ctx);
    result.context = ctx;
    result.targetLabel = ctx.targetLabel;
    return result;
  }

  /** 守備判断クイズの候補牌(問題データの candidates)を取り出す */
  function defenseCandidates(question) {
    return (question && question.candidates) || [];
  }

  // ==================================================
  // 相手の待ち読み(V1.9)
  // ==================================================

  /**
   * 公開情報だけの盤面を作って reading.js へ渡す。
   * 伏せられた相手の手牌(question.hidden)はここに入れない。
   * これにより「推理の計算に隠し情報が混ざらない」ことを構造的に保証する。
   */
  function publicBoard(board) {
    const view = normalizeBoard(board);
    view.visibleCounts = visibleCounts(view, false);
    return view;
  }

  /**
   * 相手の実際の待ちを計算する(答え合わせ専用)。
   * 隠し手牌を使うため、推理側の処理からは絶対に呼ばないこと。
   * @param {{hand:number[], melds:Array}} hidden
   */
  function hiddenWaits(hidden) {
    const counts = Tiles.toCounts(hidden.hand);
    return computeWinningTiles(counts, (hidden.melds || []).length);
  }

  /** 河・鳴きから読み取れる手掛かり(表示用)。公開情報だけを渡す。 */
  function readingClues(board) {
    const view = Object.assign({}, board, { visibleCounts: visibleCounts(board, false) });
    return Reading.riverClues(view);
  }

  /** 相手の待ちの形(両面・嵌張など)を、答え合わせ表示用にまとめる */
  function hiddenWaitDetails(hidden) {
    const counts = Tiles.toCounts(hidden.hand);
    const lockedMelds = (hidden.melds || []).length;
    return hiddenWaits(hidden).map((tile) => {
      const d = waitDetailForTile(counts, tile, lockedMelds);
      return { tile, label: Tiles.shortLabel(tile), waitTypes: d.types, waitLabels: d.labels, blocks: d.blocks };
    });
  }

  /**
   * 問題の採点モード(V1.9.1)。データに書かれた値をそのまま使う。
   * 書き忘れがあれば分かるように、未知の値は例外にする。
   */
  function scoringOf(question) {
    const scoring = question.scoring;
    if (!scoring) throw new Error('採点モード(scoring)が設定されていません: ' + question.id);
    if (Reading.SCORING_KEYS.indexOf(scoring) === -1) throw new Error('未知の採点モード: ' + scoring + ' (' + question.id + ')');
    return scoring;
  }

  /**
   * 2人リーチなど、リーチ者が複数いる局面で「誰を読む問題なのか」をはっきりさせる。
   * 表示用の文言をここで組み立て、画面とテストで同じものを使う。
   */
  function readingFocus(question) {
    const board = normalizeBoard(question.board);
    const riichiPlayers = board.players.filter((p) => p.riichi);
    const target = board.players.find((p) => p.seat === board.targetSeat);
    const targetLabel = target ? target.label : '相手';
    const others = riichiPlayers.filter((p) => p.seat !== board.targetSeat).map((p) => p.label);
    const scoring = scoringOf(question);
    // 公開する手牌は、読む相手と違うことがある(相手の手牌を作っていない局面)
    const hiddenSeat = question.hidden && question.hidden.seat !== undefined ? question.hidden.seat : board.targetSeat;
    const hiddenOwner = board.players.find((p) => p.seat === hiddenSeat);
    const hiddenLabel = hiddenOwner ? hiddenOwner.label : targetLabel;
    const lines = [
      '推理評価の対象: ' + targetLabel + 'に対する読みだけを採点します。',
      '現物(ゲンブツ)・筋(スジ)の判定対象: ' + targetLabel + 'の河だけで判定します。',
      '回答後に公開する手牌: ' + hiddenLabel + 'の手牌です。',
      Reading.isWaitScored(scoring)
        ? '待ち的中の判定対象: ' + targetLabel + 'の待ちだけです。'
        : '待ち的中: この問題では採点しません(' + hiddenLabel + 'の実際の待ちは参考として表示します)。',
    ];
    if (others.length > 0) {
      lines.push(others.join('・') + 'の手牌と待ちは、この問題では扱いません(2人全員の待ちを当てる問題ではありません)。');
    }
    return {
      multiRiichi: riichiPlayers.length >= 2,
      targetSeat: board.targetSeat,
      targetLabel,
      otherRiichiLabels: others,
      headline: '今回読む相手: ' + targetLabel,
      lines,
    };
  }

  /**
   * 待ち読み問題の採点。推理評価と待ち的中を分けて返す。
   *  - 推理評価は公開情報だけ(reading.gradeReasoning)
   *  - 待ち的中だけが実際の待ち(question.hidden)を参照する
   *  - 採点モードが reasoning-only の問題では、待ち的中を採点しない(hit は null)
   * クイズ全体の正誤(correct)は「推理として妥当だったか(◎か○)」で決める。
   * 待ちが外れても、公開情報の使い方が妥当なら不正解にはしない。
   */
  function gradeReadingQuestion(question, selectedIds) {
    const board = publicBoard(question.board);
    const choiceById = {};
    question.choices.forEach((c) => (choiceById[c.id] = c));
    const selectedTiles = (selectedIds || []).map((id) => choiceById[id]).filter(Boolean).map((c) => c.value);
    const candidates = (question.candidates || []).map((c) => (typeof c === 'number' ? c : c.tile));
    const count = question.selectCount || 3;

    const scoring = scoringOf(question);
    const reasoning = Reading.gradeReasoning(board, candidates, selectedTiles, count);
    // 実際の待ちは、採点しない問題でも「答え合わせの参考」として表示するため計算しておく
    const actualWaits = hiddenWaits(question.hidden);
    const hit = Reading.gradeHit(scoring, selectedTiles, actualWaits);

    const correctIds = question.choices.filter((c) => reasoning.reasonableTiles.indexOf(c.value) !== -1).map((c) => c.id);
    return {
      correct: reasoning.gradeKey === 'excellent' || reasoning.gradeKey === 'good',
      correctIds,
      selectedIds: (selectedIds || []).slice(),
      resolved: reasoning.reasonableTiles,
      scoring,
      waitScored: Reading.isWaitScored(scoring),
      scoringNote: Reading.scoringNote(scoring),
      reasoning,
      hit,
      actualWaits,
    };
  }

  // ==================================================
  // resolver: 問題の正解を本番ロジックから計算する
  // ==================================================

  const RESOLVERS = {
    /** 成立している役キーの集合 */
    yakuKeys: (board) => new Set(analyzeYaku(board).yakuKeys),
    /** ドラ込みの合計翻数 */
    hanTotal: (board) => analyzeYaku(board).han,
    /** 役が1つでもあるか */
    hasYaku: (board) => analyzeYaku(board).hasYaku,
    /** 指定牌がこの場況で役牌になるか */
    isYakuhai: (board, args) => isYakuhaiTile(args.tile, fullCounts(board, true)[args.tile], board),
    /** 鳴いたときの影響(門前限定/食い下がり/変わらない) */
    nakiEffect: (board, args) => {
      const meta = metaForYakuKey(args.yakuKey);
      if (!meta) throw new Error('未知の役キー: ' + args.yakuKey);
      return meta.naki;
    },
    /** 待ち牌(形として和了形が完成する牌)の集合 */
    waitTiles: (board) => new Set(analyzeWaits(board).tiles.map((t) => t.tile)),
    /** 待ちの種類の数(何種類待ちか) */
    waitKinds: (board) => analyzeWaits(board).kinds,
    /** 見えている牌を除いた、待ち牌の残り合計枚数 */
    waitRemaining: (board) => analyzeWaits(board).totalRemaining,
    /** 待ちの形の名前(単一の形のときのみ。複合形では null) */
    waitShape: (board) => {
      const w = analyzeWaits(board);
      const types = new Set();
      w.tiles.forEach((t) => t.waitTypes.forEach((x) => types.add(x)));
      return types.size === 1 ? [...types][0] : null;
    },
    /** この牌でロンできるか */
    canRon: (board) => analyzeFuriten(board).canRon,
    /** この牌をツモした場合にアガれるか */
    canTsumo: (board) => analyzeFuriten(board).canTsumo,
    /** 今フリテンかどうか */
    isFuriten: (board) => analyzeFuriten(board).isFuriten,
    /** ロンできない理由 */
    ronBlockReason: (board) => analyzeFuriten(board).ronBlockReason,
    /** 対象のリーチ者に対する現物の集合 */
    genbutsuTiles: (board, args) => {
      const cands = (args && args.candidates) || [];
      const result = analyzeGenbutsu(board, cands);
      return new Set(result.candidates.filter((c) => c.isGenbutsu).map((c) => c.tile));
    },

    // ---- 守備判断クイズ(V1.8) ----
    /** 最も安全と考えられる牌の集合(同評価が複数ならすべて) */
    safestTiles: (board, args) => new Set(analyzeDefense(board, args && args.candidates).safestTiles),
    /** 最も警戒したい牌の集合(同評価が複数ならすべて) */
    mostDangerousTiles: (board, args) => new Set(analyzeDefense(board, args && args.candidates).mostDangerousTiles),
    /** 指定した牌の安全度ランク(S〜E) */
    safetyRank: (board, args) => {
      const result = analyzeDefense(board, args && args.candidates);
      return result.rankOf[args.tile];
    },
    /** 指定した牌の初心者向け4分類(現物/比較的安全/判断が必要/危険寄り) */
    safetyCategory: (board, args) => {
      const result = analyzeDefense(board, args && args.candidates);
      return Defense.categoryOf(result.rankOf[args.tile]);
    },
    /**
     * 安全な順の並べ替え用。牌 → 同順位グループ番号(0が最も安全)を返す。
     * 採点は gradeQuestion 側で「グループ番号が増える順に並んでいるか」を見る。
     */
    safetyOrder: (board, args) => analyzeDefense(board, args && args.candidates).groupIndexOf,
    // ---- 相手の待ち読み(V1.9) ----
    /** 公開情報から見て「警戒するのが妥当」な牌の集合 */
    readingTargets: (board, args) => {
      const view = Object.assign({}, board, { visibleCounts: visibleCounts(board, false) });
      const cands = (args && args.candidates) || [];
      return new Set(Reading.reasonableTargets(view, cands, (args && args.selectCount) || 3).tiles);
    },
    /** 河・副露から読み取れる説明のうち、正しいものの集合 */
    readingStatements: (board, args) => {
      const view = Object.assign({}, board, { visibleCounts: visibleCounts(board, false) });
      const statements = (args && args.statements) || [];
      const trueValues = statements.filter((s) => Reading.evaluateStatement(view, s.statement)).map((s) => s.value);
      return new Set(trueValues);
    },

    /** 指定した牌に当てはまる「安全と考えられる理由」のキー集合 */
    safetyReasonKeys: (board, args) => {
      const result = analyzeDefense(board, args && args.candidates);
      const target = result.candidates.find((c) => c.tile === args.tile);
      if (!target) throw new Error('候補にない牌です: ' + args.tile);
      return new Set(target.safeFactors.map((f) => f.key));
    },
  };

  /** resolver の結果と選択肢の value を突き合わせる */
  function valueMatches(resolved, value) {
    if (resolved instanceof Set) return resolved.has(value);
    if (Array.isArray(resolved)) return resolved.indexOf(value) !== -1;
    return resolved === value;
  }

  /**
   * 1問を採点する。正解は常にここで計算する(問題データの expected は使わない)。
   * @param {object} question
   * @param {string[]} selectedIds ユーザーが選んだ選択肢ID
   * @returns {{correct:boolean, correctIds:string[], selectedIds:string[], resolved:*}}
   */
  /** 候補牌を必要とする resolver には、問題データの candidates を自動で渡す */
  const CANDIDATE_RESOLVERS = [
    'readingTargets',
    'genbutsuTiles',
    'safestTiles',
    'mostDangerousTiles',
    'safetyRank',
    'safetyCategory',
    'safetyOrder',
    'safetyReasonKeys',
  ];

  /**
   * 並べ替え問題(mode:'order')の採点。
   * resolved は「牌 → 同順位グループ番号(0が最も安全)」。
   * グループ番号が増える順に並んでいれば正解とする。
   * 同順位の牌は入れ替えても正解になる(材料が同程度なら順位を強制しないため)。
   */
  function gradeOrder(question, selectedIds, resolved) {
    const choiceById = {};
    question.choices.forEach((c) => (choiceById[c.id] = c));
    const selected = (selectedIds || []).slice();

    // 全部の候補を並べ切っていなければ不正解(未回答扱い)
    const complete = selected.length === question.choices.length;
    let ordered = complete;
    if (complete) {
      for (let i = 1; i < selected.length; i++) {
        const prev = resolved[choiceById[selected[i - 1]].value];
        const cur = resolved[choiceById[selected[i]].value];
        if (prev === undefined || cur === undefined || prev > cur) {
          ordered = false;
          break;
        }
      }
    }

    // 表示用の模範解答(同順位はデータ上の並び順のまま)
    const canonical = question.choices
      .slice()
      .sort((a, b) => resolved[a.value] - resolved[b.value])
      .map((c) => c.id);

    return { correct: ordered, correctIds: canonical };
  }

  function gradeQuestion(question, selectedIds) {
    // 待ち読み問題は「推理評価」と「待ち的中」を分けて採点する
    if (question.mode === 'reading') return gradeReadingQuestion(question, selectedIds);

    const board = normalizeBoard(question.board);
    const resolver = RESOLVERS[question.resolver];
    if (!resolver) throw new Error('未知のresolver: ' + question.resolver);
    const args = Object.assign({}, question.resolverArgs || {});
    if (CANDIDATE_RESOLVERS.indexOf(question.resolver) !== -1 && !args.candidates) {
      args.candidates = question.candidates || [];
    }
    if (question.resolver === 'readingStatements' && !args.statements) {
      args.statements = question.choices.map((c) => ({ value: c.value, statement: c.statement }));
    }
    const resolved = resolver(board, args);

    if (question.mode === 'order') {
      const graded = gradeOrder(question, selectedIds, resolved);
      // 並べ替えは順番に意味があるため、selectedIds はソートせずそのまま保持する
      return { correct: graded.correct, correctIds: graded.correctIds, selectedIds: (selectedIds || []).slice(), resolved };
    }

    const correctIds = question.choices.filter((c) => valueMatches(resolved, c.value)).map((c) => c.id);
    const selected = (selectedIds || []).slice().sort();
    const correctSorted = correctIds.slice().sort();
    const correct = selected.length === correctSorted.length && selected.every((id, i) => id === correctSorted[i]);

    const graded = { correct, correctIds, selectedIds: selected, resolved };
    if (question.course === 'reading') {
      // 説明を選ぶ形式は常に reasoning-only(待ち的中は採点しない)
      const scoring = scoringOf(question);
      graded.scoring = scoring;
      graded.waitScored = Reading.isWaitScored(scoring);
      graded.scoringNote = Reading.scoringNote(scoring);
      graded.hit = null;
    }
    return graded;
  }

  const QuizEngine = {
    TERM_READINGS,
    withReading,
    YAKU_META,
    WAIT_LABEL,
    metaForYakuKey,
    yakuDisplayName,
    normalizeBoard,
    concealedCounts,
    fullCounts,
    visibleCounts,
    computeWinningTiles,
    waitDetailForTile,
    summarizeWaitShape,
    analyzeWaits,
    analyzeYaku,
    isYakuhaiTile,
    analyzeFuriten,
    analyzeGenbutsu,
    analyzeDefense,
    defenseCandidates,
    publicBoard,
    readingClues,
    scoringOf,
    readingFocus,
    hiddenWaits,
    hiddenWaitDetails,
    gradeReadingQuestion,
    RESOLVERS,
    gradeQuestion,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = QuizEngine;
  } else {
    root.MJ = root.MJ || {};
    root.MJ.QuizEngine = QuizEngine;
  }
})(typeof window !== 'undefined' ? window : globalThis);
