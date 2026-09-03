/**
 * appgame.js
 * 「対局」タブの画面制御。CPU3人との対局(配牌〜ツモ〜打牌〜鳴き〜リーチ〜
 * ロン/ツモ〜点数計算〜次局〜半荘終了)を、round.js/cpu.jsを使って進行する。
 */
(function () {
  'use strict';

  const Tiles = window.MJ.Tiles;
  const GameState = window.MJ.GameState;
  const Round = window.MJ.Round;
  const Melds = window.MJ.Melds;
  const Evaluator = window.MJ.Evaluator;
  const HandInfo = window.MJ.HandInfo;
  const Scoring = window.MJ.Scoring;
  const Safety = window.MJ.Safety;
  const Coach = window.MJ.Coach;
  const Kifu = window.MJ.Kifu;
  const CPU = window.MJ.CPU;
  const UI = window.MJ.UI;

  const HUMAN_SEAT = 0;
  const RELATIVE_LABELS = ['自分', '下家', '対面', '上家'];

  const gameTab = {
    match: null,
    coachMode: 'full',
    selectedPosition: null,
    riichiArmed: false,
    kifu: null,
    kifuEventCursor: 0,
  };

  function windLabelFor(p) {
    return Tiles.HONOR_NAMES[p.seatWind - 27];
  }

  function roundWindTileOf(match) {
    return 27 + match.roundWindIndex;
  }

  // ==================================================
  // 開始・進行
  // ==================================================

  function handleStartGame() {
    const gameLength = document.getElementById('game-length-select').value;
    const cpuStrength = document.getElementById('game-cpu-strength-select').value;
    gameTab.coachMode = document.getElementById('game-coach-select').value;
    document.getElementById('game-coach-select-inline').value = gameTab.coachMode;

    gameTab.match = GameState.createMatch({
      rules: { gameLength, cpuStrength },
      humanSeat: HUMAN_SEAT,
      playerNames: ['あなた', 'CPU1', 'CPU2', 'CPU3'],
    });
    gameTab.match = GameState.startRound(gameTab.match);
    gameTab.kifu = Kifu.createKifu(gameTab.match);
    Kifu.recordRoundStart(gameTab.kifu, gameTab.match);
    gameTab.kifuEventCursor = 0;
    gameTab.selectedPosition = null;
    gameTab.riichiArmed = false;

    document.getElementById('game-setup').hidden = true;
    document.getElementById('game-table').hidden = false;
    document.getElementById('game-match-over-panel').hidden = true;

    advanceAndRender();
  }

  function advanceAndRender() {
    Round.advanceUntilHumanInput(gameTab.match, 1000);
    gameTab.kifuEventCursor = Kifu.appendEventsSince(gameTab.kifu, gameTab.match, gameTab.kifuEventCursor);
    renderGameTable();
  }

  function handleNextRound() {
    if (gameTab.match.isOver) return;
    gameTab.match = GameState.startRound(gameTab.match);
    Kifu.recordRoundStart(gameTab.kifu, gameTab.match);
    gameTab.kifuEventCursor = 0;
    gameTab.selectedPosition = null;
    gameTab.riichiArmed = false;
    advanceAndRender();
  }

  function handleSaveKifu() {
    const ok = Kifu.saveMatchKifu(gameTab.kifu);
    const btns = [document.getElementById('game-save-kifu-btn'), document.getElementById('game-save-kifu-final-btn')];
    btns.forEach((b) => {
      if (!b) return;
      b.textContent = ok ? '保存しました' : '保存に失敗しました';
      b.disabled = true;
      setTimeout(() => {
        b.textContent = '牌譜を保存する';
        b.disabled = false;
      }, 2000);
    });
  }

  function handleRestart() {
    document.getElementById('game-setup').hidden = false;
    document.getElementById('game-table').hidden = true;
    gameTab.match = null;
  }

  // ==================================================
  // 人間の操作
  // ==================================================

  function currentDisplayTiles() {
    const p = gameTab.match.players[HUMAN_SEAT];
    if (p.drawnTile === null) return p.handCounts.slice ? Tiles.toTileList(p.handCounts) : [];
    return Tiles.toTileList(p.handCounts).concat([p.drawnTile]).sort((a, b) => a - b);
  }

  function handleHandTileClick(tileValue, position) {
    const round = gameTab.match.currentRound;
    if (round.phase !== 'awaiting_discard' || round.turnSeat !== HUMAN_SEAT) return;
    gameTab.selectedPosition = gameTab.selectedPosition === position ? null : position;
    renderGameTable();
  }

  function handleDiscardClick() {
    if (gameTab.selectedPosition === null) return;
    const tiles = currentDisplayTiles();
    const tile = tiles[gameTab.selectedPosition];
    Round.discardTile(gameTab.match, tile, gameTab.riichiArmed);
    gameTab.riichiArmed = false;
    gameTab.selectedPosition = null;
    advanceAndRender();
  }

  function handleTsumoClick() {
    const p = gameTab.match.players[HUMAN_SEAT];
    Round.endRoundWin(gameTab.match, [HUMAN_SEAT], HUMAN_SEAT, p.drawnTile, false);
    gameTab.kifuEventCursor = Kifu.appendEventsSince(gameTab.kifu, gameTab.match, gameTab.kifuEventCursor);
    renderGameTable();
  }

  function handleRiichiToggle() {
    gameTab.riichiArmed = !gameTab.riichiArmed;
    renderGameTable();
  }

  function handleAnkanClick(tile) {
    Round.declareAnkan(gameTab.match, tile);
    advanceAndRender();
  }

  function handleKakanClick(tile) {
    Round.declareKakan(gameTab.match, tile);
    advanceAndRender();
  }

  function handleCallDecision(decision) {
    Round.resolveCallsWithHuman(gameTab.match, HUMAN_SEAT, decision);
    gameTab.selectedPosition = null;
    advanceAndRender();
  }

  // ==================================================
  // 描画
  // ==================================================

  function buildPlayersInfo() {
    const match = gameTab.match;
    const round = match.currentRound;
    return match.players.map((p, seat) => ({
      seat,
      name: p.name,
      relativeLabel: RELATIVE_LABELS[(seat - HUMAN_SEAT + 4) % 4],
      score: p.score,
      windLabel: windLabelFor(p),
      isDealer: p.isDealer,
      isSelf: seat === HUMAN_SEAT,
      isTurn: round && round.turnSeat === seat && round.phase !== 'round_over',
      riichi: p.riichi,
      fuuroCount: p.fuuro.length,
      discards: p.discards,
    }));
  }

  function renderGameTable() {
    const match = gameTab.match;
    const round = match.currentRound;

    document.getElementById('game-round-info').textContent =
      `${round.roundWindIndexAtStart === 0 ? '東' : '南'}${round.roundNumberAtStart}局 ${round.honbaAtStart}本場`;
    document.getElementById('game-wall-count').textContent = `残り山: ${round.wall.length}枚`;
    document.getElementById('game-kyotaku-info').textContent = `供託: ${match.kyotaku}本`;

    const playersInfo = buildPlayersInfo();
    UI.renderPlayerStatusGrid(document.getElementById('player-status-grid'), playersInfo);
    UI.renderDiscardsGrid(document.getElementById('discards-grid'), playersInfo);

    const p = match.players[HUMAN_SEAT];
    UI.renderFuuroRow(document.getElementById('game-self-fuuro'), p.fuuro);

    const handContainer = document.getElementById('game-hand');
    const tiles = currentDisplayTiles();
    const drawnPosition = p.drawnTile !== null ? tiles.lastIndexOf(p.drawnTile) : null;
    UI.renderHand(handContainer, tiles, {
      selectedPosition: gameTab.selectedPosition,
      drawnPosition,
      onTileClick: handleHandTileClick,
    });

    document.getElementById('game-self-title').textContent = p.riichi ? 'あなたの手牌(リーチ中)' : 'あなたの手牌';

    renderStatusLine();
    renderActionButtons();
    renderCallOptions();
    renderCoachPanel();
    renderResultPanels();
  }

  function renderStatusLine() {
    const match = gameTab.match;
    const round = match.currentRound;
    const el = document.getElementById('game-status-line');
    const furitenEl = document.getElementById('game-furiten-note');
    const p = match.players[HUMAN_SEAT];

    if (round.phase === 'round_over') {
      el.textContent = '';
      furitenEl.hidden = true;
      return;
    }
    if (round.turnSeat === HUMAN_SEAT && round.phase === 'awaiting_discard') {
      el.textContent = p.riichi ? 'リーチ中です。ツモった牌をそのまま切ります。' : '牌を選んで「この牌を切る」を押してください。';
    } else if (round.phase === 'awaiting_calls' && round.callOptions && round.callOptions[HUMAN_SEAT]) {
      el.textContent = 'ポン・チー・カン・ロンのいずれかを選べます。';
    } else {
      el.textContent = '他家の手番です...';
    }

    if (p.furitenTemporary || p.furitenRiichi) {
      const waitTiles = Round.computeWaitTiles(p);
      const msg = window.MJ.Furiten.explainFuriten(p, waitTiles);
      furitenEl.hidden = !msg;
      furitenEl.textContent = msg || '';
    } else {
      furitenEl.hidden = true;
    }
  }

  function renderActionButtons() {
    const container = document.getElementById('game-action-buttons');
    container.innerHTML = '';
    const match = gameTab.match;
    const round = match.currentRound;
    if (round.phase === 'round_over' || round.phase === 'awaiting_calls') return;
    if (round.turnSeat !== HUMAN_SEAT || round.phase !== 'awaiting_discard') return;

    const p = match.players[HUMAN_SEAT];

    const tsumoResult = Round.canTsumoAgari(match, HUMAN_SEAT);
    if (tsumoResult) {
      container.appendChild(makeButton('ツモ', handleTsumoClick, true));
    }

    if (!p.riichi) {
      const concealed = p.handCounts.slice();
      if (p.drawnTile !== null) concealed[p.drawnTile]++;
      const ankanList = p.fuuro.length < 4 ? Melds.getAnkanOptions(concealed) : [];
      ankanList.forEach((tile) => {
        container.appendChild(makeButton(`暗槓(${Tiles.shortLabel(tile)})`, () => handleAnkanClick(tile), false));
      });
      Melds.getKakanOptions(p.fuuro, concealed).forEach((opt) => {
        container.appendChild(makeButton(`加槓(${Tiles.shortLabel(opt.tile)})`, () => handleKakanClick(opt.tile), false));
      });

      if (Round.canDeclareRiichi(match, HUMAN_SEAT)) {
        const riichiBtn = makeButton(gameTab.riichiArmed ? 'リーチ取消' : 'リーチ', handleRiichiToggle, false);
        if (gameTab.riichiArmed) riichiBtn.classList.add('primary');
        container.appendChild(riichiBtn);
      }
    }

    if (!p.riichi) {
      const discardBtn = makeButton('この牌を切る', handleDiscardClick, true);
      discardBtn.disabled = gameTab.selectedPosition === null;
      container.appendChild(discardBtn);
    } else {
      // リーチ後はツモ切り固定
      const discardBtn = makeButton('ツモ切りする', () => {
        Round.discardTile(match, p.drawnTile, false);
        advanceAndRender();
      }, true);
      container.appendChild(discardBtn);
    }
  }

  function renderCallOptions() {
    const container = document.getElementById('game-call-options');
    const match = gameTab.match;
    const round = match.currentRound;
    if (round.phase !== 'awaiting_calls' || !round.callOptions || !round.callOptions[HUMAN_SEAT]) {
      container.hidden = true;
      container.innerHTML = '';
      return;
    }
    container.hidden = false;
    container.innerHTML = '';
    const opt = round.callOptions[HUMAN_SEAT];

    if (opt.canRon) container.appendChild(makeButton('ロン', () => handleCallDecision({ action: 'ron' }), true));
    if (opt.canKan) container.appendChild(makeButton('カン', () => handleCallDecision({ action: 'kan' }), false));
    if (opt.canPon) container.appendChild(makeButton('ポン', () => handleCallDecision({ action: 'pon' }), false));
    opt.chiOptions.forEach((chiTiles) => {
      const label = 'チー(' + chiTiles.map((t) => Tiles.shortLabel(t)).join('') + ')';
      container.appendChild(makeButton(label, () => handleCallDecision({ action: 'chi', chiTiles }), false));
    });
    container.appendChild(makeButton('スルー', () => handleCallDecision({ action: 'pass' }), false));
  }

  function makeButton(label, onClick, primary) {
    const btn = document.createElement('button');
    btn.textContent = label;
    if (primary) btn.className = 'primary';
    btn.addEventListener('click', onClick);
    return btn;
  }

  // ---- コーチ機能 ----

  function riichiOpponentsOf(match) {
    return match.players.filter((p) => p.seat !== HUMAN_SEAT && p.riichi);
  }

  function renderCoachPanel() {
    const panel = document.getElementById('game-coach-panel');
    const body = document.getElementById('game-coach-body');
    const match = gameTab.match;
    const round = match.currentRound;

    if (gameTab.coachMode === 'off' || round.phase === 'round_over') {
      panel.hidden = true;
      return;
    }
    if (round.turnSeat !== HUMAN_SEAT || round.phase !== 'awaiting_discard') {
      panel.hidden = true;
      return;
    }

    const p = match.players[HUMAN_SEAT];
    if (p.riichi) {
      panel.hidden = false;
      body.innerHTML = '';
      const div = document.createElement('div');
      div.className = 'hint-text';
      div.textContent = 'リーチ中はツモ切りのみです。';
      body.appendChild(div);
      return;
    }

    panel.hidden = false;
    body.innerHTML = '';

    const counts14 = p.handCounts.slice();
    if (p.drawnTile !== null) counts14[p.drawnTile]++;
    const analysis = Evaluator.analyzeHand(counts14, { lockedMelds: p.fuuro.length });

    const shantenLine = document.createElement('div');
    shantenLine.className = 'shanten-badge';
    shantenLine.style.display = 'inline-block';
    shantenLine.style.marginBottom = '8px';
    shantenLine.textContent = `シャンテン: ${analysis.currentShanten}`;
    body.appendChild(shantenLine);

    const riichiPlayers = riichiOpponentsOf(match);
    const visibleCounts = CPU.buildVisibleCounts(match);

    if (riichiPlayers.length > 0) {
      const safeTiles = [];
      for (let t = 0; t < Tiles.TILE_COUNT; t++) {
        if (counts14[t] <= 0) continue;
        let minRank = Infinity;
        const RANK = { genbutsu: 3, dead: 3, suji_nochance: 2, nochance: 2, suji: 1, onechance: 1, normal: 0 };
        riichiPlayers.forEach((rp) => {
          const s = Safety.evaluateTileSafety(t, rp, match.players, visibleCounts);
          minRank = Math.min(minRank, RANK[s.level] !== undefined ? RANK[s.level] : 0);
        });
        if (minRank >= 1) safeTiles.push(t);
      }
      const safeLine = document.createElement('div');
      safeLine.className = 'hint-text';
      safeLine.textContent =
        safeTiles.length > 0
          ? `比較的安全な牌: ${safeTiles.map((t) => Tiles.shortLabel(t)).join(' ')}`
          : '現時点で明確に安全と言える牌はありません。';
      body.appendChild(safeLine);
    }

    if (gameTab.coachMode === 'hint') return;

    // フルコーチ: 多面的評価テーブル + 押し引き + なぜ？
    const doraTiles = GameState.currentDoraIndicators(round).map((ind) => window.MJ.Dora.doraTileFromIndicator(ind));
    const windCtx = { seatWind: p.seatWind, roundWind: roundWindTileOf(match) };
    const evalRows = Coach.evaluateMultiAxis(analysis, counts14, riichiPlayers, match.players, visibleCounts, doraTiles, windCtx);

    const table = document.createElement('table');
    table.className = 'coach-eval-table';
    const thead = document.createElement('tr');
    thead.innerHTML = '<th>打牌</th><th>牌効率</th><th>打点</th><th>役</th><th>安全度</th>';
    table.appendChild(thead);
    evalRows
      .slice()
      .sort((a, b) => b.overallScore - a.overallScore)
      .slice(0, 5)
      .forEach((row) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${row.label}</td><td>${Coach.gradeSymbol(row.efficiency)}</td><td>${Coach.gradeSymbol(row.value)}</td><td>${Coach.gradeSymbol(row.yaku)}</td><td>${row.safety === 'NA' ? 'ー' : Coach.gradeSymbol(row.safety)}</td>`;
        table.appendChild(tr);
      });
    // スマホで横に溢れないようスクロール可能なラッパーに入れる
    const tableWrap = document.createElement('div');
    tableWrap.className = 'coach-eval-table-wrap';
    tableWrap.appendChild(table);
    body.appendChild(tableWrap);

    const best = evalRows.reduce((a, b) => (b.overallScore > a.overallScore ? b : a), evalRows[0]);
    const commentDiv = document.createElement('div');
    commentDiv.className = 'hint-text';
    commentDiv.style.marginTop = '8px';
    commentDiv.textContent = Coach.buildOverallComment(best, true);
    body.appendChild(commentDiv);

    const pf = Coach.evaluatePushFold({
      shanten: analysis.currentShanten,
      riichiCount: riichiPlayers.length,
      turnCount: round.turnCount,
      isDealer: p.isDealer,
      roughHanValue: doraTiles.reduce((s, t) => s + (counts14[t] || 0), 0),
      safeTileCount: evalRows.filter((r) => r.safety === 'S' || r.safety === 'A').length,
    });
    const pfBanner = document.createElement('div');
    pfBanner.className = 'pushfold-banner ' + pf.verdict;
    pfBanner.textContent = pf.comment;
    body.appendChild(pfBanner);

    const whyBtn = document.createElement('button');
    whyBtn.textContent = 'なぜ?(おすすめの理由を詳しく見る)';
    whyBtn.style.marginTop = '8px';
    whyBtn.addEventListener('click', () => renderWhyPanel(analysis, best));
    body.appendChild(whyBtn);
  }

  function renderWhyPanel(analysis, bestRow) {
    const panel = document.getElementById('game-why-panel');
    const body = document.getElementById('game-why-body');
    panel.hidden = false;
    body.innerHTML = '';
    const discard = analysis.discards.find((d) => d.tile === bestRow.tile);
    const p = document.createElement('p');
    p.textContent = discard ? discard.reason : '';
    body.appendChild(p);
    UI.renderBlockSummary(body, analysis);
  }

  // ---- 結果表示(和了・流局・半荘終了) ----

  function renderResultPanels() {
    const match = gameTab.match;
    const round = match.currentRound;
    const resultPanel = document.getElementById('game-result-panel');
    const matchOverPanel = document.getElementById('game-match-over-panel');

    if (round.phase !== 'round_over') {
      resultPanel.hidden = true;
      matchOverPanel.hidden = true;
      return;
    }

    resultPanel.hidden = false;
    const body = document.getElementById('game-result-body');
    body.innerHTML = '';

    if (round.result.type === 'win') {
      round.result.winners.forEach((w) => {
        const box = document.createElement('div');
        box.className = 'result-panel';
        const title = document.createElement('h3');
        const seatLabel = RELATIVE_LABELS[(w.seat - HUMAN_SEAT + 4) % 4];
        title.textContent = `${seatLabel}(${match.players[w.seat].name})の${w.isTsumo ? 'ツモ' : 'ロン'}`;
        box.appendChild(title);
        if (w.scoreResult.hasYaku) {
          UI.renderYakuList(box, w.scoreResult.best.yakuList);
          const scoreDiv = document.createElement('div');
          UI.renderScoreSummary(scoreDiv, w.scoreResult.best, {});
          box.appendChild(scoreDiv);
          if (!w.scoreResult.best.isYakuman) {
            const fuDiv = document.createElement('div');
            UI.renderFuBreakdown(fuDiv, w.scoreResult.best.fuBreakdown, w.scoreResult.best.fu);
            box.appendChild(fuDiv);
          }
        }
        body.appendChild(box);
      });
    } else {
      const box = document.createElement('div');
      box.className = 'result-panel';
      const title = document.createElement('h3');
      title.textContent = '流局';
      box.appendChild(title);
      const p = document.createElement('p');
      const tenpaiNames = round.result.tenpaiSeats.map((s) => RELATIVE_LABELS[(s - HUMAN_SEAT + 4) % 4]).join('、');
      p.textContent = round.result.tenpaiSeats.length > 0 ? `テンパイ: ${tenpaiNames}` : '全員ノーテンでした。';
      box.appendChild(p);
      body.appendChild(box);
    }

    document.getElementById('game-next-round-btn').hidden = match.isOver;

    if (match.isOver) {
      matchOverPanel.hidden = false;
      const rankingEl = document.getElementById('game-final-ranking');
      rankingEl.innerHTML = '';
      const list = document.createElement('ol');
      match.finalRanking.forEach((r) => {
        const li = document.createElement('li');
        const label = RELATIVE_LABELS[(r.seat - HUMAN_SEAT + 4) % 4];
        li.textContent = `${label}(${r.name}): ${r.score}点`;
        list.appendChild(li);
      });
      rankingEl.appendChild(list);
    } else {
      matchOverPanel.hidden = true;
    }
  }

  // ==================================================
  // 初期化
  // ==================================================

  function initGameTab() {
    document.getElementById('game-start-btn').addEventListener('click', handleStartGame);
    document.getElementById('game-next-round-btn').addEventListener('click', handleNextRound);
    document.getElementById('game-save-kifu-btn').addEventListener('click', handleSaveKifu);
    document.getElementById('game-save-kifu-final-btn').addEventListener('click', handleSaveKifu);
    document.getElementById('game-restart-btn').addEventListener('click', handleRestart);

    const coachSelect = document.getElementById('game-coach-select');
    const coachSelectInline = document.getElementById('game-coach-select-inline');
    coachSelect.addEventListener('change', () => {
      gameTab.coachMode = coachSelect.value;
      coachSelectInline.value = coachSelect.value;
      if (gameTab.match) renderGameTable();
    });
    coachSelectInline.addEventListener('change', () => {
      gameTab.coachMode = coachSelectInline.value;
      coachSelect.value = coachSelectInline.value;
      renderGameTable();
    });
  }

  window.MJ = window.MJ || {};
  window.MJ.AppGame = { initGameTab };

  document.addEventListener('DOMContentLoaded', () => {
    initGameTab();
  });
})();
