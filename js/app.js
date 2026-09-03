/**
 * app.js
 * 画面全体の制御(タブ切り替え・トレーニング進行・何切る問題・手牌分析・辞典・成績)。
 */
(function () {
  'use strict';

  /** 局面情報が無いモード用: 自分の手牌だけを考慮した理論値でunseenTotalを求める */
  function unseenTotalFor(counts14) {
    if (!counts14 || !window.MJ || !window.MJ.Probability) return null;
    return window.MJ.Probability.unseenTotalFromHandOnly(counts14);
  }

  const Tiles = window.MJ.Tiles;
  const Game = window.MJ.Game;
  const Evaluator = window.MJ.Evaluator;
  const Problems = window.MJ.Problems;
  const Stats = window.MJ.Stats;
  const Dictionary = window.MJ.Dictionary;
  const HandInfo = window.MJ.HandInfo;
  const HandBuilder = window.MJ.HandBuilder;
  const Shanten = window.MJ.Shanten;
  const Scoring = window.MJ.Scoring;
  const Dora = window.MJ.Dora;
  const YakuCandidates = window.MJ.YakuCandidates;
  const UI = window.MJ.UI;

  // ---- グローバル設定 ----
  let difficulty = 'standard'; // 'beginner' | 'standard' | 'practice'
  let thinkMode = false; // 自分で考えるモード(打牌前は情報を隠す)

  // ---- トレーニングタブの状態 ----
  const training = {
    gameState: null,
    tiles14: [],
    selectedPosition: null,
    analysis: null,
    revealLevel: 'none', // 'none' | 'hint' | 'full'
    committedResult: null, // 打牌確定後の評価結果
  };

  // ---- 何切る問題タブの状態 ----
  const mondai = {
    levelId: 'random',
    savedToReview: false,
    autoSaved: false,
    problem: null,
    selectedPosition: null,
    answered: false,
    gradeResult: null,
  };

  // ---- 手牌分析タブの状態 ----
  const analysisTab = {
    counts: HandBuilder.createEmptyCounts(),
    mode: 'editing', // 'editing' | 'analyzed'
    tiles: [], // 分析確定時点の手牌(牌インデックス配列、昇順)
    overall: null, // Shanten.calcShanten の結果(13枚時)
    analysis: null, // Evaluator.analyzeHand の結果(14枚時のみ)
    selectedPosition: null, // 自分の選択と比較する際に選んだ位置(14枚時のみ)
    // V1.2: 役・符・点数の判定に使うアガリ条件
    agari: {
      winningTile: null,
      conditions: {
        isTsumo: false,
        isDealer: false,
        seatWind: 28, // 南(子のデフォルト)
        roundWind: 27, // 東
        isRiichi: false,
        isDoubleRiichi: false,
        isIppatsu: false,
        isLastTile: false,
        isRinshan: false,
        isChankan: false,
        doraIndicator: null,
        aka: { m: 0, p: 0, s: 0 },
      },
      rules: Scoring.defaultRules(),
    },
  };

  function computeTiles14(gameState) {
    if (gameState.drawn === null) return gameState.hand.slice();
    return gameState.hand.concat([gameState.drawn]).sort((a, b) => a - b);
  }

  function findDrawnPosition(tiles14, gameState) {
    if (gameState.drawn === null) return null;
    // 同種牌が複数あっても、末尾側の1枚を「今引いた牌」として表示する
    for (let i = tiles14.length - 1; i >= 0; i--) {
      if (tiles14[i] === gameState.drawn) return i;
    }
    return null;
  }

  function autoRevealLevel() {
    if (thinkMode) return 'none';
    if (difficulty === 'beginner') return 'full';
    return 'none';
  }

  // ==================================================
  // タブ切り替え
  // ==================================================
  function initTabs() {
    const buttons = document.querySelectorAll('.tab-btn');
    buttons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        buttons.forEach((b) => b.classList.toggle('active', b === btn));
        document.querySelectorAll('.tab-panel').forEach((p) => {
          p.classList.toggle('active', p.id === 'tab-' + tab);
        });
        document.getElementById('training-only-toolbar').style.display = tab === 'training' ? 'inline-flex' : 'none';

        if (tab === 'stats') renderStatsTab();
        if (tab === 'mondai' && !mondai.problem) startNewMondai();
        if (tab === 'kifu' && window.MJ.AppKifu) window.MJ.AppKifu.refreshList();
        if (tab === 'review' && window.MJ.AppReview) window.MJ.AppReview.render();
        if (tab === 'tutorial' && window.MJ.AppLesson) window.MJ.AppLesson.render();
      });
    });
  }

  function initDifficultyControl() {
    const select = document.getElementById('difficulty-select');
    select.addEventListener('change', () => {
      difficulty = select.value;
      training.revealLevel = autoRevealLevel();
      renderTraining();
    });

    const thinkCheckbox = document.getElementById('think-mode-checkbox');
    thinkCheckbox.addEventListener('change', () => {
      thinkMode = thinkCheckbox.checked;
      training.revealLevel = autoRevealLevel();
      renderTraining();
    });
  }

  // ==================================================
  // トレーニングタブ
  // ==================================================
  function startNewTrainingHand() {
    training.gameState = Game.newGame();
    training.selectedPosition = null;
    training.committedResult = null;
    training.revealLevel = autoRevealLevel();
    refreshTrainingAnalysis();
    renderTraining();
  }

  function refreshTrainingAnalysis() {
    training.tiles14 = computeTiles14(training.gameState);
    training.counts14 = Tiles.toCounts(training.tiles14);
    training.analysis = Evaluator.analyzeHand(training.counts14);
  }

  function handleTrainingTileClick(tileValue, position) {
    if (training.gameState.isAgari || training.gameState.drawn === null) return;
    training.selectedPosition = training.selectedPosition === position ? null : position;
    renderTraining();
  }

  function handleHintClick() {
    training.revealLevel = 'hint';
    renderTraining();
  }

  function handleAnswerClick() {
    training.revealLevel = 'full';
    renderTraining();
  }

  function handleDiscardClick() {
    if (training.selectedPosition === null) return;
    const tileValue = training.tiles14[training.selectedPosition];
    const grade = Evaluator.gradeUserChoice(training.analysis, tileValue);

    training.committedResult = {
      chosenTile: tileValue,
      chosenLabel: Tiles.shortLabel(tileValue),
      bestLabel: training.analysis.recommended.label,
      grade: grade.grade,
      gradeLabel: grade.gradeLabel,
      comment: grade.comment,
    };
    training.revealLevel = 'full';

    Stats.record({
      grade: grade.grade,
      chosenLabel: Tiles.shortLabel(tileValue),
      bestLabel: training.analysis.recommended.label,
    });

    renderTraining();
  }

  function handleNextTsumo() {
    const tileValue = training.committedResult.chosenTile;
    training.gameState = Game.discardAndDraw(training.gameState, tileValue);
    training.selectedPosition = null;
    training.committedResult = null;
    training.revealLevel = autoRevealLevel();
    refreshTrainingAnalysis();
    renderTraining();
  }

  function handleAgariNext() {
    startNewTrainingHand();
  }

  function renderTraining() {
    const gs = training.gameState;
    const shantenBadge = document.getElementById('training-shanten');
    const turnInfo = document.getElementById('training-turn');
    const handContainer = document.getElementById('training-hand');
    const resultPanel = document.getElementById('training-result');
    const waitPanel = document.getElementById('training-wait');
    const analysisPanel = document.getElementById('training-analysis');
    const explainPanel = document.getElementById('training-explain');
    const agariBanner = document.getElementById('training-agari');
    const hintBtn = document.getElementById('training-hint-btn');
    const answerBtn = document.getElementById('training-answer-btn');
    const discardBtn = document.getElementById('training-discard-btn');
    const wallEmptyMsg = document.getElementById('training-wall-empty');

    turnInfo.textContent = `ツモ回数: ${gs.turn}`;

    if (gs.isWallEmpty && gs.drawn === null) {
      handContainer.innerHTML = '';
      UI.renderHand(handContainer, training.tiles14, {});
      wallEmptyMsg.hidden = false;
      shantenBadge.textContent = 'シャンテン: -';
      resultPanel.hidden = true;
      waitPanel.hidden = true;
      analysisPanel.hidden = true;
      explainPanel.hidden = true;
      agariBanner.hidden = true;
      hintBtn.disabled = true;
      answerBtn.disabled = true;
      discardBtn.disabled = true;
      return;
    }
    wallEmptyMsg.hidden = true;

    if (gs.isAgari) {
      agariBanner.hidden = false;
      const agariInfo = HandInfo.describeAgariHand(Tiles.toCounts(training.tiles14));
      UI.renderAgariBreakdown(document.getElementById('training-agari-breakdown'), agariInfo);
      hintBtn.disabled = true;
      answerBtn.disabled = true;
      discardBtn.disabled = true;
    } else {
      agariBanner.hidden = true;
      hintBtn.disabled = training.revealLevel !== 'none';
      answerBtn.disabled = training.revealLevel === 'full';
      discardBtn.disabled = training.selectedPosition === null || training.committedResult !== null;
    }

    const drawnPosition = findDrawnPosition(training.tiles14, gs);
    UI.renderHand(handContainer, training.tiles14, {
      selectedPosition: training.selectedPosition,
      drawnPosition,
      onTileClick: handleTrainingTileClick,
    });

    const shownShanten = training.revealLevel === 'none' && !gs.isAgari ? '?' : training.analysis.currentShanten;
    shantenBadge.textContent = `シャンテン: ${shownShanten}`;

    // 打牌確定後の結果表示
    if (training.committedResult) {
      resultPanel.hidden = false;
      const r = training.committedResult;
      resultPanel.innerHTML = '';
      const gradeLine = document.createElement('div');
      gradeLine.className = 'grade-line grade-' + r.grade;
      gradeLine.textContent = r.gradeLabel;
      const comment = document.createElement('div');
      comment.textContent = r.comment;
      const nextBtn = document.createElement('button');
      nextBtn.className = 'primary';
      nextBtn.textContent = '次のツモへ';
      nextBtn.style.marginTop = '10px';
      nextBtn.addEventListener('click', handleNextTsumo);
      resultPanel.appendChild(gradeLine);
      resultPanel.appendChild(comment);
      resultPanel.appendChild(nextBtn);

      const counts13 = Tiles.toCounts(training.tiles14);
      counts13[r.chosenTile]--;
      const waitInfo = HandInfo.classifyWait(counts13);
      if (waitInfo) {
        waitPanel.hidden = false;
        UI.renderWaitPanel(waitPanel, waitInfo);
      } else {
        waitPanel.hidden = true;
      }
    } else {
      resultPanel.hidden = true;
      waitPanel.hidden = true;
    }

    // ヒント/答え/難易度に応じた解析パネルの表示
    const showAnalysis = training.revealLevel === 'full' || (training.revealLevel === 'hint' && difficulty !== 'practice');
    if (showAnalysis && !gs.isAgari) {
      analysisPanel.hidden = false;
      const limit = training.revealLevel === 'full' ? 3 : 1;
      UI.renderRanking(document.getElementById('training-ranking'), training.analysis.discards, { limit, unseenTotal: unseenTotalFor(training.counts14) });
      UI.renderComparisonTable(document.getElementById('training-compare-table'), training.analysis.discards, { topLimit: 3, unseenTotal: unseenTotalFor(training.counts14) });
    } else {
      analysisPanel.hidden = true;
    }

    const showExplain = training.revealLevel === 'full';
    if (showExplain && !gs.isAgari) {
      explainPanel.hidden = false;
      UI.renderBlockSummary(document.getElementById('training-explain-body'), training.analysis);
      UI.renderHighlightLegend(document.getElementById('training-highlight-legend'));
      const categories = HandInfo.assignHighlights(training.tiles14);
      UI.applyShapeHighlights(handContainer, categories);

      const bestTile = training.analysis.recommended.tile;
      const countsAfterBest = Tiles.toCounts(training.tiles14);
      countsAfterBest[bestTile]--;
      const growth = HandInfo.describeShapeGrowth(countsAfterBest);
      UI.renderShapeGrowth(document.getElementById('training-shape-growth'), growth);
    } else {
      explainPanel.hidden = true;
    }
  }

  function initTrainingTab() {
    document.getElementById('training-hint-btn').addEventListener('click', handleHintClick);
    document.getElementById('training-answer-btn').addEventListener('click', handleAnswerClick);
    document.getElementById('training-discard-btn').addEventListener('click', handleDiscardClick);
    document.getElementById('training-new-btn').addEventListener('click', startNewTrainingHand);
    document.getElementById('training-agari-next').addEventListener('click', handleAgariNext);
    document.getElementById('training-sort-btn').addEventListener('click', () => {
      training.tiles14 = training.tiles14.slice().sort((a, b) => a - b);
      renderTraining();
    });
    startNewTrainingHand();
  }

  // ==================================================
  // 何切る問題タブ
  // ==================================================
  function startNewMondai() {
    mondai.problem = Problems.nextProblem(mondai.levelId);
    mondai.selectedPosition = null;
    mondai.answered = false;
    mondai.gradeResult = null;
    mondai.savedToReview = false;
    mondai.autoSaved = false;
    renderMondai();
  }

  function handleMondaiTileClick(tileValue, position) {
    if (mondai.answered) return;
    mondai.selectedPosition = mondai.selectedPosition === position ? null : position;
    renderMondai();
  }

  function handleMondaiAnswer() {
    if (mondai.selectedPosition === null) return;
    const tileValue = mondai.problem.tiles14[mondai.selectedPosition];
    const grade = Evaluator.gradeUserChoice(mondai.problem.analysis, tileValue);
    mondai.answered = true;
    mondai.gradeResult = {
      chosenTile: tileValue,
      chosenLabel: Tiles.shortLabel(tileValue),
      bestLabel: mondai.problem.analysis.recommended.label,
      grade: grade.grade,
      gradeLabel: grade.gradeLabel,
      comment: grade.comment,
    };

    Stats.record({
      grade: grade.grade,
      chosenLabel: Tiles.shortLabel(tileValue),
      bestLabel: mondai.problem.analysis.recommended.label,
    });

    // 学習価値の高い打牌(×/△・1位と違う・シャンテン戻し・受け入れ大幅減)は自動で復習帳へ
    const Review = window.MJ.Review;
    const auto = Review.shouldAutoSave(mondai.problem.analysis, tileValue, grade.grade);
    if (auto.should) {
      Review.recordAndSave({
        tiles14: mondai.problem.tiles14,
        counts14: mondai.problem.counts14,
        analysis: mondai.problem.analysis,
        chosenTile: tileValue,
        grade: grade.grade,
        gradeLabel: grade.gradeLabel,
        comment: grade.comment,
        source: 'mondai',
        autoSaved: true,
        autoReasons: auto.reasons,
      });
      mondai.savedToReview = true;
      mondai.autoSaved = true;
      mondai.autoReasons = auto.reasons;
    }

    renderMondai();
  }

  /** 「復習に保存」ボタン(自動保存されなかった問題を自分で保存する) */
  function handleMondaiSaveReview() {
    if (!mondai.answered || mondai.savedToReview) return;
    const Review = window.MJ.Review;
    const r = mondai.gradeResult;
    Review.recordAndSave({
      tiles14: mondai.problem.tiles14,
      counts14: mondai.problem.counts14,
      analysis: mondai.problem.analysis,
      chosenTile: r.chosenTile,
      grade: r.grade,
      gradeLabel: r.gradeLabel,
      comment: r.comment,
      source: 'mondai',
      autoSaved: false,
    });
    mondai.savedToReview = true;
    renderMondai();
  }

  function renderMondai() {
    const shantenBadge = document.getElementById('mondai-shanten');
    const handContainer = document.getElementById('mondai-hand');
    const resultPanel = document.getElementById('mondai-result');
    const waitPanel = document.getElementById('mondai-wait');
    const analysisPanel = document.getElementById('mondai-analysis');
    const answerBtn = document.getElementById('mondai-answer-btn');

    const tiles14 = mondai.problem.tiles14;
    UI.renderHand(handContainer, tiles14, {
      selectedPosition: mondai.selectedPosition,
      onTileClick: handleMondaiTileClick,
    });

    shantenBadge.textContent = mondai.answered ? `シャンテン: ${mondai.problem.analysis.currentShanten}` : 'シャンテン: ?';
    answerBtn.disabled = mondai.selectedPosition === null || mondai.answered;

    if (mondai.answered) {
      resultPanel.hidden = false;
      const r = mondai.gradeResult;
      resultPanel.innerHTML = '';
      const gradeLine = document.createElement('div');
      gradeLine.className = 'grade-line grade-' + r.grade;
      gradeLine.textContent = r.gradeLabel;
      const comment = document.createElement('div');
      comment.textContent = r.comment;
      resultPanel.appendChild(gradeLine);
      resultPanel.appendChild(comment);

      const counts13 = Tiles.toCounts(tiles14);
      counts13[r.chosenTile]--;
      const waitInfo = HandInfo.classifyWait(counts13);
      if (waitInfo) {
        waitPanel.hidden = false;
        UI.renderWaitPanel(waitPanel, waitInfo);
      } else {
        waitPanel.hidden = true;
      }

      analysisPanel.hidden = false;
      UI.renderRanking(document.getElementById('mondai-ranking'), mondai.problem.analysis.discards, { limit: 3, unseenTotal: unseenTotalFor(mondai.problem.counts14) });
      UI.renderComparisonTable(document.getElementById('mondai-compare-table'), mondai.problem.analysis.discards, { topLimit: 3, unseenTotal: unseenTotalFor(mondai.problem.counts14) });
    } else {
      resultPanel.hidden = true;
      waitPanel.hidden = true;
      analysisPanel.hidden = true;
    }

    renderMondaiReviewControls();
  }

  /** 復習帳への保存ボタンと、自動保存されたことのお知らせを描画する */
  function renderMondaiReviewControls() {
    const saveBtn = document.getElementById('mondai-save-review-btn');
    const note = document.getElementById('mondai-review-note');

    if (!mondai.answered) {
      saveBtn.hidden = true;
      note.hidden = true;
      return;
    }

    saveBtn.hidden = mondai.savedToReview;
    saveBtn.disabled = mondai.savedToReview;

    if (mondai.savedToReview) {
      note.hidden = false;
      note.textContent = mondai.autoSaved
        ? '復習帳に自動で追加しました(' + (mondai.autoReasons || []).join('、') + ')。「復習帳」タブでもう一度解けます。'
        : '復習帳に保存しました。「復習帳」タブでもう一度解けます。';
    } else {
      note.hidden = true;
    }
  }

  /** 学習レベルの選択欄を用意する */
  function initMondaiLevelSelect() {
    const select = document.getElementById('mondai-level-select');
    Problems.LEVELS.forEach((lv) => {
      const opt = document.createElement('option');
      opt.value = lv.id;
      opt.textContent = lv.name;
      select.appendChild(opt);
    });
    select.value = mondai.levelId;
    select.addEventListener('change', () => {
      mondai.levelId = select.value;
      startNewMondai();
      renderMondaiLevelHint();
    });
    renderMondaiLevelHint();
  }

  function renderMondaiLevelHint() {
    const hint = document.getElementById('mondai-level-hint');
    const lv = Problems.levelById(mondai.levelId);
    if (lv.id === 'random') {
      hint.hidden = true;
      return;
    }
    hint.hidden = false;
    hint.innerHTML = '';
    const theme = document.createElement('strong');
    theme.textContent = lv.theme;
    hint.appendChild(theme);
    const body = document.createElement('div');
    body.textContent = lv.hint;
    hint.appendChild(body);
  }

  function initMondaiTab() {
    document.getElementById('mondai-answer-btn').addEventListener('click', handleMondaiAnswer);
    document.getElementById('mondai-next-btn').addEventListener('click', startNewMondai);
    document.getElementById('mondai-save-review-btn').addEventListener('click', handleMondaiSaveReview);
    initMondaiLevelSelect();
  }

  // ==================================================
  // 手牌分析タブ
  // ==================================================
  function renderAnalysisPalette() {
    UI.renderPalette(document.getElementById('analysis-palette'), analysisTab.counts, handlePaletteClick);
  }

  function handlePaletteClick(tileIdx) {
    if (analysisTab.mode !== 'editing') return;
    analysisTab.counts = HandBuilder.addTile(analysisTab.counts, tileIdx);
    renderAnalysisEditing();
  }

  function handleAnalysisHandClick(tileValue, position) {
    if (analysisTab.mode === 'editing') {
      analysisTab.counts = HandBuilder.removeTile(analysisTab.counts, tileValue);
      renderAnalysisEditing();
    } else if (analysisTab.mode === 'analyzed' && analysisTab.overall.shanten === -1) {
      // アガリ形: どの牌を和了牌として扱うかを選ぶ
      analysisTab.selectedPosition = position;
      analysisTab.agari.winningTile = tileValue;
      renderAnalysisResults();
    } else if (analysisTab.mode === 'analyzed' && analysisTab.analysis) {
      analysisTab.selectedPosition = analysisTab.selectedPosition === position ? null : position;
      renderAnalysisCompareSelf();
    }
  }

  function handleAnalysisClear() {
    analysisTab.counts = HandBuilder.reset();
    analysisTab.mode = 'editing';
    analysisTab.selectedPosition = null;
    analysisTab.agari.winningTile = null;
    renderAnalysisEditing();
    document.getElementById('analysis-results').hidden = true;
    document.getElementById('analysis-palette-area').hidden = false;
    document.getElementById('analysis-edit-btn').hidden = true;
  }

  function handleAnalysisEditAgain() {
    analysisTab.mode = 'editing';
    analysisTab.selectedPosition = null;
    document.getElementById('analysis-palette-area').hidden = false;
    document.getElementById('analysis-edit-btn').hidden = true;
    document.getElementById('analysis-results').hidden = true;
    renderAnalysisEditing();
  }

  function handleAnalysisRun() {
    if (!HandBuilder.isAnalyzable(analysisTab.counts)) return;
    analysisTab.mode = 'analyzed';
    analysisTab.tiles = Tiles.toTileList(analysisTab.counts);
    analysisTab.selectedPosition = null;
    analysisTab.agari.winningTile = null;

    const total = Tiles.totalCount(analysisTab.counts);
    if (total === 14) {
      analysisTab.analysis = Evaluator.analyzeHand(analysisTab.counts);
      analysisTab.overall = { shanten: analysisTab.analysis.currentShanten, type: analysisTab.analysis.currentType };
    } else {
      analysisTab.analysis = null;
      analysisTab.overall = Shanten.calcShanten(analysisTab.counts);
    }

    document.getElementById('analysis-palette-area').hidden = true;
    document.getElementById('analysis-edit-btn').hidden = false;
    document.getElementById('analysis-results').hidden = false;
    renderAnalysisResults();
  }

  function renderAnalysisEditing() {
    const handContainer = document.getElementById('analysis-hand');
    UI.renderHand(handContainer, Tiles.toTileList(analysisTab.counts), {
      onTileClick: handleAnalysisHandClick,
    });
    document.getElementById('analysis-status').textContent = HandBuilder.statusText(analysisTab.counts);
    document.getElementById('analysis-run-btn').disabled = !HandBuilder.isAnalyzable(analysisTab.counts);
    renderAnalysisPalette();
  }

  function renderAnalysisResults() {
    const handContainer = document.getElementById('analysis-hand');
    UI.renderHand(handContainer, analysisTab.tiles, {
      selectedPosition: analysisTab.selectedPosition,
      onTileClick: handleAnalysisHandClick,
    });
    const isAgariForTitle = analysisTab.overall.shanten === -1;
    document.getElementById('analysis-hand-title').textContent = isAgariForTitle
      ? '現在の手牌(クリックして和了牌を選んでください)'
      : analysisTab.analysis
      ? '現在の手牌(クリックして自分の選択を比較できます)'
      : '現在の手牌';
    document.getElementById('analysis-status').textContent = `${analysisTab.tiles.length}枚を分析中`;

    const shantenBadge = document.getElementById('analysis-shanten');
    shantenBadge.textContent = `シャンテン: ${analysisTab.overall.shanten}`;

    const categories = HandInfo.assignHighlights(analysisTab.tiles);
    UI.applyShapeHighlights(handContainer, categories);
    UI.renderHighlightLegend(document.getElementById('analysis-highlight-legend'));

    const agariBanner = document.getElementById('analysis-agari');
    const isAgari = analysisTab.overall.shanten === -1;
    agariBanner.hidden = !isAgari;
    if (isAgari) {
      const agariInfo = HandInfo.describeAgariHand(analysisTab.counts);
      UI.renderAgariBreakdown(document.getElementById('analysis-agari-breakdown'), agariInfo);
    }

    const waitPanel = document.getElementById('analysis-wait');
    const analysisPanel = document.getElementById('analysis-analysis');
    const compareSelfSection = document.getElementById('analysis-compare-self');

    if (analysisTab.analysis) {
      // 14枚: 打牌ランキング + 比較表 + 自分の選択との比較
      waitPanel.hidden = true;
      if (!isAgari) {
        analysisPanel.hidden = false;
        UI.renderRanking(document.getElementById('analysis-ranking'), analysisTab.analysis.discards, { limit: 3, unseenTotal: unseenTotalFor(analysisTab.counts) });
        UI.renderComparisonTable(document.getElementById('analysis-compare-table'), analysisTab.analysis.discards, { topLimit: 3, unseenTotal: unseenTotalFor(analysisTab.counts) });
        compareSelfSection.hidden = false;
        renderAnalysisCompareSelf();
      } else {
        analysisPanel.hidden = true;
        compareSelfSection.hidden = true;
      }
    } else {
      // 13枚: 現在の受けのみ(待ち牌があれば表示)、打牌ランキングは無し
      analysisPanel.hidden = true;
      compareSelfSection.hidden = true;
      const waitInfo = HandInfo.classifyWait(analysisTab.counts);
      if (waitInfo) {
        waitPanel.hidden = false;
        UI.renderWaitPanel(waitPanel, waitInfo);
      } else {
        waitPanel.hidden = true;
      }
    }

    // 初心者向け解説 + 形の発展(常に表示。14枚の場合はおすすめ打牌後に残る形を基準にする)
    const explainPanel = document.getElementById('analysis-explain');
    if (!isAgari) {
      explainPanel.hidden = false;
      const blockSource = analysisTab.analysis || {
        currentType: analysisTab.overall.type,
        baseBlocks: Shanten.standardShanten(analysisTab.counts).blocks,
      };
      UI.renderBlockSummary(document.getElementById('analysis-explain-body'), blockSource);

      let growthBase = analysisTab.counts;
      if (analysisTab.analysis) {
        growthBase = analysisTab.counts.slice();
        growthBase[analysisTab.analysis.recommended.tile]--;
      }
      const growth = HandInfo.describeShapeGrowth(growthBase);
      UI.renderShapeGrowth(document.getElementById('analysis-shape-growth'), growth);
    } else {
      explainPanel.hidden = true;
    }

    // ---- V1.2: 役・符・点数 ----
    const conditionsPanel = document.getElementById('analysis-conditions');
    const showConditions = analysisTab.overall.shanten === 0 || isAgari;
    conditionsPanel.hidden = !showConditions;
    if (showConditions) {
      renderDoraIndicatorPicker();
      renderAkaDoraInputs();
    }

    document.getElementById('analysis-yaku-candidates').hidden = isAgari;
    if (!isAgari) {
      const candidates = YakuCandidates.detectYakuCandidates(analysisTab.counts, {
        seatWind: analysisTab.agari.conditions.seatWind,
        roundWind: analysisTab.agari.conditions.roundWind,
      });
      UI.renderYakuCandidates(document.getElementById('analysis-yaku-candidates-body'), candidates);
    }

    if (isAgari) {
      renderAgariScoring();
      document.getElementById('analysis-wait-yaku-preview').hidden = true;
    } else {
      document.getElementById('analysis-yaku-result').hidden = true;
      document.getElementById('analysis-winning-tile-hint').hidden = true;
      renderTenpaiYakuPreview();
    }
  }

  // ---- V1.2: 役・符・点数 ----

  function buildScoringContext() {
    const c = analysisTab.agari.conditions;
    return {
      winningTile: analysisTab.agari.winningTile,
      isTsumo: c.isTsumo,
      isRiichi: c.isRiichi,
      isDoubleRiichi: c.isDoubleRiichi,
      isIppatsu: c.isIppatsu,
      isHaitei: c.isLastTile && c.isTsumo,
      isHoutei: c.isLastTile && !c.isTsumo,
      isRinshan: c.isRinshan,
      isChankan: c.isChankan,
      isDealer: c.isDealer,
      seatWind: c.isDealer ? 27 : c.seatWind,
      roundWind: c.roundWind,
    };
  }

  function buildDoraSetting() {
    const c = analysisTab.agari.conditions;
    return {
      indicatorTiles: c.doraIndicator !== null ? [c.doraIndicator] : [],
      aka: analysisTab.agari.rules.akaDora ? c.aka : { m: 0, p: 0, s: 0 },
    };
  }

  function renderDoraIndicatorPicker() {
    const container = document.getElementById('cond-dora-indicator');
    UI.renderSingleTilePicker(container, analysisTab.agari.conditions.doraIndicator, (tile) => {
      analysisTab.agari.conditions.doraIndicator = tile;
      renderDoraIndicatorPicker();
      onConditionsChanged();
    });
    const resultEl = document.getElementById('cond-dora-result');
    if (analysisTab.agari.conditions.doraIndicator !== null) {
      const doraTile = Dora.doraTileFromIndicator(analysisTab.agari.conditions.doraIndicator);
      resultEl.textContent = `ドラ表示牌: ${Tiles.shortLabel(analysisTab.agari.conditions.doraIndicator)} → ドラ: ${Tiles.shortLabel(doraTile)}`;
    } else {
      resultEl.textContent = 'ドラ表示牌が選択されていません(ドラ0枚として計算します)。';
    }
  }

  function renderAkaDoraInputs() {
    const container = document.getElementById('cond-aka-dora');
    container.innerHTML = '';
    const fiveTiles = [
      { key: 'm', idx: 4, label: '5萬' },
      { key: 'p', idx: 13, label: '5筒' },
      { key: 's', idx: 22, label: '5索' },
    ];
    fiveTiles.forEach(({ key, idx, label }) => {
      const max = analysisTab.counts[idx] || 0;
      if (analysisTab.agari.conditions.aka[key] > max) analysisTab.agari.conditions.aka[key] = max;

      const wrap = document.createElement('label');
      wrap.className = 'aka-dora-item';
      const span = document.createElement('span');
      span.textContent = `${label}のうち赤ドラ:`;
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.max = String(max);
      input.value = String(analysisTab.agari.conditions.aka[key]);
      input.disabled = max === 0;
      input.addEventListener('change', () => {
        let v = parseInt(input.value, 10);
        if (Number.isNaN(v)) v = 0;
        v = Math.max(0, Math.min(max, v));
        input.value = String(v);
        analysisTab.agari.conditions.aka[key] = v;
        onConditionsChanged();
      });
      wrap.appendChild(span);
      wrap.appendChild(input);
      container.appendChild(wrap);
    });
  }

  function buildNoYakuMessage() {
    const ctx = buildScoringContext();
    let msg = '4面子1雀頭(または七対子・国士無双)の形は完成していますが、現在の条件では成立している役がありません。';
    if (!ctx.isRiichi && !ctx.isDoubleRiichi && !ctx.isTsumo) {
      msg += ' リーチを宣言していれば1翻となりアガれます(「アガリ条件を設定」でリーチにチェックを入れて確認できます)。';
    }
    return msg;
  }

  function renderAgariScoring() {
    const resultPanel = document.getElementById('analysis-yaku-result');
    const resultBody = document.getElementById('analysis-yaku-result-body');
    const hintEl = document.getElementById('analysis-winning-tile-hint');

    if (analysisTab.agari.winningTile === null) {
      resultPanel.hidden = true;
      hintEl.hidden = false;
      return;
    }
    hintEl.hidden = true;
    resultPanel.hidden = false;
    resultBody.innerHTML = '';

    const ctx = buildScoringContext();
    const doraSetting = buildDoraSetting();
    const result = Scoring.scoreHand(analysisTab.counts, ctx, analysisTab.agari.rules, doraSetting);

    if (!result.hasYaku) {
      UI.renderNoYaku(resultBody, buildNoYakuMessage());
      return;
    }

    const best = result.best;
    UI.renderYakuList(resultBody, best.yakuList);
    const scoreDiv = document.createElement('div');
    resultBody.appendChild(scoreDiv);
    UI.renderScoreSummary(scoreDiv, best, ctx);
    if (!best.isYakuman) {
      const fuDiv = document.createElement('div');
      resultBody.appendChild(fuDiv);
      UI.renderFuBreakdown(fuDiv, best.fuBreakdown, best.fu);
    }
  }

  function renderTenpaiYakuPreview() {
    const container = document.getElementById('analysis-wait-yaku-preview');
    if (analysisTab.analysis || !analysisTab.overall || analysisTab.overall.shanten !== 0) {
      container.hidden = true;
      return;
    }
    const waitInfo = HandInfo.classifyWait(analysisTab.counts);
    if (!waitInfo) {
      container.hidden = true;
      return;
    }

    container.hidden = false;
    container.innerHTML = '';
    const title = document.createElement('div');
    title.className = 'wait-header';
    title.textContent = '各待ち牌でアガった場合に成立する役(現在の「アガリ条件」設定に基づく参考)';
    container.appendChild(title);

    const ctxBase = buildScoringContext();
    const doraSetting = buildDoraSetting();
    const rules = analysisTab.agari.rules;

    waitInfo.tiles.forEach((t) => {
      const counts14 = analysisTab.counts.slice();
      counts14[t.tile]++;
      const ctx = Object.assign({}, ctxBase, { winningTile: t.tile });
      const result = Scoring.scoreHand(counts14, ctx, rules, doraSetting);

      const row = document.createElement('div');
      row.className = 'yaku-candidate-item';
      const nameSpan = document.createElement('span');
      nameSpan.className = 'cand-name';
      nameSpan.textContent = `${t.label}でアガリ`;
      row.appendChild(nameSpan);
      const detail = document.createElement('span');
      if (result.hasYaku) {
        const names = result.best.yakuList.map((y) => y.name).join('・');
        const tierText = result.best.isYakuman ? '役満' : `${result.best.han}翻${result.best.fu}符`;
        detail.textContent = `${names}(${tierText} / ${result.best.score.total}点)`;
      } else {
        detail.textContent = '現在の条件では役なし(リーチ等が無いとアガれません)';
      }
      row.appendChild(detail);
      container.appendChild(row);
    });
  }

  function onConditionsChanged() {
    if (analysisTab.mode !== 'analyzed') return;
    if (analysisTab.overall.shanten === -1) {
      renderAgariScoring();
    } else if (analysisTab.overall.shanten === 0) {
      renderTenpaiYakuPreview();
    }
  }

  function initAgariConditionsUI() {
    const seatSelect = document.getElementById('cond-seat-wind');
    const roundSelect = document.getElementById('cond-round-wind');
    UI.populateWindSelect(seatSelect);
    UI.populateWindSelect(roundSelect);
    seatSelect.value = String(analysisTab.agari.conditions.seatWind);
    roundSelect.value = String(analysisTab.agari.conditions.roundWind);

    document.getElementById('cond-tsumo-ron').addEventListener('change', (e) => {
      analysisTab.agari.conditions.isTsumo = e.target.value === 'tsumo';
      onConditionsChanged();
    });

    document.getElementById('cond-dealer').addEventListener('change', (e) => {
      analysisTab.agari.conditions.isDealer = e.target.value === 'dealer';
      seatSelect.disabled = analysisTab.agari.conditions.isDealer;
      onConditionsChanged();
    });

    seatSelect.addEventListener('change', (e) => {
      analysisTab.agari.conditions.seatWind = Number(e.target.value);
      onConditionsChanged();
    });
    roundSelect.addEventListener('change', (e) => {
      analysisTab.agari.conditions.roundWind = Number(e.target.value);
      onConditionsChanged();
    });

    const checkboxMap = {
      'cond-riichi': 'isRiichi',
      'cond-double-riichi': 'isDoubleRiichi',
      'cond-ippatsu': 'isIppatsu',
      'cond-last-tile': 'isLastTile',
      'cond-rinshan': 'isRinshan',
      'cond-chankan': 'isChankan',
    };
    Object.keys(checkboxMap).forEach((id) => {
      document.getElementById(id).addEventListener('change', (e) => {
        analysisTab.agari.conditions[checkboxMap[id]] = e.target.checked;
        if (id === 'cond-double-riichi' && e.target.checked) {
          document.getElementById('cond-riichi').checked = true;
          analysisTab.agari.conditions.isRiichi = true;
        }
        onConditionsChanged();
      });
    });

    const ruleMap = {
      'rule-kuitan': 'kuitan',
      'rule-aka': 'akaDora',
      'rule-kiriage': 'kiriageMangan',
      'rule-kazoe': 'kazoeYakuman',
      'rule-double-yakuman': 'doubleYakuman',
    };
    Object.keys(ruleMap).forEach((id) => {
      document.getElementById(id).addEventListener('change', (e) => {
        analysisTab.agari.rules[ruleMap[id]] = e.target.checked;
        onConditionsChanged();
      });
    });
  }

  function renderAnalysisCompareSelf() {
    const container = document.getElementById('analysis-compare-cards');
    if (analysisTab.selectedPosition === null) {
      container.innerHTML = '';
      return;
    }
    const chosenTile = analysisTab.tiles[analysisTab.selectedPosition];
    const chosen = analysisTab.analysis.discards.find((d) => d.tile === chosenTile);
    const best = analysisTab.analysis.recommended;
    const grade = chosen.grade;

    UI.renderComparisonCards(container, chosen, best, grade);

    // 選んだ牌・おすすめの牌それぞれの打牌後がテンパイなら、待ち牌も添える
    const cards = container.querySelectorAll('.compare-card');
    [
      { card: cards[0], tile: chosen.tile },
      { card: cards[1], tile: best.tile },
    ].forEach(({ card, tile }) => {
      if (!card) return;
      const counts13 = analysisTab.counts.slice();
      counts13[tile]--;
      const waitInfo = HandInfo.classifyWait(counts13);
      if (waitInfo) {
        const waitLine = document.createElement('div');
        waitLine.className = 'compare-card-wait';
        const waitTilesText = waitInfo.tiles.map((t) => `${t.label}×${t.remaining}`).join(' ');
        waitLine.textContent = `テンパイ(${waitInfo.shapeLabel || '待ち牌あり'}): ${waitTilesText}`;
        card.appendChild(waitLine);
      }
    });
  }

  // ---- 局面のJSON書き出し・読み込み(section U) ----
  function handleExportScenario() {
    const scenario = {
      schemaVersion: 1,
      counts: analysisTab.counts,
      conditions: analysisTab.agari.conditions,
      rules: analysisTab.agari.rules,
    };
    document.getElementById('analysis-scenario-json').value = JSON.stringify(scenario, null, 2);
  }

  function handleImportScenario() {
    const raw = document.getElementById('analysis-scenario-json').value;
    let scenario;
    try {
      scenario = JSON.parse(raw);
    } catch (e) {
      window.alert('JSONの形式が正しくありません。');
      return;
    }
    if (!Array.isArray(scenario.counts) || scenario.counts.length !== Tiles.TILE_COUNT) {
      window.alert('手牌データ(counts)が正しくありません。');
      return;
    }
    const total = Tiles.totalCount(scenario.counts);
    if (total !== 13 && total !== 14) {
      window.alert(`手牌の合計枚数が${total}枚です。13枚または14枚のデータを読み込んでください。`);
      return;
    }

    analysisTab.counts = scenario.counts.slice();
    if (scenario.conditions) analysisTab.agari.conditions = Object.assign(analysisTab.agari.conditions, scenario.conditions);
    if (scenario.rules) analysisTab.agari.rules = Object.assign(analysisTab.agari.rules, scenario.rules);
    analysisTab.mode = 'editing';
    analysisTab.selectedPosition = null;
    document.getElementById('analysis-results').hidden = true;
    document.getElementById('analysis-palette-area').hidden = false;
    document.getElementById('analysis-edit-btn').hidden = true;
    renderAnalysisEditing();
  }

  function initAnalysisTab() {
    document.getElementById('analysis-run-btn').addEventListener('click', handleAnalysisRun);
    document.getElementById('analysis-edit-btn').addEventListener('click', handleAnalysisEditAgain);
    document.getElementById('analysis-clear-btn').addEventListener('click', handleAnalysisClear);
    document.getElementById('analysis-export-btn').addEventListener('click', handleExportScenario);
    document.getElementById('analysis-import-btn').addEventListener('click', handleImportScenario);
    initAgariConditionsUI();
    renderAnalysisEditing();
  }

  // ==================================================
  // 用語辞典タブ
  // ==================================================
  function initDictionaryTab() {
    UI.renderDictionary(document.getElementById('dictionary-list'), Dictionary.TERMS);
  }

  // ==================================================
  // 成績タブ
  // ==================================================
  function renderStatsTab() {
    UI.renderStats(document.getElementById('stats-container'), Stats.getSummary());
  }

  function initStatsTab() {
    document.getElementById('stats-reset-btn').addEventListener('click', () => {
      Stats.reset();
      renderStatsTab();
    });
  }

  // ==================================================
  // 初期化
  // ==================================================
  document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    initDifficultyControl();
    initTrainingTab();
    initMondaiTab();
    initAnalysisTab();
    initDictionaryTab();
    initStatsTab();
  });
})();
