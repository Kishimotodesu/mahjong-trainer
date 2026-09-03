/**
 * round.js
 * 1局(東1局など)の進行エンジン。配牌〜ツモ〜打牌〜副露〜リーチ〜ロン/ツモ〜
 * 点数計算〜点棒移動〜次局準備までを扱う。
 *
 * 設計方針:
 *  - すべての操作は match(gamestate.jsで作った状態)を直接書き換える形で進む。
 *  - CPUの意思決定(cpu.js)と組み合わせることで、人間の入力なしに1局・1半荘を
 *    自動進行できる(シミュレーションテスト・CPU同士の対局に利用する)。
 *  - 人間プレイヤーがいる場合は、判断が必要な局面(ツモ/カン/リーチ/ロン/ポン/チー)
 *    で advanceUntilHumanInput が止まり、UIから決定を渡してもらう。
 *
 * 簡略化(V1.3、READMEにも明記):
 *  - 喰い替えの禁止は実装していない
 *  - 暗槓のフリテン・国士無双搶槓などの特殊ルールは対象外
 *  - 天和・地和などの偶然役は未実装(検出は容易だが優先度を下げた)
 *  - 途中流局(四風子連打・九種九牌など)は未実装
 */
(function (root) {
  'use strict';

  let Tiles, GameState, Melds, Furiten, Scoring, Evaluator, Ukeire, CPU;
  if (typeof module !== 'undefined' && module.exports) {
    Tiles = require('./tiles.js');
    GameState = require('./gamestate.js');
    Melds = require('./melds.js');
    Furiten = require('./furiten.js');
    Scoring = require('./scoring.js');
    Evaluator = require('./evaluator.js');
    Ukeire = require('./ukeire.js');
    CPU = require('./cpu.js');
  } else {
    Tiles = root.MJ.Tiles;
    GameState = root.MJ.GameState;
    Melds = root.MJ.Melds;
    Furiten = root.MJ.Furiten;
    Scoring = root.MJ.Scoring;
    Evaluator = root.MJ.Evaluator;
    Ukeire = root.MJ.Ukeire;
    CPU = root.MJ.CPU;
  }

  function seatAfter(seat, n) {
    return (seat + (n || 1)) % 4;
  }

  function player(match, seat) {
    return match.players[seat];
  }

  function roundWindTile(match) {
    return 27 + match.roundWindIndex; // 0=東,1=南
  }

  function logEvent(match, event) {
    match.events.push(event);
  }

  // ==================================================
  // 手番: ツモ
  // ==================================================

  /**
   * 現在の手番のプレイヤーがツモる。山が尽きていれば流局処理を行う。
   * @returns {{ryuukyoku:boolean}}
   */
  function drawTile(match) {
    const round = match.currentRound;
    const seat = round.turnSeat;
    const p = player(match, seat);

    if (round.pendingRinshan) {
      const idx = round.deadWall.rinshanUsed;
      const tile = round.deadWall.rinshanTiles[idx];
      round.deadWall.rinshanUsed++;
      round.pendingRinshan = false;
      round.justDrewRinshan = true;
      p.drawnTile = tile;
    } else {
      round.justDrewRinshan = false;
      if (round.wall.length === 0) {
        endRoundRyuukyoku(match);
        return { ryuukyoku: true };
      }
      const tile = round.wall.pop();
      p.drawnTile = tile;
    }

    p.furitenTemporary = false; // 自分がツモると一時的フリテンは解消する
    round.phase = 'awaiting_discard';
    round.isHaitei = round.wall.length === 0 && !round.pendingRinshan;
    logEvent(match, {
      type: 'draw',
      seat,
      tile: p.drawnTile,
      source: round.justDrewRinshan ? 'rinshan' : 'wall',
    });
    return { ryuukyoku: false };
  }

  function buildCtx(match, seat, winningTile, isTsumo, extra) {
    const p = player(match, seat);
    const round = match.currentRound;
    return Object.assign(
      {
        winningTile,
        isTsumo,
        isRiichi: p.riichi && !p.isDoubleRiichi,
        isDoubleRiichi: p.isDoubleRiichi && p.riichi,
        isIppatsu: !!p.ippatsuActive,
        isHaitei: isTsumo && !!round.isHaitei,
        isHoutei: !isTsumo && !!round.isHaitei,
        isRinshan: isTsumo && !!round.justDrewRinshan,
        isChankan: !!(extra && extra.isChankan),
        isDealer: p.isDealer,
        seatWind: p.seatWind,
        roundWind: roundWindTile(match),
      },
      extra || {}
    );
  }

  function doraSettingFor(match, includeUra) {
    const round = match.currentRound;
    const setting = {
      indicatorTiles: GameState.currentDoraIndicators(round),
      aka: { m: 0, p: 0, s: 0 },
    };
    if (includeUra) setting.uraIndicatorTiles = GameState.currentUraDoraIndicators(round);
    return setting;
  }

  /**
   * ツモ和了が可能かどうか(現在drawnTileを含む状態で判定)。
   */
  function canTsumoAgari(match, seat) {
    const p = player(match, seat);
    if (p.drawnTile === null) return null;
    const concealed = p.handCounts.slice();
    concealed[p.drawnTile]++;
    const ctx = buildCtx(match, seat, p.drawnTile, true, {});
    const doraSetting = doraSettingFor(match, p.riichi);
    const result = Scoring.scoreHand(concealed, ctx, {}, doraSetting, p.fuuro);
    return result.complete && result.hasYaku ? result : null;
  }

  /** そのプレイヤーが今、門前でテンパイに到達できる打牌があるか(リーチ可否判定に使う) */
  function canDeclareRiichi(match, seat) {
    const p = player(match, seat);
    if (p.fuuro.length > 0) return false;
    if (p.riichi) return false;
    if (p.score < 1000) return false;
    if (match.currentRound.wall.length < 4) return false; // 山が少なすぎる場合は簡略化のため不可とする
    if (p.drawnTile === null) return false;
    const concealed = p.handCounts.slice();
    concealed[p.drawnTile]++;
    const analysis = Evaluator.analyzeHand(concealed, { lockedMelds: 0 });
    return analysis.currentShanten === 0;
  }

  // ==================================================
  // 手番: 打牌
  // ==================================================

  /**
   * 打牌する。isRiichiDeclare=trueならリーチ宣言としての打牌。
   */
  function discardTile(match, tile, isRiichiDeclare) {
    const round = match.currentRound;
    const seat = round.turnSeat;
    const p = player(match, seat);

    const wasTsumogiri = p.drawnTile === tile;
    const fromHand = p.handCounts.slice();
    if (wasTsumogiri) {
      // ツモ切り: drawnTileをそのまま河へ
    } else {
      fromHand[tile]--;
      fromHand[p.drawnTile]++;
    }
    p.handCounts = fromHand;
    p.drawnTile = null;

    const wasAlreadyInIppatsu = p.ippatsuActive && !isRiichiDeclare;
    if (isRiichiDeclare) {
      p.riichi = true;
      p.ippatsuActive = true;
      p.isDoubleRiichi = p.discards.length === 0 && !round.anyCallMade;
      p.score -= 1000;
      match.kyotaku += 1;
    } else if (wasAlreadyInIppatsu) {
      p.ippatsuActive = false;
    }

    const turnIndex = round.discardSequence++;
    if (isRiichiDeclare) p.riichiDeclaredAtTurnIndex = turnIndex;

    p.discards.push({ tile, tsumogiri: wasTsumogiri, isRiichiDeclare: !!isRiichiDeclare, calledBy: null, turnIndex });
    round.pendingDiscard = { seat, tile, turnIndex };
    round.isFirstGoAround = round.isFirstGoAround && round.turnCount <= 4;

    logEvent(match, { type: 'discard', seat, tile, tsumogiri: wasTsumogiri, riichi: !!isRiichiDeclare });

    computeCallOptions(match);
    round.phase = 'awaiting_calls';
  }

  // ==================================================
  // 副露(鳴き)の判定
  // ==================================================

  function computeCallOptions(match) {
    const round = match.currentRound;
    const { seat: fromSeat, tile } = round.pendingDiscard;
    const options = {};

    for (let i = 0; i < 4; i++) {
      if (i === fromSeat) continue;
      const p = player(match, i);
      const entry = { canRon: false, canPon: false, canKan: false, canChi: false, chiOptions: [] };

      // ロン判定: 手牌+この捨て牌でアガれるか
      const testConcealed = p.handCounts.slice();
      testConcealed[tile]++;
      const ctx = buildCtx(match, i, tile, false, {});
      const doraSetting = doraSettingFor(match, p.riichi);
      const scoreResult = Scoring.scoreHand(testConcealed, ctx, {}, doraSetting, p.fuuro);
      if (scoreResult.complete && scoreResult.hasYaku) {
        const myWait = computeWaitTiles(p);
        if (Furiten.canRon(p, myWait)) entry.canRon = true;
      }

      // 副露の可否。以下の場合はポン・チー・明槓を一切提示しない:
      //  - すでに4面子そろっている(5つ目の面子は構造上ありえない)
      //  - リーチ済み(本アプリではリーチ後の副露は認めない)
      //  - 鳴いた後に切る牌が残らない(手牌が0枚になる形は不正)
      const canMakeNewMeld = p.fuuro.length < 4 && !p.riichi;
      if (canMakeNewMeld) {
        const concealed = Tiles.totalCount(p.handCounts);
        // ポン・チーは手牌から2枚使い、その後1枚切るので3枚以上必要
        if (concealed >= 3) {
          entry.canPon = Melds.canPon(p.handCounts, tile);
          if (i === seatAfter(fromSeat, 1)) {
            entry.chiOptions = Melds.getChiOptions(p.handCounts, tile);
            entry.canChi = entry.chiOptions.length > 0;
          }
        }
        // 明槓は手牌から3枚使うが、その後嶺上牌を引いてから切るので3枚以上でよい
        if (concealed >= 3) {
          entry.canKan = Melds.canMinkan(p.handCounts, tile);
        }
      }

      if (entry.canRon || entry.canPon || entry.canKan || entry.canChi) options[i] = entry;
    }

    round.callOptions = options;
    return options;
  }

  /** 現在のテンパイ形に対する待ち牌一覧を返す(牌インデックスの配列) */
  function computeWaitTiles(p) {
    const info = Ukeire.calcUkeire(p.handCounts, { lockedMelds: p.fuuro.length });
    return info.shanten === 0 ? info.tiles.map((t) => t.tile) : [];
  }

  // ==================================================
  // 副露・ロン・パスの解決
  // ==================================================

  /**
   * 各プレイヤーの捨て牌への反応を解決する。
   * @param {object} decisions {seat: {action:'ron'|'pon'|'kan'|'chi'|'pass', chiTiles?:number[]}}
   */
  function resolveCalls(match, decisions) {
    const round = match.currentRound;
    const { seat: fromSeat, tile } = round.pendingDiscard;

    const ronSeats = Object.keys(decisions)
      .map(Number)
      .filter((s) => decisions[s].action === 'ron');
    if (ronSeats.length > 0) {
      endRoundWin(match, ronSeats, fromSeat, tile, false);
      return { result: 'ron', seats: ronSeats };
    }

    const kanSeat = Object.keys(decisions).map(Number).find((s) => decisions[s].action === 'kan');
    const ponSeat = Object.keys(decisions).map(Number).find((s) => decisions[s].action === 'pon');
    const chiSeat = Object.keys(decisions).map(Number).find((s) => decisions[s].action === 'chi');

    if (kanSeat !== undefined) {
      applyCallMeld(match, kanSeat, 'minkan', tile, fromSeat, null);
      return { result: 'kan', seat: kanSeat };
    }
    if (ponSeat !== undefined) {
      applyCallMeld(match, ponSeat, 'pon', tile, fromSeat, null);
      return { result: 'pon', seat: ponSeat };
    }
    if (chiSeat !== undefined) {
      const chiTiles = decisions[chiSeat].chiTiles;
      applyCallMeld(match, chiSeat, 'chi', tile, fromSeat, chiTiles);
      return { result: 'chi', seat: chiSeat };
    }

    // 誰も鳴かない: ロンできたのに見逃した人はフリテンになる
    Object.keys(round.callOptions || {}).forEach((sStr) => {
      const s = Number(sStr);
      if (round.callOptions[s].canRon && (!decisions[s] || decisions[s].action !== 'ron')) {
        const p = player(match, s);
        if (p.riichi) p.furitenRiichi = true;
        else p.furitenTemporary = true;
      }
    });

    advanceTurnAfterPass(match);
    return { result: 'pass' };
  }

  function applyCallMeld(match, seat, type, tile, fromSeat, chiTiles) {
    const round = match.currentRound;
    const p = player(match, seat);

    let applied;
    if (type === 'pon') applied = Melds.applyPon(p.handCounts, tile, fromSeat);
    else if (type === 'minkan') applied = Melds.applyMinkan(p.handCounts, tile, fromSeat);
    else applied = Melds.applyChi(p.handCounts, chiTiles, tile, fromSeat);

    p.handCounts = applied.handCounts;
    p.fuuro.push(applied.meld);

    round.pendingDiscard.calledBy = seat;
    const discardRecord = player(match, fromSeat).discards[player(match, fromSeat).discards.length - 1];
    if (discardRecord) discardRecord.calledBy = seat;

    match.players.forEach((pl) => (pl.ippatsuActive = false));
    round.anyCallMade = true;
    round.isFirstGoAround = false;

    logEvent(match, { type: 'call', seat, callType: type, tile, fromSeat, meldTiles: applied.meld.tiles.slice() });

    round.turnSeat = seat;
    if (type === 'minkan') {
      round.pendingRinshan = true;
      round.deadWall.revealedDoraCount = Math.min(round.deadWall.revealedDoraCount + 1, 5);
      round.phase = 'awaiting_draw';
    } else {
      round.phase = 'awaiting_discard';
    }
  }

  function advanceTurnAfterPass(match) {
    const round = match.currentRound;
    round.turnSeat = seatAfter(round.pendingDiscard.seat, 1);
    round.turnCount++;
    round.pendingDiscard = null;
    round.callOptions = null;
    round.phase = 'awaiting_draw';
  }

  // ==================================================
  // カン(暗槓・加槓)
  // ==================================================

  /** 自分の手番中に暗槓を宣言する */
  function declareAnkan(match, tile) {
    const round = match.currentRound;
    const seat = round.turnSeat;
    const p = player(match, seat);
    const counts = p.handCounts.slice();
    if (p.drawnTile !== null) counts[p.drawnTile]++;
    const applied = Melds.applyAnkan(counts, tile);
    p.handCounts = applied.handCounts;
    p.drawnTile = null;
    p.fuuro.push(applied.meld);
    round.deadWall.revealedDoraCount = Math.min(round.deadWall.revealedDoraCount + 1, 5);
    round.pendingRinshan = true;
    round.phase = 'awaiting_draw';
    match.players.forEach((pl) => (pl.ippatsuActive = false));
    logEvent(match, { type: 'ankan', seat, tile, meldTiles: applied.meld.tiles.slice() });
  }

  /** 自分の手番中に、既存のポンを加槓する。槍槓の可能性をチェックする必要がある。 */
  function declareKakan(match, tile) {
    const round = match.currentRound;
    const seat = round.turnSeat;
    const p = player(match, seat);
    const meldIndex = p.fuuro.findIndex((m) => m.type === 'pon' && m.tiles[0] === tile);
    if (meldIndex === -1) return { chankan: false };

    // 槍槓判定: 他家がこの牌でロンできるか
    for (let i = 0; i < 4; i++) {
      if (i === seat) continue;
      const other = player(match, i);
      const testConcealed = other.handCounts.slice();
      testConcealed[tile]++;
      const ctx = buildCtx(match, i, tile, false, { isChankan: true });
      const doraSetting = doraSettingFor(match, other.riichi);
      const scoreResult = Scoring.scoreHand(testConcealed, ctx, {}, doraSetting, other.fuuro);
      if (scoreResult.complete && scoreResult.hasYaku) {
        const myWait = computeWaitTiles(other);
        if (Furiten.canRon(other, myWait)) {
          endRoundWin(match, [i], seat, tile, true);
          return { chankan: true, winners: [i] };
        }
      }
    }

    const counts = p.handCounts.slice();
    if (p.drawnTile !== null) counts[p.drawnTile]++;
    const applied = Melds.applyKakan(counts, tile);
    p.handCounts = applied.handCounts;
    p.drawnTile = null;
    p.fuuro[meldIndex] = { type: 'kakan', tiles: [tile, tile, tile, tile], calledTile: tile, from: p.fuuro[meldIndex].from, concealed: false };
    round.deadWall.revealedDoraCount = Math.min(round.deadWall.revealedDoraCount + 1, 5);
    round.pendingRinshan = true;
    round.phase = 'awaiting_draw';
    match.players.forEach((pl) => (pl.ippatsuActive = false));
    logEvent(match, { type: 'kakan', seat, tile });
    return { chankan: false };
  }

  // ==================================================
  // 局の終了(和了・流局)と次局準備
  // ==================================================

  function endRoundWin(match, winnerSeats, loserSeat, winningTile, isChankan) {
    const round = match.currentRound;
    const results = winnerSeats.map((seat) => {
      const p = player(match, seat);
      const isTsumo = seat === loserSeat; // ツモの場合はloserSeat===winnerSeat(自分自身)として呼ぶ約束にする
      // ツモ・ロンいずれの場合も、この時点ではwinningTileはまだhandCountsに含まれていない
      // (ツモ牌はdrawnTileとして別管理、ロン牌は他家の捨て牌のため)
      const concealed = p.handCounts.slice();
      concealed[winningTile]++;
      const ctx = buildCtx(match, seat, winningTile, isTsumo, { isChankan: !!isChankan });
      const doraSetting = doraSettingFor(match, p.riichi);
      const scoreResult = Scoring.scoreHand(concealed, ctx, {}, doraSetting, p.fuuro);
      return { seat, scoreResult, isTsumo };
    });

    applyWinPayments(match, results, loserSeat);

    round.phase = 'round_over';
    round.result = { type: 'win', winners: results, loserSeat, kyotakuCollected: match.kyotaku };
    match.kyotaku = 0;
    logEvent(match, { type: 'win', winners: winnerSeats, loserSeat, winningTile });

    const anyDealerWin = winnerSeats.includes(match.dealerSeat);
    prepareNextRound(match, anyDealerWin);
  }

  function applyWinPayments(match, results, loserSeat) {
    const isTsumo = results.length > 0 && results[0].isTsumo;
    const winningResults = results.filter((r) => r.scoreResult.hasYaku);

    winningResults.forEach(({ seat, scoreResult }) => {
      const score = scoreResult.best.score;
      const honbaBonus = match.honba * 300; // ロン: 総取り300点/本場、ツモ: 各家100点/本場
      if (isTsumo) {
        const p = player(match, seat);
        match.players.forEach((other) => {
          if (other.seat === seat) return;
          const isPayerDealer = other.seat === match.dealerSeat;
          const amount = (isPayerDealer ? score.tsumoDealer : score.tsumoNonDealer) + 100 * match.honba;
          other.score -= amount;
          p.score += amount;
        });
      } else {
        const p = player(match, seat);
        p.score += score.ron + honbaBonus;
        player(match, loserSeat).score -= score.ron + honbaBonus;
      }
    });

    // 供託(リーチ棒)は最初の和了者がまとめて受け取る(ダブロン時の分配は簡略化)
    if (winningResults.length > 0 && match.kyotaku > 0) {
      player(match, winningResults[0].seat).score += match.kyotaku * 1000;
    }
  }

  function endRoundRyuukyoku(match) {
    const round = match.currentRound;
    const tenpaiSeats = [];
    const notenSeats = [];
    for (let i = 0; i < 4; i++) {
      const p = player(match, i);
      const analysis = Evaluator.analyzeHand(p.handCounts, { lockedMelds: p.fuuro.length });
      if (analysis.currentShanten <= 0 && Tiles.totalCount(p.handCounts) + p.fuuro.length * 3 >= 13) {
        tenpaiSeats.push(i);
      } else {
        notenSeats.push(i);
      }
    }

    if (tenpaiSeats.length > 0 && tenpaiSeats.length < 4) {
      const payEach = Math.floor(3000 / notenSeats.length / 100) * 100;
      const receiveEach = Math.floor(3000 / tenpaiSeats.length / 100) * 100;
      notenSeats.forEach((s) => (player(match, s).score -= payEach));
      tenpaiSeats.forEach((s) => (player(match, s).score += receiveEach));
    }

    round.phase = 'round_over';
    round.result = { type: 'ryuukyoku', tenpaiSeats, notenSeats };
    logEvent(match, { type: 'ryuukyoku', tenpaiSeats });

    const dealerTenpai = tenpaiSeats.includes(match.dealerSeat);
    prepareNextRound(match, dealerTenpai);
  }

  /**
   * 次局の準備(連荘・親移動・本場・局数の更新)。実際に startRound を呼ぶのは
   * 呼び出し側(app.js やシミュレーションループ)が行う。
   */
  function prepareNextRound(match, dealerContinues) {
    if (dealerContinues) {
      match.honba++;
    } else {
      match.honba = 0;
      match.dealerSeat = seatAfter(match.dealerSeat, 1);
      match.roundNumber++;
      if (match.roundNumber > 4) {
        match.roundNumber = 1;
        match.roundWindIndex++;
      }
    }

    const maxWindIndex = match.rules.gameLength === 'tonpuusen' ? 0 : 1;
    if (match.roundWindIndex > maxWindIndex) {
      match.isOver = true;
    }
    if (match.rules.tobi && match.players.some((p) => p.score < 0)) {
      match.isOver = true;
    }
    if (match.isOver) {
      match.finalRanking = match.players
        .slice()
        .sort((a, b) => b.score - a.score)
        .map((p, idx) => ({ seat: p.seat, name: p.name, score: p.score, rank: idx + 1 }));
    }
  }

  // ==================================================
  // CPU自動進行
  // ==================================================

  function strengthFor(match, seat) {
    const p = player(match, seat);
    if (p.isHuman) return null;
    if (typeof match.rules.cpuStrength === 'object') return match.rules.cpuStrength[seat] || 'standard';
    return match.rules.cpuStrength || 'standard';
  }

  /**
   * 現在の callOptions に対して、CPU席の分だけ自動で意思決定した結果を返す
   * (人間の席は含めない。呼び出し側で人間の決定とマージして resolveCalls に渡す)。
   */
  function buildAutoCallDecisions(match) {
    const round = match.currentRound;
    const decisions = {};
    const options = round.callOptions || {};
    Object.keys(options).forEach((sStr) => {
      const s = Number(sStr);
      const p = player(match, s);
      if (p.isHuman) return;
      const strength = strengthFor(match, s);
      const opt = options[s];
      if (opt.canRon) {
        decisions[s] = { action: 'ron' };
        return;
      }
      if (opt.canKan) {
        const resultingCounts = p.handCounts.slice();
        resultingCounts[round.pendingDiscard.tile] -= 3;
        if (CPU.decideCallResponse(p, match, 'kan', round.pendingDiscard.tile, resultingCounts, strength)) {
          decisions[s] = { action: 'kan' };
          return;
        }
      }
      if (opt.canPon) {
        const resultingCounts = p.handCounts.slice();
        resultingCounts[round.pendingDiscard.tile] -= 2;
        if (CPU.decideCallResponse(p, match, 'pon', round.pendingDiscard.tile, resultingCounts, strength)) {
          decisions[s] = { action: 'pon' };
          return;
        }
      }
      if (opt.canChi) {
        const chiTiles = opt.chiOptions[0];
        const resultingCounts = p.handCounts.slice();
        chiTiles.forEach((t) => {
          if (t !== round.pendingDiscard.tile) resultingCounts[t]--;
        });
        if (CPU.decideCallResponse(p, match, 'chi', round.pendingDiscard.tile, resultingCounts, strength)) {
          decisions[s] = { action: 'chi', chiTiles };
        }
      }
    });
    return decisions;
  }

  /**
   * 人間の呼び決定(1件)と、他のCPU席の自動決定をまとめて resolveCalls に渡す。
   * UIから呼ぶ想定。
   * @param {number} humanSeat
   * @param {{action:string, chiTiles?:number[]}} humanDecision
   */
  function resolveCallsWithHuman(match, humanSeat, humanDecision) {
    const decisions = buildAutoCallDecisions(match);
    if (humanDecision && humanDecision.action !== 'pass') {
      decisions[humanSeat] = humanDecision;
    }
    return resolveCalls(match, decisions);
  }

  /**
   * CPUの手番(ツモ〜打牌、または鳴き対応)を1ステップ進める。
   * 人間の手番、またはround_overの場合は何もしない。
   * @returns {boolean} 何か処理を進めたらtrue
   */
  function stepCpu(match) {
    const round = match.currentRound;
    if (!round || round.phase === 'round_over') return false;

    if (round.phase === 'awaiting_draw') {
      const { ryuukyoku } = drawTile(match);
      return true;
    }

    if (round.phase === 'awaiting_discard') {
      const seat = round.turnSeat;
      const p = player(match, seat);
      if (p.isHuman) return false;
      const strength = strengthFor(match, seat);

      const tsumoResult = canTsumoAgari(match, seat);
      if (tsumoResult) {
        endRoundWin(match, [seat], seat, p.drawnTile, false);
        return true;
      }

      const ankanOptions = Melds.getAnkanOptions((() => {
        const c = p.handCounts.slice();
        if (p.drawnTile !== null) c[p.drawnTile]++;
        return c;
      })());
      if (ankanOptions.length > 0 && !p.riichi && p.fuuro.length < 4) {
        declareAnkan(match, ankanOptions[0]);
        return true;
      }
      const kakanOptions = Melds.getKakanOptions(p.fuuro, (() => {
        const c = p.handCounts.slice();
        if (p.drawnTile !== null) c[p.drawnTile]++;
        return c;
      })());
      if (kakanOptions.length > 0) {
        const res = declareKakan(match, kakanOptions[0].tile);
        return true;
      }

      let isRiichiDeclare = false;
      if (canDeclareRiichi(match, seat) && CPU.decideRiichi(p, strength)) {
        isRiichiDeclare = true;
      }
      const tile = isRiichiDeclare
        ? p.drawnTile !== null
          ? (() => {
              const concealed = p.handCounts.slice();
              concealed[p.drawnTile]++;
              const analysis = Evaluator.analyzeHand(concealed, { lockedMelds: 0 });
              return analysis.recommended.tile;
            })()
          : p.drawnTile
        : CPU.decideDiscard(p, match, strength);
      discardTile(match, tile, isRiichiDeclare);
      return true;
    }

    if (round.phase === 'awaiting_calls') {
      const options = round.callOptions || {};
      const decisions = buildAutoCallDecisions(match);

      // 人間が呼ばれ得る場合は、人間の分だけ確定するまで待つ(UIから明示的にresolveCallsを呼ぶ)
      const humanSeat = match.players.find((p) => p.isHuman);
      if (humanSeat && options[humanSeat.seat] && !decisions[humanSeat.seat]) {
        return false;
      }

      resolveCalls(match, decisions);
      return true;
    }

    return false;
  }

  /**
   * 人間の入力が必要になるまで(またはround_overになるまで)CPUの手番を自動で進める。
   * @param {number} maxSteps 無限ループ防止用の上限
   */
  function advanceUntilHumanInput(match, maxSteps) {
    let steps = 0;
    const limit = maxSteps || 500;
    while (steps < limit) {
      const round = match.currentRound;
      if (!round || round.phase === 'round_over') return;

      if (round.phase === 'awaiting_discard' && player(match, round.turnSeat).isHuman) return;
      if (round.phase === 'awaiting_calls') {
        const humanSeat = match.players.find((p) => p.isHuman);
        if (humanSeat && round.callOptions && round.callOptions[humanSeat.seat]) return;
      }

      const progressed = stepCpu(match);
      if (!progressed) return;
      steps++;
    }
  }

  /**
   * 局を最後まで(人間不在の前提で)自動進行する。シミュレーションテスト用。
   */
  function simulateRoundToEnd(match, maxSteps) {
    let steps = 0;
    const limit = maxSteps || 1000;
    while (steps < limit) {
      const round = match.currentRound;
      if (!round || round.phase === 'round_over') return true;
      const progressed = stepCpu(match);
      if (!progressed) return false;
      steps++;
    }
    return false;
  }

  const Round = {
    drawTile,
    discardTile,
    computeCallOptions,
    computeWaitTiles,
    resolveCalls,
    resolveCallsWithHuman,
    declareAnkan,
    declareKakan,
    canTsumoAgari,
    canDeclareRiichi,
    endRoundWin,
    endRoundRyuukyoku,
    prepareNextRound,
    stepCpu,
    advanceUntilHumanInput,
    simulateRoundToEnd,
    buildCtx,
    doraSettingFor,
    seatAfter,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Round;
  } else {
    root.MJ = root.MJ || {};
    root.MJ.Round = Round;
  }
})(typeof window !== 'undefined' ? window : globalThis);
