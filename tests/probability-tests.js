/**
 * tests/probability-tests.js
 * probability.js の確率計算のテスト。tests/run.js から読み込んで実行する。
 */
module.exports = function registerProbabilityTests(ctx) {
  const { test, assert, Probability } = ctx;

  console.log('== probability.js: 確率計算 ==');

  test('nextDrawProbability: 待ち1枚・4枚・8枚で残り枚数に比例した確率になる', () => {
    const unseen = 100;
    const p1 = Probability.nextDrawProbability(1, unseen);
    const p4 = Probability.nextDrawProbability(4, unseen);
    const p8 = Probability.nextDrawProbability(8, unseen);
    assert.ok(Math.abs(p1 - 1 / 100) < 1e-9);
    assert.ok(Math.abs(p4 - 4 / 100) < 1e-9);
    assert.ok(Math.abs(p8 - 8 / 100) < 1e-9);
    assert.ok(p8 > p4 && p4 > p1, '枚数が多いほど確率が高くなるべき');
  });

  test('見えている牌による残り枚数の減少を正しく反映する', () => {
    // 見えている牌が増える(unseenTotalが減る)ほど、同じ枚数でも確率は上がる
    const wide = Probability.nextDrawProbability(5, 120);
    const narrow = Probability.nextDrawProbability(5, 40);
    assert.ok(narrow > wide, '見えていない牌が少ないほど、同じ枚数でも引く確率は上がるはず');
  });

  test('待ち0枚なら常に0%', () => {
    assert.strictEqual(Probability.nextDrawProbability(0, 80), 0);
    assert.strictEqual(Probability.atLeastOneProbability(0, 80, 5), 0);
  });

  test('有効牌が全て見えている(残り0枚)場合は0%', () => {
    assert.strictEqual(Probability.nextDrawProbability(5, 0), 0);
  });

  test('次の1回・3回以内・5回以内は正しい大小関係になり、組み合わせ計算で単純な掛け算にならない', () => {
    const w = Probability.drawWindow(7, 70);
    assert.ok(w.next < w.within3);
    assert.ok(w.within3 < w.within5);
    // 単純な「1回の確率×回数」は7/70*5=50%だが、重複を考慮した正しい計算ではそれより低くなる
    const naiveMultiply = (7 / 70) * 5;
    assert.ok(w.within5 < naiveMultiply, '重複を考慮せず単純に掛け算しているとより大きい値になってしまう');
    assert.ok(w.within5 > w.next, '5回以内の確率は1回の確率より高いはず');
  });

  test('atLeastOneProbability: 手計算した超幾何分布の値と一致する', () => {
    // unseen=10枚中、欲しい牌が3枚。2回引いて少なくとも1枚の確率。
    // P(0枚) = C(7,2)/C(10,2) = 21/45 = 7/15 → P(1枚以上) = 8/15
    const p = Probability.atLeastOneProbability(3, 10, 2);
    assert.ok(Math.abs(p - 8 / 15) < 1e-9, '実際の値: ' + p);
  });

  test('draws回数がunseenTotalを超えても異常な値(1を超える等)にならない', () => {
    const p = Probability.atLeastOneProbability(5, 10, 50);
    assert.ok(p >= 0 && p <= 1);
  });

  test('improvementProbability / tsumoProbability: ukeireTotal・waitTotalから確率一式を計算する', () => {
    const info = Probability.improvementProbability({ ukeireTotal: 20 }, null, new Array(34).fill(0).map((_, i) => (i < 14 ? 1 : 0)));
    assert.ok(info.unseenTotal > 0);
    assert.ok(info.next > 0 && info.next < 1);
    assert.strictEqual(info.basis, 'hand-only');

    const visible = new Array(34).fill(0);
    visible[0] = 4; // 1萬が場に4枚見えている
    const tsumoInfo = Probability.tsumoProbability(7, visible);
    assert.strictEqual(tsumoInfo.basis, 'observed');
    assert.ok(tsumoInfo.unseenTotal === 136 - 4);
  });

  test('describeAsFrequency: パーセントを「だいたい何回に1回」に変換する(補助情報)', () => {
    assert.strictEqual(Probability.describeAsFrequency(0), null);
    assert.ok(Probability.describeAsFrequency(0.1).indexOf('10回に1回') !== -1);
    assert.ok(Probability.describeAsFrequency(0.25).indexOf('4回に1回') !== -1);
    assert.ok(Probability.describeAsFrequency(0.999).indexOf('ほぼ確実') !== -1);
  });

  test('フリテンでもツモ確率は0にならない(ロン不可とツモ確率を混同しない)', () => {
    // フリテン状態自体はFuriten.jsが判定するが、probability.js側は「ロン可否」を一切知らない。
    // 待ち牌の残り枚数さえあれば、フリテンかどうかに関わらず確率は正の値になることを確認する。
    const waitTotal = 7; // フリテンでも待ち牌の物理的な残り枚数は変わらない
    const p = Probability.nextDrawProbability(waitTotal, 80);
    assert.ok(p > 0, 'フリテンであってもツモで引く確率自体は0にならないはず');
  });

  test('ロン不可(0%)とツモ確率を混同しない: 呼び出し側でロン可否と確率を別々に扱えること', () => {
    // probability.js はロン可否を返さない(canRonなどのプロパティを一切持たない)ことを確認する
    const result = Probability.tsumoProbability(7, null, new Array(34).fill(0));
    assert.strictEqual(result.canRon, undefined, 'probability.jsがロン可否を返してはいけない(furiten.jsの責務)');
    assert.ok(result.next > 0);
  });

  test('toPercentLabel: 小数第1位までのパーセント表示になる', () => {
    assert.strictEqual(Probability.toPercentLabel(0.184), '18.4%');
    assert.strictEqual(Probability.toPercentLabel(1), '100.0%');
    assert.strictEqual(Probability.toPercentLabel(0), '0.0%');
  });
};
