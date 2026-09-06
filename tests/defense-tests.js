/**
 * tests/defense-tests.js
 * 「守備判断クイズ」(V1.8)のテスト。
 * ルールベース評価の「保証したい性質」を、重みを変えても崩れないように固定する。
 * tests/run.js から呼び出される。
 */
module.exports = function ({ test, assert, Tiles, Defense, QuizData, QuizEngine, QuizSession, QuizStats }) {
  const parse = QuizData.parse;
  const t = (s) => parse(s)[0];

  /** テスト用の場面を組み立てる(quizengine の正規化と defense のコンテキストをまとめて作る) */
  function ctxOf(spec) {
    const board = QuizEngine.normalizeBoard({
      hand: parse(spec.hand || ''),
      targetSeat: spec.targetSeat === undefined ? 1 : spec.targetSeat,
      doraIndicators: parse(spec.dora || ''),
      roundWind: spec.roundWind === undefined ? 27 : spec.roundWind,
      seatWind: spec.seatWind === undefined ? 28 : spec.seatWind,
      players: [
        { seat: 0, label: '自分', isSelf: true, discards: parse(spec.self || '') },
        { seat: 1, label: '下家', riichi: true, riichiIndex: spec.riichiIndex === undefined ? 0 : spec.riichiIndex, discards: parse(spec.shimocha || '') },
        { seat: 2, label: '対面', riichi: !!spec.toimenRiichi, riichiIndex: spec.toimenRiichiIndex, discards: parse(spec.toimen || '') },
        { seat: 3, label: '上家', discards: parse(spec.kamicha || '') },
      ],
    });
    return Defense.buildContext({
      players: board.players,
      targetSeat: board.targetSeat,
      visibleCounts: QuizEngine.visibleCounts(board, false),
      doraIndicators: board.doraIndicators,
      roundWind: board.roundWind,
      seatWind: board.seatWind,
    });
  }

  // ==================================================
  // 1. 現物は必ず最上位
  // ==================================================

  test('守備: 対象者の現物は必ずランクS(最上位)になる', () => {
    const spec = { hand: '3p5m9s2z', shimocha: '3p1z', riichiIndex: 1 };
    const ctx = ctxOf(spec);
    const genbutsu = Defense.evaluateTile(t('3p'), ctx);
    assert.strictEqual(genbutsu.rank, 'S');
    assert.strictEqual(genbutsu.certain, true, '現物は「確定」として扱われていない');

    const result = Defense.evaluateCandidates(parse('5m3p9s2z'), ctx);
    assert.deepStrictEqual(result.safestTiles, [t('3p')], '現物が最も安全な牌になっていない');
    assert.strictEqual(result.groups[0].rank, 'S');
  });

  test('守備: ドラであっても現物ならランクSのまま(ドラだから最危険とはしない)', () => {
    const spec = { hand: '5m9m', shimocha: '5m1z', riichiIndex: 1, dora: '4m' };
    const ctx = ctxOf(spec);
    const dora = Defense.evaluateTile(t('5m'), ctx);
    assert.strictEqual(dora.dora.isDora, true, 'ドラとして認識されていない');
    assert.strictEqual(dora.rank, 'S', '現物のドラがSでなくなっている');
  });

  test('守備: 他家の現物を、対象リーチ者の現物と誤判定しない', () => {
    // 下家のリーチ宣言は河の最後(4枚目)。対面の捨て牌はそれより前なので、
    // 「リーチ後に通った牌」にはならない = 下家に対する現物ではない。
    const spec = { hand: '3p5m', shimocha: '1z9s5s7z', riichiIndex: 3, toimen: '3p5m' };
    const ctx = ctxOf(spec);
    // 対面が捨てただけの牌は、下家に対する現物ではない
    assert.strictEqual(Defense.isGenbutsu(t('3p'), ctx), false);
    assert.notStrictEqual(Defense.evaluateTile(t('3p'), ctx).rank, 'S');

    // 対象を対面に変えれば現物になる
    const ctx2 = ctxOf(Object.assign({}, spec, { targetSeat: 2, toimenRiichi: true, toimenRiichiIndex: 1 }));
    assert.strictEqual(Defense.isGenbutsu(t('3p'), ctx2), true, '対象を変えても評価が変わっていない');
    assert.strictEqual(Defense.evaluateTile(t('3p'), ctx2).rank, 'S');
  });

  // ==================================================
  // 2. 筋(スジ)
  // ==================================================

  test('守備: 筋の対応関係(1-4-7 / 2-5-8 / 3-6-9)が正しい', () => {
    const cases = [
      ['1m', '4m'], ['4m', '1m'], ['4m', '7m'], ['7m', '4m'],
      ['2p', '5p'], ['5p', '8p'], ['8p', '5p'],
      ['3s', '6s'], ['6s', '9s'], ['9s', '6s'],
    ];
    cases.forEach(([tile, river]) => {
      const ctx = ctxOf({ hand: tile, shimocha: river + '1z', riichiIndex: 1 });
      const suji = Defense.analyzeSuji(t(tile), ctx);
      assert.strictEqual(suji.isSuji, true, `${river}が河にあるとき${tile}が筋と判定されない`);
      assert.ok(suji.basis.indexOf(t(river)) !== -1);
    });

    // 3つ違い以外は筋にならない
    const ctx = ctxOf({ hand: '5m', shimocha: '4m1z', riichiIndex: 1 });
    assert.strictEqual(Defense.analyzeSuji(t('5m'), ctx).isSuji, false, '4萬で5萬が筋になっている');

    // 字牌に筋はない
    const honorCtx = ctxOf({ hand: '1z', shimocha: '4z2z', riichiIndex: 1 });
    assert.strictEqual(Defense.analyzeSuji(t('1z'), honorCtx).isSuji, false);
  });

  test('守備: 筋だけではS評価にしない(完全な安全牌として扱わない)', () => {
    // 両スジの5萬(2萬・8萬が河にある)でも S にはしない
    const ctx = ctxOf({ hand: '5m', shimocha: '2m8m1z', riichiIndex: 2 });
    const both = Defense.evaluateTile(t('5m'), ctx);
    assert.strictEqual(both.suji.isDoubleSuji, true, '両スジと判定されていない');
    assert.notStrictEqual(both.rank, 'S', '筋だけでSになっている');
    assert.strictEqual(both.certain, false);
    // 嵌張・双碰・単騎に当たる可能性が危険材料として残っていること
    assert.ok(both.dangerFactors.some((f) => f.key === 'other-waits'), '「筋でも当たる」説明が出ていない');
  });

  test('守備: 片スジは両スジより評価が低い', () => {
    const half = Defense.evaluateTile(t('5m'), ctxOf({ hand: '5m', shimocha: '2m1z', riichiIndex: 1 }));
    const both = Defense.evaluateTile(t('5m'), ctxOf({ hand: '5m', shimocha: '2m8m1z', riichiIndex: 2 }));
    assert.ok(both.score > half.score, '両スジが片スジより高く評価されていない');
  });

  test('守備: 3の筋(6が河)でも、1・2の辺張形は否定できない', () => {
    const ctx = ctxOf({ hand: '3s', shimocha: '6s1z', riichiIndex: 1 });
    const forms = Defense.analyzeForms(t('3s'), ctx);
    const blocked = forms.filter((f) => f.status === 'suji');
    const open = forms.filter((f) => f.status === 'possible');
    assert.strictEqual(blocked.length, 1, '4索5索の形が筋で否定されていない');
    assert.strictEqual(open.length, 1, '1索2索の辺張形が残っていない');
  });

  // ==================================================
  // 3. 壁(カベ)とワンチャンス
  // ==================================================

  test('守備: 壁(4枚見え)の判定', () => {
    // 4筒が4枚見え(自分の手に2枚+河に2枚)
    const ctx = ctxOf({ hand: '44p2p', shimocha: '4p1z', toimen: '4p', riichiIndex: 1 });
    assert.strictEqual(Defense.remainingCount(t('4p'), ctx), 0, '4筒が4枚見えになっていない');
    const kabe = Defense.analyzeKabe(t('2p'), ctx);
    assert.strictEqual(kabe.isKabe, true, '壁と判定されていない');
    assert.strictEqual(kabe.allBlocked, true, '2筒の両面形がすべて否定されていない');
    assert.ok(kabe.blockerTiles.indexOf(t('4p')) !== -1);
  });

  test('守備: 壁があっても完全な安全牌(S)にはしない', () => {
    const ctx = ctxOf({ hand: '44p2p', shimocha: '4p1z', toimen: '4p', riichiIndex: 1 });
    const evalTile = Defense.evaluateTile(t('2p'), ctx);
    assert.notStrictEqual(evalTile.rank, 'S', '壁だけでSになっている');
    assert.strictEqual(evalTile.certain, false);
    assert.ok(evalTile.dangerFactors.some((f) => f.key === 'other-waits'));
  });

  test('守備: ワンチャンス(3枚見え)の判定', () => {
    const ctx = ctxOf({ hand: '77s9s', shimocha: '7s1z', riichiIndex: 1 });
    assert.strictEqual(Defense.remainingCount(t('7s'), ctx), 1);
    const oc = Defense.analyzeOneChance(t('9s'), ctx);
    assert.strictEqual(oc.isOneChance, true, 'ワンチャンスと判定されていない');
    assert.ok(oc.blockerTiles.indexOf(t('7s')) !== -1);
  });

  test('守備: ワンチャンスを壁より強い安全材料にしない', () => {
    // 同じ2筒を、4筒が4枚見え(壁)の場合と3枚見え(ワンチャンス)の場合で比べる
    const kabeCtx = ctxOf({ hand: '44p2p', shimocha: '4p1z', toimen: '4p', riichiIndex: 1 });
    const ocCtx = ctxOf({ hand: '44p2p', shimocha: '4p1z', riichiIndex: 1 });
    const withKabe = Defense.evaluateTile(t('2p'), kabeCtx);
    const withOneChance = Defense.evaluateTile(t('2p'), ocCtx);
    assert.strictEqual(Defense.remainingCount(t('4p'), ocCtx), 1, 'ワンチャンスの場面になっていない');
    assert.ok(withKabe.score > withOneChance.score, '壁がワンチャンスより高く評価されていない');
    assert.ok(Defense.WEIGHTS.perRyanmenBlocked > Defense.WEIGHTS.perRyanmenOneChance, '重みの大小が逆転している');
  });

  // ==================================================
  // 4. 字牌
  // ==================================================

  test('守備: 字牌の見え枚数で評価が変わる(4枚見えはロンされない)', () => {
    const dead = Defense.evaluateTile(
      t('4z'),
      ctxOf({ hand: '4z', shimocha: '1z9m5s6p', riichiIndex: 3, toimen: '4z4z', kamicha: '4z' })
    );
    assert.strictEqual(dead.honor.remaining, 0);
    assert.strictEqual(dead.rank, 'S', '残り0枚の字牌がSになっていない');
    assert.ok(dead.safeFactors.some((f) => f.key === 'honor-dead'));

    const two = Defense.evaluateTile(t('4z'), ctxOf({ hand: '4z', shimocha: '1z9m5s6p', riichiIndex: 3, toimen: '4z' }));
    const live = Defense.evaluateTile(t('4z'), ctxOf({ hand: '4z', shimocha: '1z9m5s6p', riichiIndex: 3 }));
    assert.ok(two.score > live.score, '見えている枚数が多い方が安全になっていない');
    assert.ok(live.dangerFactors.some((f) => f.key === 'live-honor'), '生牌の警告が出ていない');
  });

  test('守備: 4枚見えでも数牌は安全にしない(字牌だけの理屈であること)', () => {
    // 5萬が4枚見えでも、5萬は両面で待たれる(相手が持っている必要がない)
    const ctx = ctxOf({ hand: '555m5m', shimocha: '1z', riichiIndex: 0 });
    assert.strictEqual(Defense.remainingCount(t('5m'), ctx), 0);
    const evalTile = Defense.evaluateTile(t('5m'), ctx);
    assert.notStrictEqual(evalTile.rank, 'S', '4枚見えの数牌が安全と判定されている');
  });

  test('守備: 場風・自風・三元牌を役牌として判定する', () => {
    const spec = { hand: '1z2z3z5z', shimocha: '9m', riichiIndex: 0, roundWind: 27, seatWind: 28 };
    const ctx = ctxOf(spec);
    assert.strictEqual(Defense.analyzeHonor(t('1z'), ctx).isYakuhai, true, '場風の東が役牌でない');
    assert.strictEqual(Defense.analyzeHonor(t('2z'), ctx).isYakuhai, true, '自風の南が役牌でない');
    assert.strictEqual(Defense.analyzeHonor(t('5z'), ctx).isYakuhai, true, '三元牌の白が役牌でない');
    assert.strictEqual(Defense.analyzeHonor(t('3z'), ctx).isYakuhai, false, '客風の西が役牌になっている');

    // 同じ見え枚数なら、役牌の方が危険側に評価される
    const yakuhai = Defense.evaluateTile(t('5z'), ctx);
    const guest = Defense.evaluateTile(t('3z'), ctx);
    assert.ok(guest.score > yakuhai.score, '客風が役牌より安全に評価されていない');
  });

  // ==================================================
  // 5. ドラ
  // ==================================================

  test('守備: ドラとドラ周辺を危険材料として扱う', () => {
    const spec = { hand: '5m6m2m', shimocha: '1z', riichiIndex: 0, dora: '4m' };
    const ctx = ctxOf(spec);
    const dora = Defense.evaluateTile(t('5m'), ctx);
    const near = Defense.evaluateTile(t('6m'), ctx);
    const plain = Defense.evaluateTile(t('2m'), ctx);
    assert.strictEqual(dora.dora.isDora, true);
    assert.strictEqual(near.dora.isAdjacent, true, 'ドラの隣と判定されていない');
    assert.strictEqual(plain.dora.isDora, false);
    assert.ok(dora.score < near.score, 'ドラがドラ隣より危険になっていない');
    assert.ok(near.score < plain.score, 'ドラ隣が無関係の牌より危険になっていない');
  });

  test('守備: 赤5は通常の5と同じ牌種として評価する(打点の注意だけを添える)', () => {
    const ctx = ctxOf({ hand: '5m', shimocha: '2m1z', riichiIndex: 1 });
    const normal = Defense.evaluateTile(t('5m'), ctx);
    const aka = Defense.evaluateTile({ tile: t('5m'), aka: true }, ctx);
    assert.strictEqual(aka.rank, normal.rank, '赤5のランクが通常の5と違う');
    assert.strictEqual(aka.score, normal.score, '赤5の評価点が通常の5と違う');
    assert.ok(aka.dangerFactors.some((f) => f.key === 'aka'), '赤5の注意書きが無い');
  });

  // ==================================================
  // 6. 相対順位・同順位
  // ==================================================

  test('守備: 材料が同程度の牌は同順位(同じグループ)にまとめる', () => {
    // 5萬と6萬はどちらも無筋の中張牌。無理に順位を付けない。
    const ctx = ctxOf({ hand: '5m6m3p', shimocha: '3p1z', riichiIndex: 1 });
    const result = Defense.evaluateCandidates(parse('3p5m6m'), ctx);
    assert.strictEqual(result.groups.length, 2, 'グループ数が想定と違う');
    assert.deepStrictEqual(result.groups[0].tiles, [t('3p')]);
    assert.strictEqual(result.groups[1].tiles.length, 2, '同評価の2枚が同じグループになっていない');
    assert.strictEqual(result.groupIndexOf[t('5m')], result.groupIndexOf[t('6m')]);
  });

  test('守備: 並べ替え問題は同順位の入れ替えも正解になる', () => {
    const q = QuizData.getQuestion('defense-09'); // 現物 > (片スジ・端牌) > 無筋
    const resolved = QuizEngine.RESOLVERS.safetyOrder(QuizEngine.normalizeBoard(q.board), { candidates: q.candidates });
    const byTile = {};
    q.choices.forEach((c) => (byTile[c.tile] = c.id));

    const base = QuizEngine.gradeQuestion(q, q.expected);
    assert.strictEqual(base.correct, true, '想定の並び順が不正解になっている');

    // 同順位(6筒と9索)を入れ替えても正解
    const swapped = q.expected.slice();
    const i1 = swapped.indexOf(byTile[t('6p')]);
    const i2 = swapped.indexOf(byTile[t('9s')]);
    assert.strictEqual(resolved[t('6p')], resolved[t('9s')], '6筒と9索が同順位になっていない');
    const tmp = swapped[i1];
    swapped[i1] = swapped[i2];
    swapped[i2] = tmp;
    assert.strictEqual(QuizEngine.gradeQuestion(q, swapped).correct, true, '同順位の入れ替えが不正解になっている');

    // 明らかに順位が違う並びは不正解
    const wrong = q.expected.slice().reverse();
    assert.strictEqual(QuizEngine.gradeQuestion(q, wrong).correct, false, '逆順が正解になっている');

    // 全部並べ切らないうちは不正解(未完成)
    assert.strictEqual(QuizEngine.gradeQuestion(q, q.expected.slice(0, 2)).correct, false);
  });

  // ==================================================
  // 7. 問題データ
  // ==================================================

  test('守備クイズ: 30問以上あり、初級・中級・実戦がすべて存在する', () => {
    const questions = QuizData.questionsForCourse('defense');
    assert.ok(questions.length >= 30, '問題数が足りない: ' + questions.length);
    const course = QuizData.getCourse('defense');
    course.difficulties.forEach((d) => {
      const n = questions.filter((q) => q.difficulty === d.id).length;
      assert.ok(n >= 5, `${d.id} の問題が少なすぎる: ${n}`);
    });
    assert.ok(course.difficulties.some((d) => d.recommended), 'おすすめの難易度が設定されていない');
    assert.strictEqual(course.difficulties[0].id, 'beginner', '最初の難易度が初級になっていない');
  });

  test('守備クイズ: 5つの出題形式がすべて含まれている', () => {
    const resolvers = new Set(QuizData.questionsForCourse('defense').map((q) => q.resolver));
    ['safestTiles', 'mostDangerousTiles', 'safetyCategory', 'safetyOrder', 'safetyReasonKeys'].forEach((r) => {
      assert.ok(resolvers.has(r), r + ' の問題が無い');
    });
  });

  test('守備クイズ: 全問の期待値がエンジンの評価と一致する', () => {
    QuizData.questionsForCourse('defense').forEach((q) => {
      const graded = QuizEngine.gradeQuestion(q, q.expected || []);
      assert.ok(
        graded.correct,
        `${q.id}: データの想定=[${(q.expected || []).join(',')}] / エンジン=[${graded.correctIds.join(',')}]`
      );
    });
  });

  test('守備クイズ: 盤面が成立している(手牌13枚・5枚目が存在しない・候補は手牌にある)', () => {
    QuizData.questionsForCourse('defense').forEach((q) => {
      const board = QuizEngine.normalizeBoard(q.board);
      const counts = QuizEngine.concealedCounts(board, false);
      assert.strictEqual(counts.reduce((a, c) => a + c, 0), 13, `${q.id}: 手牌が13枚ではない`);
      const visible = QuizEngine.visibleCounts(board, false);
      for (let i = 0; i < Tiles.TILE_COUNT; i++) {
        assert.ok(visible[i] <= 4, `${q.id}: ${Tiles.shortLabel(i)} が5枚以上見えている`);
      }
      (q.candidates || []).forEach((c) => {
        const tile = typeof c === 'number' ? c : c.tile;
        assert.ok(counts[tile] >= 1, `${q.id}: 候補の${Tiles.shortLabel(tile)}が手牌に無い`);
      });
      assert.ok(board.targetSeat !== undefined, `${q.id}: 評価対象が指定されていない`);
    });
  });

  test('守備クイズ: 学習項目(現物・筋・壁・ワンチャンス・字牌・ドラ・2人リーチ)を網羅している', () => {
    const tags = new Set();
    QuizData.questionsForCourse('defense').forEach((q) => (q.tags || []).forEach((t2) => tags.add(t2)));
    ['genbutsu', 'suji-basic', 'suji-not-safe', 'kabe', 'one-chance', 'honor-tile', 'live-honor', 'dora-danger', 'multi-factor', 'multi-riichi'].forEach(
      (tag) => assert.ok(tags.has(tag), tag + ' の問題が無い')
    );
  });

  // ==================================================
  // 8. 出題制御・学習履歴
  // ==================================================

  function seededRng(seed) {
    let s = seed;
    return function () {
      s = (s * 1103515245 + 12345) % 2147483648;
      return s / 2147483648;
    };
  }

  test('守備クイズ: 10問出題され、同じ挑戦の中で重複しない', () => {
    const session = QuizSession.createSession('defense', { rng: seededRng(5) });
    assert.strictEqual(session.questions.length, 10);
    const ids = session.questions.map((q) => q.id);
    assert.strictEqual(new Set(ids).size, ids.length, '同じ問題が重複している');
  });

  test('守備クイズ: 難易度を指定するとその難易度だけが出題される', () => {
    ['beginner', 'intermediate', 'practical'].forEach((difficulty) => {
      const session = QuizSession.createSession('defense', { difficulty, rng: seededRng(9) });
      assert.strictEqual(session.difficulty, difficulty);
      assert.ok(session.questions.length > 0);
      session.questions.forEach((q) => assert.strictEqual(q.difficulty, difficulty, '別の難易度が混ざっている'));
    });
    // 存在しない難易度を指定してもエラーにせず、コース全体から出題する
    const fallback = QuizSession.createSession('defense', { difficulty: 'unknown-level', rng: seededRng(9) });
    assert.strictEqual(fallback.questions.length, 10);
  });

  test('守備クイズ: 間違えた問題だけを復習できる', () => {
    const wrong = ['defense-03', 'defense-14', 'defense-20'];
    const session = QuizSession.createSession('defense', { questionIds: wrong });
    assert.strictEqual(session.mode, 'review');
    assert.strictEqual(session.questions.length, 3);
    session.questions.forEach((q) => assert.ok(wrong.includes(q.id)));
  });

  test('守備クイズ: 難易度別の成績が保存され、既存4コースの履歴を壊さない', () => {
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
      // 既存4コースの履歴を先に作る
      QuizStats.recordAttempt('yaku', [{ questionId: 'yaku-01', correct: true, tags: ['riichi'], difficulty: 'easy' }]);
      QuizStats.recordAttempt('genbutsu', [{ questionId: 'genbutsu-01', correct: false, tags: ['genbutsu'], difficulty: 'easy' }]);

      QuizStats.recordAttempt('defense', [
        { questionId: 'defense-01', correct: true, tags: ['genbutsu'], difficulty: 'beginner' },
        { questionId: 'defense-14', correct: false, tags: ['kabe'], difficulty: 'intermediate' },
      ]);

      const stats = QuizStats.courseStats('defense');
      assert.strictEqual(stats.attempts, 1);
      assert.strictEqual(stats.answered, 2);
      assert.strictEqual(stats.correct, 1);
      assert.deepStrictEqual(stats.wrongQuestionIds, ['defense-14']);

      const byDiff = QuizStats.difficultyStats('defense', ['beginner', 'intermediate', 'practical']);
      assert.deepStrictEqual(byDiff.beginner, { correct: 1, answered: 1, rate: 100 });
      assert.deepStrictEqual(byDiff.intermediate, { correct: 0, answered: 1, rate: 0 });
      assert.deepStrictEqual(byDiff.practical, { correct: 0, answered: 0, rate: null });

      // 既存コースの履歴が残っていること
      assert.strictEqual(QuizStats.courseStats('yaku').correct, 1, '既存コースの履歴が消えた');
      assert.deepStrictEqual(QuizStats.courseStats('genbutsu').wrongQuestionIds, ['genbutsu-01']);
      const tags = QuizStats.tagStats();
      assert.deepStrictEqual(tags.kabe, { correct: 0, wrong: 1 });
      assert.deepStrictEqual(tags.riichi, { correct: 1, wrong: 0 });

      // byDifficulty を持たない古い保存データでも壊れない
      store['mahjong-trainer-quiz-v1'] = JSON.stringify({
        version: 1,
        courses: { defense: { attempts: 1, correct: 1, answered: 1, lastAt: null, wrongQuestionIds: [] } },
        tags: {},
      });
      const legacy = QuizStats.courseStats('defense');
      assert.deepStrictEqual(legacy.byDifficulty, {}, '古いデータの読み込みで壊れている');
      assert.deepStrictEqual(QuizStats.difficultyStats('defense', ['beginner']).beginner, { correct: 0, answered: 0, rate: null });
    } finally {
      if (prev === undefined) delete globalThis.localStorage;
      else globalThis.localStorage = prev;
    }
  });

  test('守備クイズ: 苦手分野が初心者向けの言葉で説明される', () => {
    const session = QuizSession.createSession('defense', { questionIds: ['defense-10'] });
    const q = QuizSession.currentQuestion(session);
    const wrongChoice = q.choices.find((c) => (q.expected || []).indexOf(c.id) === -1);
    QuizSession.answerCurrent(session, [wrongChoice.id]);
    QuizSession.goNext(session);
    const summary = QuizSession.summarize(session);
    assert.strictEqual(summary.correct, 0);
    assert.ok(summary.wrongTags.some((t2) => t2.tag === 'suji-not-safe'));
    assert.ok(summary.comment.indexOf('筋') >= 0, '苦手分野の説明が用語で伝わっていない: ' + summary.comment);
    assert.ok(QuizSession.tagAdvice('suji-not-safe').length > 10);
  });

  test('守備クイズ: 段階評価はS〜Eの6段階で、S以外は「確定ではない」と分かる', () => {
    assert.deepStrictEqual(Defense.RANK_ORDER, ['S', 'A', 'B', 'C', 'D', 'E']);
    Defense.RANK_ORDER.forEach((r) => {
      assert.ok(Defense.RANKS[r].label.length > 0);
      assert.strictEqual(Defense.RANKS[r].certain, r === 'S', r + ' の確定/推測の区別がおかしい');
    });
    // 放銃率のようなパーセント表示を持たないこと(疑似的な数値を出さない方針)
    const ctx = ctxOf({ hand: '5m', shimocha: '1z', riichiIndex: 0 });
    const evaluated = Defense.evaluateTile(t('5m'), ctx);
    assert.strictEqual(evaluated.percent, undefined, '放銃率のような数値を持ってしまっている');
    assert.ok(!/\d+%/.test(evaluated.reason), '説明文にパーセント表示が含まれている');
  });
};
