/**
 * appreview.js
 * 「復習」タブの画面制御。
 *
 * 画面は3つのモードを切り替えて表示する:
 *   list    … 復習帳の一覧 + 苦手分析 + 成長表示
 *   solve   … 保存した問題をもう一度解く(答えは隠す)
 *   result  … 解いた直後の結果(前回との比較つき)
 */
(function (root) {
  'use strict';

  const Tiles = window.MJ.Tiles;
  const UI = window.MJ.UI;
  const Review = window.MJ.Review;
  const Problems = window.MJ.Problems;
  const Evaluator = window.MJ.Evaluator;

  const GRADE_MARK = { excellent: '◎', good: '○', fair: '△', bad: '×' };

  const state = {
    mode: 'list',
    hideAnswers: true,
    statusFilter: 'all',
    queue: [], // 「今日の復習」で解く問題IDの並び
    queueIndex: 0,
    problem: null,
    entry: null,
    selectedPosition: null,
    lastResult: null,
  };

  // ==================================================
  // 共通ヘルパー
  // ==================================================

  function fmtDate(iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '-';
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  }

  function gradeMark(grade) {
    return GRADE_MARK[grade] || '-';
  }

  function makeButton(label, onClick, primary) {
    const btn = document.createElement('button');
    btn.textContent = label;
    if (primary) btn.className = 'primary';
    btn.addEventListener('click', onClick);
    return btn;
  }

  function el(tag, className, text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  // ==================================================
  // 一覧モード
  // ==================================================

  function renderList() {
    const store = Review.loadStore();
    const container = document.getElementById('review-list-body');
    container.innerHTML = '';

    renderSummary(store);
    renderWeakness(store);

    const rows = Review.listForDisplay(store).filter((r) => {
      if (state.statusFilter === 'all') return true;
      return r.status === state.statusFilter;
    });

    document.getElementById('review-count-label').textContent =
      `${rows.length}問を表示中(全${store.entries.length}問)`;

    if (rows.length === 0) {
      const empty = el('p', 'muted');
      empty.textContent =
        store.entries.length === 0
          ? 'まだ復習帳は空です。「何切る問題」で間違えた問題は自動でここに貯まります。'
          : 'この状態の問題はありません。フィルターを「すべて」に戻してください。';
      container.appendChild(empty);
      return;
    }

    rows.forEach((row) => container.appendChild(renderListItem(row)));
  }

  function renderListItem(row) {
    const box = el('div', 'review-item status-' + row.status);

    const head = el('div', 'review-item-head');
    const status = el('span', 'review-status-badge status-' + row.status, row.statusLabel);
    head.appendChild(status);
    head.appendChild(el('span', 'review-date', `最終回答: ${fmtDate(row.lastAnsweredAt)}`));
    box.appendChild(head);

    // 手牌(小さめ)
    const handRow = el('div', 'review-mini-hand');
    row.entry.tiles14.forEach((t) => {
      const mini = el('span', 'mini-tile', Tiles.shortLabel(t));
      handRow.appendChild(mini);
    });
    box.appendChild(handRow);

    const info = el('div', 'review-item-info');
    if (state.hideAnswers) {
      info.appendChild(el('span', 'review-hidden-note', `回答${row.attemptCount}回 / 答えは非表示中`));
    } else {
      const prev = el('span', 'review-prev');
      prev.textContent = `前回: ${row.lastChosenLabel || '-'} ${gradeMark(row.lastGrade)}`;
      info.appendChild(prev);
      info.appendChild(el('span', 'review-best', `おすすめ: ${row.bestLabel}`));
    }
    box.appendChild(info);

    if (row.tags.length > 0) {
      const tagRow = el('div', 'review-tags');
      tagRow.appendChild(el('span', 'review-tag-label', '苦手:'));
      row.tags.slice(0, 4).forEach((t) => tagRow.appendChild(el('span', 'review-tag', t)));
      box.appendChild(tagRow);
    }

    const controls = el('div', 'review-item-controls');
    controls.appendChild(makeButton('もう一度解く', () => startSolve([row.problemId], 0), true));
    controls.appendChild(
      makeButton('履歴', () => {
        const detail = box.querySelector('.review-history');
        if (detail) detail.hidden = !detail.hidden;
      }, false)
    );
    controls.appendChild(
      makeButton('削除', () => {
        const store = Review.deleteEntry(row.problemId);
        Review.saveStore(store);
        render();
      }, false)
    );
    box.appendChild(controls);

    box.appendChild(renderHistory(row.entry));
    return box;
  }

  function renderHistory(entry) {
    const wrap = el('div', 'review-history');
    wrap.hidden = true;
    const list = el('ol', 'review-history-list');
    (entry.attempts || []).forEach((a, i) => {
      const li = el('li');
      li.textContent = `${i + 1}回目: ${a.chosenLabel} ${gradeMark(a.grade)}(${fmtDate(a.at)})`;
      if (a.grade === 'excellent') li.className = 'history-excellent';
      list.appendChild(li);
    });
    if ((entry.attempts || []).length === 0) list.appendChild(el('li', null, 'まだ履歴がありません'));
    wrap.appendChild(list);
    return wrap;
  }

  function renderSummary(store) {
    const s = Review.summarize(store);
    const box = document.getElementById('review-summary');
    box.innerHTML = '';
    box.appendChild(el('h3', null, 'これまでの成長'));

    const grid = el('div', 'review-summary-grid');
    const cell = (label, value) => {
      const c = el('div', 'review-summary-cell');
      c.appendChild(el('div', 'review-summary-value', String(value)));
      c.appendChild(el('div', 'review-summary-label', label));
      return c;
    };
    grid.appendChild(cell('復習した問題', s.totalProblems + '問'));
    grid.appendChild(cell('習得', s.masteredCount + '問'));
    grid.appendChild(cell('学習中', s.learningCount + '問'));
    grid.appendChild(cell('要復習', s.todoCount + '問'));
    grid.appendChild(cell('未復習', s.newCount + '問'));
    grid.appendChild(cell('今週の◎率', s.weekExcellentRate === null ? '-' : s.weekExcellentRate + '%'));
    box.appendChild(grid);

    const note = el('p', 'muted');
    if (s.masteredCount > 0) {
      note.textContent = `「習得」は直近2回続けて◎だった問題です。${s.masteredCount}問が分かるようになりました。`;
    } else {
      note.textContent = '同じ問題で2回続けて◎になると「習得」になります。まずは1問ずつ確実にしていきましょう。';
    }
    box.appendChild(note);
  }

  function renderWeakness(store) {
    const box = document.getElementById('review-weakness');
    box.innerHTML = '';
    const list = Review.analyzeWeakness(store).slice(0, 3);

    box.appendChild(el('h3', null, 'あなたが現在苦手なもの'));
    if (list.length === 0) {
      box.appendChild(el('p', 'muted', 'まだ判定できるデータがありません。何切る問題を数問解いてみましょう。'));
      return;
    }

    const ol = el('ol', 'weakness-list');
    list.forEach((w) => {
      const li = el('li');
      const head = el('div', 'weakness-head');
      head.appendChild(el('strong', null, w.tag));
      head.appendChild(el('span', 'weakness-rate', `正答率 ${w.rate}%(${w.correct}/${w.total}回)`));
      li.appendChild(head);
      li.appendChild(el('div', 'weakness-desc', w.description));
      ol.appendChild(li);
    });
    box.appendChild(ol);
  }

  // ==================================================
  // 解答モード
  // ==================================================

  function startTodayReview() {
    const picked = Review.pickTodayReview(null, Review.DAILY_REVIEW_SIZE);
    if (picked.length === 0) {
      window.alert('復習できる問題がまだありません。「何切る問題」を何問か解いてみましょう。');
      return;
    }
    startSolve(picked.map((e) => e.problemId), 0);
  }

  function startSolve(problemIds, index) {
    state.queue = problemIds;
    state.queueIndex = index;
    loadCurrentProblem();
  }

  function loadCurrentProblem() {
    const id = state.queue[state.queueIndex];
    const entry = Review.getEntry(id);
    if (!entry) {
      backToList();
      return;
    }
    state.entry = entry;
    state.problem = Problems.problemFromEntry(entry);
    state.selectedPosition = null;
    state.lastResult = null;
    state.mode = 'solve';
    render();
  }

  function handleTileClick(tileValue, position) {
    if (state.mode !== 'solve') return;
    state.selectedPosition = state.selectedPosition === position ? null : position;
    render();
  }

  function handleAnswer() {
    if (state.selectedPosition === null) return;
    const tileValue = state.problem.tiles14[state.selectedPosition];
    const analysis = state.problem.analysis;
    const grade = Evaluator.gradeUserChoice(analysis, tileValue);

    // 今回の回答より前の履歴を控えておく(比較表示に使う)
    const before = (state.entry.attempts || []).slice();
    const prevAttempt = before[before.length - 1] || null;

    const res = Review.recordAndSave({
      tiles14: state.problem.tiles14,
      counts14: state.problem.counts14,
      analysis,
      chosenTile: tileValue,
      grade: grade.grade,
      gradeLabel: grade.gradeLabel,
      comment: grade.comment,
      source: 'review',
    });

    state.entry = res.entry;
    state.lastResult = {
      chosenTile: tileValue,
      chosenLabel: Tiles.shortLabel(tileValue),
      grade: grade.grade,
      gradeLabel: grade.gradeLabel,
      comment: grade.comment,
      prev: prevAttempt,
      statusAfter: Review.statusOf(res.entry),
    };
    state.mode = 'result';
    render();
  }

  function nextInQueue() {
    if (state.queueIndex + 1 < state.queue.length) {
      state.queueIndex++;
      loadCurrentProblem();
    } else {
      backToList();
    }
  }

  function backToList() {
    state.mode = 'list';
    state.problem = null;
    state.entry = null;
    state.queue = [];
    state.queueIndex = 0;
    render();
  }

  function renderSolve() {
    const handContainer = document.getElementById('review-solve-hand');
    UI.renderHand(handContainer, state.problem.tiles14, {
      selectedPosition: state.selectedPosition,
      onTileClick: handleTileClick,
    });

    const progress = document.getElementById('review-solve-progress');
    progress.textContent =
      state.queue.length > 1 ? `${state.queueIndex + 1}問目 / 全${state.queue.length}問` : 'もう一度解いてみましょう';

    document.getElementById('review-solve-answer-btn').disabled = state.selectedPosition === null;

    const resultBox = document.getElementById('review-solve-result');
    resultBox.hidden = state.mode !== 'result';
    if (state.mode === 'result') renderResult(resultBox);

    document.getElementById('review-solve-controls-answering').hidden = state.mode !== 'solve';
    document.getElementById('review-solve-controls-done').hidden = state.mode !== 'result';
    document.getElementById('review-next-btn').textContent =
      state.queueIndex + 1 < state.queue.length ? '次の問題へ' : '一覧に戻る';
  }

  function renderResult(box) {
    box.innerHTML = '';
    const r = state.lastResult;
    const entry = state.entry;

    // 1) 今回の評価
    const gradeLine = el('div', 'grade-line grade-' + r.grade, r.gradeLabel);
    box.appendChild(gradeLine);

    // 2) 前回との比較
    const compare = el('div', 'review-compare');
    if (r.prev) {
      const prevRow = el('div', 'review-compare-row');
      prevRow.appendChild(el('span', 'review-compare-label', '前回'));
      prevRow.appendChild(el('span', 'review-compare-value', `${r.prev.chosenLabel} ${gradeMark(r.prev.grade)}`));
      compare.appendChild(prevRow);
    }
    const nowRow = el('div', 'review-compare-row');
    nowRow.appendChild(el('span', 'review-compare-label', '今回'));
    nowRow.appendChild(el('span', 'review-compare-value', `${r.chosenLabel} ${gradeMark(r.grade)}`));
    compare.appendChild(nowRow);

    const bestRow = el('div', 'review-compare-row');
    bestRow.appendChild(el('span', 'review-compare-label', 'おすすめ'));
    bestRow.appendChild(el('span', 'review-compare-value', entry.bestLabel));
    compare.appendChild(bestRow);
    box.appendChild(compare);

    // 3) 変化のひとこと
    if (r.prev) {
      const order = { bad: 0, fair: 1, good: 2, excellent: 3 };
      const diff = order[r.grade] - order[r.prev.grade];
      const change = el('div', 'review-change');
      if (diff > 0) {
        change.className += ' change-up';
        change.textContent = '改善しました!';
      } else if (diff === 0) {
        change.textContent = r.grade === 'excellent' ? '前回と同じく正解です。' : '前回と同じ結果でした。もう一度考え方を確認しましょう。';
      } else {
        change.className += ' change-down';
        change.textContent = '前回より評価が下がりました。下の解説をもう一度読んでみましょう。';
      }
      box.appendChild(change);
    }

    // 4) 習得判定
    if (r.statusAfter === 'mastered') {
      box.appendChild(el('div', 'review-mastered', '2回続けて◎になりました。この問題は「習得」です。'));
    }

    // 5) 今回一番覚えてほしいこと
    const point = el('div', 'beginner-point');
    point.appendChild(el('div', 'beginner-point-title', '今回一番覚えてほしいこと'));
    point.appendChild(el('div', 'beginner-point-body', entry.beginnerPoint || r.comment));
    box.appendChild(point);

    // 6) 詳しく見る(折りたたみ)
    const details = document.createElement('details');
    details.className = 'review-details';
    const summary = document.createElement('summary');
    summary.textContent = '詳しく見る(受け入れ枚数・シャンテン数)';
    details.appendChild(summary);

    const detailBody = el('div', 'review-details-body');
    detailBody.appendChild(el('p', null, r.comment));
    const ul = el('ul');
    ul.appendChild(el('li', null, `この手牌のシャンテン数: ${entry.shantenAtStart}`));
    ul.appendChild(
      el('li', null, `おすすめ ${entry.bestLabel}: シャンテン${entry.bestShanten} / 受け入れ${entry.bestUkeire}枚`)
    );
    const chosen = state.problem.analysis.discards.find((d) => d.tile === r.chosenTile);
    if (chosen) {
      ul.appendChild(
        el('li', null, `あなたの ${r.chosenLabel}: シャンテン${chosen.resultShanten} / 受け入れ${chosen.ukeireTotal}枚`)
      );
    }
    if ((entry.ukeireTiles || []).length > 0) {
      ul.appendChild(el('li', null, `おすすめを切った後の有効牌: ${entry.ukeireTiles.join('、')}`));
    }
    detailBody.appendChild(ul);
    if (entry.explanation) detailBody.appendChild(el('p', null, entry.explanation));
    details.appendChild(detailBody);
    box.appendChild(details);

    // 7) これまでの履歴
    const hist = el('div', 'review-result-history');
    hist.appendChild(el('div', 'review-result-history-title', 'これまでの回答'));
    const list = el('ol', 'review-history-list');
    (entry.attempts || []).forEach((a, i) => {
      const li = el('li', a.grade === 'excellent' ? 'history-excellent' : null);
      li.textContent = `${i + 1}回目: ${a.chosenLabel} ${gradeMark(a.grade)}`;
      list.appendChild(li);
    });
    hist.appendChild(list);
    box.appendChild(hist);
  }

  // ==================================================
  // Export / Import
  // ==================================================

  function handleExport() {
    const area = document.getElementById('review-io-text');
    area.value = Review.exportJson();
    document.getElementById('review-io-message').textContent =
      '書き出しました。この内容をコピーして保存してください(別の端末では「読み込む」に貼り付けます)。';
  }

  function handleImport() {
    const area = document.getElementById('review-io-text');
    const msg = document.getElementById('review-io-message');
    const res = Review.importJson(area.value);
    if (!res.ok) {
      msg.textContent = '読み込めませんでした: ' + res.error;
      return;
    }
    Review.saveStore(res.store);
    msg.textContent = `読み込みました(新規${res.added}問 / 履歴を追加${res.merged}問)。`;
    render();
  }

  // ==================================================
  // 描画の切り替え
  // ==================================================

  function render() {
    const listView = document.getElementById('review-list-view');
    const solveView = document.getElementById('review-solve-view');
    if (state.mode === 'list') {
      listView.hidden = false;
      solveView.hidden = true;
      renderList();
    } else {
      listView.hidden = true;
      solveView.hidden = false;
      renderSolve();
    }
  }

  function init() {
    document.getElementById('review-today-btn').addEventListener('click', startTodayReview);
    document.getElementById('review-hide-answers').addEventListener('change', (e) => {
      state.hideAnswers = e.target.checked;
      render();
    });
    document.getElementById('review-status-filter').addEventListener('change', (e) => {
      state.statusFilter = e.target.value;
      render();
    });
    document.getElementById('review-solve-answer-btn').addEventListener('click', handleAnswer);
    document.getElementById('review-next-btn').addEventListener('click', nextInQueue);
    document.getElementById('review-back-btn').addEventListener('click', backToList);
    document.getElementById('review-export-btn').addEventListener('click', handleExport);
    document.getElementById('review-import-btn').addEventListener('click', handleImport);
    render();
  }

  document.addEventListener('DOMContentLoaded', init);

  window.MJ = window.MJ || {};
  window.MJ.AppReview = { init, render, state, startSolve, startTodayReview };
})();
