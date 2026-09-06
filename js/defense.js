/**
 * defense.js
 * 初心者向け「守備判断」のルールベース評価エンジン(V1.8)。
 *
 * ■ このエンジンが何であって、何でないか
 *  - 実際の牌譜統計に基づく放銃率モデルでは「ありません」。
 *    「現物(ゲンブツ)」「筋(スジ)」「壁(カベ)」「ワンチャンス」「字牌の見え枚数」「ドラ」という、
 *    初心者が根拠を説明できる材料だけを組み合わせたルールベースの相対評価です。
 *  - したがって「放銃率○%」のような数値は出しません。S〜Eの段階評価と、
 *    その根拠(安全材料・危険材料)を返します。
 *  - S(ロンされない)以外はすべて「推測」であり、確定的な安全ではありません。
 *
 * ■ 判定の骨格(なぜこの形にしているか)
 *  ある牌Xが順子(シュンツ)の待ちでロンされるには、相手が
 *    下側のターツ {X+1, X+2}  … X と X+3 を待つ形
 *    上側のターツ {X-2, X-1}  … X-3 と X を待つ形
 *  のどちらかを持っている必要があります。この2つの形それぞれについて、
 *    - 筋(スジ): 相手の河に X+3 / X-3 があれば、その形ではロンできない(フリテン)
 *    - 壁(カベ): ターツの構成牌が4枚とも見えていれば、その形は存在し得ない
 *    - ワンチャンス: 構成牌の残りが1枚だけなら、その形は作りにくい(壁より弱い根拠)
 *  と順に確認します。筋も壁も「両面待ちの一部を否定する」という同じ働きをするため、
 *  同じ枠組みで扱うと初心者にも一貫して説明できます。
 *  嵌張(カンチャン)・辺張(ペンチャン)・双碰(シャンポン)・単騎(タンキ)待ちは
 *  この方法では否定できないため、S以外は常に「当たる可能性が残る」と表示します。
 *
 * ■ 字牌(ジハイ)だけの特別ルール
 *  字牌でロンされるには、相手がその字牌を手の中に持っている必要があります
 *  (双碰か単騎しかないため)。よって残り0枚の字牌は理論上ロンされません。
 *  数牌は「持っていない牌」でも両面などで待てるので、この理屈は使えません
 *  (4枚見えの数牌が安全、というのは誤りです)。
 *
 * 表示処理はこのファイルに入れないこと(appquiz.js が結果を描画する)。
 */
