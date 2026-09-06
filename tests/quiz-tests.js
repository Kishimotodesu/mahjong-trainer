/**
 * tests/quiz-tests.js
 * 「クイズ・学習」タブ(初心者向けクイズ第一弾)のテスト。
 * tests/run.js から呼び出される。
 */
module.exports = function ({ test, assert, Tiles, Shanten, QuizData, QuizEngine, QuizSession, QuizStats }) {
  const parse = QuizData.parse;

  // ==================================================
  // 問題データの健全性
  // ==================================================

  test('クイズ: 全問題IDが一意', () => {
    const ids = QuizData.allQuestionIds();
    assert.strictEqual(new Set(ids).size, ids.length, '重複したIDがある');
  });

  test('クイズ: 各コースに10問以上ある', () => {
    QuizData.COURSES.forEach((course) => {
      const n = QuizData.questionsForCourse(course.id).length;
      assert.ok(n >= 10, `${course.id} の問題数が足りない: ${n}`);
    });
  });

  test('クイズ: 必須項目がすべて存在する', () => {
    const required = ['id', 'course', 'difficulty', 'prompt', 'board', 'choices', 'resolver', 'explanation', 'tags'];
    QuizData.QUESTIONS.forEach((q) => {
      required.forEach((key) => {
        assert.ok(q[key] !== undefined && q[key] !== null, `${q.id}: ${key} がない`);
      });
      assert.ok(Array.isArray(q.choices) && q.choices.length >= 2, `${q.id}: 選択肢が足りない`);
      assert.ok(Array.isArray(q.tags) && q.tags.length > 0, `${q.id}: 学習タグがない`);
      const choiceIds = q.choices.map((c) => c.id);
      assert.strictEqual(new Set(choiceIds).size, choiceIds.length, `${q.id}: 選択肢IDが重複`);
      assert.ok(QuizData.getCourse(q.course), `${q.id}: 未知のコース`);
    });
  });

  test('クイズ: 手牌の枚数が不正でない(手の中+副露で13枚)', () => {
    QuizData.QUESTIONS.forEach((q) => {
      const board = QuizEngine.normalizeBoard(q.board);
      const inHand = QuizEngine.concealedCounts(board, false).reduce((a, c) => a + c, 0);
      const total = inHand + board.fuuro.length * 3;
      assert.strictEqual(total, 13, `${q.id}: 手牌が13枚ではない(${total}枚)`);
    });
  });

  test('クイズ: 同一牌が5枚以上見えている問題は無い', () => {
    QuizData.QUESTIONS.forEach((q) => {
      const board = QuizEngine.normalizeBoard(q.board);
      const visible = QuizEngine.visibleCounts(board, true);
      for (let i = 0; i < Tiles.TILE_COUNT; i++) {
        assert.ok(visible[i] <= 4, `${q.id}: ${Tiles.shortLabel(i)} が${visible[i]}枚見えている`);
      }
    });
  });

  test('クイズ: すべての問題で「正解の選択肢」が1つ以上ある', () => {
    QuizData.QUESTIONS.forEach((q) => {
      const graded = QuizEngine.gradeQuestion(q, []);
      assert.ok(graded.correctIds.length >= 1, `${q.id}: 正解の選択肢が無い`);
      if (!q.multi) {
        assert.strictEqual(graded.correctIds.length, 1, `${q.id}: 単一選択なのに正解が複数ある`);
      }
    });
  });

  test('クイズ: 問題データの想定正解(expected)がエンジンの判定と一致する', () => {
    QuizData.QUESTIONS.forEach((q) => {
      const graded = QuizEngine.gradeQuestion(q, q.expected || []);
      assert.ok(
        graded.correct,
        `${q.id}: データの想定=[${(q.expected || []).join(',')}] / エンジン=[${graded.correctIds.join(',')}]`
      );
    });
  });

  // ==================================================
  // 役クイズ: 正解が役判定エンジンと一致する
  // ==================================================

  test('役クイズ: 出題の手牌はすべて和了形になっている', () => {
    QuizData.questionsForCourse('yaku').forEach((q) => {
      const board = QuizEngine.normalizeBoard(q.board);
      const counts14 = QuizEngine.concealedCounts(board, true);
      const shanten = Shanten.calcShanten(counts14, board.fuuro.length).shanten;
      assert.strictEqual(shanten, -1, `${q.id}: 和了形になっていない`);
    });
  });

  test('役クイズ: 正解の役キーが scoring.js の判定結果と一致する', () => {
    QuizData.questionsForCourse('yaku')
      .filter((q) => q.resolver === 'yakuKeys')
      .forEach((q) => {
        const board = QuizEngine.normalizeBoard(q.board);
        const engineKeys = new Set(QuizEngine.analyzeYaku(board).yakuKeys);
        const graded = QuizEngine.gradeQuestion(q, q.expected || []);
        q.choices.forEach((c) => {
          const shouldBeCorrect = engineKeys.has(c.value);
          const isCorrect = graded.correctIds.indexOf(c.id) !== -1;
          assert.strictEqual(isCorrect, shouldBeCorrect, `${q.id}: ${c.label} の正誤が役判定と食い違う`);
        });
      });
  });

  test('役クイズ: ドラだけでは役にならない(ドラを持っていても hasYaku=false)', () => {
    const q = QuizData.getQuestion('yaku-06');
    const board = QuizEngine.normalizeBoard(q.board);
    const analysis = QuizEngine.analyzeYaku(board);
    assert.strictEqual(analysis.hasYaku, false, 'ドラのみで役ありと判定された');
    assert.ok(analysis.doraTotal >= 1, 'ドラが1枚も無い問題になっている');
  });

  test('役クイズ: 場風でも自風でもない風牌の刻子は役牌にならない', () => {
    const board = QuizEngine.normalizeBoard(QuizData.getQuestion('yaku-05').board);
    assert.strictEqual(QuizEngine.isYakuhaiTile(30, 3, board), false, '北が役牌と判定された');
    const seatWindBoard = QuizEngine.normalizeBoard(QuizData.getQuestion('yaku-04').board);
    assert.strictEqual(QuizEngine.isYakuhaiTile(29, 3, seatWindBoard), true, '自風の西が役牌と判定されない');
  });

  test('役クイズ: 門前限定・食い下がりのメタ情報が scoring.js の食い下がり実装と矛盾しない', () => {
    // scoring.js の KUISAGARI は全て1翻減。門前限定の役は鳴いた手では成立しないことを実手で確認する。
    assert.strictEqual(QuizEngine.YAKU_META.iipeikou.naki, 'menzen-only');
    assert.strictEqual(QuizEngine.YAKU_META.honitsu.naki, 'kuisagari');

    const nakiHonitsu = QuizEngine.normalizeBoard(QuizData.getQuestion('yaku-10').board);
    const analysis = QuizEngine.analyzeYaku(nakiHonitsu);
    const honitsu = analysis.yakuList.find((y) => y.key === 'honitsu');
    assert.ok(honitsu, '鳴いた混一色が成立していない');
    assert.strictEqual(honitsu.han, QuizEngine.YAKU_META.honitsu.han - 1, '鳴いた混一色が食い下がっていない');
    assert.ok(!analysis.yakuKeys.includes('pinfu'), '鳴いた手で門前限定の平和が成立している');
  });

  // ==================================================
  // 待ち当てクイズ
  // ==================================================

  test('待ちクイズ: 正解が待ち計算(シャンテン数)の結果と一致する', () => {
    QuizData.questionsForCourse('wait')
      .filter((q) => q.resolver === 'waitTiles')
      .forEach((q) => {
        const board = QuizEngine.normalizeBoard(q.board);
        const counts13 = QuizEngine.concealedCounts(board, false);
        const engineWaits = new Set(QuizEngine.computeWinningTiles(counts13, board.fuuro.length));
        const graded = QuizEngine.gradeQuestion(q, q.expected || []);
        q.choices.forEach((c) => {
          const isCorrect = graded.correctIds.indexOf(c.id) !== -1;
          assert.strictEqual(isCorrect, engineWaits.has(c.value), `${q.id}: ${Tiles.shortLabel(c.value)} の正誤が待ち計算と食い違う`);
        });
      });
  });

  test('待ちクイズ: 待ちが無い問題・5枚目を要求する問題が生成されていない', () => {
    QuizData.questionsForCourse('wait').forEach((q) => {
      const board = QuizEngine.normalizeBoard(q.board);
      const waits = QuizEngine.analyzeWaits(board);
      assert.ok(waits.valid, `${q.id}: 待ちが1つも無い`);
      waits.tiles.forEach((t) => {
        assert.ok(t.remaining > 0, `${q.id}: ${t.label} の残り枚数が0(5枚目を要求している)`);
      });
    });
  });

  test('待ちクイズ: 残り枚数は「4枚 - 見えている枚数」で計算される', () => {
    const q = QuizData.getQuestion('wait-12');
    const board = QuizEngine.normalizeBoard(q.board);
    const waits = QuizEngine.analyzeWaits(board);
    const map = {};
    waits.tiles.forEach((t) => (map[t.label] = t.remaining));
    assert.strictEqual(map['2索'], 3, '2索: 河に1枚見えているので残り3枚のはず');
    assert.strictEqual(map['5索'], 1, '5索: 手牌2枚+河1枚が見えているので残り1枚のはず');
    assert.strictEqual(waits.totalRemaining, 4);
  });

  test('待ちクイズ: 待ちの形(両面・嵌張・辺張・双碰・単騎・七対子)が正しく分類される', () => {
    const cases = [
      ['234m456m789p34s55s', 'ryanmen'],
      ['123m456m789m22p35s', 'kanchan'],
      ['123m456m789m22p12s', 'penchan'],
      ['123m456m789m22p55s', 'shanpon'],
      ['123m456m789m234p5s', 'tanki'],
      ['11m44m77m22p55p33s9s', 'chiitoitsu'],
    ];
    cases.forEach(([hand, expectedType]) => {
      const board = QuizEngine.normalizeBoard({ hand: parse(hand) });
      const counts13 = QuizEngine.concealedCounts(board, false);
      const waits = QuizEngine.computeWinningTiles(counts13, 0);
      const types = new Set();
      waits.forEach((t) => QuizEngine.waitDetailForTile(counts13, t, 0).types.forEach((x) => types.add(x)));
      assert.ok(types.has(expectedType), `${hand}: ${expectedType} と判定されない(${[...types].join(',')})`);
    });
  });

  // ==================================================
  // フリテンクイズ
  // ==================================================

  test('フリテン: 複数待ちのうち1種類でも自分の河にあれば、待ち全体でロンできない', () => {
    const q = QuizData.getQuestion('furiten-04'); // 待ち1索・4索・7索、河に7索
    const board = QuizEngine.normalizeBoard(q.board);
    const analysis = QuizEngine.analyzeFuriten(board);
    assert.deepStrictEqual(
      analysis.waitTiles.map((t) => Tiles.shortLabel(t)).sort(),
      ['1索', '4索', '7索'].sort()
    );
    assert.strictEqual(analysis.isFuriten, true, 'フリテンと判定されていない');
    // 河にある7索だけでなく、1索・4索でもロンできないこと
    analysis.waitTiles.forEach((tile) => {
      const withWin = QuizEngine.normalizeBoard(Object.assign({}, q.board, { winTile: tile, isTsumo: false }));
      assert.strictEqual(QuizEngine.analyzeFuriten(withWin).canRon, false, `${Tiles.shortLabel(tile)} でロンできてしまう`);
    });
  });

  test('フリテン: フリテンでもツモならアガれる', () => {
    const q = QuizData.getQuestion('furiten-04');
    const analysis = QuizEngine.analyzeFuriten(
      QuizEngine.normalizeBoard(Object.assign({}, q.board, { winTile: parse('1s')[0], isTsumo: true }))
    );
    assert.strictEqual(analysis.isFuriten, true);
    assert.strictEqual(analysis.canTsumo, true, 'フリテンでツモまで禁止されている');
  });

  test('フリテン: 同巡内フリテン(河に当たり牌が無くてもロン不可・ツモ可)', () => {
    const q = QuizData.getQuestion('furiten-06');
    const board = QuizEngine.normalizeBoard(q.board);
    const analysis = QuizEngine.analyzeFuriten(board);
    assert.strictEqual(analysis.furitenType, 'temporary', '同巡内フリテンとして扱われていない');
    assert.strictEqual(analysis.blockingOwnDiscards.length, 0, '河に当たり牌がある問題になっている');
    assert.strictEqual(analysis.canRon, false, '同巡内フリテンでロンできてしまう');
    assert.strictEqual(analysis.ronBlockReason, 'furiten');
    const tsumo = QuizEngine.analyzeFuriten(QuizEngine.normalizeBoard(Object.assign({}, q.board, { isTsumo: true })));
    assert.strictEqual(tsumo.canTsumo, true, '同巡内フリテンでツモまで禁止されている');
  });

  test('フリテン: リーチ後の見逃し(永続フリテン)はロン不可・ツモ可', () => {
    const q = QuizData.getQuestion('furiten-09');
    const analysis = QuizEngine.analyzeFuriten(QuizEngine.normalizeBoard(q.board));
    assert.strictEqual(analysis.furitenType, 'riichi', 'リーチ後フリテンとして扱われていない');
    assert.strictEqual(analysis.canRon, false);
    const tsumo = QuizEngine.analyzeFuriten(
      QuizEngine.normalizeBoard(Object.assign({}, q.board, { winTile: parse('5s')[0], isTsumo: true }))
    );
    assert.strictEqual(tsumo.canTsumo, true);
  });

  test('フリテン: 役なしとフリテンを区別して理由を返す', () => {
    const noYaku = QuizEngine.analyzeFuriten(QuizEngine.normalizeBoard(QuizData.getQuestion('furiten-12').board));
    assert.strictEqual(noYaku.isFuriten, false, 'フリテンではないのにフリテン扱いされている');
    assert.strictEqual(noYaku.ronBlockReason, 'no-yaku');
    assert.strictEqual(noYaku.canTsumo, false, '役が無いのにツモアガリできてしまう');

    const both = QuizEngine.analyzeFuriten(QuizEngine.normalizeBoard(QuizData.getQuestion('furiten-13').board));
    assert.strictEqual(both.ronBlockReason, 'furiten-and-no-yaku');

    const ok = QuizEngine.analyzeFuriten(QuizEngine.normalizeBoard(QuizData.getQuestion('furiten-14').board));
    assert.strictEqual(ok.canRon, true, '普通にロンできる手でロンできないと判定された');
    assert.strictEqual(ok.ronBlockReason, 'none');
  });

  // ==================================================
  // 現物クイズ
  // ==================================================

  test('現物: リーチ者本人の河を基準に判定される(他家の河だけでは現物にならない)', () => {
    const q = QuizData.getQuestion('genbutsu-03');
    const board = QuizEngine.normalizeBoard(q.board);
    const result = QuizEngine.analyzeGenbutsu(board, q.candidates);
    const byLabel = {};
    result.candidates.forEach((c) => (byLabel[c.label] = c));
    assert.strictEqual(byLabel['2筒'].isGenbutsu, true, 'リーチ者自身の捨て牌が現物になっていない');
    assert.strictEqual(byLabel['3索'].isGenbutsu, true);
    assert.strictEqual(byLabel['6筒'].isGenbutsu, false, '他家が捨てただけの牌が現物にされている');
    assert.strictEqual(byLabel['9筒'].isGenbutsu, false);
  });

  test('現物: リーチ宣言後に他家が捨てて通った牌は現物になる', () => {
    const q = QuizData.getQuestion('genbutsu-04');
    const result = QuizEngine.analyzeGenbutsu(QuizEngine.normalizeBoard(q.board), q.candidates);
    const seven = result.candidates.find((c) => c.label === '7筒');
    assert.strictEqual(seven.isGenbutsu, true, 'リーチ後に通った牌が現物になっていない');
    assert.strictEqual(seven.matchedFrom.kind, 'passed-after-riichi');
  });

  test('現物: 赤5と通常の5を同じ牌種として扱う', () => {
    const q = QuizData.getQuestion('genbutsu-05'); // 下家が通常の5萬を捨てている / 手牌の5萬は赤5
    const result = QuizEngine.analyzeGenbutsu(QuizEngine.normalizeBoard(q.board), q.candidates);
    const aka = result.candidates.find((c) => c.aka);
    assert.ok(aka, '赤5の候補が無い');
    assert.strictEqual(aka.label, '5萬');
    assert.strictEqual(aka.isGenbutsu, true, '赤5が通常の5と別扱いされている');

    // 逆に、リーチ者が捨てていなければ赤5でも現物にならない
    const q2 = QuizData.getQuestion('genbutsu-12');
    const result2 = QuizEngine.analyzeGenbutsu(QuizEngine.normalizeBoard(q2.board), q2.candidates);
    const aka2 = result2.candidates.find((c) => c.aka);
    assert.strictEqual(aka2.isGenbutsu, false, '対象者が捨てていない赤5が現物にされている');
  });

  test('現物: 対象プレイヤーが変われば現物も変わる(2人リーチ)', () => {
    const q1 = QuizData.getQuestion('genbutsu-07'); // 下家に対する現物
    const q2 = QuizData.getQuestion('genbutsu-11'); // 同じ場面で対面に対する現物
    const r1 = QuizEngine.analyzeGenbutsu(QuizEngine.normalizeBoard(q1.board), q1.candidates);
    const r2 = QuizEngine.analyzeGenbutsu(QuizEngine.normalizeBoard(q2.board), q2.candidates);
    const safe1 = r1.candidates.filter((c) => c.isGenbutsu).map((c) => c.label).sort();
    const safe2 = r2.candidates.filter((c) => c.isGenbutsu).map((c) => c.label).sort();
    assert.deepStrictEqual(safe1, ['2筒', '5索'].sort());
    assert.deepStrictEqual(safe2, ['5筒', '2索'].sort());
    // 片方に対する現物が、もう片方にも安全とは限らないこと
    const twoP = r1.candidates.find((c) => c.label === '2筒');
    assert.ok(twoP.dangerAgainst.length > 0, '2人リーチでの危険側の情報が出ていない');
  });

  // ==================================================
  // 出題制御
  // ==================================================

  function seededRng(seed) {
    let s = seed;
    return function () {
      s = (s * 1103515245 + 12345) % 2147483648;
      return s / 2147483648;
    };
  }

  test('出題: 10問出題され、同じ挑戦の中で問題が重複しない', () => {
    QuizData.COURSES.forEach((course) => {
      const session = QuizSession.createSession(course.id, { rng: seededRng(7) });
      assert.strictEqual(session.questions.length, 10, `${course.id}: 10問出題されていない`);
      const ids = session.questions.map((q) => q.id);
      assert.strictEqual(new Set(ids).size, ids.length, `${course.id}: 同じ問題が重複して出題された`);
    });
  });

  test('出題: 順番がランダム化される', () => {
    const a = QuizSession.createSession('yaku', { rng: seededRng(1) }).questions.map((q) => q.id).join(',');
    const b = QuizSession.createSession('yaku', { rng: seededRng(999) }).questions.map((q) => q.id).join(',');
    assert.notStrictEqual(a, b, '毎回同じ順番で出題されている');
  });

  test('出題: 間違えた問題だけを復習できる', () => {
    const wrong = ['wait-02', 'wait-05', 'wait-07'];
    const session = QuizSession.createSession('wait', { questionIds: wrong });
    assert.strictEqual(session.mode, 'review');
    assert.strictEqual(session.questions.length, 3);
    session.questions.forEach((q) => assert.ok(wrong.includes(q.id), '復習対象以外が出題された'));
  });

  test('出題: 存在しない問題IDが復習対象に残っていてもエラーにならない', () => {
    const session = QuizSession.createSession('wait', { questionIds: ['deleted-question-id'] });
    assert.ok(session.questions.length > 0, '出題が空になった');
    session.questions.forEach((q) => assert.strictEqual(q.course, 'wait'));
  });

  test('出題: 回答→採点→次の問題→結果まで進められる', () => {
    const session = QuizSession.createSession('genbutsu', { rng: seededRng(3) });
    while (!session.finished) {
      const q = QuizSession.currentQuestion(session);
      const record = QuizSession.answerCurrent(session, q.expected || []);
      assert.strictEqual(record.correct, true, `${q.id}: 想定正解で不正解になった`);
      QuizSession.goNext(session);
    }
    const summary = QuizSession.summarize(session);
    assert.strictEqual(summary.total, 10);
    assert.strictEqual(summary.correct, 10);
    assert.strictEqual(summary.rate, 100);
    assert.strictEqual(summary.wrongQuestionIds.length, 0);
    assert.ok(summary.comment.length > 0);
  });

  test('出題: 間違えると学習タグが結果にまとまる', () => {
    const session = QuizSession.createSession('furiten', { rng: seededRng(11) });
    const q = QuizSession.currentQuestion(session);
    const wrongChoice = q.choices.find((c) => (q.expected || []).indexOf(c.id) === -1);
    QuizSession.answerCurrent(session, [wrongChoice.id]);
    QuizSession.goNext(session);
    const summary = QuizSession.summarize(session);
    assert.strictEqual(summary.correct, 0);
    assert.ok(summary.wrongQuestionIds.includes(q.id));
    assert.ok(summary.wrongTags.length > 0, '間違えた問題の学習タグが出ていない');
    assert.ok(summary.comment.indexOf('苦手') >= 0 || summary.comment.indexOf('つまずいて') >= 0);
  });

  // ==================================================
  // 学習履歴(localStorage)
  // ==================================================

  function withFakeLocalStorage(initial, fn) {
    const store = Object.assign({}, initial || {});
    const fake = {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setItem: (k, v) => {
        store[k] = String(v);
      },
      removeItem: (k) => {
        delete store[k];
      },
    };
    const had = Object.prototype.hasOwnProperty.call(globalThis, 'localStorage');
    const prev = globalThis.localStorage;
    globalThis.localStorage = fake;
    try {
      fn(store);
    } finally {
      if (had) globalThis.localStorage = prev;
      else delete globalThis.localStorage;
    }
  }

  test('履歴: 既存の保存データ(復習帳・牌譜・成績・レッスン)を壊さない', () => {
    const existing = {
      'mahjong-trainer-review-v1': '{"keep":1}',
      'mahjong-trainer-kifu-v1': '[{"keep":true}]',
      'mahjong-trainer-stats-v1': '{"games":3}',
      'mahjong-trainer-lessons-v1': '{"version":1,"lessons":{}}',
    };
    withFakeLocalStorage(existing, (store) => {
      QuizStats.recordAttempt('yaku', [{ questionId: 'yaku-01', correct: true, tags: ['riichi'] }]);
      QuizStats.resetAll();
      Object.keys(existing).forEach((key) => {
        assert.strictEqual(store[key], existing[key], `${key} が書き換えられた`);
      });
    });
  });

  test('履歴: コース別の挑戦回数・正解数・総回答数・最終挑戦日時・間違えた問題IDを保存する', () => {
    withFakeLocalStorage({}, () => {
      QuizStats.recordAttempt('wait', [
        { questionId: 'wait-01', correct: true, tags: ['ryanmen'] },
        { questionId: 'wait-02', correct: false, tags: ['kanchan'] },
      ]);
      const stats = QuizStats.courseStats('wait');
      assert.strictEqual(stats.attempts, 1);
      assert.strictEqual(stats.answered, 2);
      assert.strictEqual(stats.correct, 1);
      assert.strictEqual(QuizStats.accuracy(stats), 50);
      assert.ok(stats.lastAt, '最終挑戦日時が保存されていない');
      assert.deepStrictEqual(stats.wrongQuestionIds, ['wait-02']);

      const tags = QuizStats.tagStats();
      assert.deepStrictEqual(tags.ryanmen, { correct: 1, wrong: 0 });
      assert.deepStrictEqual(tags.kanchan, { correct: 0, wrong: 1 });

      // 正解し直すと復習リストから消える
      QuizStats.recordAttempt('wait', [{ questionId: 'wait-02', correct: true, tags: ['kanchan'] }]);
      assert.deepStrictEqual(QuizStats.courseStats('wait').wrongQuestionIds, []);
    });
  });

  test('履歴: 問題データから消えたIDが保存されていてもエラーにならない', () => {
    withFakeLocalStorage({}, () => {
      QuizStats.recordAttempt('yaku', [
        { questionId: 'yaku-01', correct: false, tags: ['riichi'] },
        { questionId: 'removed-question', correct: false, tags: ['riichi'] },
      ]);
      const ids = QuizData.questionsForCourse('yaku').map((q) => q.id);
      const reviewable = QuizStats.wrongQuestionIds('yaku', ids);
      assert.deepStrictEqual(reviewable, ['yaku-01'], '存在しないIDが復習対象に残っている');
      const session = QuizSession.createSession('yaku', { questionIds: reviewable });
      assert.strictEqual(session.questions.length, 1);
    });
  });

  test('履歴: 壊れたデータが入っていても空の履歴として扱う', () => {
    withFakeLocalStorage({ 'mahjong-trainer-quiz-v1': 'not-json' }, () => {
      const store = QuizStats.load();
      assert.deepStrictEqual(store.courses, {});
      const stats = QuizStats.courseStats('yaku');
      assert.strictEqual(stats.attempts, 0);
      assert.strictEqual(QuizStats.accuracy(stats), null);
    });
  });

  test('履歴: localStorageが使えない環境(プライベートモード等)でも例外を投げない', () => {
    // 保存も読み込みも例外を投げるストレージを差し込み、アプリ側が落ちないことを確認する
    const prev = globalThis.localStorage;
    globalThis.localStorage = {
      getItem: () => {
        throw new Error('access denied');
      },
      setItem: () => {
        throw new Error('quota exceeded');
      },
      removeItem: () => {
        throw new Error('access denied');
      },
    };
    try {
      const store = QuizStats.load();
      assert.deepStrictEqual(store.courses, {});
      assert.strictEqual(QuizStats.save({ version: 1, courses: {}, tags: {} }), false);
      assert.strictEqual(QuizStats.resetAll(), false);
      assert.strictEqual(QuizStats.courseStats('yaku').attempts, 0);
      // 記録しようとしても例外にならない
      QuizStats.recordAttempt('yaku', [{ questionId: 'yaku-01', correct: true, tags: ['riichi'] }]);
    } finally {
      if (prev === undefined) delete globalThis.localStorage;
      else globalThis.localStorage = prev;
    }
  });

  // ==================================================
  // 表示用の読み方(カタカナ)
  // ==================================================

  test('用語: 重要な麻雀用語にカタカナの読みが用意されている', () => {
    ['立直', '断么九', '平和', '役牌', '両面待ち', '嵌張待ち', '辺張待ち', '双碰待ち', '単騎待ち', '現物', '河', '門前', '翻'].forEach(
      (term) => {
        assert.ok(QuizEngine.TERM_READINGS[term], `${term} の読みが無い`);
        assert.ok(QuizEngine.withReading(term).indexOf('(') > 0, `${term} の表示に読みが付かない`);
      }
    );
    assert.strictEqual(QuizEngine.yakuDisplayName('chiitoitsu', '七対子'), '七対子(チートイツ)');
  });
};
