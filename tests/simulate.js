/**
 * tests/simulate.js
 * CPU4人による自動対局を大量に実行し、進行停止・不正牌枚数・同一牌5枚・
 * 点数NaN・無限ループ・アガリ判定異常などが発生しないことを確認する。
 * 実行方法: node tests/simulate.js [試合数]
 */
const path = require('path');
const Tiles = require(path.join(__dirname, '..', 'js', 'tiles.js'));
const GameState = require(path.join(__dirname, '..', 'js', 'gamestate.js'));
const Round = require(path.join(__dirname, '..', 'js', 'round.js'));

const MATCH_COUNT = parseInt(process.argv[2], 10) || 300;
const STRENGTHS = ['weak', 'standard', 'strong'];

let totalRounds = 0;
let errors = 0;
const errorSamples = [];

function reportError(msg, extra) {
  errors++;
  if (errorSamples.length < 20) errorSamples.push({ msg, extra });
}

function validateTileConservation(match) {
  // 手牌+副露+捨て牌+山+死に山 の合計が136枚、各牌種は4枚以内であること
  const counts = new Array(34).fill(0);
  for (const p of match.players) {
    for (let i = 0; i < 34; i++) counts[i] += p.handCounts[i];
    if (p.drawnTile !== null && p.drawnTile !== undefined) counts[p.drawnTile]++;
    p.fuuro.forEach((m) => m.tiles.forEach((t) => counts[t]++));
    // 鳴かれた捨て牌は副露側の面子として数え済みなので、河には残っていないものとして扱う
    // 注意: calledBy は座席番号(0始まり)なので、falsy判定(!d.calledBy)ではなく
    // null/undefinedとの厳密比較を使うこと(座席0による鳴きを見逃すバグを防ぐ)
    p.discards.forEach((d) => {
      if (d.calledBy === null || d.calledBy === undefined) counts[d.tile]++;
    });
  }
  const round = match.currentRound;
  if (round) {
    round.wall.forEach((t) => counts[t]++);
    // 嶺上牌はすでに引かれた分(rinshanUsed)を除く(引かれた牌は手牌/捨て牌側で数えられる)
    round.deadWall.rinshanTiles.slice(round.deadWall.rinshanUsed).forEach((t) => counts[t]++);
    round.deadWall.doraIndicators.forEach((t) => counts[t]++);
    round.deadWall.uraDoraIndicators.forEach((t) => counts[t]++);
  }
  const total = counts.reduce((a, b) => a + b, 0);
  if (total !== 136) {
    reportError('牌の総数が136枚でない', { total });
    return false;
  }
  for (let i = 0; i < 34; i++) {
    if (counts[i] > 4) {
      reportError('同一牌が5枚以上存在する', { tile: i, count: counts[i] });
      return false;
    }
  }
  return true;
}

function validateScores(match) {
  for (const p of match.players) {
    if (Number.isNaN(p.score)) {
      reportError('点数がNaNになった', { seat: p.seat });
      return false;
    }
  }
  const total = match.players.reduce((sum, p) => sum + p.score, 0) + match.kyotaku * 1000;
  const expectedTotal = 25000 * 4;
  if (Math.abs(total - expectedTotal) > 1) {
    reportError('点数の合計が25000x4と一致しない(供託含む)', { total, expectedTotal });
    return false;
  }
  return true;
}

function runOneMatch(matchIndex) {
  const cpuStrength = STRENGTHS[matchIndex % STRENGTHS.length];
  let match = GameState.createMatch({
    rules: { gameLength: matchIndex % 2 === 0 ? 'hanchan' : 'tonpuusen', cpuStrength },
    humanSeat: -1,
    playerNames: ['P0', 'P1', 'P2', 'P3'],
  });

  let guard = 0;
  while (!match.isOver && guard < 30) {
    guard++;
    match = GameState.startRound(match);
    if (!validateTileConservation(match)) return false;

    const finished = Round.simulateRoundToEnd(match, 3000);
    totalRounds++;
    if (!finished) {
      reportError('局が進行停止した(simulateRoundToEndがfalseを返した)', {
        matchIndex,
        phase: match.currentRound.phase,
      });
      return false;
    }

    if (!validateTileConservation(match)) return false;
    if (!validateScores(match)) return false;

    const result = match.currentRound.result;
    if (!result || (result.type !== 'win' && result.type !== 'ryuukyoku')) {
      reportError('アガリ判定異常: resultが不正', { matchIndex, result });
      return false;
    }
    if (result.type === 'win') {
      for (const w of result.winners) {
        if (!w.scoreResult || !w.scoreResult.hasYaku) {
          reportError('役なしなのにアガリとして処理された', { matchIndex, seat: w.seat });
          return false;
        }
        if (Number.isNaN(w.scoreResult.best.score.total)) {
          reportError('点数計算結果がNaN', { matchIndex, seat: w.seat });
          return false;
        }
      }
    }
  }

  if (guard >= 30) {
    reportError('半荘が30局以内に終了しなかった(無限ループの疑い)', { matchIndex });
    return false;
  }

  if (!match.finalRanking || match.finalRanking.length !== 4) {
    reportError('最終順位が正しく計算されなかった', { matchIndex });
    return false;
  }

  return true;
}

console.log(`CPU自動対局シミュレーションを開始します(${MATCH_COUNT}試合)...`);
const start = Date.now();
let completedMatches = 0;
for (let i = 0; i < MATCH_COUNT; i++) {
  const ok = runOneMatch(i);
  if (ok) completedMatches++;
}
const elapsed = Date.now() - start;

console.log(`完了: ${completedMatches}/${MATCH_COUNT} 試合が正常終了、合計${totalRounds}局を消化(${elapsed}ms)`);
console.log(`検出されたエラー件数: ${errors}`);
if (errorSamples.length > 0) {
  console.log('エラーサンプル:');
  errorSamples.forEach((e) => console.log(' -', e.msg, JSON.stringify(e.extra)));
}
process.exit(errors > 0 ? 1 : 0);
