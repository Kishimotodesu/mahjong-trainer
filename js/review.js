/**
 * review.js
 * 「何切る復習帳」の中核ロジック(DOM非依存)。
 *
 * 目的:
 *  - 間違えた「何切る」を自動的に問題帳へ貯め、繰り返し解いて覚えられるようにする。
 *  - 初心者が「何を保存すればよいか」を判断しなくてよいよう、学習価値の高い局面は自動保存する。
 *
 * データはlocalStorageに1キーで保存する。構造は下記 createStore() を参照。
 */
(function (root) {
  'use strict';

  let Tiles, Shanten, Evaluator;
  if (typeof module !== 'undefined' && module.exports) {
    Tiles = require('./tiles.js');
    Shanten = require('./shanten.js');
    Evaluator = require('./evaluator.js');
  } else {
    Tiles = root.MJ.Tiles;
    Shanten = root.MJ.Shanten;
    Evaluator = root.MJ.Evaluator;
  }

  const STORAGE_KEY = 'mahjong-trainer-review-v1';
  const SCHEMA_VERSION = 1;
  const MAX_ENTRIES = 300; // 上限。超えたら「習得」済みの古いものから間引く
  const DAILY_REVIEW_SIZE = 5;

  // ==================================================
  // 学習タグ
  // ==================================================

  /** タグ名 → 初心者向けの説明 */
  const TAG_INFO = {
    孤立牌: {
      short: 'どこともつながっていない牌を見つける',
      description: '孤立牌: 9索のように、周りの牌とつながっていない牌です。まずこういう牌から切るのが基本です。',
    },
    両面: {
      short: '左右どちらでも受けられる強い形',
      description: '両面: 34萬のように、2萬でも5萬でも順子になる形です。受け入れが広いので優先して残します。',
    },
    嵌張: {
      short: '間の1種類だけを待つ形',
      description: '嵌張: 35萬のように、間の4萬だけを待つ形です。両面より受け入れが狭くなります。',
    },
    辺張: {
      short: '端にあって片側しか受けられない形',
      description: '辺張: 12萬のように、3萬しか受けられない形です。両面に変わる余地も少ないので価値は低めです。',
    },
    対子: {
      short: '同じ牌2枚の使い道を判断する',
      description: '対子: 同じ牌2枚の形です。雀頭(アタマ)にも刻子にもできますが、余ると使いにくくなります。',
    },
    シャンテン戻し: {
      short: 'アガリまでの距離を戻さない',
      description: 'シャンテン戻し: 切るとアガリまでの距離が1歩遠くなる打牌です。初心者のうちは基本的に避けます。',
    },
    受け入れ: {
      short: '同じ距離なら広い方を選ぶ',
      description: '受け入れ: 次に引いて嬉しい牌の枚数です。シャンテン数が同じなら、受け入れが多い方を選びます。',
    },
    複合形: {
      short: '複数の使い道を持つ形',
      description: '複合形: 3445萬のように、複数の使い道を持つ形を残す判断です。1つの形にしか見えない牌より価値があります。',
    },
    字牌処理: {
      short: '役に絡まない字牌をいつ切るか',
      description: '字牌処理: 東南西北や白發中の扱いです。2枚以上なら使い道がありますが、1枚だけなら早めに整理します。',
    },
    役牌候補: {
      short: '3枚集めると役になる字牌',
      description: '役牌候補: 白・發・中(三元牌)や、今の場風・自風と一致する風牌です。3枚(刻子)にすると役が1つ確保できます。',
    },
    客風: {
      short: '3枚集めても役にならない風牌',
      description: '客風(きゃふー): 今の場風でも自風でもない風牌です。面子にはなりますが、何枚集めても役牌にはなりません。',
    },
    字牌対子: {
      short: '字牌2枚をどう活かすか',
      description: '字牌対子: 字牌が2枚(対子)ある状態です。雀頭にできますが、役牌にするにはあと1枚集める必要があります。',
    },
    字牌同率比較: {
      short: '孤立字牌がどちらも同じ価値の場合',
      description: '字牌同率比較: 複数の孤立字牌でシャンテン数・受け入れ枚数が同じ場合、牌効率上は同率です。役の可能性など別の観点で選んでも構いません。',
    },
  };

  const ALL_TAGS = Object.keys(TAG_INFO);

  /** 同じ種類の中の「連続した並び」を見て複合形(複数の使い道がある形)を判定する */
  function hasComplexShape(counts14) {
    for (let suit = 0; suit < 3; suit++) {
      const base = suit * 9;
      for (let start = 0; start <= 5; start++) {
        let total = 0;
        let kinds = 0;
        for (let k = 0; k < 4; k++) {
          const c = counts14[base + start + k];
          total += c;
          if (c > 0) kinds++;
        }
        // 4連続の枠に4枚以上・3種類以上あれば「複数の使い道がある形」とみなす
        if (total >= 4 && kinds >= 3) return true;
      }
    }
    return false;
  }

  const DRAGON_TILES = [31, 32, 33];
  const WIND_TILES = [27, 28, 29, 30];

  /**
   * 手牌14枚と分析結果から学習タグを判定する。
   * 既存の形判定(shanten.jsのブロック分解)をそのまま利用する。
   * @param {number[]} counts14
   * @param {object} [analysis]
   * @param {{seatWind:number, roundWind:number}} [windCtx] 分かる場合のみ渡す(自風・客風の判定に使う)。
   *   省略しても既存の呼び出し元との互換性は保たれる(客風・役牌候補の判定を一部省略するだけ)。
   */
  function detectTags(counts14, analysis, windCtx) {
    const tags = [];
    const add = (t) => {
      if (tags.indexOf(t) === -1) tags.push(t);
    };

    const info = analysis || Evaluator.analyzeHand(counts14);
    const blocks = info.baseBlocks || Shanten.standardShanten(counts14, 0).blocks;

    blocks.forEach((b) => {
      if (b.type === 'ryanmen') add('両面');
      else if (b.type === 'kanchan') add('嵌張');
      else if (b.type === 'penchan') add('辺張');
      else if (b.type === 'pair') {
        add('対子');
        if (b.tiles[0] >= 27) add('字牌対子');
      }
    });

    if (info.discards.some((d) => d.wasIsolated)) add('孤立牌');

    // 字牌が手にあれば字牌処理の判断が発生する(孤立/役牌候補/客風の文脈も分かれば追加する)
    let hasHonor = false;
    for (let i = 27; i < Tiles.TILE_COUNT; i++) {
      if (counts14[i] <= 0) continue;
      hasHonor = true;
      if (DRAGON_TILES.indexOf(i) !== -1) {
        add('役牌候補');
      } else if (WIND_TILES.indexOf(i) !== -1 && windCtx) {
        if (i === windCtx.seatWind || i === windCtx.roundWind) add('役牌候補');
        else add('客風');
      }
    }
    if (hasHonor) add('字牌処理');

    // 孤立字牌同士でシャンテン数・受け入れ枚数が完全に同じ(牌効率上は同率)組がある場合
    const isolatedHonorDiscards = info.discards.filter((d) => d.tile >= 27 && d.wasIsolated);
    if (isolatedHonorDiscards.length >= 2) {
      const tied = isolatedHonorDiscards.some((a, i) =>
        isolatedHonorDiscards.some((b, j) => i !== j && a.resultShanten === b.resultShanten && a.ukeireTotal === b.ukeireTotal)
      );
      if (tied) add('字牌同率比較');
    }

    // 切るとシャンテンが戻る候補があるか
    const best = info.recommended;
    if (info.discards.some((d) => d.resultShanten > best.resultShanten)) add('シャンテン戻し');

    // 同じシャンテンで受け入れ枚数に差がある = 受け入れ比較の問題
    const sameShanten = info.discards.filter((d) => d.resultShanten === best.resultShanten);
    if (sameShanten.length >= 2) {
      const minUke = Math.min.apply(null, sameShanten.map((d) => d.ukeireTotal));
      if (best.ukeireTotal - minUke >= 2) add('受け入れ');
    }

    if (hasComplexShape(counts14)) add('複合形');

    return tags;
  }

  // ==================================================
  // 保存データ
  // ==================================================

  function createStore() {
    return { version: SCHEMA_VERSION, entries: [] };
  }

  function loadStore() {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
      if (!raw) return createStore();
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.entries)) return createStore();
      return { version: parsed.version || SCHEMA_VERSION, entries: parsed.entries };
    } catch (e) {
      return createStore();
    }
  }

  function saveStore(store) {
    try {
      if (typeof localStorage === 'undefined') return false;
      const trimmed = trimStore(store);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
      return true;
    } catch (e) {
      return false;
    }
  }

  /** 上限を超えたら、習得済み→古い順に間引く(要復習の問題は残す) */
  function trimStore(store) {
    if (store.entries.length <= MAX_ENTRIES) return store;
    const sorted = store.entries.slice().sort((a, b) => {
      const am = statusOf(a) === 'mastered' ? 1 : 0;
      const bm = statusOf(b) === 'mastered' ? 1 : 0;
      if (am !== bm) return bm - am; // 習得済みを先に捨てる
      return new Date(a.lastAnsweredAt) - new Date(b.lastAnsweredAt);
    });
    const removeCount = store.entries.length - MAX_ENTRIES;
    const removeIds = sorted.slice(0, removeCount).map((e) => e.problemId);
    return { version: store.version, entries: store.entries.filter((e) => removeIds.indexOf(e.problemId) === -1) };
  }

  function clearAll() {
    try {
      if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY);
      return true;
    } catch (e) {
      return false;
    }
  }

  /** 手牌14枚から一意な問題IDを作る(同じ手牌は同じ問題として扱う) */
  function problemIdOf(tiles14) {
    return 'p' + tiles14.slice().sort((a, b) => a - b).join('.');
  }

  // ==================================================
  // 状態(未復習・要復習・学習中・習得)
  // ==================================================

  const STATUS_LABEL = {
    new: '未復習',
    todo: '要復習',
    learning: '学習中',
    mastered: '習得',
  };

  /**
   * 直近2回連続で◎なら「習得」。
   * 1回しか解いていなければ「未復習」(=まだ復習していない)。
   * 直近が×/△なら「要復習」、それ以外は「学習中」。
   */
  function statusOf(entry) {
    const atts = entry.attempts || [];
    if (atts.length === 0) return 'new';
    const last = atts[atts.length - 1];
    if (atts.length >= 2) {
      const prev = atts[atts.length - 2];
      if (last.grade === 'excellent' && prev.grade === 'excellent') return 'mastered';
    }
    if (atts.length === 1) return 'new';
    if (last.grade === 'bad' || last.grade === 'fair') return 'todo';
    return 'learning';
  }

  function statusLabelOf(entry) {
    return STATUS_LABEL[statusOf(entry)];
  }

  // ==================================================
  // 自動保存の判定
  // ==================================================

  /**
   * 学習価値が高い(=復習した方がよい)打牌かどうか。
   * ×・△、1位候補と違う牌、シャンテン悪化、受け入れの大幅減 のいずれか。
   * @returns {{should:boolean, reasons:string[]}}
   */
  function shouldAutoSave(analysis, chosenTile, grade) {
    const reasons = [];
    const best = analysis.recommended;
    const chosen = analysis.discards.find((d) => d.tile === chosenTile);
    if (!chosen) return { should: false, reasons };

    if (grade === 'bad') reasons.push('×評価だったため');
    if (grade === 'fair') reasons.push('△評価だったため');
    if (chosen.tile !== best.tile) reasons.push('牌効率上の1位候補と違う牌を選んだため');
    if (chosen.resultShanten > best.resultShanten) reasons.push('シャンテン数を戻してしまったため');
    if (best.ukeireTotal - chosen.ukeireTotal >= 4) {
      reasons.push('受け入れが' + (best.ukeireTotal - chosen.ukeireTotal) + '枚少なくなったため');
    }

    return { should: reasons.length > 0, reasons };
  }

  // ==================================================
  // 初心者向けのひとこと解説
  // ==================================================

  /**
   * 専門用語を並べる前に「今回一番覚えてほしいこと」を1文で作る。
   */
  function buildBeginnerPoint(analysis, chosen) {
    const best = analysis.recommended;
    const bestLabel = best.label;

    if (chosen && chosen.tile !== best.tile && chosen.resultShanten > best.resultShanten) {
      return chosen.label + 'を切るとアガリまでの距離が1歩遠くなります。' + bestLabel + 'なら距離を保ったまま進められます。';
    }
    if (best.wasIsolated) {
      return bestLabel + 'は他の牌とつながっていない孤立牌です。まずはこういう「どこにも使えない牌」から切るのが基本です。';
    }
    if (best.tile >= 27) {
      return bestLabel + 'は1枚だけの字牌で、順子(連番)が作れません。使い道が狭いので早めに整理します。';
    }
    if (best.wasBlockType === 'penchan') {
      return bestLabel + 'を含む辺張(ペンチャン)は片側しか受けられない弱い形です。より広い形を残しましょう。';
    }
    if (best.wasBlockType === 'kanchan') {
      return bestLabel + 'を含む嵌張(カンチャン)は間の1種類しか受けられません。両面の形を優先して残します。';
    }
    if (chosen && chosen.tile !== best.tile && best.ukeireTotal > chosen.ukeireTotal) {
      return bestLabel + 'を切ると次に嬉しい牌が' + best.ukeireTotal + '枚、' + chosen.label + 'だと' + chosen.ukeireTotal + '枚です。シャンテン数が同じなら受け入れが広い方を選びます。';
    }
    return bestLabel + 'を切ると受け入れが' + best.ukeireTotal + '枚で最も広くなります。同じ距離なら広い方を選ぶのが基本です。';
  }

  // ==================================================
  // 保存(追加・追記)
  // ==================================================

  /**
   * 1回分の回答を保存する。同じ手牌(problemId)がすでにあれば履歴に追記する(重複登録しない)。
   * @param {object} input {tiles14, counts14, analysis, chosenTile, grade, gradeLabel, comment, source, autoSaved, autoReasons, at}
   * @param {object} [store] 省略時はlocalStorageから読み込む
   * @returns {{store:object, entry:object, isNew:boolean}}
   */
  function recordAnswer(input, store) {
    const s = store || loadStore();
    const tiles14 = input.tiles14.slice().sort((a, b) => a - b);
    const counts14 = input.counts14 || Tiles.toCounts(tiles14);
    const analysis = input.analysis || Evaluator.analyzeHand(counts14);
    const id = problemIdOf(tiles14);
    const best = analysis.recommended;
    const chosen = analysis.discards.find((d) => d.tile === input.chosenTile) || best;
    const now = input.at || new Date().toISOString();

    const attempt = {
      at: now,
      chosenTile: input.chosenTile,
      chosenLabel: Tiles.shortLabel(input.chosenTile),
      grade: input.grade,
      gradeLabel: input.gradeLabel || '',
      comment: input.comment || '',
      chosenShanten: chosen.resultShanten,
      chosenUkeire: chosen.ukeireTotal,
      bestTile: best.tile,
      bestLabel: best.label,
      bestShanten: best.resultShanten,
      bestUkeire: best.ukeireTotal,
      autoSaved: !!input.autoSaved,
      autoReasons: input.autoReasons || [],
    };

    let entry = s.entries.find((e) => e.problemId === id);
    let isNew = false;
    if (!entry) {
      isNew = true;
      entry = {
        problemId: id,
        tiles14,
        shantenAtStart: analysis.currentShanten,
        bestTile: best.tile,
        bestLabel: best.label,
        bestUkeire: best.ukeireTotal,
        bestShanten: best.resultShanten,
        ukeireTiles: (best.ukeireTiles || []).slice(0, 10),
        explanation: best.reason || '',
        beginnerPoint: buildBeginnerPoint(analysis, chosen),
        tags: detectTags(counts14, analysis, input.windCtx),
        source: input.source || 'mondai',
        createdAt: now,
        lastAnsweredAt: now,
        attempts: [],
      };
      s.entries.push(entry);
    }
    entry.attempts.push(attempt);
    entry.lastAnsweredAt = now;
    return { store: s, entry, isNew };
  }

  /** 保存して永続化まで行う */
  function recordAndSave(input) {
    const res = recordAnswer(input, loadStore());
    saveStore(res.store);
    return res;
  }

  // ==================================================
  // 苦手分析
  // ==================================================

  /**
   * タグごとの正答率(◎の割合)を集計し、苦手な順に返す。
   * @returns {Array<{tag, total, correct, rate, description, short}>}
   */
  function analyzeWeakness(store) {
    const s = store || loadStore();
    const map = {};

    s.entries.forEach((entry) => {
      (entry.tags || []).forEach((tag) => {
        if (!map[tag]) map[tag] = { tag, total: 0, correct: 0 };
        (entry.attempts || []).forEach((a) => {
          map[tag].total++;
          if (a.grade === 'excellent') map[tag].correct++;
        });
      });
    });

    return Object.keys(map)
      .map((t) => {
        const m = map[t];
        const info = TAG_INFO[t] || { description: '', short: '' };
        return {
          tag: t,
          total: m.total,
          correct: m.correct,
          rate: m.total > 0 ? Math.round((m.correct / m.total) * 100) : null,
          description: info.description,
          short: info.short,
        };
      })
      .filter((m) => m.total > 0)
      .sort((a, b) => {
        if (a.rate !== b.rate) return a.rate - b.rate;
        return b.total - a.total;
      });
  }

  // ==================================================
  // 今日の復習 / おすすめ問題
  // ==================================================

  /**
   * 復習の優先度を数値化する(大きいほど先に出す)。
   *  1. まだ理解できていない(要復習)  2. 過去に×  3. 過去に△
   *  4. 苦手タグと同タイプ            5. 久しぶり
   */
  function priorityOf(entry, weakTags, nowMs) {
    const atts = entry.attempts || [];
    const last = atts[atts.length - 1] || {};
    const st = statusOf(entry);
    let score = 0;

    if (st === 'todo') score += 100;
    else if (st === 'new') score += 80;
    else if (st === 'learning') score += 60;
    else score += 5; // 習得済みは最後に少しだけ

    if (last.grade === 'bad') score += 40;
    else if (last.grade === 'fair') score += 25;

    // 過去に一度でも×/△があれば加点(苦手だった問題)
    if (atts.some((a) => a.grade === 'bad')) score += 12;
    else if (atts.some((a) => a.grade === 'fair')) score += 6;

    // 苦手タグを含む問題を優先
    const overlap = (entry.tags || []).filter((t) => (weakTags || []).indexOf(t) !== -1).length;
    score += overlap * 8;

    // 久しぶりの問題を優先(1日ごとに+2、最大+30)
    const days = Math.floor((nowMs - new Date(entry.lastAnsweredAt).getTime()) / 86400000);
    score += Math.min(Math.max(days, 0) * 2, 30);

    return score;
  }

  /**
   * 「今日の復習」に出す問題を選ぶ。
   * @param {number} [size] 既定5問
   */
  function pickTodayReview(store, size, now) {
    const s = store || loadStore();
    const limit = size || DAILY_REVIEW_SIZE;
    const nowMs = (now ? new Date(now) : new Date()).getTime();
    const weak = analyzeWeakness(s)
      .slice(0, 3)
      .map((w) => w.tag);

    return s.entries
      .slice()
      .map((e) => ({ entry: e, priority: priorityOf(e, weak, nowMs) }))
      .sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority;
        return new Date(a.lastAnsweredAt) - new Date(b.lastAnsweredAt);
      })
      .slice(0, limit)
      .map((x) => x.entry);
  }

  // ==================================================
  // 成長サマリー
  // ==================================================

  function summarize(store, now) {
    const s = store || loadStore();
    const counts = { new: 0, todo: 0, learning: 0, mastered: 0 };
    let totalAttempts = 0;
    let weekAttempts = 0;
    let weekExcellent = 0;
    const nowMs = (now ? new Date(now) : new Date()).getTime();
    const weekAgo = nowMs - 7 * 86400000;

    s.entries.forEach((e) => {
      counts[statusOf(e)]++;
      (e.attempts || []).forEach((a) => {
        totalAttempts++;
        const t = new Date(a.at).getTime();
        if (t >= weekAgo) {
          weekAttempts++;
          if (a.grade === 'excellent') weekExcellent++;
        }
      });
    });

    return {
      totalProblems: s.entries.length,
      totalAttempts,
      newCount: counts.new,
      todoCount: counts.todo,
      learningCount: counts.learning,
      masteredCount: counts.mastered,
      weekAttempts,
      weekExcellentRate: weekAttempts > 0 ? Math.round((weekExcellent / weekAttempts) * 100) : null,
    };
  }

  // ==================================================
  // Export / Import
  // ==================================================

  function exportJson(store) {
    const s = store || loadStore();
    return JSON.stringify(
      {
        type: 'mahjong-trainer-review',
        version: SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        entries: s.entries,
      },
      null,
      2
    );
  }

  /**
   * JSONを読み込む。既存データとは problemId でマージし、履歴は日時で重複排除する。
   * @returns {{ok:boolean, error:?string, added:number, merged:number, store:?object}}
   */
  function importJson(json, store) {
    let parsed;
    try {
      parsed = typeof json === 'string' ? JSON.parse(json) : json;
    } catch (e) {
      return { ok: false, error: 'JSONとして読み取れませんでした。', added: 0, merged: 0, store: null };
    }
    if (!parsed || !Array.isArray(parsed.entries)) {
      return { ok: false, error: '復習データの形式ではありません(entriesがありません)。', added: 0, merged: 0, store: null };
    }

    const s = store || loadStore();
    let added = 0;
    let merged = 0;

    parsed.entries.forEach((imported) => {
      if (!imported || !imported.problemId || !Array.isArray(imported.tiles14)) return;
      const existing = s.entries.find((e) => e.problemId === imported.problemId);
      if (!existing) {
        s.entries.push(imported);
        added++;
        return;
      }
      const known = {};
      (existing.attempts || []).forEach((a) => (known[a.at + '/' + a.chosenTile] = true));
      let changed = false;
      (imported.attempts || []).forEach((a) => {
        const key = a.at + '/' + a.chosenTile;
        if (!known[key]) {
          existing.attempts.push(a);
          known[key] = true;
          changed = true;
        }
      });
      if (changed) {
        existing.attempts.sort((a, b) => new Date(a.at) - new Date(b.at));
        existing.lastAnsweredAt = existing.attempts[existing.attempts.length - 1].at;
        merged++;
      }
    });

    return { ok: true, error: null, added, merged, store: s };
  }

  // ==================================================
  // 参照系のヘルパー
  // ==================================================

  function getEntry(problemId, store) {
    const s = store || loadStore();
    return s.entries.find((e) => e.problemId === problemId) || null;
  }

  function deleteEntry(problemId, store) {
    const s = store || loadStore();
    s.entries = s.entries.filter((e) => e.problemId !== problemId);
    return s;
  }

  /** 一覧表示用に、状態・前回結果などをまとめた配列を返す */
  function listForDisplay(store) {
    const s = store || loadStore();
    return s.entries
      .slice()
      .sort((a, b) => new Date(b.lastAnsweredAt) - new Date(a.lastAnsweredAt))
      .map((e) => {
        const atts = e.attempts || [];
        const last = atts[atts.length - 1] || null;
        return {
          entry: e,
          problemId: e.problemId,
          status: statusOf(e),
          statusLabel: statusLabelOf(e),
          lastGrade: last ? last.grade : null,
          lastChosenLabel: last ? last.chosenLabel : null,
          lastAnsweredAt: e.lastAnsweredAt,
          attemptCount: atts.length,
          tags: e.tags || [],
          bestLabel: e.bestLabel,
        };
      });
  }

  const Review = {
    STORAGE_KEY,
    SCHEMA_VERSION,
    DAILY_REVIEW_SIZE,
    MAX_ENTRIES,
    TAG_INFO,
    ALL_TAGS,
    STATUS_LABEL,
    createStore,
    loadStore,
    saveStore,
    trimStore,
    clearAll,
    problemIdOf,
    detectTags,
    hasComplexShape,
    statusOf,
    statusLabelOf,
    shouldAutoSave,
    recordAnswer,
    recordAndSave,
    buildBeginnerPoint,
    analyzeWeakness,
    priorityOf,
    pickTodayReview,
    summarize,
    exportJson,
    importJson,
    getEntry,
    deleteEntry,
    listForDisplay,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Review;
  } else {
    root.MJ = root.MJ || {};
    root.MJ.Review = Review;
  }
})(typeof window !== 'undefined' ? window : globalThis);
