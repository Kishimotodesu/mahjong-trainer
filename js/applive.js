/**
 * applive.js
 * 実戦学習モードの画面制御。
 *
 * ■ 画面の作り
 *  対局盤面はそのまま残し、下から開くパネル(スマホ)/画面下に固定されるパネル(PC)で出題する。
 *  パネルが開いている間は背後を触れないようにし(バックドロップ)、対局も進めない。
 *
 * ■ 対局との関係
 *  この画面は対局状態(match)を直接書き換えない。
 *  出題のたびに livesnapshot.js で公開情報だけのスナップショットを作り、それを評価する。
 *  実際に牌を切るのは、appgame.js から渡された performDiscard フックだけが行う。
 */
(function () {
  'use strict';

  const Tiles = window.MJ.Tiles;
  const UI = window.MJ.UI;
  const LiveSnapshot = window.MJ.LiveSnapshot;
  const LiveCoach = window.MJ.LiveCoach;
  const LiveQuiz = window.MJ.LiveQuiz;
  const LiveSession = window.MJ.LiveSession;

  const state = {
    hooks: null,
    session: null,
    view: null, // 'question' | 'result' | 'coach' | 'replay'
    selected: [],
    graded: null,
    question: null,
    snapshot: null,
    replay: false, // 振り返りからの再回答(対局には影響しない)
    roundCounted: false,
  };

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function byId(id) {
    return document.getElementById(id);
  }

  // ==================================================
  // パネルの開閉
  // ==================================================

  function openPanel(title) {
    byId('live-panel-title').textContent = title;
    byId('live-panel').hidden = false;
    byId('live-backdrop').hidden = false;
    document.body.classList.add('live-panel-open');
  }

  function closePanel() {
    byId('live-panel').hidden = true;
    byId('live-backdrop').hidden = true;
    document.body.classList.remove('live-panel-open');
    state.view = null;
    state.selected = [];
    state.graded = null;
    state.question = null;
    state.snapshot = null;
    state.replay = false;
  }

  /** 学習パネルが開いていて、対局操作を止めるべきか */
  function isBlocking() {
    return !!(state.session && state.session.paused) || (state.view === 'question' && !state.replay);
  }

  // ==================================================
  // 出題
  // ==================================================

  function currentSnapshot() {
    const match = state.hooks.getMatch();
    if (!match || !match.currentRound) return null;
    return LiveSnapshot.buildSnapshot(match, state.hooks.humanSeat);
  }

  /**
   * 出題すべき局面かどうかを調べ、必要なら問題を開く。
   * @returns {boolean} 出題したか
   */
  function maybeAsk() {
    if (!state.session || state.view) return false;
    const snapshot = currentSnapshot();
    if (!snapshot) return false;
    const moment = LiveSession.nextMoment(state.session, snapshot);
    if (!moment) return false;
    const question = LiveQuiz.buildQuestion(snapshot, moment);
    LiveSession.markAsked(state.session, moment, question, snapshot);
    showQuestion(question, snapshot, false);
    return true;
  }

  /** 鳴きの機会に鳴き判断の問題を出す */
  function maybeAskCall(callInfo) {
    if (!state.session || state.view) return false;
    if (state.session.settings.mode === 'off') return false;
    if (state.session.skipRound) return false;
    if (state.session.count >= state.session.settings.maxPerRound) return false;
    // ロンできる場面では出題しない(アガリの操作を邪魔しないため)
    if (callInfo.canRon) return false;
    const snapshot = currentSnapshot();
    if (!snapshot) return false;
    if (state.session.askedKinds.call !== undefined) return false;
    const question = LiveQuiz.callQuestion(snapshot, callInfo);
    question.momentKind = 'call';
    question.id = 'live-call-t' + snapshot.turn;
    LiveSession.markAsked(state.session, { kind: 'call', tags: question.tags, signature: 'call:' + snapshot.turn }, question, snapshot);
    showQuestion(question, snapshot, false);
    return true;
  }

  function showQuestion(question, snapshot, isReplay) {
    state.view = 'question';
    state.question = question;
    state.snapshot = snapshot;
    state.selected = [];
    state.graded = null;
    state.replay = !!isReplay;
    openPanel(question.title);
    render();
  }

  function toggleChoice(choiceId) {
    if (state.graded) return;
    const q = state.question;
    const i = state.selected.indexOf(choiceId);
    if (q.multi) {
      if (i === -1) state.selected.push(choiceId);
      else state.selected.splice(i, 1);
    } else {
      state.selected = i === -1 ? [choiceId] : [];
    }
    render();
  }

  function submit() {
    if (state.selected.length === 0) return;
    state.graded = LiveQuiz.evaluateAnswer(state.snapshot, state.question, state.selected);
    if (!state.replay) {
      LiveSession.recordAnswer(state.session, state.question, state.snapshot, state.graded, {});
      updateCountBadge();
    }
    state.view = 'result';
    render();
  }

  // ==================================================
  // 描画
  // ==================================================

  function renderChoices(body) {
    const q = state.question;
    const wrap = el('div', q.choices[0] && q.choices[0].tile !== undefined ? 'live-choices live-choices-tiles' : 'live-choices');
    q.choices.forEach((c) => {
      const selected = state.selected.indexOf(c.id) !== -1;
      if (c.tile !== undefined) {
        const btn = UI.createTileButton(c.tile, { selected, onClick: () => toggleChoice(c.id) });
        btn.classList.add('live-choice-tile');
        if (state.graded) {
          btn.disabled = true;
          if (state.graded.correctIds.indexOf(c.id) !== -1) btn.classList.add('live-choice-correct');
          if (selected) btn.classList.add('live-choice-picked');
        }
        wrap.appendChild(btn);
      } else {
        const btn = el('button', 'live-choice' + (selected ? ' live-choice-selected' : ''), c.label);
        btn.type = 'button';
        if (state.graded) {
          btn.disabled = true;
          if (state.graded.correctIds.indexOf(c.id) !== -1) btn.classList.add('live-choice-correct');
          if (selected) btn.classList.add('live-choice-picked');
        } else {
          btn.addEventListener('click', () => toggleChoice(c.id));
        }
        wrap.appendChild(btn);
      }
    });
    body.appendChild(wrap);
  }

  /** 出題中も盤面の状況が分かるように、要点だけを短くまとめて出す */
  function renderContext(body) {
    const s = state.snapshot;
    const chips = el('div', 'live-chips');
    const add = (text, cls) => chips.appendChild(el('span', 'live-chip' + (cls ? ' ' + cls : ''), text));
    add(s.turn + '巡目');
    add('残り山' + s.wallCount + '枚');
    const riichi = s.players.filter((p) => !p.isSelf && p.riichi);
    if (riichi.length > 0) add(riichi.map((p) => p.labelWithReading).join('・') + 'がリーチ', 'live-chip-warn');
    const open = s.players.filter((p) => !p.isSelf && p.melds.length > 0);
    if (open.length > 0) add(open.map((p) => p.labelWithReading).join('・') + 'が副露(フーロ)');
    if (s.doraIndicators.length > 0) add('ドラ表示牌: ' + s.doraIndicators.map((t) => Tiles.shortLabel(t)).join('・'));
    body.appendChild(chips);

    const handBox = el('div', 'live-hand-box');
    handBox.appendChild(el('div', 'live-label', 'あなたの手牌'));
    const row = el('div', 'tile-row live-hand-row');
    s.hand.forEach((t) => {
      const btn = UI.createTileButton(t, { disabled: true });
      btn.classList.add('live-static-tile');
      row.appendChild(btn);
    });
    handBox.appendChild(row);
    body.appendChild(handBox);
  }

  function renderQuestionView(body) {
    const q = state.question;
    body.appendChild(el('p', 'live-prompt', q.prompt));
    if (q.note) body.appendChild(el('p', 'live-note', q.note));
    renderContext(body);
    renderChoices(body);
    if (q.multi) body.appendChild(el('p', 'live-note', '※当てはまるものをすべて選んでください(複数選択)'));
  }

  function detailsBlock(title, open) {
    const d = document.createElement('details');
    d.className = 'live-details';
    d.open = !!open;
    const sum = document.createElement('summary');
    sum.textContent = title;
    d.appendChild(sum);
    return d;
  }

  function renderResultView(body) {
    const g = state.graded;
    const q = state.question;

    const head = el('div', 'live-grade live-grade-' + g.gradeKey);
    head.appendChild(el('span', 'live-grade-mark', g.gradeMark));
    head.appendChild(el('span', 'live-grade-label', g.gradeLabel));
    body.appendChild(head);

    if (g.correctIds.length > 1) {
      body.appendChild(
        el('p', 'live-note', 'この局面では、同じくらい妥当な選択が' + g.correctIds.length + '個あります。1つだけが正解ではありません。')
      );
    }

    renderChoices(body);

    // 理由(軸ごと)
    const axesBox = detailsBlock('理由をくわしく見る', true);
    (g.axes || []).forEach((a) => {
      const row = el('div', 'live-axis');
      row.appendChild(el('span', 'live-axis-label', a.label));
      row.appendChild(el('span', 'live-axis-text', a.text));
      axesBox.appendChild(row);
    });
    body.appendChild(axesBox);

    if (q.kind === 'discard') renderDiscardDetail(body, g);
    else if (q.kind === 'wait') renderWaitDetail(body, g);
    else if (q.kind === 'riichi') renderRiichiDetail(body, g);
    else if (q.kind === 'safety') renderSafetyDetail(body, g);
    else if (q.kind === 'reading') renderReadingDetail(body, g);
    else if (q.kind === 'pushfold') renderPushFoldDetail(body, g.detail);
    else if (q.kind === 'call') renderCallDetail(body, g);
  }

  function renderDiscardDetail(body, g) {
    const box = detailsBlock('打牌候補をくらべる', true);
    const wrap = el('div', 'live-table-wrap');
    const table = el('table', 'live-table');
    const head = document.createElement('tr');
    head.innerHTML = '<th>打牌</th><th>評価</th><th>シャンテン</th><th>受け入れ</th><th>安全度</th>';
    table.appendChild(head);
    g.rows.slice(0, 8).forEach((r) => {
      const tr = document.createElement('tr');
      if (r.isTop) tr.className = 'live-row-top';
      tr.innerHTML =
        '<td>' + r.label + '</td><td>' + LiveQuiz.gradeOf(r.grade).mark + '</td><td>' + r.resultShanten + '</td><td>' +
        r.ukeireTotal + '枚(' + r.ukeireKinds + '種)</td><td>' + (r.safetyCategory || 'ー') + '</td>';
      table.appendChild(tr);
    });
    wrap.appendChild(table);
    box.appendChild(wrap);
    if (g.chosen && g.chosen.ukeireTiles.length > 0) {
      box.appendChild(
        el('div', 'live-note', '選んだ牌を切ったあとの有効牌: ' + g.chosen.ukeireTiles.map((u) => u.label + '(' + u.remaining + '枚)').join('・'))
      );
    }
    if (g.pushfold) renderPushFoldDetail(box, g.pushfold);
    body.appendChild(box);
  }

  function renderWaitDetail(body, g) {
    const d = g.detail;
    const box = detailsBlock('待ちのくわしい内容', true);
    box.appendChild(el('div', 'live-note', '待ち: ' + (d.waits.map((w) => w.label + '(残り' + w.remaining + '枚)').join('・') || 'なし')));
    if (d.shapeLabels.length > 0) box.appendChild(el('div', 'live-note', '待ちの形: ' + d.shapeLabels.join(' / ')));
    box.appendChild(el('div', 'live-note', '見えている牌を除いた残り合計: ' + d.totalRemaining + '枚'));
    box.appendChild(
      el('div', 'live-note', d.furiten ? 'フリテンです。ロンはできず、ツモのみアガれます。' : 'フリテンではありません。ロンもツモもできます。')
    );
    body.appendChild(box);
  }

  function renderRiichiDetail(body, g) {
    const d = g.detail;
    const box = detailsBlock('リーチの条件を確認する', true);
    const rows = [
      ['門前(メンゼン)か', d.isMenzen ? 'はい(鳴いていません)' : 'いいえ(鳴いています)'],
      ['聴牌(テンパイ)しているか', d.canTenpai ? 'はい' : 'いいえ'],
      ['リーチできるか', d.canRiichi ? 'できます' : 'できません'],
      ['フリテン', d.furiten ? 'フリテンです(ロン不可・ツモのみ)' : 'フリテンではありません'],
    ];
    if (d.waits.length > 0) {
      rows.push(['リーチ後の待ち', d.waits.map((w) => w.label + '(残り' + w.remaining + '枚)').join('・')]);
    }
    rows.forEach(([k, v]) => {
      const row = el('div', 'live-axis');
      row.appendChild(el('span', 'live-axis-label', k));
      row.appendChild(el('span', 'live-axis-text', v));
      box.appendChild(row);
    });
    body.appendChild(box);
  }

  function renderSafetyDetail(body, g) {
    const d = g.detail;
    const box = detailsBlock('安全度をくらべる', true);
    box.appendChild(el('div', 'live-note', d.note));
    const wrap = el('div', 'live-table-wrap');
    const table = el('table', 'live-table');
    const head = document.createElement('tr');
    head.innerHTML = '<th>牌</th><th>評価</th>' + d.targets.map((t) => '<th>' + t.label + '</th>').join('');
    table.appendChild(head);
    d.rows.forEach((r) => {
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + r.label + '</td><td>' + r.category + '</td>' + r.perTarget.map((pt) => '<td>' + pt.category + '</td>').join('');
      table.appendChild(tr);
    });
    wrap.appendChild(table);
    box.appendChild(wrap);
    body.appendChild(box);
  }

  function renderReadingDetail(body, g) {
    const box = detailsBlock('河(カワ)・鳴きから読み取れること', true);
    (g.detail.clues || []).forEach((c) => {
      const row = el('div', 'live-clue live-clue-' + c.kind);
      row.appendChild(el('span', 'live-clue-icon', c.kind === 'safe' ? '◯' : c.kind === 'danger' ? '△' : c.kind === 'limit' ? '！' : '・'));
      row.appendChild(el('span', null, c.text));
      box.appendChild(row);
    });
    body.appendChild(box);
  }

  function renderPushFoldDetail(body, pf) {
    if (!pf) return;
    const box = el('div', 'live-pushfold live-pushfold-' + pf.recommendation);
    box.appendChild(el('div', 'live-pushfold-head', '押し引き(オシヒキ)の目安: ' + pf.recommendationLabel));
    box.appendChild(
      el('div', 'live-note', '自信度: ' + { high: '高い', medium: 'ふつう', low: '低い(判断が割れる局面です)' }[pf.confidence])
    );
    (pf.reasons || []).forEach((r) => box.appendChild(el('div', 'live-note', '・' + r)));
    if (pf.positiveFactors && pf.positiveFactors.length > 0) {
      box.appendChild(el('div', 'live-label', '押す材料'));
      pf.positiveFactors.forEach((f) => box.appendChild(el('div', 'live-note', '＋ ' + f.text)));
    }
    if (pf.negativeFactors && pf.negativeFactors.length > 0) {
      box.appendChild(el('div', 'live-label', '慎重にする材料'));
      pf.negativeFactors.forEach((f) => box.appendChild(el('div', 'live-note', '− ' + f.text)));
    }
    if (pf.alternatives && pf.alternatives.length > 0) {
      box.appendChild(el('div', 'live-label', '別の選び方'));
      pf.alternatives.forEach((a) => box.appendChild(el('div', 'live-note', a.label + ': ' + a.note)));
    }
    box.appendChild(el('div', 'live-disclaimer', pf.disclaimer));
    body.appendChild(box);
  }

  function renderCallDetail(body, g) {
    const d = g.detail;
    const box = detailsBlock('鳴いた場合を確認する', true);
    box.appendChild(el('div', 'live-note', d.advice.gradeLabel + ': ' + d.advice.comment));
    box.appendChild(el('div', 'live-note', '鳴く前: ' + d.shantenBefore + 'シャンテン / 鳴いたあと: ' + d.shantenAfter + 'シャンテン'));
    box.appendChild(
      el('div', 'live-note', d.yakuCheck.ok ? '鳴いたあとの役: ' + d.yakuCheck.reason : '鳴いたあとに使える役が見えていません。')
    );
    body.appendChild(box);
  }

  // ==================================================
  // オンデマンドコーチ
  // ==================================================

  function showCoach() {
    const snapshot = currentSnapshot();
    if (!snapshot) return;
    state.view = 'coach';
    state.snapshot = snapshot;
    state.question = null;
    state.graded = null;
    openPanel('今の局面');
    render();
  }

  function renderCoachView(body) {
    const s = state.snapshot;
    const summary = LiveCoach.coachSummary(s);
    renderContext(body);

    const head = el('div', 'live-coach-head');
    head.appendChild(el('span', 'live-grade-mark', summary.isTenpai ? '聴' : String(summary.shanten)));
    head.appendChild(
      el('span', 'live-grade-label', summary.isTenpai ? '聴牌(テンパイ)しています' : summary.shanten + 'シャンテン(シャンテンスウ)です')
    );
    body.appendChild(head);

    summary.summaryLines.forEach((line) => body.appendChild(el('p', 'live-note', line)));

    if (summary.effectiveTiles.length > 0) {
      body.appendChild(el('div', 'live-label', '有効牌(引くと手が進む牌)'));
      body.appendChild(
        el('div', 'live-note', summary.effectiveTiles.map((t) => t.label + '(残り' + t.remaining + '枚)').join('・'))
      );
    }
    if (summary.yakuCandidates.length > 0) {
      body.appendChild(el('div', 'live-label', '狙えそうな役(ヤク)'));
      summary.yakuCandidates.forEach((y) => body.appendChild(el('div', 'live-note', y.name + ': ' + y.note)));
    } else {
      body.appendChild(el('div', 'live-note', '今のところ狙える役は見えていません。門前(メンゼン)ならリーチで役を付けられます。'));
    }

    if (summary.recommendedDiscards.length > 0) {
      body.appendChild(el('div', 'live-label', 'おすすめの打牌候補'));
      const wrap = el('div', 'live-table-wrap');
      const table = el('table', 'live-table');
      const headRow = document.createElement('tr');
      headRow.innerHTML = '<th>打牌</th><th>シャンテン</th><th>受け入れ</th><th>安全度</th>';
      table.appendChild(headRow);
      summary.recommendedDiscards.forEach((r) => {
        const tr = document.createElement('tr');
        tr.innerHTML = '<td>' + r.label + '</td><td>' + r.shanten + '</td><td>' + r.ukeire + '枚</td><td>' + (r.safety || 'ー') + '</td>';
        table.appendChild(tr);
      });
      wrap.appendChild(table);
      body.appendChild(wrap);
    }

    if (summary.riichiTargets.length > 0) {
      body.appendChild(el('div', 'live-label', 'リーチ者への対応'));
      body.appendChild(
        el(
          'div',
          'live-note',
          summary.riichiTargets.map((t) => t.label).join('・') + 'がリーチ中です。' +
            (summary.safeTiles.length > 0
              ? '手の中では' + summary.safeTiles.map((t) => t.label + '(' + t.category + ')').join('・') + 'が比較的安全です。'
              : '')
        )
      );
    }

    renderPushFoldDetail(body, summary.pushfold);
    body.appendChild(el('p', 'live-oneliner', summary.oneLiner));
  }

  // ==================================================
  // 操作ボタン
  // ==================================================

  function renderActions(actions) {
    actions.innerHTML = '';
    const add = (label, onClick, primary) => {
      const btn = el('button', primary ? 'primary' : null, label);
      btn.type = 'button';
      btn.addEventListener('click', onClick);
      actions.appendChild(btn);
      return btn;
    };

    if (state.view === 'question') {
      const answer = add('回答する', submit, true);
      answer.disabled = state.selected.length === 0;
      if (!state.replay) {
        add('今回はスキップ', () => {
          LiveSession.closeCurrent(state.session);
          closePanel();
          state.hooks.rerender();
        });
        add('この局はもう出題しない', skipRound);
      } else {
        add('閉じる', () => closePanel());
      }
      return;
    }

    if (state.view === 'result') {
      const q = state.question;
      if (state.replay) {
        add('閉じる', () => closePanel(), true);
        return;
      }
      if (q.kind === 'discard') {
        const choice = q.choices.find((c) => c.id === state.graded.selectedIds[0]);
        add('この牌(' + choice.label + ')を切る', () => {
          const tile = choice.tile;
          LiveSession.closeCurrent(state.session);
          closePanel();
          state.hooks.performDiscard(tile);
        }, true);
        add('選び直す', () => {
          LiveSession.closeCurrent(state.session);
          closePanel();
          state.hooks.rerender();
        });
      } else if (q.kind === 'call') {
        add('対局に戻って自分で決める', () => {
          LiveSession.closeCurrent(state.session);
          closePanel();
          state.hooks.rerender();
        }, true);
      } else {
        add('対局に戻る', () => {
          LiveSession.closeCurrent(state.session);
          closePanel();
          state.hooks.rerender();
        }, true);
      }
      add('この局はもう出題しない', skipRound);
      return;
    }

    if (state.view === 'coach') {
      add('対局に戻る', () => closePanel(), true);
    }
  }

  function skipRound() {
    LiveSession.skipRestOfRound(state.session);
    closePanel();
    updateCountBadge();
    state.hooks.rerender();
  }

  function render() {
    const body = byId('live-panel-body');
    const actions = byId('live-panel-actions');
    if (!body) return;
    body.innerHTML = '';
    if (state.view === 'question') renderQuestionView(body);
    else if (state.view === 'result') renderResultView(body);
    else if (state.view === 'coach') renderCoachView(body);
    renderActions(actions);
    body.scrollTop = 0;
  }

  // ==================================================
  // 局終了後の振り返り
  // ==================================================

  function renderRoundReview(resultLabel) {
    const panel = byId('live-round-review');
    const body = byId('live-round-review-body');
    if (!panel || !body) return;
    if (!state.session) {
      panel.hidden = true;
      return;
    }
    LiveSession.attachRoundResult(state.session, resultLabel || '');
    const log = LiveSession.roundReview(state.session);
    body.innerHTML = '';
    if (log.length === 0) {
      panel.hidden = state.session.settings.mode === 'off';
      if (!panel.hidden) {
        body.appendChild(el('p', 'live-note', 'この局は学習問題が出ませんでした。次の局で重要な場面があれば出題します。'));
      }
      return;
    }
    panel.hidden = false;

    const counts = { excellent: 0, good: 0, fair: 0, bad: 0 };
    log.forEach((e) => counts[e.gradeKey]++);
    body.appendChild(
      el('p', 'live-note', 'この局の学習: ' + log.length + '問(◎' + counts.excellent + ' ○' + counts.good + ' △' + counts.fair + ' ×' + counts.bad + ')')
    );

    log.forEach((entry) => {
      const item = el('div', 'live-review-item live-grade-' + entry.gradeKey);
      const head = el('div', 'live-review-head');
      head.appendChild(el('span', 'live-review-turn', entry.turn + '巡目'));
      head.appendChild(el('span', 'live-review-title', entry.title));
      head.appendChild(el('span', 'live-grade-mark', entry.gradeMark));
      item.appendChild(head);
      item.appendChild(el('div', 'live-note', entry.prompt));
      item.appendChild(
        el(
          'div',
          'live-note',
          'あなたの回答: ' + (entry.selectedLabels.join('・') || 'なし') +
            ' / 妥当な選択: ' + (entry.recommendedLabels.join('・') || '-') +
            (entry.actualDiscardLabel ? ' / 実際に切った牌: ' + entry.actualDiscardLabel : '')
        )
      );
      const axes = detailsBlock('解説を読む', false);
      (entry.axes || []).forEach((a) => {
        const row = el('div', 'live-axis');
        row.appendChild(el('span', 'live-axis-label', a.label));
        row.appendChild(el('span', 'live-axis-text', a.text));
        axes.appendChild(row);
      });
      item.appendChild(axes);
      if (entry.tags && entry.tags.length > 0) {
        item.appendChild(
          el('div', 'live-tags', entry.tags.map((t) => LiveCoach.TAG_LABELS[t] || t).filter((v, i, a) => a.indexOf(v) === i).join(' / '))
        );
      }
      if (entry.shouldReview) item.appendChild(el('div', 'live-review-flag', '復習候補として保存しました'));

      const again = el('button', null, 'もう一度考える');
      again.type = 'button';
      again.addEventListener('click', () => replayMoment(entry));
      item.appendChild(again);
      body.appendChild(item);
    });
  }

  /** 保存した局面をもう一度出す。対局状態には一切触れない。 */
  function replayMoment(entry) {
    const question = Object.assign({}, entry.question);
    showQuestion(question, entry.snapshot, true);
  }

  // ==================================================
  // 設定UI
  // ==================================================

  function applySettingsToControls() {
    const settings = LiveSession.loadSettings();
    const modeSelect = byId('live-mode-select');
    const maxSelect = byId('live-max-select');
    const inline = byId('live-mode-inline');
    if (modeSelect) modeSelect.value = settings.mode;
    if (inline) inline.value = settings.mode;
    if (maxSelect) maxSelect.value = String(settings.maxPerRound || 3);
    const desc = byId('live-mode-description');
    if (desc) {
      const mode = LiveSession.MODES.find((m) => m.id === settings.mode);
      desc.textContent = mode ? mode.name + ': ' + mode.description + '対局中いつでも変更・一時停止できます。' : '';
    }
    updateCountBadge();
  }

  function updateCountBadge() {
    const badge = byId('live-count-badge');
    if (!badge) return;
    if (!state.session || state.session.settings.mode === 'off') {
      badge.textContent = '';
      return;
    }
    badge.textContent =
      'この局の学習 ' + state.session.count + '/' + state.session.settings.maxPerRound + '問' + (state.session.skipRound ? '(この局は停止中)' : '');
  }

  function changeMode(mode) {
    const settings = LiveSession.setMode(mode);
    if (state.session) {
      state.session.settings = Object.assign({}, settings);
      state.session.skipRound = false;
    }
    applySettingsToControls();
  }

  // ==================================================
  // 対局からの呼び出し口
  // ==================================================

  function setup(hooks) {
    state.hooks = hooks;
    const modeSelect = byId('live-mode-select');
    const maxSelect = byId('live-max-select');
    const inline = byId('live-mode-inline');
    if (modeSelect) modeSelect.addEventListener('change', () => changeMode(modeSelect.value));
    if (inline) inline.addEventListener('change', () => changeMode(inline.value));
    if (maxSelect) {
      maxSelect.addEventListener('change', () => {
        const settings = LiveSession.saveSettings({ maxPerRound: parseInt(maxSelect.value, 10) });
        if (state.session) state.session.settings = Object.assign({}, settings);
        updateCountBadge();
      });
    }
    const coachBtn = byId('live-coach-btn');
    if (coachBtn) coachBtn.addEventListener('click', showCoach);
    const skipBtn = byId('live-skip-round-btn');
    if (skipBtn) skipBtn.addEventListener('click', skipRound);
    const closeBtn = byId('live-panel-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        // 出題中に閉じた場合もスキップ扱いにして、対局を止めたままにしない
        if (state.session && state.session.current) LiveSession.closeCurrent(state.session);
        closePanel();
        state.hooks.rerender();
      });
    }
    const backdrop = byId('live-backdrop');
    // 背後の誤タップを防ぐ(バックドロップは何もしない)
    if (backdrop) backdrop.addEventListener('click', (e) => e.stopPropagation());
    applySettingsToControls();
  }

  function onGameStart() {
    state.session = LiveSession.createSession(LiveSession.loadSettings());
    state.roundCounted = false;
    closePanel();
    applySettingsToControls();
  }

  function onRoundStart(label) {
    if (!state.session) onGameStart();
    LiveSession.startRound(state.session, null, label);
    state.roundCounted = false;
    byId('live-round-review').hidden = true;
    closePanel();
    updateCountBadge();
  }

  function onRoundEnd(resultLabel) {
    if (!state.session) return;
    if (!state.roundCounted && state.session.log.length > 0) {
      LiveSession.countRound();
      state.roundCounted = true;
    }
    closePanel();
    renderRoundReview(resultLabel);
  }

  /** 実際に切った牌を、その局の記録に残す(振り返り用) */
  function noteActualDiscard(tile) {
    if (!state.session) return;
    const label = Tiles.shortLabel(tile);
    state.session.log.forEach((e) => {
      if (e.kind === 'discard' && !e.actualDiscardLabel) e.actualDiscardLabel = label;
    });
  }

  // ==================================================
  // 学習ダッシュボード(クイズ・学習タブ)
  // ==================================================

  /**
   * 実戦学習の成績を表示し、苦手分野から既存コースへ案内する。
   * 実戦は「正解が1つとは限らない」ため、正答率ではなく◎○△×の内訳を主役にする。
   * @param {HTMLElement} container
   * @param {function} startCourse コース開始のコールバック(courseId)
   */
  function renderDashboard(container, startCourse) {
    const data = LiveSession.dashboard();
    const box = el('div', 'live-dashboard');
    box.appendChild(el('h3', 'live-dashboard-title', '実戦学習(対局中の学習)の成績'));

    if (data.asked === 0) {
      box.appendChild(
        el('p', 'live-note', '「対局」タブでプレイモードを「重要局面コーチ」にすると、対局中に学習問題が出ます。ここにその成績がたまります。')
      );
      container.appendChild(box);
      return box;
    }

    const statsRow = el('div', 'quiz-course-stats');
    [
      ['実戦学習した局数', data.rounds + '局'],
      ['出題数', data.asked + '問'],
      ['◎ 非常に妥当', data.grades.excellent + '問'],
      ['○ 十分あり', data.grades.good + '問'],
      ['△ 注意点あり', data.grades.fair + '問'],
      ['× 不利・不可', data.grades.bad + '問'],
    ].forEach(([label, value]) => {
      const cell = el('div', 'quiz-stat-box');
      cell.appendChild(el('div', 'quiz-stat-label', label));
      cell.appendChild(el('div', 'quiz-stat-value', value));
      statsRow.appendChild(cell);
    });
    box.appendChild(statsRow);

    if (data.byTag.length > 0) {
      box.appendChild(el('div', 'live-label', '分野別(◎○の割合)'));
      const wrap = el('div', 'live-table-wrap');
      const table = el('table', 'live-table');
      const head = document.createElement('tr');
      head.innerHTML = '<th>分野</th><th>出題</th><th>◎</th><th>○</th><th>△</th><th>×</th><th>◎○の割合</th>';
      table.appendChild(head);
      data.byTag.forEach((t) => {
        const tr = document.createElement('tr');
        tr.innerHTML =
          '<td>' + t.label + '</td><td>' + t.asked + '</td><td>' + t.excellent + '</td><td>' + t.good + '</td><td>' +
          t.fair + '</td><td>' + t.bad + '</td><td>' + (t.okRate === null ? '-' : t.okRate + '%') + '</td>';
        table.appendChild(tr);
      });
      wrap.appendChild(table);
      box.appendChild(wrap);
    }

    if (data.suggestions.length > 0) {
      box.appendChild(el('div', 'live-label', '次にやるとよい復習'));
      data.suggestions.forEach((sug) => {
        const row = el('div', 'live-suggestion');
        row.appendChild(el('span', null, sug.text));
        if (typeof startCourse === 'function') {
          const btn = el('button', null, '「' + sug.courseName + '」へ');
          btn.type = 'button';
          btn.addEventListener('click', () => startCourse(sug.course));
          row.appendChild(btn);
        }
        box.appendChild(row);
      });
    } else {
      box.appendChild(el('p', 'live-note', 'まだ苦手分野を判定できるほどのデータがありません(1分野3問以上で判定します)。'));
    }

    const candidates = LiveSession.reviewCandidates(10);
    if (candidates.length > 0) {
      const details = detailsBlock('復習候補の局面(' + data.reviewCount + '件保存・最大' + LiveSession.MAX_MOMENTS + '件)', false);
      candidates.forEach((entry) => {
        const item = el('div', 'live-review-item live-grade-' + entry.gradeKey);
        const head = el('div', 'live-review-head');
        head.appendChild(el('span', 'live-review-turn', (entry.roundLabel || '') + ' ' + entry.turn + '巡目'));
        head.appendChild(el('span', 'live-review-title', entry.title));
        head.appendChild(el('span', 'live-grade-mark', entry.gradeMark));
        item.appendChild(head);
        item.appendChild(el('div', 'live-note', 'あなたの回答: ' + (entry.selectedLabels.join('・') || 'なし')));
        const again = el('button', null, 'もう一度考える');
        again.type = 'button';
        again.addEventListener('click', () => replayMoment(entry));
        item.appendChild(again);
        details.appendChild(item);
      });
      box.appendChild(details);
    }

    container.appendChild(box);
    return box;
  }

  const AppLive = {
    setup,
    renderDashboard,
    onGameStart,
    onRoundStart,
    onRoundEnd,
    maybeAsk,
    maybeAskCall,
    isBlocking,
    showCoach,
    noteActualDiscard,
    updateCountBadge,
    renderRoundReview,
    getSession: () => state.session,
  };

  window.MJ = window.MJ || {};
  window.MJ.AppLive = AppLive;
})();
