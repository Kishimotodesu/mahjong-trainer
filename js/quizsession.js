/**
 * quizsession.js
 * 「クイズ・学習」タブの出題制御。
 *
 * 責務はここに限定する:
 *   - 1回の挑戦で出す問題を選ぶ(既定10問・順番ランダム・同一挑戦内で重複なし)
 *   - 回答を quizengine.gradeQuestion に渡して採点する
 *   - 結果(正解数・正答率・間違えた問題の学習タグ)をまとめる
 * 正誤判定そのものは行わない(quizengine.js に委ねる)。
 * 履歴の保存も行わない(quizstats.js に委ねる)。
 */
(function (root) {
  'use strict';

  let QuizEngine, QuizData;
  if (typeof module !== 'undefined' && module.exports) {
    QuizEngine = require('./quizengine.js');
    QuizData = require('./quizdata.js');
  } else {
    QuizEngine = root.MJ.QuizEngine;
    QuizData = root.MJ.QuizData;
  }

  const DEFAULT_COUNT = 10;

  /** Fisher-Yates。テストのために乱数関数を差し替えられるようにしておく。 */
  function shuffle(list, rng) {
    const random = rng || Math.random;
    const arr = list.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  /**
   * 出題する問題を選ぶ。
   * @param {string} courseId
   * @param {{count:number, questionIds:string[], difficulty:string, rng:Function}} [options]
   *   questionIds を渡すと「その問題だけ」出題する(間違えた問題の復習用)。
   *   存在しないIDは無視する(問題データ更新でIDが消えてもエラーにしない)。
   *   difficulty を渡すとその難易度だけを出題する(守備判断クイズの初級/中級/実戦)。
   *   指定した難易度に問題が無い場合は、エラーにせずコース全体から出題する。
   */
  function pickQuestions(courseId, options) {
    options = options || {};
    const count = options.count === undefined ? DEFAULT_COUNT : options.count;
    const pool = QuizData.questionsForCourse(courseId);

    let candidates = pool;
    if (options.difficulty) {
      const filtered = pool.filter((q) => q.difficulty === options.difficulty);
      if (filtered.length > 0) candidates = filtered;
    }
    if (options.questionIds && options.questionIds.length > 0) {
      const wanted = new Set(options.questionIds);
      candidates = pool.filter((q) => wanted.has(q.id));
      if (candidates.length === 0) candidates = pool; // 復習対象が全て消えていた場合は通常出題に戻す
    }

    const shuffled = shuffle(candidates, options.rng);
    // slice で切り出すため、同じ挑戦の中で同じ問題が2回出ることはない
    return shuffled.slice(0, Math.min(count, shuffled.length));
  }

  /**
   * 新しい挑戦(セッション)を作る。
   * @returns {{courseId:string, questions:Array, index:number, answers:Array, mode:string, finished:boolean}}
   */
  function createSession(courseId, options) {
    options = options || {};
    const questions = pickQuestions(courseId, options);
    return {
      courseId,
      questions,
      index: 0,
      answers: [],
      mode: options.questionIds && options.questionIds.length > 0 ? 'review' : 'normal',
      difficulty: options.difficulty || null,
      finished: questions.length === 0,
    };
  }

  function currentQuestion(session) {
    return session.questions[session.index] || null;
  }

  /**
   * 現在の問題に回答する。採点は quizengine が行う。
   * @param {object} session
   * @param {string[]} selectedIds
   */
  function answerCurrent(session, selectedIds) {
    const question = currentQuestion(session);
    if (!question) throw new Error('回答できる問題がありません');
    const graded = QuizEngine.gradeQuestion(question, selectedIds);
    const record = {
      questionId: question.id,
      correct: graded.correct,
      tags: question.tags || [],
      difficulty: question.difficulty || null,
      // 待ち読み(V1.9): 集計用のキー(文字列)と、表示用の詳細を別々に持つ
      // 待ち的中を採点しない問題(reasoning-only)では hit は null のままにする。
      // この null が「待ち成績の分母に入れない」という意味になる。
      scoring: graded.scoring || null,
      reasoning: graded.reasoning ? graded.reasoning.gradeKey : null,
      hit: graded.hit ? graded.hit.levelKey : null,
      reasoningDetail: graded.reasoning || null,
      hitDetail: graded.hit || null,
      actualWaits: graded.actualWaits || null,
      selectedIds: graded.selectedIds,
      correctIds: graded.correctIds,
      resolved: graded.resolved,
    };
    session.answers[session.index] = record;
    return record;
  }

  /** 次の問題へ進む。最終問題を過ぎたら finished=true になる。 */
  function goNext(session) {
    if (session.index + 1 >= session.questions.length) {
      session.finished = true;
    } else {
      session.index += 1;
    }
    return session;
  }

  const TAG_LABELS = {
    yakuhai: '役牌(ヤクハイ)の判断',
    'dora-not-yaku': 'ドラは役ではないという理解',
    'menzen-only': '門前(メンゼン)限定の役',
    kuisagari: '鳴くと翻が下がる役',
    tanyao: '断么九(タンヤオ)',
    pinfu: '平和(ピンフ)',
    iipeikou: '一盃口(イーペーコー)',
    chiitoitsu: '七対子(チートイツ)',
    toitoi: '対々和(トイトイ)',
    honitsu: '混一色(ホンイツ)',
    chinitsu: '清一色(チンイツ)',
    riichi: '立直(リーチ)',
    tsumo: '門前清自摸和(メンゼンツモ)',
    han: '翻(ハン)の数え方',
    ryanmen: '両面待ち(リャンメンマチ)',
    kanchan: '嵌張待ち(カンチャンマチ)',
    penchan: '辺張待ち(ペンチャンマチ)',
    shanpon: '双碰待ち(シャンポンマチ)',
    tanki: '単騎待ち(タンキマチ)',
    'multi-wait': '多面待ち(タメンマチ)',
    'chiitoitsu-wait': '七対子の単騎待ち',
    'wait-count': '待ち牌の残り枚数の数え方',
    'furiten-own-river': '自分の河によるフリテン',
    'furiten-multi': '複数待ちのフリテン',
    'furiten-tsumo': 'フリテンでもツモならアガれること',
    'furiten-temporary': '同巡内フリテン',
    'furiten-riichi': 'リーチ後の見逃しフリテン',
    'no-yaku': '役なしでロンできないケース',
    'ron-ok': '通常どおりロンできるケース',
    genbutsu: '現物(ゲンブツ)の基本',
    // 守備判断クイズ(V1.8)
    'suji-basic': '筋(スジ)の基本',
    'suji-not-safe': '筋は完全な安全牌ではないこと',
    kabe: '壁(カベ)の使い方',
    'one-chance': 'ワンチャンスの使い方',
    'honor-tile': '字牌(ジハイ)の安全度',
    'live-honor': '生牌(ションパイ)の危険',
    'dora-danger': 'ドラとその周辺の危険',
    'multi-factor': '複数の材料を組み合わせた比較',
    'multi-riichi': '2人リーチのときの安全牌',
    // 相手の待ち読み(V1.9)
    'reading-genbutsu': '河から現物(ゲンブツ)を見つけること',
    'reading-suji': '河から筋(スジ)を読むこと',
    'reading-kabe': '壁(カベ)を使った読み',
    'reading-one-chance': 'ワンチャンスを使った読み',
    'reading-honor': '字牌(ジハイ)待ちの読み',
    'reading-dora': 'ドラ周辺の読み',
    'reading-open-hand': '鳴いている相手の読み',
    'reading-honitsu': '染め手(混一色)の読み',
    'reading-toitoi': '対々和(トイトイ)の読み',
    'reading-multi-wait': '多面待ちの考え方',
    'reading-not-certain': '河だけでは断定できないという理解',
    'reading-two-riichi': '2人リーチのときの読み分け',
    'genbutsu-after-riichi': 'リーチ後に通った牌',
    'genbutsu-other-river': '他家の河との違い',
    'genbutsu-aka': '赤5と通常の5の扱い',
    'genbutsu-two-riichi': '2人リーチのときの安全牌',
  };

  function tagLabel(tag) {
    return TAG_LABELS[tag] || tag;
  }

  /**
   * 学習タグごとの「次に何をすればよいか」を初心者向けの言葉で伝える。
   * 用語だけを並べても復習の手がかりにならないため、間違いの傾向と次の一手をセットで書く。
   */
  const TAG_ADVICE = {
    'suji-basic': '筋(スジ)の考え方があいまいなようです。1・4・7 / 2・5・8 / 3・6・9 の組をもう一度確認しましょう。',
    'suji-not-safe':
      '筋(スジ)を完全な安全牌だと考えてしまう傾向があります。筋で否定できるのは両面待ちの一部だけなので、次は「筋でも当たる問題」を復習しましょう。',
    genbutsu: '現物(ゲンブツ)の見つけ方を復習しましょう。安全と言い切れるのは、その相手自身の河にある牌だけです。',
    kabe: '壁(カベ)の使い方を復習しましょう。4枚見えの牌を使う形は作れない、という考え方が土台になります。',
    'one-chance': 'ワンチャンスを過信していないか確認しましょう。残り1枚を相手が持っていれば当たります(壁より弱い根拠です)。',
    'honor-tile': '字牌(ジハイ)は「見えている枚数」で安全度が変わります。何枚見えているかを数える練習をしましょう。',
    'live-honor': '生牌(ションパイ)の字牌、特に役牌(ヤクハイ)の危険を軽く見ている傾向があります。終盤ほど注意しましょう。',
    'dora-danger': 'ドラとその周辺は残されやすい牌です。ただし現物ならドラでも安全、という区別も一緒に覚えましょう。',
    'multi-factor': '材料が複数あるときの比べ方を復習しましょう。現物 > 壁 > 筋 > ワンチャンス の順で根拠が強くなります。',
    'multi-riichi': '「誰に対して安全か」を分けて考える練習をしましょう。片方の現物が、もう片方に安全とは限りません。',
    'furiten-own-river': '自分の河に待ち牌が入っていないかを毎回確認する習慣をつけましょう。',
    'dora-not-yaku': 'ドラは役ではありません。アガるには役が別に必要、という点を復習しましょう。',
    'reading-not-certain':
      '河から待ちを断定しようとしていないか確認しましょう。読みで分かるのは「候補を絞ること」までで、当てられなくても問題ありません。',
    'reading-suji': '筋(スジ)は3つ違いの関係(1-4-7 / 2-5-8 / 3-6-9)です。どの牌の筋なのかを数えて確認しましょう。',
    'reading-honitsu': '染め手(混一色)を疑う手掛かりを復習しましょう。「切っていない色」と「鳴いた色」に注目します。',
    'reading-toitoi': 'ポンが2つ以上ある相手は、双碰(シャンポン)・単騎(タンキ)待ちが増えます。字牌や端の牌も警戒しましょう。',
    'reading-honor': '河に字牌が出ていない相手は、字牌待ちの可能性が残ります。何が切られていないかを見る練習をしましょう。',
    'reading-multi-wait': '多面待ちは候補が多く、3種類選んでも拾いきれません。当てにいくより、無筋を減らす考え方を身につけましょう。',
    'reading-two-riichi': '2人リーチでは「どちらに対する読みなのか」を必ず分けて考えましょう。',
  };

  function tagAdvice(tag) {
    return TAG_ADVICE[tag] || null;
  }

  /**
   * 結果画面用のまとめ。
   * @returns {{total:number, correct:number, rate:number, wrongQuestionIds:string[],
   *            wrongTags:Array<{tag:string,label:string,count:number}>, comment:string,
   *            results:Array}}
   */
  function summarize(session) {
    const results = session.answers.filter(Boolean);
    const total = session.questions.length;
    const correct = results.filter((r) => r.correct).length;
    const rate = total > 0 ? Math.round((correct / total) * 100) : 0;

    const wrong = results.filter((r) => !r.correct);
    const tagCount = {};
    wrong.forEach((r) => (r.tags || []).forEach((t) => (tagCount[t] = (tagCount[t] || 0) + 1)));
    const wrongTags = Object.keys(tagCount)
      .map((tag) => ({ tag, label: tagLabel(tag), count: tagCount[tag] }))
      .sort((a, b) => b.count - a.count);

    let comment;
    if (total === 0) {
      comment = '出題できる問題がありませんでした。';
    } else if (wrong.length === 0) {
      comment = '全問正解です。この分野は理解できています。次のコースにも挑戦してみましょう。';
    } else if (wrongTags.length === 1) {
      comment =
        tagAdvice(wrongTags[0].tag) || `苦手なのは「${wrongTags[0].label}」のようです。ここだけ復習すれば正答率はすぐ上がります。`;
    } else {
      const top = wrongTags.slice(0, 2).map((t) => t.label).join('」と「');
      const advice = tagAdvice(wrongTags[0].tag);
      comment = `特に「${top}」でつまずいています。` + (advice || 'まずはこの2つを重点的に復習しましょう。');
    }

    const reasoningCounts = { excellent: 0, good: 0, needsWork: 0 };
    const hitCounts = { hit: 0, partial: 0, miss: 0 };
    let readingAnswered = 0;
    // 待ち的中を採点した問題数。reasoning-only の問題はここに数えない(分母に入れない)。
    let hitAnswered = 0;
    let reasoningOnlyAnswered = 0;
    results.forEach((r) => {
      if (r.reasoning) {
        reasoningCounts[r.reasoning] = (reasoningCounts[r.reasoning] || 0) + 1;
        readingAnswered++;
      }
      if (r.hit) {
        hitCounts[r.hit] = (hitCounts[r.hit] || 0) + 1;
        hitAnswered++;
      } else if (r.scoring === 'reasoning-only') {
        reasoningOnlyAnswered++;
      }
    });

    return {
      total,
      correct,
      rate,
      readingAnswered,
      hitAnswered,
      reasoningOnlyAnswered,
      reasoningCounts,
      hitCounts,
      wrongQuestionIds: wrong.map((r) => r.questionId),
      wrongTags,
      comment,
      results,
    };
  }

  const QuizSession = {
    DEFAULT_COUNT,
    TAG_LABELS,
    shuffle,
    pickQuestions,
    createSession,
    currentQuestion,
    answerCurrent,
    goNext,
    summarize,
    tagLabel,
    TAG_ADVICE,
    tagAdvice,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = QuizSession;
  } else {
    root.MJ = root.MJ || {};
    root.MJ.QuizSession = QuizSession;
  }
})(typeof window !== 'undefined' ? window : globalThis);
