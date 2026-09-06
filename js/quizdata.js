/**
 * quizdata.js
 * 「クイズ・学習」タブの問題データ(初心者向け第一弾)。
 *
 * ここには「盤面」と「選択肢」と「解説」だけを置く。
 * 正解の計算は quizengine.js の resolver が本番ロジックから行うため、
 * expected はテスト(tests/quiz-tests.js)で
 * 「データ作成者の想定」と「エンジンの判定」が一致するか突き合わせるための参照値。
 * 実行時の採点には使わない。
 *
 * 盤面の牌は tiles.js のインデックス(0-33)。読みやすさのため
 * "234m" "11p" "5z" のような簡易表記を parse() で変換して書く。
 *   m=萬子 p=筒子 s=索子 z=字牌(1東 2南 3西 4北 5白 6發 7中)
 */
(function (root) {
  'use strict';

  // 第二弾以降のコースは別ファイルに分けて、ここで1つの問題集にまとめる
  let QuizDataDefense;
  if (typeof module !== 'undefined' && module.exports) {
    QuizDataDefense = require('./quizdata-defense.js');
  } else {
    QuizDataDefense = root.MJ.QuizDataDefense;
  }

  // ---- 簡易表記 → 牌インデックス配列 ----
  function parse(str) {
    const tiles = [];
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

  /** 1牌だけ欲しいとき用 */
  function t(str) {
    return parse(str)[0];
  }

  const EAST = 27;
  const SOUTH = 28;
  const WEST = 29;
  const NORTH = 30;
  const HAKU = 31;
  const HATSU = 32;

  // ==================================================
  // コース定義
  // ==================================================

  const COURSES = [
    {
      id: 'yaku',
      name: '役当てクイズ',
      description: '完成した手牌を見て、どの役(ヤク)が成立しているかを当てます。',
      target: '立直(リーチ)・断么九(タンヤオ)・平和(ピンフ)・役牌(ヤクハイ)・七対子(チートイツ)・対々和(トイトイ)・混一色(ホンイツ)・清一色(チンイツ)など',
      icon: '役',
    },
    {
      id: 'wait',
      name: '待ち当てクイズ',
      description: '13枚の聴牌(テンパイ)手牌を見て、その手が完成する牌をすべて選びます。',
      target: '両面(リャンメン)・嵌張(カンチャン)・辺張(ペンチャン)・双碰(シャンポン)・単騎(タンキ)・多面待ち',
      icon: '待',
    },
    {
      id: 'furiten',
      name: 'フリテンクイズ',
      description: '自分の河(カワ)と待ちを見て、ロンできるか・ツモならアガれるかを判断します。',
      target: '振聴(フリテン)の基本・同巡内フリテン・リーチ後の見逃し・役なし',
      icon: '振',
    },
    {
      id: 'genbutsu',
      name: '現物クイズ',
      description: 'リーチしている相手に対して、絶対にロンされない現物(ゲンブツ)を選びます。',
      target: '現物の考え方・誰に対して安全かの区別・赤5の扱い',
      icon: '現',
    },
    QuizDataDefense.DEFENSE_COURSE,
  ];

  // ==================================================
  // 共通の選択肢部品
  // ==================================================

  const YES_NO = [
    { id: 'yes', label: 'はい', value: true },
    { id: 'no', label: 'いいえ', value: false },
  ];

  function tileChoices(tiles, Tiles) {
    return tiles;
  }

  // ==================================================
  // コース1: 役当てクイズ
  // ==================================================

  const YAKU_QUESTIONS = [
    {
      id: 'yaku-01',
      course: 'yaku',
      difficulty: 'easy',
      tags: ['riichi', 'tanyao', 'pinfu'],
      multi: true,
      prompt: 'この手牌に成立している役を、すべて選んでください。(立直(リーチ)を宣言していて、2索でロンしました)',
      board: {
        hand: parse('234m55m456p34s678s'),
        winTile: t('2s'),
        isTsumo: false,
        isRiichi: true,
        roundWind: EAST,
        seatWind: SOUTH,
        doraIndicators: [],
      },
      resolver: 'yakuKeys',
      choices: [
        { id: 'a', label: '立直(リーチ)', value: 'riichi' },
        { id: 'b', label: '断么九(タンヤオ)', value: 'tanyao' },
        { id: 'c', label: '平和(ピンフ)', value: 'pinfu' },
        { id: 'd', label: '門前清自摸和(メンゼンツモ)', value: 'menzen_tsumo' },
        { id: 'e', label: '一盃口(イーペーコー)', value: 'iipeikou' },
      ],
      expected: ['a', 'b', 'c'],
      highlight: parse('34s2s'),
      explanation:
        '立直(リーチ)を宣言してアガったので立直。1・9・字牌を1枚も使っていないので断么九(タンヤオ)。' +
        '4つとも順子(シュンツ)で、雀頭(ジャントウ)の5萬が役牌ではなく、両面待ち(リャンメンマチ)でアガっているので平和(ピンフ)も成立します。' +
        '門前清自摸和(メンゼンツモ)はツモでアガったときの役なので、ロンのこの手では成立しません。' +
        '一盃口(イーペーコー)は同じ順子が2つ必要ですが、この手にはありません。',
    },
    {
      id: 'yaku-02',
      course: 'yaku',
      difficulty: 'easy',
      tags: ['tsumo', 'tanyao', 'pinfu'],
      multi: true,
      prompt: 'この手牌に成立している役を、すべて選んでください。(立直はしていません。3筒をツモしました)',
      board: {
        hand: parse('234m567m45p22s678s'),
        winTile: t('3p'),
        isTsumo: true,
        isRiichi: false,
        roundWind: EAST,
        seatWind: SOUTH,
        doraIndicators: [],
      },
      resolver: 'yakuKeys',
      choices: [
        { id: 'a', label: '門前清自摸和(メンゼンツモ)', value: 'menzen_tsumo' },
        { id: 'b', label: '断么九(タンヤオ)', value: 'tanyao' },
        { id: 'c', label: '平和(ピンフ)', value: 'pinfu' },
        { id: 'd', label: '立直(リーチ)', value: 'riichi' },
      ],
      expected: ['a', 'b', 'c'],
      highlight: parse('45p3p'),
      explanation:
        '鳴いていない(門前(メンゼン))状態で自分でツモってアガったので門前清自摸和(メンゼンツモ)が成立します。' +
        '立直(リーチ)は宣言していなければ成立しません。役は「宣言したか」「ツモかロンか」でも変わります。',
    },
    {
      id: 'yaku-03',
      course: 'yaku',
      difficulty: 'easy',
      tags: ['yakuhai'],
      multi: true,
      prompt: '白をポンしています。この手牌に成立している役を、すべて選んでください。(2萬でロン)',
      board: {
        hand: parse('34m22p456p678s'),
        winTile: t('2m'),
        isTsumo: false,
        isRiichi: false,
        fuuro: [{ type: 'pon', tiles: [HAKU, HAKU, HAKU], calledTile: HAKU, from: 2, concealed: false }],
        roundWind: EAST,
        seatWind: SOUTH,
        doraIndicators: [],
      },
      resolver: 'yakuKeys',
      choices: [
        { id: 'a', label: '役牌(ヤクハイ):白', value: 'yakuhai_白' },
        { id: 'b', label: '断么九(タンヤオ)', value: 'tanyao' },
        { id: 'c', label: '平和(ピンフ)', value: 'pinfu' },
        { id: 'd', label: '立直(リーチ)', value: 'riichi' },
      ],
      expected: ['a'],
      highlight: [HAKU],
      explanation:
        '白・發・中(三元牌)は、誰の風でも関係なく3枚そろえれば役牌(ヤクハイ)になります。鳴いても成立する数少ない役の1つです。' +
        '断么九(タンヤオ)は字牌を使うと不成立、平和(ピンフ)と立直(リーチ)は門前(メンゼン)限定なので、ポンしたこの手では成立しません。',
    },
    {
      id: 'yaku-04',
      course: 'yaku',
      difficulty: 'normal',
      tags: ['yakuhai'],
      multi: false,
      prompt: '場風は東(トン)、自風は西(シャー)です。この手牌の西の刻子(コーツ)は役牌(ヤクハイ)になりますか。',
      board: {
        hand: parse('234m456m789p5s') .concat([WEST, WEST, WEST]),
        winTile: t('5s'),
        isTsumo: true,
        isRiichi: false,
        roundWind: EAST,
        seatWind: WEST,
        doraIndicators: [],
      },
      resolver: 'isYakuhai',
      resolverArgs: { tile: WEST },
      choices: YES_NO,
      expected: ['yes'],
      highlight: [WEST],
      explanation:
        '風牌(東南西北)は、場風(バカゼ)または自風(ジカゼ)と一致したときだけ役牌(ヤクハイ)になります。' +
        'この局のあなたの自風は西なので、西の刻子は1翻(ハン)の役牌になります。',
    },
    {
      id: 'yaku-05',
      course: 'yaku',
      difficulty: 'normal',
      tags: ['yakuhai'],
      multi: false,
      prompt: '場風は東(トン)、自風は南(ナン)です。この手牌の北の刻子(コーツ)は役牌(ヤクハイ)になりますか。',
      board: {
        hand: parse('234m567m234p9s').concat([NORTH, NORTH, NORTH]),
        winTile: t('9s'),
        isTsumo: false,
        isRiichi: false,
        roundWind: EAST,
        seatWind: SOUTH,
        doraIndicators: [],
      },
      resolver: 'isYakuhai',
      resolverArgs: { tile: NORTH },
      choices: YES_NO,
      expected: ['no'],
      highlight: [NORTH],
      explanation:
        '北は場風(東)でも自風(南)でもないため、3枚そろえても役牌(ヤクハイ)にはなりません。' +
        'このような自分に関係のない風牌を「客風牌(オタカゼハイ)」と呼びます。字牌なら何でも役になるわけではない点に注意してください。',
    },
    {
      id: 'yaku-06',
      course: 'yaku',
      difficulty: 'normal',
      tags: ['dora-not-yaku', 'no-yaku'],
      multi: false,
      prompt: '123萬をチーしています。ドラ表示牌は3索なのでドラは4索、この手はドラを1枚持っています。この手に役はありますか。',
      board: {
        hand: parse('56m789p234s99s'),
        winTile: t('4m'),
        isTsumo: false,
        isRiichi: false,
        fuuro: [{ type: 'chi', tiles: parse('123m'), calledTile: t('1m'), from: 3, concealed: false }],
        roundWind: EAST,
        seatWind: SOUTH,
        doraIndicators: parse('3s'),
      },
      resolver: 'hasYaku',
      choices: YES_NO,
      expected: ['no'],
      highlight: parse('4s'),
      explanation:
        'ドラは翻(ハン)を増やすだけで、それ自体は役ではありません。役が1つも無ければ、ドラを何枚持っていてもアガれません。' +
        'この手はチーをして門前(メンゼン)ではなくなっており、1萬と9索を使っているので断么九(タンヤオ)にもならず、役が1つもありません。',
    },
    {
      id: 'yaku-07',
      course: 'yaku',
      difficulty: 'normal',
      tags: ['han', 'dora-not-yaku'],
      multi: false,
      prompt: '立直(リーチ)して2索でロンしました。ドラ表示牌は1萬(=ドラは2萬)です。この手は何翻(ハン)ですか。',
      board: {
        hand: parse('234m55m456p34s678s'),
        winTile: t('2s'),
        isTsumo: false,
        isRiichi: true,
        roundWind: EAST,
        seatWind: SOUTH,
        doraIndicators: parse('1m'),
      },
      resolver: 'hanTotal',
      choices: [
        { id: 'a', label: '3翻(ハン)', value: 3 },
        { id: 'b', label: '4翻(ハン)', value: 4 },
        { id: 'c', label: '5翻(ハン)', value: 5 },
        { id: 'd', label: '6翻(ハン)', value: 6 },
      ],
      expected: ['b'],
      highlight: parse('2m'),
      explanation:
        '立直(リーチ)1翻 + 断么九(タンヤオ)1翻 + 平和(ピンフ)1翻 = 役で3翻。' +
        'さらにドラ表示牌1萬の次の牌である2萬を1枚持っているので、ドラ1翻が加わって合計4翻です。' +
        'ドラは役ではありませんが、翻数には加算されます。',
    },
    {
      id: 'yaku-08',
      course: 'yaku',
      difficulty: 'easy',
      tags: ['chiitoitsu'],
      multi: true,
      prompt: 'この手牌に成立している役を、すべて選んでください。(立直はしていません。9索でロン)',
      board: {
        hand: parse('11m44m77m22p55p33s9s'),
        winTile: t('9s'),
        isTsumo: false,
        isRiichi: false,
        roundWind: EAST,
        seatWind: SOUTH,
        doraIndicators: [],
      },
      resolver: 'yakuKeys',
      choices: [
        { id: 'a', label: '七対子(チートイツ)', value: 'chiitoitsu' },
        { id: 'b', label: '対々和(トイトイ)', value: 'toitoi' },
        { id: 'c', label: '断么九(タンヤオ)', value: 'tanyao' },
        { id: 'd', label: '立直(リーチ)', value: 'riichi' },
      ],
      expected: ['a'],
      highlight: parse('9s'),
      explanation:
        '対子(トイツ=同じ牌2枚)が7種類そろっているので七対子(チートイツ)、2翻(ハン)です。門前(メンゼン)限定の役です。' +
        '対々和(トイトイ)は刻子(コーツ=同じ牌3枚)を4つ作る役なので別物です。1萬と9索を使っているため断么九(タンヤオ)にもなりません。',
    },
    {
      id: 'yaku-09',
      course: 'yaku',
      difficulty: 'normal',
      tags: ['toitoi'],
      multi: true,
      prompt: '333萬をポンしています。この手牌に成立している役を、すべて選んでください。(9筒でロン)',
      board: {
        hand: parse('22m555p99p888s'),
        winTile: t('9p'),
        isTsumo: false,
        isRiichi: false,
        fuuro: [{ type: 'pon', tiles: parse('333m'), calledTile: t('3m'), from: 1, concealed: false }],
        roundWind: EAST,
        seatWind: SOUTH,
        doraIndicators: [],
      },
      resolver: 'yakuKeys',
      choices: [
        { id: 'a', label: '対々和(トイトイ)', value: 'toitoi' },
        { id: 'b', label: '断么九(タンヤオ)', value: 'tanyao' },
        { id: 'c', label: '七対子(チートイツ)', value: 'chiitoitsu' },
        { id: 'd', label: '混一色(ホンイツ)', value: 'honitsu' },
      ],
      expected: ['a'],
      highlight: parse('99p9p'),
      explanation:
        '面子(メンツ)4つがすべて刻子(コーツ)なので対々和(トイトイ)、2翻(ハン)です。鳴いても翻数が下がらない役です。' +
        '9筒を使っているので断么九(タンヤオ)にはならず、刻子の手なので七対子(チートイツ)でもありません。',
    },
    {
      id: 'yaku-10',
      course: 'yaku',
      difficulty: 'normal',
      tags: ['honitsu', 'yakuhai', 'kuisagari'],
      multi: true,
      prompt: '發をポンしています。この手牌に成立している役を、すべて選んでください。(3索でロン)',
      board: {
        hand: parse('11s12s456s789s'),
        winTile: t('3s'),
        isTsumo: false,
        isRiichi: false,
        fuuro: [{ type: 'pon', tiles: [HATSU, HATSU, HATSU], calledTile: HATSU, from: 2, concealed: false }],
        roundWind: EAST,
        seatWind: SOUTH,
        doraIndicators: [],
      },
      resolver: 'yakuKeys',
      choices: [
        { id: 'a', label: '混一色(ホンイツ)', value: 'honitsu' },
        { id: 'b', label: '役牌(ヤクハイ):發', value: 'yakuhai_發' },
        { id: 'c', label: '清一色(チンイツ)', value: 'chinitsu' },
        { id: 'd', label: '断么九(タンヤオ)', value: 'tanyao' },
      ],
      expected: ['a', 'b'],
      highlight: [HATSU],
      explanation:
        '索子(ソーズ)と字牌だけでできているので混一色(ホンイツ)。門前なら3翻(ハン)ですが、鳴いているので1翻下がって2翻になります(食い下がり)。' +
        '發の刻子(コーツ)で役牌(ヤクハイ)1翻も加わります。字牌を使っているので清一色(チンイツ)ではありません。',
    },
    {
      id: 'yaku-11',
      course: 'yaku',
      difficulty: 'hard',
      tags: ['chinitsu', 'tanyao', 'pinfu'],
      multi: true,
      prompt: 'この手牌に成立している役を、すべて選んでください。(鳴いていません。立直はしていません。5萬でロン)',
      board: {
        hand: parse('22m34m234m456m678m'),
        winTile: t('5m'),
        isTsumo: false,
        isRiichi: false,
        roundWind: EAST,
        seatWind: SOUTH,
        doraIndicators: [],
      },
      resolver: 'yakuKeys',
      choices: [
        { id: 'a', label: '清一色(チンイツ)', value: 'chinitsu' },
        { id: 'b', label: '断么九(タンヤオ)', value: 'tanyao' },
        { id: 'c', label: '平和(ピンフ)', value: 'pinfu' },
        { id: 'd', label: '混一色(ホンイツ)', value: 'honitsu' },
        { id: 'e', label: '門前清自摸和(メンゼンツモ)', value: 'menzen_tsumo' },
      ],
      expected: ['a', 'b', 'c'],
      highlight: parse('34m5m'),
      explanation:
        '萬子(マンズ)1種類だけで構成されているので清一色(チンイツ)、門前(メンゼン)なら6翻(ハン)の大きな役です。' +
        '字牌が混ざっていれば混一色(ホンイツ)ですが、この手は数牌1種類だけなので清一色になります。' +
        '1・9・字牌を使っていないので断么九(タンヤオ)、順子(シュンツ)4つ+両面待ち(リャンメンマチ)+役牌でない雀頭(ジャントウ)なので平和(ピンフ)も付き、合計8翻の跳満(ハネマン)になります。',
    },
    {
      id: 'yaku-12',
      course: 'yaku',
      difficulty: 'normal',
      tags: ['iipeikou', 'menzen-only'],
      multi: false,
      prompt: '一盃口(イーペーコー)は、鳴いた(ポン・チーをした)場合どうなりますか。',
      board: {
        hand: parse('223344m45p99p678s'),
        winTile: t('6p'),
        isTsumo: false,
        isRiichi: false,
        roundWind: EAST,
        seatWind: SOUTH,
        doraIndicators: [],
      },
      resolver: 'nakiEffect',
      resolverArgs: { yakuKey: 'iipeikou' },
      choices: [
        { id: 'a', label: '鳴いても同じ翻数で成立する', value: 'same' },
        { id: 'b', label: '鳴くと1翻(ハン)下がるが成立する', value: 'kuisagari' },
        { id: 'c', label: '鳴くと成立しなくなる(門前(メンゼン)限定)', value: 'menzen-only' },
      ],
      expected: ['c'],
      highlight: parse('223344m'),
      explanation:
        '一盃口(イーペーコー)は「同じ順子(シュンツ)が2つ」で成立する1翻の役ですが、門前(メンゼン)限定です。' +
        '1回でも鳴くと成立しません。立直(リーチ)・平和(ピンフ)・七対子(チートイツ)・門前清自摸和(メンゼンツモ)も同じく門前限定です。',
    },
    {
      id: 'yaku-13',
      course: 'yaku',
      difficulty: 'normal',
      tags: ['honitsu', 'kuisagari'],
      multi: false,
      prompt: '混一色(ホンイツ)は、鳴いた(ポン・チーをした)場合どうなりますか。',
      board: {
        hand: parse('123s456s789s9s').concat([HAKU, HAKU, HAKU]),
        winTile: t('9s'),
        isTsumo: false,
        isRiichi: false,
        roundWind: EAST,
        seatWind: SOUTH,
        doraIndicators: [],
      },
      resolver: 'nakiEffect',
      resolverArgs: { yakuKey: 'honitsu' },
      choices: [
        { id: 'a', label: '鳴いても同じ翻数で成立する', value: 'same' },
        { id: 'b', label: '鳴くと1翻(ハン)下がるが成立する', value: 'kuisagari' },
        { id: 'c', label: '鳴くと成立しなくなる(門前(メンゼン)限定)', value: 'menzen-only' },
      ],
      expected: ['b'],
      highlight: [HAKU],
      explanation:
        '混一色(ホンイツ)は門前で3翻(ハン)、鳴くと2翻に下がります。このように「鳴くと翻数が下がる」ことを食い下がり(クイサガリ)と呼びます。' +
        '清一色(チンイツ)6→5翻、三色同順(サンショクドウジュン)2→1翻なども同じ仲間です。',
    },
    {
      id: 'yaku-14',
      course: 'yaku',
      difficulty: 'hard',
      tags: ['iipeikou', 'pinfu', 'riichi'],
      multi: true,
      prompt: 'この手牌に成立している役を、すべて選んでください。(立直(リーチ)して6筒でロン)',
      board: {
        hand: parse('223344m45p99p678s'),
        winTile: t('6p'),
        isTsumo: false,
        isRiichi: true,
        roundWind: EAST,
        seatWind: SOUTH,
        doraIndicators: [],
      },
      resolver: 'yakuKeys',
      choices: [
        { id: 'a', label: '立直(リーチ)', value: 'riichi' },
        { id: 'b', label: '平和(ピンフ)', value: 'pinfu' },
        { id: 'c', label: '一盃口(イーペーコー)', value: 'iipeikou' },
        { id: 'd', label: '断么九(タンヤオ)', value: 'tanyao' },
      ],
      expected: ['a', 'b', 'c'],
      highlight: parse('223344m'),
      explanation:
        '234萬が2組あるので一盃口(イーペーコー)。順子(シュンツ)4つ+役牌でない雀頭(ジャントウ)+両面待ち(リャンメンマチ)なので平和(ピンフ)も成立します。' +
        'ただし雀頭が9筒なので、1・9・字牌を使わない断么九(タンヤオ)にはなりません。あと1枚の違いで役は変わります。',
    },
    {
      id: 'yaku-15',
      course: 'yaku',
      difficulty: 'hard',
      tags: ['yakuhai', 'no-yaku'],
      multi: false,
      prompt: '場風は東(トン)、自風は南(ナン)です。北をポンしています。この手に役はありますか。',
      board: {
        hand: parse('234m567m234p9s'),
        winTile: t('9s'),
        isTsumo: false,
        isRiichi: false,
        fuuro: [{ type: 'pon', tiles: [NORTH, NORTH, NORTH], calledTile: NORTH, from: 1, concealed: false }],
        roundWind: EAST,
        seatWind: SOUTH,
        doraIndicators: [],
      },
      resolver: 'hasYaku',
      choices: YES_NO,
      expected: ['no'],
      highlight: [NORTH],
      explanation:
        '北は場風でも自風でもないので役牌(ヤクハイ)になりません。ポンしたことで門前(メンゼン)でもなくなり、' +
        '立直(リーチ)・平和(ピンフ)・門前清自摸和(メンゼンツモ)も使えません。9索があるので断么九(タンヤオ)も不成立で、役が1つもない状態です。' +
        '「とりあえず字牌を鳴く」と、この形になってアガれなくなることがあります。',
    },
    {
      id: 'yaku-16',
      course: 'yaku',
      difficulty: 'normal',
      tags: ['han', 'chiitoitsu'],
      multi: false,
      prompt: '立直(リーチ)して9索でロンしました。ドラはありません。この手は何翻(ハン)ですか。',
      board: {
        hand: parse('11m44m77m22p55p33s9s'),
        winTile: t('9s'),
        isTsumo: false,
        isRiichi: true,
        roundWind: EAST,
        seatWind: SOUTH,
        doraIndicators: [],
      },
      resolver: 'hanTotal',
      choices: [
        { id: 'a', label: '2翻(ハン)', value: 2 },
        { id: 'b', label: '3翻(ハン)', value: 3 },
        { id: 'c', label: '4翻(ハン)', value: 4 },
        { id: 'd', label: '5翻(ハン)', value: 5 },
      ],
      expected: ['b'],
      highlight: parse('9s'),
      explanation: '七対子(チートイツ)2翻 + 立直(リーチ)1翻 = 3翻です。七対子は符(フ)が25符で固定されている特別な役です。',
    },
  ];

  // ==================================================
  // コース2: 待ち当てクイズ
  // ==================================================

  function waitQuestion(spec) {
    return Object.assign(
      {
        course: 'wait',
        multi: true,
        resolver: 'waitTiles',
        prompt: 'この手牌(13枚)が完成する牌を、すべて選んでください。',
      },
      spec
    );
  }

  function tileChoiceList(tileStrings) {
    return tileStrings.map((s, i) => ({ id: 'c' + i, label: null, value: t(s), tile: t(s) }));
  }

  const WAIT_QUESTIONS = [
    waitQuestion({
      id: 'wait-01',
      difficulty: 'easy',
      tags: ['ryanmen'],
      board: { hand: parse('234m456m789p34s55s') },
      choices: tileChoiceList(['1s', '2s', '3s', '5s', '6s']),
      expected: ['c1', 'c3'],
      explanation:
        '3索・4索が並んでいるので、その両側の2索と5索で順子(シュンツ)が完成します。これが両面待ち(リャンメンマチ)です。' +
        '5索は雀頭(ジャントウ)の55索を使って345索+55索と読むこともできるため、こちらも当たり牌になります。',
    }),
    waitQuestion({
      id: 'wait-02',
      difficulty: 'easy',
      tags: ['kanchan'],
      board: { hand: parse('123m456m789m22p35s') },
      choices: tileChoiceList(['2s', '3s', '4s', '5s', '6s']),
      expected: ['c2'],
      explanation:
        '3索と5索の間が空いているので、間の4索だけが当たり牌です。これを嵌張待ち(カンチャンマチ)と呼びます。' +
        '待ちが1種類しかないため、両面待ち(リャンメンマチ)より不利な形です。',
    }),
    waitQuestion({
      id: 'wait-03',
      difficulty: 'easy',
      tags: ['penchan'],
      board: { hand: parse('123m456m789m22p12s') },
      choices: tileChoiceList(['1s', '2s', '3s', '4s']),
      expected: ['c2'],
      explanation:
        '1索・2索は端の形なので、3索だけで順子(シュンツ)が完成します。これが辺張待ち(ペンチャンマチ)です。' +
        '0という牌は無いため、上側の3索しか待てません。',
    }),
    waitQuestion({
      id: 'wait-04',
      difficulty: 'easy',
      tags: ['shanpon'],
      board: { hand: parse('123m456m789m22p55s') },
      choices: tileChoiceList(['2p', '3p', '4s', '5s', '6s']),
      expected: ['c0', 'c3'],
      explanation:
        '対子(トイツ)が2つあるので、どちらかが刻子(コーツ)になれば、もう一方が雀頭(ジャントウ)になります。' +
        'これが双碰待ち(シャンポンマチ)です。当たり牌は2筒と5索の2種類です。',
    }),
    waitQuestion({
      id: 'wait-05',
      difficulty: 'easy',
      tags: ['tanki'],
      board: { hand: parse('123m456m789m234p5s') },
      choices: tileChoiceList(['4s', '5s', '6s', '3p']),
      expected: ['c1'],
      explanation:
        '面子(メンツ)が4つそろっていて、残る1枚が雀頭(ジャントウ)になる相手を待っている形です。これが単騎待ち(タンキマチ)で、当たり牌は5索だけです。',
    }),
    waitQuestion({
      id: 'wait-06',
      difficulty: 'normal',
      tags: ['chiitoitsu-wait', 'tanki'],
      board: { hand: parse('11m44m77m22p55p33s9s') },
      choices: tileChoiceList(['1m', '3s', '5p', '9s']),
      expected: ['c3'],
      explanation:
        '対子(トイツ)が6組あり、9索だけが1枚。この9索がもう1枚来れば七対子(チートイツ)が完成します。' +
        'これが七対子の単騎待ち(タンキマチ)です。すでに2枚ある牌を引いても3枚目になるだけで、七対子は完成しません。',
    }),
    waitQuestion({
      id: 'wait-07',
      difficulty: 'hard',
      tags: ['multi-wait', 'ryanmen'],
      prompt: 'この手牌(13枚)が完成する牌を、すべて選んでください。(3種類あります)',
      board: { hand: parse('234m567m11p23456s') },
      choices: tileChoiceList(['1s', '2s', '3s', '4s', '5s', '6s', '7s']),
      expected: ['c0', 'c3', 'c6'],
      explanation:
        '2索から6索までがつながっているため、1索(123索+456索)・4索(234索+456索)・7索(234索+567索)の3種類で完成します。' +
        'このように3種類以上で待てる形を多面待ち(タメンマチ)と呼び、両面待ち(リャンメンマチ)よりさらに有利です。',
    }),
    waitQuestion({
      id: 'wait-08',
      difficulty: 'hard',
      tags: ['multi-wait'],
      prompt: 'この手牌(13枚)が完成する牌を、すべて選んでください。(3種類あります)',
      board: { hand: parse('234m567m11p34567s') },
      choices: tileChoiceList(['2s', '3s', '4s', '5s', '6s', '7s', '8s']),
      expected: ['c0', 'c3', 'c6'],
      explanation:
        '3索から7索の並びから、2索(234索+567索)・5索(345索+567索)・8索(345索+678索)の3種類で完成します。' +
        '連続した5枚の形は、両端と真ん中で待てる強い多面待ち(タメンマチ)になります。',
    }),
    waitQuestion({
      id: 'wait-09',
      difficulty: 'normal',
      tags: ['tanki'],
      prompt: '白をポンしています。この手牌が完成する牌を、すべて選んでください。',
      board: {
        hand: parse('234m567m789p5s'),
        fuuro: [{ type: 'pon', tiles: [HAKU, HAKU, HAKU], calledTile: HAKU, from: 2, concealed: false }],
      },
      choices: tileChoiceList(['4s', '5s', '6s', '5z']),
      expected: ['c1'],
      explanation:
        'ポンした白がすでに1面子(メンツ)なので、手の中の3面子と合わせて面子は4つそろっています。' +
        '残る5索が雀頭(ジャントウ)になる単騎待ち(タンキマチ)です。白はすでに3枚使っているため、4枚目を引いても和了(ホーラ)にはなりません。',
    }),
    waitQuestion({
      id: 'wait-10',
      difficulty: 'normal',
      tags: ['kanchan'],
      multi: false,
      resolver: 'waitShape',
      prompt: 'この手牌(13枚)の待ちの形の名前はどれですか。',
      board: { hand: parse('123m456m789m22p35s') },
      choices: [
        { id: 'a', label: '両面待ち(リャンメンマチ)', value: 'ryanmen' },
        { id: 'b', label: '嵌張待ち(カンチャンマチ)', value: 'kanchan' },
        { id: 'c', label: '辺張待ち(ペンチャンマチ)', value: 'penchan' },
        { id: 'd', label: '双碰待ち(シャンポンマチ)', value: 'shanpon' },
        { id: 'e', label: '単騎待ち(タンキマチ)', value: 'tanki' },
      ],
      expected: ['b'],
      explanation: '3索・5索の間の4索を待つ形なので嵌張待ち(カンチャンマチ)です。待てるのは1種類だけです。',
    }),
    waitQuestion({
      id: 'wait-11',
      difficulty: 'normal',
      tags: ['penchan'],
      multi: false,
      resolver: 'waitShape',
      prompt: 'この手牌(13枚)の待ちの形の名前はどれですか。',
      board: { hand: parse('123m456m789m22p12s') },
      choices: [
        { id: 'a', label: '両面待ち(リャンメンマチ)', value: 'ryanmen' },
        { id: 'b', label: '嵌張待ち(カンチャンマチ)', value: 'kanchan' },
        { id: 'c', label: '辺張待ち(ペンチャンマチ)', value: 'penchan' },
        { id: 'd', label: '双碰待ち(シャンポンマチ)', value: 'shanpon' },
        { id: 'e', label: '単騎待ち(タンキマチ)', value: 'tanki' },
      ],
      expected: ['c'],
      explanation: '1索・2索から3索だけを待つ形なので辺張待ち(ペンチャンマチ)です。',
    }),
    waitQuestion({
      id: 'wait-12',
      difficulty: 'hard',
      tags: ['wait-count'],
      multi: false,
      resolver: 'waitRemaining',
      prompt: '画面に見えている牌(自分の手牌と河(カワ))を除くと、当たり牌はあと何枚残っていますか。',
      board: {
        hand: parse('234m456m789p34s55s'),
        players: [
          { seat: 0, label: '自分', isSelf: true, discards: parse('9m1z') },
          { seat: 1, label: '下家', discards: parse('2s5s') },
        ],
      },
      choices: [
        { id: 'a', label: '3枚', value: 3 },
        { id: 'b', label: '4枚', value: 4 },
        { id: 'c', label: '5枚', value: 5 },
        { id: 'd', label: '6枚', value: 6 },
      ],
      expected: ['b'],
      explanation:
        '当たり牌は2索と5索です。牌は各4枚。2索は下家の河に1枚見えているので残り3枚、' +
        '5索は自分の手牌に2枚+下家の河に1枚見えているので残り1枚。合計4枚です。' +
        '「待ちの種類が多い」ことと「残り枚数が多い」ことは別なので、見えている牌を数える習慣をつけましょう。',
    }),
    waitQuestion({
      id: 'wait-13',
      difficulty: 'normal',
      tags: ['multi-wait'],
      multi: false,
      resolver: 'waitKinds',
      prompt: 'この手牌(13枚)は、何種類の牌で完成しますか。',
      board: { hand: parse('234m567m11p23456s') },
      choices: [
        { id: 'a', label: '2種類', value: 2 },
        { id: 'b', label: '3種類', value: 3 },
        { id: 'c', label: '4種類', value: 4 },
        { id: 'd', label: '5種類', value: 5 },
      ],
      expected: ['b'],
      explanation: '1索・4索・7索の3種類で完成する多面待ち(タメンマチ)です。',
    }),
    waitQuestion({
      id: 'wait-14',
      difficulty: 'normal',
      tags: ['tanki', 'yakuhai'],
      board: { hand: parse('123m456m789m234p').concat([EAST]) },
      choices: tileChoiceList(['1z', '2z', '3z', '4p']),
      expected: ['c0'],
      explanation:
        '面子(メンツ)が4つそろっていて、東が雀頭(ジャントウ)になるのを待つ単騎待ち(タンキマチ)です。' +
        '字牌の単騎待ちは、当たり牌が場に見えていないかを確認するのが大切です。',
    }),
    waitQuestion({
      id: 'wait-15',
      difficulty: 'easy',
      tags: ['ryanmen'],
      board: { hand: parse('11m78m345p678p234s') },
      choices: tileChoiceList(['5m', '6m', '7m', '9m']),
      expected: ['c1', 'c3'],
      explanation:
        '7萬・8萬の両側、6萬と9萬で順子(シュンツ)が完成する両面待ち(リャンメンマチ)です。1萬の対子(トイツ)が雀頭(ジャントウ)になります。',
    }),
    waitQuestion({
      id: 'wait-16',
      difficulty: 'normal',
      tags: ['shanpon'],
      board: { hand: parse('123m456m789m').concat([EAST, EAST, SOUTH, SOUTH]) },
      choices: tileChoiceList(['1z', '2z', '3z', '5z']),
      expected: ['c0', 'c1'],
      explanation:
        '東と南の対子(トイツ)が2つあるので、どちらか3枚目が来れば完成する双碰待ち(シャンポンマチ)です。' +
        '当たり牌は東と南の2種類です。',
    }),
  ];

  // ==================================================
  // コース3: フリテンクイズ
  // ==================================================

  // 待ちが2索・5索の門前手(立直あり)。自分の河に2索があるためフリテン。
  const FURITEN_BOARD_A = {
    hand: parse('234m456m789p34s55s'),
    isRiichi: true,
    roundWind: EAST,
    seatWind: SOUTH,
    players: [{ seat: 0, label: '自分', isSelf: true, riichi: true, riichiIndex: 2, discards: parse('9m1z2s7p') }],
  };

  // 待ちが1索・4索・7索の3面待ち。自分の河に7索があるためフリテン。
  const FURITEN_BOARD_B = {
    hand: parse('234m567m11p23456s'),
    isRiichi: true,
    roundWind: EAST,
    seatWind: SOUTH,
    players: [{ seat: 0, label: '自分', isSelf: true, riichi: true, riichiIndex: 3, discards: parse('9m1z5z7s') }],
  };

  // 断么九(タンヤオ)の門前手。河に当たり牌は無いが、同巡内フリテン状態。
  const FURITEN_BOARD_C = {
    hand: parse('234m456m678p34s55s'),
    isRiichi: false,
    furitenTemporary: true,
    roundWind: EAST,
    seatWind: SOUTH,
    players: [{ seat: 0, label: '自分', isSelf: true, discards: parse('9m1z7z') }],
  };

  // リーチ後に和了牌を見逃した状態(永続フリテン)。
  const FURITEN_BOARD_D = {
    hand: parse('234m456m789p34s55s'),
    isRiichi: true,
    furitenRiichi: true,
    roundWind: EAST,
    seatWind: SOUTH,
    players: [{ seat: 0, label: '自分', isSelf: true, riichi: true, riichiIndex: 1, discards: parse('9m1z7p') }],
  };

  // 123萬をチーした役なしの手。フリテンではないが役が無い。
  const FURITEN_BOARD_E = {
    hand: parse('456m789p34s99s'),
    fuuro: [{ type: 'chi', tiles: parse('123m'), calledTile: t('1m'), from: 3, concealed: false }],
    roundWind: EAST,
    seatWind: SOUTH,
    players: [{ seat: 0, label: '自分', isSelf: true, discards: parse('1z7z9m') }],
  };

  // 立直あり・フリテンでもない、普通にロンできる手。
  const FURITEN_BOARD_F = {
    hand: parse('234m456m789p34s55s'),
    isRiichi: true,
    roundWind: EAST,
    seatWind: SOUTH,
    players: [{ seat: 0, label: '自分', isSelf: true, riichi: true, riichiIndex: 2, discards: parse('9m1z7z3p') }],
  };

  function cloneBoard(board, extra) {
    return Object.assign({}, board, extra || {});
  }

  const FURITEN_QUESTIONS = [
    {
      id: 'furiten-01',
      course: 'furiten',
      difficulty: 'easy',
      tags: ['furiten-own-river', 'furiten-multi'],
      multi: false,
      prompt: '待ちは2索・5索です。自分の河(カワ)には2索があります。いま出た5索でロンできますか。',
      board: cloneBoard(FURITEN_BOARD_A, { winTile: t('5s'), isTsumo: false }),
      resolver: 'canRon',
      choices: YES_NO,
      expected: ['no'],
      explanation:
        '自分の河に待ち牌の2索があるため振聴(フリテン)です。フリテンのときは、捨てた2索だけでなく' +
        '「待ち牌すべて」でロンできなくなります。5索も同じ待ちの一部なのでロンできません。',
    },
    {
      id: 'furiten-02',
      course: 'furiten',
      difficulty: 'easy',
      tags: ['furiten-tsumo', 'furiten-own-river'],
      multi: false,
      prompt: '待ちは2索・5索で、自分の河には2索があります。5索を自分でツモした場合はアガれますか。',
      board: cloneBoard(FURITEN_BOARD_A, { winTile: t('5s'), isTsumo: true }),
      resolver: 'canTsumo',
      choices: YES_NO,
      expected: ['yes'],
      explanation:
        '振聴(フリテン)で禁止されるのはロン(他家の捨て牌でアガること)だけです。自分でツモればアガれます。' +
        'この手は立直(リーチ)+門前清自摸和(メンゼンツモ)で役もあります。',
    },
    {
      id: 'furiten-03',
      course: 'furiten',
      difficulty: 'easy',
      tags: ['furiten-own-river'],
      multi: false,
      prompt: '待ちは2索・5索です。自分の河には2索があります。この状態は振聴(フリテン)ですか。',
      board: cloneBoard(FURITEN_BOARD_A, { winTile: t('2s'), isTsumo: false }),
      resolver: 'isFuriten',
      choices: YES_NO,
      expected: ['yes'],
      explanation:
        '待ち牌が1種類でも自分の河にあれば振聴(フリテン)です。自分の河は毎回、待ち牌が入っていないかを確認しましょう。',
    },
    {
      id: 'furiten-04',
      course: 'furiten',
      difficulty: 'normal',
      tags: ['furiten-multi', 'furiten-own-river'],
      multi: false,
      prompt: '待ちは1索・4索・7索の3種類です。自分の河には7索だけがあります。いま出た4索でロンできますか。',
      board: cloneBoard(FURITEN_BOARD_B, { winTile: t('4s'), isTsumo: false }),
      resolver: 'canRon',
      choices: YES_NO,
      expected: ['no'],
      explanation:
        'これが最も間違えやすいルールです。複数待ちのうち1種類(この場合7索)でも自分の河にあれば、' +
        '残りの1索・4索でもロンできません。「捨てた牌だけがダメ」ではありません。',
    },
    {
      id: 'furiten-05',
      course: 'furiten',
      difficulty: 'normal',
      tags: ['furiten-tsumo', 'furiten-multi'],
      multi: false,
      prompt: '待ちは1索・4索・7索で、自分の河には7索があります。1索をツモした場合はアガれますか。',
      board: cloneBoard(FURITEN_BOARD_B, { winTile: t('1s'), isTsumo: true }),
      resolver: 'canTsumo',
      choices: YES_NO,
      expected: ['yes'],
      explanation:
        'フリテンでもツモは可能です。多面待ちでフリテンになってしまった場合は、ツモアガリを目指すことになります。',
    },
    {
      id: 'furiten-06',
      course: 'furiten',
      difficulty: 'normal',
      tags: ['furiten-temporary'],
      multi: false,
      prompt:
        'この巡、上家が捨てた5索(あなたの当たり牌)を見逃しました。自分の河に当たり牌はありません。' +
        '直後に対面が捨てた2索でロンできますか。',
      board: cloneBoard(FURITEN_BOARD_C, { winTile: t('2s'), isTsumo: false }),
      resolver: 'canRon',
      choices: YES_NO,
      expected: ['no'],
      explanation:
        '一度アガれる牌を見逃すと、次に自分がツモを引くまでロンできません。これを同巡内フリテン(一時的なフリテン)と呼びます。' +
        '自分の河に当たり牌が無くてもフリテンになる、という点が重要です。次の自分のツモを過ぎれば解消します。',
    },
    {
      id: 'furiten-07',
      course: 'furiten',
      difficulty: 'normal',
      tags: ['furiten-temporary', 'furiten-tsumo'],
      multi: false,
      prompt: '同巡内フリテンの状態です。自分のツモ番で2索を引きました。アガれますか。',
      board: cloneBoard(FURITEN_BOARD_C, { winTile: t('2s'), isTsumo: true }),
      resolver: 'canTsumo',
      choices: YES_NO,
      expected: ['yes'],
      explanation:
        '同巡内フリテンでもツモアガリはできます。この手は断么九(タンヤオ)と門前清自摸和(メンゼンツモ)で役もあります。',
    },
    {
      id: 'furiten-08',
      course: 'furiten',
      difficulty: 'hard',
      tags: ['furiten-temporary'],
      multi: false,
      prompt: '同巡内フリテンの状態で出た2索。ロンできない理由はどれですか。',
      board: cloneBoard(FURITEN_BOARD_C, { winTile: t('2s'), isTsumo: false }),
      resolver: 'ronBlockReason',
      choices: [
        { id: 'a', label: '振聴(フリテン)だから', value: 'furiten' },
        { id: 'b', label: '役が無いから', value: 'no-yaku' },
        { id: 'c', label: 'フリテンでも役なしでもなく、ロンできる', value: 'none' },
        { id: 'd', label: 'フリテンであり、かつ役も無いから', value: 'furiten-and-no-yaku' },
      ],
      expected: ['a'],
      explanation:
        'この手は断么九(タンヤオ)があるので役はあります。ロンできない理由は同巡内フリテンだけです。' +
        '「ロンできない=役がない」とは限らないので、理由を分けて考えましょう。',
    },
    {
      id: 'furiten-09',
      course: 'furiten',
      difficulty: 'normal',
      tags: ['furiten-riichi'],
      multi: false,
      prompt: '立直(リーチ)後に一度アガリ牌を見逃しました。その後に出た5索でロンできますか。',
      board: cloneBoard(FURITEN_BOARD_D, { winTile: t('5s'), isTsumo: false }),
      resolver: 'canRon',
      choices: YES_NO,
      expected: ['no'],
      explanation:
        'リーチ後にアガリ牌を見逃すと、その局が終わるまでずっとロンできません(永続フリテン)。' +
        '同巡内フリテンと違い、次のツモを過ぎても解消しないのが違いです。リーチ後は見逃さないよう注意しましょう。',
    },
    {
      id: 'furiten-10',
      course: 'furiten',
      difficulty: 'normal',
      tags: ['furiten-riichi', 'furiten-tsumo'],
      multi: false,
      prompt: 'リーチ後に見逃してフリテンになっています。5索をツモした場合はアガれますか。',
      board: cloneBoard(FURITEN_BOARD_D, { winTile: t('5s'), isTsumo: true }),
      resolver: 'canTsumo',
      choices: YES_NO,
      expected: ['yes'],
      explanation:
        'リーチ後のフリテンでもツモアガリは可能です。立直(リーチ)+門前清自摸和(メンゼンツモ)でアガれます。' +
        'ただしロンができないぶん、アガれる確率は大きく下がります。',
    },
    {
      id: 'furiten-11',
      course: 'furiten',
      difficulty: 'normal',
      tags: ['no-yaku'],
      multi: false,
      prompt: '123萬をチーしています。自分の河に当たり牌はありません。いま出た2索でロンできますか。',
      board: cloneBoard(FURITEN_BOARD_E, { winTile: t('2s'), isTsumo: false }),
      resolver: 'canRon',
      choices: YES_NO,
      expected: ['no'],
      explanation:
        'フリテンではありませんが、この手には役が1つもありません(チーをしているので立直・平和・門前清自摸和は使えず、' +
        '1萬と9索があるので断么九(タンヤオ)にもなりません)。役が無ければロンもツモもできません。',
    },
    {
      id: 'furiten-12',
      course: 'furiten',
      difficulty: 'hard',
      tags: ['no-yaku'],
      multi: false,
      prompt: 'チーをした上の手で2索が出ました。ロンできない理由はどれですか。',
      board: cloneBoard(FURITEN_BOARD_E, { winTile: t('2s'), isTsumo: false }),
      resolver: 'ronBlockReason',
      choices: [
        { id: 'a', label: '振聴(フリテン)だから', value: 'furiten' },
        { id: 'b', label: '役が無いから', value: 'no-yaku' },
        { id: 'c', label: 'フリテンでも役なしでもなく、ロンできる', value: 'none' },
        { id: 'd', label: 'フリテンであり、かつ役も無いから', value: 'furiten-and-no-yaku' },
      ],
      expected: ['b'],
      explanation:
        '自分の河に当たり牌(2索・5索)は無いのでフリテンではありません。ロンできない理由は「役なし」です。' +
        '鳴く前に「アガったとき何の役になるか」を考える習慣が大切です。',
    },
    {
      id: 'furiten-13',
      course: 'furiten',
      difficulty: 'hard',
      tags: ['no-yaku', 'furiten-own-river'],
      multi: false,
      prompt: 'チーをして役が無い手で、さらに自分の河に5索があります。出てきた2索でロンできない理由はどれですか。',
      board: cloneBoard(FURITEN_BOARD_E, {
        winTile: t('2s'),
        isTsumo: false,
        players: [{ seat: 0, label: '自分', isSelf: true, discards: parse('1z7z5s') }],
      }),
      resolver: 'ronBlockReason',
      choices: [
        { id: 'a', label: '振聴(フリテン)だから', value: 'furiten' },
        { id: 'b', label: '役が無いから', value: 'no-yaku' },
        { id: 'c', label: 'フリテンでも役なしでもなく、ロンできる', value: 'none' },
        { id: 'd', label: 'フリテンであり、かつ役も無いから', value: 'furiten-and-no-yaku' },
      ],
      expected: ['d'],
      explanation:
        '自分の河に待ち牌の5索があるので振聴(フリテン)、さらに役も1つもありません。理由は2つとも当てはまります。' +
        'この場合はツモっても役が無いためアガれません。',
    },
    {
      id: 'furiten-14',
      course: 'furiten',
      difficulty: 'easy',
      tags: ['ron-ok', 'riichi'],
      multi: false,
      prompt: '立直(リーチ)していて、自分の河に当たり牌(2索・5索)はありません。いま出た5索でロンできますか。',
      board: cloneBoard(FURITEN_BOARD_F, { winTile: t('5s'), isTsumo: false }),
      resolver: 'canRon',
      choices: YES_NO,
      expected: ['yes'],
      explanation:
        '振聴(フリテン)でもなく、立直(リーチ)という役もあるので、通常どおりロンできます。' +
        'ロンできる条件は「待ち牌であること」「フリテンでないこと」「役が1つ以上あること」の3つです。',
    },
    {
      id: 'furiten-15',
      course: 'furiten',
      difficulty: 'easy',
      tags: ['ron-ok', 'furiten-own-river'],
      multi: false,
      prompt: '自分の河には9萬・東・中・3筒があります。待ちは2索・5索です。この状態は振聴(フリテン)ですか。',
      board: cloneBoard(FURITEN_BOARD_F, { winTile: t('5s'), isTsumo: false }),
      resolver: 'isFuriten',
      choices: YES_NO,
      expected: ['no'],
      explanation:
        '自分の河に捨て牌があること自体はフリテンではありません。「河にある牌が、自分の待ち牌と同じかどうか」だけが問題です。' +
        'この河には2索も5索も無いのでフリテンではありません。',
    },
  ];

  // ==================================================
  // コース4: 現物クイズ
  // ==================================================

  /**
   * 現物クイズの盤面。
   * players の discards は「その人の河に並んでいる順」。
   * riichiIndex はリーチ宣言牌が河の何番目か(0始まり)。
   * 全員の捨て牌の前後関係は quizengine 側で
   *   turnIndex = 河の位置 * 4 + 席順
   * として決まるため、「リーチ宣言より後に他家が捨てて通った牌」も正しく現物になる。
   */
  function genbutsuQuestion(spec) {
    return Object.assign(
      {
        course: 'genbutsu',
        multi: true,
        resolver: 'genbutsuTiles',
        prompt: '下家(シモチャ)がリーチしています。自分の手牌から、下家に対する現物(ゲンブツ)をすべて選んでください。',
      },
      spec
    );
  }

  function candidateChoices(candidates) {
    return candidates.map((c, i) => ({
      id: 'c' + i,
      label: null,
      value: typeof c === 'number' ? c : c.tile,
      tile: typeof c === 'number' ? c : c.tile,
      aka: typeof c === 'number' ? false : !!c.aka,
    }));
  }

  const GENBUTSU_QUESTIONS = [
    genbutsuQuestion({
      id: 'genbutsu-01',
      difficulty: 'easy',
      tags: ['genbutsu'],
      board: {
        hand: parse('123m5m9m3p7p2s6s8s').concat(parse('456p')),
        targetSeat: 1,
        players: [
          { seat: 0, label: '自分', isSelf: true, discards: parse('1z7z') },
          { seat: 1, label: '下家', riichi: true, riichiIndex: 3, discards: parse('9m3p1z7s') },
          { seat: 2, label: '対面', discards: parse('2z5m') },
        ],
      },
      candidates: parse('9m3p7p2s'),
      choices: candidateChoices(parse('9m3p7p2s')),
      expected: ['c0', 'c1'],
      explanation:
        '現物(ゲンブツ)とは「その人自身が捨てている牌」のことです。下家の河には9萬と3筒があるので、この2枚は下家からロンされません。' +
        '自分が捨てた牌ではロンできない(振聴(フリテン))というルールがあるからです。7筒と2索は下家の河に無いので現物ではありません。',
    }),
    genbutsuQuestion({
      id: 'genbutsu-02',
      difficulty: 'easy',
      tags: ['genbutsu'],
      prompt:
        '下家(シモチャ)がリーチしています。リーチ宣言より前に捨てられた牌も含めて、下家に対する現物(ゲンブツ)をすべて選んでください。',
      board: {
        hand: parse('234m9m1p5p8p1s4s7s').concat(parse('789s')),
        targetSeat: 1,
        players: [
          { seat: 0, label: '自分', isSelf: true, discards: parse('1z2z') },
          { seat: 1, label: '下家', riichi: true, riichiIndex: 4, discards: parse('1p4s3z8p5z') },
          { seat: 2, label: '対面', discards: parse('7z9m') },
        ],
      },
      candidates: parse('1p5p8p4s'),
      choices: candidateChoices(parse('1p5p8p4s')),
      expected: ['c0', 'c2', 'c3'],
      explanation:
        'リーチ宣言より前に捨てた牌も、リーチ後に捨てた牌も、どちらも同じように現物(ゲンブツ)です。' +
        '下家の河にある1筒・8筒・4索は安全です。5筒は下家の河に無いので現物ではありません。',
    }),
    genbutsuQuestion({
      id: 'genbutsu-03',
      difficulty: 'normal',
      tags: ['genbutsu-other-river'],
      prompt:
        '下家(シモチャ)がリーチしています。対面(トイメン)の河にも牌が並んでいますが、下家に対する現物(ゲンブツ)だけをすべて選んでください。',
      board: {
        hand: parse('345m9m2p6p9p3s5s8s').concat(parse('678m')),
        targetSeat: 1,
        players: [
          { seat: 0, label: '自分', isSelf: true, discards: parse('1z2z') },
          { seat: 1, label: '下家', riichi: true, riichiIndex: 2, discards: parse('2p3s5z') },
          { seat: 2, label: '対面', discards: parse('6p9p') },
        ],
      },
      candidates: parse('2p6p9p3s'),
      choices: candidateChoices(parse('2p6p9p3s')),
      expected: ['c0', 'c3'],
      explanation:
        '現物は「その相手自身が捨てた牌」で決まります。6筒と9筒は対面が捨てているだけで、下家は捨てていません。' +
        'しかも対面が捨てたのは下家のリーチ宣言より前なので、下家がその牌を見逃した(ロンしなかった)ことにはならず、現物にはなりません。',
    }),
    genbutsuQuestion({
      id: 'genbutsu-04',
      difficulty: 'hard',
      tags: ['genbutsu-after-riichi'],
      prompt:
        '下家(シモチャ)が1巡目にリーチしました。その後に対面(トイメン)が捨てて通った牌もあります。下家に対する現物(ゲンブツ)をすべて選んでください。',
      board: {
        hand: parse('345m1m2p4p7p3s6s9s').concat(parse('678m')),
        targetSeat: 1,
        players: [
          { seat: 0, label: '自分', isSelf: true, discards: parse('1z2z3z') },
          { seat: 1, label: '下家', riichi: true, riichiIndex: 0, discards: parse('2p5z6z') },
          { seat: 2, label: '対面', discards: parse('9m7p4z') },
        ],
      },
      candidates: parse('2p4p7p9s'),
      choices: candidateChoices(parse('2p4p7p9s')),
      expected: ['c0', 'c2'],
      explanation:
        '2筒は下家自身の捨て牌なので現物です。7筒は対面が捨てた牌ですが、下家のリーチ宣言より後に出てロンされずに通っています。' +
        '一度見逃した牌ではロンできない(振聴(フリテン))ため、7筒も下家に対しては安全です。' +
        'リーチ後に場に出て通った牌は、現物として数えられます。',
    }),
    genbutsuQuestion({
      id: 'genbutsu-05',
      difficulty: 'normal',
      tags: ['genbutsu-aka'],
      prompt:
        '下家(シモチャ)がリーチしています。あなたの手牌の5萬は赤5(赤ドラ)です。下家に対する現物(ゲンブツ)をすべて選んでください。',
      board: {
        hand: parse('123m5m9m4p8p2s3s6s').concat(parse('789p')),
        targetSeat: 1,
        players: [
          { seat: 0, label: '自分', isSelf: true, discards: parse('1z2z') },
          { seat: 1, label: '下家', riichi: true, riichiIndex: 2, discards: parse('5m8p3z') },
          { seat: 2, label: '対面', discards: parse('7z4p') },
        ],
      },
      candidates: [{ tile: t('5m'), aka: true }, t('9m'), t('4p'), t('8p')],
      choices: candidateChoices([{ tile: t('5m'), aka: true }, t('9m'), t('4p'), t('8p')]),
      expected: ['c0', 'c3'],
      explanation:
        '赤5萬も、安全かどうかの判断では普通の5萬とまったく同じ牌として扱います。下家が5萬を捨てているので、赤5萬も現物です。' +
        '赤5はドラとして価値が高いので捨てたくない牌ですが、「安全かどうか」は色に関係なく、数字と種類だけで決まります。',
    }),
    genbutsuQuestion({
      id: 'genbutsu-06',
      difficulty: 'normal',
      tags: ['genbutsu'],
      prompt:
        '下家(シモチャ)がリーチしています。同じ数字でも種類が違えば別の牌です。下家に対する現物(ゲンブツ)をすべて選んでください。',
      board: {
        hand: parse('345m3p3s7p7s').concat(parse('456p678s')),
        targetSeat: 1,
        players: [
          { seat: 0, label: '自分', isSelf: true, discards: parse('1z2z') },
          { seat: 1, label: '下家', riichi: true, riichiIndex: 2, discards: parse('3p7s5z') },
          { seat: 2, label: '対面', discards: parse('4z3s') },
        ],
      },
      candidates: parse('3p3s7p7s'),
      choices: candidateChoices(parse('3p3s7p7s')),
      expected: ['c0', 'c3'],
      explanation:
        '下家が捨てているのは3筒と7索です。同じ「3」でも3索は別の牌なので現物ではありません。同様に7筒も現物ではありません。' +
        '数字だけを見て安心しないよう、必ず牌の種類(萬子・筒子・索子)まで確認してください。',
    }),
    genbutsuQuestion({
      id: 'genbutsu-07',
      difficulty: 'hard',
      tags: ['genbutsu-two-riichi'],
      prompt:
        '下家(シモチャ)と対面(トイメン)の2人がリーチしています。まず「下家に対する現物(ゲンブツ)」をすべて選んでください。',
      board: {
        hand: parse('345m2p5p2s5s').concat(parse('678m789p')),
        targetSeat: 1,
        players: [
          { seat: 0, label: '自分', isSelf: true, discards: parse('1z2z') },
          { seat: 1, label: '下家', riichi: true, riichiIndex: 2, discards: parse('2p5s3z') },
          { seat: 2, label: '対面', riichi: true, riichiIndex: 2, discards: parse('5p2s4z') },
        ],
      },
      candidates: parse('2p5p2s5s'),
      choices: candidateChoices(parse('2p5p2s5s')),
      expected: ['c0', 'c3'],
      explanation:
        '下家の河にあるのは2筒と5索なので、下家に対する現物はこの2枚です。' +
        '5筒と2索は対面に対しては現物ですが、下家は捨てていないので下家からはロンされる可能性があります。' +
        '現物は「誰に対して安全か」が牌ごとに違います。2人リーチのときは、両方の河に載っている牌を探すのが基本です。',
    }),
    genbutsuQuestion({
      id: 'genbutsu-08',
      difficulty: 'easy',
      tags: ['genbutsu'],
      board: {
        hand: parse('456m2m1p4p9p1s5s9s').concat(parse('789m')),
        targetSeat: 1,
        players: [
          { seat: 0, label: '自分', isSelf: true, discards: parse('3z6z') },
          { seat: 1, label: '下家', riichi: true, riichiIndex: 3, discards: parse('9p1s5z2z') },
          { seat: 2, label: '対面', discards: parse('1p4p') },
        ],
      },
      candidates: parse('1p4p9p1s'),
      choices: candidateChoices(parse('1p4p9p1s')),
      expected: ['c2', 'c3'],
      explanation:
        '下家の河にある9筒と1索が現物です。1筒と4筒は対面が捨てているだけで、しかも下家のリーチより前に捨てられているため現物にはなりません。',
    }),
    genbutsuQuestion({
      id: 'genbutsu-09',
      difficulty: 'normal',
      tags: ['genbutsu'],
      prompt: '下家(シモチャ)がリーチしています。字牌も含めて、下家に対する現物(ゲンブツ)をすべて選んでください。',
      board: {
        hand: parse('234m567m2p6p').concat([EAST, HAKU]).concat(parse('345s')),
        targetSeat: 1,
        players: [
          { seat: 0, label: '自分', isSelf: true, discards: parse('9m9s') },
          { seat: 1, label: '下家', riichi: true, riichiIndex: 3, discards: parse('1z2p6z7z') },
          { seat: 2, label: '対面', discards: parse('5z6p') },
        ],
      },
      candidates: [t('2p'), t('6p'), EAST, HAKU],
      choices: candidateChoices([t('2p'), t('6p'), EAST, HAKU]),
      expected: ['c0', 'c2'],
      explanation:
        '字牌も数牌と同じで、下家が捨てていれば現物です。下家の河には東と2筒があるので、この2枚は安全です。' +
        '白は下家の河に無いので現物ではありません(字牌でも当たることはあります)。',
    }),
    genbutsuQuestion({
      id: 'genbutsu-10',
      difficulty: 'normal',
      tags: ['genbutsu-after-riichi', 'genbutsu-other-river'],
      prompt:
        '下家(シモチャ)がリーチしています。他家の捨て牌がリーチの前か後かに注意して、下家に対する現物(ゲンブツ)をすべて選んでください。',
      board: {
        hand: parse('123m456m3p6p1s4s').concat(parse('789s')),
        targetSeat: 1,
        players: [
          { seat: 0, label: '自分', isSelf: true, discards: parse('1z2z3z4z') },
          { seat: 1, label: '下家', riichi: true, riichiIndex: 1, discards: parse('9m3p5z6z') },
          { seat: 2, label: '対面', discards: parse('1s7z8m6p') },
        ],
      },
      candidates: parse('3p6p1s4s'),
      choices: candidateChoices(parse('3p6p1s4s')),
      expected: ['c0', 'c1'],
      explanation:
        '3筒は下家自身の捨て牌なので現物です。6筒は対面が4枚目に捨てた牌で、下家のリーチ(2枚目で宣言)より後に通っているため現物になります。' +
        '一方1索は対面の1枚目、つまりリーチ宣言より前に捨てられているので現物ではありません。' +
        '「いつ捨てられたか」で安全かどうかが変わります。',
    }),
    genbutsuQuestion({
      id: 'genbutsu-11',
      difficulty: 'hard',
      tags: ['genbutsu-two-riichi'],
      prompt:
        '下家(シモチャ)と対面(トイメン)の2人がリーチしています。今度は「対面に対する現物(ゲンブツ)」をすべて選んでください。',
      board: {
        hand: parse('345m2p5p2s5s').concat(parse('678m789p')),
        targetSeat: 2,
        players: [
          { seat: 0, label: '自分', isSelf: true, discards: parse('1z2z') },
          { seat: 1, label: '下家', riichi: true, riichiIndex: 2, discards: parse('2p5s3z') },
          { seat: 2, label: '対面', riichi: true, riichiIndex: 2, discards: parse('5p2s4z') },
        ],
      },
      candidates: parse('2p5p2s5s'),
      choices: candidateChoices(parse('2p5p2s5s')),
      expected: ['c1', 'c2'],
      explanation:
        '同じ手牌・同じ場面でも、対象が変われば正解も変わります。対面の河にあるのは5筒と2索なので、対面に対する現物はこの2枚です。' +
        '2人リーチのときは、片方に安全な牌がもう片方には危険、ということが普通に起こります。',
    }),
    genbutsuQuestion({
      id: 'genbutsu-12',
      difficulty: 'normal',
      tags: ['genbutsu-aka'],
      prompt:
        '下家(シモチャ)がリーチしています。あなたの手牌には赤5索があります。下家に対する現物(ゲンブツ)をすべて選んでください。',
      board: {
        hand: parse('345m678m2p7p3s5s').concat(parse('456p')),
        targetSeat: 1,
        players: [
          { seat: 0, label: '自分', isSelf: true, discards: parse('1z9m') },
          { seat: 1, label: '下家', riichi: true, riichiIndex: 1, discards: parse('7p3s2z5z') },
          { seat: 2, label: '対面', discards: parse('5s4z') },
        ],
      },
      candidates: [t('2p'), t('7p'), t('3s'), { tile: t('5s'), aka: true }],
      choices: candidateChoices([t('2p'), t('7p'), t('3s'), { tile: t('5s'), aka: true }]),
      expected: ['c1', 'c2'],
      explanation:
        '赤5索は対面が普通の5索を捨てているだけで、下家は5索を捨てていません。赤かどうかに関係なく、下家に対しては現物ではありません。' +
        '「赤5だから」「対面が捨てたから」は安全の根拠になりません。',
    }),
    genbutsuQuestion({
      id: 'genbutsu-13',
      difficulty: 'easy',
      tags: ['genbutsu'],
      board: {
        hand: parse('222m5m8m3p6p1s7s9s').concat(parse('456s')),
        targetSeat: 1,
        players: [
          { seat: 0, label: '自分', isSelf: true, discards: parse('1z5z') },
          { seat: 1, label: '下家', riichi: true, riichiIndex: 2, discards: parse('5m1s7z') },
          { seat: 2, label: '対面', discards: parse('3p6p') },
        ],
      },
      candidates: parse('5m8m3p1s'),
      choices: candidateChoices(parse('5m8m3p1s')),
      expected: ['c0', 'c3'],
      explanation:
        '下家の河にある5萬と1索が現物です。3筒は対面が捨てているだけなので、下家に対しては安全とは言えません。' +
        '「誰かが捨てた牌」ではなく「その人が捨てた牌」を見るのが現物の考え方です。',
    }),
    genbutsuQuestion({
      id: 'genbutsu-14',
      difficulty: 'hard',
      tags: ['genbutsu', 'genbutsu-after-riichi'],
      prompt:
        '下家(シモチャ)がリーチしています。リーチ後にあなた自身が捨てて通った牌もあります。下家に対する現物(ゲンブツ)をすべて選んでください。',
      board: {
        hand: parse('123m789m2p4p6p8s').concat(parse('345s')),
        targetSeat: 1,
        players: [
          { seat: 0, label: '自分', isSelf: true, discards: parse('1z2z4p') },
          { seat: 1, label: '下家', riichi: true, riichiIndex: 1, discards: parse('9m2p3z') },
          { seat: 2, label: '対面', discards: parse('7z8z') },
        ],
      },
      candidates: parse('2p4p6p8s'),
      choices: candidateChoices(parse('2p4p6p8s')),
      expected: ['c0', 'c1'],
      explanation:
        '2筒は下家自身の捨て牌なので現物です。4筒は自分が3枚目に捨てた牌で、下家のリーチ(2枚目で宣言)より後に通っているので現物になります。' +
        '自分がすでに通した牌は、同じ相手に対しては安全に切り続けられます。',
    }),
    genbutsuQuestion({
      id: 'genbutsu-15',
      difficulty: 'normal',
      tags: ['genbutsu', 'genbutsu-other-river'],
      board: {
        hand: parse('345m6m7m9m1p4p2s6s').concat(parse('789p')),
        targetSeat: 1,
        players: [
          { seat: 0, label: '自分', isSelf: true, discards: parse('3z4z') },
          { seat: 1, label: '下家', riichi: true, riichiIndex: 3, discards: parse('9m2s1z5z') },
          { seat: 2, label: '対面', discards: parse('1p4p') },
        ],
      },
      candidates: parse('9m1p4p2s'),
      choices: candidateChoices(parse('9m1p4p2s')),
      expected: ['c0', 'c3'],
      explanation:
        '下家の河にある9萬と2索が現物です。1筒と4筒は対面がリーチ宣言より前に捨てた牌なので、下家に対しては現物ではありません。' +
        '現物は「その相手の河」と「その相手のリーチ後に通った牌」だけです。',
    }),
  ];

  const QUESTIONS = [].concat(
    YAKU_QUESTIONS,
    WAIT_QUESTIONS,
    FURITEN_QUESTIONS,
    GENBUTSU_QUESTIONS,
    QuizDataDefense.DEFENSE_QUESTIONS
  );

  function questionsForCourse(courseId) {
    return QUESTIONS.filter((q) => q.course === courseId);
  }

  function getQuestion(id) {
    return QUESTIONS.find((q) => q.id === id) || null;
  }

  function allQuestionIds() {
    return QUESTIONS.map((q) => q.id);
  }

  function getCourse(courseId) {
    return COURSES.find((c) => c.id === courseId) || null;
  }

  const QuizData = {
    parse,
    COURSES,
    QUESTIONS,
    questionsForCourse,
    getQuestion,
    allQuestionIds,
    getCourse,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = QuizData;
  } else {
    root.MJ = root.MJ || {};
    root.MJ.QuizData = QuizData;
  }
})(typeof window !== 'undefined' ? window : globalThis);
