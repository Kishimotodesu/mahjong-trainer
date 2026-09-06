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
   * @param {{count:number, questionIds:string[], rng:Function}} [options]
   *   questionIds を渡すと「その問題だけ」出題する(間違えた問題の復習用)。
   *   存在しないIDは無視する(問題データ更新でIDが消えてもエラーにしない)。
   */
  function pickQuestions(courseId, options) {
    options = options || {};
    const count = options.count === undefined ? DEFAULT_COUNT : options.count;
    const pool = QuizData.questionsForCourse(courseId);

    let candidates = pool;
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
    'genbutsu-after-riichi': 'リーチ後に通った牌',
    'genbutsu-other-river': '他家の河との違い',
    'genbutsu-aka': '赤5と通常の5の扱い',
    'genbutsu-two-riichi': '2人リーチのときの安全牌',
  };

  function tagLabel(tag) {
    return TAG_LABELS[tag] || tag;
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
      comment = `苦手なのは「${wrongTags[0].label}」のようです。ここだけ復習すれば正答率はすぐ上がります。`;
    } else {
      const top = wrongTags.slice(0, 2).map((t) => t.label).join('」と「');
      comment = `特に「${top}」でつまずいています。まずはこの2つを重点的に復習しましょう。`;
    }

    return {
      total,
      correct,
      rate,
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
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = QuizSession;
  } else {
    root.MJ = root.MJ || {};
    root.MJ.QuizSession = QuizSession;
  }
})(typeof window !== 'undefined' ? window : globalThis);
