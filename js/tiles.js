/**
 * tiles.js
 * 麻雀牌の基礎データ・表記・変換ユーティリティ。
 *
 * 牌は 0〜33 の整数インデックスで表す。
 *   0-8   : 萬子 1〜9 (1m〜9m)
 *   9-17  : 筒子 1〜9 (1p〜9p)
 *   18-26 : 索子 1〜9 (1s〜9s)
 *   27-33 : 字牌 東南西北白發中
 */
(function (root) {
  'use strict';

  const TILE_COUNT = 34;

  const SUIT_MAN = 'm';
  const SUIT_PIN = 'p';
  const SUIT_SOU = 's';
  const SUIT_HONOR = 'z';

  const HONOR_NAMES = ['東', '南', '西', '北', '白', '發', '中'];
  const HONOR_FULL_NAMES = ['東', '南', '西', '北', '白', '發', '中'];
  const KANJI_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
  const SUIT_KANJI = { m: '萬', p: '筒', s: '索' };

  // 国士無双で使う么九牌(老頭牌+字牌)のインデックス一覧
  const TERMINALS_AND_HONORS = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];

  function suitOf(idx) {
    if (idx < 9) return SUIT_MAN;
    if (idx < 18) return SUIT_PIN;
    if (idx < 27) return SUIT_SOU;
    return SUIT_HONOR;
  }

  function isHonor(idx) {
    return idx >= 27;
  }

  function isTerminal(idx) {
    return idx === 0 || idx === 8 || idx === 9 || idx === 17 || idx === 18 || idx === 26;
  }

  function isTerminalOrHonor(idx) {
    return isHonor(idx) || isTerminal(idx);
  }

  // 数牌なら 1〜9、字牌なら 1〜7 (東南西北白發中の順)を返す
  function numberOf(idx) {
    if (idx < 27) return (idx % 9) + 1;
    return idx - 26;
  }

  // Unicode麻雀牌コードポイントを返す(フォント非対応環境では表示されない場合がある)
  function unicodeOf(idx) {
    if (idx < 9) return String.fromCodePoint(0x1f007 + idx); // 1m-9m
    if (idx < 18) return String.fromCodePoint(0x1f019 + (idx - 9)); // 1p-9p
    if (idx < 27) return String.fromCodePoint(0x1f010 + (idx - 18)); // 1s-9s
    const honorCodePoints = [0x1f000, 0x1f001, 0x1f002, 0x1f003, 0x1f006, 0x1f005, 0x1f004];
    return String.fromCodePoint(honorCodePoints[idx - 27]);
  }

  // 短い表記。例: "5萬" "3索" "東" "白"
  function shortLabel(idx) {
    if (idx < 27) return String(numberOf(idx)) + SUIT_KANJI[suitOf(idx)];
    return HONOR_NAMES[idx - 27];
  }

  // 正式名称(ホバー表示用)。例: "五萬" "九索" "發"
  function fullName(idx) {
    if (idx < 27) return KANJI_NUM[numberOf(idx) - 1] + SUIT_KANJI[suitOf(idx)];
    return HONOR_FULL_NAMES[idx - 27];
  }

  // 牌インデックス配列 -> 34要素の枚数配列
  function toCounts(tileIndices) {
    const counts = new Array(TILE_COUNT).fill(0);
    for (const i of tileIndices) counts[i]++;
    return counts;
  }

  // 34要素の枚数配列 -> 牌インデックス配列(昇順=萬子→筒子→索子→字牌の順に自動整列される)
  function toTileList(counts) {
    const list = [];
    for (let i = 0; i < TILE_COUNT; i++) {
      for (let k = 0; k < counts[i]; k++) list.push(i);
    }
    return list;
  }

  function cloneCounts(counts) {
    return counts.slice();
  }

  function totalCount(counts) {
    let sum = 0;
    for (let i = 0; i < TILE_COUNT; i++) sum += counts[i];
    return sum;
  }

  const Tiles = {
    TILE_COUNT,
    SUIT_MAN,
    SUIT_PIN,
    SUIT_SOU,
    SUIT_HONOR,
    HONOR_NAMES,
    KANJI_NUM,
    SUIT_KANJI,
    TERMINALS_AND_HONORS,
    suitOf,
    isHonor,
    isTerminal,
    isTerminalOrHonor,
    numberOf,
    unicodeOf,
    shortLabel,
    fullName,
    toCounts,
    toTileList,
    cloneCounts,
    totalCount,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Tiles;
  } else {
    root.MJ = root.MJ || {};
    root.MJ.Tiles = Tiles;
  }
})(typeof window !== 'undefined' ? window : globalThis);
