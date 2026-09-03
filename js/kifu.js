/**
 * kifu.js
 * 対局の記録(牌譜)の保存・読み込み・1手ずつの再生、および
 * 「今回の対局で覚えるポイント」の自動抽出(復習機能)を扱う。
 *
 * 牌譜は「局ごとのスナップショット配列」として保存する。
 * 各スナップショットは、その時点で match.currentRound をそのまま
 * JSON化したもの+手番情報からなり、「前へ/次へ」で行き来できる。
 */
(function (root) {
  'use strict';

  let Tiles, Evaluator, HandInfo;
  if (typeof module !== 'undefined' && module.exports) {
    Tiles = require('./tiles.js');
    Evaluator = require('./evaluator.js');
    HandInfo = require('./handinfo.js');
  } else {
    Tiles = root.MJ.Tiles;
    Evaluator = root.MJ.Evaluator;
    HandInfo = root.MJ.HandInfo;
  }

  const KIFU_SCHEMA_VERSION = 1;
  const STORAGE_KEY = 'mahjong-trainer-kifu-v1';
  const MAX_STORED_MATCHES = 20;

  /**
   * match.events(round.jsが記録する簡易イベントログ)から、
   * 「牌譜」として保存しやすい形にまとめる。
   * 実際の再生には、局開始時のスナップショット+以後のイベント列を使う。
   */
  function recordRoundStart(kifu, match) {
    kifu.rounds.push({
      dealerSeat: match.dealerSeat,
      roundWindIndex: match.roundWindIndex,
      roundNumber: match.roundNumber,
      honba: match.honba,
      startScores: match.players.map((p) => p.score),
      initialHands: match.players.map((p) => p.handCounts.slice()),
      doraIndicator: match.currentRound.deadWall.doraIndicators[0],
      events: [],
      result: null,
    });
  }

  function createKifu(match) {
    return {
      schemaVersion: KIFU_SCHEMA_VERSION,
      createdAt: Date.now(),
      playerNames: match.players.map((p) => p.name),
      rules: match.rules,
      rounds: [],
    };
  }

  function appendEventsSince(kifu, match, fromIndex) {
    const currentRoundRecord = kifu.rounds[kifu.rounds.length - 1];
    if (!currentRoundRecord) return match.events.length;
    for (let i = fromIndex; i < match.events.length; i++) {
      currentRoundRecord.events.push(match.events[i]);
    }
    if (match.currentRound && match.currentRound.result) {
      currentRoundRecord.result = match.currentRound.result;
      currentRoundRecord.endScores = match.players.map((p) => p.score);
    }
    return match.events.length;
  }

  // ---- localStorage への保存・読み込み ----

  function saveMatchKifu(kifu) {
    try {
      const list = loadAllKifu();
      list.unshift(kifu);
      const trimmed = list.slice(0, MAX_STORED_MATCHES);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
      return true;
    } catch (e) {
      return false;
    }
  }

  function loadAllKifu() {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
      if (!raw) return [];
      return JSON.parse(raw);
    } catch (e) {
      return [];
    }
  }

  function deleteKifu(index) {
    const list = loadAllKifu();
    list.splice(index, 1);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch (e) {
      /* noop */
    }
  }

  // ---- 再生(1手ずつ前後に進める) ----

  /**
   * 1局分のイベント列を先頭から再生し、指定したステップ数まで進めた時点の
   * 盤面(4人の手牌・河・副露・ドラ等)を再構築する。
   * @param {object} roundRecord kifu.rounds[i]
   * @param {number} uptoStep 何イベント目まで反映するか(0で配牌直後)
   */
  function reconstructRoundState(roundRecord, uptoStep) {
    const state = {
      dealerSeat: roundRecord.dealerSeat,
      players: roundRecord.initialHands.map((hand, seat) => ({
        seat,
        handCounts: hand.slice(),
        drawnTile: null,
        fuuro: [],
        discards: [],
        riichi: false,
      })),
      doraIndicator: roundRecord.doraIndicator,
      turnSeat: roundRecord.dealerSeat,
      lastEvent: null,
    };

    const steps = Math.min(uptoStep, roundRecord.events.length);
    for (let i = 0; i < steps; i++) {
      const ev = roundRecord.events[i];
      applyEventToState(state, ev);
      state.lastEvent = ev;
    }
    return state;
  }

  // 実際のゲームエンジン(round.js)と同じ規約: handCountsは「今ツモった牌」を含まない。
  // ツモった牌は drawnTile に別枠で持ち、打牌(手出し)のときだけ手牌へ組み入れてから捨てる。
  function mergeDrawnIntoHand(p) {
    if (p.drawnTile !== null) {
      p.handCounts[p.drawnTile]++;
      p.drawnTile = null;
    }
  }

  function applyEventToState(state, ev) {
    if (ev.type === 'draw') {
      const p = state.players[ev.seat];
      p.drawnTile = ev.tile;
      state.turnSeat = ev.seat;
    } else if (ev.type === 'discard') {
      const p = state.players[ev.seat];
      if (ev.tsumogiri) {
        p.drawnTile = null; // ツモった牌をそのまま河へ。手牌は変化しない。
      } else {
        mergeDrawnIntoHand(p);
        p.handCounts[ev.tile]--;
      }
      p.discards.push({ tile: ev.tile, tsumogiri: ev.tsumogiri, riichi: ev.riichi });
      if (ev.riichi) p.riichi = true;
    } else if (ev.type === 'call') {
      const p = state.players[ev.seat];
      const fromP = state.players[ev.fromSeat];
      if (fromP.discards.length > 0) fromP.discards[fromP.discards.length - 1].calledBy = ev.seat;
      // meldTiles には呼んだ牌も含めて全て入っている。捨て牌由来の1枚だけを除き、
      // 残りを自分の手札から引く(ポン・カンは同じ牌が並ぶため、最初の1枚だけ除外する)。
      let skippedCalledTile = false;
      (ev.meldTiles || []).forEach((t) => {
        if (!skippedCalledTile && t === ev.tile) {
          skippedCalledTile = true;
          return;
        }
        p.handCounts[t]--;
      });
      p.fuuro.push({ type: ev.callType, tiles: ev.meldTiles, calledTile: ev.tile, from: ev.fromSeat });
      state.turnSeat = ev.seat;
    } else if (ev.type === 'ankan') {
      const p = state.players[ev.seat];
      mergeDrawnIntoHand(p);
      (ev.meldTiles || [ev.tile, ev.tile, ev.tile, ev.tile]).forEach((t) => (p.handCounts[t]--));
      p.fuuro.push({ type: ev.type, tiles: [ev.tile, ev.tile, ev.tile, ev.tile] });
    } else if (ev.type === 'kakan') {
      const p = state.players[ev.seat];
      mergeDrawnIntoHand(p);
      p.handCounts[ev.tile]--; // 加槓は元のポンに4枚目を1枚足すだけ
      const meldIndex = p.fuuro.findIndex((m) => m.type === 'pon' && m.calledTile === ev.tile);
      if (meldIndex !== -1) p.fuuro[meldIndex] = { type: 'kakan', tiles: [ev.tile, ev.tile, ev.tile, ev.tile], calledTile: ev.tile, from: p.fuuro[meldIndex].from };
      else p.fuuro.push({ type: ev.type, tiles: [ev.tile, ev.tile, ev.tile, ev.tile] });
    } else if (ev.type === 'win') {
      state.winners = ev.winners;
      state.loserSeat = ev.loserSeat;
      state.winningTile = ev.winningTile;
    } else if (ev.type === 'ryuukyoku') {
      state.ryuukyoku = true;
      state.tenpaiSeats = ev.tenpaiSeats;
    }
  }

  // ---- 復習ポイントの自動抽出 ----

  /**
   * 1局分のイベントログから、学習価値が高そうな打牌を抽出する。
   * (受け入れを大きく減らした/シャンテンを戻した/テンパイを逃した、など)
   * 詳細な再現には手牌情報が必要なため、簡易版として
   * 「その打牌の直前直後でシャンテン数が悪化したかどうか」が分かる場合のみ抽出する。
   * このアプリでは discard イベント自体に詳細牌効率情報を付加していないため、
   * 呼び出し側(app.js)がリアルタイムに記録した reviewPoints をそのまま使う設計にしている。
   */
  function summarizeReviewPoints(reviewPoints, max) {
    if (!reviewPoints || reviewPoints.length === 0) return [];
    const sorted = reviewPoints.slice().sort((a, b) => b.severity - a.severity);
    return sorted.slice(0, max || 5);
  }

  const Kifu = {
    KIFU_SCHEMA_VERSION,
    createKifu,
    recordRoundStart,
    appendEventsSince,
    saveMatchKifu,
    loadAllKifu,
    deleteKifu,
    reconstructRoundState,
    summarizeReviewPoints,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Kifu;
  } else {
    root.MJ = root.MJ || {};
    root.MJ.Kifu = Kifu;
  }
})(typeof window !== 'undefined' ? window : globalThis);
