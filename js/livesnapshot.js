/**
 * livesnapshot.js
 * 対局中の状態(match)から「自分の目に見えている情報だけ」を取り出したスナップショットを作る。
 *
 * ■ このファイルが V2.0 で最も重要な理由
 *  対局中の学習問題は、CPUの手牌や山の並びを一切使ってはいけない。
 *  match には当然それらが入っているため、学習側へ渡す前に必ずここを通し、
 *  「公開情報だけの、書き換えても対局に影響しないコピー」に変換する。
 *
 * ■ スナップショットに入れてよい情報
 *  自分の手牌・自分の副露・全員の河・公開された副露・ドラ表示牌・場風/自風・
 *  巡目・残り山の枚数・点棒・リーチ状況・本場/供託。
 *
 * ■ 入れてはいけない情報
 *  他家の手牌(handCounts / drawnTile)・山の中身・裏ドラ・未公開のドラ表示牌・
 *  嶺上牌。テスト(tests/live-tests.js)でこれを機械的に検査している。
 *
 * ■ 盤面の形
 *  players の形は defense.js / reading.js が期待する形(seat, label, riichi,
 *  discards:[{tile,turnIndex}], melds:[{type,tiles}])に合わせてある。
 *  そのため、既存の守備・河読みエンジンへそのまま渡せる。
 */
