/**
 * tests/tsuzuki-tests.js
 * つづきノート連携(js/tsuzukilink.js)のテスト。
 * 既存の復習帳・クイズ履歴を壊さないこと、externalId が安定することを重点的に確認する。
 */
module.exports = function ({ test, assert, Tiles, Review, TsuzukiLink, QuizData, QuizSession, QuizStats }) {
  // ---- テスト用の復習帳エントリーを作る ----
  function makeReviewEntry() {
    const store = Review.createStore();
    const tiles14 = Tiles.parseHand
      ? Tiles.parseHand('123m456m789m123s5s')
      : [0, 1, 2, 3, 4, 5, 6, 7, 8, 18, 19, 20, 22, 22];
    const res = Review.recordAnswer(
      {
        tiles14,
        chosenTile: tiles14[tiles14.length - 1],
        grade: 'bad',
        gradeLabel: '×',
        autoSaved: true,
        autoReasons: ['×評価だったため'],
        at: '2026-09-08T02:00:00.000Z',
      },
      store,
    );
    return res.entry;
  }

  // 1. 誤答を正しい外部形式へ変換できる
  test('復習帳のエントリーをつづきノートの取り込み形式へ変換できる', () => {
    const item = TsuzukiLink.itemFromReviewEntry(makeReviewEntry());
    assert.ok(item, '変換結果が返る');
    assert.strictEqual(item.type, 'reviewCard');
    assert.strictEqual(item.topicName, '麻雀');
    assert.ok(item.question.length > 0, '質問がある');
    assert.ok(item.answer.length > 0, '答えがある');
    assert.ok(item.occurredAt, '発生日時がある');
    assert.ok(item.tags.indexOf('麻雀') !== -1, '麻雀タグが付く');
  });

  // 2. 局面情報が欠落しない
  test('手牌・判定・受け入れなどの局面情報が details に残る', () => {
    const entry = makeReviewEntry();
    const item = TsuzukiLink.itemFromReviewEntry(entry);
    assert.ok(item.details['手牌'], '手牌が入る');
    assert.strictEqual(item.details['手牌'].split(' ').length, 14, '14枚ぶん残る');
    assert.ok(item.details['自分の回答'], '自分の回答が入る');
    assert.ok(item.details['判定'], '判定が入る');
    assert.ok(item.details['シャンテン数'] !== undefined, 'シャンテン数が入る');
    assert.ok(item.details['回答回数'], '回答回数が入る');
  });

  test('クイズの誤答から手牌・ドラ・選択肢・自分の回答を変換できる', () => {
    const question = QuizData.questionsForCourse('yaku')[0];
    const session = QuizSession.createSession('yaku', { questionIds: [question.id] });
    // わざと間違える(正解でない選択肢を1つ選ぶ)
    const wrongChoice = question.choices.find((c) => question.expected.indexOf(c.id) === -1);
    const record = QuizSession.answerCurrent(session, [wrongChoice.id]);
    assert.strictEqual(record.correct, false, 'まず不正解になっている');

    const item = TsuzukiLink.itemFromQuizAnswer(question, record, { courseName: '役当てクイズ' });
    assert.strictEqual(item.type, 'reviewCard');
    assert.strictEqual(item.question, question.prompt);
    assert.ok(item.details['手牌'], '手牌が残る');
    assert.ok(item.details['選択肢'], '選択肢が残る');
    assert.ok(item.details['自分の回答'], '自分の回答が残る');
    assert.strictEqual(item.details['元の問題ID'], question.id);
    assert.ok(item.details['アプリ'].indexOf('麻雀学習アプリ') === 0, 'アプリのバージョンが残る');
    assert.ok(item.explanation.length > 0, '解説が残る');
  });

  // 3. 安定した externalId
  test('同じ問題からは毎回同じ externalId が作られる', () => {
    const a = TsuzukiLink.itemFromReviewEntry(makeReviewEntry());
    const b = TsuzukiLink.itemFromReviewEntry(makeReviewEntry());
    assert.strictEqual(a.externalId, b.externalId, '復習帳: 同じIDになる');
    assert.ok(a.externalId.indexOf('saved-problem:') === 0, '接頭辞が付く');

    const question = QuizData.questionsForCourse('yaku')[0];
    const q1 = TsuzukiLink.itemFromQuizAnswer(question, null, {});
    const q2 = TsuzukiLink.itemFromQuizAnswer(question, null, {});
    assert.strictEqual(q1.externalId, q2.externalId, 'クイズ: 同じIDになる');
    assert.strictEqual(q1.externalId, 'quiz-wrong:yaku:' + question.id);
  });

  // 4. 1件用URLを生成できる
  test('1件送信用のURLを作れる(Base64URLで、URLに安全な文字だけ)', () => {
    TsuzukiLink.setBaseUrl('https://example.test/tsuzuki-note/');
    const item = TsuzukiLink.itemFromReviewEntry(makeReviewEntry());
    const result = TsuzukiLink.buildSingleUrl(item);
    assert.strictEqual(result.ok, true, 'URLを作れる');
    assert.ok(result.url.indexOf('https://example.test/tsuzuki-note/#/external-import/') === 0);

    const encoded = result.url.split('#/external-import/')[1];
    assert.ok(/^[A-Za-z0-9\-_]+$/.test(encoded), 'URLに安全な文字だけ');

    // デコードすると元のペイロードに戻る(日本語が壊れていない)
    const json = Buffer.from(encoded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const payload = JSON.parse(json);
    assert.strictEqual(payload.sourceApp, 'mahjong-trainer');
    assert.strictEqual(payload.schemaVersion, 1);
    assert.strictEqual(payload.items.length, 1);
    assert.strictEqual(payload.items[0].topicName, '麻雀');
    TsuzukiLink.setBaseUrl(null);
  });

  // 5. 大きすぎる問題はファイル方式へフォールバック
  test('大きすぎる問題はURLで送らず、ファイル方式を案内する', () => {
    const item = TsuzukiLink.itemFromReviewEntry(makeReviewEntry());
    item.explanation = 'あ'.repeat(20000); // 日本語なのでエンコード後はさらに大きくなる
    const result = TsuzukiLink.buildSingleUrl(item);
    assert.strictEqual(result.ok, false, 'URLは作らない');
    assert.ok(result.reason.indexOf('書き出す') !== -1, 'ファイル方式を案内する');
    assert.ok(result.size > TsuzukiLink.MAX_FRAGMENT_CHARS, '上限を超えている');
  });

  // 6. 複数項目をJSONファイルへまとめられる
  test('複数件を1つのJSONファイルへまとめられる', () => {
    const question = QuizData.questionsForCourse('yaku')[0];
    const items = [
      TsuzukiLink.itemFromReviewEntry(makeReviewEntry()),
      TsuzukiLink.itemFromQuizAnswer(question, null, { courseName: '役当てクイズ' }),
    ];
    const text = TsuzukiLink.buildFileText(items);
    const payload = JSON.parse(text);
    assert.strictEqual(payload.items.length, 2);
    assert.strictEqual(payload.sourceApp, 'mahjong-trainer');
    assert.ok(payload.exportedAt, '書き出し日時が入る');
    const ids = payload.items.map((i) => i.externalId);
    assert.strictEqual(new Set(ids).size, 2, 'externalId が重複しない');
    assert.ok(TsuzukiLink.fileName().indexOf('mahjong-trainer-tsuzuki-') === 0, 'ファイル名が付く');
  });

  // 7. 書き出しても元データは削除されない
  test('書き出し済みの印を付けても、復習帳のデータは消えない', () => {
    const store = Review.createStore();
    const tiles14 = [0, 1, 2, 3, 4, 5, 6, 7, 8, 18, 19, 20, 22, 22];
    Review.recordAnswer({ tiles14, chosenTile: 22, grade: 'bad', at: '2026-09-08T02:00:00.000Z' }, store);
    const before = store.entries.length;
    const item = TsuzukiLink.itemFromReviewEntry(store.entries[0]);

    // markExported は専用キーにしか書かない（localStorage が無い node でも例外にならない）
    const exportedStore = TsuzukiLink.markExported([item.externalId], { version: 1, exportedIds: [] });
    assert.ok(TsuzukiLink.isExported(item.externalId, exportedStore), '書き出し済みになる');
    assert.strictEqual(store.entries.length, before, '復習帳の件数は変わらない');
    assert.strictEqual(store.entries[0].attempts.length, 1, '回答履歴も残っている');
    assert.notStrictEqual(TsuzukiLink.STORAGE_KEY, Review.STORAGE_KEY, '保存キーが別で、既存データを上書きしない');
  });

  test('未連携だけを選んで書き出せる', () => {
    const store = Review.createStore();
    Review.recordAnswer(
      { tiles14: [0, 1, 2, 3, 4, 5, 6, 7, 8, 18, 19, 20, 22, 22], chosenTile: 22, grade: 'bad', at: '2026-09-08T02:00:00.000Z' },
      store,
    );
    Review.recordAnswer(
      { tiles14: [0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 18, 19, 20, 21], chosenTile: 21, grade: 'fair', at: '2026-09-08T02:05:00.000Z' },
      store,
    );
    const all = TsuzukiLink.allReviewItems(store);
    assert.strictEqual(all.length, 2, '全部で2件');

    const exported = TsuzukiLink.markExported([all[0].externalId], { version: 1, exportedIds: [] });
    const pending = TsuzukiLink.pendingReviewItems(store, exported);
    assert.strictEqual(pending.length, 1, '未連携は1件だけ');
    assert.strictEqual(pending[0].externalId, all[1].externalId);
  });


  // ==================================================
  // V2.2: クイズ誤答の一括書き出し
  // ==================================================

  /** クイズ履歴のダミー(localStorage を使わず、そのまま渡せる形) */
  function quizStoreWith(courseId, wrongIds) {
    return {
      version: 2,
      courses: {
        [courseId]: {
          attempts: 1,
          correct: 0,
          answered: wrongIds.length,
          lastAt: '2026-09-10T01:00:00.000Z',
          wrongQuestionIds: wrongIds.slice(),
          byDifficulty: {},
          reasoning: { excellent: 0, good: 0, needsWork: 0 },
          hit: { hit: 0, partial: 0, miss: 0 },
          hitLegacy: null,
        },
      },
      tags: {},
    };
  }

  function firstWrongIds(n) {
    return QuizData.questionsForCourse('yaku').slice(0, n).map((q) => q.id);
  }

  // 1. 未連携クイズ誤答だけを書き出せる
  test('未連携のクイズ誤答だけを書き出せる', () => {
    const ids = firstWrongIds(3);
    const store = quizStoreWith('yaku', ids);
    const all = TsuzukiLink.allQuizWrongItems(store);
    assert.strictEqual(all.length, 3, '誤答3問が変換される');

    const exported = TsuzukiLink.markExported([all[0].externalId], { version: 1, exportedIds: [] });
    const pending = TsuzukiLink.pendingQuizWrongItems(store, exported);
    assert.strictEqual(pending.length, 2, '未連携は2問');
    assert.ok(
      pending.every((p) => p.externalId !== all[0].externalId),
      '連携済みは含まれない'
    );
  });

  // 2. 選択した誤答だけを書き出せる
  test('選択した誤答だけを書き出せる', () => {
    const store = quizStoreWith('yaku', firstWrongIds(3));
    const all = TsuzukiLink.allQuizWrongItems(store);
    const picked = TsuzukiLink.quizWrongItemsByIds([all[0].externalId, all[2].externalId], store);
    assert.strictEqual(picked.length, 2);
    assert.strictEqual(picked[0].externalId, all[0].externalId);
    assert.strictEqual(picked[1].externalId, all[2].externalId);
    assert.strictEqual(TsuzukiLink.quizWrongItemsByIds([], store).length, 0, '未選択なら0件');
  });

  // 3. 連携済みを含めてすべて書き出せる
  test('連携済みを含めてすべて書き出せる', () => {
    const store = quizStoreWith('yaku', firstWrongIds(3));
    const all = TsuzukiLink.allQuizWrongItems(store);
    TsuzukiLink.markExported(all.map((i) => i.externalId), { version: 1, exportedIds: [] });
    assert.strictEqual(TsuzukiLink.allQuizWrongItems(store).length, 3, '連携済みでも全件返る');
  });

  test('問題データから消えたIDはエラーにせず読み飛ばす', () => {
    const store = quizStoreWith('yaku', firstWrongIds(1).concat(['deleted-question-id']));
    const all = TsuzukiLink.allQuizWrongItems(store);
    assert.strictEqual(all.length, 1, '存在する1問だけ');
  });

  // 4. 1件送信と一括書き出しで externalId が一致する
  test('1件送信と一括書き出しで externalId が一致する', () => {
    const question = QuizData.questionsForCourse('yaku')[0];
    const single = TsuzukiLink.itemFromQuizAnswer(question, null, { courseName: '役当てクイズ' });
    const bulk = TsuzukiLink.allQuizWrongItems(quizStoreWith('yaku', [question.id]))[0];
    assert.strictEqual(single.externalId, bulk.externalId, '同じIDになる（重複登録されない）');
    assert.strictEqual(bulk.externalId, 'quiz-wrong:yaku:' + question.id);
  });

  // 5. 過去に保存されていない回答を捏造しない
  test('保存されていない回答を推測で埋めない', () => {
    const question = QuizData.questionsForCourse('yaku')[0];
    const bulk = TsuzukiLink.allQuizWrongItems(quizStoreWith('yaku', [question.id]))[0];
    assert.strictEqual(
      bulk.details['自分の回答'],
      TsuzukiLink.NO_ANSWER_RECORD,
      '「保存されていません」と明記する'
    );
    // 正解・問題文・局面は問題データから取れるので入る
    assert.ok(bulk.answer.length > 0, '正解は入る');
    assert.ok(bulk.details['手牌'], '手牌は入る');
    assert.ok(bulk.details['選択肢'], '選択肢は入る');
    assert.strictEqual(bulk.details['コースID'], 'yaku');
    assert.ok(bulk.details['問題種別'], '問題種別が入る');
  });

  // 6. 書き出しても元の誤答履歴が残る
  test('書き出しても元のクイズ誤答履歴は消えない', () => {
    const ids = firstWrongIds(2);
    const store = quizStoreWith('yaku', ids);
    const all = TsuzukiLink.allQuizWrongItems(store);
    TsuzukiLink.markExported(all.map((i) => i.externalId), { version: 1, exportedIds: [] });
    assert.deepStrictEqual(store.courses.yaku.wrongQuestionIds, ids, '誤答IDはそのまま');
    assert.strictEqual(store.courses.yaku.answered, ids.length, '集計も変わらない');
    assert.notStrictEqual(TsuzukiLink.STORAGE_KEY, QuizStats.STORAGE_KEY, '保存キーが別');
  });

  // 7. 日本語を含むJSONが壊れない
  test('日本語を含むクイズ誤答JSONが壊れない', () => {
    const store = quizStoreWith('yaku', firstWrongIds(2));
    const text = TsuzukiLink.buildFileText(TsuzukiLink.allQuizWrongItems(store));
    const parsed = JSON.parse(text);
    assert.strictEqual(parsed.items.length, 2);
    assert.strictEqual(parsed.items[0].topicName, '麻雀');
    assert.ok(parsed.items[0].question.length > 0);
    // 往復しても文字が変わらない
    assert.strictEqual(JSON.parse(JSON.stringify(parsed)).items[0].question, parsed.items[0].question);
    assert.ok(TsuzukiLink.fileName('quiz').indexOf('mahjong-trainer-tsuzuki-quiz-') === 0, '種類と日付が入る');
  });

  test('表示用の一覧に連携済みかどうかが出る', () => {
    const store = quizStoreWith('yaku', firstWrongIds(2));
    const all = TsuzukiLink.allQuizWrongItems(store);
    const exported = TsuzukiLink.markExported([all[0].externalId], { version: 1, exportedIds: [] });
    const rows = TsuzukiLink.listQuizWrongForDisplay(store, exported);
    assert.strictEqual(rows.length, 2);
    assert.strictEqual(rows[0].exported, true);
    assert.strictEqual(rows[1].exported, false);
    assert.ok(rows[0].courseName.length > 0, 'コース名が入る');
  });

  // 8. 既存機能が壊れていない（保存キー・APIの互換）
  test('既存のクイズ・復習の保存キーとAPIに影響していない', () => {
    assert.strictEqual(Review.STORAGE_KEY, 'mahjong-trainer-review-v1');
    assert.strictEqual(TsuzukiLink.STORAGE_KEY, 'mahjong-trainer-tsuzuki-v1');
    assert.strictEqual(typeof Review.recordAnswer, 'function');
    assert.strictEqual(typeof Review.pickTodayReview, 'function');
    assert.strictEqual(typeof QuizSession.answerCurrent, 'function');
  });

  test('壊れた入力を渡しても例外にならない', () => {
    assert.strictEqual(TsuzukiLink.itemFromReviewEntry(null), null);
    assert.strictEqual(TsuzukiLink.itemFromReviewEntry({}), null);
    assert.strictEqual(TsuzukiLink.itemFromQuizAnswer(null, null, {}), null);
    const result = TsuzukiLink.buildSingleUrl(null);
    assert.strictEqual(result.ok, false);
  });
};
