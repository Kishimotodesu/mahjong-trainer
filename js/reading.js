/**
 * reading.js
 * 「相手の待ち読み」(V1.9)の推理エンジン。
 *
 * ■ このファイルの最重要ルール
 *  ここにある関数は「公開情報(相手の河・副露・リーチ宣言牌・ドラ表示牌・自分の手牌)」だけを見る。
 *  相手の伏せられた手牌や実際の待ちは、引数として受け取らない。
 *  実際の待ちを使ってよいのは matchWaits() だけで、これは「当たっていたか」の照合専用。
 *  この分離は tests/reading-tests.js で保証している。
 *
 * ■ 何を返さないか
 *  「待ちは◯◯である」という断定や、待ちの確率・放銃率のようなパーセントは返さない。
 *  河から分かるのは「候補を絞る材料」までで、1つに決められないことも一緒に伝える。
 *
 * ■ 評価の2軸
 *  推理評価(gradeReasoning): 公開情報から妥当な危険候補を選べたか … ◎ / ○ / △
 *  待ち的中(matchWaits):     選んだ候補に実際の待ちが含まれていたか … 的中 / 一部的中 / 不的中
 *  推理が妥当でも待ちは外れることがあり、逆に根拠が弱くても偶然当たることがある。
 *  この2つは必ず別々に扱う。
 */
