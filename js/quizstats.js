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
  const VERSION = 1;

  function emptyCourse() {
    // byDifficulty はV1.8で追加。古い保存データには存在しないため、読み込み時に必ず補う。
    return { attempts: 0, correct: 0, answered: 0, lastAt: null, wrongQuestionIds: [], byDifficulty: {} };
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
      return {
        version: parsed.version || VERSION,
        courses: parsed.courses,
        tags: parsed.tags && typeof parsed.tags === 'object' ? parsed.tags : {},
      };
    } catch (e) {
      return emptyStore();
    }
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
    load,
    save,
    courseStats,
    accuracy,
    recordAttempt,
    difficultyStats,
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
