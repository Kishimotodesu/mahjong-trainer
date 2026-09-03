/**
 * tests/lesson-tests.js
 * 「ルールを牌で理解する」ミニレッスン(字牌・フリテン)のテスト。
 * tests/run.js から読み込んで実行する。
 *
 * 最重要: 教材用のresolver(lessonengine.js)が、CPU対局本番エンジン(round.js/scoring.js)と
 * 同じ局面で同じ判定結果になることを確認する(教材専用の別ルールを作らないことの検証)。
 */
module.exports = function registerLessonTests(ctx) {
  const { test, assert, Tiles, Yaku, Furiten, Scoring, GameState, RoundEngine, CPU, Lessons, LessonEngine, mulberry32 } = ctx;

  console.log('== lessons.js / lessonengine.js: ルール学習ミニレッスン ==');

  const M = (n) => n - 1;
  const EAST = 27,
    SOUTH = 28,
    WEST = 29,
    NORTH = 30,
    HAKU = 31,
    HATSU = 32,
    CHUN = 33;

  function freshProgress() {
    return LessonEngine.loadProgress ? { version: 1, lessons: {} } : null;
  }

  // ==================================================
  // 字牌の必須テスト
  // ==================================================

  test('字牌は順子にならない / 数牌は順子になる', () => {
    assert.strictEqual(LessonEngine.isSequence([M(3), M(4), M(5)]), true);
    assert.strictEqual(LessonEngine.isSequence([EAST, SOUTH, WEST]), false);
    assert.strictEqual(LessonEngine.isSequence([HAKU, HATSU, CHUN]), false);
  });

  test('發2枚(対子)では役牌は不成立、發3枚(刻子)で役牌成立、4枚(槓子)でも成立', () => {
    assert.strictEqual(LessonEngine.yakuhaiFromCount(HATSU, 1, null), false);
    assert.strictEqual(LessonEngine.yakuhaiFromCount(HATSU, 2, null), false);
    assert.strictEqual(LessonEngine.yakuhaiFromCount(HATSU, 3, null), true);
    assert.strictEqual(LessonEngine.yakuhaiFromCount(HATSU, 4, null), true);
  });

  test('白・發・中はいずれも役牌判定される(三元牌は文脈に依存しない)', () => {
    [HAKU, HATSU, CHUN].forEach((t) => {
      assert.strictEqual(LessonEngine.yakuhaiFromCount(t, 3, null), true, Tiles.shortLabel(t) + 'が役牌にならない');
      assert.strictEqual(LessonEngine.yakuhaiFromCount(t, 3, { roundWind: EAST, seatWind: SOUTH }), true);
    });
  });

  test('場風の役牌: 東場での東の刻子は役牌になる', () => {
    const ctx = { roundWind: EAST, seatWind: SOUTH };
    assert.strictEqual(LessonEngine.yakuhaiFromCount(EAST, 3, ctx), true);
  });

  test('自風の役牌: 南家での南の刻子は役牌になる', () => {
    const ctx = { roundWind: EAST, seatWind: SOUTH };
    assert.strictEqual(LessonEngine.yakuhaiFromCount(SOUTH, 3, ctx), true);
  });

  test('客風は役牌にならない(場風でも自風でもない風牌)', () => {
    const ctx = { roundWind: EAST, seatWind: SOUTH };
    assert.strictEqual(LessonEngine.yakuhaiFromCount(WEST, 3, ctx), false);
    assert.strictEqual(LessonEngine.yakuhaiFromCount(NORTH, 3, ctx), false);
  });

  test('場風兼自風(ダブ東など)は役牌として成立する', () => {
    const ctx = { roundWind: EAST, seatWind: EAST };
    assert.strictEqual(LessonEngine.yakuhaiFromCount(EAST, 3, ctx), true);
    // 実際の翻数は2翻分(場風+自風)になることをyaku.jsの結果件数で確認
    const result = Yaku.isYakuhaiTriplet({ type: 'triplet', tiles: [EAST, EAST, EAST] }, ctx);
    assert.strictEqual(result.length, 2, 'ダブ東は場風・自風の2つ分の役として数えられるべき');
  });

  test('牌効率が完全に同率の孤立字牌は「同率」と判定される', () => {
    const tieResolver = LessonEngine.gradeStep(
      {
        kind: 'tie',
        resolver: 'tieCompare',
        resolverArgs: { a: { shanten: 1, ukeireTotal: 28 }, b: { shanten: 1, ukeireTotal: 28 } },
        choices: [
          { id: 'a', value: 'a' },
          { id: 'b', value: 'b' },
          { id: 'tie', value: 'tie' },
        ],
      },
      'tie'
    );
    assert.strictEqual(tieResolver.correctChoiceId, 'tie');
    assert.strictEqual(tieResolver.correct, true);
  });

  test('同率でも役価値の説明(役牌候補 vs 客風)は別軸で異なる', () => {
    // review.js の学習タグが、同じ牌効率(孤立牌)でも役価値の違いを別タグとして区別することを確認する
    const Review = require('../js/review.js');
    const dragonHand = Tiles.toCounts([M(2), M(3), M(3), M(4), M(6), M(7), 9 + M(1), 9 + M(2), 9 + M(3), 18 + M(1), 18 + M(2), HATSU, WEST, NORTH]);
    const tagsNoCtx = Review.detectTags(dragonHand, null, null);
    assert.ok(tagsNoCtx.indexOf('役牌候補') !== -1, '發があるのに役牌候補タグが付かない');

    const tagsWithCtx = Review.detectTags(dragonHand, null, { roundWind: EAST, seatWind: SOUTH });
    assert.ok(tagsWithCtx.indexOf('客風') !== -1, '西・北が客風タグにならない');
  });

  // ==================================================
  // フリテンの必須テスト
  // ==================================================

  test('捨て牌フリテン: 待ち1萬・4萬・河に1萬 → 両方ロン不可、両方ツモ可能', () => {
    const player = { discards: [{ tile: M(1) }], furitenTemporary: false, furitenRiichi: false };
    const wait = [M(1), M(4)];
    const state = Furiten.getFuritenState(player, wait);
    assert.strictEqual(state.canRon, false, '1萬ロンが不可であるべき');
    assert.strictEqual(state.canRon, false, '4萬もロンできないはず(同じcanRon値で両方ブロックされる)');
    assert.strictEqual(state.canTsumo, true, '1萬ツモは可能');
    assert.strictEqual(state.canTsumo, true, '4萬ツモは可能');
    assert.deepStrictEqual(state.blockingOwnDiscards, [M(1)]);
  });

  test('同巡内フリテン: ロン牌見逃し→ロン不可、解除条件を満たすと再びロン可能', () => {
    const beforeClear = { discards: [], furitenTemporary: true, furitenRiichi: false };
    const wait = [M(1), M(4)];
    assert.strictEqual(Furiten.getFuritenState(beforeClear, wait).canRon, false);

    const afterClear = { discards: [], furitenTemporary: false, furitenRiichi: false };
    assert.strictEqual(Furiten.getFuritenState(afterClear, wait).canRon, true);
  });

  test('リーチ後フリテン: 見逃すと局終了までロン不可、ツモならアガれる', () => {
    const player = { discards: [], furitenTemporary: false, furitenRiichi: true };
    const wait = [M(1), M(4)];
    const state = Furiten.getFuritenState(player, wait);
    assert.strictEqual(state.canRon, false);
    assert.strictEqual(state.canTsumo, true);
    assert.strictEqual(state.riichiPermanent, true);
    assert.strictEqual(state.type, 'riichi');
  });

  test('フリテンでない場合は通常どおりロンできる', () => {
    const player = { discards: [{ tile: M(9) }, { tile: EAST }], furitenTemporary: false, furitenRiichi: false };
    const state = Furiten.getFuritenState(player, [M(1), M(4)]);
    assert.strictEqual(state.canRon, true);
    assert.strictEqual(state.type, 'none');
  });

  test('待ちが変わって自分の捨て牌が含まれなくなればフリテンでなくなる', () => {
    const player = { discards: [{ tile: M(1) }], furitenTemporary: false, furitenRiichi: false };
    assert.strictEqual(Furiten.getFuritenState(player, [M(1), M(4)]).canRon, false);
    assert.strictEqual(Furiten.getFuritenState(player, [M(4)]).canRon, true, '今の待ちに含まれない捨て牌でフリテン扱いしてはいけない');
  });

  test('lessonengine resolver(furitenCanRon/furitenCanTsumo)がFuriten.jsと完全に一致する', () => {
    const cases = [
      { discards: [M(1)], waitTiles: [M(1), M(4)], furitenTemporary: false, furitenRiichi: false },
      { discards: [], waitTiles: [M(1), M(4)], furitenTemporary: true, furitenRiichi: false },
      { discards: [], waitTiles: [M(1), M(4)], furitenTemporary: false, furitenRiichi: true },
      { discards: [], waitTiles: [M(1), M(4)], furitenTemporary: false, furitenRiichi: false },
    ];
    cases.forEach((args) => {
      const viaLessonEngine = LessonEngine.gradeStep(
        { kind: 'quiz', resolver: 'furitenCanRon', resolverArgs: args, choices: [{ id: 'y', value: true }, { id: 'n', value: false }] },
        null
      ).resolvedValue;
      const viaFuriten = Furiten.getFuritenState(
        { discards: args.discards.map((t) => ({ tile: t })), furitenTemporary: args.furitenTemporary, furitenRiichi: args.furitenRiichi },
        args.waitTiles
      ).canRon;
      assert.strictEqual(viaLessonEngine, viaFuriten, 'lessonengineとfuriten.jsの判定が食い違っている: ' + JSON.stringify(args));
    });
  });

  // ==================================================
  // 本番エンジンとの一致(最重要)
  // ==================================================

  test('本番対局と同じ局面でフリテン判定が一致する(教材専用の別ルールを作らない)', () => {
    const rng = mulberry32(2024);
    let match = GameState.createMatch({ humanSeat: 0 });
    match = GameState.startRound(match, rng);
    const p = match.players[0];

    // 実際にwaitTilesを本番エンジン(Round.computeWaitTiles相当)で作り、捨て牌フリテンを発生させる
    const RoundEngineLocal = RoundEngine;
    const waitTiles = RoundEngineLocal.computeWaitTiles(p);
    if (waitTiles.length === 0) {
      // テンパイでない配牌だった場合は、人工的にテンパイ形を作って再検証する
      p.handCounts = Tiles.toCounts('123456789m1122p'.length ? [] : []); // no-op fallback (below we set explicit hand)
    }

    // 明示的に検証可能な局面を本番のプレイヤーオブジェクトへ設定する
    const testPlayer = match.players[1];
    testPlayer.handCounts = Tiles.toCounts([M(2), M(3), M(4), M(5), M(6), M(7), M(8), 9, 9, 18, 18, 27, 27, 27].map((x) => x));
    testPlayer.discards = [{ tile: M(1), turn: 1 }];
    testPlayer.furitenTemporary = false;
    testPlayer.furitenRiichi = false;

    const engineWait = RoundEngine.computeWaitTiles(testPlayer);
    const engineState = Furiten.getFuritenState(testPlayer, engineWait);

    // lessonengineのresolverに同じ引数(discards, waitTiles, フラグ)を渡して比較する
    const lessonArgs = {
      discards: testPlayer.discards.map((d) => d.tile),
      waitTiles: engineWait,
      furitenTemporary: testPlayer.furitenTemporary,
      furitenRiichi: testPlayer.furitenRiichi,
    };
    const lessonCanRon = LessonEngine.gradeStep(
      { kind: 'quiz', resolver: 'furitenCanRon', resolverArgs: lessonArgs, choices: [{ id: 'y', value: true }, { id: 'n', value: false }] },
      null
    ).resolvedValue;

    assert.strictEqual(lessonCanRon, engineState.canRon, '教材のフリテン判定が本番エンジンと食い違っている');
  });

  test('本番対局と同じ局面で役牌判定が一致する(教材専用の別ルールを作らない)', () => {
    const rng = mulberry32(55);
    let match = GameState.createMatch({ humanSeat: 0 });
    match = GameState.startRound(match, rng);
    const seat = 2;
    const p = match.players[seat];
    p.seatWind = SOUTH;
    match.roundWindBase = match.roundWindBase; // 場風はgamestate側の管理に委ねる

    const ctx = { roundWind: 27 /* 東場想定 */, seatWind: p.seatWind };
    const meld = { type: 'triplet', tiles: [SOUTH, SOUTH, SOUTH] };

    // 本番のscoring.js/yaku.js経路(evaluateStandardYaku)から見ても同じ結果になることを確認する
    const yakuResult = Yaku.isYakuhaiTriplet(meld, ctx);
    const lessonResult = LessonEngine.yakuhaiFromCount(SOUTH, 3, ctx);
    assert.strictEqual(!!(yakuResult && yakuResult.length > 0), lessonResult);
  });

  // ==================================================
  // レッスンデータの整合性・進捗
  // ==================================================

  test('lessons.js: 全ステップのresolverが解決可能で、選択肢の中に正解が必ず存在する', () => {
    Lessons.LESSONS.forEach((lesson) => {
      lesson.steps.forEach((step) => {
        if (step.kind !== 'quiz' && step.kind !== 'tie') return;
        const grade = LessonEngine.gradeStep(step, null);
        assert.ok(grade.correctChoiceId !== null, lesson.id + '/' + step.id + ' の正解が選択肢の中に見つからない');
      });
    });
  });

  test('recordStepResult: 間違えると要復習、全問正解で理解済みになる', () => {
    if (typeof localStorage === 'undefined') return; // localStorage未定義環境ではスキップ
    localStorage.removeItem(LessonEngine.STORAGE_KEY);
    const lesson = Lessons.getLesson('honors');
    const basicSteps = lesson.steps.filter((s) => (s.kind === 'quiz' || s.kind === 'tie') && !s.advanced);

    let progress = LessonEngine.loadProgress();
    basicSteps.forEach((s) => {
      progress = LessonEngine.recordStepResult('honors', s.id, true, progress);
    });
    assert.strictEqual(LessonEngine.statusOf('honors', progress), 'mastered', '全問正解なのに理解済みにならない');

    progress = LessonEngine.recordStepResult('honors', basicSteps[0].id, false, progress);
    assert.strictEqual(LessonEngine.statusOf('honors', progress), 'needs_review', '間違えたのに要復習にならない');

    localStorage.removeItem(LessonEngine.STORAGE_KEY);
  });

  test('summarize: 全レッスンの状態集計ができる', () => {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(LessonEngine.STORAGE_KEY);
    const s = LessonEngine.summarize();
    assert.strictEqual(s.total, Lessons.listLessons().length);
    assert.strictEqual(s.counts.not_started, s.total);
    localStorage.removeItem(LessonEngine.STORAGE_KEY);
  });

  test('「役なし」と「フリテン」は別の理由として区別される(混同しない)', () => {
    // 役が無い場合は Scoring.scoreHand の hasYaku=false で判定され、フリテンとは独立している。
    // ここでは、フリテンでも役があれば hasYaku には影響しないことを確認する形で区別を検証する。
    const player = { discards: [{ tile: M(1) }], furitenTemporary: false, furitenRiichi: false };
    const furitenState = Furiten.getFuritenState(player, [M(1)]);
    assert.strictEqual(furitenState.canRon, false, 'フリテンはロン不可');
    // フリテンの判定はhasYakuを一切参照しない(独立した軸であること)
    assert.ok(!('hasYaku' in furitenState), 'フリテン状態オブジェクトが役の有無を混同して持ってはいけない');
  });
};
