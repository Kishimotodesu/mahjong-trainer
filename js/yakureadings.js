/**
 * yakureadings.js
 * 役名・専門用語の「読み方」を集めたデータ。
 * 麻雀初心者は漢字の役名(混全帯幺九・対々和など)を見ても読み方が分からないことが多いため、
 * 表示するときに「混全帯幺九(チャンタ)」のようにルビ代わりのカタカナ表記を添える。
 * 実際の役判定ロジック(yaku.js)には手を加えず、表示専用の辞書として分離する。
 */
(function (root) {
  'use strict';

  /** yaku.js の key → 読み方(通称・カタカナ) */
  const YAKU_READINGS = {
    double_riichi: 'ダブリー',
    riichi: 'リーチ',
    ippatsu: 'イッパツ',
    menzen_tsumo: 'メンゼンツモ',
    haitei: 'ハイテイ',
    houtei: 'ホウテイ',
    rinshan: 'リンシャンカイホウ',
    chankan: 'チャンカン',
    // tanyao/pinfu/riichi等はyaku.js側の名前がすでにカタカナ(または読み仮名付き)のため、
    // 意図的にここへは含めない(「タンヤオ(タンヤオ)」のような冗長表示を避けるため)
    ryanpeikou: 'リャンペーコー',
    iipeikou: 'イーペーコー',
    toitoi: 'トイトイ',
    sanankou: 'サンアンコー',
    junchan: 'ジュンチャン',
    chanta: 'チャンタ',
    honroutou: 'ホンロートー',
    shousangen: 'ショウサンゲン',
    honitsu: 'ホンイツ',
    chinitsu: 'チンイツ',
    suuankou_tanki: 'スーアンコータンキ',
    suuankou: 'スーアンコー',
    daisangen: 'ダイサンゲン',
    daisuushi: 'ダイスーシー',
    shousuushi: 'ショウスーシー',
    tsuuiisou: 'ツーイーソー',
    chinroutou: 'チンロートー',
    ryuuiisou: 'リューイーソー',
    junsei_chuuren: 'ジュンセイチューレンポウトウ',
    chuuren: 'チューレンポウトウ',
    chiitoitsu: 'チートイツ',
    kokushi: 'コクシムソウ',
    kokushi13: 'コクシムソウ(13面待ち)',
  };

  /**
   * 三色同順・三色同刻・一気通貫はkeyに牌情報が混ざるため前方一致で判定する。
   * 役牌(yakuhai_*)は名前がすでに「役牌:發」「場風:東」のように分かりやすく
   * 展開されているため、あえて読み仮名は付けない(冗長になるため)。
   */
  const YAKU_READING_PREFIXES = [
    { prefix: 'sanshoku_doujun', reading: 'サンショクドウジュン' },
    { prefix: 'sanshoku_doukou', reading: 'サンショクドウコウ' },
    { prefix: 'ittsu', reading: 'イッキツウカン' },
  ];

  /**
   * 役のkey(またはname)から読み方を返す。見つからなければnull。
   */
  function readingForYaku(key) {
    if (!key) return null;
    if (YAKU_READINGS[key]) return YAKU_READINGS[key];
    const hit = YAKU_READING_PREFIXES.find((p) => key.indexOf(p.prefix) === 0);
    return hit ? hit.reading : null;
  }

  /**
   * 表示用に「役名(読み方)」の文字列を作る。読み方が無い、またはnameに
   * すでに読み方が含まれている(例:「平和(ピンフ)」)場合はnameをそのまま返す。
   */
  function displayNameWithReading(name, key) {
    if (!name) return name;
    if (name.indexOf('(') !== -1 || name.indexOf('（') !== -1) return name; // すでに読み仮名/補足が付いている
    const reading = readingForYaku(key);
    return reading ? `${name}(${reading})` : name;
  }

  const YakuReadings = { YAKU_READINGS, readingForYaku, displayNameWithReading };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = YakuReadings;
  } else {
    root.MJ = root.MJ || {};
    root.MJ.YakuReadings = YakuReadings;
  }
})(typeof window !== 'undefined' ? window : globalThis);
