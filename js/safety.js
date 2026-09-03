/**
 * safety.js
 * 初心者向けの安全牌・危険度判定。
 *
 * 「絶対安全」と「比較的安全」を明確に区別する。
 *  - 絶対安全: 現物(相手の捨て牌、またはリーチ後に他家が捨てて見逃された牌)、
 *              場に4枚すべて見えている牌(誰も待てない)
 *  - 比較的安全(参考程度): スジ、嵌張のワンチャン/ノーチャン
 *
 * 精密な放銃率計算ではなく、根拠のある構造的なルールのみを用いる
 * (ランダムな数値は使用しない)。
 */
(function (root) {
  'use strict';

  let Tiles;
  if (typeof module !== 'undefined' && module.exports) {
    Tiles = require('./tiles.js');
  } else {
    Tiles = root.MJ.Tiles;
  }

  /**
   * 指定したプレイヤーに対する「現物」集合を求める。
   * 自分自身の捨て牌、およびリーチ後に卓に出て見逃された(ロンされなかった)牌を含む。
   * @param {object} targetPlayer
   * @param {object[]} allPlayers
   */
  function computeGenbutsuSet(targetPlayer, allPlayers) {
    const set = new Set(targetPlayer.discards.map((d) => d.tile));
    if (targetPlayer.riichi && targetPlayer.riichiDeclaredAtTurnIndex !== undefined && targetPlayer.riichiDeclaredAtTurnIndex >= 0) {
      for (const p of allPlayers) {
        for (const d of p.discards) {
          if (d.turnIndex > targetPlayer.riichiDeclaredAtTurnIndex) set.add(d.tile);
        }
      }
    }
    return set;
  }

  /** 場に4枚すべて見えている(誰も持てない=待てない)牌の集合 */
  function computeDeadTiles(visibleCounts) {
    const set = new Set();
    for (let i = 0; i < Tiles.TILE_COUNT; i++) {
      if (visibleCounts[i] >= 4) set.add(i);
    }
    return set;
  }

  /**
   * discardSet(捨てられた/見えている牌の集合)から、スジになる数牌の集合を求める。
   * 例: 4が捨てられていれば、1と7がスジ(両面待ちに対して比較的安全)になる。
   */
  function computeSujiSet(discardSet) {
    const suji = new Set();
    for (const base of [0, 9, 18]) {
      for (let num = 1; num <= 9; num++) {
        const idx = base + (num - 1);
        const lowPartner = num - 3;
        const highPartner = num + 3;
        const lowSafe = lowPartner >= 1 && discardSet.has(base + (lowPartner - 1));
        const highSafe = highPartner <= 9 && discardSet.has(base + (highPartner - 1));
        if (lowSafe || highSafe) suji.add(idx);
      }
    }
    return suji;
  }

  /**
   * 嵌張のワンチャン/ノーチャンを判定する。
   * 牌Tの嵌張待ち(T-1,T+1を持って中の牌Tを待つ形)は、T-1かT+1のどちらかが
   * 場にたくさん見えていると成立しにくくなる。
   * @returns {'nochance'|'onechance'|null}
   */
  function kanchanChance(tile, visibleCounts) {
    if (Tiles.isHonor(tile)) return null;
    const pos = tile % 9;
    if (pos === 0 || pos === 8) return null; // 端は嵌張の対象牌になりにくい(1,9)
    const base = tile - pos;
    const lower = base + pos - 1;
    const upper = base + pos + 1;
    const lowerVisible = visibleCounts[lower] || 0;
    const upperVisible = visibleCounts[upper] || 0;
    if (lowerVisible >= 4 || upperVisible >= 4) return 'nochance';
    if (lowerVisible === 3 || upperVisible === 3) return 'onechance';
    return null;
  }

  /**
   * 1枚の牌について、指定したプレイヤーに対する安全度を評価する。
   * @param {number} tile
   * @param {object} targetPlayer リーチ等をしている評価対象のプレイヤー
   * @param {object[]} allPlayers
   * @param {number[]} visibleCounts 場に見えているすべての牌の枚数配列(自分の手牌含む)
   * @returns {{level:string, label:string, absolute:boolean, explanation:string}}
   */
  function evaluateTileSafety(tile, targetPlayer, allPlayers, visibleCounts) {
    const genbutsu = computeGenbutsuSet(targetPlayer, allPlayers);
    if (genbutsu.has(tile)) {
      return {
        level: 'genbutsu',
        label: '現物(絶対安全)',
        absolute: true,
        explanation: 'この牌でロンされることはありません(すでに見逃されているため)。',
      };
    }

    const dead = computeDeadTiles(visibleCounts);
    if (dead.has(tile)) {
      return {
        level: 'dead',
        label: '場に4枚見え(絶対安全)',
        absolute: true,
        explanation: 'この牌はすでに4枚とも見えているため、誰も待つことができません。',
      };
    }

    const suji = computeSujiSet(genbutsu);
    const chance = kanchanChance(tile, visibleCounts);

    if (suji.has(tile) && chance === 'nochance') {
      return {
        level: 'suji_nochance',
        label: '比較的安全(スジ+ノーチャン)',
        absolute: false,
        explanation: 'スジにあたり、かつ嵌張で待たれる可能性も低いため、比較的安全と考えられます。ただし絶対ではありません。',
      };
    }
    if (suji.has(tile)) {
      return {
        level: 'suji',
        label: '比較的安全(スジ)',
        absolute: false,
        explanation: 'スジにあたるため両面待ちの危険は下がりますが、嵌張・辺張・単騎・シャボの可能性は残ります。',
      };
    }
    if (chance === 'nochance') {
      return {
        level: 'nochance',
        label: '比較的安全(ノーチャン)',
        absolute: false,
        explanation: '嵌張で待たれるために必要な牌がすでに4枚とも見えているため、嵌張待ちの危険は低いです。',
      };
    }
    if (chance === 'onechance') {
      return {
        level: 'onechance',
        label: 'やや安全(ワンチャン)',
        absolute: false,
        explanation: '嵌張で待たれるために必要な牌が残り1枚のため、やや危険が下がります。',
      };
    }

    return {
      level: 'normal',
      label: '危険度: 通常',
      absolute: false,
      explanation: '現物・スジ・壁のいずれにも該当しません。特に安全とは言えない牌です。',
    };
  }

  const Safety = {
    computeGenbutsuSet,
    computeDeadTiles,
    computeSujiSet,
    kanchanChance,
    evaluateTileSafety,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Safety;
  } else {
    root.MJ = root.MJ || {};
    root.MJ.Safety = Safety;
  }
})(typeof window !== 'undefined' ? window : globalThis);