(function (root) {
  'use strict';

  let Tiles, Safety, Defense, Dora;
  if (typeof module !== 'undefined' && module.exports) {
    Tiles = require('./tiles.js');
    Safety = require('./safety.js');
    Defense = require('./defense.js');
    Dora = require('./dora.js');
  } else {
    Tiles = root.MJ.Tiles;
    Safety = root.MJ.Safety;
    Defense = root.MJ.Defense;
    Dora = root.MJ.Dora;
  }

  // ==================================================
  // 評価の段階
  // ==================================================

  /** 推理評価(公開情報の使い方) */
  const REASONING = {
    excellent: { key: 'excellent', mark: '◎', label: '公開情報を正しく使えています' },
    good: { key: 'good', mark: '○', label: '概ね妥当な読みです' },
    needsWork: { key: 'needsWork', mark: '△', label: '重要な手掛かりを見落としています' },
  };

  /** 待ち的中(実際の待ちとの照合。推理評価とは別物) */
  const HIT = {
    hit: { key: 'hit', mark: '的中', label: '実際の待ちをすべて含んでいました' },
    partial: { key: 'partial', mark: '一部的中', label: '実際の待ちの一部を含んでいました' },
    miss: { key: 'miss', mark: '不的中', label: '実際の待ちは含まれていませんでした' },
  };

  /**
   * 読みによる危険度の補正値。defense.js のスコア(高いほど安全)に足し引きする。
   * 統計ではなく「河と副露から言えること」をルール化したもの。
   */
  const READING_WEIGHTS = {
    honitsuSuit: -3, // 染め手が疑われる色の数牌は危険側
    honitsuHonor: -2, // 染め手なら字牌も残されやすい
    honitsuOtherSuit: 3, // 染め手の色以外は安全側(使われにくい)
    toitoiHonorOrTerminal: -1, // 対々和なら双碰(シャンポン)待ちが増える
    tanyaoSimple: -1, // 断么九の仕掛けなら2〜8が危険側
    tanyaoTerminalHonor: 2, // 断么九なら1・9・字牌は使われない
    safeTileScore: 99, // 現物など「当たらない」牌は、必ず最も安全側に置く
    maxGapFromTop: 3, // 最も危険な牌からこれ以上離れた牌は「妥当な警戒対象」に含めない
  };

  // ==================================================
  // 公開情報の整理
  // ==================================================

  function targetOf(board) {
    const target = board.players.find((p) => p.seat === board.targetSeat);
    if (!target) throw new Error('targetSeat に対応するプレイヤーがいません: ' + board.targetSeat);
    return target;
  }

  function meldsOf(player) {
    return player.melds || [];
  }

  /** 副露牌をすべて並べた配列 */
  function meldTiles(player) {
    const tiles = [];
    meldsOf(player).forEach((m) => m.tiles.forEach((t) => tiles.push(t)));
    return tiles;
  }

  /**
   * defense.js のコンテキストを作る。
   * board.visibleCounts(自分の手牌・全員の河・副露・ドラ表示牌を合計した見えている枚数)は
   * 呼び出し側(quizengine.publicBoard)が用意する。伏せられた手牌は決して含めない。
   */
  function defenseContext(board) {
    if (!board.visibleCounts) {
      throw new Error('board.visibleCounts がありません(公開情報の集計は呼び出し側で行ってください)');
    }
    return Defense.buildContext({
      players: board.players,
      targetSeat: board.targetSeat,
      visibleCounts: board.visibleCounts,
      doraIndicators: board.doraIndicators,
      roundWind: board.roundWind,
      seatWind: board.seatWind,
    });
  }

  /**
   * 相手の手の方向(染め手・対々和・断么九・役牌)を、公開情報だけから推測する。
   * どれも「可能性がある」までで、断定はしない。
   */
  function handDirection(board) {
    const target = targetOf(board);
    const melds = meldsOf(target);
    const discards = target.discards.map((d) => d.tile);
    const suitCount = { m: 0, p: 0, s: 0 };
    let honorDiscards = 0;
    discards.forEach((t) => {
      if (Tiles.isHonor(t)) honorDiscards++;
      else suitCount[Tiles.suitOf(t)]++;
    });

    const meldSuits = new Set(meldTiles(target).filter((t) => !Tiles.isHonor(t)).map((t) => Tiles.suitOf(t)));
    const notes = [];

    // ---- 染め手(混一色・清一色)の可能性 ----
    let honitsu = null;
    const suits = ['m', 'p', 's'];
    if (melds.length >= 1 && meldSuits.size <= 1) {
      const suit = meldSuits.size === 1 ? [...meldSuits][0] : null;
      if (suit) {
        const others = suits.filter((s) => s !== suit).reduce((a, s) => a + suitCount[s], 0);
        if (suitCount[suit] <= 1 && others >= 3) honitsu = { suit, level: 'strong' };
        else if (suitCount[suit] <= 2 && others >= 2) honitsu = { suit, level: 'weak' };
      }
    }
    if (!honitsu && discards.length >= 5) {
      suits.forEach((suit) => {
        if (honitsu) return;
        const others = suits.filter((s) => s !== suit).reduce((a, s) => a + suitCount[s], 0);
        if (suitCount[suit] === 0 && others >= 4) honitsu = { suit, level: 'weak' };
      });
    }
    if (honitsu) {
      const suitName = { m: '萬子(マンズ)', p: '筒子(ピンズ)', s: '索子(ソーズ)' }[honitsu.suit];
      notes.push(
        (honitsu.level === 'strong' ? '混一色(ホンイツ)・清一色(チンイツ)の可能性が高い' : '染め手(混一色)の可能性がある') +
          '：' + suitName + 'をほとんど切っていません。' + suitName + 'と字牌が危険になります。'
      );
    }

    // ---- 対々和(トイトイ)の可能性 ----
    const tripletMelds = melds.filter((m) => m.type === 'pon' || m.type === 'minkan' || m.type === 'ankan');
    let toitoi = null;
    if (tripletMelds.length >= 2) {
      toitoi = { level: tripletMelds.length >= 3 ? 'strong' : 'possible' };
      notes.push(
        '対々和(トイトイ)の可能性：ポンが' + tripletMelds.length + 'つあります。' +
          '刻子(コーツ)を集める手は双碰(シャンポン)待ち・単騎(タンキ)待ちになりやすく、字牌や端の牌も危険になります。'
      );
    }

    // ---- 断么九(タンヤオ)の可能性 ----
    let tanyao = null;
    const allMeldTiles = meldTiles(target);
    if (melds.length >= 1 && allMeldTiles.length > 0 && allMeldTiles.every((t) => !Tiles.isTerminalOrHonor(t))) {
      tanyao = { level: 'possible' };
      notes.push('断么九(タンヤオ)の可能性：鳴いた面子がすべて2〜8の数牌です。1・9・字牌は使いません。');
    }

    // ---- 役牌(ヤクハイ) ----
    const yakuhaiMelds = tripletMelds.filter((m) => {
      const t = m.tiles[0];
      if (!Tiles.isHonor(t)) return false;
      return t >= 31 || t === board.roundWind || t === board.seatWind;
    });
    if (yakuhaiMelds.length > 0) {
      notes.push(
        '役牌(ヤクハイ)：' + yakuhaiMelds.map((m) => Tiles.shortLabel(m.tiles[0])).join('・') +
          'を鳴いているため、この役だけで安い手にも高い手にもなり得ます。'
      );
    }

    return {
      isOpen: melds.length > 0,
      isRiichi: !!target.riichi,
      melds,
      meldCount: melds.length,
      suitCount,
      honorDiscards,
      honitsu,
      toitoi,
      tanyao,
      yakuhai: yakuhaiMelds.map((m) => m.tiles[0]),
      notes,
    };
  }

  // ==================================================
  // 河・副露から読み取れる手掛かり
  // ==================================================

  /**
   * 河から読み取れることを一覧にする(表示用)。
   * kind: 'safe'(安全側の材料) | 'danger'(危険側の材料) | 'info' | 'limit'(断定できないこと)
   */
  function riverClues(board) {
    const ctx = defenseContext(board);
    const target = targetOf(board);
    const clues = [];

    const genbutsu = [...ctx.genbutsu].sort((a, b) => a - b);
    if (genbutsu.length > 0) {
      clues.push({
        key: 'genbutsu',
        kind: 'safe',
        tiles: genbutsu,
        text:
          '現物(ゲンブツ)は' + genbutsu.length + '種類：' + genbutsu.map((t) => Tiles.shortLabel(t)).join('・') +
          '。この相手はこれらでロンできません(振聴(フリテン))。',
      });
      const suji = [...Safety.computeSujiSet(ctx.genbutsu)].filter((t) => !ctx.genbutsu.has(t)).sort((a, b) => a - b);
      if (suji.length > 0) {
        clues.push({
          key: 'suji',
          kind: 'safe',
          tiles: suji,
          text:
            '筋(スジ)になる牌：' + suji.map((t) => Tiles.shortLabel(t)).join('・') +
            '。両面待ち(リャンメンマチ)の一部は否定できますが、嵌張・双碰・単騎には当たります。',
        });
      }
    }

    const dead = [];
    const oneChance = [];
    for (let i = 0; i < Tiles.TILE_COUNT; i++) {
      const remaining = Defense.remainingCount(i, ctx);
      if (remaining === 0) dead.push(i);
      else if (remaining === 1) oneChance.push(i);
    }
    if (dead.length > 0) {
      clues.push({
        key: 'kabe',
        kind: 'safe',
        tiles: dead,
        text: '4枚とも見えている牌(壁(カベ))：' + dead.map((t) => Tiles.shortLabel(t)).join('・') + '。これを使う形は作れません。',
      });
    }
    if (oneChance.length > 0 && oneChance.length <= 6) {
      clues.push({
        key: 'one-chance',
        kind: 'safe',
        tiles: oneChance,
        text:
          '3枚見えの牌(ワンチャンス)：' + oneChance.map((t) => Tiles.shortLabel(t)).join('・') +
          '。壁より弱い根拠で、残り1枚を持たれていれば当たります。',
      });
    }

    const liveHonors = [];
    for (let i = 27; i < Tiles.TILE_COUNT; i++) {
      if (Defense.remainingCount(i, ctx) >= 3) liveHonors.push(i);
    }
    if (liveHonors.length > 0) {
      clues.push({
        key: 'live-honor',
        kind: 'danger',
        tiles: liveHonors,
        text:
          'まだほとんど見えていない字牌：' + liveHonors.map((t) => Tiles.shortLabel(t)).join('・') +
          '。双碰(シャンポン)・単騎(タンキ)で待たれている可能性があります。',
      });
    }

    if (board.doraIndicators && board.doraIndicators.length > 0) {
      const doraTiles = board.doraIndicators.map((t) => Dora.doraTileFromIndicator(t));
      clues.push({
        key: 'dora',
        kind: 'danger',
        tiles: doraTiles,
        text: 'ドラは' + doraTiles.map((t) => Tiles.shortLabel(t)).join('・') + '。ドラとその周りは手の中に残されやすい牌です。',
      });
    }

    if (target.riichi && target.riichiIndex >= 0 && target.discards[target.riichiIndex]) {
      clues.push({
        key: 'riichi-tile',
        kind: 'info',
        tiles: [target.discards[target.riichiIndex].tile],
        text:
          'リーチ宣言牌は' + Tiles.shortLabel(target.discards[target.riichiIndex].tile) +
          '。宣言より後に切られた牌は、通っていれば安全です。',
      });
    }

    const direction = handDirection(board);
    direction.notes.forEach((note, i) => clues.push({ key: 'direction-' + i, kind: 'danger', tiles: [], text: note }));

    // 最後に必ず「断定できないこと」を添える
    clues.push({
      key: 'not-certain',
      kind: 'limit',
      tiles: [],
      text:
        '河や鳴きから分かるのは「候補を絞ること」までです。相手の手牌は見えないため、待ちを1つに断定することはできません。',
    });

    return clues;
  }

  // ==================================================
  // 公開情報だけを使った危険度評価
  // ==================================================

  /**
   * 候補牌を「読み」も加味して評価する。
   * defense.js の安全度(高いほど安全)を土台に、手の方向による補正を足し引きする。
   * @param {object} board 公開情報のみの盤面
   * @param {Array<number|{tile:number}>} candidates
   */
  function evaluateCandidates(board, candidates) {
    const ctx = defenseContext(board);
    const direction = handDirection(board);

    const evaluated = (candidates || []).map((c) => {
      const tile = typeof c === 'number' ? c : c.tile;
      const base = Defense.evaluateTile(c, ctx);
      // 現物・残り0枚の字牌(ランクS)は当たらないので、必ず最も安全側に置く
      let score = base.rank === 'S' ? READING_WEIGHTS.safeTileScore : base.score;
      const readingFactors = [];

      if (base.rank !== 'S') {
        if (direction.honitsu) {
          const suit = direction.honitsu.suit;
          const suitName = { m: '萬子', p: '筒子', s: '索子' }[suit];
          if (Tiles.isHonor(tile)) {
            score += READING_WEIGHTS.honitsuHonor;
            readingFactors.push({
              key: 'honitsu-honor',
              kind: 'danger',
              text: '染め手(' + suitName + ')が疑われるため、字牌も使われやすくなります。',
            });
          } else if (Tiles.suitOf(tile) === suit) {
            score += READING_WEIGHTS.honitsuSuit;
            readingFactors.push({
              key: 'honitsu-suit',
              kind: 'danger',
              text: suitName + 'は染め手で使われる色です。無筋なら特に危険です。',
            });
          } else {
            score += READING_WEIGHTS.honitsuOtherSuit;
            readingFactors.push({
              key: 'honitsu-other',
              kind: 'safe',
              text: '染め手が疑われる色ではないため、相手の手に使われにくい牌です。',
            });
          }
        }
        if (direction.toitoi && Tiles.isTerminalOrHonor(tile)) {
          score += READING_WEIGHTS.toitoiHonorOrTerminal;
          readingFactors.push({
            key: 'toitoi',
            kind: 'danger',
            text: '対々和(トイトイ)が疑われるため、双碰(シャンポン)・単騎(タンキ)で待たれている可能性があります。',
          });
        }
        if (direction.tanyao) {
          if (Tiles.isTerminalOrHonor(tile)) {
            score += READING_WEIGHTS.tanyaoTerminalHonor;
            readingFactors.push({
              key: 'tanyao-safe',
              kind: 'safe',
              text: '断么九(タンヤオ)が疑われるため、1・9・字牌は使われにくくなります。',
            });
          } else {
            score += READING_WEIGHTS.tanyaoSimple;
            readingFactors.push({ key: 'tanyao-danger', kind: 'danger', text: '断么九(タンヤオ)なら2〜8の数牌が手に入ります。' });
          }
        }
      }

      return Object.assign({}, base, { readingScore: score, readingFactors });
    });

    // 危険な順(スコアが低い順)にグループ化する。材料が同じなら同順位。
    const sorted = evaluated.slice().sort((a, b) => a.readingScore - b.readingScore);
    const groups = [];
    const groupIndexOf = {};
    let lastScore = null;
    sorted.forEach((e) => {
      if (e.readingScore !== lastScore) {
        groups.push({ index: groups.length, score: e.readingScore, tiles: [] });
        lastScore = e.readingScore;
      }
      const g = groups[groups.length - 1];
      g.tiles.push(e.tile);
      groupIndexOf[e.tile] = g.index;
    });

    return {
      candidates: evaluated,
      groups,
      groupIndexOf,
      direction,
      mostDangerous: groups.length > 0 ? groups[0].tiles.slice() : [],
      safest: groups.length > 0 ? groups[groups.length - 1].tiles.slice() : [],
    };
  }

  /**
   * 「公開情報から見て、警戒するのが妥当な候補」を count 種類ぶん求める。
   * 同順位の牌はまとめて返すため、count より多くなることがある
   * (材料が同じ牌に無理な順位を付けないため)。
   */
  function reasonableTargets(board, candidates, count) {
    const result = evaluateCandidates(board, candidates);
    const limit = count === undefined ? 3 : count;
    const sorted = result.candidates.slice().sort((a, b) => a.readingScore - b.readingScore);
    const tiles = [];
    if (sorted.length > 0) {
      const topScore = sorted[0].readingScore;
      for (let i = 0; i < sorted.length; i++) {
        const e = sorted[i];
        // 最も危険な牌から大きく離れた牌(現物・筋など)は、警戒対象には含めない
        if (e.readingScore - topScore > READING_WEIGHTS.maxGapFromTop) break;
        // 指定数に達したら打ち切る。ただし同点(材料が同じ)の牌は順位を付けずに含める
        if (tiles.length >= limit && e.readingScore !== sorted[tiles.length - 1].readingScore) break;
        tiles.push(e.tile);
      }
    }
    return { tiles, groups: result.groups, evaluation: result };
  }

  // ==================================================
  // 推理評価(公開情報だけを見る)
  // ==================================================

  /**
   * ユーザーが選んだ危険候補が、公開情報から見て妥当かを評価する。
   * ここでは相手の実際の待ちを一切参照しない(引数にも取らない)。
   * @param {object} board 公開情報のみの盤面
   * @param {number[]} candidates 選択肢として提示した牌
   * @param {number[]} selected ユーザーが選んだ牌
   * @param {number} count 選ばせた数
   */
  function gradeReasoning(board, candidates, selected, count) {
    const target = reasonableTargets(board, candidates, count);
    const topSet = new Set(target.tiles);
    const evaluation = target.evaluation;
    const byTile = {};
    evaluation.candidates.forEach((c) => (byTile[c.tile] = c));

    const picked = (selected || []).slice();
    const inTop = picked.filter((t) => topSet.has(t));
    const outOfTop = picked.filter((t) => !topSet.has(t));
    // 現物・残り0枚の字牌(ランクS)を危険候補に選ぶのは、公開情報の使い方としての明確な誤り
    const pickedSafe = picked.filter((t) => byTile[t] && byTile[t].rank === 'S');

    let grade;
    if (picked.length === 0) grade = REASONING.needsWork;
    else if (pickedSafe.length > 0) grade = REASONING.needsWork;
    else if (outOfTop.length === 0) grade = REASONING.excellent;
    else if (inTop.length > 0) grade = REASONING.good;
    else grade = REASONING.needsWork;

    const reasons = [];
    if (pickedSafe.length > 0) {
      reasons.push(
        pickedSafe.map((t) => Tiles.shortLabel(t)).join('・') + 'は現物などで、この相手には当たりません。危険候補からは外しましょう。'
      );
    }
    if (inTop.length > 0) {
      reasons.push(inTop.map((t) => Tiles.shortLabel(t)).join('・') + 'は、公開情報から見て警戒するのが妥当な牌です。');
    }
    const missed = target.tiles.filter((t) => picked.indexOf(t) === -1);
    if (missed.length > 0) {
      reasons.push('公開情報からは' + missed.map((t) => Tiles.shortLabel(t)).join('・') + 'も警戒したい牌でした。');
    }
    if (outOfTop.length > 0 && pickedSafe.length === 0) {
      reasons.push(
        outOfTop.map((t) => Tiles.shortLabel(t)).join('・') + 'は、他の候補と比べると警戒の優先度は下がります。'
      );
    }

    return {
      grade,
      gradeKey: grade.key,
      mark: grade.mark,
      reasonableTiles: target.tiles,
      selected: picked,
      selectedInTop: inTop,
      selectedOutOfTop: outOfTop,
      selectedSafe: pickedSafe,
      missed,
      reasons,
      evaluation,
    };
  }

  // ==================================================
  // 待ち的中(ここだけが実際の待ちを見る)
  // ==================================================

  /**
   * 選んだ候補と、相手の実際の待ちを照合する。
   * この関数だけが「回答前には見えない情報」を使ってよい。
   * @param {number[]} selected
   * @param {number[]} actualWaits
   */
  function matchWaits(selected, actualWaits) {
    const picked = new Set(selected || []);
    const waits = (actualWaits || []).slice().sort((a, b) => a - b);
    const matched = waits.filter((t) => picked.has(t));
    let level;
    if (waits.length === 0) level = HIT.miss;
    else if (matched.length === waits.length) level = HIT.hit;
    else if (matched.length > 0) level = HIT.partial;
    else level = HIT.miss;
    return {
      level,
      levelKey: level.key,
      mark: level.mark,
      matched,
      missedWaits: waits.filter((t) => !picked.has(t)),
      waits,
    };
  }

  // ==================================================
  // 「河から読み取れる説明」の正誤判定
  // ==================================================

  /**
   * 選択肢に書かれた説明が、公開情報から見て正しいかを判定する。
   * 待ちを断定する説明(type:'certain-wait')は常に false になる。
   * @param {object} board
   * @param {{type:string, tile?:number, suit?:string}} statement
   */
  function evaluateStatement(board, statement) {
    const ctx = defenseContext(board);
    const direction = handDirection(board);
    const target = targetOf(board);
    const tile = statement.tile;

    switch (statement.type) {
      case 'genbutsu':
        return Defense.isGenbutsu(tile, ctx);
      case 'suji':
        return Defense.analyzeSuji(tile, ctx).isSuji;
      case 'kabe':
        return Defense.analyzeKabe(tile, ctx).isKabe;
      case 'one-chance':
        return Defense.analyzeOneChance(tile, ctx).isOneChance;
      case 'live-honor': {
        const honor = Defense.analyzeHonor(tile, ctx);
        return !!honor.isHonor && honor.remaining >= 3;
      }
      case 'honor-dead': {
        const honor = Defense.analyzeHonor(tile, ctx);
        return !!honor.isHonor && honor.remaining === 0;
      }
      case 'yakuhai': {
        const honor = Defense.analyzeHonor(tile, ctx);
        return !!honor.isHonor && honor.isYakuhai;
      }
      case 'dora':
        return Defense.analyzeDora(tile, ctx, false).isDora;
      case 'dora-near':
        return Defense.analyzeDora(tile, ctx, false).isAdjacent;
      case 'honitsu':
        return !!direction.honitsu && (statement.suit === undefined || direction.honitsu.suit === statement.suit);
      case 'toitoi':
        return !!direction.toitoi;
      case 'tanyao':
        return !!direction.tanyao;
      case 'open-hand':
        return direction.isOpen;
      case 'menzen':
        return !direction.isOpen;
      case 'riichi':
        return !!target.riichi;
      case 'certain-wait':
        // 河や鳴きだけで待ちを1つに断定することはできない(常に誤り)
        return false;
      default:
        throw new Error('未知の説明タイプ: ' + statement.type);
    }
  }

  const Reading = {
    REASONING,
    HIT,
    READING_WEIGHTS,
    targetOf,
    meldsOf,
    meldTiles,
    handDirection,
    riverClues,
    evaluateCandidates,
    reasonableTargets,
    gradeReasoning,
    matchWaits,
    evaluateStatement,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Reading;
  } else {
    root.MJ = root.MJ || {};
    root.MJ.Reading = Reading;
  }
})(typeof window !== 'undefined' ? window : globalThis);
