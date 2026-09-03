/**
 * tests/run.js
 * 依存ライブラリなしの簡易テストランナー。
 * 実行方法: node tests/run.js
 */
const assert = require('assert');
const path = require('path');

const Tiles = require(path.join(__dirname, '..', 'js', 'tiles.js'));
const Shanten = require(path.join(__dirname, '..', 'js', 'shanten.js'));
const Ukeire = require(path.join(__dirname, '..', 'js', 'ukeire.js'));
const Evaluator = require(path.join(__dirname, '..', 'js', 'evaluator.js'));
const Game = require(path.join(__dirname, '..', 'js', 'game.js'));
const HandInfo = require(path.join(__dirname, '..', 'js', 'handinfo.js'));
const HandBuilder = require(path.join(__dirname, '..', 'js', 'handbuilder.js'));
const Decomposition = require(path.join(__dirname, '..', 'js', 'decomposition.js'));
const Dora = require(path.join(__dirname, '..', 'js', 'dora.js'));
const Yaku = require(path.join(__dirname, '..', 'js', 'yaku.js'));
const Scoring = require(path.join(__dirname, '..', 'js', 'scoring.js'));
const YakuCandidates = require(path.join(__dirname, '..', 'js', 'yakucandidates.js'));
const GameState = require(path.join(__dirname, '..', 'js', 'gamestate.js'));
const RoundEngine = require(path.join(__dirname, '..', 'js', 'round.js'));
const Furiten = require(path.join(__dirname, '..', 'js', 'furiten.js'));
const Safety = require(path.join(__dirname, '..', 'js', 'safety.js'));
const PushFold = require(path.join(__dirname, '..', 'js', 'pushfold.js'));
const CPU = require(path.join(__dirname, '..', 'js', 'cpu.js'));
const Kifu = require(path.join(__dirname, '..', 'js', 'kifu.js'));
const Coach = require(path.join(__dirname, '..', 'js', 'coach.js'));

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const { crosscheckStandardShanten } = require(path.join(__dirname, 'shanten-crosscheck.js'));

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  OK  ${name}`);
  } catch (e) {
    failed++;
    console.log(`  NG  ${name}`);
    console.log(`      ${e.message}`);
  }
}

/**
 * "123456789m11p22p1234567z" のような簡易記法を牌インデックス配列に変換する。
 * m=萬子, p=筒子, s=索子, z=字牌(1東 2南 3西 4北 5白 6發 7中)
 */
function parseHand(str) {
  const tiles = [];
  const re = /(\d+)([mpsz])/g;
  let match;
  while ((match = re.exec(str))) {
    const nums = match[1].split('').map(Number);
    const suit = match[2];
    for (const n of nums) {
      let idx;
      if (suit === 'm') idx = n - 1;
      else if (suit === 'p') idx = 9 + (n - 1);
      else if (suit === 's') idx = 18 + (n - 1);
      else idx = 26 + n; // z
      tiles.push(idx);
    }
  }
  return tiles;
}

function countsOf(str) {
  return Tiles.toCounts(parseHand(str));
}

// ==================================================
// tiles.js
// ==================================================
console.log('== tiles.js ==');

test('shortLabel: 数牌', () => {
  assert.strictEqual(Tiles.shortLabel(0), '1萬');
  assert.strictEqual(Tiles.shortLabel(9), '1筒');
  assert.strictEqual(Tiles.shortLabel(18), '1索');
});

test('shortLabel: 字牌', () => {
  assert.strictEqual(Tiles.shortLabel(27), '東');
  assert.strictEqual(Tiles.shortLabel(31), '白');
  assert.strictEqual(Tiles.shortLabel(33), '中');
});

test('fullName: 正式名称', () => {
  assert.strictEqual(Tiles.fullName(4), '五萬');
  assert.strictEqual(Tiles.fullName(26), '九索');
  assert.strictEqual(Tiles.fullName(32), '發');
});

test('toCounts / toTileList は往復できる', () => {
  const tiles = parseHand('123456789m11p22p');
  const counts = Tiles.toCounts(tiles);
  const back = Tiles.toTileList(counts);
  assert.strictEqual(back.length, 13);
  assert.deepStrictEqual(back, tiles.slice().sort((a, b) => a - b));
});

// ==================================================
// shanten.js
// ==================================================
console.log('== shanten.js ==');

test('完成形(4面子+雀頭)はシャンテン数-1(アガリ)', () => {
  const counts = countsOf('123456789m123p11s');
  const result = Shanten.calcShanten(counts);
  assert.strictEqual(result.shanten, -1);
});

test('シャンポン待ちのテンパイはシャンテン数0', () => {
  const counts = countsOf('123456789m11p22p');
  const result = Shanten.calcShanten(counts);
  assert.strictEqual(result.shanten, 0);
});

test('3面子+雀頭+孤立牌2枚は1シャンテン', () => {
  const counts = countsOf('123456789m11p1s9s');
  const result = Shanten.calcShanten(counts);
  assert.strictEqual(result.shanten, 1);
});

test('七対子の完成形はシャンテン数-1', () => {
  const counts = countsOf('11223344556677m');
  const result = Shanten.calcShanten(counts);
  assert.strictEqual(result.shanten, -1);
});

test('七対子のテンパイ(6対子+浮き牌1枚)はシャンテン数0', () => {
  const counts = countsOf('1122334455667m');
  const result = Shanten.calcShanten(counts);
  assert.strictEqual(result.shanten, 0);
});

test('国士無双の13面待ちテンパイはシャンテン数0', () => {
  const counts = countsOf('19m19p19s1234567z');
  const result = Shanten.calcShanten(counts);
  assert.strictEqual(result.shanten, 0);
  assert.strictEqual(result.type, 'kokushi');
});

test('国士無双の完成形はシャンテン数-1', () => {
  const counts = countsOf('119m19p19s1234567z');
  const result = Shanten.calcShanten(counts);
  assert.strictEqual(result.shanten, -1);
});

test('通常のバラバラな手はシャンテン数が3〜8程度の範囲に収まる', () => {
  // 1m,4m,7m,1p,4p,7p,1s,4s,7s,東,南,西,北 (互いに孤立した13枚)
  const tiles = [0, 3, 6, 9, 12, 15, 18, 21, 24, 27, 28, 29, 30];
  const c = Tiles.toCounts(tiles);
  const result = Shanten.calcShanten(c);
  assert.ok(result.shanten >= 3 && result.shanten <= 8, `shanten=${result.shanten}`);
});

// ---- V1.1: 複合形・七対子/国士無双との競合・多対子・多面子のケースを追加 ----
console.log('== shanten.js (V1.1 追加ケース: 複合形・競合形) ==');

test('複合形: 3445萬(両面が2つ重なる形)は他が完成していれば1シャンテン', () => {
  // 123456789m(3面子)+123456p(2面子)+11z(雀頭)+3445m は作れないので構成し直す:
  // 123456p(2面子)+11z(雀頭)+3445m(両面3-4と4-5の複合)+9s(孤立)
  const counts = countsOf('3445m123456p11z9s');
  const result = Shanten.calcShanten(counts);
  assert.strictEqual(result.shanten, 1);
  assert.strictEqual(result.shanten, crosscheckStandardShanten(counts));
});

test('複合形: 55667788萬(2つの両面が連結した形)はテンパイ', () => {
  const counts = countsOf('55667788m123p11s');
  const result = Shanten.calcShanten(counts);
  assert.strictEqual(result.shanten, 0);
  assert.strictEqual(result.shanten, crosscheckStandardShanten(counts));
});

test('複合形: 1112345678999萬(純全帯幺系の広い形)はテンパイ', () => {
  const counts = countsOf('1112345678999m');
  const result = Shanten.calcShanten(counts);
  assert.strictEqual(result.shanten, 0);
  assert.strictEqual(result.shanten, crosscheckStandardShanten(counts));
});

test('複合形: 1234567888999索(清一色に近い広い形)はテンパイ', () => {
  const counts = countsOf('1234567888999s');
  const result = Shanten.calcShanten(counts);
  assert.strictEqual(result.shanten, 0);
  assert.strictEqual(result.shanten, crosscheckStandardShanten(counts));
});

test('多面子: 111222333萬(3刻子)+44567筒 は完成形(アガリ)', () => {
  const counts = countsOf('111222333m44567p');
  const result = Shanten.calcShanten(counts);
  assert.strictEqual(result.shanten, -1);
  assert.strictEqual(result.type, 'standard');
});

test('多対子(3個): 123萬+11筒22筒33索44北+9萬9筒(孤立2枚)は2シャンテン', () => {
  // 頭を1組、残り3対子をすべて「刻子候補(搭子)」として使うケース
  // (対子を対子のまま2つ以上活かす、V1.1で修正したロジックの確認)
  const counts = countsOf('123m11p22p33s44z9m9p');
  const result = Shanten.calcShanten(counts);
  assert.strictEqual(result.shanten, 2);
  assert.strictEqual(result.shanten, crosscheckStandardShanten(counts));
});

test('七対子との競合: 123萬+東南西北白の対子5組は七対子が標準形より有利(1シャンテン)', () => {
  const counts = countsOf('123m1122334455z');
  const result = Shanten.calcShanten(counts);
  assert.strictEqual(result.type, 'chiitoitsu');
  assert.strictEqual(result.shanten, 1);
  // 標準形としての解釈(通常手のみのシャンテン)はより悪い(2)ことも確認する
  assert.strictEqual(crosscheckStandardShanten(counts), 2);
});

test('七対子との競合: 対子が2つあっても標準形の方が有利な場合は標準形が採用される', () => {
  // 123456789萬(3面子)+11筒22筒(頭+搭子) は標準形でテンパイ(0)だが、
  // 七対子として見ると対子2つ・種類11でシャンテン4と大きく劣る
  const counts = countsOf('123456789m1122p');
  const result = Shanten.calcShanten(counts);
  assert.strictEqual(result.type, 'standard');
  assert.strictEqual(result.shanten, 0);
  assert.strictEqual(Shanten.chiitoitsuShanten(counts), 4);
});

test('多対子(シャボ待ちの筒子版): 111222333筒(3刻子)+44筒+55索 はテンパイ(シャボ)', () => {
  const counts = countsOf('11122233344p55s');
  const result = Shanten.calcShanten(counts);
  assert.strictEqual(result.shanten, 0);
  assert.strictEqual(result.shanten, crosscheckStandardShanten(counts));
});

test('国士無双との競合: 么九牌ばかりの手は国士無双が標準形・七対子より圧倒的に有利', () => {
  const counts = countsOf('19m19p19s1234567z');
  const result = Shanten.calcShanten(counts);
  assert.strictEqual(result.type, 'kokushi');
  assert.strictEqual(result.shanten, 0);
  assert.ok(crosscheckStandardShanten(counts) > result.shanten);
  assert.ok(Shanten.chiitoitsuShanten(counts) > result.shanten);
});

test('クロスチェック: 独立実装したアルゴリズムでランダムな手のシャンテン数が一致する(通常手)', () => {
  let mismatches = 0;
  for (let i = 0; i < 500; i++) {
    const total = 13 + (i % 2);
    const counts = new Array(34).fill(0);
    let placed = 0;
    while (placed < total) {
      const t = Math.floor(Math.random() * 34);
      if (counts[t] < 4) {
        counts[t]++;
        placed++;
      }
    }
    const prod = Shanten.standardShanten(counts).shanten;
    const cross = crosscheckStandardShanten(counts);
    if (prod !== cross) mismatches++;
  }
  assert.strictEqual(mismatches, 0, `${mismatches}件の不一致がありました`);
});

test('クロスチェック: 字牌・単一スートに偏った手でも独立実装と一致する', () => {
  const honorPool = Array.from({ length: 7 }, (_, i) => 27 + i);
  const onesuitPool = Array.from({ length: 9 }, (_, i) => i);
  const fewTypesPool = [0, 1, 2, 9, 10, 27, 28];
  const pools = [honorPool.concat([0, 1, 2, 9, 10]), onesuitPool, fewTypesPool];

  let mismatches = 0;
  let tested = 0;
  for (let i = 0; i < 300; i++) {
    const total = 13 + (i % 2);
    const pool = pools[i % pools.length];
    const counts = new Array(34).fill(0);
    let placed = 0;
    let attempts = 0;
    while (placed < total && attempts < 5000) {
      attempts++;
      const t = pool[Math.floor(Math.random() * pool.length)];
      if (counts[t] < 4) {
        counts[t]++;
        placed++;
      }
    }
    if (placed !== total) continue;
    tested++;
    const prod = Shanten.standardShanten(counts).shanten;
    const cross = crosscheckStandardShanten(counts);
    if (prod !== cross) mismatches++;
  }
  assert.ok(tested > 100, `十分な件数を検証できませんでした(${tested}件)`);
  assert.strictEqual(mismatches, 0, `${mismatches}件の不一致がありました`);
});

// ==================================================
// handinfo.js (V1.1 追加: 待ち判定・アガリ形分解)
// ==================================================
console.log('== handinfo.js ==');

test('待ち判定: 両面待ち', () => {
  const wait = HandInfo.classifyWait(countsOf('123456789m11p45s'));
  assert.strictEqual(wait.shapeLabel, '両面待ち');
  assert.deepStrictEqual(wait.tiles.map((t) => t.label).sort(), ['3索', '6索']);
});

test('待ち判定: 嵌張待ち', () => {
  const wait = HandInfo.classifyWait(countsOf('123456789m11p35s'));
  assert.strictEqual(wait.shapeLabel, '嵌張待ち');
  assert.deepStrictEqual(wait.tiles.map((t) => t.label), ['4索']);
});

test('待ち判定: 辺張待ち', () => {
  const wait = HandInfo.classifyWait(countsOf('123456789m11p12s'));
  assert.strictEqual(wait.shapeLabel, '辺張待ち');
  assert.deepStrictEqual(wait.tiles.map((t) => t.label), ['3索']);
});

test('待ち判定: 単騎待ち', () => {
  const wait = HandInfo.classifyWait(countsOf('123456789m123p1s'));
  assert.strictEqual(wait.shapeLabel, '単騎待ち');
  assert.deepStrictEqual(wait.tiles.map((t) => t.label), ['1索']);
});

test('待ち判定: シャボ待ち', () => {
  const wait = HandInfo.classifyWait(countsOf('123456789m11p22p'));
  assert.strictEqual(wait.shapeLabel, 'シャボ待ち');
  assert.deepStrictEqual(wait.tiles.map((t) => t.label).sort(), ['1筒', '2筒']);
});

test('待ち判定: 七対子の単騎待ち', () => {
  const wait = HandInfo.classifyWait(countsOf('1199m1199p1199s1z'));
  assert.strictEqual(wait.type, 'chiitoitsu');
  assert.strictEqual(wait.shapeLabel, '単騎待ち(七対子)');
  assert.deepStrictEqual(wait.tiles.map((t) => t.label), ['東']);
});

test('待ち判定: 国士無双の13面待ち', () => {
  const wait = HandInfo.classifyWait(countsOf('19m19p19s1234567z'));
  assert.strictEqual(wait.type, 'kokushi');
  assert.strictEqual(wait.shapeLabel, '13面待ち(国士無双)');
  assert.strictEqual(wait.tiles.length, 13);
});

test('待ち判定: 国士無双の単騎待ち', () => {
  const wait = HandInfo.classifyWait(countsOf('119m19p19s123456z'));
  assert.strictEqual(wait.type, 'kokushi');
  assert.strictEqual(wait.shapeLabel, '単騎待ち(国士無双)');
  assert.deepStrictEqual(wait.tiles.map((t) => t.label), ['中']);
});

test('待ち判定: テンパイしていない手ではnullを返す', () => {
  const wait = HandInfo.classifyWait(countsOf('123456789m11p1s5s9s'));
  assert.strictEqual(wait, null);
});

test('アガリ形分解: 標準形は面子と雀頭に分解される', () => {
  const info = HandInfo.describeAgariHand(countsOf('123456789m123p11s'));
  assert.strictEqual(info.type, 'standard');
  assert.strictEqual(info.groups.length, 5);
  assert.ok(info.groups.some((g) => g.kind === '雀頭'));
  assert.strictEqual(info.groups.filter((g) => g.kind === '順子').length, 4);
});

test('アガリ形分解: 刻子を含む標準形も正しく分解される', () => {
  const info = HandInfo.describeAgariHand(countsOf('111222333m44567p'));
  assert.strictEqual(info.type, 'standard');
  assert.strictEqual(info.groups.filter((g) => g.kind === '刻子').length, 3);
  assert.strictEqual(info.groups.filter((g) => g.kind === '雀頭').length, 1);
  assert.strictEqual(info.groups.filter((g) => g.kind === '順子').length, 1);
});

test('アガリ形分解: 七対子は7組の対子として分解される', () => {
  const info = HandInfo.describeAgariHand(countsOf('1199m1199p1199s11z'));
  assert.strictEqual(info.type, 'chiitoitsu');
  assert.strictEqual(info.groups.length, 7);
  assert.ok(info.groups.every((g) => g.kind === '対子'));
});

test('アガリ形分解: 国士無双は13種+雀頭として分解される', () => {
  const info = HandInfo.describeAgariHand(countsOf('119m19p19s1234567z'));
  assert.strictEqual(info.type, 'kokushi');
  assert.strictEqual(info.groups.length, 13);
  assert.strictEqual(info.groups.filter((g) => g.kind === '雀頭').length, 1);
});

test('アガリ形分解: アガリでない手にはnullを返す', () => {
  const info = HandInfo.describeAgariHand(countsOf('123456789m11p1s5s9s'));
  assert.strictEqual(info, null);
});

test('形の発展: 3445萬から2萬/3萬/5萬/6萬を引いたときの変化を検出する', () => {
  const growth = HandInfo.describeShapeGrowth(countsOf('3445m123456p11z9s'));
  const manCluster = growth.find((g) => g.clusterLabel === '3445萬');
  assert.ok(manCluster, '3445萬のクラスタが検出されること');
  const drawLabels = manCluster.transitions.map((t) => t.drawLabel);
  assert.ok(drawLabels.includes('2萬'));
  assert.ok(drawLabels.includes('6萬'));
});

test('手牌ハイライト: 完成した順子と孤立牌が区別される', () => {
  const tiles = parseHand('123456789m11p159s');
  const categories = HandInfo.assignHighlights(tiles);
  assert.strictEqual(categories.length, tiles.length);
  // 123萬 (先頭3枚) は完成した面子
  assert.strictEqual(categories[0], 'meld');
  assert.strictEqual(categories[1], 'meld');
  assert.strictEqual(categories[2], 'meld');
  // 1索・5索・9索は孤立牌のはず(位置は自動整列後の末尾3つ)
  const isolatedCount = categories.filter((c) => c === 'isolated').length;
  assert.strictEqual(isolatedCount, 3);
});

// ==================================================
// handbuilder.js (V1.1 追加: 手牌分析タブの入力検証)
// ==================================================
console.log('== handbuilder.js ==');

test('addTile: 同じ牌は5枚目を追加できない', () => {
  let counts = HandBuilder.createEmptyCounts();
  for (let i = 0; i < 4; i++) counts = HandBuilder.addTile(counts, 5);
  assert.strictEqual(counts[5], 4);
  assert.strictEqual(HandBuilder.canAdd(counts, 5), false);
  const after5th = HandBuilder.addTile(counts, 5);
  assert.strictEqual(after5th[5], 4, '5枚目は追加されない');
});

test('addTile: 合計15枚目は追加できない', () => {
  let counts = HandBuilder.createEmptyCounts();
  for (let i = 0; i < 14; i++) counts = HandBuilder.addTile(counts, i % 34);
  assert.strictEqual(Tiles.totalCount(counts), 14);
  const after = HandBuilder.addTile(counts, 20);
  assert.strictEqual(Tiles.totalCount(after), 14, '14枚を超えて追加されない');
});

test('removeTile: 手牌に無い牌は取り除けない', () => {
  const counts = HandBuilder.createEmptyCounts();
  const after = HandBuilder.removeTile(counts, 3);
  assert.strictEqual(after[3], 0);
});

test('removeTile: 追加した牌を1枚ずつ取り除ける', () => {
  let counts = HandBuilder.addTile(HandBuilder.createEmptyCounts(), 10);
  counts = HandBuilder.addTile(counts, 10);
  assert.strictEqual(counts[10], 2);
  counts = HandBuilder.removeTile(counts, 10);
  assert.strictEqual(counts[10], 1);
});

test('isAnalyzable: 13枚・14枚のみ分析可能で、12枚や15枚は不可', () => {
  function withCount(n) {
    let counts = HandBuilder.createEmptyCounts();
    let placed = 0;
    let idx = 0;
    while (placed < n) {
      if (counts[idx % 34] < 4) {
        counts[idx % 34]++;
        placed++;
      }
      idx++;
    }
    return counts;
  }
  assert.strictEqual(HandBuilder.isAnalyzable(withCount(12)), false);
  assert.strictEqual(HandBuilder.isAnalyzable(withCount(13)), true);
  assert.strictEqual(HandBuilder.isAnalyzable(withCount(14)), true);
});

test('reset: 空の手牌に戻る', () => {
  let counts = HandBuilder.addTile(HandBuilder.createEmptyCounts(), 1);
  counts = HandBuilder.reset();
  assert.strictEqual(Tiles.totalCount(counts), 0);
});

// ==================================================
// ukeire.js
// ==================================================
console.log('== ukeire.js ==');

test('シャンポン待ちの有効牌は1p・2pの2種のみ', () => {
  const counts = countsOf('123456789m11p22p');
  const result = Ukeire.calcUkeire(counts);
  assert.strictEqual(result.shanten, 0);
  const tileSet = result.tiles.map((t) => t.tile).sort((a, b) => a - b);
  assert.deepStrictEqual(tileSet, [9, 10]); // 1p, 2p
  const oneP = result.tiles.find((t) => t.tile === 9);
  const twoP = result.tiles.find((t) => t.tile === 10);
  assert.strictEqual(oneP.remaining, 2); // 4 - 手牌中2枚
  assert.strictEqual(twoP.remaining, 2);
  assert.strictEqual(result.total, 4);
});

test('両面待ちの有効牌は両側2種', () => {
  // 123456789m + 11p(雀頭) + 45s(両面、3sか6sを待つ)
  const counts = countsOf('123456789m11p45s');
  const result = Ukeire.calcUkeire(counts);
  assert.strictEqual(result.shanten, 0);
  const tileSet = result.tiles.map((t) => t.tile).sort((a, b) => a - b);
  // 3s=20, 6s=23
  assert.deepStrictEqual(tileSet, [20, 23]);
});

test('嵌張待ちの有効牌は間の1種のみ', () => {
  // 123456789m + 11p(雀頭) + 35s(嵌張、4sのみを待つ)
  const counts = countsOf('123456789m11p35s');
  const result = Ukeire.calcUkeire(counts);
  assert.strictEqual(result.shanten, 0);
  const tileSet = result.tiles.map((t) => t.tile);
  assert.deepStrictEqual(tileSet, [21]); // 4s
  assert.strictEqual(result.tiles[0].resultShanten, -1); // 引けばアガリ
});

test('辺張待ちの有効牌は3のみ(1・2からの辺張)', () => {
  const counts = countsOf('123456789m11p12s');
  const result = Ukeire.calcUkeire(counts);
  assert.strictEqual(result.shanten, 0);
  const tileSet = result.tiles.map((t) => t.tile);
  assert.deepStrictEqual(tileSet, [20]); // 3s
});

// ==================================================
// evaluator.js
// ==================================================
console.log('== evaluator.js ==');

test('孤立牌を切るのが最もおすすめになる(受け入れが最大)', () => {
  // 123456789m(3面子) + 11p(雀頭) + 1s(孤立) + 9s(孤立) + 5s(孤立気味だが4s6sと繋がる可能性は無しここでは単独)
  // 14枚: 123456789m(9)+11p(2)+1s+9s+5s(3) = 14枚
  const counts = countsOf('123456789m11p159s');
  const analysis = Evaluator.analyzeHand(counts);
  // 1sか9sのどちらかが最も受け入れが広い(あるいは同等)はず
  assert.ok(analysis.recommended.ukeireTotal > 0);
  assert.ok(['1索', '9索', '5索'].includes(analysis.recommended.label));
});

test('完成した順子を崩す打牌はシャンテンを後退させるため、おすすめには選ばれない', () => {
  const counts = countsOf('123456789m11p159s');
  const analysis = Evaluator.analyzeHand(counts);
  const best = analysis.recommended;
  // 1萬(完成した順子の一部)を切るとシャンテンが後退し、孤立牌の索子を切る方が優れる
  const manDiscard = analysis.discards.find((d) => d.tile === 0);
  assert.ok(manDiscard.resultShanten > best.resultShanten);
  // おすすめは孤立している索子(1索/9索/5索)のいずれか
  assert.ok(['1索', '9索', '5索'].includes(best.label));
});

test('gradeUserChoice: おすすめと同じ牌を選べば◎評価', () => {
  const counts = countsOf('123456789m11p159s');
  const analysis = Evaluator.analyzeHand(counts);
  const grade = Evaluator.gradeUserChoice(analysis, analysis.recommended.tile);
  assert.strictEqual(grade.grade, 'excellent');
});

test('gradeUserChoice: シャンテンが後退する牌を選べば×評価', () => {
  const counts = countsOf('123456789m11p159s');
  const analysis = Evaluator.analyzeHand(counts);
  const worse = analysis.discards.find((d) => d.resultShanten > analysis.recommended.resultShanten);
  if (worse) {
    const grade = Evaluator.gradeUserChoice(analysis, worse.tile);
    assert.strictEqual(grade.grade, 'bad');
    // V1.1: 「おすすめ」は誤解を招くため「牌効率上のおすすめ」という表現を使う
    assert.ok(grade.comment.includes('牌効率上のおすすめ'));
  }
});

test('analyzeHand: 各打牌候補にgrade(評価)が付与される(比較表で使用)', () => {
  const counts = countsOf('123456789m11p159s');
  const analysis = Evaluator.analyzeHand(counts);
  assert.ok(analysis.discards.every((d) => d.grade && d.grade.gradeLabel));
  assert.strictEqual(analysis.recommended.grade.grade, 'excellent');
});

// ==================================================
// game.js
// ==================================================
console.log('== game.js ==');

test('newGame: 13枚配牌+1枚ツモで14枚になる', () => {
  const state = Game.newGame();
  assert.strictEqual(state.hand.length, 13);
  assert.strictEqual(typeof state.drawn, 'number');
  assert.strictEqual(state.wall.length, 136 - 14);
});

test('discardAndDraw: 打牌後も手牌+ツモで14枚を維持する', () => {
  let state = Game.newGame();
  const before = state.wall.length;
  const discardTile = state.hand[0];
  state = Game.discardAndDraw(state, discardTile);
  assert.strictEqual(state.hand.length, 13);
  assert.strictEqual(typeof state.drawn, 'number');
  assert.strictEqual(state.wall.length, before - 1);
});

test('discardAndDraw: 存在しない牌を切ろうとするとエラーになる', () => {
  const state = Game.newGame();
  // 手牌に絶対に無い牌を探す
  const counts = Tiles.toCounts(state.hand.concat([state.drawn]));
  let missing = -1;
  for (let i = 0; i < 34; i++) {
    if (counts[i] === 0) { missing = i; break; }
  }
  assert.throws(() => Game.discardAndDraw(state, missing));
});

test('アガリ状態: 14枚がすでに完成形ならシャンテン数-1と判定できる', () => {
  const counts = countsOf('123456789m123p11s');
  const result = Shanten.calcShanten(counts);
  assert.strictEqual(result.shanten, -1);
  // game.js の discardAndDraw 後の isAgari 判定ロジックと同じ条件を確認
  assert.strictEqual(result.shanten === -1, true);
});

test('generateProblem: 何切る問題は常に14枚生成される', () => {
  const problem = Game.generateProblem();
  assert.strictEqual(problem.tiles14.length, 14);
});

// ==================================================
// decomposition.js (V1.2)
// ==================================================
console.log('== decomposition.js ==');

test('enumerateWinningDecompositions: 一意に決まる完成形は分解が1通り', () => {
  const counts = countsOf('123456789m123p11s');
  const decomps = Decomposition.enumerateWinningDecompositions(counts);
  assert.strictEqual(decomps.length, 1);
});

test('enumerateWinningDecompositions: 曖昧な形は複数の分解を返す', () => {
  const counts = countsOf('11223344556677m');
  const decomps = Decomposition.enumerateWinningDecompositions(counts);
  assert.ok(decomps.length >= 2);
});

test('enumerateVariants: シャンポン待ちの完成刻子を正しく検出する', () => {
  const counts = countsOf('123456789m111p22p');
  const decomps = Decomposition.enumerateWinningDecompositions(counts);
  const variants = Decomposition.enumerateVariants(decomps[0], 9 /* 1p */, true);
  assert.strictEqual(variants.length, 1);
  assert.strictEqual(variants[0].waitType, 'shanpon');
});

test('classifySequenceWait: 順子内の位置により両面/嵌張/辺張を判定する', () => {
  assert.strictEqual(Decomposition.classifySequenceWait([1, 2, 3], 2), 'kanchan'); // 234の中央(3)が和了
  assert.strictEqual(Decomposition.classifySequenceWait([0, 1, 2], 2), 'penchan'); // 123の3側(下端)
  assert.strictEqual(Decomposition.classifySequenceWait([6, 7, 8], 6), 'penchan'); // 789の7側(上端)
  assert.strictEqual(Decomposition.classifySequenceWait([2, 3, 4], 2), 'ryanmen'); // 345の3側(中間の順子)
  assert.strictEqual(Decomposition.classifySequenceWait([2, 3, 4], 4), 'ryanmen'); // 345の5側(中間の順子)
});

// ==================================================
// dora.js (V1.2)
// ==================================================
console.log('== dora.js ==');

test('doraTileFromIndicator: 数牌は次の数字になる', () => {
  assert.strictEqual(Dora.doraTileFromIndicator(3), 4); // 4萬 -> 5萬
});

test('doraTileFromIndicator: 9の次は1に戻る(数牌)', () => {
  assert.strictEqual(Dora.doraTileFromIndicator(8), 0); // 9萬 -> 1萬
  assert.strictEqual(Dora.doraTileFromIndicator(17), 9); // 9筒 -> 1筒
});

test('doraTileFromIndicator: 風牌は東南西北東の順で一周する', () => {
  assert.strictEqual(Dora.doraTileFromIndicator(27), 28); // 東->南
  assert.strictEqual(Dora.doraTileFromIndicator(30), 27); // 北->東
});

test('doraTileFromIndicator: 三元牌は白發中白の順で一周する', () => {
  assert.strictEqual(Dora.doraTileFromIndicator(31), 32); // 白->發
  assert.strictEqual(Dora.doraTileFromIndicator(33), 31); // 中->白
});

test('countTotalDora: 手牌中のドラ枚数を正しく数える', () => {
  const counts = countsOf('123456789m11p45s'); // 4索5索を含む
  const result = Dora.countTotalDora(counts, [20]); // 表示牌3索 -> ドラ4索
  assert.strictEqual(result.total, 1);
});

test('countAkaDora: 赤ドラ枚数を合計する', () => {
  assert.strictEqual(Dora.countAkaDora({ m: 1, p: 0, s: 2 }), 3);
});

// ==================================================
// scoring.js / yaku.js (V1.2: 役・符・点数)
// ==================================================
console.log('== yaku.js / scoring.js: 役の成立・不成立 ==');

function baseCtx(overrides) {
  return Object.assign(
    {
      winningTile: null,
      isTsumo: false,
      isRiichi: false,
      isDoubleRiichi: false,
      isIppatsu: false,
      isHaitei: false,
      isHoutei: false,
      isRinshan: false,
      isChankan: false,
      isDealer: false,
      seatWind: 27,
      roundWind: 27,
    },
    overrides || {}
  );
}

function yakuNames(result) {
  return result.best.yakuList.map((y) => y.name);
}

test('タンヤオ+平和+両面ロン: 2翻30符2000点', () => {
  const counts = countsOf('234456m234p345s55p');
  const result = Scoring.scoreHand(counts, baseCtx({ winningTile: 5 /* 6m */ }));
  assert.ok(result.hasYaku);
  assert.deepStrictEqual(yakuNames(result).sort(), ['タンヤオ', '平和'].sort());
  assert.strictEqual(result.best.han, 2);
  assert.strictEqual(result.best.fu, 30);
  assert.strictEqual(result.best.score.total, 2000);
});

test('リーチ+平和+ツモ: 4翻20符(有名な2600/1300のケース)', () => {
  const counts = countsOf('234456m234p345s55p');
  const result = Scoring.scoreHand(counts, baseCtx({ winningTile: 5, isTsumo: true, isRiichi: true }));
  assert.strictEqual(result.best.han, 4);
  assert.strictEqual(result.best.fu, 20);
  assert.strictEqual(result.best.score.tsumoDealer, 2600);
  assert.strictEqual(result.best.score.tsumoNonDealer, 1300);
  assert.strictEqual(result.best.score.total, 5200);
});

test('役牌(白)の刻子: 1翻、暗刻分の符が加算される', () => {
  const counts = countsOf('234456m234p555z55s');
  const result = Scoring.scoreHand(counts, baseCtx({ winningTile: 5 }));
  assert.ok(yakuNames(result).includes('役牌:白'));
  assert.strictEqual(result.best.fu, 40); // 20+10(門前ロン)+8(白の暗刻)+2(切り上げ)
  assert.strictEqual(result.best.score.total, 1300);
});

test('役牌: 自風と場風が一致すると2つ分の役牌が成立する(ダブ東)', () => {
  const counts = countsOf('234456m234p111z55s'); // 111z = 東の刻子
  const result = Scoring.scoreHand(counts, baseCtx({ winningTile: 5, seatWind: 27, roundWind: 27 }));
  assert.ok(yakuNames(result).includes('場風:東'));
  assert.ok(yakuNames(result).includes('自風:東'));
});

test('ピンフではない(嵌張待ち)ため平和は不成立', () => {
  const counts = countsOf('234456m234p345s55p');
  // 3p (index11)は234pの中間=嵌張。5s(index22)ではなく3pを和了牌に指定する
  const result = Scoring.scoreHand(counts, baseCtx({ winningTile: 11 }));
  assert.ok(!yakuNames(result).includes('平和'));
});

test('一盃口: 同じ順子が2つあると1翻', () => {
  const counts = countsOf('112233m456p789p55s');
  const result = Scoring.scoreHand(counts, baseCtx({ winningTile: 0 }));
  assert.ok(yakuNames(result).includes('一盃口'));
});

test('二盃口: 一盃口が2組そろうと3翻(一盃口とは重複しない)', () => {
  const counts = countsOf('112233m112233p44s');
  const result = Scoring.scoreHand(counts, baseCtx({ winningTile: 0 }));
  assert.ok(yakuNames(result).includes('二盃口'));
  assert.ok(!yakuNames(result).includes('一盃口'));
  assert.ok(result.best.han >= 3);
});

test('三色同順: 萬筒索すべてに同じ並びの順子', () => {
  const counts = countsOf('123m123p123s456p88p');
  const result = Scoring.scoreHand(counts, baseCtx({ winningTile: 16 })); // 8筒
  assert.ok(yakuNames(result).includes('三色同順'));
});

test('三色同刻: 萬筒索すべてに同じ数字の刻子', () => {
  const fixed = countsOf('555m123m555p555s99s');
  const result = Scoring.scoreHand(fixed, baseCtx({ winningTile: 26, isTsumo: true }));
  assert.ok(yakuNames(result).includes('三色同刻'));
});

test('一気通貫: 1スートで123・456・789がそろう', () => {
  const counts = countsOf('123456789m123p11s'); // 123pがあるので雀頭崩れる可能性→ 11sを雀頭に
  const result = Scoring.scoreHand(counts, baseCtx({ winningTile: 0 }));
  assert.ok(yakuNames(result).includes('一気通貫'));
});

test('対々和: 4刻子(ロンでシャンポン完成させ、四暗刻にはならないケース)', () => {
  const counts = countsOf('111m222p333s444z55z');
  const result = Scoring.scoreHand(counts, baseCtx({ winningTile: 30 })); // ロンで北をシャンポン完成
  assert.ok(yakuNames(result).includes('対々和'));
  assert.ok(yakuNames(result).includes('三暗刻'));
  assert.ok(!result.best.isYakuman, 'シャンポン部分が明刻になるため四暗刻にはならない');
});

test('三暗刻: ロンでシャンポン完成した刻子は明刻扱いになり、暗刻が2つに減ると不成立', () => {
  const counts = countsOf('111m222p333s456s77p');
  const ron = Scoring.scoreHand(counts, baseCtx({ winningTile: 20 /* 3s、シャンポン完成 */ }));
  assert.ok(!ron.hasYaku, '暗刻2つでは三暗刻・対々和とも成立しないはず');
});

test('三暗刻: 同じ手をツモにすると全て暗刻のまま残り成立する', () => {
  const counts = countsOf('111m222p333s456s77p');
  const tsumo = Scoring.scoreHand(counts, baseCtx({ winningTile: 20, isTsumo: true }));
  assert.ok(tsumo.hasYaku);
  assert.ok(yakuNames(tsumo).includes('三暗刻'));
});

test('混全帯幺九(チャンタ): すべての面子・雀頭が1・9・字牌を含む', () => {
  const counts = countsOf('123m789p11z999s123s');
  const result = Scoring.scoreHand(counts, baseCtx({ winningTile: 18 }));
  assert.ok(yakuNames(result).includes('混全帯幺九'));
  assert.ok(!yakuNames(result).includes('純全帯幺九'));
});

test('純全帯幺九(ジュンチャン): 字牌を使わずに端を含む', () => {
  const counts = countsOf('123m789p999s123s99p');
  const result = Scoring.scoreHand(counts, baseCtx({ winningTile: 18 }));
  assert.ok(yakuNames(result).includes('純全帯幺九'));
});

test('混老頭: 老頭牌+字牌のみ、対々和との複合(ロンのシャンポン完成で四暗刻にはならない)', () => {
  const counts = countsOf('111m999m111p999s22z');
  // 9索をロンでシャンポン完成させ、暗刻が3つになるようにする(四暗刻を避ける)
  const result = Scoring.scoreHand(counts, baseCtx({ winningTile: 26 }));
  assert.ok(yakuNames(result).includes('混老頭'));
  assert.ok(yakuNames(result).includes('対々和'));
  assert.ok(!result.best.isYakuman);
});

test('小三元: 三元牌2刻子+1雀頭', () => {
  const counts = countsOf('234m555z666z77z8s9s7s');
  const fixed = countsOf('234m555z666z77z789s');
  const result = Scoring.scoreHand(fixed, baseCtx({ winningTile: 2 }));
  assert.ok(yakuNames(result).includes('小三元'));
});

test('混一色: 1スート+字牌のみ', () => {
  const counts = countsOf('123456789m11z22z2m');
  const fixed = countsOf('123456789m112z22z');
  const result = Scoring.scoreHand(fixed, baseCtx({ winningTile: 0 }));
  assert.ok(yakuNames(result).includes('混一色'));
});

test('清一色: 1スートのみ(字牌なし)', () => {
  const counts = countsOf('123456789m11m234m');
  const result = Scoring.scoreHand(counts, baseCtx({ winningTile: 0 }));
  assert.ok(yakuNames(result).includes('清一色'));
});

test('七対子: 2翻固定25符', () => {
  // 端牌/字牌ばかりだと混老頭も重複するため、中張牌を混ぜて七対子のみが成立するようにする
  const counts = countsOf('1122m3344p5566s77z');
  const result = Scoring.scoreHand(counts, baseCtx({ winningTile: 33 }));
  assert.ok(yakuNames(result).includes('七対子'));
  assert.strictEqual(result.best.fu, 25);
  assert.strictEqual(result.best.han, 2);
});

test('役なし: 完成形でも役が無ければアガれない(hasYaku=false)', () => {
  const counts = countsOf('234567m123p345s44z');
  const result = Scoring.scoreHand(counts, baseCtx({ winningTile: 21 /* 嵌張の4索 */ }));
  assert.strictEqual(result.hasYaku, false);
});

test('役なしの手でもリーチを付けると1翻でアガれる', () => {
  const counts = countsOf('234567m123p345s44z');
  const result = Scoring.scoreHand(counts, baseCtx({ winningTile: 21, isRiichi: true }));
  assert.ok(result.hasYaku);
  assert.ok(yakuNames(result).includes('リーチ'));
});

test('ダブルリーチ+一発+ツモ: 状況役が複合する', () => {
  const counts = countsOf('234456m234p345s55p');
  const result = Scoring.scoreHand(
    counts,
    baseCtx({ winningTile: 5, isTsumo: true, isDoubleRiichi: true, isIppatsu: true })
  );
  assert.ok(yakuNames(result).includes('ダブルリーチ'));
  assert.ok(yakuNames(result).includes('一発'));
  assert.ok(!yakuNames(result).includes('リーチ'), 'ダブルリーチ成立時は通常のリーチと重複しない');
});

test('ドラ: 表示牌から算出したドラの枚数が翻に加算される', () => {
  const counts = countsOf('234456m234p345s55p');
  const withoutDora = Scoring.scoreHand(counts, baseCtx({ winningTile: 5, isRiichi: true }));
  const withDora = Scoring.scoreHand(counts, baseCtx({ winningTile: 5, isRiichi: true }), {}, { indicatorTiles: [2], aka: { m: 0, p: 0, s: 0 } });
  // 表示牌3萬(index2)->ドラ4萬(index3)。手牌に4萬は2枚(234m,456mの4mそれぞれ)
  assert.strictEqual(withDora.best.han, withoutDora.best.han + 2);
  assert.ok(yakuNames(withDora).includes('ドラ'));
});

test('赤ドラ: 指定した枚数だけ翻に加算される', () => {
  const counts = countsOf('234456m234p345s55p');
  const result = Scoring.scoreHand(counts, baseCtx({ winningTile: 5, isRiichi: true }), {}, { indicatorTiles: [], aka: { m: 0, p: 1, s: 0 } });
  assert.ok(yakuNames(result).includes('赤ドラ'));
});

test('ドラだけでは役にならない(通常役が無ければアガれない)', () => {
  const counts = countsOf('234567m123p345s44z');
  const result = Scoring.scoreHand(counts, baseCtx({ winningTile: 21 }), {}, { indicatorTiles: [8], aka: { m: 0, p: 0, s: 0 } });
  assert.strictEqual(result.hasYaku, false);
});

console.log('== yaku.js / scoring.js: 役満 ==');

test('国士無双: 役満(13種類がそろっており、和了牌が対子の一部=単騎待ちで13面待ちではない)', () => {
  const counts = countsOf('119m19p19s1234567z');
  // 1萬は手牌に2枚あるが、和了牌をChun(手牌に1枚だけ)にすると、
  // 和了前の13枚は「1萬の対子+Chunを除く11種」= 13面待ちではない通常の国士無双になる
  const result = Scoring.scoreHand(counts, baseCtx({ winningTile: 33, isTsumo: true }));
  assert.ok(result.best.isYakuman);
  assert.ok(yakuNames(result).includes('国士無双'));
  assert.strictEqual(result.best.score.tier, '役満');
});

test('国士無双十三面待ち: ダブル役満(単純な国士無双の2倍の点数)', () => {
  const counts = countsOf('119m19p19s1234567z');
  const thirteenWait = Scoring.scoreHand(counts, baseCtx({ winningTile: 0, isTsumo: true }), { doubleYakuman: true });
  assert.ok(yakuNames(thirteenWait).includes('国士無双十三面待ち'));
  const single = Scoring.scoreHand(counts, baseCtx({ winningTile: 33, isTsumo: true }), { doubleYakuman: true });
  assert.ok(yakuNames(single).includes('国士無双'));
  assert.strictEqual(thirteenWait.best.score.total, single.best.score.total * 2);
});

test('四暗刻: 4つとも暗刻(ツモ)', () => {
  const counts = countsOf('111m222p333s444z55z');
  const result = Scoring.scoreHand(counts, baseCtx({ winningTile: 30, isTsumo: true }));
  assert.ok(yakuNames(result).includes('四暗刻'));
});

test('四暗刻単騎: 単騎待ちだとダブル役満', () => {
  const counts = countsOf('111m222p333s444z55s');
  const result = Scoring.scoreHand(counts, baseCtx({ winningTile: 22, isTsumo: true }), { doubleYakuman: true });
  assert.ok(yakuNames(result).includes('四暗刻単騎'));
});

test('四暗刻: ロンでシャンポン完成すると崩れ、三暗刻+対々和に降格する', () => {
  const counts = countsOf('111m222p333s444z55p');
  const result = Scoring.scoreHand(counts, baseCtx({ winningTile: 30 })); // 北をロンでシャンポン完成
  assert.ok(result.hasYaku);
  assert.ok(!result.best.isYakuman);
  assert.ok(yakuNames(result).includes('三暗刻'));
  assert.ok(yakuNames(result).includes('対々和'));
});

test('大三元: 三元牌3刻子', () => {
  const counts = countsOf('234m555z666z777z55p');
  const result = Scoring.scoreHand(counts, baseCtx({ winningTile: 2 }));
  assert.ok(yakuNames(result).includes('大三元'));
});

test('小四喜: 風牌3刻子+風牌の雀頭(南西北の刻子+東の雀頭)', () => {
  const counts = countsOf('123m222z333z444z11z');
  const result = Scoring.scoreHand(counts, baseCtx({ winningTile: 27, isTsumo: true }));
  assert.ok(yakuNames(result).includes('小四喜'));
});

test('大四喜: 風牌4刻子', () => {
  const counts = countsOf('222z333z444z111z55p');
  const result = Scoring.scoreHand(counts, baseCtx({ winningTile: 30, isTsumo: true }), { doubleYakuman: true });
  assert.ok(yakuNames(result).includes('大四喜'));
});

test('字一色: 字牌のみ', () => {
  const counts = countsOf('111z222z333z444z55z');
  const result = Scoring.scoreHand(counts, baseCtx({ winningTile: 30 }));
  assert.ok(yakuNames(result).includes('字一色'));
});

test('清老頭: 老頭牌のみ', () => {
  const counts = countsOf('111m999m111p111s99p');
  const result = Scoring.scoreHand(counts, baseCtx({ winningTile: 8 }));
  assert.ok(yakuNames(result).includes('清老頭'));
});

test('緑一色: 索子の2346888と發のみ', () => {
  const counts = countsOf('234234666888s66z');
  const result = Scoring.scoreHand(counts, baseCtx({ winningTile: 23 }));
  assert.ok(yakuNames(result).includes('緑一色'));
});

test('純正九蓮宝燈: 純粋な9面待ちの形からアガるとダブル役満', () => {
  const counts = countsOf('11123455678999m');
  const result = Scoring.scoreHand(counts, baseCtx({ winningTile: 4, isTsumo: true }), { doubleYakuman: true });
  assert.ok(yakuNames(result).includes('純正九蓮宝燈'));
});

test('九蓮宝燈(不純): 純粋な9面待ちでない場合は通常役満', () => {
  const counts = countsOf('11123455678999m');
  const result = Scoring.scoreHand(counts, baseCtx({ winningTile: 0, isTsumo: true }), { doubleYakuman: true });
  assert.ok(yakuNames(result).includes('九蓮宝燈'));
  assert.ok(!yakuNames(result).includes('純正九蓮宝燈'));
});

// ==================================================
// scoring.js: 符計算の内訳
// ==================================================
console.log('== scoring.js: 符計算 ==');

test('平和+ロン: 30符固定', () => {
  const counts = countsOf('234456m234p345s55p');
  const result = Scoring.scoreHand(counts, baseCtx({ winningTile: 5 }));
  assert.strictEqual(result.best.fu, 30);
});

test('平和+ツモ: 20符固定(通常のツモ+2符は付かない)', () => {
  const counts = countsOf('234456m234p345s55p');
  const result = Scoring.scoreHand(counts, baseCtx({ winningTile: 5, isTsumo: true }));
  assert.strictEqual(result.best.fu, 20);
});

test('嵌張待ち: +2符', () => {
  const counts = countsOf('234456m234p345s55p');
  const result = Scoring.scoreHand(counts, baseCtx({ winningTile: 11 })); // 3pの嵌張
  const waitFuRow = result.best.fuBreakdown.find((r) => r.label.includes('嵌張'));
  assert.ok(waitFuRow);
  assert.strictEqual(waitFuRow.value, 2);
});

test('七対子: 常に25符固定', () => {
  const counts = countsOf('1199m1199p1199s77z');
  const result = Scoring.scoreHand(counts, baseCtx({ winningTile: 27, isTsumo: true }));
  assert.strictEqual(result.best.fu, 25);
});

test('符は10符単位に切り上げられる', () => {
  const counts = countsOf('234456m234p345s55p');
  const result = Scoring.scoreHand(counts, baseCtx({ winningTile: 11 })); // 20+10+2=32 -> 40符
  assert.strictEqual(result.best.fu, 40);
  assert.strictEqual(result.best.fu % 10, 0);
});

// ==================================================
// scoring.js: 点数計算の既知の点数表とのクロスチェック
// ==================================================
console.log('== scoring.js: 既知の点数表とのクロスチェック ==');

const KNOWN_CHILD_RON = {
  '1-30': 1000, '1-40': 1300, '1-50': 1600,
  '2-30': 2000, '2-40': 2600, '2-50': 3200,
  '3-30': 3900, '3-40': 5200, '3-50': 6400,
  '4-30': 7700, '4-40': 8000,
};
const KNOWN_CHILD_TSUMO = {
  // [子の支払い, 親の支払い]
  '1-30': [300, 500], '2-30': [500, 1000], '3-30': [1000, 2000], '3-40': [1300, 2600], '4-30': [2000, 3900],
};
const KNOWN_DEALER_RON = {
  '1-30': 1500, '2-30': 2900, '3-30': 5800, '4-30': 11600,
};
const KNOWN_DEALER_TSUMO = {
  '1-30': 500, '2-30': 1000, '3-30': 2000,
};

test('子ロンの点数表クロスチェック(1〜4翻×30/40/50符)', () => {
  const rules = Scoring.defaultRules();
  for (const key of Object.keys(KNOWN_CHILD_RON)) {
    const [han, fu] = key.split('-').map(Number);
    const r = Scoring.computeScoreFromHanFu(han, fu, false, false, rules);
    assert.strictEqual(r.ron, KNOWN_CHILD_RON[key], `子${han}翻${fu}符ロン`);
  }
});

test('子ツモの点数表クロスチェック', () => {
  const rules = Scoring.defaultRules();
  for (const key of Object.keys(KNOWN_CHILD_TSUMO)) {
    const [han, fu] = key.split('-').map(Number);
    const r = Scoring.computeScoreFromHanFu(han, fu, false, true, rules);
    const [expectChild, expectDealer] = KNOWN_CHILD_TSUMO[key];
    assert.strictEqual(r.tsumoNonDealer, expectChild, `子${han}翻${fu}符ツモ(子の支払い)`);
    assert.strictEqual(r.tsumoDealer, expectDealer, `子${han}翻${fu}符ツモ(親の支払い)`);
  }
});

test('親ロンの点数表クロスチェック', () => {
  const rules = Scoring.defaultRules();
  for (const key of Object.keys(KNOWN_DEALER_RON)) {
    const [han, fu] = key.split('-').map(Number);
    const r = Scoring.computeScoreFromHanFu(han, fu, true, false, rules);
    assert.strictEqual(r.ron, KNOWN_DEALER_RON[key], `親${han}翻${fu}符ロン`);
  }
});

test('親ツモの点数表クロスチェック(全員同額)', () => {
  const rules = Scoring.defaultRules();
  for (const key of Object.keys(KNOWN_DEALER_TSUMO)) {
    const [han, fu] = key.split('-').map(Number);
    const r = Scoring.computeScoreFromHanFu(han, fu, true, true, rules);
    assert.strictEqual(r.tsumoNonDealer, KNOWN_DEALER_TSUMO[key], `親${han}翻${fu}符ツモ`);
    assert.strictEqual(r.total, KNOWN_DEALER_TSUMO[key] * 3);
  }
});

test('満貫以上の点数(子): 跳満12000・倍満16000・三倍満24000・役満32000', () => {
  const rules = Scoring.defaultRules();
  assert.strictEqual(Scoring.computeScoreFromHanFu(6, 30, false, false, rules).ron, 12000);
  assert.strictEqual(Scoring.computeScoreFromHanFu(8, 30, false, false, rules).ron, 16000);
  assert.strictEqual(Scoring.computeScoreFromHanFu(11, 30, false, false, rules).ron, 24000);
  assert.strictEqual(Scoring.computeScoreFromHanFu(13, 30, false, false, rules).ron, 32000);
});

test('満貫以上の点数(親): 跳満18000・倍満24000・三倍満36000・役満48000', () => {
  const rules = Scoring.defaultRules();
  assert.strictEqual(Scoring.computeScoreFromHanFu(6, 30, true, false, rules).ron, 18000);
  assert.strictEqual(Scoring.computeScoreFromHanFu(8, 30, true, false, rules).ron, 24000);
  assert.strictEqual(Scoring.computeScoreFromHanFu(11, 30, true, false, rules).ron, 36000);
  assert.strictEqual(Scoring.computeScoreFromHanFu(13, 30, true, false, rules).ron, 48000);
});

test('切り上げ満貫: 4翻30符・3翻60符は設定により満貫扱いになる', () => {
  const withKiriage = Object.assign(Scoring.defaultRules(), { kiriageMangan: true });
  const withoutKiriage = Scoring.defaultRules();
  assert.strictEqual(Scoring.computeScoreFromHanFu(4, 30, false, false, withKiriage).ron, 8000);
  assert.strictEqual(Scoring.computeScoreFromHanFu(4, 30, false, false, withoutKiriage).ron, 7700);
  assert.strictEqual(Scoring.computeScoreFromHanFu(3, 60, false, false, withKiriage).ron, 8000);
});

test('数え役満: 13翻以上は設定がoffなら三倍満止まりになる', () => {
  const withKazoe = Scoring.defaultRules();
  const withoutKazoe = Object.assign(Scoring.defaultRules(), { kazoeYakuman: false });
  assert.strictEqual(Scoring.computeScoreFromHanFu(13, 30, false, false, withKazoe).ron, 32000);
  assert.strictEqual(Scoring.computeScoreFromHanFu(13, 30, false, false, withoutKazoe).ron, 24000);
});

// ==================================================
// yakucandidates.js (V1.2)
// ==================================================
console.log('== yakucandidates.js ==');

test('現在狙えそうな役: 字牌・老頭牌が無ければタンヤオ候補が出る', () => {
  const counts = countsOf('23m23p23s56m78p5p');
  const candidates = YakuCandidates.detectYakuCandidates(counts, { seatWind: 27, roundWind: 27 });
  assert.ok(candidates.some((c) => c.key === 'tanyao'));
});

test('現在狙えそうな役: 役牌の対子があれば候補に挙がる', () => {
  const counts = countsOf('23m23p23s5m8p55z9p');
  const candidates = YakuCandidates.detectYakuCandidates(counts, { seatWind: 27, roundWind: 27 });
  assert.ok(candidates.some((c) => c.name.includes('役牌')));
});

test('現在狙えそうな役: 牌効率上のおすすめとは独立した情報である(候補一覧に牌効率の語を含まない)', () => {
  const counts = countsOf('23m23p23s56m78p5p');
  const candidates = YakuCandidates.detectYakuCandidates(counts, { seatWind: 27, roundWind: 27 });
  candidates.forEach((c) => assert.ok(!c.note.includes('牌効率上のおすすめ')));
});

// ==================================================
// scoring.js: 副露(鳴き)がある場合の役・符計算(V1.3)
// ==================================================
console.log('== scoring.js: 副露あり(鳴き)の役・符計算 ==');

test('副露タンヤオ: ポンを含む手でも成立し、門前ロン符は付かない', () => {
  const concealed = countsOf('234p567s234s88p');
  const fuuro = [{ type: 'pon', tiles: [3, 3, 3], calledTile: 3, from: 'toimen', concealed: false }];
  const result = Scoring.scoreHand(concealed, baseCtx({ winningTile: 12 }), {}, null, fuuro);
  assert.ok(result.hasYaku);
  assert.ok(yakuNames(result).includes('タンヤオ'));
  assert.ok(!result.best.fuBreakdown.some((r) => r.label.includes('門前ロン')));
});

test('食い下がり: 鳴くと三色同順は2翻→1翻に下がる', () => {
  const concealedOpen = countsOf('123p456p123s22z');
  const fuuroOpen = [{ type: 'chi', tiles: [0, 1, 2], calledTile: 0, from: 'left', concealed: false }];
  const openResult = Scoring.scoreHand(concealedOpen, baseCtx({ winningTile: 14 }), {}, null, fuuroOpen);
  const sanshokuOpen = openResult.best.yakuList.find((y) => y.key === 'sanshoku_doujun');
  assert.strictEqual(sanshokuOpen.han, 1);

  const concealedClosed = countsOf('123m123p456p123s22z');
  const closedResult = Scoring.scoreHand(concealedClosed, baseCtx({ winningTile: 14 }));
  const sanshokuClosed = closedResult.best.yakuList.find((y) => y.key === 'sanshoku_doujun');
  assert.strictEqual(sanshokuClosed.han, 2);
});

test('鳴くとリーチ・平和・門前清自摸和・一盃口は成立しなくなる', () => {
  const concealed = countsOf('234p567s234s88p');
  const fuuro = [{ type: 'pon', tiles: [3, 3, 3], calledTile: 3, from: 'toimen', concealed: false }];
  const result = Scoring.scoreHand(concealed, baseCtx({ winningTile: 12, isTsumo: true, isRiichi: true }), {}, null, fuuro);
  assert.ok(!yakuNames(result).includes('リーチ'));
  assert.ok(!yakuNames(result).includes('門前清自摸和'));
  assert.ok(!yakuNames(result).includes('平和'));
});

test('明槓: 幺九牌でない刻子の明槓は8符', () => {
  const concealed = countsOf('234p567s234s88p');
  const fuuro = [{ type: 'minkan', tiles: [3, 3, 3, 3], calledTile: 3, from: 'toimen', concealed: false }];
  const result = Scoring.scoreHand(concealed, baseCtx({ winningTile: 12 }), {}, null, fuuro);
  const row = result.best.fuBreakdown.find((r) => r.label.includes('明槓'));
  assert.strictEqual(row.value, 8);
});

test('暗槓: 幺九牌でない刻子の暗槓は16符', () => {
  const concealed = countsOf('234p567s234s88p');
  const fuuro = [{ type: 'ankan', tiles: [3, 3, 3, 3], calledTile: null, from: null, concealed: true }];
  const result = Scoring.scoreHand(concealed, baseCtx({ winningTile: 12, isTsumo: true }), {}, null, fuuro);
  const row = result.best.fuBreakdown.find((r) => r.label.includes('暗槓'));
  assert.strictEqual(row.value, 16);
});

test('暗槓があっても門前は崩れない(門前清自摸和が成立する)', () => {
  const concealed = countsOf('234p567s234s88p');
  const fuuro = [{ type: 'ankan', tiles: [3, 3, 3, 3], calledTile: null, from: null, concealed: true }];
  const result = Scoring.scoreHand(concealed, baseCtx({ winningTile: 12, isTsumo: true }), {}, null, fuuro);
  assert.ok(yakuNames(result).includes('門前清自摸和'));
});

test('副露があると七対子・国士無双は成立しない(通常手のシャンテンのみで判定される)', () => {
  const concealed = countsOf('1199p1199s77z');
  const fuuro = [{ type: 'pon', tiles: [0, 0, 0], calledTile: 0, from: 'toimen', concealed: false }];
  // 通常手として4面子+雀頭になり得ないため未完成(complete:false)になるはず
  const result = Scoring.scoreHand(concealed, baseCtx({ winningTile: 9 }), {}, null, fuuro);
  assert.strictEqual(result.complete, false);
});

// ==================================================
// melds.js (V1.3: 鳴きの判定・実行)
// ==================================================
console.log('== melds.js ==');
const Melds = require(path.join(__dirname, '..', 'js', 'melds.js'));

test('getChiOptions: 中間の牌は最大3通りの順子を作れる', () => {
  // 手牌に 2,3,4,5,6 萬がある状態で 4萬が捨てられた場合
  const hand = countsOf('23456m');
  const options = Melds.getChiOptions(hand, 3); // 4萬 = index3
  assert.strictEqual(options.length, 3); // [2,3,4] [3,4,5] [4,5,6]
});

test('getChiOptions: 字牌はチーできない', () => {
  const hand = countsOf('123m');
  assert.deepStrictEqual(Melds.getChiOptions(hand, 27), []);
});

test('canPon / canMinkan: 手牌の枚数で判定する', () => {
  const hand = countsOf('55m5p'); // 5萬2枚, 5筒1枚
  assert.strictEqual(Melds.canPon(hand, 4), true); // 5萬
  assert.strictEqual(Melds.canPon(hand, 13), false); // 5筒(1枚のみ)
  assert.strictEqual(Melds.canMinkan(hand, 4), false); // 5萬は2枚のみ(カンには3枚必要)
});

test('getAnkanOptions: 4枚そろっている牌のみ候補になる', () => {
  const hand = countsOf('5555m123p');
  assert.deepStrictEqual(Melds.getAnkanOptions(hand), [4]);
});

test('getKakanOptions: 既存のポンに対応する4枚目を持っていれば候補になる', () => {
  const fuuro = [{ type: 'pon', tiles: [4, 4, 4], calledTile: 4, from: 'left', concealed: false }];
  const hand = countsOf('5m123p');
  const options = Melds.getKakanOptions(fuuro, hand);
  assert.strictEqual(options.length, 1);
  assert.strictEqual(options[0].tile, 4);
});

test('applyPon: 手牌から2枚減り、副露面子が作られる', () => {
  const hand = countsOf('555m123p');
  const { handCounts, meld } = Melds.applyPon(hand, 4, 'left');
  assert.strictEqual(handCounts[4], 1);
  assert.deepStrictEqual(meld.tiles, [4, 4, 4]);
  assert.strictEqual(meld.concealed, false);
});

test('applyAnkan: 手牌から4枚減り、暗槓として記録される', () => {
  const hand = countsOf('5555m123p');
  const { handCounts, meld } = Melds.applyAnkan(hand, 4);
  assert.strictEqual(handCounts[4], 0);
  assert.strictEqual(meld.concealed, true);
  assert.strictEqual(meld.type, 'ankan');
});

test('fullHandCounts: 手の中+副露を合算した枚数配列を返す', () => {
  const hand = countsOf('123p');
  const fuuro = [{ type: 'pon', tiles: [4, 4, 4], calledTile: 4, from: 'left', concealed: false }];
  const full = Melds.fullHandCounts(hand, fuuro);
  assert.strictEqual(full[4], 3);
  assert.strictEqual(Tiles.totalCount(full), 6);
});

// ==================================================
// gamestate.js / round.js (V1.3: CPU対局エンジン)
// ==================================================
console.log('== gamestate.js ==');

test('createMatch: 初期状態は4人25000点、東1局、親は座席0', () => {
  const match = GameState.createMatch({ humanSeat: 0 });
  assert.strictEqual(match.players.length, 4);
  match.players.forEach((p) => assert.strictEqual(p.score, 25000));
  assert.strictEqual(match.roundWindIndex, 0);
  assert.strictEqual(match.roundNumber, 1);
  assert.strictEqual(match.dealerSeat, 0);
});

test('startRound: 配牌13枚x4+山+死に山(14枚)で合計136枚になる', () => {
  const rng = mulberry32(42);
  let match = GameState.createMatch({ humanSeat: -1 });
  match = GameState.startRound(match, rng);
  const counts = new Array(34).fill(0);
  match.players.forEach((p) => {
    for (let i = 0; i < 34; i++) counts[i] += p.handCounts[i];
  });
  match.currentRound.wall.forEach((t) => counts[t]++);
  match.currentRound.deadWall.rinshanTiles.forEach((t) => counts[t]++);
  match.currentRound.deadWall.doraIndicators.forEach((t) => counts[t]++);
  match.currentRound.deadWall.uraDoraIndicators.forEach((t) => counts[t]++);
  const total = counts.reduce((a, b) => a + b, 0);
  assert.strictEqual(total, 136);
  match.players.forEach((p) => assert.strictEqual(Tiles.totalCount(p.handCounts), 13));
});

test('windTileFromRoundIndex: 東南西北の順に対応する', () => {
  assert.strictEqual(GameState.windTileFromRoundIndex(0), 27);
  assert.strictEqual(GameState.windTileFromRoundIndex(3), 30);
  assert.strictEqual(GameState.windTileFromRoundIndex(4), 27); // 一周する
});

console.log('== furiten.js ==');

test('isDiscardFuriten: 自分の待ち牌を自分で捨てていればフリテン', () => {
  assert.strictEqual(Furiten.isDiscardFuriten([9, 10], [5, 9]), true);
  assert.strictEqual(Furiten.isDiscardFuriten([9, 10], [5, 6]), false);
});

test('canRon: 捨て牌フリテン・一時的フリテン・リーチ後フリテンいずれでも不可になる', () => {
  const base = { discards: [], furitenTemporary: false, furitenRiichi: false };
  assert.strictEqual(Furiten.canRon({ ...base, discards: [{ tile: 9 }] }, [9]), false);
  assert.strictEqual(Furiten.canRon({ ...base, furitenTemporary: true }, [9]), false);
  assert.strictEqual(Furiten.canRon({ ...base, furitenRiichi: true }, [9]), false);
  assert.strictEqual(Furiten.canRon({ ...base }, [9]), true);
});

test('explainFuriten: フリテンでなければnullを返す', () => {
  const p = { discards: [], furitenTemporary: false, furitenRiichi: false };
  assert.strictEqual(Furiten.explainFuriten(p, [9]), null);
  assert.ok(Furiten.explainFuriten({ ...p, discards: [{ tile: 9 }] }, [9]));
});

console.log('== safety.js ==');

test('computeGenbutsuSet: 自分の捨て牌は現物になる', () => {
  const target = { discards: [{ tile: 5, turnIndex: 1 }], riichi: false, seat: 1 };
  const set = Safety.computeGenbutsuSet(target, [target]);
  assert.ok(set.has(5));
});

test('computeGenbutsuSet: リーチ後に他家が捨てて見逃した牌も現物になる', () => {
  const target = { discards: [{ tile: 5, turnIndex: 1 }], riichi: true, riichiDeclaredAtTurnIndex: 1, seat: 1 };
  const other = { discards: [{ tile: 9, turnIndex: 2 }], riichi: false, seat: 2 };
  const set = Safety.computeGenbutsuSet(target, [target, other]);
  assert.ok(set.has(9));
});

test('computeSujiSet: 4が捨てられていれば1と7がスジになる', () => {
  const set = Safety.computeSujiSet(new Set([3])); // tile index3 = 4萬
  assert.ok(set.has(0)); // 1萬
  assert.ok(set.has(6)); // 7萬
  assert.ok(!set.has(1)); // 2萬はスジではない
});

test('kanchanChance: 挟む牌が4枚見えていればノーチャン', () => {
  const visible = new Array(34).fill(0);
  visible[2] = 4; // 3萬が4枚見えている -> 2萬(index1)の嵌張はノーチャン
  assert.strictEqual(Safety.kanchanChance(1, visible), 'nochance');
});

test('evaluateTileSafety: 現物は絶対安全、通常牌はabsolute:falseになる', () => {
  const target = { discards: [{ tile: 5, turnIndex: 1 }], riichi: false, seat: 1 };
  const visible = new Array(34).fill(0);
  const genbutsuResult = Safety.evaluateTileSafety(5, target, [target], visible);
  assert.strictEqual(genbutsuResult.level, 'genbutsu');
  assert.strictEqual(genbutsuResult.absolute, true);
  const normalResult = Safety.evaluateTileSafety(20, target, [target], visible);
  assert.strictEqual(normalResult.absolute, false);
});

console.log('== pushfold.js ==');

test('evaluatePushFold: テンパイでリーチ0人なら押し寄り', () => {
  const result = PushFold.evaluatePushFold({ shanten: 0, riichiCount: 0, turnCount: 5, isDealer: false, roughHanValue: 1, safeTileCount: 0 });
  assert.strictEqual(result.verdict, 'push');
});

test('evaluatePushFold: 2シャンテンでリーチ2人・安全牌無しならオリ寄り', () => {
  const result = PushFold.evaluatePushFold({ shanten: 2, riichiCount: 2, turnCount: 14, isDealer: false, roughHanValue: 0, safeTileCount: 0 });
  assert.strictEqual(result.verdict, 'fold');
});

console.log('== cpu.js ==');

test('decideDiscard: 必ず現在の手牌に含まれる牌を返す(ランダムでない根拠のある選択)', () => {
  const rng = mulberry32(7);
  let match = GameState.createMatch({ humanSeat: -1 });
  match = GameState.startRound(match, rng);
  const seat = match.dealerSeat;
  const p = match.players[seat];
  match.currentRound.turnSeat = seat;
  RoundEngine.drawTile(match);
  const counts14 = p.handCounts.slice();
  if (p.drawnTile !== null) counts14[p.drawnTile]++;
  const tile = CPU.decideDiscard(p, match, 'standard');
  assert.ok(counts14[tile] > 0, '手牌に存在しない牌を切ろうとした');
});

test('decideRiichi: 門前でなければリーチしない', () => {
  const p = { fuuro: [{ type: 'pon' }], score: 5000 };
  assert.strictEqual(CPU.decideRiichi(p, 'standard'), false);
});

test('decideRiichi: 点数が1000未満ならリーチしない', () => {
  const p = { fuuro: [], score: 500 };
  assert.strictEqual(CPU.decideRiichi(p, 'standard'), false);
});

console.log('== coach.js ==');

test('evaluateMultiAxis: 全打牌候補に牌効率・打点・役・安全度の評価が付く', () => {
  const counts = Tiles.toCounts([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9, 18, 18, 20]);
  const analysis = Evaluator.analyzeHand(counts);
  const rows = Coach.evaluateMultiAxis(analysis, counts, [], [], new Array(34).fill(0), [], { seatWind: 27, roundWind: 27 });
  assert.strictEqual(rows.length, analysis.discards.length);
  rows.forEach((r) => {
    assert.ok(['S', 'A', 'B', 'C'].includes(r.efficiency));
    assert.strictEqual(r.safety, 'NA'); // リーチ者がいないため
  });
});

test('buildOverallComment: 空でないコメントを生成する', () => {
  const row = { label: '5萬', efficiency: 'S', value: 'B', yaku: 'C', safety: 'NA' };
  const comment = Coach.buildOverallComment(row, true);
  assert.ok(comment.length > 0);
  assert.ok(comment.includes('5萬'));
});

console.log('== round.js: 局の進行 ==');

function baseWinCtxSeats() {
  return {};
}

test('リーチ宣言: 1000点減点+供託1本、ダブルリーチ・一発フラグが立つ', () => {
  // 配牌はランダムだとほぼテンパイにならない(そもそもテンパイ率が非常に低い)ため、
  // 手牌を直接テンパイ形に書き換えて検証する
  const rng = mulberry32(1);
  let match = GameState.createMatch({ humanSeat: -1 });
  match = GameState.startRound(match, rng);
  const seat = match.dealerSeat;
  const p = match.players[seat];
  // 123456789m(3面子)+11筒(頭)+1索+9索(孤立2枚) は1シャンテン。1索をもう1枚引けば
  // 111索の刻子候補ができてテンパイになる(検証済みの形)。
  p.handCounts = countsOf('123456789m11p1s9s');
  RoundEngine.drawTile(match);
  p.drawnTile = 18; // 1索をツモったことにする
  assert.strictEqual(RoundEngine.canDeclareRiichi(match, seat), true);

  const scoreBefore = p.score;
  RoundEngine.discardTile(match, 26, true); // 孤立していた9索を切ってテンパイを維持しつつリーチ
  assert.strictEqual(p.score, scoreBefore - 1000);
  assert.strictEqual(match.kyotaku, 1);
  assert.strictEqual(p.riichi, true);
  assert.strictEqual(p.isDoubleRiichi, true); // 第1打牌かつ他家の鳴きが無いため
  assert.strictEqual(p.ippatsuActive, true);
});

test('暗槓: 手牌から4枚減り、副露に暗槓が記録され、嶺上ツモの準備状態になる', () => {
  const rng = mulberry32(3);
  let match = GameState.createMatch({ humanSeat: -1 });
  match = GameState.startRound(match, rng);
  const seat = match.dealerSeat;
  const p = match.players[seat];
  // 手牌に4枚そろう牌を人工的に作る
  const tile = 0;
  p.handCounts[tile] = 4;
  const beforeTotal = Tiles.totalCount(p.handCounts);
  RoundEngine.declareAnkan(match, tile);
  assert.strictEqual(p.handCounts[tile], 0);
  assert.strictEqual(p.fuuro.length, 1);
  assert.strictEqual(p.fuuro[0].type, 'ankan');
  assert.strictEqual(match.currentRound.pendingRinshan, true);
  // 暗槓は「手の中の4枚」を「副露の4枚」に付け替えるだけで、合計枚数は変わらない
  // (山からの1枚補充は嶺上ツモとして別に行われる)
  assert.strictEqual(Tiles.totalCount(p.handCounts) + p.fuuro[0].tiles.length, beforeTotal);
});

test('流局: ノーテン3人・テンパイ1人なら3000点が1000点ずつ流れる', () => {
  let match = GameState.createMatch({ humanSeat: -1 });
  match = GameState.startRound(match, mulberry32(1));
  // 強制的に手牌を組み立てて流局を再現する(1人だけテンパイ、残り3人はバラバラで確実にノーテン)
  match.players[0].handCounts = countsOf('123456789m11p12s'); // テンパイ(辺張3s待ち)
  const notenHand = [0, 3, 6, 9, 12, 15, 18, 21, 24, 27, 28, 29, 30]; // 互いに孤立した13枚
  match.players[1].handCounts = Tiles.toCounts(notenHand);
  match.players[2].handCounts = Tiles.toCounts(notenHand);
  match.players[3].handCounts = Tiles.toCounts(notenHand);
  const scoresBefore = match.players.map((p) => p.score);
  RoundEngine.endRoundRyuukyoku(match);
  assert.strictEqual(match.currentRound.result.type, 'ryuukyoku');
  assert.deepStrictEqual(match.currentRound.result.tenpaiSeats, [0]);
  assert.strictEqual(match.players[0].score, scoresBefore[0] + 3000);
  assert.strictEqual(match.players[1].score, scoresBefore[1] - 1000);
  assert.strictEqual(match.players[2].score, scoresBefore[2] - 1000);
  assert.strictEqual(match.players[3].score, scoresBefore[3] - 1000);
});

test('親が和了すると連荘(親・局数は変わらず、本場が増える)', () => {
  let match = GameState.createMatch({ humanSeat: -1 });
  const dealerBefore = match.dealerSeat;
  const roundBefore = match.roundNumber;
  RoundEngine.prepareNextRound(match, true);
  assert.strictEqual(match.dealerSeat, dealerBefore);
  assert.strictEqual(match.roundNumber, roundBefore);
  assert.strictEqual(match.honba, 1);
});

test('親以外が和了すると親が移動し、本場は0に戻る', () => {
  let match = GameState.createMatch({ humanSeat: -1 });
  match.honba = 2;
  const dealerBefore = match.dealerSeat;
  RoundEngine.prepareNextRound(match, false);
  assert.strictEqual(match.dealerSeat, (dealerBefore + 1) % 4);
  assert.strictEqual(match.honba, 0);
  assert.strictEqual(match.roundNumber, 2);
});

test('東風戦は東4局の後に終了する', () => {
  let match = GameState.createMatch({ humanSeat: -1, rules: { gameLength: 'tonpuusen' } });
  match.roundNumber = 4;
  RoundEngine.prepareNextRound(match, false);
  assert.strictEqual(match.isOver, true);
  assert.strictEqual(match.finalRanking.length, 4);
});

test('飛び(トビ)ルール: 誰かの点数がマイナスになった時点で対局終了になる', () => {
  let match = GameState.createMatch({ humanSeat: -1, rules: { tobi: true } });
  match.players[2].score = -500;
  RoundEngine.prepareNextRound(match, true);
  assert.strictEqual(match.isOver, true);
});

test('resolveCallsWithHuman: 人間の決定とCPUの自動判断を両立して解決する', () => {
  const rng = mulberry32(9);
  let match = GameState.createMatch({ humanSeat: 0 });
  match = GameState.startRound(match, rng);
  // 強制的にポン可能な状況を作る
  const seat0 = match.players[0];
  seat0.handCounts[10] = 2; // 2筒を2枚
  match.currentRound.turnSeat = 1;
  RoundEngine.drawTile(match);
  match.players[1].drawnTile = 10;
  RoundEngine.discardTile(match, 10, false);
  assert.ok(match.currentRound.callOptions[0].canPon);
  RoundEngine.resolveCallsWithHuman(match, 0, { action: 'pon' });
  assert.strictEqual(seat0.fuuro.length, 1);
  assert.strictEqual(match.currentRound.turnSeat, 0);
});

test('シミュレーション: 決まったシード値でシャンテン・点数がすべて正常な範囲に収まる', () => {
  for (let seed = 1; seed <= 5; seed++) {
    const rng = mulberry32(seed * 101);
    let match = GameState.createMatch({ humanSeat: -1, rules: { cpuStrength: 'weak' } });
    match = GameState.startRound(match, rng);
    const finished = RoundEngine.simulateRoundToEnd(match, 2000);
    assert.strictEqual(finished, true, `seed=${seed} で局が進行停止した`);
    match.players.forEach((p) => assert.ok(!Number.isNaN(p.score)));
    const total = match.players.reduce((sum, p) => sum + p.score, 0) + match.kyotaku * 1000;
    assert.strictEqual(total, 100000);
  }
});

console.log('== kifu.js ==');

// Node環境にはlocalStorageが無いため、テスト用の簡易メモリ実装を用意する
if (typeof global.localStorage === 'undefined') {
  const store = {};
  global.localStorage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => {
      store[k] = String(v);
    },
    removeItem: (k) => {
      delete store[k];
    },
  };
}

test('createKifu / recordRoundStart: 局情報が正しく記録される', () => {
  const rng = mulberry32(5);
  let match = GameState.createMatch({ humanSeat: -1 });
  match = GameState.startRound(match, rng);
  const kifu = Kifu.createKifu(match);
  Kifu.recordRoundStart(kifu, match);
  assert.strictEqual(kifu.rounds.length, 1);
  assert.strictEqual(kifu.rounds[0].dealerSeat, match.dealerSeat);
  assert.strictEqual(kifu.rounds[0].initialHands[0].length, 34);
});

test('reconstructRoundState: 全イベント再生後の手牌が実際の対局と一致する', () => {
  const rng = mulberry32(11);
  let match = GameState.createMatch({ humanSeat: -1 });
  match = GameState.startRound(match, rng);
  const kifu = Kifu.createKifu(match);
  Kifu.recordRoundStart(kifu, match);
  RoundEngine.simulateRoundToEnd(match, 3000);
  Kifu.appendEventsSince(kifu, match, 0);
  const roundRecord = kifu.rounds[0];
  const reconstructed = Kifu.reconstructRoundState(roundRecord, roundRecord.events.length);

  match.players.forEach((p, i) => {
    const r = reconstructed.players[i];
    const realFull = p.handCounts.slice();
    if (p.drawnTile !== null) realFull[p.drawnTile]++;
    const reconFull = r.handCounts.slice();
    if (r.drawnTile !== null) reconFull[r.drawnTile]++;
    assert.deepStrictEqual(reconFull, realFull, `seat${i}の手牌が牌譜再生と一致しない`);
  });
});

test('saveMatchKifu / loadAllKifu / deleteKifu: localStorageへの保存・削除ができる', () => {
  Kifu.deleteKifu(0);
  const before = Kifu.loadAllKifu().length;
  const rng = mulberry32(13);
  let match = GameState.createMatch({ humanSeat: -1 });
  match = GameState.startRound(match, rng);
  const kifu = Kifu.createKifu(match);
  Kifu.recordRoundStart(kifu, match);
  const ok = Kifu.saveMatchKifu(kifu);
  assert.strictEqual(ok, true);
  const after = Kifu.loadAllKifu();
  assert.strictEqual(after.length, before + 1);
  Kifu.deleteKifu(0);
  assert.strictEqual(Kifu.loadAllKifu().length, before);
});

test('computeCallOptions: すでに4面子ある場合は5つ目の副露を提示しない', () => {
  const rng = mulberry32(77);
  let match = GameState.createMatch({ humanSeat: -1 });
  match = GameState.startRound(match, rng);
  const victim = match.players[1];
  // 4面子そろった状態を人工的に作る(手牌は雀頭候補の2枚のみ)
  victim.fuuro = [
    { type: 'pon', tiles: [0, 0, 0], fromSeat: 0 },
    { type: 'pon', tiles: [9, 9, 9], fromSeat: 0 },
    { type: 'pon', tiles: [18, 18, 18], fromSeat: 0 },
    { type: 'pon', tiles: [27, 27, 27], fromSeat: 0 },
  ];
  victim.handCounts = new Array(Tiles.TILE_COUNT).fill(0);
  victim.handCounts[4] = 2;
  victim.riichi = false;
  match.currentRound.pendingDiscard = { seat: 0, tile: 4 };
  const options = RoundEngine.computeCallOptions(match);
  const entry = options[1];
  if (entry) {
    assert.strictEqual(entry.canPon, false, '5つ目の面子となるポンを提示してはいけない');
    assert.strictEqual(entry.canKan, false, '5つ目の面子となるカンを提示してはいけない');
    assert.strictEqual(entry.canChi, false, '5つ目の面子となるチーを提示してはいけない');
  }
});

test('computeCallOptions: リーチ済みプレイヤーには副露を提示しない', () => {
  const rng = mulberry32(78);
  let match = GameState.createMatch({ humanSeat: -1 });
  match = GameState.startRound(match, rng);
  const p = match.players[2];
  p.riichi = true;
  p.fuuro = [];
  p.handCounts = new Array(Tiles.TILE_COUNT).fill(0);
  p.handCounts[4] = 3;
  p.handCounts[10] = 3;
  p.handCounts[20] = 3;
  p.handCounts[30] = 3;
  p.handCounts[5] = 1;
  match.currentRound.pendingDiscard = { seat: 1, tile: 4 };
  const options = RoundEngine.computeCallOptions(match);
  const entry = options[2];
  if (entry) {
    assert.strictEqual(entry.canPon, false, 'リーチ後にポンを提示してはいけない');
    assert.strictEqual(entry.canKan, false, 'リーチ後にカンを提示してはいけない');
  }
});

test('CPU.decideDiscard: 手牌が極端に少ない異常形でも例外を投げない', () => {
  const rng = mulberry32(79);
  let match = GameState.createMatch({ humanSeat: -1 });
  match = GameState.startRound(match, rng);
  const p = match.players[0];
  p.fuuro = [
    { type: 'pon', tiles: [0, 0, 0], fromSeat: 1 },
    { type: 'pon', tiles: [9, 9, 9], fromSeat: 1 },
    { type: 'pon', tiles: [18, 18, 18], fromSeat: 1 },
    { type: 'pon', tiles: [27, 27, 27], fromSeat: 1 },
  ];
  p.handCounts = new Array(Tiles.TILE_COUNT).fill(0);
  p.drawnTile = 5;
  ['weak', 'normal', 'strong'].forEach((strength) => {
    const tile = CPU.decideDiscard(p, match, strength);
    assert.ok(typeof tile === 'number' && tile >= 0, `${strength}で不正な打牌が返った`);
  });
});

test('yakumanScore: 役満ツモの支払い額(tsumoDealer/tsumoNonDealer)が必ず数値になる', () => {
  // 子の役満ツモ: 親から16000・子から8000ずつ(合計32000)
  const child = Scoring.yakumanScore(1, false, true);
  assert.strictEqual(child.tsumoDealer, 16000, '子役満ツモの親の支払いが不正');
  assert.strictEqual(child.tsumoNonDealer, 8000, '子役満ツモの子の支払いが不正');
  assert.strictEqual(child.total, 32000);

  // 親の役満ツモ: 子が全員16000ずつ(合計48000)
  const dealer = Scoring.yakumanScore(1, true, true);
  assert.strictEqual(dealer.tsumoNonDealer, 16000, '親役満ツモの子の支払いが不正');
  assert.strictEqual(dealer.total, 48000);

  // ダブル役満も必ず埋まっていること
  const dbl = Scoring.yakumanScore(2, false, true);
  assert.ok(Number.isFinite(dbl.tsumoDealer) && Number.isFinite(dbl.tsumoNonDealer));
  assert.strictEqual(dbl.total, 64000);

  // ロンは ron が数値
  assert.strictEqual(Scoring.yakumanScore(1, false, false).ron, 32000);
  assert.strictEqual(Scoring.yakumanScore(1, true, false).ron, 48000);
});

test('applyWinPayments: 役満ツモでも点数がNaNにならず合計が保存される', () => {
  const rng = mulberry32(4242);
  let match = GameState.createMatch({ humanSeat: -1 });
  match = GameState.startRound(match, rng);
  match.honba = 1;
  match.kyotaku = 0;
  const before = match.players.reduce((a, p) => a + p.score, 0);
  const winnerSeat = (match.dealerSeat + 1) % 4;
  const score = Scoring.yakumanScore(1, false, true);
  const results = [{ seat: winnerSeat, isTsumo: true, scoreResult: { hasYaku: true, best: { score } } }];
  RoundEngine.applyWinPayments(match, results, null);
  match.players.forEach((p, i) => {
    assert.ok(Number.isFinite(p.score), 'seat' + i + 'の点数がNaNになった');
  });
  const after = match.players.reduce((a, p) => a + p.score, 0);
  assert.strictEqual(after, before, '点数の合計が保存されていない');
});

// ==================================================
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
