/**
 * livesession.js
 * 実戦学習モードの設定・出題制御・記録。
 *
 * ■ 役割
 *  1. プレイモード(通常対局 / 重要局面コーチ / じっくり学習)の設定を localStorage に保存する
 *  2. 1局あたりの出題数・クールダウン・同じタグの連続を管理する
 *  3. 出題と回答を記録し、局終了後の振り返り・学習ダッシュボード・復習に使う
 *
 * ■ 既存データとの関係
 *  専用キー 'mahjong-trainer-live-v1' だけを読み書きする。
 *  牌譜(mahjong-trainer-kifu-v1)・何切る復習帳(mahjong-trainer-review-v1)・
 *  クイズ履歴(mahjong-trainer-quiz-v1)には触れない。
 *  ただし「何切る」で△×だった局面は、既存の復習帳へ追加して復習の循環に載せる。
 */
(function (root) {
  'use strict';

  let Tiles, Evaluator, Review, LiveCoach;
  if (typeof module !== 'undefined' && module.exports) {
    Tiles = require('./tiles.js');
    Evaluator = require('./evaluator.js');
    Review = require('./review.js');
    LiveCoach = require('./livecoach.js');
  } else {
    Tiles = root.MJ.Tiles;
    Evaluator = root.MJ.Evaluator;
    Review = root.MJ.Review;
    LiveCoach = root.MJ.LiveCoach;
  }

  const STORAGE_KEY = 'mahjong-trainer-live-v1';
  const VERSION = 1;
  /** 保存する局面の上限。古いものから消していく(目安50〜100の範囲) */
  const MAX_MOMENTS = 60;
  /** 保存サイズの上限(文字数)。超えたら古い局面から捨てる */
  const MAX_STORAGE_CHARS = 400000;

  const MODES = [
    {
      id: 'off',
      name: '通常対局',
      description: '学習問題は出ません。従来どおりの対局です。',
    },
    {
      id: 'key',
      name: '重要局面コーチ',
      recommended: true,
      description: '重要な場面だけ止まって考えます。1局あたり2〜4回が目安です。',
    },
    {
      id: 'deep',
      name: 'じっくり学習',
      description: '牌効率・役・待ちなども細かく確認します。1局あたり4〜8回が目安です。',
    },
  ];

  const DEFAULT_SETTINGS = {
    mode: 'key',
    maxPerRound: 3,
    cooldownTurns: 2,
    avoidSameTag: true,
  };

  /** モードごとの既定の出題数(ユーザーが変えていなければこれを使う) */
  const MODE_DEFAULT_MAX = { off: 0, key: 3, deep: 6 };

  // ==================================================
  // 保存
  // ==================================================

  function emptyStats() {
    return {
      rounds: 0,
      asked: 0,
      grades: { excellent: 0, good: 0, fair: 0, bad: 0 },
      byTag: {},
      byKind: {},
      lastAt: null,
    };
  }

  function emptyStore() {
    return { version: VERSION, settings: Object.assign({}, DEFAULT_SETTINGS), stats: emptyStats(), moments: [] };
  }

  function load() {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
      if (!raw) return emptyStore();
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return emptyStore();
      return {
        version: parsed.version || VERSION,
        settings: Object.assign({}, DEFAULT_SETTINGS, parsed.settings || {}),
        stats: Object.assign(emptyStats(), parsed.stats || {}, {
          grades: Object.assign({ excellent: 0, good: 0, fair: 0, bad: 0 }, (parsed.stats || {}).grades || {}),
          byTag: (parsed.stats || {}).byTag || {},
          byKind: (parsed.stats || {}).byKind || {},
        }),
        moments: Array.isArray(parsed.moments) ? parsed.moments : [],
      };
    } catch (e) {
      // 壊れたデータでもアプリは動き続ける
      return emptyStore();
    }
  }

  /** 上限を超えた分を古い順に捨てる。既存の他機能のデータには触れない。 */
  function trim(store) {
    if (store.moments.length > MAX_MOMENTS) {
      store.moments = store.moments.slice(store.moments.length - MAX_MOMENTS);
    }
    let json = JSON.stringify(store);
    while (json.length > MAX_STORAGE_CHARS && store.moments.length > 1) {
      store.moments.shift();
      json = JSON.stringify(store);
    }
    return store;
  }

  function save(store) {
    try {
      if (typeof localStorage === 'undefined') return false;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trim(store)));
      return true;
    } catch (e) {
      return false;
    }
  }

  function loadSettings() {
    return load().settings;
  }

  function saveSettings(settings) {
    const store = load();
    store.settings = Object.assign({}, DEFAULT_SETTINGS, store.settings, settings || {});
    if (store.settings.mode === 'off') store.settings.maxPerRound = 0;
    save(store);
    return store.settings;
  }

  /** モードを切り替える。出題数はそのモードの既定値に合わせる。 */
  function setMode(mode) {
    const max = MODE_DEFAULT_MAX[mode] === undefined ? DEFAULT_SETTINGS.maxPerRound : MODE_DEFAULT_MAX[mode];
    return saveSettings({ mode, maxPerRound: max });
  }

  // ==================================================
  // セッション(対局中の状態。localStorage には保存しない)
  // ==================================================

  /**
   * 対局1回分の学習セッションを作る。
   * @param {object} [settings] 省略時は保存済みの設定
   */
  function createSession(settings) {
    return {
      settings: Object.assign({}, DEFAULT_SETTINGS, settings || loadSettings()),
      roundLabel: '',
      count: 0,
      askedKinds: {},
      askedTags: [],
      askedSignatures: [],
      lastKind: null,
      lastTurn: -99,
      skipRound: false,
      log: [],
      current: null, // 表示中の問題
      paused: false,
    };
  }

  /** 新しい局が始まったときに、1局分のカウンタを初期化する(設定は引き継ぐ) */
  function startRound(session, snapshot, label) {
    session.roundLabel = label || '';
    session.count = 0;
    session.askedKinds = {};
    session.askedTags = [];
    session.askedSignatures = [];
    session.lastKind = null;
    session.lastTurn = -99;
    session.skipRound = false;
    session.log = [];
    session.current = null;
    session.paused = false;
    return session;
  }

  function history(session) {
    return {
      count: session.count,
      askedKinds: session.askedKinds,
      askedTags: session.askedTags,
      lastKind: session.lastKind,
      lastTurn: session.lastTurn,
      askedSignatures: session.askedSignatures,
    };
  }

  /**
   * 今この局面で出題すべきか判定する。出題しないなら null。
   * ロン・ツモ・リーチなどの操作を邪魔しないよう、
   * 打牌を選ぶ場面(自分の手番)以外では出題しない(検出側でも確認している)。
   */
  function nextMoment(session, snapshot) {
    if (session.settings.mode === 'off') return null;
    if (session.skipRound) return null;
    if (session.current) return null;
    if (session.count >= session.settings.maxPerRound) return null;
    const moment = LiveCoach.pickMoment(snapshot, session.settings, history(session));
    if (!moment) return null;
    // 同じ内容(種類+巡目+手牌)を二重に出さない
    const signature = moment.kind + ':' + snapshot.turn + ':' + snapshot.counts14.join('');
    if (session.askedSignatures.indexOf(signature) !== -1) return null;
    moment.signature = signature;
    return moment;
  }

  /** 出題したことを記録する(重複・連続を抑えるため) */
  function markAsked(session, moment, question, snapshot) {
    session.count += 1;
    session.askedKinds[moment.kind] = snapshot.turn;
    session.lastKind = moment.kind;
    session.lastTurn = snapshot.turn;
    if (moment.signature) session.askedSignatures.push(moment.signature);
    (question.tags || []).forEach((t) => session.askedTags.push(t));
    session.current = { moment, question, snapshot };
    session.paused = true;
    return session;
  }

  /** 出題を閉じる(回答後・スキップ後)。対局はここから再開してよい。 */
  function closeCurrent(session) {
    session.current = null;
    session.paused = false;
    return session;
  }

  /** この局はもう出題しない */
  function skipRestOfRound(session) {
    session.skipRound = true;
    return closeCurrent(session);
  }

  // ==================================================
  // 記録
  // ==================================================

  function slimSnapshot(snapshot) {
    // 振り返りで同じ問題をもう一度出すために必要な情報だけを残す(公開情報のみ)
    return {
      seat: snapshot.seat,
      handCounts: snapshot.handCounts.slice(),
      drawnTile: snapshot.drawnTile,
      counts14: snapshot.counts14.slice(),
      hand: snapshot.hand.slice(),
      melds: snapshot.melds,
      fuuroCount: snapshot.fuuroCount,
      isRiichi: snapshot.isRiichi,
      isDealer: snapshot.isDealer,
      seatWind: snapshot.seatWind,
      ownDiscards: snapshot.ownDiscards,
      furitenTemporary: snapshot.furitenTemporary,
      furitenRiichi: snapshot.furitenRiichi,
      players: snapshot.players,
      roundWind: snapshot.roundWind,
      doraIndicators: snapshot.doraIndicators,
      doraTiles: snapshot.doraTiles,
      turn: snapshot.turn,
      wallCount: snapshot.wallCount,
      phase: snapshot.phase,
      turnSeat: snapshot.turnSeat,
      honba: snapshot.honba,
      kyotaku: snapshot.kyotaku,
      roundWindIndex: snapshot.roundWindIndex,
      roundNumber: snapshot.roundNumber,
      scores: snapshot.scores.slice(),
      visibleCounts: snapshot.visibleCounts.slice(),
      targetSeat: snapshot.targetSeat,
      pendingDiscard: snapshot.pendingDiscard,
    };
  }

  function labelsOf(question, ids) {
    return (ids || [])
      .map((id) => {
        const c = question.choices.find((x) => x.id === id);
        return c ? c.label : null;
      })
      .filter(Boolean);
  }

  /**
   * 回答を記録する。局終了後の振り返り・ダッシュボード・復習に使う。
   * @returns {object} 記録した1件
   */
  function recordAnswer(session, question, snapshot, evaluation, extra) {
    extra = extra || {};
    const entry = {
      id: 'lm-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      at: new Date().toISOString(),
      kind: question.kind,
      title: question.title,
      prompt: question.prompt,
      tags: question.tags || [],
      turn: snapshot.turn,
      roundLabel: session.roundLabel,
      gradeKey: evaluation.gradeKey,
      gradeMark: evaluation.gradeMark,
      gradeLabel: evaluation.gradeLabel,
      selectedLabels: labelsOf(question, evaluation.selectedIds),
      recommendedLabels: labelsOf(question, evaluation.correctIds),
      axes: (evaluation.axes || []).map((a) => ({ key: a.key, label: a.label, text: a.text })),
      shouldReview: !!evaluation.shouldReview || !!extra.markedForReview,
      markedByUser: !!extra.markedForReview,
      actualDiscardLabel: extra.actualDiscardLabel || null,
      resultLabel: null,
      snapshot: slimSnapshot(snapshot),
      question: {
        kind: question.kind,
        title: question.title,
        prompt: question.prompt,
        note: question.note,
        choices: question.choices,
        multi: !!question.multi,
        tags: question.tags || [],
        targetSeat: question.targetSeat,
        discardTile: question.discardTile,
        callInfo: question.callInfo,
        momentKind: question.momentKind,
      },
    };
    session.log.push(entry);
    persistMoment(entry);
    maybeSaveToReviewBook(question, snapshot, evaluation);
    return entry;
  }

  /** 局の結果(和了・放銃・流局)を、その局の記録に書き足す */
  function attachRoundResult(session, resultLabel) {
    session.log.forEach((e) => {
      e.resultLabel = resultLabel;
    });
    const store = load();
    let changed = false;
    session.log.forEach((e) => {
      const found = store.moments.find((m) => m.id === e.id);
      if (found) {
        found.resultLabel = resultLabel;
        changed = true;
      }
    });
    if (changed) save(store);
    return session.log;
  }

  function persistMoment(entry) {
    const store = load();
    store.moments.push(entry);
    store.stats.asked += 1;
    store.stats.lastAt = entry.at;
    store.stats.grades[entry.gradeKey] = (store.stats.grades[entry.gradeKey] || 0) + 1;
    if (!store.stats.byKind[entry.kind]) store.stats.byKind[entry.kind] = { asked: 0, excellent: 0, good: 0, fair: 0, bad: 0 };
    store.stats.byKind[entry.kind].asked += 1;
    store.stats.byKind[entry.kind][entry.gradeKey] += 1;
    (entry.tags || []).forEach((tag) => {
      if (!store.stats.byTag[tag]) store.stats.byTag[tag] = { asked: 0, excellent: 0, good: 0, fair: 0, bad: 0 };
      store.stats.byTag[tag].asked += 1;
      store.stats.byTag[tag][entry.gradeKey] += 1;
    });
    save(store);
    return store;
  }

  /** 実戦学習を行った局数を数える(1局に1回だけ) */
  function countRound() {
    const store = load();
    store.stats.rounds += 1;
    save(store);
    return store.stats.rounds;
  }

  /**
   * 「何切る」で△×だった局面を、既存の何切る復習帳へ追加する。
   * 副露があると復習帳の形(14枚の手牌)で再現できないため、門前のときだけ保存する。
   */
  function maybeSaveToReviewBook(question, snapshot, evaluation) {
    if (!Review) return null;
    if (question.kind !== 'discard') return null;
    if (snapshot.fuuroCount > 0) return null;
    if (!evaluation.shouldReview) return null;
    const tiles14 = snapshot.hand.slice();
    if (tiles14.length !== 14) return null;
    const chosenId = evaluation.selectedIds[0];
    const choice = question.choices.find((c) => c.id === chosenId);
    if (!choice) return null;
    try {
      return Review.recordAndSave({
        tiles14,
        counts14: snapshot.counts14.slice(),
        chosenTile: choice.tile,
        grade: evaluation.gradeKey === 'bad' ? 'bad' : 'fair',
        gradeLabel: evaluation.gradeMark + ' ' + evaluation.gradeLabel,
        comment: '対局中の学習問題(' + (snapshot.turn || 0) + '巡目)で出題された局面です。',
        source: 'live',
        autoSaved: true,
        autoReasons: ['実戦学習モードで' + evaluation.gradeMark + '評価だったため'],
        windCtx: { seatWind: snapshot.seatWind, roundWind: snapshot.roundWind },
      });
    } catch (e) {
      return null;
    }
  }

  // ==================================================
  // 振り返り・ダッシュボード
  // ==================================================

  /** 局終了後の振り返り(時系列) */
  function roundReview(session) {
    return session.log.slice().sort((a, b) => a.turn - b.turn);
  }

  /** 保存済みの局面(新しい順) */
  function savedMoments(limit) {
    const list = load().moments.slice().reverse();
    return limit ? list.slice(0, limit) : list;
  }

  function reviewCandidates(limit) {
    return savedMoments().filter((m) => m.shouldReview).slice(0, limit || 20);
  }

  function findMoment(id) {
    return load().moments.find((m) => m.id === id) || null;
  }

  const KIND_LABELS = {
    discard: '何を切る？',
    wait: 'この手は何待ち？',
    riichi: '今リーチできる？',
    safety: '何が安全？',
    reading: '相手の河から何が読める？',
    pushfold: '押す・慎重・降りる',
    call: '鳴く？鳴かない？',
  };

  /** 苦手なタグから、次にやるとよい既存コースを案内する */
  const COURSE_NAMES = {
    yaku: '役当てクイズ',
    wait: '待ち当てクイズ',
    furiten: 'フリテンクイズ',
    genbutsu: '現物クイズ',
    defense: '守備判断クイズ',
    reading: '相手の待ち読み',
  };

  const COURSE_ADVICE = {
    'live-furiten': 'フリテンの見落としが目立ちます。',
    'live-genbutsu': '現物(ゲンブツ)の見落としが目立ちます。',
    'live-suji': '筋(スジ)を安全と考えすぎているかもしれません。',
    'live-defense': '守備の判断でつまずいています。',
    'live-reading': '河(カワ)から待ちを断定しようとしていないか確認しましょう。',
    'live-wait': '待ちの読み取りでつまずいています。',
    'live-tenpai': '聴牌(テンパイ)の判断を確認しましょう。',
    'live-yaku': '役(ヤク)の判断でつまずいています。',
    'live-riichi': 'リーチの条件をもう一度確認しましょう。',
    'live-pushfold': '押し引き(オシヒキ)の判断でつまずいています。',
    'live-call': '鳴き(ナキ)の判断でつまずいています。',
    'live-efficiency': '牌効率(ハイコウリツ)でつまずいています。',
    'live-shape': '形の選び方でつまずいています。',
  };

  /**
   * 学習ダッシュボードのデータ。
   * 正答率ではなく「◎○△×の内訳」を主役にする(実戦では正解が1つとは限らないため)。
   */
  function dashboard() {
    const store = load();
    const stats = store.stats;
    const total = stats.grades.excellent + stats.grades.good + stats.grades.fair + stats.grades.bad;

    const byTag = Object.keys(stats.byTag).map((tag) => {
      const t = stats.byTag[tag];
      const answered = t.asked || 0;
      const okCount = t.excellent + t.good;
      return {
        tag,
        label: LiveCoach.TAG_LABELS[tag] || tag,
        asked: answered,
        excellent: t.excellent,
        good: t.good,
        fair: t.fair,
        bad: t.bad,
        okRate: answered ? Math.round((okCount / answered) * 100) : null,
        course: LiveCoach.TAG_TO_COURSE[tag] || null,
        courseName: COURSE_NAMES[LiveCoach.TAG_TO_COURSE[tag]] || null,
        advice: COURSE_ADVICE[tag] || null,
      };
    });

    const byKind = Object.keys(stats.byKind).map((kind) => {
      const k = stats.byKind[kind];
      return {
        kind,
        label: KIND_LABELS[kind] || kind,
        asked: k.asked,
        excellent: k.excellent,
        good: k.good,
        fair: k.fair,
        bad: k.bad,
      };
    });

    // 苦手な順(◎○の割合が低い順)。3問以上出題されたタグだけを対象にする。
    const weakTags = byTag
      .filter((t) => t.asked >= 3 && t.okRate !== null)
      .sort((a, b) => a.okRate - b.okRate)
      .slice(0, 4);

    const suggestions = weakTags
      .filter((t) => t.course)
      .map((t) => ({
        tag: t.tag,
        label: t.label,
        course: t.course,
        courseName: t.courseName,
        text: (t.advice || t.label + 'でつまずいています。') + '「' + t.courseName + '」で復習しましょう。',
      }));

    return {
      rounds: stats.rounds,
      asked: stats.asked,
      grades: stats.grades,
      total,
      byTag: byTag.sort((a, b) => b.asked - a.asked),
      byKind: byKind.sort((a, b) => b.asked - a.asked),
      weakTags,
      suggestions,
      lastAt: stats.lastAt,
      reviewCount: store.moments.filter((m) => m.shouldReview).length,
      savedCount: store.moments.length,
    };
  }

  /** 実戦学習の履歴だけを消す(他機能の保存データには触れない) */
  function resetAll() {
    try {
      if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY);
      return true;
    } catch (e) {
      return false;
    }
  }

  const LiveSession = {
    STORAGE_KEY,
    VERSION,
    MAX_MOMENTS,
    MODES,
    MODE_DEFAULT_MAX,
    DEFAULT_SETTINGS,
    KIND_LABELS,
    COURSE_NAMES,
    emptyStore,
    load,
    save,
    trim,
    loadSettings,
    saveSettings,
    setMode,
    createSession,
    startRound,
    nextMoment,
    markAsked,
    closeCurrent,
    skipRestOfRound,
    recordAnswer,
    attachRoundResult,
    countRound,
    roundReview,
    savedMoments,
    reviewCandidates,
    findMoment,
    dashboard,
    resetAll,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = LiveSession;
  } else {
    root.MJ = root.MJ || {};
    root.MJ.LiveSession = LiveSession;
  }
})(typeof window !== 'undefined' ? window : globalThis);
