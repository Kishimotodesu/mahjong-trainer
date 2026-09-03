/**
 * lessons.js
 * 「ルールを牌で理解する」ミニレッスンのデータ定義(データ駆動)。
 *
 * 設計方針(V1.5):
 *  - ここには「見た目・問題文・選択肢・解説文」などのコンテンツだけを書く。
 *  - 正解の判定は書かない(ハードコードしない)。判定が必要なステップは
 *    resolver(lessonengine.js が知っている判定名)と resolverArgs だけを持ち、
 *    実際の正誤は本番と同じロジック(yaku.js / furiten.js など)で計算する。
 *  - こうすることで、字牌・フリテン以外のテーマ(鳴き・リーチ・スジ・壁など)を
 *    同じ仕組みで追加しやすくする。
 *
 * 牌インデックス(参考): 0=1萬, 27=東, 28=南, 29=西, 30=北, 31=白, 32=發, 33=中
 */
(function (root) {
  'use strict';

  const M = (n) => n - 1; // 1萬〜9萬 → 0〜8
  const EAST = 27;
  const SOUTH = 28;
  const WEST = 29;
  const NORTH = 30;
  const HAKU = 31;
  const HATSU = 32;
  const CHUN = 33;

  const LESSONS = [
    {
      id: 'honors',
      title: '字牌を学ぶ',
      category: 'rules',
      level: 1,
      beginnerGoal: '字牌がどう役に結びつくかを、実際の牌の枚数の変化を見ながら理解する',
      relatedTerms: ['字牌', '役牌', '場風', '自風'],
      steps: [
        {
          kind: 'info',
          id: 'intro',
          title: '字牌とは',
          visual: { tiles: [EAST, SOUTH, WEST, NORTH, HAKU, HATSU, CHUN] },
          body: 'これら7種類(東・南・西・北・白・發・中)を「字牌」と呼びます。萬子・筒子・索子のような数字はありません。',
        },
        {
          kind: 'quiz',
          id: 'sequence-yes',
          title: '順子になる?(数牌)',
          question: 'この3枚は順子(連続した3枚)になっていますか?',
          visual: { tiles: [M(3), M(4), M(5)] },
          resolver: 'isSequence',
          resolverArgs: { tiles: [M(3), M(4), M(5)] },
          choices: [
            { id: 'yes', label: '順子になる', value: true },
            { id: 'no', label: '順子にならない', value: false },
          ],
          beginnerPoint: '3萬・4萬・5萬のように数字が1つずつ並んでいれば順子です。',
          explanation: '3・4・5と数字が連続しているので、これは順子です。',
        },
        {
          kind: 'quiz',
          id: 'sequence-no-honor',
          title: '順子になる?(字牌)',
          question: '東・南・西のこの3枚は順子になっていますか?',
          visual: { tiles: [EAST, SOUTH, WEST] },
          resolver: 'isSequence',
          resolverArgs: { tiles: [EAST, SOUTH, WEST] },
          choices: [
            { id: 'yes', label: '順子になる', value: true },
            { id: 'no', label: '順子にならない', value: false },
          ],
          beginnerPoint: '字牌には数字の並びが無いので、順子は絶対に作れません。',
          explanation:
            '東→南→西という並びに見えても、麻雀のルール上は関係ありません。字牌で順子を作ることはできず、対子・刻子(・槓子)しか作れません。',
        },
        {
          kind: 'info',
          id: 'isolated',
          title: '1枚: 孤立字牌',
          visual: { tiles: [HATSU], highlight: [HATSU] },
          body: '發が1枚だけの状態です。順子が作れない字牌が1枚だけだと、他の牌と組み合わせる方法がありません。まず切る候補になりやすい牌です。',
        },
        {
          kind: 'quiz',
          id: 'pair-not-yaku',
          title: '2枚: 對子になった發は役牌?',
          question: '發が2枚(対子)になりました。この時点で「役牌1翻」は確定していますか?',
          visual: { tiles: [HATSU, HATSU] },
          resolver: 'yakuhaiFromCount',
          resolverArgs: { tile: HATSU, count: 2, ctx: null },
          choices: [
            { id: 'yes', label: 'もう役牌が確定している', value: true },
            { id: 'no', label: 'まだ確定していない', value: false },
          ],
          beginnerPoint: '對子(2枚)はまだ刻子ではないので、役はまだ成立していません。',
          explanation:
            '發が対子になった時点では、まだ役は成立していません。あと1枚發が来て刻子(3枚)になるか、他家の發をポンして刻子にすると、初めて役牌1翻が確定します。',
        },
        {
          kind: 'quiz',
          id: 'triplet-dragon',
          title: '3枚: 發發發は役牌?',
          question: '發が3枚(刻子)になりました。役牌1翻は成立していますか?',
          visual: { tiles: [HATSU, HATSU, HATSU] },
          resolver: 'yakuhaiFromCount',
          resolverArgs: { tile: HATSU, count: 3, ctx: null },
          choices: [
            { id: 'yes', label: '成立している', value: true },
            { id: 'no', label: '成立していない', value: false },
          ],
          beginnerPoint: '白・發・中(三元牌)は、3枚集めるとそれだけで役が1つ確保できます。',
          explanation:
            '發の刻子ができたので「役牌:發」1翻が成立します。白・發・中はポンして刻子を作っても同じように役になります。',
        },
        {
          kind: 'quiz',
          id: 'kan-still-yaku',
          title: '4枚: 發發發發でも役牌?',
          question: '發が4枚(槓子)になりました。役牌1翻は成立していますか?',
          visual: { tiles: [HATSU, HATSU, HATSU, HATSU] },
          resolver: 'yakuhaiFromCount',
          resolverArgs: { tile: HATSU, count: 4, ctx: null },
          choices: [
            { id: 'yes', label: '成立している', value: true },
            { id: 'no', label: '成立していない', value: false },
          ],
          beginnerPoint: '槓子(4枚)でも役牌としての価値は変わりません。',
          explanation: '4枚(槓子)にしても引き続き役牌:發として扱われます。',
        },
        {
          kind: 'info',
          id: 'wind-context-intro',
          title: '風牌は「場」と「自分」で価値が変わる',
          body:
            '風牌(東南西北)は三元牌と違い、「いつでも役になる」わけではありません。今のゲーム全体の風(場風)と、自分の座席の風(自風)によって、価値が変わります。',
        },
        {
          kind: 'quiz',
          id: 'wind-round',
          title: '場風の役牌',
          question: '今は「東場」です。あなたが東の刻子を作ったら役牌になりますか?',
          visual: { tiles: [EAST, EAST, EAST] },
          context: { roundWindLabel: '東場', seatWindLabel: '南家' },
          resolver: 'yakuhaiFromCount',
          resolverArgs: { tile: EAST, count: 3, ctx: { roundWind: EAST, seatWind: SOUTH } },
          choices: [
            { id: 'yes', label: '役牌になる', value: true },
            { id: 'no', label: '役牌にならない', value: false },
          ],
          beginnerPoint: '今のゲーム全体が東場なので、東は全員にとって価値がある牌(場風)です。',
          explanation: '場風(今のゲーム全体の風)と一致する刻子は役牌になります。今は東場なので、東の刻子は場風の役牌です。',
        },
        {
          kind: 'quiz',
          id: 'wind-seat',
          title: '自風の役牌',
          question: 'あなたは「南家」です。あなたが南の刻子を作ったら役牌になりますか?',
          visual: { tiles: [SOUTH, SOUTH, SOUTH] },
          context: { roundWindLabel: '東場', seatWindLabel: '南家' },
          resolver: 'yakuhaiFromCount',
          resolverArgs: { tile: SOUTH, count: 3, ctx: { roundWind: EAST, seatWind: SOUTH } },
          choices: [
            { id: 'yes', label: '役牌になる', value: true },
            { id: 'no', label: '役牌にならない', value: false },
          ],
          beginnerPoint: 'あなたは南家なので、南はあなた専用の役牌(自風)です。',
          explanation: '自風(自分の座席の風)と一致する刻子は役牌になります。あなたは南家なので、南の刻子は自風の役牌です。',
        },
        {
          kind: 'quiz',
          id: 'wind-guest-west',
          title: '客風(西)の場合',
          question: '同じ状況(東場・あなたは南家)で、西の刻子を作ったら役牌になりますか?',
          visual: { tiles: [WEST, WEST, WEST] },
          context: { roundWindLabel: '東場', seatWindLabel: '南家' },
          resolver: 'yakuhaiFromCount',
          resolverArgs: { tile: WEST, count: 3, ctx: { roundWind: EAST, seatWind: SOUTH } },
          choices: [
            { id: 'yes', label: '役牌になる', value: true },
            { id: 'no', label: '役牌にならない', value: false },
          ],
          beginnerPoint: '場風でも自風でもない風牌(客風)は、刻子にしても役牌にはなりません。',
          explanation: '西は今の場風(東)でも自風(南)でもないため、西の刻子は面子にはなりますが役牌にはなりません(客風)。',
        },
        {
          kind: 'quiz',
          id: 'wind-guest-north',
          title: '客風(北)の場合',
          question: '同じ状況で、北の刻子は役牌になりますか?',
          visual: { tiles: [NORTH, NORTH, NORTH] },
          context: { roundWindLabel: '東場', seatWindLabel: '南家' },
          resolver: 'yakuhaiFromCount',
          resolverArgs: { tile: NORTH, count: 3, ctx: { roundWind: EAST, seatWind: SOUTH } },
          choices: [
            { id: 'yes', label: '役牌になる', value: true },
            { id: 'no', label: '役牌にならない', value: false },
          ],
          beginnerPoint: '北も西と同じく客風です。',
          explanation: '北も今の場風・自風のどちらでもないため、客風で役牌にはなりません。',
        },
        {
          kind: 'info',
          id: 'double-wind',
          advanced: true,
          title: '発展: ダブ東・ダブ南',
          visual: { tiles: [EAST, EAST, EAST] },
          body:
            '場風と自風が同じ牌になることもあります(例: 東場・東家)。この場合、東の刻子は「場風の役」と「自風の役」の両方の意味を持ち、翻数は通常2翻分になります(通称ダブ東)。基本教材では必須にしていませんが、対局で自風と場風が同じ配牌になったら思い出してみましょう。',
        },
        {
          kind: 'tie',
          id: 'guest-wind-tie',
          title: '孤立字牌はどちらを切っても同じ?',
          question: '西と北がどちらも孤立牌で、シャンテン数・受け入れ枚数が完全に同じです。どちらを切りますか?',
          visual: { pairs: [{ label: '西', tile: WEST }, { label: '北', tile: NORTH }] },
          resolver: 'tieCompare',
          resolverArgs: { a: { shanten: 1, ukeireTotal: 28 }, b: { shanten: 1, ukeireTotal: 28 } },
          choices: [
            { id: 'a', label: '西を切る(北を残す)', value: 'a' },
            { id: 'b', label: '北を切る(西を残す)', value: 'b' },
            { id: 'tie', label: '牌効率上はどちらでも同じ', value: 'tie' },
          ],
          beginnerPoint: 'シャンテン数・受け入れ枚数が完全に同じ場合、牌効率上は「同率」であり、無理にどちらかを1位にする必要はありません。',
          explanation:
            '西・北はどちらも客風(場風でも自風でもない)で、シャンテン数も受け入れ枚数も同じです。牌効率だけを見れば同率で、どちらを切っても構いません。' +
            '(もし片方が三元牌や役牌候補なら、牌効率が同じでも役の可能性という別の観点で残す理由が生まれます。詳しくは「牌効率と役価値」を参照。)',
        },
        {
          kind: 'info',
          id: 'efficiency-vs-value',
          title: '牌効率と役の価値は別の軸',
          body:
            '發のような三元牌と、客風の西では、牌効率(シャンテン数・受け入れ枚数)が同じでも「役としての価値」は違います。發は3枚集めればほぼ確実に役牌になりますが、客風の西は今の場・自分の風では何枚集めても役牌になりません。' +
            'このアプリでは、役牌だからという理由だけで牌効率のランキングを偽って發を1位にすることはしません。牌効率と役の価値は、常に別々に表示します。',
        },
        {
          kind: 'link',
          id: 'try-coach',
          title: '対局で確かめる',
          body: '対局タブの「コーチ:フルコーチ」で、字牌を選んだときに今の価値(孤立牌/対子/役牌候補/客風など)を説明してくれます。',
          linkTab: 'game',
          linkLabel: '対局を試す',
        },
      ],
    },
    {
      id: 'furiten',
      title: 'フリテンを学ぶ',
      category: 'rules',
      level: 2,
      beginnerGoal: '「自分の捨て牌に今の待ちが1つでもあると、待ち全部でロンできない。ツモならアガれる」を体で理解する',
      relatedTerms: ['フリテン', '同巡内フリテン', 'リーチ'],
      steps: [
        {
          kind: 'info',
          id: 'intro',
          title: 'フリテンの最重要ポイント',
          body:
            '自分の捨て牌の中に、今の待ち牌が1種類でもあると、待ち牌"全部"で他家からロンできなくなります(フリテン)。ツモでのアガリだけは常に可能です。' +
            '「自分で捨てた牌だけロンできない」という意味ではないので注意してください。',
        },
        {
          kind: 'quiz',
          id: 'discard-furiten-ron',
          title: '捨て牌フリテン: ロンできる?',
          question: 'あなたの待ちは1萬・4萬です。あなたはすでに1萬を捨てています。相手が4萬を捨てました。ロンできますか?',
          visual: {
            waitTiles: [M(1), M(4)],
            ownDiscards: [M(1)],
            opponentDiscard: M(4),
          },
          resolver: 'furitenCanRon',
          resolverArgs: { discards: [M(1)], waitTiles: [M(1), M(4)], furitenTemporary: false, furitenRiichi: false },
          choices: [
            { id: 'yes', label: 'ロンできる', value: true },
            { id: 'no', label: 'ロンできない', value: false },
          ],
          beginnerPoint: '待ちのうち1萬を自分で捨てているため、4萬もロンできません。',
          explanation:
            'あなたの待ち(1萬・4萬)のうち1萬を自分の河にすでに捨てています。フリテンなので、4萬が出てもロンできません。ツモでは1萬・4萬のどちらでもアガれます。',
        },
        {
          kind: 'quiz',
          id: 'discard-furiten-tsumo',
          title: '捨て牌フリテン: ツモならアガれる?',
          question: '同じ状況で、あなたが自分で4萬をツモりました。アガれますか?',
          visual: { waitTiles: [M(1), M(4)], ownDiscards: [M(1)], selfDraw: M(4) },
          resolver: 'furitenCanTsumo',
          resolverArgs: { discards: [M(1)], waitTiles: [M(1), M(4)], furitenTemporary: false, furitenRiichi: false },
          choices: [
            { id: 'yes', label: 'アガれる', value: true },
            { id: 'no', label: 'アガれない', value: false },
          ],
          beginnerPoint: 'フリテンで禁止されるのは「他家からのロン」だけです。',
          explanation: 'フリテンでもツモアガリは常に可能です。自分で引いた4萬でアガることができます。',
        },
        {
          kind: 'quiz',
          id: 'not-furiten-compare',
          title: '比較: フリテンでない場合',
          question: '待ちは同じ1萬・4萬ですが、あなたの河には9萬・東・2筒しかありません。相手が4萬を捨てました。ロンできますか?',
          visual: { waitTiles: [M(1), M(4)], ownDiscards: [M(9), EAST, 9 + M(2)], opponentDiscard: M(4) },
          resolver: 'furitenCanRon',
          resolverArgs: { discards: [M(9), EAST, 9 + M(2)], waitTiles: [M(1), M(4)], furitenTemporary: false, furitenRiichi: false },
          choices: [
            { id: 'yes', label: 'ロンできる', value: true },
            { id: 'no', label: 'ロンできない', value: false },
          ],
          beginnerPoint: '自分の河に待ち牌が1枚も無ければフリテンではありません。',
          explanation: '河(9萬・東・2筒)の中に待ち牌(1萬・4萬)が含まれていないため、フリテンではありません。4萬でロンできます。',
        },
        {
          kind: 'quiz',
          id: 'temporary-furiten',
          title: '同巡内フリテン',
          question:
            'あなたの河に待ち牌はありません。さっき上家が1萬を捨てましたが見逃しました。今度は対面が4萬を捨てました。ロンできますか?',
          visual: { waitTiles: [M(1), M(4)], ownDiscards: [], missedTile: M(1), opponentDiscard: M(4) },
          resolver: 'furitenCanRon',
          resolverArgs: { discards: [], waitTiles: [M(1), M(4)], furitenTemporary: true, furitenRiichi: false },
          choices: [
            { id: 'yes', label: 'ロンできる', value: true },
            { id: 'no', label: 'ロンできない', value: false },
          ],
          beginnerPoint: '一度アガリ牌を見逃すと、次に自分がツモるまでロンできなくなります(一時フリテン)。',
          explanation:
            'アガれる牌(1萬)を一度見逃したため、一時的なフリテンになっています。次に自分の手番でツモるまでは、他家からロンできません。',
        },
        {
          kind: 'quiz',
          id: 'temporary-furiten-cleared',
          title: '同巡内フリテンの解除後',
          question: '自分の手番が来てツモをしました。一時フリテンは解除されました。もう一度4萬が出たらロンできますか?',
          visual: { waitTiles: [M(1), M(4)], ownDiscards: [], opponentDiscard: M(4) },
          resolver: 'furitenCanRon',
          resolverArgs: { discards: [], waitTiles: [M(1), M(4)], furitenTemporary: false, furitenRiichi: false },
          choices: [
            { id: 'yes', label: 'ロンできる', value: true },
            { id: 'no', label: 'ロンできない', value: false },
          ],
          beginnerPoint: '一時フリテンは、次に自分がツモった時点で解除されます。',
          explanation: '自分の手番でツモをすると一時フリテンは解除されます。もう捨て牌にも待ち牌が無いので、通常どおりロンできます。',
        },
        {
          kind: 'quiz',
          id: 'riichi-furiten',
          title: 'リーチ後の見逃し',
          question: 'リーチ後に上家の1萬を見逃しました。後で別の相手が4萬を捨てました。ロンできますか?',
          visual: { waitTiles: [M(1), M(4)], ownDiscards: [], missedTile: M(1), opponentDiscard: M(4), riichi: true },
          resolver: 'furitenCanRon',
          resolverArgs: { discards: [], waitTiles: [M(1), M(4)], furitenTemporary: false, furitenRiichi: true },
          choices: [
            { id: 'yes', label: 'ロンできる', value: true },
            { id: 'no', label: 'ロンできない', value: false },
          ],
          beginnerPoint: 'リーチ後に一度でも見逃すと、その局はずっとロンできなくなります。',
          explanation:
            'リーチ後にアガリ牌を見逃すと、一時フリテンとは違い「その局が終わるまで」ロンできなくなります(永続フリテン)。ツモでのみアガれます。',
        },
        {
          kind: 'quiz',
          id: 'riichi-furiten-tsumo',
          title: 'リーチ後フリテンでもツモは可能',
          question: '同じ状況で、自分で4萬をツモりました。アガれますか?',
          visual: { waitTiles: [M(1), M(4)], ownDiscards: [], selfDraw: M(4), riichi: true },
          resolver: 'furitenCanTsumo',
          resolverArgs: { discards: [], waitTiles: [M(1), M(4)], furitenTemporary: false, furitenRiichi: true },
          choices: [
            { id: 'yes', label: 'アガれる', value: true },
            { id: 'no', label: 'アガれない', value: false },
          ],
          beginnerPoint: 'リーチ後フリテンでも、ツモアガリだけはできます。',
          explanation: 'リーチ後の永続フリテンでも、自分でツモった場合はアガれます。禁止されるのはロンだけです。',
        },
        {
          kind: 'quiz',
          id: 'wait-change-clears-furiten',
          title: '発展: 待ちが変わると解消することがある',
          advanced: true,
          question: '以前1萬を捨てましたが、手が変わって今は4萬だけを待っています。ロンできますか?',
          visual: { waitTiles: [M(4)], ownDiscards: [M(1)], opponentDiscard: M(4) },
          resolver: 'furitenCanRon',
          resolverArgs: { discards: [M(1)], waitTiles: [M(4)], furitenTemporary: false, furitenRiichi: false },
          choices: [
            { id: 'yes', label: 'ロンできる', value: true },
            { id: 'no', label: 'ロンできない', value: false },
          ],
          beginnerPoint: '「一度捨てたら一生ロンできない」わけではありません。今の待ちに含まれていなければフリテンではありません。',
          explanation:
            '以前は1萬も待っていましたが、手変わりして今は4萬だけを待っています。捨てた1萬は今の待ちに含まれていないため、フリテンではなくなり、4萬でロンできます。',
        },
        {
          kind: 'info',
          id: 'furiten-vs-no-yaku',
          title: '発展: 「役なし」と「フリテン」の違い',
          advanced: true,
          body:
            'ロンできない理由には複数あります。「形は完成しているが役が無い」場合はそもそもアガれず、フリテンとは無関係です。' +
            '一方「役はあるがフリテン」の場合は、ロンだけできず、ツモなら同じ役でアガれます。この2つを混同しないようにしましょう。',
        },
        {
          kind: 'link',
          id: 'try-coach',
          title: '対局で確かめる',
          body:
            '対局タブでテンパイすると、フリテン中は状態(ロン可否・ツモ可否・原因)がコーチ欄に表示されます。他家がアガリ牌を捨てたのにロンボタンが出ない場合も「なぜ?」で理由を確認できます。',
          linkTab: 'game',
          linkLabel: '対局を試す',
        },
      ],
    },
  ];

  function getLesson(id) {
    return LESSONS.find((l) => l.id === id) || null;
  }

  function listLessons() {
    return LESSONS.map((l) => ({
      id: l.id,
      title: l.title,
      category: l.category,
      level: l.level,
      beginnerGoal: l.beginnerGoal,
      relatedTerms: l.relatedTerms,
      stepCount: l.steps.filter((s) => s.kind === 'quiz' || s.kind === 'tie').length,
    }));
  }

  const Lessons = { LESSONS, getLesson, listLessons };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Lessons;
  } else {
    root.MJ = root.MJ || {};
    root.MJ.Lessons = Lessons;
  }
})(typeof window !== 'undefined' ? window : globalThis);
