/**
 * lessonengine.js
 * lessons.js のデータを実行するエンジン。
 *
 * 重要な方針: クイズの正解は、このファイルの resolver 関数が
 * "本番と同じ" ロジック(yaku.js の isYakuhaiTriplet, furiten.js の getFuritenState)を
 * 呼び出して都度計算する。lessons.js 側や、このファイルの外側に正解を
 * ハードコードしない(本番エンジンと教材の判定がずれることを防ぐため)。
 *
 * 進捗管理(未学習/学習済み/要復習/理解済み)もここで行い、
 * localStorageに保存する(何切る復習帳とは別のキーを使う。将来統合しやすいよう
 * データ形状はできるだけシンプルに保つ)。
 */
(function (root) {
  'use strict';

  let Tiles, Yaku, Furiten, Lessons;
  if (typeof module !== 'undefined' && module.exports) {
    Tiles = require('./tiles.js');
    Yaku = require('./yaku.js');
    Furiten = require('./furiten.js');
    Lessons = require('./lessons.js');
  } else {
    Tiles = root.MJ.Tiles;
    Yaku = root.MJ.Yaku;
    Furiten = root.MJ.Furiten;
    Lessons = root.MJ.Lessons;
  }

  const STORAGE_KEY = 'mahjong-trainer-lessons-v1';

  // ==================================================
  // resolver: ステップの「正解」を本番ロジックから計算する
  // ==================================================

  /** 3枚の牌が順子(同じ種類・連続した数字)になっているかどうか。字牌は常にfalse。 */
  function isSequence(tiles) {
    if (tiles.length !== 3) return false;
    if (tiles.some((t) => Tiles.isHonor(t))) return false;
    const sorted = tiles.slice().sort((a, b) => a - b);
    const suit0 = Tiles.suitOf(sorted[0]);
    if (Tiles.suitOf(sorted[1]) !== suit0 || Tiles.suitOf(sorted[2]) !== suit0) return false;
    return sorted[1] === sorted[0] + 1 && sorted[2] === sorted[0] + 2;
  }

  /**
   * ある牌をcount枚集めたとき、役牌(三元牌または場風・自風)として扱えるかどうか。
   * count<3ならまだ刻子(槓子)になっていないため常にfalse。
   * 本番の役判定(yaku.js の isYakuhaiTriplet)をそのまま利用する。
   */
  function yakuhaiFromCount(tile, count, ctx) {
    if (count < 3) return false;
    const meld = { type: 'triplet', tiles: [tile, tile, tile] };
    const result = Yaku.isYakuhaiTriplet(meld, ctx || {});
    return !!(result && result.length > 0);
  }

  /** フリテン教材用: 本番のFuriten.getFuritenStateをそのまま呼ぶ。 */
  function furitenStateFromArgs(args) {
    const fakePlayer = {
      discards: args.discards.map((t) => ({ tile: t })),
      furitenTemporary: !!args.furitenTemporary,
      furitenRiichi: !!args.furitenRiichi,
    };
    return Furiten.getFuritenState(fakePlayer, args.waitTiles);
  }

  const RESOLVERS = {
    isSequence: (args) => isSequence(args.tiles),
    yakuhaiFromCount: (args) => yakuhaiFromCount(args.tile, args.count, args.ctx),
    furitenCanRon: (args) => furitenStateFromArgs(args).canRon,
    furitenCanTsumo: (args) => furitenStateFromArgs(args).canTsumo,
    tieCompare: (args) => {
      if (args.a.shanten !== args.b.shanten) return args.a.shanten < args.b.shanten ? 'a' : 'b';
      if (args.a.ukeireTotal !== args.b.ukeireTotal) return args.a.ukeireTotal > args.b.ukeireTotal ? 'a' : 'b';
      return 'tie';
    },
  };

  /**
   * ステップを採点する。
   * @returns {{correct:boolean, resolvedValue:*, correctChoiceId:?string}}
   */
  function gradeStep(step, chosenChoiceId) {
    if (step.kind !== 'quiz' && step.kind !== 'tie') {
      return { correct: true, resolvedValue: null, correctChoiceId: null };
    }
    const resolver = RESOLVERS[step.resolver];
    if (!resolver) throw new Error('未知のresolver: ' + step.resolver);
    const resolvedValue = resolver(step.resolverArgs);
    const correctChoice = step.choices.find((c) => c.value === resolvedValue);
    const correctChoiceId = correctChoice ? correctChoice.id : null;
    return { correct: chosenChoiceId === correctChoiceId, resolvedValue, correctChoiceId };
  }

  // ==================================================
  // 進捗の保存(未学習/学習済み/要復習/理解済み)
  // ==================================================

  const STATUS = { NOT_STARTED: 'not_started', STUDIED: 'studied', NEEDS_REVIEW: 'needs_review', MASTERED: 'mastered' };
  const STATUS_LABEL = {
    not_started: '未学習',
    studied: '学習済み',
    needs_review: '要復習',
    mastered: '理解済み',
  };

  function loadProgress() {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
      if (!raw) return { version: 1, lessons: {} };
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.lessons !== 'object') return { version: 1, lessons: {} };
      return parsed;
    } catch (e) {
      return { version: 1, lessons: {} };
    }
  }

  function saveProgress(progress) {
    try {
      if (typeof localStorage === 'undefined') return false;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * 1ステップの回答結果を記録し、レッスン全体の状態を更新する。
   * 判定ルール:
   *  - 間違えたステップが1つでもあれば、そのレッスンは「要復習」
   *  - 全問(基本ステップのみ。advanced除く)正解なら「理解済み」
   *  - 一部だけ回答済みなら「学習済み」
   */
  function recordStepResult(lessonId, stepId, correct, progress) {
    const p = progress || loadProgress();
    if (!p.lessons[lessonId]) p.lessons[lessonId] = { steps: {}, status: STATUS.NOT_STARTED };
    const lesson = p.lessons[lessonId];
    lesson.steps[stepId] = { correct, lastAnsweredAt: new Date().toISOString() };

    const lessonDef = Lessons.getLesson(lessonId);
    const basicSteps = lessonDef ? lessonDef.steps.filter((s) => (s.kind === 'quiz' || s.kind === 'tie') && !s.advanced) : [];
    const answeredBasic = basicSteps.filter((s) => lesson.steps[s.id]);
    const anyWrong = basicSteps.some((s) => lesson.steps[s.id] && lesson.steps[s.id].correct === false);
    const allAnsweredCorrect =
      basicSteps.length > 0 && answeredBasic.length === basicSteps.length && basicSteps.every((s) => lesson.steps[s.id].correct);

    if (allAnsweredCorrect) lesson.status = STATUS.MASTERED;
    else if (anyWrong) lesson.status = STATUS.NEEDS_REVIEW;
    else if (answeredBasic.length > 0) lesson.status = STATUS.STUDIED;

    saveProgress(p);
    return p;
  }

  function statusOf(lessonId, progress) {
    const p = progress || loadProgress();
    return (p.lessons[lessonId] && p.lessons[lessonId].status) || STATUS.NOT_STARTED;
  }

  function summarize(progress) {
    const p = progress || loadProgress();
    const counts = { not_started: 0, studied: 0, needs_review: 0, mastered: 0 };
    const all = Lessons.listLessons();
    all.forEach((l) => {
      const s = statusOf(l.id, p);
      counts[s]++;
    });
    return { total: all.length, counts };
  }

  const LessonEngine = {
    STORAGE_KEY,
    STATUS,
    STATUS_LABEL,
    isSequence,
    yakuhaiFromCount,
    furitenStateFromArgs,
    gradeStep,
    loadProgress,
    saveProgress,
    recordStepResult,
    statusOf,
    summarize,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = LessonEngine;
  } else {
    root.MJ = root.MJ || {};
    root.MJ.LessonEngine = LessonEngine;
  }
})(typeof window !== 'undefined' ? window : globalThis);