(function (root) {
  'use strict';

  let Tiles, Safety, Dora;
  if (typeof module !== 'undefined' && module.exports) {
    Tiles = require('./tiles.js');
    Safety = require('./safety.js');
    Dora = require('./dora.js');
  } else {
    Tiles = root.MJ.Tiles;
    Safety = root.MJ.Safety;
    Dora = root.MJ.Dora;
  }

  // ==================================================
  // 段階評価(ランク)と重み
  // ==================================================

  /**
   * 安全度ランク。S以外は「確率的・相対的な評価」であることを label にも明記する。
   */
  const RANKS = {
    S: { key: 'S', label: 'S(この相手にはロンされない)', short: 'S', certain: true, tone: 'safe' },
    A: { key: 'A', label: 'A(かなり安全寄り)', short: 'A', certain: false, tone: 'safe' },
    B: { key: 'B', label: 'B(比較的安全寄り)', short: 'B', certain: false, tone: 'safe' },
    C: { key: 'C', label: 'C(判断材料が競合)', short: 'C', certain: false, tone: 'neutral' },
    D: { key: 'D', label: 'D(危険寄り)', short: 'D', certain: false, tone: 'danger' },
    E: { key: 'E', label: 'E(かなり危険寄り)', short: 'E', certain: false, tone: 'danger' },
  };

  const RANK_ORDER = ['S', 'A', 'B', 'C', 'D', 'E'];

  /**
   * 評価の重み。ここだけを見れば評価基準が分かるように、1か所へまとめている。
   * 値を変えたい場合はこの表だけを書き換える(判定ロジック側に数値を散らさない)。
   *
   * 注意: 根拠の異なる材料を単純加算しているため、値を大きく動かすと
   * 「筋だけでSになる」など不自然な評価になり得る。下の SCORE_TO_RANK と
   * あわせて、tests/defense-tests.js の保証テストが通ることを必ず確認すること。
   */
  const WEIGHTS = {
    // 順子(シュンツ)の待ちに関する材料
    allRyanmenBlocked: 4, // Xを待てる両面形がすべて否定できる(両スジ・壁など)
    perRyanmenBlocked: 2, // 両面形のうち1つを否定できる(片スジ・片側の壁)
    perRyanmenOneChance: 1, // 両面形のうち1つがワンチャンス(壁より弱い根拠)
    terminalTile: 1, // 1・9は待たれる形がもともと少ない
    middleTile: -1, // 3〜7の中張牌は待ちの種類が多く、無筋なら警戒される

    // 字牌の材料(残り枚数=4-見えている枚数)
    honorRemaining: { 0: 6, 1: 3, 2: 1, 3: 0, 4: 0 },
    honorYakuhai: -1, // 役牌(場風・自風・三元牌)は対子で残されやすい
    honorGuestWind: 1, // 客風(オタ風)は使い道が少なく残されにくい

    // ドラの材料(打点ではなく「手の中に残されやすい=待ちに絡みやすい」ことを表す)
    doraTile: -2,
    doraAdjacent: -1, // ドラの±1(ドラを含む順子になりやすい)
  };

  /** 合計スコア → ランク。S は特別扱い(スコアではなく構造で決まる)。 */
  const SCORE_TO_RANK = [
    { min: 4, rank: 'A' },
    { min: 2, rank: 'B' },
    { min: 0, rank: 'C' },
    { min: -2, rank: 'D' },
    { min: -Infinity, rank: 'E' },
  ];

  function rankForScore(score) {
    const hit = SCORE_TO_RANK.find((r) => score >= r.min);
    return hit ? hit.rank : 'E';
  }

  // ==================================================
  // 判定に使う場の情報(コンテキスト)
  // ==================================================

  /**
   * @param {object} options
   *   players: safety.js が扱う形のプレイヤー配列(discards に turnIndex を持つ)
   *   targetSeat: 評価対象(リーチしている相手)の席
   *   visibleCounts: 見えている牌の枚数配列(自分の手牌・全員の河・副露・ドラ表示牌)
   *   doraIndicators / roundWind / seatWind
   */
  function buildContext(options) {
    const players = options.players || [];
    const target = players.find((p) => p.seat === options.targetSeat) || null;
    if (!target) throw new Error('targetSeat に対応するプレイヤーがいません: ' + options.targetSeat);

    // 現物・筋の基準は必ず「その相手自身の河(+リーチ後に通った牌)」。本番と同じ safety.js に委ねる。
    const genbutsu = Safety.computeGenbutsuSet(target, players);
    const doraIndicators = options.doraIndicators || [];
    return {
      players,
      target,
      targetLabel: target.label,
      genbutsu,
      sujiSet: Safety.computeSujiSet(genbutsu),
      visibleCounts: options.visibleCounts || new Array(Tiles.TILE_COUNT).fill(0),
      doraIndicators,
      doraTiles: doraIndicators.map((t) => Dora.doraTileFromIndicator(t)),
      roundWind: options.roundWind === undefined ? 27 : options.roundWind,
      seatWind: options.seatWind === undefined ? 27 : options.seatWind,
      otherRiichi: players.filter((p) => p.riichi && p.seat !== target.seat),
    };
  }

  /** その牌が場にあと何枚残っているか(見えている枚数を4枚から引く) */
  function remainingCount(tile, ctx) {
    return Math.max(0, 4 - (ctx.visibleCounts[tile] || 0));
  }

  // ==================================================
  // 個別の材料判定(第三弾の待ち読みからも再利用できるよう、単体で呼べる形にする)
  // ==================================================

  /** 現物(その相手にロンされない牌)か */
  function isGenbutsu(tile, ctx) {
    return ctx.genbutsu.has(tile);
  }

  /**
   * 筋(スジ)の判定。
   * 1・4・7 / 2・5・8 / 3・6・9 の関係で、相手の河にある牌の±3が「筋」になる。
   * @returns {{isSuji:boolean, basis:number[], partners:number[], isDoubleSuji:boolean}}
   */
  function analyzeSuji(tile, ctx) {
    if (Tiles.isHonor(tile)) return { isSuji: false, basis: [], partners: [], isDoubleSuji: false };
    const num = Tiles.numberOf(tile);
    const partners = [];
    if (num - 3 >= 1) partners.push(tile - 3);
    if (num + 3 <= 9) partners.push(tile + 3);
    const basis = partners.filter((p) => ctx.genbutsu.has(p));
    return {
      isSuji: basis.length > 0,
      basis,
      partners,
      isDoubleSuji: partners.length === 2 && basis.length === 2,
    };
  }

  /**
   * 牌Xを待てる「順子のターツ」を列挙する。
   *  下側 {X+1, X+2}: X と X+3 を待つ(X+3が無い端の場合は辺張)
   *  上側 {X-2, X-1}: X-3 と X を待つ
   * @returns {Array<{tiles:number[], sujiPartner:?number, shape:string}>}
   */
  function ryanmenForms(tile) {
    if (Tiles.isHonor(tile)) return [];
    const num = Tiles.numberOf(tile);
    const forms = [];
    if (num + 2 <= 9) {
      forms.push({
        tiles: [tile + 1, tile + 2],
        sujiPartner: num + 3 <= 9 ? tile + 3 : null,
        shape: num + 3 <= 9 ? 'ryanmen' : 'penchan',
      });
    }
    if (num - 2 >= 1) {
      forms.push({
        tiles: [tile - 2, tile - 1],
        sujiPartner: num - 3 >= 1 ? tile - 3 : null,
        shape: num - 3 >= 1 ? 'ryanmen' : 'penchan',
      });
    }
    return forms;
  }

  /**
   * 各ターツについて「その形でロンされる可能性が残っているか」を判定する。
   * status: 'suji'(筋で否定) | 'kabe'(壁で否定) | 'one-chance' | 'possible'
   */
  function analyzeForms(tile, ctx) {
    return ryanmenForms(tile).map((form) => {
      const remainings = form.tiles.map((t) => remainingCount(t, ctx));
      if (form.sujiPartner !== null && ctx.genbutsu.has(form.sujiPartner)) {
        return Object.assign({}, form, {
          status: 'suji',
          remainings,
          detail:
            Tiles.shortLabel(form.sujiPartner) + 'が相手の河にあるため、' +
            form.tiles.map((t) => Tiles.shortLabel(t)).join('') + 'の両面待ちではロンできません(振聴)。',
        });
      }
      const deadIndex = remainings.findIndex((r) => r === 0);
      if (deadIndex >= 0) {
        return Object.assign({}, form, {
          status: 'kabe',
          remainings,
          detail:
            Tiles.shortLabel(form.tiles[deadIndex]) + 'が4枚とも見えているため、' +
            form.tiles.map((t) => Tiles.shortLabel(t)).join('') + 'という形自体が作れません(壁)。',
        });
      }
      const oneIndex = remainings.findIndex((r) => r === 1);
      if (oneIndex >= 0) {
        return Object.assign({}, form, {
          status: 'one-chance',
          remainings,
          detail:
            Tiles.shortLabel(form.tiles[oneIndex]) + 'は残り1枚だけなので、' +
            form.tiles.map((t) => Tiles.shortLabel(t)).join('') + 'の形は作りにくいです(ワンチャンス。壁より弱い根拠)。',
        });
      }
      return Object.assign({}, form, {
        status: 'possible',
        remainings,
        detail: form.tiles.map((t) => Tiles.shortLabel(t)).join('') + 'を持たれていれば当たります。',
      });
    });
  }

  /** 壁(カベ)の判定: この牌を待つ形が、4枚見えの牌によって否定できるか */
  function analyzeKabe(tile, ctx) {
    const forms = analyzeForms(tile, ctx);
    const blocked = forms.filter((f) => f.status === 'kabe');
    return {
      isKabe: blocked.length > 0,
      allBlocked: forms.length > 0 && blocked.length === forms.length,
      blockedForms: blocked,
      blockerTiles: [...new Set(blocked.map((f) => f.tiles.find((t) => remainingCount(t, ctx) === 0)))],
    };
  }

  /** ワンチャンスの判定: 3枚見え(残り1枚)の牌によって、形が作りにくくなっているか */
  function analyzeOneChance(tile, ctx) {
    const forms = analyzeForms(tile, ctx);
    const oc = forms.filter((f) => f.status === 'one-chance');
    return {
      isOneChance: oc.length > 0,
      forms: oc,
      blockerTiles: [...new Set(oc.map((f) => f.tiles.find((t) => remainingCount(t, ctx) === 1)))],
    };
  }

  /** 字牌の情報(見えている枚数・役牌かどうか) */
  function analyzeHonor(tile, ctx) {
    if (!Tiles.isHonor(tile)) return { isHonor: false };
    const visible = ctx.visibleCounts[tile] || 0;
    const remaining = remainingCount(tile, ctx);
    const isDragon = tile >= 31;
    const isRoundWind = tile === ctx.roundWind;
    const isSeatWind = tile === ctx.seatWind;
    const isYakuhai = isDragon || isRoundWind || isSeatWind;
    let yakuhaiKind = null;
    if (isDragon) yakuhaiKind = '三元牌(サンゲンパイ)';
    else if (isRoundWind && isSeatWind) yakuhaiKind = '場風(バカゼ)かつ自風(ジカゼ)';
    else if (isRoundWind) yakuhaiKind = '場風(バカゼ)';
    else if (isSeatWind) yakuhaiKind = '自風(ジカゼ)';
    else yakuhaiKind = '客風(オタカゼ。誰の役にもならない字牌)';
    return {
      isHonor: true,
      visible,
      remaining,
      isLive: remaining >= 3, // 生牌(ションパイ)
      isYakuhai,
      yakuhaiKind,
    };
  }

  /** ドラ・ドラ周辺の判定 */
  function analyzeDora(tile, ctx, isAka) {
    const isDora = ctx.doraTiles.indexOf(tile) !== -1;
    let isAdjacent = false;
    let adjacentTo = null;
    if (!Tiles.isHonor(tile)) {
      ctx.doraTiles.forEach((d) => {
        if (Tiles.isHonor(d)) return;
        if (Tiles.suitOf(d) !== Tiles.suitOf(tile)) return;
        const diff = Math.abs(Tiles.numberOf(d) - Tiles.numberOf(tile));
        if (diff === 1) {
          isAdjacent = true;
          adjacentTo = d;
        }
      });
    }
    return { isDora, isAdjacent, adjacentTo, isAka: !!isAka };
  }

  // ==================================================
  // 1牌の総合評価
  // ==================================================

  function factor(key, label, detail) {
    return { key, label, detail };
  }

  /**
   * 候補牌1枚を評価する。
   * @param {number|{tile:number, aka:boolean}} candidate
   * @param {object} ctx buildContext() の結果
   */
  function evaluateTile(candidate, ctx) {
    const tile = typeof candidate === 'number' ? candidate : candidate.tile;
    const isAka = typeof candidate === 'number' ? false : !!candidate.aka;
    const label = Tiles.shortLabel(tile);
    const safeFactors = [];
    const dangerFactors = [];

    const genbutsu = isGenbutsu(tile, ctx);
    const suji = analyzeSuji(tile, ctx);
    const forms = analyzeForms(tile, ctx);
    const kabe = analyzeKabe(tile, ctx);
    const oneChance = analyzeOneChance(tile, ctx);
    const honor = analyzeHonor(tile, ctx);
    const dora = analyzeDora(tile, ctx, isAka);
    const remaining = remainingCount(tile, ctx);

    // ---- S: 構造的にロンされないケース ----
    if (genbutsu) {
      const source = findGenbutsuSource(tile, ctx);
      safeFactors.push(
        factor('genbutsu', '現物(ゲンブツ)', source || ctx.targetLabel + 'が捨てている牌なので、この相手にはロンされません。')
      );
      if (ctx.otherRiichi.length > 0) {
        dangerFactors.push(
          factor(
            'other-player',
            '他の相手には安全とは限らない',
            ctx.otherRiichi.map((p) => p.label).join('・') + 'は捨てていないため、そちらには当たる可能性があります。'
          )
        );
      }
      return finish(tile, label, 'S', 0, {
        genbutsu, suji, forms, kabe, oneChance, honor, dora, remaining, isAka,
        safeFactors, dangerFactors,
        reason: '現物(ゲンブツ)です。' + ctx.targetLabel + 'は自分で捨てた牌ではロンできない(振聴(フリテン))ため、この相手に限れば絶対に当たりません。',
      });
    }

    if (honor.isHonor && honor.remaining === 0) {
      safeFactors.push(
        factor('honor-dead', '字牌が残り0枚', 'この字牌は4枚とも見えています。字牌は手の中に持っていないとロンできない(双碰・単騎のみ)ため、理論上ロンされません。')
      );
      return finish(tile, label, 'S', 0, {
        genbutsu, suji, forms, kabe, oneChance, honor, dora, remaining, isAka,
        safeFactors, dangerFactors,
        reason: '字牌で残り0枚のため、相手は1枚も持てません。字牌は双碰(シャンポン)か単騎(タンキ)でしか当たらないので、理論上ロンされません。',
      });
    }

    // ---- S以外: 材料を足し引きして相対評価する ----
    let score = 0;

    if (honor.isHonor) {
      score += WEIGHTS.honorRemaining[honor.remaining] || 0;
      if (honor.remaining <= 1) {
        safeFactors.push(
          factor('honor-few', '字牌の残りが少ない(残り' + honor.remaining + '枚)', '残り1枚では対子(トイツ)を作れないため、双碰待ちはありません。単騎待ちの可能性だけが残ります。')
        );
      } else if (honor.remaining === 2) {
        safeFactors.push(
          factor('honor-two', '字牌が2枚見え(残り' + honor.remaining + '枚)', '相手が2枚とも持っていなければ双碰待ちにはなりません。見えていない字牌よりは安全寄りです。')
        );
      } else {
        dangerFactors.push(
          factor('live-honor', '生牌(ションパイ)の字牌', 'まだ1枚も見えていない字牌です。双碰待ち・単騎待ちの可能性が残るため、終盤ほど危険になります。')
        );
      }
      if (honor.isYakuhai) {
        score += WEIGHTS.honorYakuhai;
        dangerFactors.push(
          factor('yakuhai', '役牌(ヤクハイ)になる字牌', honor.yakuhaiKind + 'なので、相手が対子で持っている可能性があります。')
        );
      } else {
        score += WEIGHTS.honorGuestWind;
        safeFactors.push(factor('guest-wind', '客風(オタカゼ)', honor.yakuhaiKind + 'のため、役にならず残されにくい字牌です。'));
      }
    } else {
      // 数牌: 両面形をいくつ否定できるか
      const blocked = forms.filter((f) => f.status === 'suji' || f.status === 'kabe');
      const oc = forms.filter((f) => f.status === 'one-chance');
      const allBlocked = forms.length > 0 && blocked.length === forms.length;

      if (allBlocked) score += WEIGHTS.allRyanmenBlocked;
      else score += blocked.length * WEIGHTS.perRyanmenBlocked;
      score += oc.length * WEIGHTS.perRyanmenOneChance;

      blocked.forEach((f) => {
        if (f.status === 'suji') {
          safeFactors.push(factor('suji', '筋(スジ)', f.detail));
        } else {
          safeFactors.push(factor('kabe', '壁(カベ)', f.detail));
        }
      });
      oc.forEach((f) => safeFactors.push(factor('one-chance', 'ワンチャンス', f.detail)));

      const possible = forms.filter((f) => f.status === 'possible');
      possible.forEach((f) =>
        dangerFactors.push(
          factor('open-ryanmen', '否定できない' + (f.shape === 'penchan' ? '辺張' : '両面') + '形', f.detail)
        )
      );

      if (Tiles.isTerminal(tile)) {
        score += WEIGHTS.terminalTile;
        safeFactors.push(factor('terminal', '端の牌(1・9)', '1・9は順子で待たれる形が少なく、中張牌より当たりにくい牌です。'));
      }
      const num = Tiles.numberOf(tile);
      if (num >= 3 && num <= 7) {
        score += WEIGHTS.middleTile;
        dangerFactors.push(
          factor('middle', '中張牌(3〜7)', '真ん中の数牌は両面・嵌張・辺張など待ちの種類が多いため、無筋(ムスジ)なら警戒される牌です。')
        );
      }
    }

    if (dora.isDora) {
      score += WEIGHTS.doraTile;
      dangerFactors.push(factor('dora', 'ドラ', 'ドラは手の中に残されやすく、待ちに絡みやすい牌です。放銃したときの失点も大きくなります。'));
    } else if (dora.isAdjacent) {
      score += WEIGHTS.doraAdjacent;
      dangerFactors.push(
        factor('dora-near', 'ドラの近く(' + Tiles.shortLabel(dora.adjacentTo) + 'がドラ)', 'ドラを含む順子を作るために残されやすい牌です。')
      );
    }
    if (dora.isAka) {
      // 赤5は「同じ牌種」として扱う(安全度の計算は通常の5とまったく同じ)。
      // 打点が高くなるという注意だけを添える。
      dangerFactors.push(
        factor('aka', '赤5(アカドラ)', '安全かどうかの判断は通常の5と同じですが、放銃したときの失点が大きくなります。')
      );
    }

    // 常に残る危険(この方法では否定できない待ち)
    if (!honor.isHonor) {
      dangerFactors.push(
        factor(
          'other-waits',
          '嵌張・辺張・双碰・単騎には当たる',
          '筋や壁で否定できるのは両面待ちの一部だけです。嵌張(カンチャン)・辺張(ペンチャン)・双碰(シャンポン)・単騎(タンキ)待ちには当たる可能性が残ります。'
        )
      );
    } else {
      dangerFactors.push(
        factor('honor-waits', '双碰・単騎には当たる', '字牌は双碰(シャンポン)待ち・単騎(タンキ)待ちで当たる可能性があります。')
      );
    }

    if (ctx.otherRiichi.length > 0) {
      dangerFactors.push(
        factor('other-player', '他の相手は別に考える', ctx.otherRiichi.map((p) => p.label).join('・') + 'に対する安全度は、この評価とは別です。')
      );
    }

    const rank = rankForScore(score);
    return finish(tile, label, rank, score, {
      genbutsu, suji, forms, kabe, oneChance, honor, dora, remaining, isAka,
      safeFactors, dangerFactors,
      reason: buildReason(label, rank, safeFactors, dangerFactors),
    });
  }

  function buildReason(label, rank, safeFactors, dangerFactors) {
    const safe = safeFactors.map((f) => f.label).join('・');
    const danger = dangerFactors.filter((f) => f.key !== 'other-player').map((f) => f.label).join('・');
    const head = label + 'は' + RANKS[rank].label + '。';
    const safeText = safe ? '安全材料: ' + safe + '。' : '安全材料はありません。';
    const dangerText = danger ? '危険材料: ' + danger + '。' : '';
    return head + safeText + dangerText + 'ランクSの牌以外は「当たりにくい」というだけで、安全が確定しているわけではありません。';
  }

  function finish(tile, label, rank, score, data) {
    return Object.assign(
      {
        tile,
        label,
        rank,
        rankLabel: RANKS[rank].label,
        rankShort: RANKS[rank].short,
        certain: RANKS[rank].certain,
        score,
      },
      data
    );
  }

  /** 現物になっている根拠(どの河の牌か)を文章にする */
  function findGenbutsuSource(tile, ctx) {
    const own = ctx.target.discards.findIndex((d) => d.tile === tile);
    if (own >= 0) {
      return ctx.targetLabel + 'の河(カワ)の' + (own + 1) + '枚目に' + Tiles.shortLabel(tile) + 'があります。';
    }
    for (const p of ctx.players) {
      for (let i = 0; i < p.discards.length; i++) {
        const d = p.discards[i];
        if (
          d.tile === tile &&
          ctx.target.riichiDeclaredAtTurnIndex >= 0 &&
          d.turnIndex > ctx.target.riichiDeclaredAtTurnIndex
        ) {
          return (
            ctx.targetLabel + 'の立直(リーチ)宣言より後に' + p.label + 'が捨てた' + Tiles.shortLabel(tile) +
            'が、ロンされずに通っています。'
          );
        }
      }
    }
    return null;
  }

  // ==================================================
  // 複数候補の比較(相対順位・同順位の処理)
  // ==================================================

  /**
   * 候補牌をまとめて評価し、安全な順のグループに分ける。
   * 材料が同程度なら無理に順位を分けず、同じグループ(同順位)にする。
   * @returns {{
   *   candidates:Array, groups:Array<{index:number, rank:string, score:number, tiles:number[]}>,
   *   rankOf:Object, groupIndexOf:Object, safestTiles:number[], mostDangerousTiles:number[]
   * }}
   */
  function evaluateCandidates(candidates, ctx) {
    const evaluated = (candidates || []).map((c) => evaluateTile(c, ctx));

    // 並び順のキーは「ランク → スコア」。同じランク・同じスコアなら同順位として扱う。
    const keyOf = (e) => e.rank + ':' + e.score;
    const sorted = evaluated.slice().sort((a, b) => {
      const ra = RANK_ORDER.indexOf(a.rank);
      const rb = RANK_ORDER.indexOf(b.rank);
      if (ra !== rb) return ra - rb;
      return b.score - a.score;
    });

    const groups = [];
    const groupIndexOf = {};
    const rankOf = {};
    let lastKey = null;
    sorted.forEach((e) => {
      const key = keyOf(e);
      if (key !== lastKey) {
        groups.push({ index: groups.length, rank: e.rank, score: e.score, tiles: [] });
        lastKey = key;
      }
      const g = groups[groups.length - 1];
      g.tiles.push(e.tile);
      groupIndexOf[e.tile] = g.index;
      rankOf[e.tile] = e.rank;
    });

    return {
      candidates: evaluated,
      groups,
      rankOf,
      groupIndexOf,
      safestTiles: groups.length > 0 ? groups[0].tiles.slice() : [],
      mostDangerousTiles: groups.length > 0 ? groups[groups.length - 1].tiles.slice() : [],
      hasTieAtTop: groups.length > 0 && groups[0].tiles.length > 1,
    };
  }

  /**
   * 初心者向けの4分類(現物 / 比較的安全 / 判断が必要 / 危険寄り)。
   * ランクをそのまま見せると細かすぎる場面で使う。
   */
  const CATEGORY = {
    genbutsu: '現物(ロンされない)',
    'relatively-safe': '比較的安全',
    'needs-judgement': '判断が必要',
    dangerous: '危険寄り',
  };

  function categoryOf(rank) {
    if (rank === 'S') return 'genbutsu';
    if (rank === 'A' || rank === 'B') return 'relatively-safe';
    if (rank === 'C') return 'needs-judgement';
    return 'dangerous';
  }

  const Defense = {
    RANKS,
    RANK_ORDER,
    WEIGHTS,
    SCORE_TO_RANK,
    CATEGORY,
    rankForScore,
    buildContext,
    remainingCount,
    isGenbutsu,
    analyzeSuji,
    ryanmenForms,
    analyzeForms,
    analyzeKabe,
    analyzeOneChance,
    analyzeHonor,
    analyzeDora,
    evaluateTile,
    evaluateCandidates,
    categoryOf,
    findGenbutsuSource,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Defense;
  } else {
    root.MJ = root.MJ || {};
    root.MJ.Defense = Defense;
  }
})(typeof window !== 'undefined' ? window : globalThis);
