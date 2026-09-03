/**
 * cpu.js
 * CPU(コンピュータ)プレイヤーの意思決定ロジック。
 * 「ランダムに牌を切るだけ」にならないよう、必ずシャンテン数・受け入れ・
 * 役の可能性・安全度のいずれかに基づいて判断する。
 *
 * 難易度3段階:
 *  - weak(初心者): 牌効率のみで判断。安全度・役の見極めは考慮しない。
 *  - standard(標準): 牌効率中心。役の無い鳴きは避け、明確な危険牌はある程度回避する。
 *  - strong(強め): 牌効率・役・ドラ・安全度を総合的に考慮する。
 */
(function (root) {
  'use strict';

  let Tiles, Evaluator, YakuCandidates, Safety, PushFold, Melds;
  if (typeof module !== 'undefined' && module.exports) {
    Tiles = require('./tiles.js');
    Evaluator = require('./evaluator.js');
    YakuCandidates = require('./yakucandidates.js');
    Safety = require('./safety.js');
    PushFold = require('./pushfold.js');
    Melds = require('./melds.js');
  } else {
    Tiles = root.MJ.Tiles;
    Evaluator = root.MJ.Evaluator;
    YakuCandidates = root.MJ.YakuCandidates;
    Safety = root.MJ.Safety;
    PushFold = root.MJ.PushFold;
    Melds = root.MJ.Melds;
  }

  function buildVisibleCounts(match) {
    const visible = new Array(Tiles.TILE_COUNT).fill(0);
    for (const p of match.players) {
      for (let i = 0; i < Tiles.TILE_COUNT; i++) visible[i] += p.handCounts[i];
      if (p.drawnTile !== null && p.drawnTile !== undefined) visible[p.drawnTile]++;
      p.fuuro.forEach((m) => m.tiles.forEach((t) => visible[t]++));
      p.discards.forEach((d) => visible[d.tile]++);
    }
    const round = match.currentRound;
    if (round) {
      round.deadWall.doraIndicators.slice(0, round.deadWall.revealedDoraCount).forEach((t) => visible[t]++);
    }
    return visible;
  }

  function riichiOpponents(player, match) {
    return match.players.filter((p) => p.seat !== player.seat && p.riichi);
  }

  function findSafeTile(player, counts14, match) {
    const riichiPlayers = riichiOpponents(player, match);
    if (riichiPlayers.length === 0) return null;
    const visible = buildVisibleCounts(match);

    let best = null;
    let bestRank = -1;
    const RANK = { genbutsu: 4, dead: 4, suji_nochance: 3, nochance: 2, suji: 2, onechance: 1, normal: 0 };

    for (let tile = 0; tile < Tiles.TILE_COUNT; tile++) {
      if (counts14[tile] <= 0) continue;
      // 全リーチ者に対する最低ランクを取る(誰か一人にでも危険なら安全とは言えない)
      let minRank = Infinity;
      for (const rp of riichiPlayers) {
        const s = Safety.evaluateTileSafety(tile, rp, match.players, visible);
        minRank = Math.min(minRank, RANK[s.level] !== undefined ? RANK[s.level] : 0);
      }
      if (minRank > bestRank) {
        bestRank = minRank;
        best = tile;
      }
    }
    return bestRank >= 2 ? best : null; // suji/nochance以上のみ「安全牌あり」とみなす
  }

  /**
   * 打牌を決定する。
   * @param {object} player 手番のプレイヤー(drawnTileを含む状態)
   * @param {object} match
   * @param {'weak'|'standard'|'strong'} strength
   * @returns {number} 切る牌のインデックス
   */
  function decideDiscard(player, match, strength) {
    const counts14 = player.handCounts.slice();
    if (player.drawnTile !== null) counts14[player.drawnTile]++;

    if (player.riichi) {
      // リーチ後はツモ切り基本
      return player.drawnTile !== null ? player.drawnTile : counts14.findIndex((c) => c > 0);
    }

    const lockedMelds = player.fuuro.length;
    const visibleCounts = buildVisibleCounts(match);
    const analysis = Evaluator.analyzeHand(counts14, { lockedMelds, visibleCounts });

    // 保険: 解析候補が空になる異常な形(手牌が極端に少ないなど)ではツモ牌を切る
    if (!analysis.recommended || !analysis.discards || analysis.discards.length === 0) {
      return player.drawnTile !== null ? player.drawnTile : counts14.findIndex((c) => c > 0);
    }

    if (strength === 'weak') {
      return analysis.recommended.tile;
    }

    const opponents = riichiOpponents(player, match);
    if (opponents.length > 0) {
      const roughHanValue =
        YakuCandidates.detectYakuCandidates(counts14, { seatWind: player.seatWind, roundWind: match.roundWindIndex === 0 ? 27 : 28 }).length +
        (player.fuuro.length > 0 ? 0 : 1);
      const safeTile = findSafeTile(player, counts14, match);
      const pf = PushFold.evaluatePushFold({
        shanten: analysis.currentShanten,
        riichiCount: opponents.length,
        turnCount: match.currentRound.turnCount,
        isDealer: player.isDealer,
        roughHanValue,
        safeTileCount: safeTile !== null ? 1 : 0,
      });

      if (pf.verdict === 'fold' && safeTile !== null) {
        return safeTile;
      }
      if (strength === 'strong' && pf.verdict === 'difficult' && safeTile !== null) {
        // 効率上位候補の中に安全な牌があればそちらを優先する
        const topCandidates = analysis.discards.slice(0, 3);
        const safeAmongTop = topCandidates.find((d) => d.tile === safeTile);
        if (safeAmongTop) return safeAmongTop.tile;
      }
    }

    return analysis.recommended.tile;
  }

  /**
   * リーチするかどうかを決定する(テンパイに達した場合のみ呼ばれる)。
   */
  function decideRiichi(player, strength) {
    if (player.fuuro.length > 0) return false; // 門前でないとリーチ不可
    if (player.score < 1000) return false;
    return true; // すべての強さで、リーチできるなら基本的にリーチする
  }

  /**
   * 副露(チー・ポン・カン)の呼び掛けに応じるかどうかを決定する。
   * @param {object} player
   * @param {object} match
   * @param {'pon'|'chi'|'kan'} callType
   * @param {number} discardedTile 対象の捨て牌
   * @param {number[]} resultingConcealedCounts 副露後に手の中に残る想定牌(呼び出し側が算出)
   * @param {'weak'|'standard'|'strong'} strength
   */
  function decideCallResponse(player, match, callType, discardedTile, resultingConcealedCounts, strength) {
    const isYakuhaiCall = callType === 'pon' && Tiles.isHonor(discardedTile);

    if (strength === 'weak') {
      // 初心者CPUは役の有無を気にせずシャンテンが進むならほぼ鳴く
      return true;
    }

    // standard/strong: 役牌のポンは常に鳴く。それ以外は鳴いた後に役が見えるかで判断する。
    if (isYakuhaiCall) return true;

    const roundWind = match.roundWindIndex === 0 ? 27 : 28;
    const candidates = YakuCandidates.detectYakuCandidates(resultingConcealedCounts, {
      seatWind: player.seatWind,
      roundWind,
    });
    return candidates.length > 0;
  }

  const CPU = {
    buildVisibleCounts,
    riichiOpponents,
    findSafeTile,
    decideDiscard,
    decideRiichi,
    decideCallResponse,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CPU;
  } else {
    root.MJ = root.MJ || {};
    root.MJ.CPU = CPU;
  }
})(typeof window !== 'undefined' ? window : globalThis);
