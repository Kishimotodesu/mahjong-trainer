/**
 * problems.js
 * 「何切る」問題モードの出題ロジック。
 * 継続進行はせず、毎回ランダムな14枚の問題を1つ生成する。
 *
 * V1.4: 初心者向けの学習レベル(LEVEL1〜5)を追加。
 *   レベルごとに「その回で学んでほしい判断」が含まれる手牌を、
 *   ランダム生成＋条件チェック(棄却サンプリング)で選び出す。
 *   条件に合う手が見つからない場合は、最後に生成した手をそのまま出題する
 *   (出題が止まってしまわないようにするため)。
 */
(function (root) {
  'use strict';

  let Tiles, Game, Evaluator, Review;
  if (typeof module !== 'undefined' && module.exports) {
    Tiles = require('./tiles.js');
    Game = require('./game.js');
    Evaluator = require('./evaluator.js');
    Review = require('./review.js');
  } else {
    Tiles = root.MJ.Tiles;
    Game = root.MJ.Game;
    Evaluator = root.MJ.Evaluator;
    Review = root.MJ.Review;
  }

  /** レベル定義(UIの説明文もここから使う) */
  const LEVELS = [
    {
      id: 'random',
      name: 'ランダム',
      theme: 'いろいろな形をランダムに出題します',
      hint: '今までどおりのランダム出題です。',
    },
    {
      id: 'level1',
      name: 'LEVEL 1 孤立牌・字牌',
      theme: 'まず不要な牌を見つける',
      hint: 'どこともつながっていない牌(孤立牌)や、1枚だけの字牌を見つけて切りましょう。',
    },
    {
      id: 'level2',
      name: 'LEVEL 2 両面・嵌張・辺張',
      theme: '強い形を残す',
      hint: '両面(34萬など)は広く、嵌張(35萬)・辺張(12萬)は狭い形です。弱い形から整理します。',
    },
    {
      id: 'level3',
      name: 'LEVEL 3 シャンテン数',
      theme: '手を後戻りさせない',
      hint: '切るとアガリまでの距離が遠くなる牌があります。距離を戻さない打牌を選びましょう。',
    },
    {
      id: 'level4',
      name: 'LEVEL 4 受け入れ枚数',
      theme: '同じシャンテンなら広い方を選ぶ',
      hint: 'どれを切っても距離は同じですが、次に嬉しい牌の枚数が違います。広い方を選びましょう。',
    },
    {
      id: 'level5',
      name: 'LEVEL 5 複合形',
      theme: '複数方向に変化できる形を理解する',
      hint: '3445萬のように複数の使い道がある形は、1つの形しか作れない牌より価値があります。',
    },
  ];

  function levelById(id) {
    return LEVELS.find((l) => l.id === id) || LEVELS[0];
  }

  /** レベルごとの「この手牌はその学習テーマに合っているか」の判定 */
  function matchesLevel(levelId, counts14, analysis) {
    const best = analysis.recommended;
    const discards = analysis.discards;
    const sameShanten = discards.filter((d) => d.resultShanten === best.resultShanten);
    const tags = Review ? Review.detectTags(counts14, analysis) : [];

    switch (levelId) {
      case 'level1':
        // おすすめが孤立牌、または1枚だけの字牌。かつ選択がはっきりしていること
        return (
          (best.wasIsolated || (best.tile >= 27 && counts14[best.tile] === 1)) &&
          discards.length >= 5
        );
      case 'level2': {
        // 両面と、嵌張または辺張の両方が手にあり、おすすめが弱い方の形に絡む
        const hasRyanmen = tags.indexOf('両面') !== -1;
        const hasWeak = tags.indexOf('嵌張') !== -1 || tags.indexOf('辺張') !== -1;
        return hasRyanmen && hasWeak && !best.wasIsolated;
      }
      case 'level3':
        // 切るとシャンテンが戻る候補が複数あり、正解を選べば戻らない
        return discards.filter((d) => d.resultShanten > best.resultShanten).length >= 2;
      case 'level4': {
        // 全候補が同じシャンテンで、受け入れ枚数に明確な差がある
        if (sameShanten.length < 3) return false;
        const minUke = Math.min.apply(null, sameShanten.map((d) => d.ukeireTotal));
        return best.ukeireTotal - minUke >= 6;
      }
      case 'level5':
        // 複合形を含み、かつ受け入れの差で選ぶ問題になっている
        return tags.indexOf('複合形') !== -1 && tags.indexOf('受け入れ') !== -1;
      default:
        return true;
    }
  }

  /**
   * 新しい問題を1問生成し、あわせて分析結果も返す。
   * @param {string} [levelId] 'random' | 'level1'..'level5'
   */
  function nextProblem(levelId) {
    const level = levelById(levelId || 'random');
    const maxTries = level.id === 'random' ? 1 : 80;

    let fallback = null;
    for (let i = 0; i < maxTries; i++) {
      const problem = Game.generateProblem();
      const counts14 = Tiles.toCounts(problem.tiles14);
      const analysis = Evaluator.analyzeHand(counts14);
      const candidate = {
        tiles14: problem.tiles14,
        counts14,
        analysis,
        answered: false,
        levelId: level.id,
        levelName: level.name,
        levelTheme: level.theme,
        levelHint: level.hint,
      };
      if (level.id === 'random' || matchesLevel(level.id, counts14, analysis)) return candidate;
      if (!fallback) fallback = candidate;
    }
    return fallback;
  }

  /**
   * 復習帳のエントリーから、同じ手牌をもう一度出題する。
   * @param {object} entry review.js のエントリー
   */
  function problemFromEntry(entry) {
    const counts14 = Tiles.toCounts(entry.tiles14);
    return {
      tiles14: entry.tiles14.slice(),
      counts14,
      analysis: Evaluator.analyzeHand(counts14),
      answered: false,
      levelId: 'review',
      levelName: '復習',
      levelTheme: 'もう一度解いてみましょう',
      levelHint: '',
      reviewEntry: entry,
    };
  }

  const Problems = { nextProblem, problemFromEntry, LEVELS, levelById, matchesLevel };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Problems;
  } else {
    root.MJ = root.MJ || {};
    root.MJ.Problems = Problems;
  }
})(typeof window !== 'undefined' ? window : globalThis);
