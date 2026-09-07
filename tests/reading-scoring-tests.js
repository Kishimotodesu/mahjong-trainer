/**
 * tests/reading-scoring-tests.js
 * 「相手の待ち読み」の採点モード(V1.9.1)のテスト。
 *
 * 目的は「採点の意味がぶれないこと」の保証。
 *  - 危険牌を選ぶ問題(reasoning-only)で、待ちの的中・不的中を採点しないこと
 *  - その問題が待ち的中の分母に入らないこと
 *  - hit-any / hit-coverage が、構造的に達成できる採点になっていること
 *  - 2人リーチで「誰を読む問題か」が画面の文言としてはっきりしていること
 */
module.exports = function ({ test, assert, Tiles, Reading, QuizData, QuizEngine, QuizSession, QuizStats }) {
  const questions = QuizData.questionsForCourse('reading');

  const hitAnyQuestions = questions.filter((q) => q.scoring === 'hit-any');
  const coverageQuestions = questions.filter((q) => q.scoring === 'hit-coverage');
  const reasoningOnlyQuestions = questions.filter((q) => q.scoring === 'reasoning-only');
  const scoredQuestions = questions.filter((q) => Reading.isWaitScored(q.scoring));

  function waitsOf(question) {
    return QuizEngine.hiddenWaits(question.hidden);
  }
  function candidateTiles(question) {
    return (question.candidates || []).map((c) => (typeof c === 'number' ? c : c.tile));
  }
  function choiceIdsForTiles(question, tiles) {
    return question.choices.filter((c) => tiles.indexOf(c.value) !== -1).map((c) => c.id);
  }
  function withFakeStorage(fn) {
    const prev = globalThis.localStorage;
    const store = {};
    globalThis.localStorage = {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setItem: (k, v) => {
        store[k] = String(v);
      },
      removeItem: (k) => {
        delete store[k];
      },
    };
    try {
      return fn(store);
    } finally {
      if (prev === undefined) delete globalThis.localStorage;
      else globalThis.localStorage = prev;
    }
  }

  // ==================================================
  // 採点モードの割り当て
  // ==================================================

  test('採点モード: 全35問に採点モードがあり、3種類のいずれかである', () => {
    assert.strictEqual(questions.length, 35, '問題数が変わっている');
    questions.forEach((q) => {
      assert.ok(q.scoring, `${q.id}: 採点モードが無い`);
      assert.ok(Reading.SCORING_KEYS.indexOf(q.scoring) !== -1, `${q.id}: 未知の採点モード ${q.scoring}`);
      // エンジン側でも同じ値が読めること(書き忘れは例外になる)
      assert.strictEqual(QuizEngine.scoringOf(q), q.scoring);
    });
    assert.ok(reasoningOnlyQuestions.length > 0, 'reasoning-only の問題が無い');
    assert.ok(hitAnyQuestions.length > 0, 'hit-any の問題が無い');
    assert.ok(coverageQuestions.length > 0, 'hit-coverage の問題が無い');
    assert.strictEqual(
      reasoningOnlyQuestions.length + hitAnyQuestions.length + coverageQuestions.length,
      questions.length
    );
  });

  test('採点モード: 問題文と採点方法が矛盾しない', () => {
    questions.forEach((q) => {
      const prompt = q.prompt;
      const isWaitPrediction = prompt.indexOf('待ちを予想') >= 0 || prompt.indexOf('待っている可能性') >= 0;
      if (Reading.isWaitScored(q.scoring)) {
        assert.ok(isWaitPrediction, `${q.id}: 待ちを予想する問題文ではないのに待ち的中を採点している`);
      } else {
        assert.ok(!isWaitPrediction, `${q.id}: 待ちを予想する問題文なのに採点していない`);
      }
      // 説明を選ぶ形式は必ず reasoning-only
      if (q.resolver === 'readingStatements') assert.strictEqual(q.scoring, 'reasoning-only', `${q.id}`);
      // 解説の文言も採点方法と食い違わない
      if (q.scoring !== 'hit-coverage') {
        assert.ok(q.explanation.indexOf('一部的中') === -1, `${q.id}: 一部的中が出ない問題の解説に「一部的中」がある`);
      }
      if (q.scoring === 'hit-any') {
        assert.ok(q.explanation.indexOf('1種類でも') >= 0, `${q.id}: 1種類でも的中になる説明が無い`);
      }
    });
  });

  // ==================================================
  // reasoning-only
  // ==================================================

  test('採点モード: reasoning-only では待ち的中を採点しない', () => {
    reasoningOnlyQuestions.forEach((q) => {
      const graded = QuizEngine.gradeQuestion(q, q.expected);
      assert.strictEqual(graded.hit, null, `${q.id}: 待ち的中を採点している`);
      assert.strictEqual(graded.waitScored, false, `${q.id}: waitScored が true になっている`);
      assert.ok(graded.scoringNote.indexOf('採点しません') >= 0, `${q.id}: 採点しない旨の文言が無い`);
      if (q.mode === 'reading') {
        // 推理評価は通常どおり付く(採点そのものが消えるわけではない)
        assert.ok(graded.reasoning, `${q.id}: 推理評価が無い`);
        // 参考表示のために、実際の待ちは計算されている
        assert.ok(graded.actualWaits.length > 0, `${q.id}: 参考表示用の待ちが無い`);
      }
    });
    // 推理が◎でも、待ちを持っていないことで「不的中」と表示されることはない
    const q = QuizData.getQuestion('reading-01');
    const graded = QuizEngine.gradeQuestion(q, q.expected);
    assert.strictEqual(graded.reasoning.gradeKey, 'excellent');
    assert.strictEqual(graded.hit, null, '推理が◎なのに不的中が表示されてしまう');
  });

  test('採点モード: reasoning-only は待ち的中成績の分母に入らない', () => {
    withFakeStorage(() => {
      // reading-01・reading-05 は reasoning-only、reading-09 は hit-coverage
      const session = QuizSession.createSession('reading', { questionIds: ['reading-01', 'reading-05', 'reading-09'] });
      while (!session.finished) {
        const q = QuizSession.currentQuestion(session);
        QuizSession.answerCurrent(session, q.expected);
        QuizSession.goNext(session);
      }
      const summary = QuizSession.summarize(session);
      assert.strictEqual(summary.readingAnswered, 3, '推理評価は3問とも数える');
      assert.strictEqual(summary.hitAnswered, 1, '待ちを採点した問題数が合わない');
      assert.strictEqual(summary.reasoningOnlyAnswered, 2, '採点しなかった問題数が合わない');

      QuizStats.recordAttempt(
        'reading',
        summary.results.map((r) => ({
          questionId: r.questionId,
          correct: r.correct,
          tags: r.tags,
          difficulty: r.difficulty,
          scoring: r.scoring,
          reasoning: r.reasoning,
          hit: r.hit,
        }))
      );
      const reading = QuizStats.readingStats('reading');
      assert.strictEqual(reading.reasoningTotal, 3, '推理評価の件数が合わない');
      assert.strictEqual(reading.hitTotal, 1, '待ち的中の分母に reasoning-only が入っている');
      assert.strictEqual(reading.reasoningOnlyTotal, 2, '採点しなかった問題数が合わない');
    });
  });

  // ==================================================
  // hit-any
  // ==================================================

  test('採点モード: hit-any は1種類でも当たれば的中になる', () => {
    hitAnyQuestions.forEach((q) => {
      const waits = waitsOf(q);
      const choiceValues = q.choices.map((c) => c.value);
      const reachable = waits.filter((w) => choiceValues.indexOf(w) !== -1);

      // 1種類だけ選んだ場合でも「的中」(一部的中にはしない)
      const one = Reading.matchWaits([reachable[0]], waits, 'hit-any');
      assert.strictEqual(one.levelKey, 'hit', `${q.id}: 1種類当てても的中にならない`);
      assert.ok(one.level.label.indexOf('すべて') === -1, `${q.id}: 「すべて」を求める文言になっている`);

      // 待ちを1種類も含まなければ不的中
      const none = Reading.matchWaits(choiceValues.filter((c) => waits.indexOf(c) === -1), waits, 'hit-any');
      assert.strictEqual(none.levelKey, 'miss', `${q.id}: 全部外しても不的中にならない`);

      // 出題データを通した採点でも同じ結果になる
      const graded = QuizEngine.gradeQuestion(q, choiceIdsForTiles(q, [reachable[0]]));
      assert.strictEqual(graded.hit.levelKey, 'hit', `${q.id}: 出題データでは的中にならない`);
      assert.notStrictEqual(graded.hit.levelKey, 'partial', `${q.id}: hit-any で一部的中が出ている`);
    });
  });

  test('採点モード: hit-any の候補には実際の待ちが最低1種類ある', () => {
    hitAnyQuestions.forEach((q) => {
      const waits = waitsOf(q);
      const cands = candidateTiles(q);
      const choiceValues = q.choices.map((c) => c.value);
      const reachable = waits.filter((w) => cands.indexOf(w) !== -1 && choiceValues.indexOf(w) !== -1);
      assert.ok(reachable.length >= 1, `${q.id}: 待ちを選べる候補が1つも無い(構造的に的中不可能)`);
      assert.ok(q.selectCount >= 1, `${q.id}: 選択上限が0`);
    });
  });

  // ==================================================
  // hit-coverage
  // ==================================================

  test('採点モード: hit-coverage は全待ちを選択でき、選択上限も足りている', () => {
    coverageQuestions.forEach((q) => {
      const waits = waitsOf(q);
      const choiceValues = q.choices.map((c) => c.value);
      waits.forEach((w) => {
        assert.ok(choiceValues.indexOf(w) !== -1, `${q.id}: 実際の待ち ${Tiles.shortLabel(w)} が選択肢に無い`);
      });
      assert.ok(
        q.selectCount >= waits.length,
        `${q.id}: 選択上限(${q.selectCount})が待ちの種類数(${waits.length})より少ない`
      );
      // 実際に全部選べば的中になる
      const all = choiceIdsForTiles(q, waits);
      assert.strictEqual(all.length, waits.length, `${q.id}: 全待ちを選ぶ選択肢がそろっていない`);
      assert.strictEqual(QuizEngine.gradeQuestion(q, all).hit.levelKey, 'hit', `${q.id}: 全待ちを選んでも的中にならない`);
    });
  });

  test('採点モード: hit-coverage の全的中・一部的中・不的中が正しく分かれる', () => {
    const multi = coverageQuestions.find((q) => waitsOf(q).length >= 2);
    assert.ok(multi, '複数待ちの hit-coverage 問題が無い');
    const waits = waitsOf(multi);
    assert.strictEqual(Reading.matchWaits(waits, waits, 'hit-coverage').levelKey, 'hit');
    assert.strictEqual(Reading.matchWaits([waits[0]], waits, 'hit-coverage').levelKey, 'partial');
    assert.strictEqual(Reading.matchWaits([], waits, 'hit-coverage').levelKey, 'miss');

    // 出題データを通しても同じ(一部だけ選べば一部的中)
    assert.strictEqual(QuizEngine.gradeQuestion(multi, choiceIdsForTiles(multi, [waits[0]])).hit.levelKey, 'partial');
    assert.strictEqual(QuizEngine.gradeQuestion(multi, choiceIdsForTiles(multi, waits)).hit.levelKey, 'hit');

    // 待ちを1つも含まない選び方は不的中
    const noWaitIds = multi.choices.filter((c) => waits.indexOf(c.value) === -1).map((c) => c.id);
    if (noWaitIds.length > 0) {
      assert.strictEqual(QuizEngine.gradeQuestion(multi, noWaitIds).hit.levelKey, 'miss');
    }
  });

  test('採点モード: 選択上限のせいで完全的中できない問題が無い', () => {
    scoredQuestions.forEach((q) => {
      const waits = waitsOf(q);
      const choiceValues = q.choices.map((c) => c.value);
      const reachable = waits.filter((w) => choiceValues.indexOf(w) !== -1);
      if (q.scoring === 'hit-coverage') {
        assert.strictEqual(reachable.length, waits.length, `${q.id}: 選べない待ちがあるのに hit-coverage`);
        assert.ok(q.selectCount >= waits.length, `${q.id}: 上限が足りないのに hit-coverage`);
      } else {
        assert.ok(reachable.length >= 1, `${q.id}: 的中がそもそも不可能`);
      }
      // どのモードでも「選択上限の中で最高評価(的中)に届く」こと
      const best = q.scoring === 'hit-coverage' ? waits : [reachable[0]];
      assert.ok(best.length <= q.selectCount, `${q.id}: 的中に必要な選択数が上限を超える`);
      assert.strictEqual(QuizEngine.gradeQuestion(q, choiceIdsForTiles(q, best)).hit.levelKey, 'hit', `${q.id}: 上限内で的中に届かない`);
    });
  });

  // ==================================================
  // 表示文言・2人リーチ
  // ==================================================

  test('採点モード: 画面に出す文言が採点方法と一致する', () => {
    const only = QuizData.getQuestion('reading-01');
    assert.ok(Reading.scoringNote(only.scoring).indexOf('待ちの的中・不的中は採点しません') >= 0);
    assert.ok(Reading.scoringLabel(only.scoring).indexOf('推理評価のみ') >= 0);

    const any = QuizData.getQuestion('reading-03');
    assert.ok(Reading.scoringNote(any.scoring).indexOf('1種類でも') >= 0);
    assert.ok(Reading.scoringLabel(any.scoring).indexOf('1種類でも') >= 0);

    const cov = QuizData.getQuestion('reading-09');
    assert.ok(Reading.scoringNote(cov.scoring).indexOf('すべて選べていれば') >= 0);
    assert.ok(Reading.scoringLabel(cov.scoring).indexOf('すべて') >= 0);

    // 採点しない問題では、そもそも的中の判定結果を作らない
    const graded = QuizEngine.gradeQuestion(only, only.expected);
    assert.strictEqual(graded.hit, null);
    assert.strictEqual(graded.scoringNote, Reading.scoringNote('reasoning-only'));

    // 説明を選ぶ形式も採点モードの情報を持つ(画面で参考表示に切り替えるため)
    const statement = QuizData.getQuestion('reading-02');
    const gradedStatement = QuizEngine.gradeQuestion(statement, statement.expected);
    assert.strictEqual(gradedStatement.scoring, 'reasoning-only');
    assert.strictEqual(gradedStatement.hit, null);
  });

  test('採点モード: 2人リーチでは読む相手と公開する手牌がはっきりしている', () => {
    const twoRiichi = questions.filter(
      (q) => QuizEngine.normalizeBoard(q.board).players.filter((p) => p.riichi).length >= 2
    );
    assert.ok(twoRiichi.length >= 2, '2人リーチの問題が足りない');
    twoRiichi.forEach((q) => {
      const focus = QuizEngine.readingFocus(q);
      assert.ok(focus.multiRiichi, `${q.id}: 2人リーチと認識されていない`);
      assert.ok(focus.headline.indexOf('今回読む相手') >= 0, `${q.id}: 読む相手の見出しが無い`);

      const text = focus.lines.join(' ');
      assert.ok(text.indexOf('推理評価の対象') >= 0, `${q.id}: 推理評価の対象者が書かれていない`);
      assert.ok(text.indexOf('現物') >= 0 && text.indexOf('筋') >= 0, `${q.id}: 現物・筋の対象者が書かれていない`);
      assert.ok(text.indexOf('公開する手牌') >= 0, `${q.id}: 公開する手牌の持ち主が書かれていない`);
      assert.ok(text.indexOf('待ち的中') >= 0, `${q.id}: 待ち的中の扱いが書かれていない`);
      assert.ok(text.indexOf('2人全員の待ちを当てる問題ではありません') >= 0, `${q.id}: 誤解を防ぐ注意書きが無い`);

      // 読む相手と公開する手牌の持ち主が食い違う問題では、公開する側の名前で表示する
      const board = QuizEngine.normalizeBoard(q.board);
      const hiddenSeat = q.hidden.seat === undefined ? board.targetSeat : q.hidden.seat;
      const owner = board.players.find((p) => p.seat === hiddenSeat);
      assert.ok(text.indexOf(owner.label + 'の手牌です') >= 0, `${q.id}: 公開する手牌の持ち主が正しくない`);
      if (hiddenSeat !== board.targetSeat) {
        assert.strictEqual(q.scoring, 'reasoning-only', `${q.id}: 別人の手牌で待ち的中を採点している`);
      }
    });

    // 対面を読む問題(reading-17)で公開されるのは下家の手牌
    const q17 = QuizData.getQuestion('reading-17');
    const focus17 = QuizEngine.readingFocus(q17);
    assert.strictEqual(focus17.targetLabel, '対面');
    assert.ok(focus17.lines.some((l) => l.indexOf('下家の手牌です') >= 0), '公開する手牌が下家だと書かれていない');
    assert.ok(focus17.lines.some((l) => l.indexOf('待ち的中: この問題では採点しません') >= 0));
  });

  // ==================================================
  // 学習履歴の移行・既存機能
  // ==================================================

  test('採点モード: 既存の履歴を壊さず、待ち的中の集計だけを移行する', () => {
    withFakeStorage((store) => {
      // V1.9(version 1)の保存データ
      store['mahjong-trainer-quiz-v1'] = JSON.stringify({
        version: 1,
        courses: {
          reading: {
            attempts: 3,
            correct: 21,
            answered: 30,
            lastAt: '2026-01-01T00:00:00.000Z',
            wrongQuestionIds: ['reading-09'],
            byDifficulty: { beginner: { correct: 8, answered: 10 } },
            reasoning: { excellent: 15, good: 9, needsWork: 6 },
            hit: { hit: 10, partial: 8, miss: 12 },
          },
          yaku: { attempts: 1, correct: 9, answered: 10, lastAt: null, wrongQuestionIds: ['yaku-03'] },
        },
        tags: { 'reading-suji': { correct: 4, wrong: 2 } },
      });

      const stats = QuizStats.courseStats('reading');
      // 挑戦回数・正答数・復習帳・難易度別・推理評価はそのまま残る
      assert.strictEqual(stats.attempts, 3);
      assert.strictEqual(stats.correct, 21);
      assert.strictEqual(stats.answered, 30);
      assert.deepStrictEqual(stats.wrongQuestionIds, ['reading-09']);
      assert.strictEqual(stats.byDifficulty.beginner.answered, 10);
      assert.strictEqual(stats.reasoning.excellent, 15);

      // 待ち的中は採点方法が変わったので、古い値を残したまま新方式で数え直す
      assert.strictEqual(stats.hit.hit + stats.hit.partial + stats.hit.miss, 0, '古い集計が新しい成績に混ざっている');
      assert.ok(stats.hitLegacy, '古い集計が削除されている');
      assert.strictEqual(stats.hitLegacy.hit, 10);
      assert.strictEqual(stats.hitLegacy.miss, 12);

      const reading = QuizStats.readingStats('reading');
      assert.strictEqual(reading.hitTotal, 0);
      assert.strictEqual(reading.hitRate, null);
      assert.strictEqual(reading.reasoningTotal, 30);
      assert.ok(reading.legacyHit, '古い集計が readingStats から見えない');

      // 他コースとタグも無事
      assert.strictEqual(QuizStats.courseStats('yaku').correct, 9);
      assert.strictEqual(QuizStats.tagStats()['reading-suji'].correct, 4);

      // 新方式で1回記録すると、保存形式が version 2 になる
      QuizStats.recordAttempt('reading', [
        { questionId: 'reading-09', correct: true, tags: [], difficulty: 'practical', reasoning: 'excellent', hit: 'hit' },
        { questionId: 'reading-01', correct: true, tags: [], difficulty: 'beginner', reasoning: 'excellent', hit: null },
      ]);
      assert.strictEqual(QuizStats.load().version, 2);
      assert.strictEqual(QuizStats.readingStats('reading').hitTotal, 1, '新方式の集計が始まっていない');
      assert.strictEqual(QuizStats.courseStats('reading').attempts, 4);
      assert.strictEqual(QuizStats.courseStats('reading').hitLegacy.hit, 10, '移行後に古い集計が消えた');
    });
  });

  test('採点モード: 既存6コースが今までどおり採点できる', () => {
    const courses = ['yaku', 'wait', 'furiten', 'genbutsu', 'defense', 'reading'];
    courses.forEach((courseId) => {
      const list = QuizData.questionsForCourse(courseId);
      assert.ok(list.length > 0, courseId + ' の問題が無い');
      list.forEach((q) => {
        const graded = QuizEngine.gradeQuestion(q, q.expected);
        assert.ok(graded && typeof graded.correct === 'boolean', `${q.id}: 採点できない`);
        if (courseId !== 'reading') {
          // 待ち読み以外は採点モードを持たず、待ち的中も付かない
          assert.strictEqual(graded.hit, undefined, `${q.id}: 待ち読み以外に待ち的中が付いている`);
          assert.strictEqual(graded.scoring, undefined, `${q.id}: 待ち読み以外に採点モードが付いている`);
        }
      });
      const session = QuizSession.createSession(courseId, {});
      assert.ok(session.questions.length > 0, courseId + ' のセッションが作れない');
      const q = QuizSession.currentQuestion(session);
      const record = QuizSession.answerCurrent(session, q.expected);
      assert.ok(typeof record.correct === 'boolean', courseId + ' の回答が記録できない');
    });
  });
};
