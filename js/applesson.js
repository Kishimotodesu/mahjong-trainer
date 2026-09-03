/**
 * applesson.js
 * 「学習」タブに追加する、ミニレッスン(字牌・フリテンなど)の画面制御。
 *
 * 流れ: 見る(scene) → 考える(question) → 答える(choices) → 理由を見る(explanation)
 *       → 詳しく見る(折りたたみ)
 * 正誤判定は一切ここで行わず、lessonengine.js の gradeStep に委ねる
 * (本番ロジックとずれないようにするため)。
 */
(function () {
  'use strict';

  const Tiles = window.MJ.Tiles;
  const Lessons = window.MJ.Lessons;
  const LessonEngine = window.MJ.LessonEngine;
  const Probability = window.MJ.Probability;

  const state = {
    lessonId: null,
    stepIndex: 0,
    answeredChoiceId: null,
    gradeResult: null,
  };

  function el(tag, className, text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  function makeTileSpan(tileIdx, extraClass) {
    const span = document.createElement('span');
    span.className = 'mini-tile lesson-tile' + (extraClass ? ' ' + extraClass : '');
    span.textContent = Tiles.shortLabel(tileIdx);
    span.title = Tiles.fullName(tileIdx);
    return span;
  }

  // ==================================================
  // レッスン一覧
  // ==================================================

  function renderLessonList(container) {
    container.innerHTML = '';
    const progress = LessonEngine.loadProgress();
    const summary = LessonEngine.summarize(progress);

    const summaryBox = el('div', 'lesson-summary');
    summaryBox.appendChild(
      el(
        'div',
        'muted',
        `学習済み${summary.counts.studied + summary.counts.mastered + summary.counts.needs_review}/${summary.total}レッスン ・ 理解済み${summary.counts.mastered} ・ 要復習${summary.counts.needs_review}`
      )
    );
    container.appendChild(summaryBox);

    Lessons.listLessons().forEach((l) => {
      const status = LessonEngine.statusOf(l.id, progress);
      const card = el('div', 'lesson-card status-' + status);
      const head = el('div', 'lesson-card-head');
      head.appendChild(el('strong', null, l.title));
      head.appendChild(el('span', 'lesson-status-badge status-' + status, LessonEngine.STATUS_LABEL[status]));
      card.appendChild(head);
      card.appendChild(el('div', 'muted', l.beginnerGoal));
      const btn = el('button', 'primary', status === 'not_started' ? 'レッスンを始める' : 'もう一度学ぶ');
      btn.addEventListener('click', () => startLesson(l.id));
      card.appendChild(btn);
      container.appendChild(card);
    });
  }

  // ==================================================
  // レッスン実行
  // ==================================================

  function startLesson(lessonId) {
    state.lessonId = lessonId;
    state.stepIndex = 0;
    state.answeredChoiceId = null;
    state.gradeResult = null;
    render();
  }

  function currentLesson() {
    return Lessons.getLesson(state.lessonId);
  }

  function currentStep() {
    const lesson = currentLesson();
    return lesson ? lesson.steps[state.stepIndex] : null;
  }

  function handleChoice(choiceId) {
    const step = currentStep();
    if (!step || state.answeredChoiceId !== null) return;
    const grade = LessonEngine.gradeStep(step, choiceId);
    state.answeredChoiceId = choiceId;
    state.gradeResult = grade;
    LessonEngine.recordStepResult(state.lessonId, step.id, grade.correct);
    render();
  }

  function goNextStep() {
    const lesson = currentLesson();
    if (state.stepIndex + 1 < lesson.steps.length) {
      state.stepIndex++;
      state.answeredChoiceId = null;
      state.gradeResult = null;
      render();
    } else {
      backToList();
    }
  }

  function backToList() {
    state.lessonId = null;
    render();
  }

  // ==================================================
  // 描画: シーン(牌の表示)
  // ==================================================

  function renderVisual(container, visual, step) {
    container.innerHTML = '';
    if (!visual) return;

    if (visual.tiles) {
      const row = el('div', 'lesson-tile-row');
      visual.tiles.forEach((t) => {
        const highlighted = visual.highlight && visual.highlight.indexOf(t) !== -1;
        row.appendChild(makeTileSpan(t, highlighted ? 'lesson-tile-highlight' : null));
      });
      container.appendChild(row);
    }

    if (visual.pairs) {
      const row = el('div', 'lesson-tile-pairs');
      visual.pairs.forEach((p) => {
        const box = el('div', 'lesson-tile-pair-box');
        box.appendChild(el('div', 'muted', p.label));
        box.appendChild(makeTileSpan(p.tile));
        row.appendChild(box);
      });
      container.appendChild(row);
    }

    if (visual.waitTiles) {
      renderFuritenVisual(container, visual, step);
    }

    if (visual.context) {
      const ctxLine = el('div', 'lesson-context', `${visual.context.roundWindLabel || ''} ${visual.context.seatWindLabel || ''}`.trim());
      container.appendChild(ctxLine);
    }
  }

  function renderFuritenVisual(container, visual, step) {
    const waitBox = el('div', 'lesson-wait-box');
    waitBox.appendChild(el('div', 'lesson-visual-label', '自分の待ち'));
    const waitRow = el('div', 'lesson-tile-row');
    visual.waitTiles.forEach((t) => {
      const isBlocking = visual.ownDiscards && visual.ownDiscards.indexOf(t) !== -1;
      waitRow.appendChild(makeTileSpan(t, isBlocking ? 'lesson-tile-blocking' : null));
    });
    waitBox.appendChild(waitRow);
    container.appendChild(waitBox);

    if (visual.ownDiscards) {
      const discardBox = el('div', 'lesson-wait-box');
      discardBox.appendChild(el('div', 'lesson-visual-label', '自分の河'));
      const row = el('div', 'lesson-tile-row');
      if (visual.ownDiscards.length === 0) {
        row.appendChild(el('span', 'muted', '(まだ何も捨てていません)'));
      } else {
        visual.ownDiscards.forEach((t) => {
          const isBlocking = visual.waitTiles.indexOf(t) !== -1;
          row.appendChild(makeTileSpan(t, isBlocking ? 'lesson-tile-blocking' : null));
        });
      }
      discardBox.appendChild(row);
      container.appendChild(discardBox);
    }

    if (visual.missedTile !== undefined) {
      const box = el('div', 'lesson-wait-box');
      box.appendChild(el('div', 'lesson-visual-label', '見逃した牌'));
      const row = el('div', 'lesson-tile-row');
      row.appendChild(makeTileSpan(visual.missedTile, 'lesson-tile-blocking'));
      box.appendChild(row);
      container.appendChild(box);
    }

    if (visual.opponentDiscard !== undefined) {
      const box = el('div', 'lesson-wait-box');
      box.appendChild(el('div', 'lesson-visual-label', '相手が捨てた牌'));
      const row = el('div', 'lesson-tile-row');
      row.appendChild(makeTileSpan(visual.opponentDiscard));
      box.appendChild(row);
      container.appendChild(box);
    }

    if (visual.selfDraw !== undefined) {
      const box = el('div', 'lesson-wait-box');
      box.appendChild(el('div', 'lesson-visual-label', '自分でツモった牌'));
      const row = el('div', 'lesson-tile-row');
      row.appendChild(makeTileSpan(visual.selfDraw));
      box.appendChild(row);
      container.appendChild(box);
    }

    if (visual.riichi) {
      container.appendChild(el('div', 'lesson-riichi-badge', 'リーチ中'));
    }
  }

  // ==================================================
  // 描画: ステップ本体
  // ==================================================

  function renderStep() {
    const lesson = currentLesson();
    const step = currentStep();
    const box = document.getElementById('lesson-runner-body');
    box.innerHTML = '';

    document.getElementById('lesson-runner-title').textContent = lesson.title;
    document.getElementById('lesson-runner-progress').textContent = `${state.stepIndex + 1} / ${lesson.steps.length}`;

    const titleEl = el('h3', null, step.title || '');
    box.appendChild(titleEl);

    const visualBox = el('div', 'lesson-visual');
    renderVisual(visualBox, step.visual, step);
    box.appendChild(visualBox);

    if (step.kind === 'info' || step.kind === 'link') {
      box.appendChild(el('p', 'lesson-body-text', step.body));
      if (step.kind === 'link') {
        const btn = el('button', 'primary', step.linkLabel);
        btn.addEventListener('click', () => {
          const tabBtn = document.querySelector('.tab-btn[data-tab="' + step.linkTab + '"]');
          if (tabBtn) tabBtn.click();
        });
        box.appendChild(btn);
      }
      renderNav(box, true);
      return;
    }

    // quiz / tie
    box.appendChild(el('p', 'lesson-question', step.question));

    const choicesBox = el('div', 'lesson-choices');
    step.choices.forEach((c) => {
      const btn = el('button', 'lesson-choice-btn', c.label);
      if (state.answeredChoiceId !== null) {
        btn.disabled = true;
        if (c.id === state.answeredChoiceId) btn.classList.add('chosen');
        if (state.gradeResult.correctChoiceId === c.id) btn.classList.add('correct-answer');
      }
      btn.addEventListener('click', () => handleChoice(c.id));
      choicesBox.appendChild(btn);
    });
    box.appendChild(choicesBox);

    if (state.answeredChoiceId !== null) {
      renderResult(box, step);
    }
  }

  function renderResult(box, step) {
    const grade = state.gradeResult;
    const resultLine = el('div', 'grade-line ' + (grade.correct ? 'grade-excellent' : 'grade-bad'), grade.correct ? '正解です' : '不正解です');
    box.appendChild(resultLine);

    const point = el('div', 'beginner-point');
    point.appendChild(el('div', 'beginner-point-title', '今回一番覚えてほしいこと'));
    point.appendChild(el('div', 'beginner-point-body', step.beginnerPoint || step.explanation));
    box.appendChild(point);

    const details = document.createElement('details');
    details.className = 'review-details';
    const summary = document.createElement('summary');
    summary.textContent = '詳しく見る';
    details.appendChild(summary);
    const body = el('div', 'review-details-body');
    body.appendChild(el('p', null, step.explanation));
    appendProbabilityIfRelevant(body, step);
    details.appendChild(body);
    box.appendChild(details);

    renderNav(box, true);
  }

  /** フリテン教材のツモ問題で、次のツモでアガる確率も補足する(発展情報)。 */
  function appendProbabilityIfRelevant(container, step) {
    if (!step.visual || !step.visual.waitTiles || !Probability) return;
    const waitTotal = step.visual.waitTiles.length * 4 - (step.visual.ownDiscards ? step.visual.ownDiscards.filter((t) => step.visual.waitTiles.indexOf(t) !== -1).length : 0);
    // 教材では正確な残り枚数までは追わず、待ち種類×4枚を目安値として理論的に示す
    const unseen = Probability.unseenTotalFromHandOnly(new Array(34).fill(0));
    const prob = Probability.nextDrawProbability(Math.max(waitTotal, 1), unseen);
    const p = el('p', 'muted', `参考: 待ち牌が${step.visual.waitTiles.length}種類ある場合、次の自分のツモでどれかを引く確率はおおよそ${Probability.toPercentLabel(prob)}前後です(見えている牌の状況により変わります)。`);
    container.appendChild(p);
  }

  function renderNav(box, showNext) {
    const nav = el('div', 'lesson-nav controls');
    const backBtn = el('button', null, '一覧に戻る');
    backBtn.addEventListener('click', backToList);
    nav.appendChild(backBtn);
    if (showNext) {
      const lesson = currentLesson();
      const isLast = state.stepIndex + 1 >= lesson.steps.length;
      const nextBtn = el('button', 'primary', isLast ? '完了' : '次へ');
      nextBtn.addEventListener('click', goNextStep);
      nav.appendChild(nextBtn);
    }
    box.appendChild(nav);
  }

  // ==================================================
  // 全体描画
  // ==================================================

  function render() {
    const listView = document.getElementById('lesson-list-view');
    const runnerView = document.getElementById('lesson-runner-view');
    if (!listView || !runnerView) return;
    if (state.lessonId) {
      listView.hidden = true;
      runnerView.hidden = false;
      renderStep();
    } else {
      listView.hidden = false;
      runnerView.hidden = true;
      renderLessonList(listView);
    }
  }

  function init() {
    render();
  }

  document.addEventListener('DOMContentLoaded', init);

  window.MJ = window.MJ || {};
  window.MJ.AppLesson = { init, render, startLesson };
})();
