/**
 * quizdata-reading.js
 * 「相手の待ち読み」(V1.9)のシナリオデータ。
 *
 * ■ データの分け方(最重要)
 *  board  … 回答前に見せてよい公開情報(自分の手牌・全員の河・副露・ドラ表示牌・場風/自風・巡目)
 *  hidden … 回答後にだけ公開する情報(相手の手牌・副露・実際の待ち)
 *  推理の計算には board しか渡さない。hidden を使ってよいのは「待ち的中」の照合だけ。
 *
 * hidden.waits は作問者の想定で、テストで待ち判定エンジン(shanten.js)の結果と突き合わせる。
 * 実行時の答え合わせにはエンジンが計算した待ちを使う。
 */
(function (root) {
  'use strict';

  function parse(str) {
    const tiles = [];
    if (!str) return tiles;
    const re = /(\d+)([mpsz])/g;
    let match;
    while ((match = re.exec(str))) {
      const nums = match[1].split('').map(Number);
      const suit = match[2];
      for (const n of nums) {
        if (suit === 'm') tiles.push(n - 1);
        else if (suit === 'p') tiles.push(9 + (n - 1));
        else if (suit === 's') tiles.push(18 + (n - 1));
        else tiles.push(26 + n);
      }
    }
    return tiles;
  }

  function t(str) {
    return parse(str)[0];
  }

  const EAST = 27;
  const SOUTH = 28;

  // ==================================================
  // コース定義
  // ==================================================

  const READING_COURSE = {
    id: 'reading',
    name: '相手の待ち読み',
    description: '河や鳴きから危険な待ち候補を考え、回答後に相手の実際の手牌を確認します。',
    target: '河(カワ)と副露(フーロ)からの推理・染め手・多面待ち・「河だけでは断定できない」ことの理解',
    icon: '読',
    note: '推理評価(公開情報の使い方)と待ち的中(実際の待ちと合っていたか)は別々に表示します。河だけで待ちを断定することはできません。',
    difficulties: [
      { id: 'beginner', name: '初級', recommended: true, description: '現物・筋・分かりやすい壁や染め手など、根拠が見つけやすい局面です。' },
      { id: 'intermediate', name: '中級', description: 'ワンチャンス・字牌待ち・ドラ周辺など、複数の可能性がある局面です。' },
      { id: 'practical', name: '実戦', description: '材料が競合し、河だけでは断定できない局面です。推理が妥当でも外れることがあります。' },
    ],
  };

  // ==================================================
  // 盤面ヘルパー
  // ==================================================

  /**
   * @param {object} spec
   *   hand: 自分の手牌
   *   self/shimocha/toimen/kamicha: 各家の河
   *   melds: {seat: [{type,tiles}]} 相手の副露
   *   riichi: [{seat, index}]
   *   dora / roundWind / seatWind / targetSeat / turn / describe
   */
  function scene(spec) {
    const meldMap = spec.melds || {};
    const players = [{ seat: 0, label: '自分', isSelf: true, discards: parse(spec.self) }];
    [
      { seat: 1, label: '下家', river: spec.shimocha },
      { seat: 2, label: '対面', river: spec.toimen },
      { seat: 3, label: '上家', river: spec.kamicha },
    ].forEach((s) => {
      if (s.river === undefined) return;
      const riichi = (spec.riichi || []).find((r) => r.seat === s.seat);
      players.push({
        seat: s.seat,
        label: s.label,
        riichi: !!riichi,
        riichiIndex: riichi ? riichi.index : undefined,
        discards: parse(s.river),
        melds: (meldMap[s.seat] || []).map((m) => ({ type: m.type, tiles: parse(m.tiles) })),
      });
    });
    return {
      hand: parse(spec.hand),
      targetSeat: spec.targetSeat === undefined ? 1 : spec.targetSeat,
      doraIndicators: parse(spec.dora),
      roundWind: spec.roundWind === undefined ? EAST : spec.roundWind,
      seatWind: spec.seatWind === undefined ? SOUTH : spec.seatWind,
      turn: spec.turn,
      describe: spec.describe,
      players,
    };
  }

  /** 回答後にだけ公開する情報 */
  function hidden(spec) {
    return {
      hand: parse(spec.hand),
      melds: (spec.melds || []).map((m) => ({ type: m.type, tiles: parse(m.tiles) })),
      waits: parse(spec.waits),
      shape: spec.shape,
    };
  }

  function tileChoices(tileStrings) {
    return tileStrings.map((s, i) => ({ id: 'c' + i, label: null, value: t(s), tile: t(s) }));
  }

  /** 河・副露から読み取れる説明の選択肢(statement をエンジンが検証する) */
  function statementChoices(list) {
    return list.map((item, i) => ({
      id: 's' + i,
      label: item.label,
      value: 'st' + i,
      statement: item.statement,
    }));
  }

  const NOT_CERTAIN = (tileLabel) => ({
    label: 'この河だけで、待ちを' + tileLabel + 'だと断定できる',
    statement: { type: 'certain-wait' },
  });

  // ==================================================
  // 場面
  // ==================================================

  // A: リーチのみ。現物・筋・ドラが分かりやすい。
  const SCENE_A = scene({
    hand: '5m789m3p6p2s1s9s11z5z7z',
    shimocha: '9m3p6s1z2m',
    toimen: '5z2p8s',
    riichi: [{ seat: 1, index: 4 }],
    dora: '4m',
    turn: 8,
    describe: '8巡目。下家(シモチャ)が5枚目の2萬でリーチしました。ドラは5萬です。',
  });
  const HIDDEN_A = hidden({ hand: '234m456p789p34s55s', waits: '2s5s', shape: '両面待ち(リャンメンマチ)' });

  // B: 萬子の染め手が分かりやすい副露。
  const SCENE_B = scene({
    hand: '6m9m2p5p3s6s9s1234z5z7z',
    shimocha: '1z9p',
    toimen: '3p5p8p2s6s',
    melds: { 2: [{ type: 'chi', tiles: '123m' }, { type: 'pon', tiles: '666z' }] },
    targetSeat: 2,
    turn: 9,
    describe: '9巡目。対面(トイメン)は發をポンし、123萬をチーしています。筒子と索子ばかりを切っています。',
  });
  const HIDDEN_B = hidden({
    hand: '123m78m99m',
    melds: [{ type: 'chi', tiles: '123m' }, { type: 'pon', tiles: '666z' }],
    waits: '6m9m',
    shape: '両面待ち(リャンメンマチ)',
  });

  // C: 4筒が4枚見え(壁)。ただし実際の待ちは嵌張。
  const SCENE_C = scene({
    hand: '2p44p6p5m789m123s1z5z',
    shimocha: '1m5s3z7p',
    toimen: '1z9s',
    kamicha: '4p4p6z',
    riichi: [{ seat: 1, index: 2 }],
    turn: 10,
    describe: '10巡目。下家(シモチャ)は3巡目に西でリーチ。4筒はすでに4枚見えています。',
  });
  const HIDDEN_C = hidden({ hand: '234m678m789s1p3p55s', waits: '2p', shape: '嵌張待ち(カンチャンマチ)' });

  // D: 役牌2つのポン。対々和(トイトイ)の可能性。
  const SCENE_D = scene({
    hand: '2m456m789p6p9s34s1s5z',
    shimocha: '3p6p5m8m4s',
    toimen: '1z9p',
    melds: { 1: [{ type: 'pon', tiles: '777z' }, { type: 'pon', tiles: '111z' }] },
    turn: 11,
    describe: '11巡目。下家(シモチャ)は中と東(場風)をポンしています。鳴きが2つとも刻子(コーツ)です。',
  });
  const HIDDEN_D = hidden({
    hand: '555p99s22m',
    melds: [{ type: 'pon', tiles: '777z' }, { type: 'pon', tiles: '111z' }],
    waits: '2m9s',
    shape: '双碰待ち(シャンポンマチ)',
  });

  // E: ワンチャンスとドラ周辺。
  const SCENE_E = scene({
    hand: '3p6p77s5m6m1s9s11z5z6z7z',
    shimocha: '7s3z8m',
    toimen: '9m1z4p2s',
    riichi: [{ seat: 2, index: 3 }],
    targetSeat: 2,
    dora: '5p',
    turn: 9,
    describe: '9巡目。対面(トイメン)が2索でリーチ。ドラは6筒です。7索は3枚見えています。',
  });
  const HIDDEN_E = hidden({ hand: '234m678m789s45p33s', waits: '3p6p', shape: '両面待ち(リャンメンマチ)' });

  // F: 2人リーチ。
  const SCENE_F = scene({
    hand: '5s8s3p7p123m4s9s1234z',
    shimocha: '2p6s1z9m',
    toimen: '4m2s4p5z',
    riichi: [
      { seat: 1, index: 2 },
      { seat: 2, index: 3 },
    ],
    turn: 12,
    describe: '12巡目。下家(シモチャ)と対面(トイメン)の2人がリーチしています。まずは下家に対して考えます。',
  });
  const HIDDEN_F = hidden({ hand: '456m789m234p67s99p', waits: '5s8s', shape: '両面待ち(リャンメンマチ)' });

  // G: 多面待ち。
  const SCENE_G = scene({
    hand: '1s4s7s567p1m9m1234z5z',
    shimocha: '1z9p2m5z',
    toimen: '3z8m',
    riichi: [{ seat: 1, index: 1 }],
    turn: 7,
    describe: '7巡目。下家(シモチャ)が9筒でリーチしました。',
  });
  const HIDDEN_G = hidden({ hand: '234m567m11p23456s', waits: '1s4s7s', shape: '多面待ち(タメンマチ)' });

  // H: 筒子の染め手に見えるが、実際は萬子の手。
  const SCENE_H = scene({
    hand: '6m9m2p3p6p1s5s9s123z5z7z',
    shimocha: '1z2s',
    toimen: '3m7m2s6s1z',
    melds: { 2: [{ type: 'chi', tiles: '456p' }, { type: 'pon', tiles: '999p' }] },
    targetSeat: 2,
    turn: 10,
    describe: '10巡目。対面(トイメン)は筒子ばかりを鳴いていて、萬子と索子を切っています。',
  });
  const HIDDEN_H = hidden({
    hand: '123m78m22s',
    melds: [{ type: 'chi', tiles: '456p' }, { type: 'pon', tiles: '999p' }],
    waits: '6m9m',
    shape: '両面待ち(リャンメンマチ)',
  });

  // I: 字牌の単騎待ち。
  const SCENE_I = scene({
    hand: '1z3z4z5z7z5m8s3p2p4m6s1s9s',
    shimocha: '3m7p2s9m2m5s6p',
    toimen: '1z9s',
    riichi: [{ seat: 1, index: 6 }],
    turn: 10,
    describe: '10巡目。下家(シモチャ)が6筒でリーチ。河には数牌ばかりが並んでいます。',
  });
  const HIDDEN_I = hidden({ hand: '234m456p678p789s1z', waits: '1z', shape: '単騎待ち(タンキマチ)' });

  // J: 3巡目の早いリーチ。河が短く、ほとんど絞れない。
  const SCENE_J = scene({
    hand: '3s6s4p7m2m8p1s9s123z5z7z',
    shimocha: '9m1z2p',
    toimen: '5z',
    riichi: [{ seat: 1, index: 2 }],
    turn: 3,
    describe: '3巡目。下家(シモチャ)が2筒でリーチしました。まだ河が短い局面です。',
  });
  const HIDDEN_J = hidden({ hand: '234m456m678p45s33s', waits: '3s6s', shape: '両面待ち(リャンメンマチ)' });

  // K: 役牌ポンだけの仕掛け。
  const SCENE_K = scene({
    hand: '3s6s1m9p2p8m4m7p9s1z2z5z7z',
    shimocha: '1z9m',
    toimen: '5z3m',
    kamicha: '1m9p1z5p2s',
    melds: { 3: [{ type: 'pon', tiles: '666z' }] },
    targetSeat: 3,
    turn: 8,
    describe: '8巡目。上家(カミチャ)が發をポンしています。河には1萬・9筒など端の牌が並んでいます。',
  });
  const HIDDEN_K = hidden({
    hand: '234m567p88s45s',
    melds: [{ type: 'pon', tiles: '666z' }],
    waits: '3s6s',
    shape: '両面待ち(リャンメンマチ)',
  });

  // ==================================================
  // 問題
  // ==================================================

  function q(spec) {
    return Object.assign({ course: 'reading' }, spec);
  }

  /** 危険候補・待ち予想(推理評価と待ち的中を分けて採点する形式) */
  function readingQuestion(spec) {
    return q(
      Object.assign(
        {
          mode: 'reading',
          multi: true,
          resolver: 'readingTargets',
          selectCount: 3,
        },
        spec
      )
    );
  }

  /** 河・副露から読み取れる説明を選ぶ形式(通常の正誤判定) */
  function statementQuestion(spec) {
    return q(Object.assign({ multi: true, resolver: 'readingStatements' }, spec));
  }

  const READING_QUESTIONS = [
    // ---------------- 場面A ----------------
    readingQuestion({
      id: 'reading-01',
      difficulty: 'beginner',
      tags: ['reading-genbutsu', 'reading-suji', 'reading-dora'],
      selectCount: 2,
      prompt: '下家(シモチャ)に対して、特に警戒したい牌を2種類選んでください。',
      board: SCENE_A,
      hidden: HIDDEN_A,
      candidates: parse('3p6p5m2s'),
      choices: tileChoices(['3p', '6p', '5m', '2s']),
      expected: ['c2', 'c3'],
      explanation:
        '3筒は下家の河にある現物(ゲンブツ)なので当たりません。6筒は3筒の筋(スジ)で、両面待ちの一部を否定できます。' +
        '残る5萬(無筋の中張牌でドラ)と2索(無筋)が警戒したい牌です。ドラは手の中に残されやすいぶん、より危険になります。',
    }),
    statementQuestion({
      id: 'reading-02',
      difficulty: 'beginner',
      tags: ['reading-genbutsu', 'reading-suji', 'reading-not-certain'],
      prompt: '下家(シモチャ)の河から読み取れることとして、正しい説明をすべて選んでください。',
      board: SCENE_A,
      hidden: HIDDEN_A,
      choices: statementChoices([
        { label: '3筒は現物(ゲンブツ)なので、この相手には当たらない', statement: { type: 'genbutsu', tile: t('3p') } },
        { label: '6筒は筋(スジ)にあたる', statement: { type: 'suji', tile: t('6p') } },
        { label: '5萬はドラである', statement: { type: 'dora', tile: t('5m') } },
        { label: '2索には壁(カベ)がある', statement: { type: 'kabe', tile: t('2s') } },
        NOT_CERTAIN('2索'),
      ]),
      expected: ['s0', 's1', 's2'],
      explanation:
        '3筒は河にあるので現物、6筒は3筒の筋、5萬はドラ表示牌4萬の次なのでドラです。' +
        '2索に関係する牌は4枚見えていないので壁はありません。そして、河だけで待ちを断定することはできません。',
    }),
    readingQuestion({
      id: 'reading-03',
      difficulty: 'beginner',
      tags: ['reading-suji', 'reading-not-certain'],
      selectCount: 3,
      prompt: '下家(シモチャ)の待ちを予想します。可能性を警戒したい牌を最大3種類まで選んでください。',
      board: SCENE_A,
      hidden: HIDDEN_A,
      candidates: parse('2s5m6p9s'),
      choices: tileChoices(['2s', '5m', '6p', '9s']),
      expected: ['c0', 'c1', 'c2'],
      explanation:
        '実際の待ちは2索・5索でした。2索を選べていれば一部的中です。9索は6索の筋(スジ)なので、警戒の優先度は下がります。' +
        'ただし、この河から「2索・5索待ち」と当てることはできません。無筋を警戒するという読み自体が妥当かどうかが大事です。',
    }),

    // ---------------- 場面B ----------------
    statementQuestion({
      id: 'reading-04',
      difficulty: 'beginner',
      tags: ['reading-open-hand', 'reading-honitsu'],
      prompt: '対面(トイメン)の鳴きから読み取れることとして、正しい説明をすべて選んでください。',
      board: SCENE_B,
      hidden: HIDDEN_B,
      choices: statementChoices([
        { label: '萬子(マンズ)の混一色(ホンイツ)が考えられる', statement: { type: 'honitsu', suit: 'm' } },
        { label: '發をポンしているので役牌(ヤクハイ)がある', statement: { type: 'yakuhai', tile: t('6z') } },
        { label: '鳴いているので門前(メンゼン)ではない', statement: { type: 'open-hand' } },
        { label: '対々和(トイトイ)が濃厚である', statement: { type: 'toitoi' } },
        { label: '断么九(タンヤオ)の手である', statement: { type: 'tanyao' } },
      ]),
      expected: ['s0', 's1', 's2'],
      explanation:
        '萬子だけを鳴き、筒子と索子を切っているので混一色(ホンイツ)の可能性が高い形です。發のポンで役牌もあります。' +
        'ただしポンは1つだけなので対々和とは言えず、發を使っているので断么九でもありません。',
    }),
    readingQuestion({
      id: 'reading-05',
      difficulty: 'beginner',
      tags: ['reading-honitsu', 'reading-open-hand'],
      selectCount: 2,
      prompt: '対面(トイメン)に対して、特に警戒したい牌を2種類選んでください。',
      board: SCENE_B,
      hidden: HIDDEN_B,
      candidates: parse('6m9m2p3s'),
      choices: tileChoices(['6m', '9m', '2p', '3s']),
      expected: ['c0', 'c1'],
      explanation:
        '萬子の染め手が疑われるため、萬子は無筋でなくても警戒が必要です。逆に筒子・索子は相手の手に使われにくく、比較的安全です。' +
        '染め手を相手にするときは「色を絞って守る」のが基本になります。',
    }),
    readingQuestion({
      id: 'reading-06',
      difficulty: 'intermediate',
      tags: ['reading-honitsu', 'reading-not-certain'],
      selectCount: 3,
      prompt: '対面(トイメン)の待ちを予想します。可能性を警戒したい牌を最大3種類まで選んでください。',
      board: SCENE_B,
      hidden: HIDDEN_B,
      candidates: parse('6m9m2p3s'),
      choices: tileChoices(['6m', '9m', '2p', '3s']),
      expected: ['c0', 'c1'],
      explanation:
        '実際の待ちは6萬・9萬でした。染め手の色を警戒するという読みがそのまま当たった形です。' +
        'ただし同じ染め手でも、単騎(タンキ)や双碰(シャンポン)で字牌を待っていることもあります。色を絞れても牌までは断定できません。',
    }),

    // ---------------- 場面C ----------------
    statementQuestion({
      id: 'reading-07',
      difficulty: 'beginner',
      tags: ['reading-kabe', 'reading-genbutsu', 'reading-not-certain'],
      prompt: '下家(シモチャ)について、この局面から読み取れることとして、正しい説明をすべて選んでください。',
      board: SCENE_C,
      hidden: HIDDEN_C,
      choices: statementChoices([
        { label: '4筒が4枚見えているので、2筒には壁(カベ)がある', statement: { type: 'kabe', tile: t('2p') } },
        { label: '7筒は現物(ゲンブツ)である', statement: { type: 'genbutsu', tile: t('7p') } },
        { label: '2筒は現物(ゲンブツ)である', statement: { type: 'genbutsu', tile: t('2p') } },
        { label: '下家は門前(メンゼン)でリーチしている', statement: { type: 'riichi' } },
        NOT_CERTAIN('2筒'),
      ]),
      expected: ['s0', 's1', 's3'],
      explanation:
        '4筒が4枚見えているため、3筒4筒という形は作れません(壁)。7筒は下家の河にあるので現物です。' +
        '2筒は河にないので現物ではありません。壁があっても「両面では当たらない」だけで、嵌張(カンチャン)などには当たります。',
    }),
    readingQuestion({
      id: 'reading-08',
      difficulty: 'intermediate',
      tags: ['reading-kabe', 'reading-suji'],
      selectCount: 2,
      prompt: '下家(シモチャ)に対して、特に警戒したい牌を2種類選んでください。',
      board: SCENE_C,
      hidden: HIDDEN_C,
      candidates: parse('2p5m3s1z'),
      choices: tileChoices(['2p', '5m', '3s', '1z']),
      expected: ['c1', 'c2'],
      explanation:
        '2筒は壁があるため両面待ちでは当たりにくく、この中では優先度が下がります。' +
        '5萬と3索はどちらも無筋の中張牌で、材料は同程度です。東も役牌ですが2枚見えているぶん、双碰(シャンポン)待ちになりにくくなっています。',
    }),
    readingQuestion({
      id: 'reading-09',
      difficulty: 'practical',
      tags: ['reading-kabe', 'reading-not-certain'],
      selectCount: 3,
      prompt: '下家(シモチャ)の待ちを予想します。可能性を警戒したい牌を最大3種類まで選んでください。',
      board: SCENE_C,
      hidden: HIDDEN_C,
      candidates: parse('2p5m3s1z'),
      choices: tileChoices(['2p', '5m', '3s', '1z']),
      expected: ['c1', 'c2', 'c3'],
      explanation:
        '実際の待ちは2筒の嵌張(カンチャン)待ちでした。壁があるのに当たる、という典型例です。' +
        '壁で否定できるのは「その牌を使う両面待ち」だけで、嵌張・双碰・単騎は否定できません。' +
        'ただし、無筋を警戒した読み自体は妥当です。推理が正しくても当たらないことがある、という点を覚えてください。',
    }),

    // ---------------- 場面D ----------------
    statementQuestion({
      id: 'reading-10',
      difficulty: 'intermediate',
      tags: ['reading-toitoi', 'reading-open-hand', 'reading-honor'],
      prompt: '下家(シモチャ)の鳴きから読み取れることとして、正しい説明をすべて選んでください。',
      board: SCENE_D,
      hidden: HIDDEN_D,
      choices: statementChoices([
        { label: 'ポンが2つあるので対々和(トイトイ)の可能性がある', statement: { type: 'toitoi' } },
        { label: '中をポンしているので役牌(ヤクハイ)がある', statement: { type: 'yakuhai', tile: t('7z') } },
        { label: '東(場風)をポンしているので役牌(ヤクハイ)がある', statement: { type: 'yakuhai', tile: t('1z') } },
        { label: '混一色(ホンイツ)が濃厚である', statement: { type: 'honitsu' } },
        { label: '断么九(タンヤオ)の手である', statement: { type: 'tanyao' } },
      ]),
      expected: ['s0', 's1', 's2'],
      explanation:
        'ポンが2つあるので対々和(トイトイ)の可能性があります。中は三元牌、東は場風なのでどちらも役牌です。' +
        '色は偏っていないので混一色とは言えず、字牌を使っているので断么九でもありません。',
    }),
    readingQuestion({
      id: 'reading-11',
      difficulty: 'intermediate',
      tags: ['reading-toitoi', 'reading-honor'],
      selectCount: 2,
      prompt: '下家(シモチャ)に対して、特に警戒したい牌を2種類選んでください。',
      board: SCENE_D,
      hidden: HIDDEN_D,
      candidates: parse('2m9s6p5z'),
      choices: tileChoices(['2m', '9s', '6p', '5z']),
      expected: ['c1', 'c3'],
      explanation:
        '対々和(トイトイ)が疑われる相手には、双碰(シャンポン)待ちが増えるため字牌や端の牌も危険になります。' +
        '生牌(ションパイ)の白と、端の9索が警戒したい牌です。6筒は下家の河にある現物、2萬は5萬の筋なので、優先度は下がります。',
    }),
    readingQuestion({
      id: 'reading-12',
      difficulty: 'practical',
      tags: ['reading-toitoi', 'reading-suji', 'reading-not-certain'],
      selectCount: 3,
      prompt: '下家(シモチャ)の待ちを予想します。可能性を警戒したい牌を最大3種類まで選んでください。',
      board: SCENE_D,
      hidden: HIDDEN_D,
      candidates: parse('2m9s6p5z'),
      choices: tileChoices(['2m', '9s', '6p', '5z']),
      expected: ['c1', 'c3'],
      explanation:
        '実際の待ちは2萬・9索の双碰(シャンポン)待ちでした。9索を選べていれば一部的中です。' +
        '2萬は筋(スジ)ですが、双碰待ちには筋は関係ありません。「筋だから大丈夫」が通用しないのは、こういう手が相手のときです。',
    }),

    // ---------------- 場面E ----------------
    statementQuestion({
      id: 'reading-13',
      difficulty: 'intermediate',
      tags: ['reading-one-chance', 'reading-dora', 'reading-genbutsu'],
      prompt: '対面(トイメン)について、この局面から読み取れることとして、正しい説明をすべて選んでください。',
      board: SCENE_E,
      hidden: HIDDEN_E,
      choices: statementChoices([
        { label: '4筒は現物(ゲンブツ)である', statement: { type: 'genbutsu', tile: t('4p') } },
        { label: '6筒はドラである', statement: { type: 'dora', tile: t('6p') } },
        { label: '9索はワンチャンス(7索が3枚見え)である', statement: { type: 'one-chance', tile: t('9s') } },
        { label: '6筒は筋(スジ)にあたる', statement: { type: 'suji', tile: t('6p') } },
        NOT_CERTAIN('6筒'),
      ]),
      expected: ['s0', 's1', 's2'],
      explanation:
        '4筒は対面の河にあるので現物、ドラ表示牌5筒の次の6筒がドラです。7索が3枚見えているので9索はワンチャンスです。' +
        '6筒の筋は3筒か9筒ですが、どちらも河にないので筋ではありません。',
    }),
    readingQuestion({
      id: 'reading-14',
      difficulty: 'intermediate',
      tags: ['reading-dora', 'reading-one-chance'],
      selectCount: 2,
      prompt: '対面(トイメン)に対して、特に警戒したい牌を2種類選んでください。',
      board: SCENE_E,
      hidden: HIDDEN_E,
      candidates: parse('6p3p9s5z'),
      choices: tileChoices(['6p', '3p', '9s', '5z']),
      expected: ['c0', 'c1'],
      explanation:
        'ドラの6筒は手の中に残されやすく、待ちに絡みやすい牌です。無筋の3筒も警戒したい牌になります。' +
        'まだ1枚も見えていない白も候補になりますが、9索はワンチャンス+端の牌なので、この中では優先度が下がります。',
    }),
    readingQuestion({
      id: 'reading-15',
      difficulty: 'intermediate',
      tags: ['reading-dora', 'reading-not-certain'],
      selectCount: 3,
      prompt: '対面(トイメン)の待ちを予想します。可能性を警戒したい牌を最大3種類まで選んでください。',
      board: SCENE_E,
      hidden: HIDDEN_E,
      candidates: parse('6p3p9s5z'),
      choices: tileChoices(['6p', '3p', '9s', '5z']),
      expected: ['c0', 'c1', 'c3'],
      explanation:
        '実際の待ちは3筒・6筒でした。ドラの6筒と、その3つ違いの3筒を警戒できていれば的中です。' +
        'ドラ周辺は「残されやすい」ため待ちに絡みやすい、という読みが機能した例です。ただし毎回そうなるわけではありません。',
    }),

    // ---------------- 場面F ----------------
    readingQuestion({
      id: 'reading-16',
      difficulty: 'practical',
      tags: ['reading-two-riichi', 'reading-genbutsu'],
      selectCount: 2,
      prompt: '2人リーチです。まず下家(シモチャ)に対して、特に警戒したい牌を2種類選んでください。',
      board: SCENE_F,
      hidden: HIDDEN_F,
      candidates: parse('5s8s3p7p'),
      choices: tileChoices(['5s', '8s', '3p', '7p']),
      expected: ['c0', 'c2'],
      explanation:
        '下家の河は2筒・6索・東・9萬。筋(スジ)は3つ違いの関係なので、6索から言えるのは3索と9索の筋であって、5索は筋ではありません。' +
        '2筒から言えるのは5筒の筋です。つまり5索・3筒・7筒はどれも無筋で、中でも中張牌の5索と3筒が警戒したい牌になります。' +
        '2人リーチのときは、まず1人ずつ分けて考えるのが基本です。',
    }),
    readingQuestion({
      id: 'reading-17',
      difficulty: 'practical',
      tags: ['reading-two-riichi'],
      selectCount: 2,
      prompt: '同じ局面です。今度は対面(トイメン)に対して、特に警戒したい牌を2種類選んでください。',
      board: scene({
        hand: '5s8s3p7p123m4s9s1234z',
        shimocha: '2p6s1z9m',
        toimen: '4m2s4p5z',
        riichi: [
          { seat: 1, index: 2 },
          { seat: 2, index: 3 },
        ],
        targetSeat: 2,
        turn: 12,
        describe: '12巡目。同じ局面を、今度は対面(トイメン)から見て考えます。',
      }),
      hidden: HIDDEN_F,
      candidates: parse('5s8s3p7p'),
      choices: tileChoices(['5s', '8s', '3p', '7p']),
      expected: ['c1', 'c2'],
      explanation:
        '対面の河には2索と4筒があるので、対面に対しては5索と7筒が筋になります。逆に3筒と8索は無筋です。' +
        '同じ牌でも相手が変われば評価が変わります。片方に安全でも、もう片方には危険なことがよくあります。' +
        '※この問題の「実際の待ち」は下家の手牌です。対面の手牌は伏せたままなので、待ち的中は参考として扱ってください。',
    }),
    statementQuestion({
      id: 'reading-18',
      difficulty: 'practical',
      tags: ['reading-two-riichi', 'reading-not-certain'],
      prompt: '2人リーチの局面です。下家(シモチャ)について、正しい説明をすべて選んでください。',
      board: SCENE_F,
      hidden: HIDDEN_F,
      choices: statementChoices([
        { label: '5索は下家に対して筋(スジ)である', statement: { type: 'suji', tile: t('5s') } },
        { label: '2筒は下家に対して現物(ゲンブツ)である', statement: { type: 'genbutsu', tile: t('2p') } },
        { label: '8索は下家に対して現物(ゲンブツ)である', statement: { type: 'genbutsu', tile: t('8s') } },
        { label: '下家は門前(メンゼン)でリーチしている', statement: { type: 'riichi' } },
        NOT_CERTAIN('5索'),
      ]),
      expected: ['s1', 's3'],
      explanation:
        '下家の河にある2筒は現物です。5索は筋ではありません。筋は3つ違いの関係なので、河の6索から言えるのは3索と9索の筋です。' +
        '8索も河にないので現物ではありません。2人リーチでは「どちらに対する話なのか」を必ず区別してください。',
    }),

    // ---------------- 場面G ----------------
    readingQuestion({
      id: 'reading-19',
      difficulty: 'practical',
      tags: ['reading-multi-wait', 'reading-not-certain'],
      selectCount: 3,
      prompt: '下家(シモチャ)の待ちを予想します。可能性を警戒したい牌を最大3種類まで選んでください。',
      board: SCENE_G,
      hidden: HIDDEN_G,
      candidates: parse('1s4s7s5p'),
      choices: tileChoices(['1s', '4s', '7s', '5p']),
      expected: ['c1', 'c2', 'c3'],
      explanation:
        '実際の待ちは1索・4索・7索の3面待ちでした。4索と7索を選べていれば一部的中です。' +
        '多面待ちは候補が多いため、3種類選んでも全部は拾いきれません。「当てにいく」よりも、無筋を減らす考え方が大切です。',
    }),
    statementQuestion({
      id: 'reading-20',
      difficulty: 'intermediate',
      tags: ['reading-genbutsu', 'reading-not-certain'],
      prompt: '7巡目の局面です。下家(シモチャ)について、正しい説明をすべて選んでください。',
      board: SCENE_G,
      hidden: HIDDEN_G,
      choices: statementChoices([
        { label: '9筒は現物(ゲンブツ)である', statement: { type: 'genbutsu', tile: t('9p') } },
        { label: '2萬は現物(ゲンブツ)である', statement: { type: 'genbutsu', tile: t('2m') } },
        { label: '5筒は現物(ゲンブツ)である', statement: { type: 'genbutsu', tile: t('5p') } },
        { label: '下家は門前(メンゼン)でリーチしている', statement: { type: 'riichi' } },
        NOT_CERTAIN('4索'),
      ]),
      expected: ['s0', 's1', 's3'],
      explanation:
        '下家の河にある9筒と2萬は現物です。5筒は河にないので現物ではありません。' +
        '河が短い段階では現物も少なく、断定できる情報はさらに限られます。',
    }),
    readingQuestion({
      id: 'reading-21',
      difficulty: 'intermediate',
      tags: ['reading-multi-wait'],
      selectCount: 2,
      prompt: '下家(シモチャ)に対して、特に警戒したい牌を2種類選んでください。',
      board: SCENE_G,
      hidden: HIDDEN_G,
      candidates: parse('1s4s7s5p'),
      choices: tileChoices(['1s', '4s', '7s', '5p']),
      expected: ['c1', 'c2'],
      explanation:
        '1索は端の牌で待たれる形が少なく、この中では優先度が下がります。4索・7索・5筒はいずれも無筋の数牌で、材料は同程度です。' +
        'この3つのうちどの2つを選んでも妥当な読みになります。' +
        '材料が同じなら無理に順位を付けず、「どれも危険」と考えるのが正しい読み方です。',
    }),

    // ---------------- 場面H ----------------
    statementQuestion({
      id: 'reading-22',
      difficulty: 'practical',
      tags: ['reading-honitsu', 'reading-open-hand', 'reading-not-certain'],
      prompt: '対面(トイメン)の鳴きと河から読み取れることとして、正しい説明をすべて選んでください。',
      board: SCENE_H,
      hidden: HIDDEN_H,
      choices: statementChoices([
        { label: '筒子(ピンズ)の染め手(混一色)が考えられる', statement: { type: 'honitsu', suit: 'p' } },
        { label: '鳴いているので門前(メンゼン)ではない', statement: { type: 'open-hand' } },
        { label: '対々和(トイトイ)が濃厚である', statement: { type: 'toitoi' } },
        { label: '断么九(タンヤオ)の手である', statement: { type: 'tanyao' } },
        NOT_CERTAIN('3筒'),
      ]),
      expected: ['s0', 's1'],
      explanation:
        '筒子を鳴いて萬子・索子を切っているため、筒子の染め手が考えられます。ここまでの読みは妥当です。' +
        'ただしポンは1つだけなので対々和とは言えず、9筒を使っているので断么九でもありません。',
    }),
    readingQuestion({
      id: 'reading-23',
      difficulty: 'practical',
      tags: ['reading-honitsu', 'reading-not-certain'],
      selectCount: 2,
      prompt: '対面(トイメン)に対して、特に警戒したい牌を2種類選んでください。',
      board: SCENE_H,
      hidden: HIDDEN_H,
      candidates: parse('3p6p6m9m'),
      choices: tileChoices(['3p', '6p', '6m', '9m']),
      expected: ['c0', 'c1'],
      explanation:
        '公開情報からは筒子の染め手が疑われるので、3筒・6筒を警戒するのが妥当な読みです。この判断自体は正しい考え方です。',
    }),
    readingQuestion({
      id: 'reading-24',
      difficulty: 'practical',
      tags: ['reading-honitsu', 'reading-not-certain'],
      selectCount: 3,
      prompt: '対面(トイメン)の待ちを予想します。可能性を警戒したい牌を最大3種類まで選んでください。',
      board: SCENE_H,
      hidden: HIDDEN_H,
      candidates: parse('3p6p6m9m'),
      choices: tileChoices(['3p', '6p', '6m', '9m']),
      expected: ['c0', 'c1'],
      explanation:
        '実際の待ちは6萬・9萬でした。染め手に見えても、手の中は普通の手だったという例です。' +
        '筒子を警戒する読みは公開情報から見て妥当ですが、それでも外れることがあります。' +
        '推理が正しいことと、待ちが当たることは別だと覚えてください。',
    }),

    // ---------------- 場面I ----------------
    readingQuestion({
      id: 'reading-25',
      difficulty: 'intermediate',
      tags: ['reading-honor', 'reading-not-certain'],
      selectCount: 2,
      prompt: '下家(シモチャ)に対して、特に警戒したい牌を2種類選んでください。',
      board: SCENE_I,
      hidden: HIDDEN_I,
      candidates: parse('1z5z5m8s'),
      choices: tileChoices(['1z', '5z', '5m', '8s']),
      expected: ['c0', 'c1'],
      explanation:
        '河が数牌ばかりで字牌が1枚も切られていない場合、字牌の単騎(タンキ)待ち・双碰(シャンポン)待ちが残っています。' +
        '東は場風、白は三元牌でどちらも役牌(ヤクハイ)になるため、対子(トイツ)で持たれている可能性もあります。',
    }),
    readingQuestion({
      id: 'reading-26',
      difficulty: 'intermediate',
      tags: ['reading-honor'],
      selectCount: 3,
      prompt: '下家(シモチャ)の待ちを予想します。可能性を警戒したい牌を最大3種類まで選んでください。',
      board: SCENE_I,
      hidden: HIDDEN_I,
      candidates: parse('1z5z5m8s'),
      choices: tileChoices(['1z', '5z', '5m', '8s']),
      expected: ['c0', 'c1'],
      explanation:
        '実際は東の単騎(タンキ)待ちでした。字牌が河に無いことを手掛かりにできていれば的中です。' +
        '「河に字牌が見えない=字牌待ちの可能性が残る」は、初心者でも使いやすい読みの1つです。',
    }),
    statementQuestion({
      id: 'reading-27',
      difficulty: 'intermediate',
      tags: ['reading-honor', 'reading-not-certain'],
      prompt: '下家(シモチャ)について、この局面から読み取れることとして、正しい説明をすべて選んでください。',
      board: SCENE_I,
      hidden: HIDDEN_I,
      choices: statementChoices([
        { label: '白はまだ1枚も見えていない生牌(ションパイ)である', statement: { type: 'live-honor', tile: t('5z') } },
        { label: '東は場風なので役牌(ヤクハイ)になる', statement: { type: 'yakuhai', tile: t('1z') } },
        { label: '7筒は現物(ゲンブツ)である', statement: { type: 'genbutsu', tile: t('7p') } },
        { label: '5萬は現物(ゲンブツ)である', statement: { type: 'genbutsu', tile: t('5m') } },
        NOT_CERTAIN('東'),
      ]),
      expected: ['s0', 's1', 's2'],
      explanation:
        '白はまだ1枚も見えていない生牌(ションパイ)です。東は場風なので役牌になります。7筒は河にあるので現物です。' +
        '5萬は河にないので現物ではありませんが、2萬が切られているので筋にはあたります。' +
        '字牌待ちの可能性が高そうでも、どの字牌かまでは断定できません。',
    }),

    // ---------------- 場面J ----------------
    readingQuestion({
      id: 'reading-28',
      difficulty: 'practical',
      tags: ['reading-not-certain'],
      selectCount: 2,
      prompt: '3巡目の早いリーチです。下家(シモチャ)に対して、特に警戒したい牌を2種類選んでください。',
      board: SCENE_J,
      hidden: HIDDEN_J,
      candidates: parse('3s6s4p7m'),
      choices: tileChoices(['3s', '6s', '4p', '7m']),
      expected: ['c0', 'c1'],
      explanation:
        '河が3枚しかないため、現物も筋もほとんどありません。4つとも無筋の数牌で、材料に差がほぼ無い状態です。' +
        'どの2つを選んでも推理としては同じ評価になります。' +
        'こういう局面では「読む」よりも、現物を探すか、そもそも危険な牌を持たない手作りを考えるのが現実的です。',
    }),
    statementQuestion({
      id: 'reading-29',
      difficulty: 'practical',
      tags: ['reading-not-certain', 'reading-genbutsu'],
      prompt: '3巡目の局面です。下家(シモチャ)について、正しい説明をすべて選んでください。',
      board: SCENE_J,
      hidden: HIDDEN_J,
      choices: statementChoices([
        { label: '2筒は現物(ゲンブツ)である', statement: { type: 'genbutsu', tile: t('2p') } },
        { label: '9萬は現物(ゲンブツ)である', statement: { type: 'genbutsu', tile: t('9m') } },
        { label: '3索は筋(スジ)にあたる', statement: { type: 'suji', tile: t('3s') } },
        { label: '6索には壁(カベ)がある', statement: { type: 'kabe', tile: t('6s') } },
        NOT_CERTAIN('6索'),
      ]),
      expected: ['s0', 's1'],
      explanation:
        '現物は2筒と9萬だけです。索子は1枚も切られていないので筋にはならず、4枚見えの牌も無いので壁もありません。' +
        '早いリーチほど情報が少なく、読みでは絞れません。',
    }),
    readingQuestion({
      id: 'reading-30',
      difficulty: 'practical',
      tags: ['reading-not-certain', 'reading-multi-wait'],
      selectCount: 3,
      prompt: '下家(シモチャ)の待ちを予想します。可能性を警戒したい牌を最大3種類まで選んでください。',
      board: SCENE_J,
      hidden: HIDDEN_J,
      candidates: parse('3s6s4p7m'),
      choices: tileChoices(['3s', '6s', '4p', '7m']),
      expected: ['c0', 'c1', 'c2'],
      explanation:
        '実際の待ちは3索・6索でした。ただし3巡目の河からこれを当てるのは不可能です。' +
        'ここで当たったとしても、それは推理が優れていたのではなく偶然です。' +
        '逆に外しても読みが悪かったわけではありません。情報が足りない局面ではそう判断することが大切です。',
    }),

    // ---------------- 場面K ----------------
    statementQuestion({
      id: 'reading-31',
      difficulty: 'beginner',
      tags: ['reading-open-hand', 'reading-not-certain'],
      prompt: '上家(カミチャ)の鳴きから読み取れることとして、正しい説明をすべて選んでください。',
      board: SCENE_K,
      hidden: HIDDEN_K,
      choices: statementChoices([
        { label: '發をポンしているので役牌(ヤクハイ)がある', statement: { type: 'yakuhai', tile: t('6z') } },
        { label: '鳴いているので門前(メンゼン)ではない', statement: { type: 'open-hand' } },
        { label: '対々和(トイトイ)が濃厚である', statement: { type: 'toitoi' } },
        { label: '混一色(ホンイツ)が濃厚である', statement: { type: 'honitsu' } },
        NOT_CERTAIN('3索'),
      ]),
      expected: ['s0', 's1'],
      explanation:
        '發のポンがあるので役牌の手です。ポンは1つだけなので対々和とは言えず、色も偏っていないので染め手でもありません。' +
        '「役牌を1つ鳴いただけの手」は、安い手のことも高い手のこともあり、鳴きだけでは中身が読めません。',
    }),
    readingQuestion({
      id: 'reading-32',
      difficulty: 'beginner',
      tags: ['reading-genbutsu', 'reading-open-hand'],
      selectCount: 2,
      prompt: '上家(カミチャ)に対して、特に警戒したい牌を2種類選んでください。',
      board: SCENE_K,
      hidden: HIDDEN_K,
      candidates: parse('3s6s1m9p'),
      choices: tileChoices(['3s', '6s', '1m', '9p']),
      expected: ['c0', 'c1'],
      explanation:
        '1萬と9筒は上家の河にある現物(ゲンブツ)なので当たりません。残る3索・6索が警戒したい牌です。' +
        '鳴いている相手でも、まず現物を探すという手順は同じです。',
    }),
    readingQuestion({
      id: 'reading-33',
      difficulty: 'beginner',
      tags: ['reading-open-hand', 'reading-not-certain'],
      selectCount: 3,
      prompt: '上家(カミチャ)の待ちを予想します。可能性を警戒したい牌を最大3種類まで選んでください。',
      board: SCENE_K,
      hidden: HIDDEN_K,
      candidates: parse('3s6s1m9p'),
      choices: tileChoices(['3s', '6s', '1m', '9p']),
      expected: ['c0', 'c1'],
      explanation:
        '実際の待ちは3索・6索でした。現物を除いた残りを警戒する、という基本の手順がそのまま的中につながっています。' +
        'ただし鳴いている相手は手牌が短いぶん形が読みにくく、いつもこう上手くいくとは限りません。',
    }),
    statementQuestion({
      id: 'reading-34',
      difficulty: 'beginner',
      tags: ['reading-genbutsu', 'reading-suji', 'reading-not-certain'],
      prompt: 'もう一度、下家(シモチャ)の河を見ます。正しい説明をすべて選んでください。',
      board: SCENE_A,
      hidden: HIDDEN_A,
      choices: statementChoices([
        { label: '9萬は現物(ゲンブツ)である', statement: { type: 'genbutsu', tile: t('9m') } },
        { label: '6索は現物(ゲンブツ)である', statement: { type: 'genbutsu', tile: t('6s') } },
        { label: '9索は筋(スジ)にあたる', statement: { type: 'suji', tile: t('9s') } },
        { label: '5萬は現物(ゲンブツ)である', statement: { type: 'genbutsu', tile: t('5m') } },
        NOT_CERTAIN('5索'),
      ]),
      expected: ['s0', 's1', 's2'],
      explanation:
        '河にある9萬と6索は現物です。6索が切られているので、その3つ違いである9索(と3索)は筋になります。' +
        '5萬は河に無いので現物ではありません。現物と筋を見分けられるようになると、守りの選択肢がぐっと増えます。',
    }),
    readingQuestion({
      id: 'reading-35',
      difficulty: 'beginner',
      tags: ['reading-genbutsu', 'reading-open-hand'],
      selectCount: 3,
      prompt: '上家(カミチャ)が待っている可能性を警戒したい牌を、最大3種類まで選んでください。',
      board: SCENE_K,
      hidden: HIDDEN_K,
      candidates: parse('3s6s2p8m1m9p'),
      choices: tileChoices(['3s', '6s', '2p', '8m', '1m', '9p']),
      expected: ['c0', 'c1', 'c3'],
      explanation:
        '1萬と9筒は現物なので候補から外します。2筒は河の5筒から筋(スジ)になります。' +
        '残る3索・6索・8萬が警戒したい牌です。実際の待ちは3索・6索でした。' +
        'まず現物と筋を除き、残った牌を警戒する、という順番が読みの基本です。',
    }),
  ];

  const QuizDataReading = {
    READING_COURSE,
    READING_QUESTIONS,
    parse,
    scene,
    hidden,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = QuizDataReading;
  } else {
    root.MJ = root.MJ || {};
    root.MJ.QuizDataReading = QuizDataReading;
  }
})(typeof window !== 'undefined' ? window : globalThis);
