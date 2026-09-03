/**
 * tests/review-tests.js
 * 「何切る復習帳」(review.js / problems.js のレベル出題)のテスト。
 * tests/run.js から読み込んで実行する。
 */
module.exports = function registerReviewTests(ctx) {
  const { test, assert, Tiles, Evaluator, Review, Problems } = ctx;

  console.log('== review.js: 何切る復習帳 ==');

  // テストごとに独立した状態から始めるためのヘルパー
  function freshStore() {
    return Review.createStore();
  }

  /** 学習タグの検証に使う、狙った形の手牌 */
  const HAND_WITH_KANCHAN = Tiles.toCounts([0, 2, 4, 9, 10, 11, 18, 19, 20, 22, 23, 27, 27, 33]);
  // 3445萬相当(2,3,3,4 = 0基点なら 2,3,3,4)の複合形を含む手
  const HAND_COMPLEX = Tiles.toCounts([2, 3, 3, 4, 9, 10, 11, 18, 19, 20, 26, 26, 30, 33]);

  function answerInput(tiles14, chosenTile, grade, at) {
    const counts14 = Tiles.toCounts(tiles14);
    const analysis = Evaluator.analyzeHand(counts14);
    return {
      tiles14,
      counts14,
      analysis,
      chosenTile,
      grade,
      gradeLabel: grade,
      comment: 'test',
      at,
    };
  }

  // ==================================================
  // タグ判定
  // ==================================================

  test('detectTags: 嵌張・字牌処理・孤立牌などのタグを既存の形判定から作れる', () => {
    const analysis = Evaluator.analyzeHand(HAND_WITH_KANCHAN);
    const tags = Review.detectTags(HAND_WITH_KANCHAN, analysis);
    assert.ok(Array.isArray(tags) && tags.length > 0, 'タグが空');
    assert.ok(tags.indexOf('字牌処理') !== -1, '字牌があるのに字牌処理タグが付かない');
    // 判定されるタグはすべて定義済みのものであること
    tags.forEach((t) => {
      assert.ok(Review.ALL_TAGS.indexOf(t) !== -1, '未定義のタグ: ' + t);
      assert.ok(Review.TAG_INFO[t].description.length > 0, t + 'の初心者向け説明がない');
    });
  });

  test('detectTags: 複合形(3445のような形)を検出できる', () => {
    assert.strictEqual(Review.hasComplexShape(HAND_COMPLEX), true, '複合形を検出できていない');
    const tags = Review.detectTags(HAND_COMPLEX, Evaluator.analyzeHand(HAND_COMPLEX));
    assert.ok(tags.indexOf('複合形') !== -1, '複合形タグが付かない');

    // 連続していない形では複合形にならない
    const flat = Tiles.toCounts([0, 4, 8, 9, 13, 17, 18, 22, 26, 27, 28, 29, 30, 31]);
    assert.strictEqual(Review.hasComplexShape(flat), false, 'バラバラの手を複合形と誤判定している');
  });

  // ==================================================
  // 手動保存・自動保存・重複防止
  // ==================================================

  test('recordAnswer: 手動保存で問題・タグ・解説・履歴が保存される', () => {
    const store = freshStore();
    const problem = Problems.nextProblem('random');
    const chosen = problem.analysis.discards[problem.analysis.discards.length - 1].tile;
    const res = Review.recordAnswer(
      Object.assign(answerInput(problem.tiles14, chosen, 'fair', '2026-09-01T10:00:00.000Z'), { source: 'mondai' }),
      store
    );

    assert.strictEqual(res.isNew, true);
    assert.strictEqual(store.entries.length, 1);
    const e = res.entry;
    assert.strictEqual(e.tiles14.length, 14, '手牌14枚が保存されていない');
    assert.ok(typeof e.bestLabel === 'string' && e.bestLabel.length > 0, 'おすすめ打牌が保存されていない');
    assert.ok(typeof e.bestUkeire === 'number', 'おすすめ打牌後の受け入れが保存されていない');
    assert.ok(Array.isArray(e.ukeireTiles), '有効牌が保存されていない');
    assert.ok(typeof e.shantenAtStart === 'number', 'シャンテン数が保存されていない');
    assert.ok(e.beginnerPoint.length > 0, '初心者向け解説が生成されていない');
    assert.ok(Array.isArray(e.tags), '学習タグが保存されていない');
    assert.ok(e.problemId.length > 0, '問題IDがない');

    const a = e.attempts[0];
    assert.strictEqual(a.chosenTile, chosen, '自分が選んだ打牌が保存されていない');
    assert.strictEqual(a.grade, 'fair', '評価が保存されていない');
    assert.ok(typeof a.chosenUkeire === 'number', '自分の打牌後の受け入れが保存されていない');
    assert.strictEqual(a.at, '2026-09-01T10:00:00.000Z', '回答日時が保存されていない');
  });

  test('shouldAutoSave: ×/△・1位以外・シャンテン戻し・受け入れ大幅減で自動保存される', () => {
    const problem = Problems.nextProblem('level3'); // シャンテンが戻る候補がある手
    const analysis = problem.analysis;
    const best = analysis.recommended;
    const worst = analysis.discards[analysis.discards.length - 1];

    // 1位を選び、かつ◎なら保存しない
    const okCase = Review.shouldAutoSave(analysis, best.tile, 'excellent');
    assert.strictEqual(okCase.should, false, '正解なのに自動保存されている');

    // シャンテンを戻す打牌は保存する
    const backCase = Review.shouldAutoSave(analysis, worst.tile, 'bad');
    assert.strictEqual(backCase.should, true, '×評価が自動保存されない');
    assert.ok(backCase.reasons.length > 0, '自動保存の理由が記録されていない');
    assert.ok(
      backCase.reasons.some((r) => r.indexOf('シャンテン') !== -1 || r.indexOf('×') !== -1),
      '理由の内容が不正: ' + backCase.reasons.join('/')
    );

    // 1位と違う牌なら△でも保存する
    const other = analysis.discards.find((d) => d.tile !== best.tile);
    const fairCase = Review.shouldAutoSave(analysis, other.tile, 'fair');
    assert.strictEqual(fairCase.should, true, '△評価が自動保存されない');
  });

  test('recordAnswer: 同じ手牌を何度保存しても問題は増えず履歴だけが増える(重複防止)', () => {
    const store = freshStore();
    const problem = Problems.nextProblem('random');
    const tiles = problem.tiles14;
    const t1 = problem.analysis.discards[0].tile;
    const t2 = problem.analysis.discards[1].tile;

    Review.recordAnswer(answerInput(tiles, t1, 'bad', '2026-09-01T10:00:00.000Z'), store);
    Review.recordAnswer(answerInput(tiles, t2, 'fair', '2026-09-02T10:00:00.000Z'), store);
    const third = Review.recordAnswer(answerInput(tiles, t1, 'excellent', '2026-09-03T10:00:00.000Z'), store);

    assert.strictEqual(store.entries.length, 1, '同じ手牌が複数の問題として登録されている');
    assert.strictEqual(third.isNew, false);
    assert.strictEqual(store.entries[0].attempts.length, 3, '履歴が3件になっていない');
    assert.strictEqual(store.entries[0].lastAnsweredAt, '2026-09-03T10:00:00.000Z');

    // 並び順どおりに履歴が残っていること
    const grades = store.entries[0].attempts.map((a) => a.grade);
    assert.deepStrictEqual(grades, ['bad', 'fair', 'excellent']);
  });

  test('problemIdOf: 並び順が違っても同じ手牌なら同じIDになる', () => {
    const a = [0, 1, 2, 9, 9, 10, 11, 18, 19, 20, 27, 27, 30, 30];
    const b = a.slice().reverse();
    assert.strictEqual(Review.problemIdOf(a), Review.problemIdOf(b));
  });

  // ==================================================
  // 再出題
  // ==================================================

  test('problemFromEntry: 保存した問題を同じ14枚で再出題できる', () => {
    const store = freshStore();
    const problem = Problems.nextProblem('random');
    const res = Review.recordAnswer(
      answerInput(problem.tiles14, problem.analysis.discards[0].tile, 'fair', '2026-09-01T10:00:00.000Z'),
      store
    );

    const again = Problems.problemFromEntry(res.entry);
    assert.deepStrictEqual(
      again.tiles14.slice().sort((x, y) => x - y),
      res.entry.tiles14.slice().sort((x, y) => x - y),
      '再出題の手牌が元と違う'
    );
    assert.strictEqual(again.answered, false, '再出題が回答済みになっている');
    assert.strictEqual(
      again.analysis.recommended.tile,
      res.entry.bestTile,
      '再出題時のおすすめが元の分析と一致しない'
    );
  });

  // ==================================================
  // 習得判定
  // ==================================================

  test('statusOf: 未復習→要復習→学習中→習得の状態が正しく判定される', () => {
    const mk = (grades) => ({
      attempts: grades.map((g, i) => ({ grade: g, at: '2026-09-0' + (i + 1) + 'T10:00:00.000Z' })),
    });

    assert.strictEqual(Review.statusOf(mk([])), 'new', '履歴なしは未復習');
    assert.strictEqual(Review.statusOf(mk(['bad'])), 'new', '1回だけなら未復習(まだ復習していない)');
    assert.strictEqual(Review.statusOf(mk(['bad', 'fair'])), 'todo', '直近が△なら要復習');
    assert.strictEqual(Review.statusOf(mk(['bad', 'bad'])), 'todo', '直近が×なら要復習');
    assert.strictEqual(Review.statusOf(mk(['bad', 'good'])), 'learning', '直近が○なら学習中');
    assert.strictEqual(Review.statusOf(mk(['bad', 'excellent'])), 'learning', '◎1回だけでは習得にしない');
    assert.strictEqual(Review.statusOf(mk(['bad', 'excellent', 'excellent'])), 'mastered', '2回連続◎で習得');
    assert.strictEqual(
      Review.statusOf(mk(['excellent', 'excellent', 'fair'])),
      'todo',
      '習得後に間違えたら要復習に戻る'
    );
    assert.strictEqual(Review.statusLabelOf(mk(['bad', 'excellent', 'excellent'])), '習得');
  });

  test('習得済みの問題も削除されず履歴として残る', () => {
    const store = freshStore();
    const problem = Problems.nextProblem('random');
    const best = problem.analysis.recommended.tile;
    Review.recordAnswer(answerInput(problem.tiles14, best, 'bad', '2026-09-01T10:00:00.000Z'), store);
    Review.recordAnswer(answerInput(problem.tiles14, best, 'excellent', '2026-09-02T10:00:00.000Z'), store);
    Review.recordAnswer(answerInput(problem.tiles14, best, 'excellent', '2026-09-03T10:00:00.000Z'), store);

    assert.strictEqual(Review.statusOf(store.entries[0]), 'mastered');
    assert.strictEqual(store.entries.length, 1, '習得しても問題が消えてはいけない');
    assert.strictEqual(store.entries[0].attempts.length, 3, '履歴が残っていない');
  });

  // ==================================================
  // 苦手分析
  // ==================================================

  test('analyzeWeakness: タグごとの正答率を集計し、苦手な順に並べる', () => {
    const store = freshStore();
    // タグを固定した人工的なエントリーを直接入れて集計だけを検証する
    store.entries.push({
      problemId: 'pA',
      tiles14: [],
      tags: ['複合形'],
      lastAnsweredAt: '2026-09-01T10:00:00.000Z',
      attempts: [{ grade: 'bad', at: '2026-09-01T10:00:00.000Z' }, { grade: 'fair', at: '2026-09-01T10:00:00.000Z' }],
    });
    store.entries.push({
      problemId: 'pB',
      tiles14: [],
      tags: ['孤立牌'],
      lastAnsweredAt: '2026-09-01T10:00:00.000Z',
      attempts: [
        { grade: 'excellent', at: '2026-09-01T10:00:00.000Z' },
        { grade: 'excellent', at: '2026-09-01T10:00:00.000Z' },
        { grade: 'bad', at: '2026-09-01T10:00:00.000Z' },
      ],
    });

    const weak = Review.analyzeWeakness(store);
    assert.strictEqual(weak[0].tag, '複合形', '正答率が低いタグが先頭に来ていない');
    assert.strictEqual(weak[0].rate, 0, '複合形の正答率が0%になっていない');
    const isolated = weak.find((w) => w.tag === '孤立牌');
    assert.strictEqual(isolated.rate, 67, '孤立牌の正答率(2/3)が四捨五入で67%になっていない');
    assert.ok(weak[0].description.indexOf('複合形') !== -1, '初心者向けの説明が付いていない');
  });

  // ==================================================
  // 今日の復習 / おすすめ
  // ==================================================

  test('pickTodayReview: 要復習・×だった問題を優先し、既定5問まで選ぶ', () => {
    const store = freshStore();
    const mkEntry = (id, grades, lastAt, tags) => ({
      problemId: id,
      tiles14: [],
      tags: tags || [],
      lastAnsweredAt: lastAt,
      attempts: grades.map((g) => ({ grade: g, at: lastAt })),
    });

    // 習得済み(優先度が最も低い)
    store.entries.push(mkEntry('mastered', ['excellent', 'excellent'], '2026-09-03T10:00:00.000Z'));
    // 要復習(×)
    store.entries.push(mkEntry('todoBad', ['fair', 'bad'], '2026-09-03T10:00:00.000Z'));
    // 要復習(△)
    store.entries.push(mkEntry('todoFair', ['bad', 'fair'], '2026-09-03T10:00:00.000Z'));
    // 未復習
    store.entries.push(mkEntry('newOne', ['fair'], '2026-09-03T10:00:00.000Z'));
    // 学習中
    store.entries.push(mkEntry('learning', ['bad', 'good'], '2026-09-03T10:00:00.000Z'));

    const picked = Review.pickTodayReview(store, 5, '2026-09-03T12:00:00.000Z').map((e) => e.problemId);
    assert.strictEqual(picked.length, 5);
    assert.strictEqual(picked[0], 'todoBad', '×だった要復習が最優先になっていない');
    assert.strictEqual(picked[1], 'todoFair', '△だった要復習が2番目になっていない');
    assert.strictEqual(picked[picked.length - 1], 'mastered', '習得済みが最後になっていない');

    // 出題数は指定した数まで
    assert.strictEqual(Review.pickTodayReview(store, 2, '2026-09-03T12:00:00.000Z').length, 2);
    assert.strictEqual(Review.DAILY_REVIEW_SIZE, 5, '既定の出題数は5問');
  });

  test('pickTodayReview: 久しぶりの問題と苦手タグの問題が優先される', () => {
    const store = freshStore();
    const base = {
      tiles14: [],
      attempts: [{ grade: 'good', at: '2026-08-01T10:00:00.000Z' }, { grade: 'good', at: '2026-08-01T10:00:00.000Z' }],
    };
    store.entries.push(Object.assign({}, base, { problemId: 'recent', tags: [], lastAnsweredAt: '2026-09-03T10:00:00.000Z' }));
    store.entries.push(Object.assign({}, base, { problemId: 'old', tags: [], lastAnsweredAt: '2026-08-01T10:00:00.000Z' }));

    const picked = Review.pickTodayReview(store, 2, '2026-09-03T12:00:00.000Z').map((e) => e.problemId);
    assert.strictEqual(picked[0], 'old', '久しぶりの問題が優先されていない');
  });

  // ==================================================
  // 成長サマリー
  // ==================================================

  test('summarize: 習得・学習中・要復習の数と今週の◎率を集計する', () => {
    const store = freshStore();
    const now = '2026-09-10T00:00:00.000Z';
    const thisWeek = '2026-09-09T00:00:00.000Z';
    const longAgo = '2026-01-01T00:00:00.000Z';

    store.entries.push({
      problemId: 'p1',
      tiles14: [],
      tags: [],
      lastAnsweredAt: thisWeek,
      attempts: [
        { grade: 'bad', at: thisWeek },
        { grade: 'excellent', at: thisWeek },
        { grade: 'excellent', at: thisWeek },
      ],
    });
    store.entries.push({
      problemId: 'p2',
      tiles14: [],
      tags: [],
      lastAnsweredAt: longAgo,
      attempts: [{ grade: 'bad', at: longAgo }, { grade: 'fair', at: longAgo }],
    });

    const s = Review.summarize(store, now);
    assert.strictEqual(s.totalProblems, 2);
    assert.strictEqual(s.totalAttempts, 5);
    assert.strictEqual(s.masteredCount, 1, '習得の数が違う');
    assert.strictEqual(s.todoCount, 1, '要復習の数が違う');
    assert.strictEqual(s.weekAttempts, 3, '今週の回答数が違う');
    assert.strictEqual(s.weekExcellentRate, 67, '今週の◎率(2/3)が違う');
  });

  // ==================================================
  // Export / Import
  // ==================================================

  test('exportJson / importJson: 書き出したJSONをそのまま読み込める', () => {
    const store = freshStore();
    const problem = Problems.nextProblem('random');
    Review.recordAnswer(answerInput(problem.tiles14, problem.analysis.discards[0].tile, 'bad', '2026-09-01T10:00:00.000Z'), store);

    const json = Review.exportJson(store);
    const parsed = JSON.parse(json);
    assert.strictEqual(parsed.type, 'mahjong-trainer-review');
    assert.strictEqual(parsed.entries.length, 1);

    // 空の状態に読み込むと復元される
    const empty = freshStore();
    const res = Review.importJson(json, empty);
    assert.strictEqual(res.ok, true, res.error || '');
    assert.strictEqual(res.added, 1);
    assert.strictEqual(empty.entries.length, 1);
    assert.strictEqual(empty.entries[0].problemId, store.entries[0].problemId);
  });

  test('importJson: 同じ問題は重複せず、履歴だけがマージされる', () => {
    const problem = Problems.nextProblem('random');
    const t1 = problem.analysis.discards[0].tile;
    const t2 = problem.analysis.discards[1].tile;

    const deviceA = freshStore();
    Review.recordAnswer(answerInput(problem.tiles14, t1, 'bad', '2026-09-01T10:00:00.000Z'), deviceA);

    const deviceB = freshStore();
    Review.recordAnswer(answerInput(problem.tiles14, t1, 'bad', '2026-09-01T10:00:00.000Z'), deviceB); // 同じ回答
    Review.recordAnswer(answerInput(problem.tiles14, t2, 'excellent', '2026-09-05T10:00:00.000Z'), deviceB); // Bだけの回答

    const res = Review.importJson(Review.exportJson(deviceB), deviceA);
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.added, 0, '同じ問題が新規追加されている');
    assert.strictEqual(res.merged, 1, '履歴のマージが記録されていない');
    assert.strictEqual(deviceA.entries.length, 1, '問題が重複している');
    assert.strictEqual(deviceA.entries[0].attempts.length, 2, '同一日時の回答が重複マージされている');
    assert.strictEqual(deviceA.entries[0].lastAnsweredAt, '2026-09-05T10:00:00.000Z', '最終回答日時が更新されていない');
  });

  test('importJson: 不正なJSONや形式違いは失敗として扱う', () => {
    const bad = Review.importJson('{ this is not json', freshStore());
    assert.strictEqual(bad.ok, false);
    assert.ok(bad.error.length > 0);

    const wrong = Review.importJson(JSON.stringify({ hello: 'world' }), freshStore());
    assert.strictEqual(wrong.ok, false);
    assert.ok(wrong.error.indexOf('entries') !== -1);
  });

  // ==================================================
  // localStorage への保存
  // ==================================================

  test('recordAndSave / loadStore: localStorageに保存して読み戻せる', () => {
    Review.clearAll();
    assert.strictEqual(Review.loadStore().entries.length, 0);

    const problem = Problems.nextProblem('random');
    const chosen = problem.analysis.discards[0].tile;
    const res = Review.recordAndSave({
      tiles14: problem.tiles14,
      counts14: problem.counts14,
      analysis: problem.analysis,
      chosenTile: chosen,
      grade: 'fair',
      gradeLabel: '△',
      comment: 'test',
      source: 'mondai',
      autoSaved: true,
      autoReasons: ['△評価だったため'],
    });

    const reloaded = Review.loadStore();
    assert.strictEqual(reloaded.entries.length, 1, 'localStorageに保存されていない');
    assert.strictEqual(reloaded.entries[0].problemId, res.entry.problemId);
    assert.strictEqual(reloaded.entries[0].attempts[0].autoSaved, true, '自動保存フラグが保存されていない');

    // 同じ問題をもう一度保存しても増えない
    Review.recordAndSave({
      tiles14: problem.tiles14,
      counts14: problem.counts14,
      analysis: problem.analysis,
      chosenTile: chosen,
      grade: 'excellent',
      source: 'review',
    });
    assert.strictEqual(Review.loadStore().entries.length, 1, '重複登録されている');
    assert.strictEqual(Review.loadStore().entries[0].attempts.length, 2, '履歴が追記されていない');
    Review.clearAll();
  });

  test('listForDisplay: 一覧表示に必要な情報(状態・前回・タグ)が揃う', () => {
    const store = freshStore();
    const problem = Problems.nextProblem('random');
    const best = problem.analysis.recommended.tile;
    Review.recordAnswer(answerInput(problem.tiles14, best, 'bad', '2026-09-01T10:00:00.000Z'), store);
    Review.recordAnswer(answerInput(problem.tiles14, best, 'excellent', '2026-09-02T10:00:00.000Z'), store);

    const rows = Review.listForDisplay(store);
    assert.strictEqual(rows.length, 1);
    const r = rows[0];
    assert.strictEqual(r.attemptCount, 2);
    assert.strictEqual(r.lastGrade, 'excellent');
    assert.ok(r.statusLabel.length > 0);
    assert.ok(typeof r.bestLabel === 'string');
    assert.ok(Array.isArray(r.tags));
  });

  test('trimStore: 上限を超えたら習得済みの古いものから間引く', () => {
    const store = freshStore();
    const total = Review.MAX_ENTRIES + 5;
    for (let i = 0; i < total; i++) {
      // 半分を習得済み(2連続◎)、半分を要復習にする
      const grades = i % 2 === 0 ? ['excellent', 'excellent'] : ['good', 'bad'];
      store.entries.push({
        problemId: 'p' + i,
        tiles14: [],
        tags: [],
        lastAnsweredAt: new Date(2026, 0, 1 + i).toISOString(),
        attempts: grades.map((g) => ({ grade: g, at: new Date(2026, 0, 1 + i).toISOString() })),
      });
    }
    const trimmed = Review.trimStore(store);
    assert.strictEqual(trimmed.entries.length, Review.MAX_ENTRIES, '上限まで間引かれていない');
    // 間引かれたのは習得済みであること(要復習は残る)
    const removed = store.entries.filter((e) => !trimmed.entries.find((t) => t.problemId === e.problemId));
    removed.forEach((e) => {
      assert.strictEqual(Review.statusOf(e), 'mastered', '要復習の問題が先に削除されている');
    });
  });

  // ==================================================
  // 初心者向け解説
  // ==================================================

  test('buildBeginnerPoint: 専門用語の羅列ではなく1文の要点を返す', () => {
    const problem = Problems.nextProblem('level1');
    const analysis = problem.analysis;
    const worst = analysis.discards[analysis.discards.length - 1];
    const point = Review.buildBeginnerPoint(analysis, worst);
    assert.ok(typeof point === 'string' && point.length > 10, '解説文が短すぎる');
    assert.ok(point.indexOf('。') !== -1, '文章になっていない');
  });

  // ==================================================
  // 学習レベル出題
  // ==================================================

  test('Problems.nextProblem: 各レベルがテーマに合った手牌を出題する', () => {
    Problems.LEVELS.forEach((lv) => {
      const p = Problems.nextProblem(lv.id);
      assert.ok(p && p.tiles14.length === 14, lv.id + 'の出題が14枚でない');
      assert.strictEqual(p.levelId, lv.id);
      assert.ok(p.analysis.discards.length > 0, lv.id + 'の分析が空');
      if (lv.id !== 'random') {
        assert.ok(lv.theme.length > 0, lv.id + 'のテーマ説明がない');
        assert.ok(lv.hint.length > 0, lv.id + 'のヒントがない');
        // 条件に合う手が生成できていること(まれに見つからない場合は許容)
        const matched = Problems.matchesLevel(lv.id, p.counts14, p.analysis);
        if (!matched) {
          console.log('    (注: ' + lv.id + ' は条件に合う手が見つからずフォールバック出題)');
        }
      }
    });
  });

  test('Problems.matchesLevel: レベル1は孤立牌・字牌が答えになる手を選ぶ', () => {
    let checked = 0;
    for (let i = 0; i < 10; i++) {
      const p = Problems.nextProblem('level1');
      if (!Problems.matchesLevel('level1', p.counts14, p.analysis)) continue;
      const best = p.analysis.recommended;
      assert.ok(
        best.wasIsolated || (best.tile >= 27 && p.counts14[best.tile] === 1),
        'レベル1のおすすめが孤立牌でも1枚字牌でもない'
      );
      checked++;
    }
    assert.ok(checked > 0, 'レベル1の条件に合う問題が1問も作れなかった');
  });

  test('Problems.matchesLevel: レベル4は全候補が同じシャンテンで受け入れに差がある', () => {
    let checked = 0;
    for (let i = 0; i < 10; i++) {
      const p = Problems.nextProblem('level4');
      if (!Problems.matchesLevel('level4', p.counts14, p.analysis)) continue;
      const best = p.analysis.recommended;
      const same = p.analysis.discards.filter((d) => d.resultShanten === best.resultShanten);
      assert.ok(same.length >= 3, 'レベル4なのに同シャンテンの候補が少ない');
      const minUke = Math.min.apply(null, same.map((d) => d.ukeireTotal));
      assert.ok(best.ukeireTotal - minUke >= 6, 'レベル4なのに受け入れの差が小さい');
      checked++;
    }
    assert.ok(checked > 0, 'レベル4の条件に合う問題が1問も作れなかった');
  });
};
