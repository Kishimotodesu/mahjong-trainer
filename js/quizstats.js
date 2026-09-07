/**
 * quizstats.js
 * 「クイズ・学習」タブの学習履歴(localStorage)。
 *
 * 既存の保存データ(何切る復習帳・牌譜・成績・ミニレッスン)には一切触れず、
 * 専用のキー 'mahjong-trainer-quiz-v1' だけを読み書きする。
 * 将来データ構造を変える場合は version を上げ、読み込み時に移行する。
 */
(function (root) {
  'use strict';

  const STORAGE_KEY = 'mahjong-trainer-quiz-v1';
  // version 2 (V1.9.1): 待ち的中の集計方法を変更した。
  //  version 1 の hit は「危険牌を選ぶ問題」も分母に含めていたため、意味が違う。
  //  移行では古い集計を hitLegacy へ退避するだけで、削除も書き換えもしない。
  const VERSION = 2;

  function emptyCourse() {
    // byDifficulty はV1.8、reasoning/hit はV1.9で追加。
    // 古い保存データには存在しないため、読み込み時に必ず補う。
    return {
      attempts: 0,
      correct: 0,
      answered: 0,
      lastAt: null,
      wrongQuestionIds: [],
      byDifficulty: {},
      // 推理評価(公開情報の使い方)と待ち的中(実際の待ちと合っていたか)は別々に数える。
      // hit に数えるのは、待ち予想を採点した問題(hit-any / hit-coverage)だけ。
      reasoning: { excellent: 0, good: 0, needsWork: 0 },
      hit: { hit: 0, partial: 0, miss: 0 },
      // version 1 で集計した古い待ち的中(採点方法が違うため、新しい集計とは混ぜない)
      hitLegacy: null,
    };
  }

  function emptyStore() {
    return { version: VERSION, courses: {}, tags: {} };
  }

  /** 壊れたデータ・未知のバージョンでもエラーにせず、空の履歴として扱う。 */
  function load() {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
      if (!raw) return emptyStore();
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || typeof parsed.courses !== 'object' || parsed.courses === null) {
        return emptyStore();
      }
      return migrate({
        version: parsed.version || 1,
        courses: parsed.courses,
        tags: parsed.tags && typeof parsed.tags === 'object' ? parsed.tags : {},
      });
    } catch (e) {
      return emptyStore();
    }
  }

  /**
   * 保存形式の移行。既存データは消さず、意味が変わったものだけ退避する。
   * version 1 → 2: 待ち的中(hit)の集計対象が変わったため、古い値を hitLegacy に移し、
   * 新しい集計は 0 から始める。挑戦回数・正答数・タグ・難易度別成績には触れない。
   */
  function migrate(store) {
    if (store.version >= VERSION) return store;
    Object.keys(store.courses).forEach((courseId) => {
      const c = store.courses[courseId];
      if (!c || typeof c !== 'object') return;
      if (c.hit && typeof c.hit === 'object' && !c.hitLegacy) {
        const total = (c.hit.hit || 0) + (c.hit.partial || 0) + (c.hit.miss || 0);
        if (total > 0) c.hitLegacy = Object.assign({ hit: 0, partial: 0, miss: 0 }, c.hit);
        c.hit = { hit: 0, partial: 0, miss: 0 };
      }
    });
    store.version = VERSION;
    return store;
  }

  function save(store) {
    try {
      if (typeof localStorage === 'undefined') return false;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
      return true;
    } catch (e) {
      // プライベートモード等で保存できない場合も、アプリは動き続ける
      return false;
    }
  }

  function courseStats(courseId, store) {
    const s = store || load();
    const c = s.courses[courseId];
    if (!c) return emptyCourse();
    return Object.assign(emptyCourse(), c, {
      wrongQuestionIds: Array.isArray(c.wrongQuestionIds) ? c.wrongQuestionIds : [],
      byDifficulty: c.byDifficulty && typeof c.byDifficulty === 'object' ? c.byDifficulty : {},
      reasoning: Object.assign({ excellent: 0, good: 0, needsWork: 0 }, c.reasoning || {}),
      hit: Object.assign({ hit: 0, partial: 0, miss: 0 }, c.hit || {}),
      hitLegacy: c.hitLegacy && typeof c.hitLegacy === 'object' ? Object.assign({ hit: 0, partial: 0, miss: 0 }, c.hitLegacy) : null,
    });
  }

  /** 正答率(%)。未挑戦なら null。 */
  function accuracy(stats) {
    if (!stats || !stats.answered) return null;
    return Math.round((stats.correct / stats.answered) * 100);
  }

  /**
   * 1回の挑戦結果を記録する。
   * @param {string} courseId
   * @param {Array<{questionId:string, correct:boolean, tags:string[], difficulty:?string}>} results
   * @param {object} [store]
   */
  function recordAttempt(courseId, results, store) {
    const s = store || load();
    if (!s.courses[courseId]) s.courses[courseId] = emptyCourse();
    const c = s.courses[courseId];
    if (!Array.isArray(c.wrongQuestionIds)) c.wrongQuestionIds = [];
    if (!c.byDifficulty || typeof c.byDifficulty !== 'object') c.byDifficulty = {};
    if (!c.reasoning || typeof c.reasoning !== 'object') c.reasoning = { excellent: 0, good: 0, needsWork: 0 };
    if (!c.hit || typeof c.hit !== 'object') c.hit = { hit: 0, partial: 0, miss: 0 };
    s.version = VERSION;

    c.attempts += 1;
    c.answered += results.length;
    c.correct += results.filter((r) => r.correct).length;
    c.lastAt = new Date().toISOString();

    const wrongSet = new Set(c.wrongQuestionIds);
    results.forEach((r) => {
      if (r.correct) wrongSet.delete(r.questionId);
      else wrongSet.add(r.questionId);
      (r.tags || []).forEach((tag) => {
        if (!s.tags[tag]) s.tags[tag] = { correct: 0, wrong: 0 };
        if (r.correct) s.tags[tag].correct += 1;
        else s.tags[tag].wrong += 1;
      });
      if (r.difficulty) {
        if (!c.byDifficulty[r.difficulty]) c.byDifficulty[r.difficulty] = { correct: 0, answered: 0 };
        c.byDifficulty[r.difficulty].answered += 1;
        if (r.correct) c.byDifficulty[r.difficulty].correct += 1;
      }
      // 推理評価と待ち的中は、別々の指標として保存する(混ぜない)。
      // 待ち的中を採点しなかった問題は r.hit が null なので、分母にも入らない。
      if (r.reasoning) c.reasoning[r.reasoning] = (c.reasoning[r.reasoning] || 0) + 1;
      if (r.hit) c.hit[r.hit] = (c.hit[r.hit] || 0) + 1;
    });
    c.wrongQuestionIds = [...wrongSet];

    save(s);
    return s;
  }

  /**
   * 復習対象の問題IDを返す。
   * 問題データを更新して存在しなくなったIDは、エラーにせず単に除外する。
   * @param {string} courseId
   * @param {string[]} existingIds 現在の問題データに存在するID一覧
   */
  function wrongQuestionIds(courseId, existingIds, store) {
    const stats = courseStats(courseId, store);
    if (!existingIds) return stats.wrongQuestionIds.slice();
    const exists = new Set(existingIds);
    return stats.wrongQuestionIds.filter((id) => exists.has(id));
  }

  /**
   * 待ち読みコースの成績。
   * 「待ち的中率」はユーザー自身のクイズ成績であり、放銃率や実際の待ちの確率ではない。
   * hitTotal は「待ち予想を採点した問題数」で、危険牌を選ぶ問題(reasoning-only)は含まない。
   */
  function readingStats(courseId, store) {
    const stats = courseStats(courseId, store);
    const reasoning = stats.reasoning;
    const hit = stats.hit;
    const reasoningTotal = reasoning.excellent + reasoning.good + reasoning.needsWork;
    const hitTotal = hit.hit + hit.partial + hit.miss;
    return {
      reasoning,
      hit,
      reasoningTotal,
      // 待ち予想を採点した問題数(reasoning-only は分母に入らない)
      hitTotal,
      hitScored: hitTotal,
      // 推理評価は付いたが、待ち的中は採点しなかった問題数(危険牌を選ぶ問題)
      reasoningOnlyTotal: Math.max(0, reasoningTotal - hitTotal),
      reasonableRate: reasoningTotal ? Math.round(((reasoning.excellent + reasoning.good) / reasoningTotal) * 100) : null,
      hitRate: hitTotal ? Math.round(((hit.hit + hit.partial) / hitTotal) * 100) : null,
      // V1.9 までの古い集計(採点方法が違うので、新しい成績とは混ぜずに残してある)
      legacyHit: stats.hitLegacy,
    };
  }

  /** 難易度別の成績(未挑戦の難易度は 0/0 で返す) */
  function difficultyStats(courseId, difficultyIds, store) {
    const stats = courseStats(courseId, store);
    const out = {};
    (difficultyIds || Object.keys(stats.byDifficulty)).forEach((id) => {
      const d = stats.byDifficulty[id] || { correct: 0, answered: 0 };
      out[id] = {
        correct: d.correct || 0,
        answered: d.answered || 0,
        rate: d.answered ? Math.round((d.correct / d.answered) * 100) : null,
      };
    });
    return out;
  }

  function tagStats(store) {
    const s = store || load();
    return s.tags || {};
  }

  /** クイズの履歴だけを消す(他機能の保存データには触れない)。 */
  function resetAll() {
    try {
      if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY);
      return true;
    } catch (e) {
      return false;
    }
  }

  function formatDateTime(iso) {
    if (!iso) return '未挑戦';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '未挑戦';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  const QuizStats = {
    STORAGE_KEY,
    VERSION,
    emptyCourse,
    emptyStore,
    migrate,
    load,
    save,
    courseStats,
    accuracy,
    recordAttempt,
    difficultyStats,
    readingStats,
    wrongQuestionIds,
    tagStats,
    resetAll,
    formatDateTime,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = QuizStats;
  } else {
    root.MJ = root.MJ || {};
    root.MJ.QuizStats = QuizStats;
  }
})(typeof window !== 'undefined' ? window : globalThis);
