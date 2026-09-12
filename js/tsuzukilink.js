/**
 * tsuzukilink.js
 * 学習ノートアプリ「つづきノート」へ、誤答・保存問題を送るための変換とURL生成。
 *
 * 方針:
 *  - 既存の保存データ(復習帳・クイズ履歴・牌譜・成績)には一切書き込まない。
 *    「書き出し済み」の印だけを専用キー 'mahjong-trainer-tsuzuki-v1' に持つ。
 *  - externalId は問題IDから決まる安定した値にする(毎回変えると重複判定できないため)。
 *  - DOM に依存しないので、node からそのままテストできる。
 */
(function (root) {
  'use strict';

  let Tiles, Review, QuizData, QuizStats;
  if (typeof module !== 'undefined' && module.exports) {
    Tiles = require('./tiles.js');
    Review = require('./review.js');
    QuizData = require('./quizdata.js');
    QuizStats = require('./quizstats.js');
  } else {
    Tiles = root.MJ.Tiles;
    Review = root.MJ.Review;
    QuizData = root.MJ.QuizData;
    QuizStats = root.MJ.QuizStats;
  }

  /** 書き出し済みフラグだけを持つ専用キー(既存データには触れない)。 */
  const STORAGE_KEY = 'mahjong-trainer-tsuzuki-v1';
  /** つづきノートの公開URL。ローカル検証時は setBaseUrl() か ?tsuzuki= で差し替える。 */
  const DEFAULT_BASE_URL = 'https://kishimotodesu.github.io/tsuzuki-note/';
  /** つづきノート側の取り込みスキーマ。 */
  const IMPORT_SCHEMA_VERSION = 1;
  /** つづきノート側で既定にしているテーマ名。 */
  const TOPIC_NAME = '麻雀';
  const SOURCE_APP = 'mahjong-trainer';
  const APP_VERSION = 'v2.2.0';
  /** URL1件送信の上限(つづきノート側の MAX_FRAGMENT_CHARS と揃える)。 */
  const MAX_FRAGMENT_CHARS = 8 * 1024;

  // ==================================================
  // 送信先URL
  // ==================================================

  let baseUrlOverride = null;

  function setBaseUrl(url) {
    baseUrlOverride = url || null;
  }

  /** 送信先のつづきノートURL。?tsuzuki=... が付いていればそれを優先する(ローカル検証用)。 */
  function baseUrl() {
    if (baseUrlOverride) return baseUrlOverride;
    try {
      if (typeof location !== 'undefined') {
        const fromQuery = new URLSearchParams(location.search).get('tsuzuki');
        if (fromQuery) return fromQuery;
      }
      if (typeof localStorage !== 'undefined') {
        const saved = localStorage.getItem(STORAGE_KEY + ':base');
        if (saved) return saved;
      }
    } catch (e) {
      /* 読めない環境では既定値を使う */
    }
    return DEFAULT_BASE_URL;
  }

  /** 元の画面へ戻るURL(麻雀アプリの該当タブ)。 */
  function selfUrl(tab) {
    try {
      if (typeof location === 'undefined') return '';
      const origin = location.origin + location.pathname;
      return tab ? origin + '#' + tab : origin;
    } catch (e) {
      return '';
    }
  }

  // ==================================================
  // Base64URL(UTF-8を壊さない)
  // ==================================================

  function utf8ToBytes(str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
    return Uint8Array.from(Buffer.from(str, 'utf8'));
  }

  function bytesToBase64(bytes) {
    if (typeof btoa !== 'undefined') {
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      return btoa(binary);
    }
    return Buffer.from(bytes).toString('base64');
  }

  /** テキストを Base64URL へ(+ / = を使わない)。 */
  function encodeBase64Url(text) {
    return bytesToBase64(utf8ToBytes(text)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  // ==================================================
  // 牌の表記
  // ==================================================

  /** 牌インデックスの配列を "234m 55m 456p" のような読める文字列にする。 */
  function tilesToText(tiles) {
    if (!Array.isArray(tiles) || tiles.length === 0) return '';
    return tiles
      .slice()
      .sort((a, b) => a - b)
      .map((t) => Tiles.shortLabel(t))
      .join(' ');
  }

  function tileToText(tile) {
    if (tile === undefined || tile === null) return '';
    return Tiles.shortLabel(tile);
  }

  // ==================================================
  // 変換: 何切る復習帳のエントリー
  // ==================================================

  /**
   * 復習帳の1件を、つづきノートの取り込み形式へ変換する。
   *
   * 同じ手牌は同じ problemId になるため、externalId も安定する。
   * 「同じ問題を何度間違えても1枚のカード」にまとめる方針(回答履歴ごとに増やさない)。
   */
  function itemFromReviewEntry(entry) {
    if (!entry || !entry.problemId) return null;
    const attempts = Array.isArray(entry.attempts) ? entry.attempts : [];
    const last = attempts.length > 0 ? attempts[attempts.length - 1] : null;

    const details = {};
    const hand = tilesToText(entry.tiles14);
    if (hand) details['手牌'] = hand;
    if (entry.shantenAtStart !== undefined && entry.shantenAtStart !== null) {
      details['シャンテン数'] = String(entry.shantenAtStart);
    }
    if (entry.bestUkeire !== undefined) details['最善手の受け入れ'] = entry.bestUkeire + '枚';
    if (Array.isArray(entry.ukeireTiles) && entry.ukeireTiles.length > 0) {
      details['受け入れ牌'] = entry.ukeireTiles
        .map((u) => (typeof u === 'number' ? tileToText(u) : tileToText(u && u.tile)))
        .filter(Boolean)
        .join(' ');
    }
    if (Array.isArray(entry.tags) && entry.tags.length > 0) details['学習タグ'] = entry.tags.join('・');
    if (last) {
      details['自分の回答'] = last.chosenLabel || tileToText(last.chosenTile);
      if (last.gradeLabel) details['判定'] = last.gradeLabel;
      if (Array.isArray(last.autoReasons) && last.autoReasons.length > 0) {
        details['復習帳に入った理由'] = last.autoReasons.join('／');
      }
    }
    details['回答回数'] = String(attempts.length) + '回';
    if (Review && typeof Review.statusLabelOf === 'function') {
      details['復習帳での状態'] = Review.statusLabelOf(entry);
    }

    const answerLines = ['切るべき牌：' + (entry.bestLabel || '')];
    if (last && last.chosenLabel) answerLines.push('自分の回答：' + last.chosenLabel);

    return {
      externalId: 'saved-problem:' + entry.problemId,
      type: 'reviewCard',
      topicName: TOPIC_NAME,
      title: '何切る：' + hand,
      question: '次の手牌から何を切りますか？\n' + hand,
      answer: answerLines.join('\n'),
      explanation: entry.beginnerPoint || entry.explanation || '',
      example: entry.explanation && entry.beginnerPoint ? entry.explanation : '',
      tags: ['麻雀', '何切る'].concat(Array.isArray(entry.tags) ? entry.tags : []),
      sourceLabel: '麻雀学習アプリ 何切る復習帳',
      sourceUrl: selfUrl('review'),
      occurredAt: entry.lastAnsweredAt || entry.createdAt || new Date().toISOString(),
      details,
    };
  }

  // ==================================================
  // 変換: クイズの誤答
  // ==================================================

  /** 「過去の回答内容は保存されていない」ことを示す固定文言。推測で埋めないための印。 */
  const NO_ANSWER_RECORD = '（過去の回答内容は保存されていません）';

  function correctIdsOf(question, record) {
    if (record && Array.isArray(record.correctIds)) return record.correctIds;
    return Array.isArray(question.expected) ? question.expected : [];
  }

  function labelsOf(question, ids) {
    if (!question || !Array.isArray(question.choices) || !Array.isArray(ids)) return '';
    return question.choices
      .filter((c) => ids.indexOf(c.id) !== -1)
      .map((c) => c.label)
      .join('・');
  }

  /**
   * クイズ1問の回答結果を、つづきノートの取り込み形式へ変換する。
   *
   * externalId は「コース＋問題ID」で安定させる。同じ問題を何度間違えても
   * カードは1枚にまとまる(そのぶん何度でも復習される)。
   * @param {object} question quizdata の問題
   * @param {object} [record] quizsession.answerCurrent() の戻り値(自分の回答が分かる場合)
   * @param {object} [meta] {courseName, at}
   */
  function itemFromQuizAnswer(question, record, meta) {
    if (!question || !question.id) return null;
    meta = meta || {};
    const board = question.board || {};
    const details = {};

    if (meta.courseName) details['コース'] = meta.courseName;
    details['コースID'] = question.course || '';
    details['問題種別'] = question.mode || question.course || '';
    if (question.difficulty) details['難易度'] = question.difficulty;
    const hand = tilesToText(board.hand);
    if (hand) details['手牌'] = hand;
    if (board.winTile !== undefined && board.winTile !== null) {
      details['和了牌'] = tileToText(board.winTile);
    }
    const discards = tilesToText(board.discards || board.river);
    if (discards) details['河'] = discards;
    const dora = tilesToText(board.doraIndicators);
    if (dora) details['ドラ表示牌'] = dora;
    if (board.turn !== undefined && board.turn !== null) details['巡目'] = String(board.turn) + '巡目';
    if (board.isRiichi) details['状況'] = 'リーチ宣言済み';
    if (board.isTsumo !== undefined) details['和了方法'] = board.isTsumo ? 'ツモ' : 'ロン';
    if (Array.isArray(board.fuuro) && board.fuuro.length > 0) {
      details['副露'] = board.fuuro
        .map((f) => (f.type || '') + tilesToText(f.tiles))
        .join(' / ');
    }
    if (Array.isArray(question.choices) && question.choices.length > 0) {
      details['選択肢'] = question.choices.map((c) => c.label).join(' / ');
    }
    if (record) {
      const mine = labelsOf(question, record.selectedIds);
      if (mine) details['自分の回答'] = mine;
      if (record.reasoning) details['推理評価'] = record.reasoning;
      if (record.hit) details['待ち的中'] = record.hit;
      if (Array.isArray(record.actualWaits) && record.actualWaits.length > 0) {
        details['実際の待ち'] = tilesToText(record.actualWaits);
      }
    } else {
      // 一括書き出しでは「どの選択肢を選んだか」までは保存されていない。
      // 推測して埋めると事実と違う記録が残るため、分からないことをそのまま書く。
      details['自分の回答'] = NO_ANSWER_RECORD;
    }
    if (Array.isArray(question.tags) && question.tags.length > 0) {
      details['学習タグ'] = question.tags.join('・');
    }
    if (question.course === 'wait' || question.mode === 'reading') {
      const waits = labelsOf(question, correctIdsOf(question, record));
      if (waits) details['待ち'] = waits;
    }
    details['元の問題ID'] = question.id;
    details['アプリ'] = '麻雀学習アプリ ' + APP_VERSION;

    const correctLabels = labelsOf(question, correctIdsOf(question, record));

    return {
      externalId: 'quiz-wrong:' + (question.course || 'quiz') + ':' + question.id,
      type: 'reviewCard',
      topicName: TOPIC_NAME,
      title: (meta.courseName || 'クイズ') + '：' + question.id,
      question: question.prompt || '',
      answer: correctLabels || '（正解データなし）',
      explanation: question.explanation || '',
      tags: ['麻雀'].concat(Array.isArray(question.tags) ? question.tags : []),
      sourceLabel: '麻雀学習アプリ ' + (meta.courseName || 'クイズ'),
      sourceUrl: selfUrl('quiz'),
      occurredAt: meta.at || new Date().toISOString(),
      details,
    };
  }

  // ==================================================
  // ペイロード / URL
  // ==================================================

  function buildPayload(items) {
    return {
      schemaVersion: IMPORT_SCHEMA_VERSION,
      sourceApp: SOURCE_APP,
      sourceAppVersion: APP_VERSION,
      exportedAt: new Date().toISOString(),
      items: (items || []).filter(Boolean),
    };
  }

  /**
   * 1件送信用のURLを作る。
   * 大きすぎる場合は URL では送らず、ファイル方式へ誘導する。
   * @returns {{ok:boolean, url:?string, size:number, reason:?string}}
   */
  function buildSingleUrl(item) {
    if (!item) return { ok: false, url: null, size: 0, reason: '送るデータがありません' };
    const json = JSON.stringify(buildPayload([item]));
    const encoded = encodeBase64Url(json);
    if (encoded.length > MAX_FRAGMENT_CHARS) {
      return {
        ok: false,
        url: null,
        size: encoded.length,
        reason: 'この問題はURLで送るには大きすぎます。「未連携の問題を書き出す」でファイルにしてください。',
      };
    }
    const base = baseUrl();
    const withSlash = base.charAt(base.length - 1) === '/' ? base : base + '/';
    return {
      ok: true,
      url: withSlash + '#/external-import/' + encoded,
      size: encoded.length,
      reason: null,
    };
  }

  function buildFileText(items) {
    return JSON.stringify(buildPayload(items), null, 2);
  }

  /** アプリ名・種類・日付が分かるファイル名。 */
  function fileName(kind) {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const date = '' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate());
    return 'mahjong-trainer-tsuzuki-' + (kind ? kind + '-' : '') + date + '.json';
  }

  // ==================================================
  // 書き出し済みの記録(元データは消さない)
  // ==================================================

  function loadExported() {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
      if (!raw) return { version: 1, exportedIds: [] };
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.exportedIds)) return { version: 1, exportedIds: [] };
      return { version: parsed.version || 1, exportedIds: parsed.exportedIds };
    } catch (e) {
      return { version: 1, exportedIds: [] };
    }
  }

  function saveExported(store) {
    try {
      if (typeof localStorage === 'undefined') return false;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
      return true;
    } catch (e) {
      return false;
    }
  }

  function isExported(externalId, store) {
    const s = store || loadExported();
    return s.exportedIds.indexOf(externalId) !== -1;
  }

  /** 書き出し済みとして記録する。学習データそのものは一切削除・変更しない。 */
  function markExported(externalIds, store) {
    const s = store || loadExported();
    const set = new Set(s.exportedIds);
    (externalIds || []).forEach((id) => set.add(id));
    const next = { version: s.version || 1, exportedIds: [...set] };
    saveExported(next);
    return next;
  }

  /** 復習帳から、まだ書き出していない項目を集める。 */
  function pendingReviewItems(reviewStore, exportedStore) {
    const s = reviewStore || (Review ? Review.loadStore() : { entries: [] });
    const ex = exportedStore || loadExported();
    return (s.entries || [])
      .map(itemFromReviewEntry)
      .filter(Boolean)
      .filter((item) => !isExported(item.externalId, ex));
  }

  /** 復習帳の全項目(書き出し済みを含む)。 */
  function allReviewItems(reviewStore) {
    const s = reviewStore || (Review ? Review.loadStore() : { entries: [] });
    return (s.entries || []).map(itemFromReviewEntry).filter(Boolean);
  }

  // ==================================================
  // クイズ誤答の一括書き出し
  // ==================================================

  /**
   * クイズ履歴に残っている誤答(wrongQuestionIds)を、問題データと突き合わせて変換する。
   *
   * 履歴には「どの選択肢を選んだか」は保存されていないため、自分の回答は補わず
   * 「保存されていない」と明記する(推測して書かない)。
   * 問題データから消えたIDはエラーにせず読み飛ばす。
   * @param {object} [quizStore] 省略時は localStorage から読み込む
   */
  function allQuizWrongItems(quizStore) {
    if (!QuizData || !QuizStats) return [];
    const store = quizStore || QuizStats.load();
    const items = [];
    (QuizData.COURSES || []).forEach((course) => {
      const questions = QuizData.questionsForCourse(course.id) || [];
      const existingIds = questions.map((q) => q.id);
      const wrongIds = QuizStats.wrongQuestionIds(course.id, existingIds, store);
      const stats = QuizStats.courseStats(course.id, store);
      wrongIds.forEach((id) => {
        const question = QuizData.getQuestion(id);
        if (!question) return;
        const item = itemFromQuizAnswer(question, null, {
          courseName: course.name,
          // 「いつ間違えたか」は問題ごとには残っていないため、そのコースの最終挑戦日時を使う
          at: stats.lastAt || undefined,
        });
        if (item) items.push(item);
      });
    });
    return items;
  }

  /** まだ書き出していないクイズ誤答だけ。 */
  function pendingQuizWrongItems(quizStore, exportedStore) {
    const ex = exportedStore || loadExported();
    return allQuizWrongItems(quizStore).filter((item) => !isExported(item.externalId, ex));
  }

  /** 指定した externalId のクイズ誤答だけ。 */
  function quizWrongItemsByIds(externalIds, quizStore) {
    const want = new Set(externalIds || []);
    return allQuizWrongItems(quizStore).filter((item) => want.has(item.externalId));
  }

  /** 画面表示用の一覧(チェックボックスつきで選ばせるため)。 */
  function listQuizWrongForDisplay(quizStore, exportedStore) {
    const ex = exportedStore || loadExported();
    return allQuizWrongItems(quizStore).map((item) => ({
      externalId: item.externalId,
      courseName: item.details['コース'] || '',
      questionId: item.details['元の問題ID'] || '',
      prompt: item.question,
      exported: isExported(item.externalId, ex),
    }));
  }

  const TsuzukiLink = {
    STORAGE_KEY,
    DEFAULT_BASE_URL,
    IMPORT_SCHEMA_VERSION,
    TOPIC_NAME,
    SOURCE_APP,
    APP_VERSION,
    MAX_FRAGMENT_CHARS,
    setBaseUrl,
    baseUrl,
    selfUrl,
    encodeBase64Url,
    tilesToText,
    itemFromReviewEntry,
    itemFromQuizAnswer,
    buildPayload,
    buildSingleUrl,
    buildFileText,
    fileName,
    loadExported,
    saveExported,
    isExported,
    markExported,
    pendingReviewItems,
    allReviewItems,
    allQuizWrongItems,
    pendingQuizWrongItems,
    quizWrongItemsByIds,
    listQuizWrongForDisplay,
    NO_ANSWER_RECORD,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = TsuzukiLink;
  } else {
    root.MJ = root.MJ || {};
    root.MJ.TsuzukiLink = TsuzukiLink;
  }
})(typeof window !== 'undefined' ? window : globalThis);
