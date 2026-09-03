/**
 * tests/shanten-crosscheck.js
 * 「通常手」のシャンテン数を、本番コード(js/shanten.js の standardShanten)とは
 * 別のアルゴリズム(スートごとの独立DP + ブロック数によるナップサック的合成)で
 * 再計算する検証専用の実装。
 *
 * 目的: js/shanten.js の全探索(牌インデックス0〜33を順に走査する単一の再帰)には
 * スート境界の扱い等にバグが混入する余地があるため、根本的に異なる構造の実装で
 * 独立に同じ値が出ることを確認し、本番実装の正しさへの信頼度を上げる。
 * (このファイルはテスト専用。本番の index.html からは読み込まれない)
 */
'use strict';

const TILE_COUNT = 34;

// 1スート(9種)の枚数配列から、「ちょうどk個以下のブロック(面子+搭子)を使ったときの
// 最大評価値(2*面子数+搭子数)」を k=0..4 について返す。
// 面子=順子/刻子、搭子=両面/嵌張/辺張/(頭にしない)対子、のいずれか。
function bestForSuit(counts9) {
  const c = counts9.slice();
  const found = new Map(); // blocksUsed -> best value

  function record(blocks, value) {
    const cur = found.get(blocks);
    if (cur === undefined || value > cur) found.set(blocks, value);
  }

  function rec(pos, blocks, value) {
    if (blocks > 4) return;
    if (pos >= 9) {
      record(blocks, value);
      return;
    }
    if (c[pos] === 0) {
      rec(pos + 1, blocks, value);
      return;
    }

    if (blocks < 4 && c[pos] >= 3) {
      c[pos] -= 3;
      rec(pos, blocks + 1, value + 2);
      c[pos] += 3;
    }
    if (blocks < 4 && pos <= 6 && c[pos] >= 1 && c[pos + 1] >= 1 && c[pos + 2] >= 1) {
      c[pos]--; c[pos + 1]--; c[pos + 2]--;
      rec(pos, blocks + 1, value + 2);
      c[pos]++; c[pos + 1]++; c[pos + 2]++;
    }
    if (blocks < 4 && c[pos] >= 2) {
      // 頭には使わない対子(将来もう1枚引いて刻子にする搭子として扱う)
      c[pos] -= 2;
      rec(pos, blocks + 1, value + 1);
      c[pos] += 2;
    }
    if (blocks < 4 && pos <= 7 && c[pos] >= 1 && c[pos + 1] >= 1) {
      c[pos]--; c[pos + 1]--;
      rec(pos, blocks + 1, value + 1);
      c[pos]++; c[pos + 1]++;
    }
    if (blocks < 4 && pos <= 6 && c[pos] >= 1 && c[pos + 2] >= 1) {
      c[pos]--; c[pos + 2]--;
      rec(pos, blocks + 1, value + 1);
      c[pos]++; c[pos + 2]++;
    }
    rec(pos + 1, blocks, value);
  }

  rec(0, 0, 0);

  // 「ちょうどk」の集合から「k以下で最大」の単調配列に変換する
  const atMost = [0, 0, 0, 0, 0];
  for (let k = 0; k <= 4; k++) {
    let best = 0;
    for (const [b, v] of found.entries()) {
      if (b <= k && v > best) best = v;
    }
    atMost[k] = best;
  }
  return atMost;
}

// 1種類の字牌(残り枚数のみ)から、「k個以下のブロックでの最大評価値」(k=0,1)を返す
function bestForHonor(count) {
  let oneBlock = 0;
  if (count >= 3) oneBlock = 2; // 刻子
  else if (count >= 2) oneBlock = 1; // 対子(搭子扱い)
  return [0, oneBlock];
}

// 複数グループ(各グループは [k=0..4のat most配列]) を、
// 合計ブロック数上限 budget のもとで合成し、最大評価値を返す(簡易ナップサック)。
function combineGroups(groups, budget) {
  let acc = [0];
  for (let j = 1; j <= budget; j++) acc.push(0);

  for (const group of groups) {
    const next = acc.slice();
    for (let j = 0; j <= budget; j++) {
      let best = acc[j];
      const maxK = Math.min(j, group.length - 1);
      for (let k = 0; k <= maxK; k++) {
        const v = acc[j - k] + group[k];
        if (v > best) best = v;
      }
      next[j] = best;
    }
    acc = next;
  }
  return acc; // acc[k] = k個以下のブロックでの最大評価値
}

/**
 * 独立実装による通常手のシャンテン数計算。
 * @param {number[]} counts 34要素の枚数配列
 * @returns {number}
 */
function crosscheckStandardShanten(counts) {
  const manCounts = counts.slice(0, 9);
  const pinCounts = counts.slice(9, 18);
  const souCounts = counts.slice(18, 27);
  const honorCounts = counts.slice(27, 34);

  function groupsWithModified(modifyFn) {
    const m = modifyFn(0, manCounts.slice());
    const p = modifyFn(9, pinCounts.slice());
    const s = modifyFn(18, souCounts.slice());
    const groups = [bestForSuit(m), bestForSuit(p), bestForSuit(s)];
    for (let h = 0; h < 7; h++) {
      groups.push(bestForHonor(modifyFn(27 + h, [honorCounts[h]])[0]));
    }
    return groups;
  }

  // 頭を作らない場合
  const groupsNoPair = groupsWithModified((_base, arr) => arr);
  const accNoPair = combineGroups(groupsNoPair, 5);
  const shantenNoPair = 8 - Math.max(accNoPair[4], accNoPair[5] - 1);

  // 頭をtile種Tにする場合(T は counts[T]>=2 の各候補)
  let best = shantenNoPair;
  for (let t = 0; t < TILE_COUNT; t++) {
    if (counts[t] < 2) continue;
    const groups = groupsWithModified((base, arr) => {
      const localIdx = t - base;
      if (localIdx >= 0 && localIdx < arr.length) arr[localIdx] -= 2;
      return arr;
    });
    const acc = combineGroups(groups, 4);
    const shantenWithPair = 8 - acc[4] - 1;
    if (shantenWithPair < best) best = shantenWithPair;
  }

  return best;
}

module.exports = { crosscheckStandardShanten };