(function (root) {
  'use strict';

  let Tiles, Dora;
  if (typeof module !== 'undefined' && module.exports) {
    Tiles = require('./tiles.js');
    Dora = require('./dora.js');
  } else {
    Tiles = root.MJ.Tiles;
    Dora = root.MJ.Dora;
  }

  const RELATIVE_LABELS = ['自分', '下家', '対面', '上家'];
  const RELATIVE_READINGS = { 下家: 'シモチャ', 対面: 'トイメン', 上家: 'カミチャ' };

  /** 「下家(シモチャ)」のように読みを付けた表示名 */
  function seatLabelWithReading(label) {
    const reading = RELATIVE_READINGS[label];
    return reading ? label + '(' + reading + ')' : label;
  }

  function copyDiscards(player) {
    return (player.discards || []).map((d) => ({
      tile: d.tile,
      turnIndex: d.turnIndex,
      tsumogiri: !!d.tsumogiri,
      isRiichiDeclare: !!d.isRiichiDeclare,
      calledBy: d.calledBy === undefined ? null : d.calledBy,
    }));
  }

  function copyMelds(player) {
    return (player.fuuro || []).map((m) => ({
      type: m.type,
      tiles: (m.tiles || []).slice(),
      fromSeat: m.fromSeat === undefined ? null : m.fromSeat,
    }));
  }

  /**
   * 公開情報だけで「見えている牌」を数える。
   * 自分の手牌・全員の河・全員の副露・公開済みのドラ表示牌だけを数え、
   * 他家の手牌や山は絶対に数えない(ここが cpu.js の buildVisibleCounts との違い)。
   */
  function publicVisibleCounts(match, humanSeat) {
    const visible = new Array(Tiles.TILE_COUNT).fill(0);
    const round = match.currentRound;
    match.players.forEach((p) => {
      if (p.seat === humanSeat) {
        for (let i = 0; i < Tiles.TILE_COUNT; i++) visible[i] += p.handCounts[i];
        if (p.drawnTile !== null && p.drawnTile !== undefined) visible[p.drawnTile]++;
      }
      (p.fuuro || []).forEach((m) => m.tiles.forEach((t) => visible[t]++));
      (p.discards || []).forEach((d) => visible[d.tile]++);
    });
    if (round && round.deadWall) {
      round.deadWall.doraIndicators.slice(0, round.deadWall.revealedDoraCount).forEach((t) => visible[t]++);
    }
    return visible;
  }

  /** リーチしている他家(自分以外)。読みの対象を決めるときに使う。 */
  function riichiOpponentsOf(snapshot) {
    return snapshot.players.filter((p) => !p.isSelf && p.riichi);
  }

  /** 副露している他家(河読みの対象候補) */
  function openOpponentsOf(snapshot) {
    return snapshot.players.filter((p) => !p.isSelf && p.melds.length > 0);
  }

  /**
   * 読みの対象(誰を警戒するか)を決める。
   * リーチしている相手を優先し、いなければ副露している相手、それも無ければ null。
   */
  function defaultTargetSeat(snapshot) {
    const riichi = riichiOpponentsOf(snapshot);
    if (riichi.length > 0) return riichi[0].seat;
    const open = openOpponentsOf(snapshot);
    if (open.length > 0) return open[0].seat;
    return null;
  }

  /**
   * 対局状態から公開情報だけのスナップショットを作る。
   * @param {object} match gamestate.js の match
   * @param {number} humanSeat 自分の席
   * @returns {object} 学習エンジンへ渡してよい盤面
   */
  function buildSnapshot(match, humanSeat) {
    const seat = humanSeat === undefined ? 0 : humanSeat;
    const round = match.currentRound;
    const me = match.players[seat];

    const players = match.players.map((p) => {
      const relative = RELATIVE_LABELS[(p.seat - seat + 4) % 4];
      return {
        seat: p.seat,
        name: p.name,
        label: relative,
        labelWithReading: seatLabelWithReading(relative),
        isSelf: p.seat === seat,
        isDealer: !!p.isDealer,
        seatWind: p.seatWind,
        score: p.score,
        riichi: !!p.riichi,
        riichiDeclaredAtTurnIndex:
          p.riichiDeclaredAtTurnIndex === undefined ? -1 : p.riichiDeclaredAtTurnIndex,
        discards: copyDiscards(p),
        melds: copyMelds(p),
      };
    });

    const doraIndicators = round && round.deadWall
      ? round.deadWall.doraIndicators.slice(0, round.deadWall.revealedDoraCount)
      : [];

    const handCounts = me.handCounts.slice();
    const drawnTile = me.drawnTile === undefined ? null : me.drawnTile;
    const counts14 = handCounts.slice();
    if (drawnTile !== null) counts14[drawnTile]++;

    const snapshot = {
      // ---- 自分の情報(自分の手牌は当然見えてよい) ----
      seat,
      handCounts,
      drawnTile,
      counts14,
      hand: Tiles.toTileList(counts14),
      melds: copyMelds(me),
      fuuroCount: (me.fuuro || []).length,
      isRiichi: !!me.riichi,
      isDealer: !!me.isDealer,
      seatWind: me.seatWind,
      furitenTemporary: !!me.furitenTemporary,
      furitenRiichi: !!me.furitenRiichi,
      ownDiscards: copyDiscards(me),

      // ---- 全員に見えている情報 ----
      players,
      roundWind: 27 + (match.roundWindIndex || 0),
      doraIndicators,
      doraTiles: doraIndicators.map((t) => Dora.doraTileFromIndicator(t)),
      turn: round ? round.turnCount : 0,
      wallCount: round ? round.wall.length : 0,
      phase: round ? round.phase : 'round_over',
      turnSeat: round ? round.turnSeat : null,
      honba: match.honba || 0,
      kyotaku: match.kyotaku || 0,
      roundWindIndex: round ? round.roundWindIndexAtStart : match.roundWindIndex,
      roundNumber: round ? round.roundNumberAtStart : match.roundNumber,
      scores: match.players.map((p) => p.score),
      visibleCounts: publicVisibleCounts(match, seat),
      pendingDiscard: round && round.pendingDiscard
        ? { seat: round.pendingDiscard.seat, tile: round.pendingDiscard.tile, turnIndex: round.pendingDiscard.turnIndex }
        : null,
    };

    snapshot.targetSeat = defaultTargetSeat(snapshot);
    return snapshot;
  }

  /**
   * defense.js / reading.js に渡すための盤面ビューを作る。
   * targetSeat を差し替えたいとき(相手ごとの安全度を比べるとき)に使う。
   */
  function boardView(snapshot, targetSeat) {
    return {
      players: snapshot.players,
      targetSeat: targetSeat === undefined ? snapshot.targetSeat : targetSeat,
      visibleCounts: snapshot.visibleCounts,
      doraIndicators: snapshot.doraIndicators,
      roundWind: snapshot.roundWind,
      seatWind: snapshot.seatWind,
      hand: snapshot.hand,
    };
  }

  /**
   * スナップショットに隠し情報が混ざっていないかを検査する(テスト・開発用)。
   * 他家の手牌・山・裏ドラに相当するキーが無いことを確認する。
   * @returns {string[]} 問題があればその説明(空配列なら安全)
   */
  function findHiddenLeaks(snapshot) {
    const problems = [];
    const banned = ['wall', 'deadWall', 'uraDoraIndicators', 'rinshanTiles'];
    banned.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(snapshot, key)) problems.push('スナップショットに ' + key + ' が含まれています');
    });
    (snapshot.players || []).forEach((p) => {
      if (p.isSelf) return;
      if (p.handCounts) problems.push(p.label + ' の手牌が含まれています');
      if (p.drawnTile !== undefined && p.drawnTile !== null) problems.push(p.label + ' のツモ牌が含まれています');
    });
    return problems;
  }

  const LiveSnapshot = {
    RELATIVE_LABELS,
    seatLabelWithReading,
    publicVisibleCounts,
    buildSnapshot,
    boardView,
    riichiOpponentsOf,
    openOpponentsOf,
    defaultTargetSeat,
    findHiddenLeaks,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = LiveSnapshot;
  } else {
    root.MJ = root.MJ || {};
    root.MJ.LiveSnapshot = LiveSnapshot;
  }
})(typeof window !== 'undefined' ? window : globalThis);
