/**
 * quizdata-defense.js
 * 「守備判断クイズ」(V1.8)の問題データ。
 *
 * quizdata.js が肥大化しないよう、第二弾のコースはこのファイルに分けている。
 * quizdata.js から読み込まれ、既存4コースの問題と1つの配列にまとめられる。
 *
 * 正解は defense.js / quizengine.js の resolver が毎回計算する。
 * ここに書く expected は、テストで「作問者の想定」と「エンジンの判定」を
 * 突き合わせるための参照値であり、実行時の採点には使わない。
 */
(function (root) {
  'use strict';

  // ---- 簡易表記 → 牌インデックス配列(quizdata.js と同じ書式) ----
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
  const WEST = 29;

  // ==================================================
  // コース定義と難易度
  // ==================================================

  const DEFENSE_COURSE = {
    id: 'defense',
    name: '守備判断クイズ',
    description: 'リーチされた場面で、どの牌が安全で、どの牌が危険かを根拠つきで比べます。',
    target: '現物(ゲンブツ)・筋(スジ)・壁(カベ)・ワンチャンス・字牌(ジハイ)の見え枚数・ドラ',
    icon: '守',
    note: 'ランクS以外は、統計ではなく「材料からの推測」です。筋や壁は完全な安全牌ではありません。',
    difficulties: [
      {
        id: 'beginner',
        name: '初級',
        recommended: true,
        description: '現物(ゲンブツ)と筋(スジ)だけを使う問題です。まずはここから始めましょう。',
      },
      {
        id: 'intermediate',
        name: '中級',
        description: '壁(カベ)・ワンチャンス・字牌(ジハイ)の見え枚数を使う問題です。',
      },
      {
        id: 'practical',
        name: '実戦',
        description: '複数の材料がぶつかり合う場面や、2人リーチの比較問題です。',
      },
    ],
  };

  // ==================================================
  // 盤面を作るヘルパー
  // ==================================================

  /**
   * @param {object} spec
   *   hand: 自分の手牌(13枚)
   *   self / shimocha / toimen / kamicha: 各家の河
   *   riichi: {seat, index} リーチしている席と宣言牌の位置
   *   dora: ドラ表示牌
   *   targetSeat: 評価対象の席(既定は1=下家)
   */
  function scene(spec) {
    const players = [{ seat: 0, label: '自分', isSelf: true, discards: parse(spec.self) }];
    const seats = [
      { seat: 1, label: '下家', river: spec.shimocha },
      { seat: 2, label: '対面', river: spec.toimen },
      { seat: 3, label: '上家', river: spec.kamicha },
    ];
    seats.forEach((s) => {
      if (s.river === undefined) return;
      const riichi = (spec.riichi || []).find((r) => r.seat === s.seat);
      players.push({
        seat: s.seat,
        label: s.label,
        riichi: !!riichi,
        riichiIndex: riichi ? riichi.index : undefined,
        discards: parse(s.river),
      });
    });
    return {
      hand: parse(spec.hand),
      targetSeat: spec.targetSeat === undefined ? 1 : spec.targetSeat,
      doraIndicators: parse(spec.dora),
      roundWind: spec.roundWind === undefined ? EAST : spec.roundWind,
      seatWind: spec.seatWind === undefined ? SOUTH : spec.seatWind,
      players,
    };
  }

  function tileChoices(tileStrings) {
    return tileStrings.map((s, i) => ({ id: 'c' + i, label: null, value: t(s), tile: t(s) }));
  }

  const CATEGORY_CHOICES = [
    { id: 'a', label: '現物(ゲンブツ)：この相手にはロンされない', value: 'genbutsu' },
    { id: 'b', label: '比較的安全：当たりにくいが、確実ではない', value: 'relatively-safe' },
    { id: 'c', label: '判断が必要：安全材料と危険材料が競合している', value: 'needs-judgement' },
    { id: 'd', label: '危険寄り：警戒したい牌', value: 'dangerous' },
  ];

  const REASON_CHOICES = [
    { id: 'a', label: '現物(ゲンブツ)だから', value: 'genbutsu' },
    { id: 'b', label: '筋(スジ)だから', value: 'suji' },
    { id: 'c', label: '壁(カベ)があるから', value: 'kabe' },
    { id: 'd', label: 'ワンチャンスだから', value: 'one-chance' },
    { id: 'e', label: '字牌の残りが少ないから', value: 'honor-few' },
    { id: 'f', label: '端の牌(1・9)だから', value: 'terminal' },
    { id: 'g', label: '字牌が4枚とも見えていて、相手が1枚も持てないから', value: 'honor-dead' },
  ];

  // ==================================================
  // 場面(複数の問題で使い回す)
  // ==================================================

  // 場面1: 下家リーチ。河に3筒。現物・片スジ・無筋・端牌を比べる。
  const SCENE_BASIC = {
    hand: '5m234m678m367p55s9s',
    shimocha: '9m3p1z5s',
    toimen: '2z7p',
    riichi: [{ seat: 1, index: 2 }],
  };

  // 場面2: 下家リーチ。河に2筒・5萬。筋になる牌が複数ある。
  const SCENE_SUJI = {
    hand: '28m456m5p789p145s5s',
    shimocha: '2p5m6s7z',
    toimen: '1z9p',
    riichi: [{ seat: 1, index: 1 }],
  };

  // 場面3: 4筒が4枚見え(壁)。7索が3枚見え(ワンチャンス)。
  const SCENE_KABE = {
    hand: '234m5m678m44p2p77s9s',
    shimocha: '4p7s1z',
    toimen: '4p6z',
    riichi: [{ seat: 1, index: 2 }],
  };

  // 場面4: 字牌の見え枚数を比べる(場風=東、自風=西)。
  const SCENE_HONOR = {
    hand: '234m678m55p3s1z2z4z5z',
    shimocha: '9m3p5s6z',
    toimen: '2z2z5s',
    kamicha: '2z4z1z7z',
    riichi: [{ seat: 1, index: 3 }],
    roundWind: EAST,
    seatWind: WEST,
  };

  // 場面5: ドラは5萬(表示牌4萬)。ドラ・ドラ周辺・現物を比べる。
  const SCENE_DORA = {
    hand: '156m234p678p55s3s9s',
    shimocha: '1m6p1z3s',
    toimen: '2z7z',
    riichi: [{ seat: 1, index: 2 }],
    dora: '4m',
  };

  // 場面6: 下家と対面の2人リーチ。
  const SCENE_TWO_RIICHI = {
    hand: '5m234m36p789p9s145s',
    shimocha: '3p7s1z',
    toimen: '5m2s6z',
    riichi: [
      { seat: 1, index: 1 },
      { seat: 2, index: 1 },
    ],
  };

  // ==================================================
  // 問題
  // ==================================================

  function q(spec) {
    return Object.assign({ course: 'defense' }, spec);
  }

  const DEFENSE_QUESTIONS = [
    // ---------- 初級: 現物と筋 ----------
    q({
      id: 'defense-01',
      difficulty: 'beginner',
      tags: ['genbutsu'],
      multi: false,
      prompt: '下家(シモチャ)がリーチしています。この中で、下家に対して最も安全な牌を選んでください。',
      board: scene(SCENE_BASIC),
      candidates: parse('3p6p5m9s'),
      choices: tileChoices(['3p', '6p', '5m', '9s']),
      resolver: 'safestTiles',
      expected: ['c0'],
      explanation:
        '3筒は下家自身が捨てているので現物(ゲンブツ)です。現物だけが「この相手にはロンされない」と言い切れる牌で、' +
        '筋(スジ)や端の牌は「当たりにくい」だけです。迷ったらまず現物を探しましょう。',
    }),
    q({
      id: 'defense-02',
      difficulty: 'beginner',
      tags: ['genbutsu'],
      multi: false,
      prompt: '下家(シモチャ)がリーチしています。3筒の安全度はどれに当てはまりますか。',
      board: scene(SCENE_BASIC),
      candidates: parse('3p6p5m9s'),
      choices: CATEGORY_CHOICES,
      resolver: 'safetyCategory',
      resolverArgs: { tile: t('3p') },
      expected: ['a'],
      explanation:
        '3筒は下家の河にあるため現物(ゲンブツ)です。自分が捨てた牌ではロンできない(振聴(フリテン))というルールがあるため、' +
        'この相手に限れば絶対に当たりません。ただし他家に対しては別で、安全とは限りません。',
    }),
    q({
      id: 'defense-03',
      difficulty: 'beginner',
      tags: ['suji-basic'],
      multi: false,
      prompt: '下家(シモチャ)がリーチしています。6筒が比較的安全と考えられる理由はどれですか。',
      board: scene(SCENE_BASIC),
      candidates: parse('3p6p5m9s'),
      choices: REASON_CHOICES,
      resolver: 'safetyReasonKeys',
      resolverArgs: { tile: t('6p') },
      expected: ['b'],
      explanation:
        '下家の河に3筒があるため、6筒は筋(スジ)にあたります。4筒5筒を持って3筒・6筒を待つ両面待ち(リャンメンマチ)は、' +
        '3筒を自分で捨てている時点でロンできません(振聴(フリテン))。ただし嵌張(カンチャン)や双碰(シャンポン)には当たるため、現物とは別物です。',
    }),
    q({
      id: 'defense-04',
      difficulty: 'beginner',
      tags: ['suji-basic'],
      multi: true,
      prompt:
        '下家(シモチャ)がリーチしています。河に現物はありません。この中で最も安全と考えられる牌を、すべて選んでください。',
      board: scene(SCENE_SUJI),
      candidates: parse('5p2m8m4s'),
      choices: tileChoices(['5p', '2m', '8m', '4s']),
      resolver: 'safestTiles',
      expected: ['c1', 'c2'],
      explanation:
        '下家の河に5萬があるので、2萬と8萬はどちらも筋(スジ)です。2萬を両面待ちにできるのは3萬4萬の形だけ、' +
        '8萬は6萬7萬の形だけで、どちらも5萬が捨てられている時点でロンできません。' +
        '5筒は2筒の筋ですが、6筒7筒の形(5筒・8筒待ち)が残っているため片方しか否定できません(片スジ)。',
    }),
    q({
      id: 'defense-05',
      difficulty: 'beginner',
      tags: ['suji-not-safe'],
      multi: false,
      prompt: '下家(シモチャ)がリーチしています。この中で、最も警戒したい牌を選んでください。',
      board: scene(SCENE_BASIC),
      candidates: parse('3p6p5m9s'),
      choices: tileChoices(['3p', '6p', '5m', '9s']),
      resolver: 'mostDangerousTiles',
      expected: ['c2'],
      explanation:
        '5萬は下家の河にも、その筋(2萬・8萬)にも該当しない無筋(ムスジ)の中張牌(3〜7)です。' +
        '両面・嵌張・辺張・双碰・単騎のどの待ちにも当たり得るため、最も警戒される牌になります。' +
        'ただし「必ず当たる牌」という意味ではありません。あくまで比較の結果です。',
    }),
    q({
      id: 'defense-06',
      difficulty: 'beginner',
      tags: ['suji-not-safe'],
      multi: false,
      prompt: '下家(シモチャ)がリーチしています。5萬の安全度はどれに当てはまりますか。',
      board: scene(SCENE_BASIC),
      candidates: parse('3p6p5m9s'),
      choices: CATEGORY_CHOICES,
      resolver: 'safetyCategory',
      resolverArgs: { tile: t('5m') },
      expected: ['d'],
      explanation:
        '5萬には安全材料が1つもありません(現物でも筋でもない中張牌)。こういう牌を無筋(ムスジ)と呼び、危険寄りと判断します。',
    }),
    q({
      id: 'defense-07',
      difficulty: 'beginner',
      tags: ['genbutsu', 'suji-basic'],
      multi: false,
      prompt: '下家(シモチャ)がリーチしています。3筒が安全と言い切れる理由はどれですか。',
      board: scene(SCENE_BASIC),
      candidates: parse('3p6p5m9s'),
      choices: REASON_CHOICES,
      resolver: 'safetyReasonKeys',
      resolverArgs: { tile: t('3p') },
      expected: ['a'],
      explanation:
        '3筒は下家自身の捨て牌なので現物(ゲンブツ)です。筋・壁・ワンチャンスは「当たりにくい理由」ですが、' +
        '現物だけが「この相手には当たらない」と言い切れる根拠になります。',
    }),
    q({
      id: 'defense-08',
      difficulty: 'beginner',
      tags: ['genbutsu', 'suji-basic'],
      multi: true,
      prompt:
        '下家(シモチャ)がリーチしています。この中で最も安全と考えられる牌を、すべて選んでください。(同じ評価の牌が複数あります)',
      board: scene(SCENE_DORA),
      candidates: parse('1m5m6m3s'),
      choices: tileChoices(['1m', '5m', '6m', '3s']),
      resolver: 'safestTiles',
      expected: ['c0', 'c3'],
      explanation:
        '1萬と3索はどちらも下家の河にある現物(ゲンブツ)で、同じく絶対に当たりません。どちらを切っても構いません。' +
        '現物が複数あるときは、自分の手牌に残したい牌の方を残して、いらない方から切ります。',
    }),
    q({
      id: 'defense-09',
      difficulty: 'beginner',
      tags: ['suji-basic', 'genbutsu'],
      multi: true,
      mode: 'order',
      prompt:
        '下家(シモチャ)がリーチしています。安全と考えやすい順に、牌をタップして並べてください。(安全な牌から順に選びます)',
      board: scene(SCENE_BASIC),
      candidates: parse('3p6p5m9s'),
      choices: tileChoices(['3p', '6p', '5m', '9s']),
      resolver: 'safetyOrder',
      expected: ['c0', 'c1', 'c3', 'c2'],
      explanation:
        '1番目は現物の3筒。次は片スジの6筒と端の9索で、この2つは材料が同程度なので同じ扱い(どちらが先でも正解)です。' +
        '最後が無筋の中張牌である5萬になります。',
    }),
    q({
      id: 'defense-10',
      difficulty: 'beginner',
      tags: ['suji-not-safe'],
      multi: false,
      prompt: '下家(シモチャ)がリーチしています。片スジの6筒の安全度はどれに当てはまりますか。',
      board: scene(SCENE_BASIC),
      candidates: parse('3p6p5m9s'),
      choices: CATEGORY_CHOICES,
      resolver: 'safetyCategory',
      resolverArgs: { tile: t('6p') },
      expected: ['c'],
      explanation:
        '6筒は3筒の筋ですが、否定できるのは4筒5筒の両面待ちだけです。7筒8筒(6筒・9筒待ち)の形は残っていますし、' +
        '嵌張・双碰・単騎にも当たります。安全材料と危険材料が競合しているため「判断が必要」になります。',
    }),
    q({
      id: 'defense-11',
      difficulty: 'beginner',
      tags: ['suji-basic'],
      multi: false,
      prompt: '下家(シモチャ)がリーチしています。この中で最も警戒したい牌を選んでください。',
      board: scene(SCENE_SUJI),
      candidates: parse('5p2m8m4s'),
      choices: tileChoices(['5p', '2m', '8m', '4s']),
      resolver: 'mostDangerousTiles',
      expected: ['c3'],
      explanation:
        '4索は現物でも筋でもない無筋(ムスジ)の中張牌です。5筒は片スジ、2萬・8萬は筋なので、比較の結果4索が最も危険寄りになります。',
    }),
    q({
      id: 'defense-12',
      difficulty: 'beginner',
      tags: ['suji-basic'],
      multi: false,
      prompt: '下家(シモチャ)がリーチしています。2萬が比較的安全と考えられる理由はどれですか。',
      board: scene(SCENE_SUJI),
      candidates: parse('5p2m8m4s'),
      choices: REASON_CHOICES,
      resolver: 'safetyReasonKeys',
      resolverArgs: { tile: t('2m') },
      expected: ['b'],
      explanation:
        '下家の河に5萬があるため2萬は筋(スジ)です。2萬を両面で待つには3萬4萬を持つしかなく、それは5萬でもロンできる形なので、' +
        '5萬を捨てている下家はロンできません。ただし1萬3萬の嵌張(カンチャン)や双碰・単騎には当たります。',
    }),

    // ---------- 中級: 壁・ワンチャンス・字牌 ----------
    q({
      id: 'defense-13',
      difficulty: 'intermediate',
      tags: ['kabe'],
      multi: false,
      prompt:
        '下家(シモチャ)がリーチしています。4筒はすでに4枚見えています(壁(カベ))。この中で最も安全と考えられる牌を選んでください。',
      board: scene(SCENE_KABE),
      candidates: parse('2p9s6m5m'),
      choices: tileChoices(['2p', '9s', '6m', '5m']),
      resolver: 'safestTiles',
      expected: ['c0'],
      explanation:
        '2筒を両面待ちにできるのは3筒4筒の形だけですが、4筒は4枚とも見えているので、その形は存在し得ません(壁(カベ))。' +
        'つまり2筒は両面では当たりません。ただし1筒3筒の嵌張や、双碰・単騎には当たるため現物とは違います。',
    }),
    q({
      id: 'defense-14',
      difficulty: 'intermediate',
      tags: ['kabe'],
      multi: false,
      prompt: '下家(シモチャ)がリーチしています。2筒が比較的安全と考えられる理由はどれですか。',
      board: scene(SCENE_KABE),
      candidates: parse('2p9s6m5m'),
      choices: REASON_CHOICES,
      resolver: 'safetyReasonKeys',
      resolverArgs: { tile: t('2p') },
      expected: ['c'],
      explanation:
        '4筒が4枚とも見えているため、3筒4筒という形を誰も持てません。これが壁(カベ)の考え方です。' +
        '筋(スジ)は「相手の河」を根拠にしますが、壁は「場に見えている枚数」を根拠にします。根拠が違うので区別して覚えましょう。',
    }),
    q({
      id: 'defense-15',
      difficulty: 'intermediate',
      tags: ['kabe', 'one-chance'],
      multi: false,
      prompt:
        '下家(シモチャ)がリーチしています。4筒は4枚見え(壁)、7索は3枚見え(ワンチャンス)です。より安全と考えられるのはどちらですか。',
      board: scene(SCENE_KABE),
      candidates: parse('2p9s'),
      choices: tileChoices(['2p', '9s']),
      resolver: 'safestTiles',
      expected: ['c0'],
      explanation:
        '壁(カベ)は「その形が作れない」と言い切れますが、ワンチャンスは「残り1枚を相手が持っていれば当たる」ため根拠が弱くなります。' +
        '9索は7索8索の形が作りにくいだけで、可能性はゼロではありません。壁 > ワンチャンス の順で信頼しましょう。',
    }),
    q({
      id: 'defense-16',
      difficulty: 'intermediate',
      tags: ['one-chance'],
      multi: false,
      prompt: '下家(シモチャ)がリーチしています。9索が比較的安全と考えられる理由はどれですか(端の牌であること以外の理由)。',
      board: scene(SCENE_KABE),
      candidates: parse('2p9s6m5m'),
      choices: REASON_CHOICES.filter((c) => c.value !== 'terminal'),
      resolver: 'safetyReasonKeys',
      resolverArgs: { tile: t('9s') },
      expected: ['d'],
      explanation:
        '7索は自分の手に2枚、下家の河に1枚で合計3枚見えています。残り1枚しかないため、7索8索という形は作りにくくなります。' +
        'これがワンチャンスです。「安全」ではなく「比較材料の一つ」として使ってください。',
    }),
    q({
      id: 'defense-17',
      difficulty: 'intermediate',
      tags: ['one-chance', 'kabe'],
      multi: false,
      prompt: '下家(シモチャ)がリーチしています。9索の安全度はどれに当てはまりますか。',
      board: scene(SCENE_KABE),
      candidates: parse('2p9s6m5m'),
      choices: CATEGORY_CHOICES,
      resolver: 'safetyCategory',
      resolverArgs: { tile: t('9s') },
      expected: ['b'],
      explanation:
        '9索は端の牌で待たれる形が少なく、さらに7索が3枚見えでワンチャンスです。比較的安全と言えますが、' +
        '残り1枚の7索を相手が持っていれば当たりますし、双碰・単騎の可能性も残ります。現物とは区別してください。',
    }),
    q({
      id: 'defense-18',
      difficulty: 'intermediate',
      tags: ['honor-tile'],
      multi: false,
      prompt:
        '下家(シモチャ)がリーチしています。場風は東(トン)、自風は西(シャー)です。この中で最も安全な牌を選んでください。',
      board: scene(SCENE_HONOR),
      candidates: parse('2z4z1z5z'),
      choices: tileChoices(['2z', '4z', '1z', '5z']),
      resolver: 'safestTiles',
      expected: ['c0'],
      explanation:
        '南は場に3枚見えていて、自分の手にある1枚を合わせると4枚すべてが見えています。' +
        '字牌は手の中に持っていないとロンできない(双碰か単騎だけ)ので、残り0枚の字牌は理論上ロンされません。' +
        '数牌は持っていない牌でも両面待ちで当たるので、この理屈は字牌だけのものです。',
    }),
    q({
      id: 'defense-19',
      difficulty: 'intermediate',
      tags: ['honor-tile', 'live-honor'],
      multi: true,
      mode: 'order',
      prompt:
        '場風は東(トン)、自風は西(シャー)です。字牌を安全と考えやすい順にタップして並べてください。',
      board: scene(SCENE_HONOR),
      candidates: parse('2z4z1z5z'),
      choices: tileChoices(['2z', '4z', '1z', '5z']),
      resolver: 'safetyOrder',
      expected: ['c0', 'c1', 'c2', 'c3'],
      explanation:
        '南は4枚とも見えていてロンされません。北は2枚見えで、しかも客風(オタカゼ)なので残されにくい牌です。' +
        '東は場風の役牌なので対子(トイツ)で持たれている可能性があり、白はまだ1枚も見えていない生牌(ションパイ)の役牌なので最も危険です。' +
        '字牌は「見えている枚数」と「役牌かどうか」の2つで安全度が変わります。',
    }),
    q({
      id: 'defense-20',
      difficulty: 'intermediate',
      tags: ['live-honor'],
      multi: false,
      prompt: '場風は東(トン)、自風は西(シャー)です。この中で最も警戒したい牌を選んでください。',
      board: scene(SCENE_HONOR),
      candidates: parse('2z4z1z5z'),
      choices: tileChoices(['2z', '4z', '1z', '5z']),
      resolver: 'mostDangerousTiles',
      expected: ['c3'],
      explanation:
        '白は三元牌(サンゲンパイ)で、誰にとっても役牌(ヤクハイ)になります。まだ1枚も見えていない生牌(ションパイ)なので、' +
        '相手が対子で持っていて双碰(シャンポン)待ちにしている可能性があります。終盤の生牌の役牌は特に注意が必要です。',
    }),
    q({
      id: 'defense-21',
      difficulty: 'intermediate',
      tags: ['honor-tile'],
      multi: false,
      prompt: '場風は東(トン)、自風は西(シャー)です。北(客風)の安全度はどれに当てはまりますか。',
      board: scene(SCENE_HONOR),
      candidates: parse('2z4z1z5z'),
      choices: CATEGORY_CHOICES,
      resolver: 'safetyCategory',
      resolverArgs: { tile: t('4z') },
      expected: ['b'],
      explanation:
        '北は場風でも自風でもない客風(オタカゼ)で、役にならないため残されにくい字牌です。さらに2枚見えているので残りは2枚。' +
        '相手が2枚とも持っていなければ双碰待ちにはなりません。ただし単騎待ちの可能性は残ります。',
    }),
    q({
      id: 'defense-22',
      difficulty: 'intermediate',
      tags: ['honor-tile'],
      multi: false,
      prompt: '南が安全と言える理由はどれですか。',
      board: scene(SCENE_HONOR),
      candidates: parse('2z4z1z5z'),
      choices: REASON_CHOICES,
      resolver: 'safetyReasonKeys',
      resolverArgs: { tile: t('2z') },
      expected: ['g'],
      explanation:
        '南は4枚とも見えているため、相手は1枚も持てません。字牌は双碰(シャンポン)か単騎(タンキ)でしか当たらず、' +
        'どちらも手の中にその字牌が必要なので、残り0枚ならロンされません。下家の河にある牌ではないので、現物ではありません。',
    }),
    q({
      id: 'defense-23',
      difficulty: 'intermediate',
      tags: ['kabe', 'suji-not-safe'],
      multi: false,
      prompt: '下家(シモチャ)がリーチしています。壁がある場面での6萬の安全度はどれに当てはまりますか。',
      board: scene(SCENE_KABE),
      candidates: parse('2p9s6m5m'),
      choices: CATEGORY_CHOICES,
      resolver: 'safetyCategory',
      resolverArgs: { tile: t('6m') },
      expected: ['d'],
      explanation:
        '壁があるのは4筒の周りだけで、6萬には何の関係もありません。6萬は現物でも筋でもない無筋(ムスジ)の中張牌なので危険寄りです。' +
        '「この場に壁がある」ことと「今から切る牌が安全」であることは別問題です。',
    }),

    // ---------- 実戦: 複数材料の比較 ----------
    q({
      id: 'defense-24',
      difficulty: 'practical',
      tags: ['dora-danger'],
      multi: false,
      prompt:
        '下家(シモチャ)がリーチしています。ドラは5萬(表示牌は4萬)です。この中で最も警戒したい牌を選んでください。',
      board: scene(SCENE_DORA),
      candidates: parse('1m5m6m3s'),
      choices: tileChoices(['1m', '5m', '6m', '3s']),
      resolver: 'mostDangerousTiles',
      expected: ['c1'],
      explanation:
        '5萬は無筋の中張牌であることに加えてドラです。ドラは手の中に残されやすく、待ちに絡みやすいため、' +
        '同じ無筋でもより警戒したい牌になります。放銃したときの失点も大きくなります。',
    }),
    q({
      id: 'defense-25',
      difficulty: 'practical',
      tags: ['dora-danger', 'multi-factor'],
      multi: false,
      prompt: 'ドラは5萬です。ドラの隣である6萬の安全度はどれに当てはまりますか。',
      board: scene(SCENE_DORA),
      candidates: parse('1m5m6m3s'),
      choices: CATEGORY_CHOICES,
      resolver: 'safetyCategory',
      resolverArgs: { tile: t('6m') },
      expected: ['d'],
      explanation:
        '6萬は無筋の中張牌で、さらにドラ(5萬)の隣です。ドラを含む順子(456萬・567萬)を作るために残されやすいため、' +
        'ふつうの無筋よりもう一段警戒したい牌になります。ただしドラそのものである5萬よりは危険度は下です。',
    }),
    q({
      id: 'defense-26',
      difficulty: 'practical',
      tags: ['dora-danger', 'genbutsu'],
      multi: true,
      mode: 'order',
      prompt: 'ドラは5萬です。安全と考えやすい順に、牌をタップして並べてください。',
      board: scene(SCENE_DORA),
      candidates: parse('1m3s6m5m'),
      choices: tileChoices(['1m', '3s', '6m', '5m']),
      resolver: 'safetyOrder',
      expected: ['c0', 'c1', 'c2', 'c3'],
      explanation:
        '1萬と3索はどちらも現物なので同じ扱い(どちらが先でも正解)です。次がドラ隣の6萬、最後がドラそのものの5萬になります。' +
        '「ドラだから必ず最も危険」ではなく、現物であればドラでも安全である点に注意してください。',
    }),
    q({
      id: 'defense-27',
      difficulty: 'practical',
      tags: ['multi-factor', 'genbutsu'],
      multi: false,
      prompt: '下家(シモチャ)がリーチしています。ドラは5萬です。この中で最も安全な牌を選んでください。',
      board: scene(SCENE_DORA),
      candidates: parse('5m6m1m'),
      choices: tileChoices(['5m', '6m', '1m']),
      resolver: 'safestTiles',
      expected: ['c2'],
      explanation:
        '1萬は下家の河にある現物(ゲンブツ)です。ドラかどうかは安全度とは別の話で、現物であれば当たりません。' +
        '逆に「ドラだから」という理由だけで切る牌を決めないようにしましょう。',
    }),
    q({
      id: 'defense-28',
      difficulty: 'practical',
      tags: ['multi-riichi'],
      multi: false,
      prompt:
        '下家(シモチャ)と対面(トイメン)の2人がリーチしています。まず下家に対して最も安全な牌を選んでください。',
      board: scene(SCENE_TWO_RIICHI),
      candidates: parse('3p5m6p9s'),
      choices: tileChoices(['3p', '5m', '6p', '9s']),
      resolver: 'safestTiles',
      expected: ['c0'],
      explanation:
        '3筒は下家の河にあるので、下家に対しては現物です。5萬は対面の現物ですが、下家は捨てていないため下家には当たり得ます。' +
        '2人リーチのときは「誰に対して安全か」を必ず分けて考えます。',
    }),
    q({
      id: 'defense-29',
      difficulty: 'practical',
      tags: ['multi-riichi'],
      multi: false,
      prompt: '同じ場面です。今度は対面(トイメン)に対して最も安全な牌を選んでください。',
      board: scene(Object.assign({}, SCENE_TWO_RIICHI, { targetSeat: 2 })),
      candidates: parse('3p5m6p9s'),
      choices: tileChoices(['3p', '5m', '6p', '9s']),
      resolver: 'safestTiles',
      expected: ['c1'],
      explanation:
        '同じ手牌・同じ場面でも、対象が変われば答えは変わります。対面の河には5萬があるので、対面に対しては5萬が現物です。' +
        'つまり3筒と5萬は「片方には安全、もう片方には危険」という関係です。2人リーチでは両方の河に載っている牌を探すのが基本になります。',
    }),
    q({
      id: 'defense-30',
      difficulty: 'practical',
      tags: ['multi-riichi', 'suji-not-safe'],
      multi: false,
      prompt: '2人リーチの場面です。対面に対する3筒の安全度はどれに当てはまりますか。',
      board: scene(Object.assign({}, SCENE_TWO_RIICHI, { targetSeat: 2 })),
      candidates: parse('3p5m6p9s'),
      choices: CATEGORY_CHOICES,
      resolver: 'safetyCategory',
      resolverArgs: { tile: t('3p') },
      expected: ['d'],
      explanation:
        '3筒は下家に対しては現物ですが、対面の河には3筒も6筒もありません。対面から見れば安全材料が1つも無い無筋(ムスジ)の中張牌で、危険寄りです。' +
        '「誰かに対して現物」という理由で全員に安全だと思い込まないようにしましょう。',
    }),
    q({
      id: 'defense-31',
      difficulty: 'practical',
      tags: ['multi-factor', 'kabe', 'suji-basic'],
      multi: true,
      mode: 'order',
      prompt:
        '下家(シモチャ)がリーチしています。4筒は4枚見え、7索は3枚見えです。安全と考えやすい順にタップして並べてください。',
      board: scene(SCENE_KABE),
      candidates: parse('2p9s6m5m'),
      choices: tileChoices(['2p', '9s', '6m', '5m']),
      resolver: 'safetyOrder',
      expected: ['c0', 'c1', 'c2', 'c3'],
      explanation:
        '1番目は壁で両面待ちを否定できる2筒。次がワンチャンス+端牌の9索。' +
        '6萬と5萬はどちらも無筋の中張牌で材料が同じなので同じ扱い(どちらが先でも正解)になります。' +
        '材料が同程度のときは、無理に順位を決める必要はありません。',
    }),
    q({
      id: 'defense-32',
      difficulty: 'practical',
      tags: ['multi-factor'],
      multi: true,
      prompt:
        '下家(シモチャ)がリーチしています。この中で最も安全と考えられる牌を、すべて選んでください。',
      board: scene(SCENE_HONOR),
      candidates: parse('2z4z3s5p'),
      choices: tileChoices(['2z', '4z', '3s', '5p']),
      resolver: 'safestTiles',
      expected: ['c0'],
      explanation:
        '南は4枚とも見えている字牌なので、この中では唯一「ロンされない」と言い切れる牌です。' +
        '北は2枚見えの客風で比較的安全ですが確実ではなく、3索と5筒は無筋の数牌です。' +
        '字牌の見え枚数は、数牌の筋よりも強い根拠になることがあります。',
    }),
    q({
      id: 'defense-33',
      difficulty: 'practical',
      tags: ['multi-riichi', 'suji-not-safe'],
      multi: false,
      prompt: '2人リーチの場面です。下家(シモチャ)に対して、最も警戒したい牌を選んでください。',
      board: scene(SCENE_TWO_RIICHI),
      candidates: parse('3p5m6p9s'),
      choices: tileChoices(['3p', '5m', '6p', '9s']),
      resolver: 'mostDangerousTiles',
      expected: ['c1'],
      explanation:
        '5萬は対面の現物ですが、下家から見れば安全材料が1つも無い無筋(ムスジ)の中張牌です。' +
        '「誰かに通っている牌」は、その相手にだけ安全であることを思い出してください。',
    }),
    q({
      id: 'defense-34',
      difficulty: 'practical',
      tags: ['multi-factor', 'suji-basic'],
      multi: true,
      mode: 'order',
      prompt: '下家(シモチャ)がリーチしています。安全と考えやすい順に、3枚の牌をタップして並べてください。',
      board: scene(SCENE_SUJI),
      candidates: parse('2m5p4s'),
      choices: tileChoices(['2m', '5p', '4s']),
      resolver: 'safetyOrder',
      expected: ['c0', 'c1', 'c2'],
      explanation:
        '2萬は5萬の筋で、両面待ちの形をすべて否定できます。5筒は2筒の片スジで、否定できるのは半分だけ。' +
        '4索は無筋の中張牌で安全材料がありません。根拠の強さは 現物 > 両側を否定できる筋・壁 > 片スジ > 無筋 の順です。',
    }),
    q({
      id: 'defense-35',
      difficulty: 'practical',
      tags: ['suji-basic', 'multi-factor'],
      multi: false,
      prompt: '下家(シモチャ)がリーチしています。両側の両面形を否定できる2萬の安全度はどれに当てはまりますか。',
      board: scene(SCENE_SUJI),
      candidates: parse('5p2m8m4s'),
      choices: CATEGORY_CHOICES,
      resolver: 'safetyCategory',
      resolverArgs: { tile: t('2m') },
      expected: ['b'],
      explanation:
        '2萬は順子(シュンツ)で待たれる形をすべて否定できるため、比較的安全と言えます。' +
        'ただし1萬3萬の嵌張(カンチャン)や、双碰(シャンポン)・単騎(タンキ)待ちには当たるため、現物のように「絶対」ではありません。',
    }),
  ];

  const QuizDataDefense = {
    DEFENSE_COURSE,
    DEFENSE_QUESTIONS,
    parse,
    scene,
    CATEGORY_CHOICES,
    REASON_CHOICES,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = QuizDataDefense;
  } else {
    root.MJ = root.MJ || {};
    root.MJ.QuizDataDefense = QuizDataDefense;
  }
})(typeof window !== 'undefined' ? window : globalThis);
