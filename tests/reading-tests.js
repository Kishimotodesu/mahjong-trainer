/**
 * tests/reading-tests.js
 * 「相手の待ち読み」(V1.9)のテスト。
 *
 * 特に重要なのは次の2点で、これが崩れると教材として成立しない。
 *  - 推理評価は公開情報だけで決まること(隠し手牌に影響されないこと)
 *  - 実際の待ちを参照するのは「待ち的中」の照合だけであること
 */
module.exports = function ({ test, assert, Tiles, Shanten, Reading, QuizData, QuizEngine, QuizSession, QuizStats }) {
  const questions = QuizData.questionsForCourse('reading');
  const parse = QuizData.parse;

  function boardOf(question) {
    return QuizEngine.publicBoard(question.board);
  }

  // ==================================================
  // 1. シナリオの整合性
  // ==================================================

  test('待ち読み: 30問以上あり、初級・中級・実戦がそろっている', () => {
    assert.ok(questions.length >= 30, '問題数が足りない: ' + questions.length);
    const course = QuizData.getCourse('reading');
    course.difficulties.forEach((d) => {
      const n = questions.filter((q) => q.difficulty === d.id).length;
      assert.ok(n >= 10, `${d.id} の問題が少ない: ${n}`);
    });
    assert.strictEqual(course.difficulties[0].id, 'beginner');
    assert.ok(course.difficulties[0].recommended, '初級がおすすめになっていない');
  });

  test('待ち読み: 同じ牌が5枚以上存在するシナリオは無い(隠し手牌を含めて数える)', () => {
    questions.forEach((q) => {
      const board = boardOf(q);
      const counts = new Array(Tiles.TILE_COUNT).fill(0);
      board.hand.forEach((t) => counts[t]++);
      board.players.forEach((p) => {
        p.discards.forEach((d) => counts[d.tile]++);
        (p.melds || []).forEach((m) => m.tiles.forEach((t) => counts[t]++));
      });
      board.doraIndicators.forEach((t) => counts[t]++);
      q.hidden.hand.forEach((t) => counts[t]++);
      for (let i = 0; i < Tiles.TILE_COUNT; i++) {
        assert.ok(counts[i] <= 4, `${q.id}: ${Tiles.shortLabel(i)} が${counts[i]}枚ある`);
      }
    });
  });

  test('待ち読み: 隠し手牌の枚数が副露数と合っている', () => {
    questions.forEach((q) => {
      const meldCount = (q.hidden.melds || []).length;
      assert.strictEqual(q.hidden.hand.length, 13 - meldCount * 3, `${q.id}: 隠し手牌の枚数が不正`);
      const board = boardOf(q);
      assert.strictEqual(board.hand.length, 13, `${q.id}: 自分の手牌が13枚ではない`);
    });
  });

  test('待ち読み: すべてのシナリオで相手が聴牌(テンパイ)している', () => {
    questions.forEach((q) => {
      const meldCount = (q.hidden.melds || []).length;
      const shanten = Shanten.calcShanten(Tiles.toCounts(q.hidden.hand), meldCount).shanten;
      assert.strictEqual(shanten, 0, `${q.id}: 聴牌していない(シャンテン${shanten})`);
    });
  });

  test('待ち読み: データの「実際の待ち」が待ち判定エンジンの結果と一致する', () => {
    questions.forEach((q) => {
      const engine = QuizEngine.hiddenWaits(q.hidden).slice().sort((a, b) => a - b);
      const data = q.hidden.waits.slice().sort((a, b) => a - b);
      assert.deepStrictEqual(
        engine,
        data,
        `${q.id}: データ[${data.map((t) => Tiles.shortLabel(t))}] エンジン[${engine.map((t) => Tiles.shortLabel(t))}]`
      );
    });
  });

  test('待ち読み: リーチしている相手は門前(メンゼン)で、副露者をリーチ状態にしていない', () => {
    questions.forEach((q) => {
      const board = boardOf(q);
      board.players.forEach((p) => {
        if (p.riichi) {
          assert.strictEqual((p.melds || []).length, 0, `${q.id}: ${p.label}がリーチしているのに副露がある`);
        }
      });
      const target = board.players.find((p) => p.seat === board.targetSeat);
      if (target.riichi) {
        assert.strictEqual((q.hidden.melds || []).length, 0, `${q.id}: リーチ者の隠し情報に副露がある`);
        assert.ok(target.riichiIndex >= 0 && target.discards[target.riichiIndex], `${q.id}: リーチ宣言牌が河にない`);
      } else {
        assert.strictEqual(
          (q.hidden.melds || []).length,
          (target.melds || []).length,
          `${q.id}: 副露の数が公開情報と隠し情報で食い違う`
        );
      }
    });
  });

  test('待ち読み: フリテンのシナリオが混ざっていない(相手の河に自分の待ちが無い)', () => {
    questions.forEach((q) => {
      const board = boardOf(q);
      const target = board.players.find((p) => p.seat === board.targetSeat);
      const river = new Set(target.discards.map((d) => d.tile));
      const furiten = QuizEngine.hiddenWaits(q.hidden).filter((t) => river.has(t));
      assert.strictEqual(furiten.length, 0, `${q.id}: フリテンになっている(${furiten.map((t) => Tiles.shortLabel(t))})`);
    });
  });

  test('待ち読み: ドラ表示牌とドラが正しく対応する', () => {
    const withDora = questions.filter((q) => q.board.doraIndicators && q.board.doraIndicators.length > 0);
    assert.ok(withDora.length > 0, 'ドラのあるシナリオが1つも無い');
    withDora.forEach((q) => {
      const board = boardOf(q);
      const clues = QuizEngine.readingClues(board);
      const doraClue = clues.find((c) => c.key === 'dora');
      assert.ok(doraClue, `${q.id}: ドラの手掛かりが出ていない`);
      board.doraIndicators.forEach((ind, i) => {
        const expected = ind === 8 ? 0 : ind < 27 && ind % 9 === 8 ? ind - 8 : ind + 1;
        assert.strictEqual(doraClue.tiles[i], expected, `${q.id}: ドラ表示牌の次の牌になっていない`);
      });
    });
  });

  test('待ち読み: 問題文で指定した「読む相手」が盤面に存在する', () => {
    questions.forEach((q) => {
      const board = boardOf(q);
      const target = board.players.find((p) => p.seat === board.targetSeat);
      assert.ok(target, `${q.id}: 対象プレイヤーがいない`);
      assert.ok(q.prompt.indexOf(target.label) >= 0, `${q.id}: 問題文と対象プレイヤー(${target.label})が一致しない`);
    });
  });

  // ==================================================
  // 2. 推理と的中の分離(このコースの核心)
  // ==================================================

  test('待ち読み: 推理評価は隠し手牌を参照しない(隠し手牌を差し替えても評価が変わらない)', () => {
    questions
      .filter((q) => q.mode === 'reading')
      .forEach((q) => {
        const board = boardOf(q);
        const candidates = q.candidates.slice();
        const selected = q.expected.map((id) => q.choices.find((c) => c.id === id).value);
        const before = Reading.gradeReasoning(board, candidates, selected, q.selectCount);

        // 隠し手牌をまったく別のものに差し替えても、推理評価は1文字も変わらないこと
        const fake = { hand: parse('19m19p19s1234567z'), melds: [], waits: parse('1m') };
        const swapped = Object.assign({}, q, { hidden: fake });
        const after = Reading.gradeReasoning(boardOf(swapped), candidates, selected, q.selectCount);

        assert.strictEqual(after.gradeKey, before.gradeKey, `${q.id}: 隠し手牌で推理評価が変わった`);
        assert.deepStrictEqual(after.reasonableTiles, before.reasonableTiles, `${q.id}: 隠し手牌で妥当な候補が変わった`);
      });
    // 関数の引数自体に隠し情報が入り込んでいないこと
    assert.strictEqual(Reading.gradeReasoning.length, 4, 'gradeReasoning の引数が想定と違う(隠し情報が混ざっていないか確認)');
  });

  test('待ち読み: 待ち的中の判定だけが実際の待ちを参照する', () => {
    const q = questions.find((x) => x.mode === 'reading' && Reading.isWaitScored(x.scoring));
    const selected = q.expected.map((id) => q.choices.find((c) => c.id === id).value);
    const real = QuizEngine.gradeQuestion(q, q.expected);

    // 隠し手牌を差し替えると、的中判定だけが変わる
    const fakeWaits = [Tiles.TILE_COUNT - 1];
    const fakeHit = Reading.matchWaits(selected, fakeWaits);
    assert.notStrictEqual(fakeHit.levelKey, real.hit.levelKey, '待ちを変えても的中判定が変わらない');
    assert.strictEqual(fakeHit.levelKey, 'miss');

    // 的中は実際の待ちだけで決まる(候補の妥当性は見ない)
    const perfect = Reading.matchWaits(real.actualWaits, real.actualWaits);
    assert.strictEqual(perfect.levelKey, 'hit');
  });

  test('待ち読み: 複数待ちの一部だけを選ぶと「一部的中」になる', () => {
    const multi = questions.find((q) => q.hidden.waits.length >= 2);
    const waits = multi.hidden.waits;
    assert.strictEqual(Reading.matchWaits(waits, waits).levelKey, 'hit');
    assert.strictEqual(Reading.matchWaits([waits[0]], waits).levelKey, 'partial');
    assert.strictEqual(Reading.matchWaits([], waits).levelKey, 'miss');
    const partial = Reading.matchWaits([waits[0]], waits);
    assert.deepStrictEqual(partial.matched, [waits[0]]);
    assert.deepStrictEqual(partial.missedWaits, waits.slice(1));
  });

  test('待ち読み: 推理が妥当でも待ちが外れる問題と、その逆の問題が両方ある', () => {
    const summary = questions
      .filter((q) => Reading.isWaitScored(q.scoring))
      .map((q) => QuizEngine.gradeQuestion(q, q.expected))
      .map((g) => g.reasoning.gradeKey + ':' + g.hit.levelKey);
    assert.ok(summary.some((s) => s === 'excellent:miss'), '「推理は妥当だが待ちは外れる」問題が無い');
    assert.ok(summary.some((s) => s === 'excellent:hit'), '「推理も待ちも当たる」問題が無い');
    assert.ok(summary.some((s) => s === 'excellent:partial'), '「一部的中」の問題が無い');
  });

  test('待ち読み: 現物を危険候補に選ぶと推理評価が下がる', () => {
    const q = QuizData.getQuestion('reading-01'); // 3筒が現物
    const board = boardOf(q);
    const genbutsu = q.choices.find((c) => c.tile === parse('3p')[0]);
    const graded = QuizEngine.gradeQuestion(q, [genbutsu.id]);
    assert.strictEqual(graded.reasoning.gradeKey, 'needsWork', '現物を選んでも評価が下がっていない');
    assert.strictEqual(graded.correct, false);
    assert.ok(graded.reasoning.reasons.join('').indexOf('現物') >= 0, '現物を選んだ理由が説明されていない');
  });

  test('待ち読み: 模範解答はすべて推理評価◎になる', () => {
    questions
      .filter((q) => q.mode === 'reading')
      .forEach((q) => {
        const graded = QuizEngine.gradeQuestion(q, q.expected);
        assert.strictEqual(graded.reasoning.gradeKey, 'excellent', `${q.id}: 模範解答が◎にならない(${graded.reasoning.mark})`);
        assert.ok(q.expected.length <= q.selectCount, `${q.id}: 模範解答が選択上限を超えている`);
      });
  });

  test('待ち読み: 「河から読み取れる説明」の正解がエンジンの判定と一致する', () => {
    questions
      .filter((q) => q.resolver === 'readingStatements')
      .forEach((q) => {
        const graded = QuizEngine.gradeQuestion(q, q.expected);
        assert.ok(
          graded.correct,
          `${q.id}: データ[${q.expected.join(',')}] エンジン[${graded.correctIds.join(',')}]`
        );
        // 「待ちを断定できる」という説明は常に誤りであること
        const certain = q.choices.find((c) => c.statement && c.statement.type === 'certain-wait');
        if (certain) {
          assert.ok(graded.correctIds.indexOf(certain.id) === -1, `${q.id}: 待ちを断定する説明が正解になっている`);
        }
      });
  });

  test('待ち読み: 公開情報だけで、河・鳴きの手掛かりが取り出せる', () => {
    const q = QuizData.getQuestion('reading-04'); // 萬子の染め手
    const board = boardOf(q);
    const direction = Reading.handDirection(board);
    assert.ok(direction.isOpen, '鳴いていると判定されていない');
    assert.ok(direction.honitsu && direction.honitsu.suit === 'm', '萬子の染め手が読めていない');
    assert.strictEqual(Reading.evaluateStatement(board, { type: 'toitoi' }), false, 'ポン1つで対々和と判定している');

    const toitoiBoard = boardOf(QuizData.getQuestion('reading-10'));
    assert.ok(Reading.handDirection(toitoiBoard).toitoi, 'ポン2つで対々和の可能性が出ていない');

    const clues = QuizEngine.readingClues(board);
    assert.ok(clues.some((c) => c.kind === 'limit'), '「断定できない」という注意が必ず入っていない');
  });

  test('待ち読み: 染め手の色は危険側、それ以外の色は安全側に評価される', () => {
    const q = QuizData.getQuestion('reading-05');
    const board = boardOf(q);
    const result = Reading.evaluateCandidates(board, q.candidates);
    const byTile = {};
    result.candidates.forEach((c) => (byTile[c.label] = c));
    assert.ok(byTile['6萬'].readingScore < byTile['2筒'].readingScore, '染め手の色が危険側になっていない');
    assert.ok(byTile['6萬'].readingFactors.some((f) => f.kind === 'danger'), '染め手の危険材料が出ていない');
    assert.ok(byTile['2筒'].readingFactors.some((f) => f.kind === 'safe'), '染め手以外の色の安全材料が出ていない');
  });

  test('待ち読み: 放銃率のようなパーセント表示を持たない', () => {
    const q = QuizData.getQuestion('reading-01');
    const graded = QuizEngine.gradeQuestion(q, q.expected);
    const text =
      graded.reasoning.reasons.join(' ') +
      ' ' +
      graded.reasoning.grade.label +
      ' ' +
      (graded.hit ? graded.hit.level.label : graded.scoringNote);
    assert.ok(!/\d+\s*%/.test(text), '評価の文言にパーセントが含まれている: ' + text);
    questions.forEach((q2) => {
      assert.ok(!/\d+\s*%/.test(q2.explanation), `${q2.id}: 解説にパーセント表示がある`);
    });
  });

  // ==================================================
  // 3. 出題制御・学習履歴
  // ==================================================

  function seededRng(seed) {
    let s = seed;
    return function () {
      s = (s * 1103515245 + 12345) % 2147483648;
      return s / 2147483648;
    };
  }

  test('待ち読み: 10問出題され、同じ挑戦の中で重複しない', () => {
    const session = QuizSession.createSession('reading', { rng: seededRng(21) });
    assert.strictEqual(session.questions.length, 10);
    const ids = session.questions.map((q) => q.id);
    assert.strictEqual(new Set(ids).size, ids.length);
  });

  test('待ち読み: 難易度を指定するとその難易度だけが出題される', () => {
    ['beginner', 'intermediate', 'practical'].forEach((difficulty) => {
      const session = QuizSession.createSession('reading', { difficulty, rng: seededRng(33) });
      assert.strictEqual(session.difficulty, difficulty);
      assert.strictEqual(session.questions.length, 10);
      session.questions.forEach((q) => assert.strictEqual(q.difficulty, difficulty));
    });
  });

  test('待ち読み: 間違えた問題だけを復習できる', () => {
    const wrong = ['reading-01', 'reading-09', 'reading-24'];
    const session = QuizSession.createSession('reading', { questionIds: wrong });
    assert.strictEqual(session.mode, 'review');
    assert.strictEqual(session.questions.length, 3);
    session.questions.forEach((q) => assert.ok(wrong.includes(q.id)));
  });

  test('待ち読み: 推理評価と待ち的中が別々に保存され、既存5コースの履歴を壊さない', () => {
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
      ['yaku', 'wait', 'furiten', 'genbutsu', 'defense'].forEach((courseId) => {
        QuizStats.recordAttempt(courseId, [{ questionId: courseId + '-01', correct: true, tags: ['x'], difficulty: 'beginner' }]);
      });

      // reading-01 は reasoning-only(待ち的中を採点しない)、reading-09 は hit-coverage
      const session = QuizSession.createSession('reading', { questionIds: ['reading-01', 'reading-09'] });
      while (!session.finished) {
        const q = QuizSession.currentQuestion(session);
        QuizSession.answerCurrent(session, q.expected);
        QuizSession.goNext(session);
      }
      const summary = QuizSession.summarize(session);
      QuizStats.recordAttempt(
        'reading',
        summary.results.map((r) => ({
          questionId: r.questionId,
          correct: r.correct,
          tags: r.tags,
          difficulty: r.difficulty,
          reasoning: r.reasoning,
          hit: r.hit,
        }))
      );

      const stats = QuizStats.courseStats('reading');
      assert.strictEqual(stats.attempts, 1);
      assert.strictEqual(stats.answered, 2);
      assert.strictEqual(stats.reasoning.excellent, 2, '推理評価が保存されていない');
      assert.strictEqual(
        stats.hit.hit + stats.hit.partial + stats.hit.miss,
        1,
        '待ち的中の分母に、採点しない問題まで入っている'
      );

      const reading = QuizStats.readingStats('reading');
      assert.strictEqual(reading.reasoningTotal, 2);
      assert.strictEqual(reading.hitTotal, 1, '待ち予想を採点した問題数が合わない');
      assert.strictEqual(reading.reasoningOnlyTotal, 1, '採点しなかった問題数が合わない');
      assert.strictEqual(reading.reasonableRate, 100);
      assert.ok(reading.hitRate !== null, '待ち的中率が出ていない');

      // 推理と的中が別の指標として保存されていること
      assert.notStrictEqual(stats.reasoning, stats.hit);
      ['yaku', 'wait', 'furiten', 'genbutsu', 'defense'].forEach((courseId) => {
        assert.strictEqual(QuizStats.courseStats(courseId).correct, 1, courseId + ' の履歴が消えた');
      });

      // 推理・的中を持たない古いデータでも壊れない
      store['mahjong-trainer-quiz-v1'] = JSON.stringify({
        version: 1,
        courses: { reading: { attempts: 1, correct: 1, answered: 1, lastAt: null, wrongQuestionIds: [] } },
        tags: {},
      });
      const legacy = QuizStats.readingStats('reading');
      assert.strictEqual(legacy.reasoningTotal, 0);
      assert.strictEqual(legacy.hitRate, null);
    } finally {
      if (prev === undefined) delete globalThis.localStorage;
      else globalThis.localStorage = prev;
    }
  });

  test('待ち読み: 苦手分野が初心者向けの言葉で案内される', () => {
    const session = QuizSession.createSession('reading', { questionIds: ['reading-09'] });
    const q = QuizSession.currentQuestion(session);
    const wrongChoice = q.choices.find((c) => q.expected.indexOf(c.id) === -1);
    const record = QuizSession.answerCurrent(session, [wrongChoice.id]);
    assert.ok(record.reasoning, '推理評価が記録されていない');
    assert.ok(record.hit, '待ち的中が記録されていない(reading-09 は待ちを採点する問題)');
    assert.strictEqual(record.scoring, 'hit-coverage');
    QuizSession.goNext(session);
    const summary = QuizSession.summarize(session);
    assert.strictEqual(summary.readingAnswered, 1);
    assert.ok(summary.comment.length > 0);
    assert.ok(QuizSession.tagAdvice('reading-not-certain').indexOf('断定') >= 0);
  });
};
