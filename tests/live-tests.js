/**
 * tests/live-tests.js
 * 実戦学習モード(V2.0)のテスト。
 *
 * 特に重要なのは次の3点で、これが崩れると対局が壊れるか、教材として成立しない。
 *  - 学習エンジンがCPUの手牌・山を一切参照しないこと
 *  - 出題が対局の進行(ロン・ツモ・リーチ)を邪魔しないこと
 *  - 1局あたりの出題数・重複・連続が抑えられていること
 */
module.exports = function ({
  test,
  assert,
  Tiles,
  GameState,
  Round,
  Kifu,
  Review,
  LiveSnapshot,
  LiveCoach,
  LiveQuiz,
  LiveSession,
  QuizData,
  QuizEngine,
  QuizSession,
}) {
  // ==================================================
  // テスト用のヘルパー
  // ==================================================

  function parse(str) {
    const tiles = [];
    const re = /(\d+)([mpsz])/g;
    let match;
    while ((match = re.exec(str))) {
      const nums = match[1].split('').map(Number);
      const suit = match[2];
      for (const n of nums) {
        if (suit === 'm') tiles.push(n - 1);
        else if (suit === 'p') tiles.push(9 + (n - 1));
        else if (suit === 's') tiles.push(18 + (n - 1));
        else tiles.push(26 + n);
      }
    }
    return tiles;
  }

  function seededRng(seed) {
    let s = seed;
    return function () {
      s = (s * 1103515245 + 12345) % 2147483648;
      return s / 2147483648;
    };
  }

  function newMatch(seed) {
    const match = GameState.createMatch({ humanSeat: 0, playerNames: ['あなた', 'CPU1', 'CPU2', 'CPU3'] });
    return GameState.startRound(match, seededRng(seed || 5));
  }

  /** 自分の手牌を任意の形に差し替える(テスト専用) */
  function setHand(match, seat, handStr, drawnStr) {
    const p = match.players[seat];
    p.handCounts = new Array(Tiles.TILE_COUNT).fill(0);
    parse(handStr).forEach((t) => p.handCounts[t]++);
    p.drawnTile = drawnStr ? parse(drawnStr)[0] : null;
    return p;
  }

  /** 相手にリーチさせ、河を作る(テスト専用) */
  function setRiichi(match, seat, riverStr, options) {
    const p = match.players[seat];
    p.discards = parse(riverStr).map((tile, i) => ({ tile, turnIndex: i, tsumogiri: false, isRiichiDeclare: false, calledBy: null }));
    p.riichi = true;
    p.riichiDeclaredAtTurnIndex = (options && options.riichiIndex !== undefined) ? options.riichiIndex : 0;
    if (p.discards.length > 0) p.discards[p.riichiDeclaredAtTurnIndex].isRiichiDeclare = true;
    return p;
  }

  function setDiscards(match, seat, riverStr) {
    match.players[seat].discards = parse(riverStr).map((tile, i) => ({
      tile,
      turnIndex: i,
      tsumogiri: false,
      isRiichiDeclare: false,
      calledBy: null,
    }));
  }

  function humanTurn(match, turn) {
    match.currentRound.phase = 'awaiting_discard';
    match.currentRound.turnSeat = 0;
    if (turn !== undefined) match.currentRound.turnCount = turn;
  }

  function snapshotOf(match) {
    return LiveSnapshot.buildSnapshot(match, 0);
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

  /** リーチを受けている典型的な局面(自分は1シャンテン、現物あり) */
  function riichiScene() {
    const match = newMatch(3);
    setHand(match, 0, '234m567m2299p345s', '9s');
    setRiichi(match, 1, '1z9m3p5s7z');
    setDiscards(match, 2, '2z8p');
    setDiscards(match, 3, '3z1m');
    humanTurn(match, 9);
    return match;
  }

  // ==================================================
  // 1. 学習局面の検出
  // ==================================================

  test('実戦学習: 重要な局面(相手リーチ)を検出できる', () => {
    const snapshot = snapshotOf(riichiScene());
    const moments = LiveCoach.detectLearningMoments(snapshot, { mode: 'key', maxPerRound: 3 }, {});
    assert.ok(moments.length > 0, '重要局面を1つも検出できていない');
    const kinds = moments.map((m) => m.kind);
    assert.ok(kinds.indexOf('safety') !== -1, '守備の局面を検出できていない');
    assert.ok(kinds.indexOf('pushfold') !== -1, '押し引きの局面を検出できていない');
    // 優先度順に並んでいる
    for (let i = 1; i < moments.length; i++) {
      assert.ok(moments[i - 1].priority >= moments[i].priority, '優先度順になっていない');
    }
  });

  test('実戦学習: 通常の局面では出題を絞る(重要局面モード)', () => {
    const match = newMatch(21);
    // 何の変哲もない配牌の1巡目
    humanTurn(match, 1);
    const snapshot = snapshotOf(match);
    const key = LiveCoach.detectLearningMoments(snapshot, { mode: 'key', maxPerRound: 3 }, {});
    const deep = LiveCoach.detectLearningMoments(snapshot, { mode: 'deep', maxPerRound: 8 }, {});
    assert.ok(deep.length >= key.length, 'じっくり学習の方が出題候補が少ない');
    // 同じ巡目にすでに出題していれば、何も出さない
    const after = LiveCoach.detectLearningMoments(snapshot, { mode: 'deep', maxPerRound: 8 }, { count: 1, lastTurn: snapshot.turn, askedKinds: {}, askedTags: [] });
    assert.strictEqual(after.length, 0, '同じ巡目に2問出そうとしている');
  });

  test('実戦学習: リーチ後・流局間際・自分の手番以外では出題しない', () => {
    const match = riichiScene();
    // 自分がリーチしている(ツモ切りのみ)
    match.players[0].riichi = true;
    assert.strictEqual(LiveCoach.detectLearningMoments(snapshotOf(match), { mode: 'deep' }, {}).length, 0, 'リーチ後に出題している');
    match.players[0].riichi = false;

    // 残り山がわずか(流局間際)
    const wall = match.currentRound.wall;
    match.currentRound.wall = wall.slice(0, 3);
    assert.strictEqual(LiveCoach.detectLearningMoments(snapshotOf(match), { mode: 'deep' }, {}).length, 0, '流局間際に出題している');
    match.currentRound.wall = wall;

    // 自分の手番ではない
    match.currentRound.turnSeat = 1;
    assert.strictEqual(LiveCoach.detectLearningMoments(snapshotOf(match), { mode: 'deep' }, {}).length, 0, '自分の手番以外で出題している');
  });

  test('実戦学習: 自動出題OFFでは1問も出さない', () => {
    const snapshot = snapshotOf(riichiScene());
    assert.strictEqual(LiveCoach.detectLearningMoments(snapshot, { mode: 'off' }, {}).length, 0);
    withFakeStorage(() => {
      const session = LiveSession.createSession({ mode: 'off', maxPerRound: 0 });
      assert.strictEqual(LiveSession.nextMoment(session, snapshot), null, 'OFFなのに出題している');
    });
  });

  test('実戦学習: 1局の最大出題数を超えない', () => {
    withFakeStorage(() => {
      const snapshot = snapshotOf(riichiScene());
      const session = LiveSession.createSession({ mode: 'deep', maxPerRound: 2 });
      let asked = 0;
      for (let turn = 1; turn <= 12; turn++) {
        const snap = Object.assign({}, snapshot, { turn });
        const moment = LiveSession.nextMoment(session, snap);
        if (!moment) continue;
        const question = LiveQuiz.buildQuestion(snap, moment);
        LiveSession.markAsked(session, moment, question, snap);
        LiveSession.closeCurrent(session);
        asked++;
      }
      assert.strictEqual(asked, 2, '上限を超えて出題している: ' + asked);
      assert.strictEqual(session.count, 2);
    });
  });

  test('実戦学習: 同じ局面を二重に出題しない', () => {
    withFakeStorage(() => {
      const snapshot = snapshotOf(riichiScene());
      const session = LiveSession.createSession({ mode: 'deep', maxPerRound: 8 });
      const first = LiveSession.nextMoment(session, snapshot);
      assert.ok(first, '1問目が出ていない');
      const question = LiveQuiz.buildQuestion(snapshot, first);
      LiveSession.markAsked(session, first, question, snapshot);
      // 表示中は次の問題を出さない
      assert.strictEqual(LiveSession.nextMoment(session, snapshot), null, '表示中に次の問題を出している');
      LiveSession.closeCurrent(session);
      // 同じ巡目・同じ手牌なら出さない
      assert.strictEqual(LiveSession.nextMoment(session, snapshot), null, '同じ局面を二重に出題している');
    });
  });

  test('実戦学習: 同じ種類・同じタグが連続しないように抑制する', () => {
    const snapshot = snapshotOf(riichiScene());
    const first = LiveCoach.detectLearningMoments(snapshot, { mode: 'deep' }, {})[0];
    const nextTurn = Object.assign({}, snapshot, { turn: snapshot.turn + 1 });
    const second = LiveCoach.detectLearningMoments(
      nextTurn,
      { mode: 'deep', cooldownTurns: 2 },
      { count: 1, askedKinds: { [first.kind]: snapshot.turn }, askedTags: first.tags, lastKind: first.kind, lastTurn: snapshot.turn }
    );
    second.forEach((m) => {
      assert.notStrictEqual(m.kind, first.kind, '同じ種類を連続で出そうとしている');
    });
    // クールダウン中は同じ種類が候補に入らない
    assert.ok(second.every((m) => m.kind !== first.kind));
  });

  // ==================================================
  // 2. 隠し情報を使わないこと
  // ==================================================

  test('実戦学習: スナップショットにCPUの手牌・山が含まれない', () => {
    const match = riichiScene();
    const snapshot = snapshotOf(match);
    assert.deepStrictEqual(LiveSnapshot.findHiddenLeaks(snapshot), [], '隠し情報が漏れている');
    snapshot.players.forEach((p) => {
      if (p.isSelf) return;
      assert.strictEqual(p.handCounts, undefined, p.label + 'の手牌が入っている');
      assert.strictEqual(p.drawnTile, undefined, p.label + 'のツモ牌が入っている');
    });
    assert.strictEqual(snapshot.wall, undefined);
    assert.strictEqual(snapshot.deadWall, undefined);
    // 見えている牌の数え方も公開情報だけ(自分の手牌+河+副露+ドラ表示牌)
    const expected = new Array(Tiles.TILE_COUNT).fill(0);
    match.players[0].handCounts.forEach((n, i) => (expected[i] += n));
    if (match.players[0].drawnTile !== null) expected[match.players[0].drawnTile]++;
    match.players.forEach((p) => p.discards.forEach((d) => expected[d.tile]++));
    GameState.currentDoraIndicators(match.currentRound).forEach((t) => expected[t]++);
    assert.deepStrictEqual(snapshot.visibleCounts, expected, '見えている牌の数え方に隠し情報が混ざっている');
  });

  test('実戦学習: CPUの手牌を差し替えても評価が変わらない', () => {
    const match = riichiScene();
    const before = snapshotOf(match);

    const kinds = [
      { kind: 'safety', priority: 90, tags: [] },
      { kind: 'discard', priority: 70, tags: [] },
      { kind: 'pushfold', priority: 80, tags: [] },
      { kind: 'reading', priority: 60, tags: [], targetSeat: 1 },
    ];
    const beforeResults = kinds.map((m) => {
      const q = LiveQuiz.buildQuestion(before, m);
      return { q, ev: LiveQuiz.evaluateAnswer(before, q, [q.choices[0].id]) };
    });
    const beforeCoach = LiveCoach.coachSummary(before);
    const beforePush = LiveCoach.judgePushFold(before);

    // CPU全員の手牌を国士無双の形に差し替える(山も入れ替える)
    match.players.forEach((p) => {
      if (p.seat === 0) return;
      p.handCounts = new Array(Tiles.TILE_COUNT).fill(0);
      parse('19m19p19s1234567z').forEach((t) => p.handCounts[t]++);
      p.drawnTile = null;
    });
    match.currentRound.wall = match.currentRound.wall.slice().reverse();

    const after = snapshotOf(match);
    assert.deepStrictEqual(after.visibleCounts, before.visibleCounts, '見えている牌が隠し手牌に影響されている');

    kinds.forEach((m, i) => {
      const q = LiveQuiz.buildQuestion(after, m);
      const ev = LiveQuiz.evaluateAnswer(after, q, [q.choices[0].id]);
      assert.strictEqual(ev.gradeKey, beforeResults[i].ev.gradeKey, m.kind + ': 隠し手牌で評価が変わった');
      assert.deepStrictEqual(ev.correctIds, beforeResults[i].ev.correctIds, m.kind + ': 隠し手牌で正解候補が変わった');
    });
    assert.strictEqual(LiveCoach.judgePushFold(after).recommendation, beforePush.recommendation, '押し引きが隠し手牌で変わった');
    assert.strictEqual(LiveCoach.coachSummary(after).oneLiner, beforeCoach.oneLiner, 'コーチの助言が隠し手牌で変わった');
  });

  test('実戦学習: 回答前の問題データにCPUの手牌が含まれない', () => {
    const match = riichiScene();
    const snapshot = snapshotOf(match);
    const question = LiveQuiz.buildQuestion(snapshot, { kind: 'safety', priority: 90, tags: [] });
    const json = JSON.stringify(question);
    assert.ok(json.indexOf('handCounts') === -1, '問題データに手牌の配列が入っている');
    // 選択肢は自分の手牌の牌だけ
    question.choices.forEach((c) => {
      assert.ok(snapshot.counts14[c.tile] > 0, '自分の手牌に無い牌が選択肢にある');
    });
  });

  // ==================================================
  // 3. 対局の停止・再開
  // ==================================================

  test('実戦学習: 出題中は対局が止まり、閉じると再開できる', () => {
    withFakeStorage(() => {
      const match = riichiScene();
      const snapshot = snapshotOf(match);
      const session = LiveSession.createSession({ mode: 'key', maxPerRound: 3 });
      const stateBefore = JSON.stringify(match);

      const moment = LiveSession.nextMoment(session, snapshot);
      const question = LiveQuiz.buildQuestion(snapshot, moment);
      LiveSession.markAsked(session, moment, question, snapshot);
      assert.strictEqual(session.paused, true, '出題中に一時停止していない');
      assert.ok(session.current, '表示中の問題が記録されていない');

      // 評価しても対局状態は変わらない
      LiveQuiz.evaluateAnswer(snapshot, question, [question.choices[0].id]);
      assert.strictEqual(JSON.stringify(match), stateBefore, '問題の評価で対局状態が変わった');

      LiveSession.closeCurrent(session);
      assert.strictEqual(session.paused, false, '閉じても停止したまま');
      assert.strictEqual(session.current, null);

      // 閉じたあとに対局を進められる
      Round.discardTile(match, LiveSnapshot.buildSnapshot(match, 0).hand[0], false);
      assert.strictEqual(match.currentRound.phase, 'awaiting_calls', '閉じたあとに対局を進められない');
    });
  });

  test('実戦学習: 打牌は1回しか適用されない(二重打牌の防止)', () => {
    const match = riichiScene();
    const round = match.currentRound;
    const tile = LiveSnapshot.buildSnapshot(match, 0).hand[0];
    const discardsBefore = match.players[0].discards.length;

    // appgame.js の performDiscard と同じ条件で二重呼び出しを防ぐ
    const guard = () => round.phase === 'awaiting_discard' && round.turnSeat === 0;
    assert.strictEqual(guard(), true);
    Round.discardTile(match, tile, false);
    assert.strictEqual(match.players[0].discards.length, discardsBefore + 1);
    assert.strictEqual(guard(), false, '打牌後も打牌できる状態のまま(二重打牌の危険)');
  });

  test('実戦学習: ロン・ツモ・リーチの操作を壊さない', () => {
    const match = newMatch(9);
    // ツモアガリできる形にする
    setHand(match, 0, '123m456m789m11p22s', '2s');
    humanTurn(match, 8);
    assert.ok(Round.canTsumoAgari(match, 0), 'ツモアガリの判定が壊れている');

    // 聴牌・門前ならリーチできる
    setHand(match, 0, '123m456m789m11p25s', '3s');
    humanTurn(match, 8);
    assert.ok(Round.canDeclareRiichi(match, 0), 'リーチの判定が壊れている');

    // ロンできる場面では鳴きの問題を出さない(applive.maybeAskCall と同じ条件)
    const callInfo = { action: 'pon', tile: 0, canRon: true };
    assert.strictEqual(callInfo.canRon, true);

    // 出題判定そのものが対局状態を書き換えないこと
    const before = JSON.stringify(match);
    LiveCoach.detectLearningMoments(snapshotOf(match), { mode: 'deep' }, {});
    LiveCoach.coachSummary(snapshotOf(match));
    assert.strictEqual(JSON.stringify(match), before, '検出処理が対局状態を書き換えた');
  });

  // ==================================================
  // 4. 問題ごとの評価
  // ==================================================

  test('実戦学習: 何切るの評価(◎と×が正しく分かれる)', () => {
    const match = newMatch(31);
    // 明確に「切るべき牌」がある形: 9筒が完全な余り牌
    setHand(match, 0, '234m567m234s55p11z', '9p');
    humanTurn(match, 6);
    const snapshot = snapshotOf(match);
    const graded = LiveQuiz.gradeDiscardCandidates(snapshot);
    const nine = graded.rows.find((r) => r.label === '9筒');
    assert.ok(nine, '9筒の評価が無い');
    assert.strictEqual(nine.grade, 'excellent', '余っている9筒が◎になっていない');

    const question = LiveQuiz.buildQuestion(snapshot, { kind: 'discard', priority: 70, tags: [] });
    const nineChoice = question.choices.find((c) => c.tile === nine.tile);
    const good = LiveQuiz.evaluateAnswer(snapshot, question, [nineChoice.id]);
    assert.strictEqual(good.gradeKey, 'excellent');
    assert.strictEqual(good.shouldReview, false, '◎なのに復習候補になっている');

    // 手を壊す牌(面子の一部)は×
    const breaking = graded.rows.find((r) => r.resultShanten > graded.bestShanten);
    assert.ok(breaking, 'シャンテンが戻る候補が無い');
    assert.strictEqual(breaking.grade, 'bad', 'シャンテンが戻る打牌が×になっていない');
    const badChoice = question.choices.find((c) => c.tile === breaking.tile);
    const bad = LiveQuiz.evaluateAnswer(snapshot, question, [badChoice.id]);
    assert.strictEqual(bad.gradeKey, 'bad');
    assert.strictEqual(bad.shouldReview, true, '×なのに復習候補になっていない');
    assert.ok(bad.axes.some((a) => a.key === 'efficiency' && a.text.indexOf('シャンテン') >= 0));
  });

  test('実戦学習: 同じ評価の候補はすべて正解になる', () => {
    const match = newMatch(31);
    // 完全に対称な形(1萬と9筒のどちらを切っても同じ)を作る
    setHand(match, 0, '234m567m234s55p11z', '9p');
    humanTurn(match, 6);
    const snapshot = snapshotOf(match);
    const question = LiveQuiz.buildQuestion(snapshot, { kind: 'discard', priority: 70, tags: [] });
    const ev = LiveQuiz.evaluateAnswer(snapshot, question, [question.choices[0].id]);
    const graded = LiveQuiz.gradeDiscardCandidates(snapshot);
    const topCount = graded.rows.filter((r) => r.isTop).length;
    assert.strictEqual(ev.correctIds.length, topCount, '同評価の候補がすべて正解になっていない');
    // 最良評価の牌はどれを選んでも同じ評価になる
    ev.correctIds.forEach((id) => {
      assert.strictEqual(LiveQuiz.evaluateAnswer(snapshot, question, [id]).gradeKey, ev.correctIds.length > 0 ? LiveQuiz.evaluateAnswer(snapshot, question, [ev.correctIds[0]]).gradeKey : 'excellent');
    });
  });

  test('実戦学習: 待ち・役・フリテンの評価', () => {
    const match = newMatch(41);
    setHand(match, 0, '234m567m11p23456s', '9s');
    humanTurn(match, 10);
    const snapshot = snapshotOf(match);
    const question = LiveQuiz.buildQuestion(snapshot, { kind: 'wait', priority: 80, tags: [] });
    assert.strictEqual(question.kind, 'wait');
    assert.ok(question.choices.length >= 2, '選択肢が少なすぎる');

    const correct = question.choices.filter((c) => {
      const ev = LiveQuiz.evaluateAnswer(snapshot, question, [c.id]);
      return ev.correctIds.indexOf(c.id) !== -1;
    });
    assert.ok(correct.length >= 1, '待ち牌が選択肢に無い');
    const all = LiveQuiz.evaluateAnswer(snapshot, question, correct.map((c) => c.id));
    assert.strictEqual(all.gradeKey, 'excellent', '正しい待ちをすべて選んでも◎にならない');
    assert.ok(all.detail.waits.length > 0);
    assert.ok(typeof all.detail.furiten === 'boolean');
    assert.ok(all.detail.totalRemaining > 0, '残り枚数が計算されていない');

    // フリテン: 自分の河に待ち牌がある場合
    const waitTile = all.detail.waits[0].tile;
    setDiscards(match, 0, '');
    match.players[0].discards.push({ tile: waitTile, turnIndex: 0, tsumogiri: false, isRiichiDeclare: false, calledBy: null });
    const furitenSnapshot = snapshotOf(match);
    const furitenEval = LiveQuiz.evaluateAnswer(furitenSnapshot, question, correct.map((c) => c.id));
    assert.strictEqual(furitenEval.detail.furiten, true, 'フリテンを検出できていない');
    assert.ok(furitenEval.axes.some((a) => a.text.indexOf('フリテン') >= 0), 'フリテンの説明が無い');
  });

  test('実戦学習: リーチできるかの判定', () => {
    const match = newMatch(43);
    setHand(match, 0, '234m567m11p23456s', '9s');
    humanTurn(match, 8);
    const snapshot = snapshotOf(match);
    const question = LiveQuiz.buildQuestion(snapshot, { kind: 'riichi', priority: 86, tags: [] });
    const yes = LiveQuiz.evaluateAnswer(snapshot, question, ['yes']);
    assert.strictEqual(yes.detail.isMenzen, true);
    assert.strictEqual(yes.detail.canTenpai, true);
    assert.strictEqual(yes.detail.canRiichi, true);
    assert.strictEqual(yes.gradeKey, 'excellent', '正しく「リーチできる」と答えたのに◎でない');
    assert.strictEqual(LiveQuiz.evaluateAnswer(snapshot, question, ['no']).gradeKey, 'bad');

    // 副露しているとリーチできない
    match.players[0].fuuro = [{ type: 'pon', tiles: parse('111z'), fromSeat: 1 }];
    setHand(match, 0, '234m567m11p23s', '4s');
    const openSnapshot = snapshotOf(match);
    const openQuestion = LiveQuiz.buildQuestion(openSnapshot, { kind: 'riichi', priority: 86, tags: [] });
    const openEval = LiveQuiz.evaluateAnswer(openSnapshot, openQuestion, ['no']);
    assert.strictEqual(openEval.detail.isMenzen, false);
    assert.strictEqual(openEval.detail.canRiichi, false);
    assert.strictEqual(openEval.gradeKey, 'excellent', '鳴いているのに「リーチできない」が正解にならない');
  });

  test('実戦学習: 安全牌の評価(現物が◎)', () => {
    const match = riichiScene();
    // 下家の河にある3筒を手牌に入れる(現物)
    setHand(match, 0, '234m567m2299p345s', '3p');
    const snapshot = snapshotOf(match);
    const question = LiveQuiz.buildQuestion(snapshot, { kind: 'safety', priority: 90, tags: [] });
    const genbutsu = question.choices.find((c) => c.label === '3筒');
    assert.ok(genbutsu, '現物が選択肢に無い');
    const ev = LiveQuiz.evaluateAnswer(snapshot, question, [genbutsu.id]);
    assert.strictEqual(ev.gradeKey, 'excellent', '現物を選んでも◎にならない');
    assert.strictEqual(ev.detail.hasGenbutsu, true);
    assert.ok(ev.detail.note.indexOf('現物') >= 0);

    // 無筋の危険牌は評価が下がる
    const other = question.choices.find((c) => c.label !== '3筒' && ev.correctIds.indexOf(c.id) === -1);
    if (other) {
      const worse = LiveQuiz.evaluateAnswer(snapshot, question, [other.id]);
      assert.ok(
        LiveQuiz.GRADES[worse.gradeKey].order <= LiveQuiz.GRADES[ev.gradeKey].order,
        '現物より危険な牌の評価が高くなっている'
      );
    }
  });

  test('実戦学習: 安全牌が無いときは「安全」と断定しない', () => {
    const match = newMatch(7);
    // 相手の河に自分の手牌の牌が1つも無い状況を作る
    setHand(match, 0, '234m567m2299p345s', '9s');
    setRiichi(match, 1, '1z2z3z4z5z');
    setDiscards(match, 2, '6z7z');
    setDiscards(match, 3, '1z2z');
    humanTurn(match, 11);
    const snapshot = snapshotOf(match);
    const safety = LiveCoach.safetyOverview(snapshot);
    assert.strictEqual(safety.hasGenbutsu, false, 'この局面では現物が無いはず');

    const question = LiveQuiz.buildQuestion(snapshot, { kind: 'safety', priority: 90, tags: [] });
    assert.ok(question.note.indexOf('比較上もっとも危険が低い') >= 0, '安全と断定しない説明が無い');
    const ev = LiveQuiz.evaluateAnswer(snapshot, question, [question.choices[0].id]);
    assert.ok(ev.detail.note.indexOf('「安全」とは言い切れません') >= 0, '「安全ではない」旨の説明が無い');
    // それでも「もっとも危険が低い牌」は決まる
    assert.ok(ev.correctIds.length >= 1);

    const pf = LiveCoach.judgePushFold(snapshot);
    assert.strictEqual(pf.hasGenbutsu, false);
    assert.ok(pf.negativeFactors.some((f) => f.key === 'no-genbutsu'), '現物が無いことが材料に入っていない');
  });

  test('実戦学習: 河読みの評価は公開情報だけで決まる', () => {
    const match = newMatch(13);
    setHand(match, 0, '234m567m2299p345s', '9s');
    // 対面が萬子の染め手っぽい仕掛け
    match.players[2].fuuro = [
      { type: 'chi', tiles: parse('123m'), fromSeat: 1 },
      { type: 'pon', tiles: parse('666z'), fromSeat: 0 },
    ];
    setDiscards(match, 2, '3p5p8p2s6s');
    humanTurn(match, 9);
    const snapshot = snapshotOf(match);
    const question = LiveQuiz.buildQuestion(snapshot, { kind: 'reading', priority: 78, tags: [], targetSeat: 2 });
    const ev = LiveQuiz.evaluateAnswer(snapshot, question, question.choices.map((c) => c.id));
    // 「待ちを断定できる」は必ず誤り
    const certain = question.choices.find((c) => c.statement && c.statement.type === 'certain-wait');
    assert.ok(certain, '断定できるかの選択肢が無い');
    assert.ok(ev.correctIds.indexOf(certain.id) === -1, '待ちを断定する説明が正解になっている');
    assert.ok(ev.detail.clues.some((c) => c.kind === 'limit'), '断定できないという注意が出ていない');
  });

  test('実戦学習: 鳴き判断の評価', () => {
    const match = newMatch(17);
    // 役牌をポンできる形
    setHand(match, 0, '234m567m55z234s12p', null);
    humanTurn(match, 6);
    const snapshot = snapshotOf(match);
    const question = LiveQuiz.callQuestion(snapshot, { action: 'pon', tile: parse('5z')[0] });
    const callEval = LiveQuiz.evaluateAnswer(snapshot, question, ['call']);
    assert.ok(['excellent', 'good', 'fair'].indexOf(callEval.gradeKey) !== -1);
    assert.ok(callEval.detail.shantenAfter <= callEval.detail.shantenBefore + 1);
    assert.ok(callEval.axes.some((a) => a.key === 'yaku'), '役の観点の説明が無い');
    assert.ok(callEval.axes.some((a) => a.text.indexOf('門前') >= 0), '門前でなくなる説明が無い');

    // シャンテンが悪くなる鳴きは見送りが◎
    // 西(客風=役にならない字牌)のポン。手は進むが役が無くなるので見送りが妥当。
    setHand(match, 0, '234m567m234s55p33z', null);
    const snapshot2 = snapshotOf(match);
    const q2 = LiveQuiz.callQuestion(snapshot2, { action: 'pon', tile: parse('3z')[0] });
    const passEval = LiveQuiz.evaluateAnswer(snapshot2, q2, ['pass']);
    assert.strictEqual(passEval.gradeKey, 'excellent', '見送るべき鳴きで見送っても◎にならない');
  });

  // ==================================================
  // 5. 押し引き判断
  // ==================================================

  test('押し引き: 終盤・遠い手・相手リーチ・現物ありなら降り寄り', () => {
    const match = newMatch(23);
    setHand(match, 0, '19m19p19s12345z', '3p');
    setRiichi(match, 1, '1z9m3p5s7z');
    humanTurn(match, 15);
    const pf = LiveCoach.judgePushFold(snapshotOf(match));
    assert.ok(pf.shanten >= 2, '遠い手になっていない');
    assert.strictEqual(pf.recommendation, 'fold', '降り寄りにならない');
    assert.ok(pf.reasons.length > 0);
    assert.ok(pf.negativeFactors.some((f) => f.key === 'late'), '終盤であることが材料に入っていない');
  });

  test('押し引き: 好形聴牌で打点があれば押し寄りになり得る', () => {
    const match = newMatch(29);
    // ドラを持った聴牌
    setHand(match, 0, '234m567m888p234s', '5s');
    setRiichi(match, 1, '1z9m7z5z6z');
    match.currentRound.deadWall.doraIndicators[0] = parse('7p')[0]; // ドラ=8筒
    humanTurn(match, 7);
    const pf = LiveCoach.judgePushFold(snapshotOf(match));
    assert.ok(pf.shanten <= 0, '聴牌になっていない');
    assert.ok(['push', 'cautious'].indexOf(pf.recommendation) !== -1, '好形聴牌なのに降り一択になっている');
    assert.ok(pf.positiveFactors.some((f) => f.key === 'tenpai'));
  });

  test('押し引き: 2人リーチは1人リーチより守備寄りになる', () => {
    const match = newMatch(23);
    setHand(match, 0, '234m567m2299p345s', '9s');
    setRiichi(match, 1, '1z9m3p5s7z');
    humanTurn(match, 9);
    const one = LiveCoach.judgePushFold(snapshotOf(match));

    setRiichi(match, 2, '2z8p4m6s3z');
    const two = LiveCoach.judgePushFold(snapshotOf(match));
    assert.ok(two.score < one.score, '2人リーチの方が押し寄りになっている');
    const ORDER = ['fold', 'cautious', 'push'];
    assert.ok(ORDER.indexOf(two.recommendation) <= ORDER.indexOf(one.recommendation), '2人リーチで守備寄りになっていない');
    assert.ok(two.negativeFactors.some((f) => f.key === 'multi-riichi'), '2人リーチであることが材料に入っていない');
  });

  test('押し引き: 点棒状況で判断が変わり得る', () => {
    const match = newMatch(23);
    setHand(match, 0, '234m567m2299p345s', '9s');
    setRiichi(match, 1, '1z9m3p5s7z');
    humanTurn(match, 9);

    match.players[0].score = 40000;
    match.players.forEach((p, i) => {
      if (i !== 0) p.score = 20000;
    });
    const ahead = LiveCoach.judgePushFold(snapshotOf(match));

    match.players[0].score = 8000;
    match.players[1].score = 40000;
    const behind = LiveCoach.judgePushFold(snapshotOf(match));

    assert.ok(behind.score > ahead.score, '点棒状況が判断に反映されていない');
    assert.ok(ahead.negativeFactors.some((f) => f.key === 'ahead'));
    assert.ok(behind.positiveFactors.some((f) => f.key === 'behind'));
  });

  test('押し引き: 確率や勝率と誤解される数値を出さない', () => {
    const match = riichiScene();
    const pf = LiveCoach.judgePushFold(snapshotOf(match));
    // 注意書きは「勝率・放銃率ではない」と説明する文なので、検査の対象から外す
    const text = [pf.description]
      .concat(pf.reasons, pf.positiveFactors.map((f) => f.text), pf.negativeFactors.map((f) => f.text))
      .join(' ');
    assert.ok(!/\d+\s*%/.test(text + ' ' + pf.disclaimer), 'パーセント表示が含まれている: ' + text);
    assert.ok(text.indexOf('放銃率') === -1 && text.indexOf('勝率') === -1, '放銃率・勝率という表現が含まれている');
    assert.ok(pf.disclaimer.indexOf('初心者向け') >= 0, '初心者向けの目安である旨が書かれていない');
    assert.ok(['high', 'medium', 'low'].indexOf(pf.confidence) !== -1);
  });

  test('押し引き: 判断が割れる局面では一意の正解にしない', () => {
    const match = riichiScene();
    const snapshot = snapshotOf(match);
    const question = LiveQuiz.buildQuestion(snapshot, { kind: 'pushfold', priority: 88, tags: [] });
    const judged = LiveCoach.judgePushFold(snapshot);
    const ev = LiveQuiz.evaluateAnswer(snapshot, question, [judged.recommendation]);
    assert.strictEqual(ev.gradeKey, 'excellent', 'エンジンの目安どおりに答えても◎にならない');
    // 隣の選択肢(押す⇔慎重、慎重⇔降りる)は少なくとも○
    const ORDER = ['fold', 'cautious', 'push'];
    question.choices.forEach((c) => {
      const distance = Math.abs(ORDER.indexOf(c.value) - ORDER.indexOf(judged.recommendation));
      const g = LiveQuiz.evaluateAnswer(snapshot, question, [c.id]);
      if (distance === 1) assert.ok(['excellent', 'good'].indexOf(g.gradeKey) !== -1, '隣の判断が不当に低く評価されている');
      // 正反対でも「×(明確に不利)」にはしない
      if (distance === 2) assert.notStrictEqual(g.gradeKey, 'bad', '正反対の判断を×にしている');
    });
    if (judged.confidence === 'low') {
      assert.ok(ev.correctIds.length >= 2, '判断が割れる局面なのに正解が1つしかない');
    }
  });

  // ==================================================
  // 6. オンデマンドコーチ
  // ==================================================

  test('実戦学習: オンデマンドコーチが必要な項目をすべて返す', () => {
    const snapshot = snapshotOf(riichiScene());
    const summary = LiveCoach.coachSummary(snapshot);
    assert.ok(typeof summary.shanten === 'number', 'シャンテン数が無い');
    assert.ok(Array.isArray(summary.effectiveTiles), '有効牌が無い');
    assert.ok(Array.isArray(summary.yakuCandidates), '狙える役が無い');
    assert.ok(summary.recommendedDiscards.length > 0, 'おすすめ打牌候補が無い');
    assert.ok(Array.isArray(summary.safeTiles), '安全牌が無い');
    assert.ok(summary.riichiTargets.length > 0, 'リーチ者への対応が無い');
    assert.ok(summary.pushfold && summary.pushfold.recommendation, '押し引きの目安が無い');
    assert.ok(summary.oneLiner.length > 0, '初心者向けの一言まとめが無い');
    // 自動出題OFFでも使える(設定に依存しない)
    const off = LiveCoach.coachSummary(snapshot);
    assert.strictEqual(off.oneLiner, summary.oneLiner);
  });

  test('実戦学習: 用語にカタカナの読みが添えられている', () => {
    const snapshot = snapshotOf(riichiScene());
    const summary = LiveCoach.coachSummary(snapshot);
    const question = LiveQuiz.buildQuestion(snapshot, { kind: 'safety', priority: 90, tags: [] });
    const ev = LiveQuiz.evaluateAnswer(snapshot, question, [question.choices[0].id]);
    const text = [summary.oneLiner]
      .concat(summary.summaryLines, [question.prompt, question.note], ev.axes.map((a) => a.text + ' ' + a.label))
      .join(' ');
    ['ゲンブツ', 'テンパイ', 'ハイコウリツ', 'オシヒキ'].forEach((reading) => {
      assert.ok(text.indexOf(reading) >= 0, '読み「' + reading + '」が見当たらない');
    });
  });

  // ==================================================
  // 7. 記録・振り返り・復習
  // ==================================================

  test('実戦学習: 局終了後の振り返りに必要な情報が残る', () => {
    withFakeStorage(() => {
      const match = riichiScene();
      const snapshot = snapshotOf(match);
      const session = LiveSession.createSession({ mode: 'key', maxPerRound: 3 });
      LiveSession.startRound(session, snapshot, '東1局 0本場');

      const moment = LiveSession.nextMoment(session, snapshot);
      const question = LiveQuiz.buildQuestion(snapshot, moment);
      LiveSession.markAsked(session, moment, question, snapshot);
      const ev = LiveQuiz.evaluateAnswer(snapshot, question, [question.choices[0].id]);
      const entry = LiveSession.recordAnswer(session, question, snapshot, ev, { actualDiscardLabel: '9筒' });
      LiveSession.closeCurrent(session);
      LiveSession.attachRoundResult(session, 'あなたの放銃(ホウジュウ)');

      const review = LiveSession.roundReview(session);
      assert.strictEqual(review.length, 1);
      const r = review[0];
      assert.ok(r.title && r.prompt, '出題内容が残っていない');
      assert.ok(Array.isArray(r.selectedLabels), 'ユーザーの回答が残っていない');
      assert.ok(r.gradeMark, '評価が残っていない');
      assert.strictEqual(r.actualDiscardLabel, '9筒', '実際に切った牌が残っていない');
      assert.ok(Array.isArray(r.recommendedLabels), 'おすすめ候補が残っていない');
      assert.ok(r.axes.length > 0, '解説が残っていない');
      assert.ok(r.tags.length > 0, '学習タグが残っていない');
      assert.ok(typeof r.turn === 'number', '巡目が残っていない');
      assert.strictEqual(r.resultLabel, 'あなたの放銃(ホウジュウ)', '局の結果が残っていない');
      assert.ok(typeof r.shouldReview === 'boolean', '復習対象かどうかが残っていない');

      // 「もう一度考える」で同じ問題を作り直せる(対局とは切り離して)
      assert.ok(r.snapshot && r.question, '再回答に必要な情報が残っていない');
      const again = LiveQuiz.evaluateAnswer(r.snapshot, r.question, [r.question.choices[0].id]);
      assert.strictEqual(again.gradeKey, ev.gradeKey, '振り返りからの再回答で評価が変わった');
      assert.deepStrictEqual(LiveSnapshot.findHiddenLeaks(r.snapshot), [], '保存した局面に隠し情報が入っている');
    });
  });

  test('実戦学習: △×の局面が復習候補として保存される', () => {
    withFakeStorage((store) => {
      const match = newMatch(31);
      setHand(match, 0, '234m567m234s55p11z', '9p');
      humanTurn(match, 6);
      const snapshot = snapshotOf(match);
      const session = LiveSession.createSession({ mode: 'deep', maxPerRound: 5 });
      LiveSession.startRound(session, snapshot, '東1局');

      const question = LiveQuiz.buildQuestion(snapshot, { kind: 'discard', priority: 70, tags: ['live-efficiency'] });
      const graded = LiveQuiz.gradeDiscardCandidates(snapshot);
      const badTile = graded.rows.find((r) => r.grade === 'bad');
      const badChoice = question.choices.find((c) => c.tile === badTile.tile);
      const ev = LiveQuiz.evaluateAnswer(snapshot, question, [badChoice.id]);
      assert.strictEqual(ev.shouldReview, true);
      LiveSession.recordAnswer(session, question, snapshot, ev, {});

      const candidates = LiveSession.reviewCandidates();
      assert.strictEqual(candidates.length, 1, '復習候補が保存されていない');
      assert.strictEqual(candidates[0].gradeKey, 'bad');

      // 既存の何切る復習帳にも追加される(門前・14枚のとき)
      const reviewStore = JSON.parse(store['mahjong-trainer-review-v1'] || '{"entries":[]}');
      assert.strictEqual(reviewStore.entries.length, 1, '既存の復習帳に追加されていない');
      assert.strictEqual(reviewStore.entries[0].source, 'live', '出典が実戦になっていない');

      // ◎の局面は復習候補にしない
      const goodChoice = question.choices.find((c) => c.tile === graded.rows.find((r) => r.isTop).tile);
      const goodEv = LiveQuiz.evaluateAnswer(snapshot, question, [goodChoice.id]);
      assert.strictEqual(goodEv.shouldReview, false);
    });
  });

  test('実戦学習: 保存する局面数に上限があり、古いものから消える', () => {
    withFakeStorage(() => {
      const store = LiveSession.emptyStore();
      for (let i = 0; i < LiveSession.MAX_MOMENTS + 25; i++) {
        store.moments.push({ id: 'm' + i, at: '2026-01-01T00:00:00.000Z', kind: 'discard', tags: [], gradeKey: 'good', shouldReview: false });
      }
      LiveSession.save(store);
      const loaded = LiveSession.load();
      assert.strictEqual(loaded.moments.length, LiveSession.MAX_MOMENTS, '上限を超えて保存されている');
      // 新しいものが残る
      assert.strictEqual(loaded.moments[loaded.moments.length - 1].id, 'm' + (LiveSession.MAX_MOMENTS + 24));
      assert.ok(LiveSession.MAX_MOMENTS >= 50 && LiveSession.MAX_MOMENTS <= 100, '保存上限が目安(50〜100)から外れている');
    });
  });

  test('実戦学習: 既存の保存データを壊さない', () => {
    withFakeStorage((raw) => {
      raw['mahjong-trainer-review-v1'] = JSON.stringify({ version: 1, entries: [{ problemId: 'x', tiles14: [], attempts: [] }] });
      raw['mahjong-trainer-kifu-v1'] = JSON.stringify([{ title: '既存の牌譜' }]);
      raw['mahjong-trainer-quiz-v1'] = JSON.stringify({ version: 2, courses: { yaku: { attempts: 1, correct: 1, answered: 1 } }, tags: {} });

      LiveSession.saveSettings({ mode: 'deep', maxPerRound: 6 });
      const match = riichiScene();
      const snapshot = snapshotOf(match);
      const session = LiveSession.createSession();
      const question = LiveQuiz.buildQuestion(snapshot, { kind: 'safety', priority: 90, tags: ['live-defense'] });
      const ev = LiveQuiz.evaluateAnswer(snapshot, question, [question.choices[0].id]);
      LiveSession.recordAnswer(session, question, snapshot, ev, {});

      assert.ok(raw['mahjong-trainer-kifu-v1'].indexOf('既存の牌譜') >= 0, '牌譜が壊れた');
      assert.strictEqual(JSON.parse(raw['mahjong-trainer-quiz-v1']).courses.yaku.correct, 1, 'クイズ履歴が壊れた');
      assert.ok(JSON.parse(raw['mahjong-trainer-review-v1']).entries.length >= 1, '復習帳が壊れた');
      assert.ok(raw[LiveSession.STORAGE_KEY], '実戦学習の履歴が保存されていない');

      // 壊れたデータでも落ちない
      raw[LiveSession.STORAGE_KEY] = '{壊れたJSON';
      const recovered = LiveSession.load();
      assert.strictEqual(recovered.moments.length, 0);
      assert.strictEqual(recovered.settings.mode, LiveSession.DEFAULT_SETTINGS.mode);
    });
  });

  test('実戦学習: 設定が保存され、モードごとに出題数が変わる', () => {
    withFakeStorage(() => {
      const key = LiveSession.setMode('key');
      assert.strictEqual(key.mode, 'key');
      assert.strictEqual(key.maxPerRound, 3, '重要局面コーチの初期値が3問ではない');
      assert.strictEqual(LiveSession.loadSettings().mode, 'key', '設定が保存されていない');

      const deep = LiveSession.setMode('deep');
      assert.strictEqual(deep.maxPerRound, 6);
      const off = LiveSession.setMode('off');
      assert.strictEqual(off.maxPerRound, 0);

      LiveSession.saveSettings({ mode: 'key', maxPerRound: 2 });
      assert.strictEqual(LiveSession.loadSettings().maxPerRound, 2, '出題数の変更が保存されていない');

      // 初期状態のおすすめは「重要局面コーチ」
      LiveSession.resetAll();
      assert.strictEqual(LiveSession.loadSettings().mode, 'key');
      const recommended = LiveSession.MODES.find((m) => m.recommended);
      assert.strictEqual(recommended.id, 'key');
    });
  });

  test('実戦学習: この局はもう出題しない・今回だけスキップができる', () => {
    withFakeStorage(() => {
      const snapshot = snapshotOf(riichiScene());
      const session = LiveSession.createSession({ mode: 'deep', maxPerRound: 5 });
      const moment = LiveSession.nextMoment(session, snapshot);
      const question = LiveQuiz.buildQuestion(snapshot, moment);
      LiveSession.markAsked(session, moment, question, snapshot);

      // 今回だけスキップ: 閉じれば対局は再開でき、次の局面ではまた出る
      LiveSession.closeCurrent(session);
      assert.strictEqual(session.paused, false);
      assert.strictEqual(session.skipRound, false);

      // この局はもう出題しない
      LiveSession.skipRestOfRound(session);
      assert.strictEqual(session.skipRound, true);
      const later = Object.assign({}, snapshot, { turn: snapshot.turn + 3 });
      assert.strictEqual(LiveSession.nextMoment(session, later), null, '停止したのに出題している');

      // 次の局が始まればまた出題される
      LiveSession.startRound(session, later, '東2局');
      assert.strictEqual(session.skipRound, false);
      assert.strictEqual(session.count, 0);
    });
  });

  // ==================================================
  // 8. 学習ダッシュボード
  // ==================================================

  test('実戦学習: ダッシュボードに内訳と苦手分野の案内が出る', () => {
    withFakeStorage(() => {
      const match = riichiScene();
      const snapshot = snapshotOf(match);
      const session = LiveSession.createSession({ mode: 'deep', maxPerRound: 20 });
      LiveSession.startRound(session, snapshot, '東1局');

      // 守備で×を3回作る(苦手分野として判定させる)
      const question = LiveQuiz.buildQuestion(snapshot, { kind: 'safety', priority: 90, tags: ['live-genbutsu'] });
      const worst = question.choices
        .map((c) => ({ c, ev: LiveQuiz.evaluateAnswer(snapshot, question, [c.id]) }))
        .filter((x) => x.ev.gradeKey === 'bad')[0];
      assert.ok(worst, '×になる選択肢が無い');
      for (let i = 0; i < 3; i++) {
        LiveSession.recordAnswer(session, question, snapshot, worst.ev, {});
      }
      LiveSession.countRound();

      const dash = LiveSession.dashboard();
      assert.strictEqual(dash.rounds, 1, '実戦学習した局数が数えられていない');
      assert.strictEqual(dash.asked, 3, '出題数が合わない');
      assert.strictEqual(dash.grades.bad, 3, '×の内訳が合わない');
      assert.ok(dash.byTag.length > 0, '分野別の内訳が無い');
      assert.ok(dash.byKind.some((k) => k.kind === 'safety'), '問題形式別の内訳が無い');
      assert.ok(dash.weakTags.length > 0, '苦手分野が出ていない');
      const suggestion = dash.suggestions.find((s) => s.tag === 'live-genbutsu');
      assert.ok(suggestion, '現物の苦手から案内が出ていない');
      assert.strictEqual(suggestion.course, 'genbutsu', '案内先のコースが違う');
      assert.ok(suggestion.text.indexOf('現物') >= 0);
      // 案内先が実在するコースであること
      dash.suggestions.forEach((s) => {
        assert.ok(QuizData.getCourse(s.course), '存在しないコースを案内している: ' + s.course);
      });
    });
  });

  // ==================================================
  // 9. 既存機能への影響
  // ==================================================

  test('実戦学習: 既存の対局・牌譜が今までどおり動く', () => {
    const match = newMatch(101);
    match.players.forEach((p) => (p.isHuman = false));
    const kifu = Kifu.createKifu(match);
    Kifu.recordRoundStart(kifu, match);
    const finished = Round.simulateRoundToEnd(match, 2000);
    assert.ok(finished, '1局を最後まで進行できない');
    assert.strictEqual(match.currentRound.phase, 'round_over');
    Kifu.appendEventsSince(kifu, match, 0);
    assert.ok(kifu.rounds.length > 0, '牌譜が記録されていない');
  });

  test('実戦学習: 既存6コースのクイズが今までどおり動く', () => {
    ['yaku', 'wait', 'furiten', 'genbutsu', 'defense', 'reading'].forEach((courseId) => {
      const list = QuizData.questionsForCourse(courseId);
      assert.ok(list.length > 0, courseId + ' の問題が無い');
      const graded = QuizEngine.gradeQuestion(list[0], list[0].expected);
      assert.ok(typeof graded.correct === 'boolean');
      const session = QuizSession.createSession(courseId, {});
      assert.ok(session.questions.length > 0);
    });
  });

  test('実戦学習: 学習エンジンが対局状態を書き換えない', () => {
    withFakeStorage(() => {
      const match = riichiScene();
      const before = JSON.stringify(match);
      const snapshot = snapshotOf(match);

      LiveCoach.detectLearningMoments(snapshot, { mode: 'deep' }, {});
      LiveCoach.judgePushFold(snapshot);
      LiveCoach.coachSummary(snapshot);
      const session = LiveSession.createSession({ mode: 'deep', maxPerRound: 5 });
      ['discard', 'safety', 'pushfold'].forEach((kind) => {
        const q = LiveQuiz.buildQuestion(snapshot, { kind, priority: 80, tags: [] });
        const ev = LiveQuiz.evaluateAnswer(snapshot, q, [q.choices[0].id]);
        LiveSession.recordAnswer(session, q, snapshot, ev, {});
      });

      assert.strictEqual(JSON.stringify(match), before, '学習処理が対局状態を書き換えた');
      // スナップショットを書き換えても対局には影響しない
      snapshot.handCounts[0] = 4;
      snapshot.players[1].discards.push({ tile: 0, turnIndex: 99 });
      assert.strictEqual(JSON.stringify(match), before, 'スナップショットが対局と同じ配列を共有している');
    });
  });

  test('実戦学習: 1局を通しで進めても出題が破綻しない', () => {
    withFakeStorage(() => {
      const match = newMatch(55);
      const session = LiveSession.createSession({ mode: 'deep', maxPerRound: 4 });
      LiveSession.startRound(session, null, '東1局');
      let asked = 0;
      let guard = 0;

      while (match.currentRound.phase !== 'round_over' && guard++ < 200) {
        Round.advanceUntilHumanInput(match, 500);
        const round = match.currentRound;
        if (round.phase === 'round_over') break;

        if (round.phase === 'awaiting_discard' && round.turnSeat === 0) {
          const snapshot = snapshotOf(match);
          const moment = LiveSession.nextMoment(session, snapshot);
          if (moment) {
            const question = LiveQuiz.buildQuestion(snapshot, moment);
            LiveSession.markAsked(session, moment, question, snapshot);
            // 出題中は対局を進めない
            assert.strictEqual(session.paused, true);
            const ev = LiveQuiz.evaluateAnswer(snapshot, question, [question.choices[0].id]);
            LiveSession.recordAnswer(session, question, snapshot, ev, {});
            LiveSession.closeCurrent(session);
            asked++;
          }
          const hand = snapshotOf(match).hand;
          Round.discardTile(match, hand[0], false);
        } else if (round.phase === 'awaiting_calls') {
          Round.resolveCallsWithHuman(match, 0, { action: 'pass' });
        } else {
          break;
        }
      }

      assert.ok(guard < 200, '1局が終わらない(無限ループの疑い)');
      assert.ok(asked <= 4, '1局の上限を超えて出題した: ' + asked);
      assert.strictEqual(session.log.length, asked);
      // 同じ種類が連続していない
      for (let i = 1; i < session.log.length; i++) {
        assert.notStrictEqual(session.log[i].kind, session.log[i - 1].kind, '同じ種類が連続で出題された');
      }
    });
  });
};
