/**
 * stats.js
 * localStorage を使った成績の保存・集計。ログイン・DB不要。
 */
(function (root) {
  'use strict';

  const STORAGE_KEY = 'mahjong-trainer-stats-v1';
  const MAX_RECENT = 30;

  function loadRaw() {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
      if (!raw) return defaultStats();
      const parsed = JSON.parse(raw);
      return Object.assign(defaultStats(), parsed);
    } catch (e) {
      return defaultStats();
    }
  }

  function defaultStats() {
    return {
      totalAnswered: 0,
      matchedBest: 0, // おすすめ牌を選択できた回数
      gradeCounts: { excellent: 0, good: 0, fair: 0, bad: 0, unknown: 0 },
      recent: [], // {grade, chosenLabel, bestLabel, timestamp}
    };
  }

  function save(stats) {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
      }
    } catch (e) {
      // localStorageが使えない環境(プライベートモード等)では何もしない
    }
  }

  /**
   * 1回分の解答結果を記録する。
   * @param {{grade:string, chosenLabel:string, bestLabel:string}} result
   */
  function record(result) {
    const stats = loadRaw();
    stats.totalAnswered++;
    if (result.grade === 'excellent') stats.matchedBest++;
    if (stats.gradeCounts[result.grade] === undefined) stats.gradeCounts[result.grade] = 0;
    stats.gradeCounts[result.grade]++;

    stats.recent.unshift({
      grade: result.grade,
      chosenLabel: result.chosenLabel,
      bestLabel: result.bestLabel,
      timestamp: Date.now(),
    });
    stats.recent = stats.recent.slice(0, MAX_RECENT);

    save(stats);
    return summarize(stats);
  }

  function summarize(stats) {
    const total = stats.totalAnswered;
    const matchRate = total > 0 ? Math.round((stats.matchedBest / total) * 1000) / 10 : 0;
    const excellentRate =
      total > 0 ? Math.round(((stats.gradeCounts.excellent || 0) / total) * 1000) / 10 : 0;
    return {
      totalAnswered: total,
      matchRate,
      excellentRate,
      gradeCounts: stats.gradeCounts,
      recent: stats.recent,
    };
  }

  function getSummary() {
    return summarize(loadRaw());
  }

  function reset() {
    save(defaultStats());
  }

  const Stats = { record, getSummary, reset };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Stats;
  } else {
    root.MJ = root.MJ || {};
    root.MJ.Stats = Stats;
  }
})(typeof window !== 'undefined' ? window : globalThis);
