/**
 * appquiz.js
 * 「クイズ・学習」タブの画面制御(描画専用)。
 *
 * 正誤判定・待ち・フリテン・現物の判定は一切ここで行わない。
 * すべて quizengine.js / quizsession.js の結果を描画するだけにする
 * (画面上の説明文だけでルールを擬似的に処理しないため)。
 */
(function () {
  'use strict';

  const Tiles = window.MJ.Tiles;
  const UI = window.MJ.UI;
  const QuizData = window.MJ.QuizData;
  const QuizEngine = window.MJ.QuizEngine;
  const QuizSession = window.MJ.QuizSession;
  const QuizStats = window.MJ.QuizStats;

  const state = {
    view: 'list', // 'list' | 'question' | 'result'
    session: null,
    selected: [],
    graded: null,
    summary: null,
    recorded: false,
  };

  const WIND_NAMES = { 27: '東(トン)', 28: '南(ナン)', 29: '西(シャー)', 30: '北(ペー)' };

  function el(tag, className, text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  function container() {
    return document.getElementById('quiz-view');
  }

  // ==================================================
  // コース一覧
  // ==================================================

  function renderList(root) {
    const store = QuizStats.load();
    const list = el('div', 'quiz-course-list');

    QuizData.COURSES.forEach((course) => {
      const questions = QuizData.questionsForCourse(course.id);
      const stats = QuizStats.courseStats(course.id, store);
      const rate = QuizStats.accuracy(stats);
      const wrongIds = QuizStats.wrongQuestionIds(course.id, questions.map((q) => q.id), store);

      const card = el('div', 'quiz-course-card');

      const head = el('div', 'quiz-course-head');
      head.appendChild(el('span', 'quiz-course-icon', course.icon));
      head.appendChild(el('strong', 'quiz-course-name', course.name));
      card.appendChild(head);

      card.appendChild(el('p', 'quiz-course-desc', course.description));

      const target = el('p', 'quiz-course-target');
      target.appendChild(el('span', 'quiz-course-target-label', '学習対象'));
      target.appendChild(el('span', null, course.target));
      card.appendChild(target);

      const statsRow = el('div', 'quiz-course-stats');
      [
        ['正解数', String(stats.correct)],
        ['挑戦数', String(stats.attempts) + '回'],
        ['総回答数', String(stats.answered) + '問'],
        ['正答率', rate === null ? '-' : rate + '%'],
        ['前回挑戦', QuizStats.formatDateTime(stats.lastAt)],
      ].forEach(([label, value]) => {
        const box = el('div', 'quiz-stat-box');
        box.appendChild(el('div', 'quiz-stat-label', label));
        box.appendChild(el('div', 'quiz-stat-value', value));
        statsRow.appendChild(box);
      });
      card.appendChild(statsRow);

      const actions = el('div', 'quiz-course-actions');
      const startBtn = el('button', 'primary', '挑戦する(全' + questions.length + '問から10問)');
      startBtn.addEventListener('click', () => startSession(course.id, null));
      actions.appendChild(startBtn);

      if (wrongIds.length > 0) {
        const reviewBtn = el('button', null, '間違えた問題だけ復習(' + wrongIds.length + '問)');
        reviewBtn.addEventListener('click', () => startSession(course.id, wrongIds));
        actions.appendChild(reviewBtn);
      }
      card.appendChild(actions);

      list.appendChild(card);
    });

    root.appendChild(list);

    const footer = el('div', 'quiz-list-footer');
    const resetBtn = el('button', null, 'クイズの成績だけリセット');
    resetBtn.addEventListener('click', () => {
      if (window.confirm('クイズ・学習の成績のみを消します(対局・復習帳・牌譜のデータは残ります)。よろしいですか。')) {
        QuizStats.resetAll();
        render();
      }
    });
    footer.appendChild(resetBtn);
    root.appendChild(footer);
  }

  // ==================================================
  // 盤面(手牌・河・場風など)の描画
  // ==================================================

  function renderTileRow(parent, tiles, highlightSet) {
    const row = el('div', 'tile-row quiz-tile-row');
    tiles.forEach((tileIdx) => {
      const btn = UI.createTileButton(tileIdx, { disabled: true });
      btn.classList.add('quiz-static-tile');
      if (highlightSet && highlightSet.has(tileIdx)) btn.classList.add('quiz-highlight');
      row.appendChild(btn);
    });
    parent.appendChild(row);
  }

  function renderFuuro(parent, fuuro) {
    if (!fuuro || fuuro.length === 0) return;
    const block = el('div', 'quiz-board-block');
    block.appendChild(el('div', 'quiz-board-label', '副露(フーロ) ※鳴いた面子'));
    const row = el('div', 'quiz-fuuro-row');
    fuuro.forEach((meld) => {
      const group = el('div', 'quiz-fuuro-group');
      const typeLabel = { pon: 'ポン', chi: 'チー', minkan: '明槓', ankan: '暗槓' }[meld.type] || meld.type;
      meld.tiles.forEach((tileIdx) => group.appendChild(UI.createMiniTile(tileIdx, { called: true })));
      group.appendChild(el('span', 'quiz-fuuro-type', typeLabel));
      row.appendChild(group);
    });
    block.appendChild(row);
    parent.appendChild(block);
  }

  function renderRivers(parent, board) {
    const withDiscards = board.players.filter((p) => p.discards.length > 0);
    if (withDiscards.length === 0) return;
    const block = el('div', 'quiz-board-block');
    block.appendChild(el('div', 'quiz-board-label', '河(カワ) ※捨て牌'));
    withDiscards.forEach((p) => {
      const pileBox = el('div', 'discard-pile-box quiz-river');
      const label = p.label + (p.riichi ? '(立直(リーチ)中)' : '') + (p.seat === board.targetSeat ? ' ← この人に対して考えます' : '');
      const labelEl = el('div', 'discard-pile-label', label);
      if (p.riichi) labelEl.classList.add('quiz-river-riichi');
      pileBox.appendChild(labelEl);
      const tilesRow = el('div', 'discard-pile-tiles');
      p.discards.forEach((d, i) => {
        const mini = UI.createMiniTile(d.tile, { isRiichiTile: p.riichiIndex === i });
        if (p.riichiIndex === i) mini.title = '立直(リーチ)宣言牌';
        tilesRow.appendChild(mini);
      });
      pileBox.appendChild(tilesRow);
      block.appendChild(pileBox);
    });
    parent.appendChild(block);
  }

  function renderSituation(parent, question, board) {
    const chips = el('div', 'quiz-chips');
    const add = (text, cls) => chips.appendChild(el('span', 'quiz-chip' + (cls ? ' ' + cls : ''), text));

    if (question.course === 'yaku' || question.course === 'furiten') {
      add('場風(バカゼ): ' + (WIND_NAMES[board.roundWind] || '-'));
      add('自風(ジカゼ): ' + (WIND_NAMES[board.seatWind] || '-'));
      if (board.winTile !== undefined && board.winTile !== null) {
        add((board.isTsumo ? 'ツモ' : 'ロン') + ': ' + Tiles.shortLabel(board.winTile), 'quiz-chip-strong');
      }
      add(board.fuuro.length > 0 ? '副露あり(門前ではない)' : '門前(メンゼン)');
      if (board.isRiichi) add('立直(リーチ)宣言済み', 'quiz-chip-riichi');
      if (board.furitenTemporary) add('この巡で見逃しあり(同巡内フリテン)', 'quiz-chip-warn');
      if (board.furitenRiichi) add('リーチ後に見逃しあり', 'quiz-chip-warn');
    }
    if (board.doraIndicators && board.doraIndicators.length > 0) {
      add('ドラ表示牌: ' + board.doraIndicators.map((t) => Tiles.shortLabel(t)).join('・'));
    }
    if (chips.childNodes.length > 0) parent.appendChild(chips);
  }

  function renderBoard(parent, question, board, highlightSet) {
    const box = el('div', 'quiz-board');

    renderSituation(box, question, board);

    const handBlock = el('div', 'quiz-board-block');
    const handLabel = question.course === 'wait' ? '手牌(13枚)' : '手牌';
    handBlock.appendChild(el('div', 'quiz-board-label', handLabel));
    renderTileRow(handBlock, board.hand, highlightSet);
    box.appendChild(handBlock);

    if (board.winTile !== undefined && board.winTile !== null) {
      const winBlock = el('div', 'quiz-board-block');
      winBlock.appendChild(el('div', 'quiz-board-label', board.isTsumo ? 'ツモ牌' : 'ロン牌(相手が捨てた牌)'));
      const row = el('div', 'tile-row quiz-tile-row');
      const btn = UI.createTileButton(board.winTile, { disabled: true });
      btn.classList.add('quiz-static-tile', 'quiz-win-tile');
      row.appendChild(btn);
      winBlock.appendChild(row);
      box.appendChild(winBlock);
    }

    renderFuuro(box, board.fuuro);
    renderRivers(box, board);

    parent.appendChild(box);
  }

  // ==================================================
  // 選択肢
  // ==================================================

  function isSelected(choiceId) {
    return state.selected.indexOf(choiceId) !== -1;
  }

  function toggleChoice(question, choiceId) {
    if (state.graded) return;
    if (question.multi) {
      const i = state.selected.indexOf(choiceId);
      if (i === -1) state.selected.push(choiceId);
      else state.selected.splice(i, 1);
    } else {
      state.selected = isSelected(choiceId) ? [] : [choiceId];
    }
    render();
  }

  function choiceStatusClass(choiceId) {
    if (!state.graded) return '';
    const isCorrectChoice = state.graded.correctIds.indexOf(choiceId) !== -1;
    const picked = state.graded.selectedIds.indexOf(choiceId) !== -1;
    if (isCorrectChoice) return ' quiz-choice-correct';
    if (picked) return ' quiz-choice-wrong';
    return '';
  }

  function choiceMark(choiceId) {
    if (!state.graded) return '';
    const isCorrectChoice = state.graded.correctIds.indexOf(choiceId) !== -1;
    const picked = state.graded.selectedIds.indexOf(choiceId) !== -1;
    if (isCorrectChoice) return picked ? '○ 正解(選んだ)' : '○ 正解(選べていない)';
    if (picked) return '× 不正解(選んだ)';
    return '';
  }

  function renderChoices(parent, question) {
    const isTileChoice = question.choices.some((c) => c.tile !== undefined && c.tile !== null);
    const box = el('div', isTileChoice ? 'quiz-choices quiz-choices-tile' : 'quiz-choices');

    question.choices.forEach((choice) => {
      const wrapper = el('div', 'quiz-choice' + (isSelected(choice.id) ? ' quiz-choice-selected' : '') + choiceStatusClass(choice.id));

      if (isTileChoice) {
        const btn = UI.createTileButton(choice.tile, { disabled: !!state.graded, onClick: () => toggleChoice(question, choice.id) });
        btn.classList.add('quiz-choice-tile');
        wrapper.appendChild(btn);
        if (choice.aka) wrapper.appendChild(el('div', 'quiz-choice-aka', '赤5'));
      } else {
        const btn = el('button', 'quiz-choice-btn', choice.label);
        btn.type = 'button';
        btn.disabled = !!state.graded;
        btn.addEventListener('click', () => toggleChoice(question, choice.id));
        wrapper.appendChild(btn);
      }

      const mark = choiceMark(choice.id);
      if (mark) wrapper.appendChild(el('div', 'quiz-choice-mark', mark));
      box.appendChild(wrapper);
    });

    parent.appendChild(box);
  }

  // ==================================================
  // 解説(コースごと)
  // ==================================================

  function line(parent, label, value) {
    const row = el('div', 'quiz-detail-row');
    row.appendChild(el('span', 'quiz-detail-label', label));
    row.appendChild(el('span', 'quiz-detail-value', value));
    parent.appendChild(row);
  }

  function yesNo(flag) {
    return flag ? 'できる' : 'できない';
  }

  function renderYakuDetail(parent, question, board) {
    const analysis = QuizEngine.analyzeYaku(board);
    const detail = el('div', 'quiz-detail');

    if (!analysis.hasYaku) {
      line(detail, '成立役', 'なし(役が1つも無いためアガれません)');
    } else {
      analysis.yakuList.forEach((y) => {
        const meta = QuizEngine.metaForYakuKey(y.key);
        const name = QuizEngine.yakuDisplayName(y.key, y.name);
        let text = name + ' ' + y.han + '翻(ハン)';
        if (meta) {
          if (meta.naki === 'menzen-only') text += ' / 門前(メンゼン)限定・鳴くと不成立';
          else if (meta.naki === 'kuisagari') text += ' / 鳴くと1翻下がる(食い下がり)';
          else text += ' / 鳴いても成立する';
        }
        if (y.key === 'dora' || y.key === 'aka_dora') text += ' ※ドラは役ではありません';
        line(detail, '成立役', text);
        if (y.explanation) detail.appendChild(el('div', 'quiz-detail-sub', y.explanation));
      });
      line(detail, '合計', analysis.han + '翻(ハン)' + (analysis.fu ? ' / ' + analysis.fu + '符(フ)' : ''));
    }
    line(detail, '門前(メンゼン)か', analysis.isMenzen ? '門前(鳴いていない)' : '鳴いているため門前ではない');

    // 選ばなかった/選んではいけなかった役の理由
    const wrongChoices = question.choices.filter((c) => state.graded.correctIds.indexOf(c.id) === -1 && c.value && typeof c.value === 'string');
    if (question.resolver === 'yakuKeys' && wrongChoices.length > 0) {
      const box = el('div', 'quiz-detail-sub');
      box.textContent =
        '成立しない選択肢: ' +
        wrongChoices
          .map((c) => {
            const meta = QuizEngine.metaForYakuKey(c.value);
            let why = 'この手牌の形では条件を満たしていません';
            if (meta && meta.naki === 'menzen-only' && !analysis.isMenzen) why = '門前(メンゼン)限定の役で、鳴いているため成立しません';
            else if (c.value === 'menzen_tsumo' && !board.isTsumo) why = 'ツモでアガったときの役なので、ロンでは成立しません';
            else if (c.value === 'riichi' && !board.isRiichi) why = '立直(リーチ)を宣言していないため成立しません';
            return (c.label || c.value) + '…' + why;
          })
          .join(' / ');
      detail.appendChild(box);
    }

    parent.appendChild(detail);
  }

  function renderWaitDetail(parent, question, board) {
    const waits = QuizEngine.analyzeWaits(board);
    const detail = el('div', 'quiz-detail');

    line(detail, '待ち牌', waits.tiles.map((t) => t.label).join('・') + '(' + waits.kinds + '種類)');
    if (waits.shapeLabel) line(detail, '待ちの形', waits.shapeLabel);

    waits.tiles.forEach((t) => {
      const parts = t.blocks
        .map((b) => b.map((x) => Tiles.shortLabel(x)).join(''))
        .filter((v, i, arr) => arr.indexOf(v) === i)
        .join(' / ');
      line(
        detail,
        t.label + 'で完成',
        (parts ? parts + ' が完成' : '和了形が完成') +
          ' ・ ' + (t.waitLabels.length ? t.waitLabels.join('/') : '') +
          ' ・ 残り' + t.remaining + '枚'
      );
    });
    line(detail, '最大で何枚待ちか', waits.totalRemaining + '枚(牌は各4枚。画面に見えている牌を引いた数)');

    // 各待ち牌でロンした場合の役・フリテンも示す(形としての待ちとの違いを理解するため)
    waits.tiles.forEach((t) => {
      const boardWithWin = QuizEngine.normalizeBoard(Object.assign({}, question.board, { winTile: t.tile, isTsumo: false }));
      const f = QuizEngine.analyzeFuriten(boardWithWin);
      const yakuText = f.ronYaku.hasYaku
        ? f.ronYaku.yakuList.map((y) => QuizEngine.yakuDisplayName(y.key, y.name)).join('・')
        : 'なし';
      line(
        detail,
        t.label + 'でアガれるか',
        '役: ' + yakuText +
          ' ・ 振聴(フリテン): ' + (f.isFuriten ? 'あり' : 'なし') +
          ' ・ ロン: ' + yesNo(f.canRon) +
          ' ・ ツモ: ' + yesNo(f.canTsumo)
      );
    });

    detail.appendChild(
      el(
        'div',
        'quiz-detail-sub',
        'ここでの「待ち牌」は、形として和了(ホーラ)が完成する牌のことです。役が無かったり振聴(フリテン)だったりすると、待ち牌でもロンできない点は別問題として区別して覚えましょう。'
      )
    );
    parent.appendChild(detail);
  }

  function renderFuritenDetail(parent, question, board) {
    const f = QuizEngine.analyzeFuriten(board);
    const detail = el('div', 'quiz-detail');

    line(detail, '手牌のすべての待ち', f.waitTiles.map((t) => Tiles.shortLabel(t)).join('・') || 'なし');
    line(
      detail,
      'フリテンの原因牌',
      f.blockingOwnDiscards && f.blockingOwnDiscards.length > 0
        ? f.blockingOwnDiscards.map((t) => Tiles.shortLabel(t)).join('・') + '(自分の河にある待ち牌)'
        : f.furitenType === 'temporary'
        ? 'この巡での見逃し(同巡内フリテン)'
        : f.furitenType === 'riichi'
        ? '立直(リーチ)後の見逃し(この局はずっとフリテン)'
        : 'なし'
    );
    line(detail, '自分の河(カワ)', (board.ownDiscards || []).map((t) => Tiles.shortLabel(t)).join('・') || 'なし');
    line(detail, 'ロンできるか', yesNo(f.canRon));
    line(detail, 'ツモできるか', yesNo(f.canTsumo));
    line(
      detail,
      '役の有無',
      f.ronYaku.hasYaku
        ? 'あり(' + f.ronYaku.yakuList.map((y) => QuizEngine.yakuDisplayName(y.key, y.name)).join('・') + ')'
        : 'なし'
    );
    line(detail, 'ロンできない理由', f.canRon ? '(ロンできます)' : f.reasonText);

    parent.appendChild(detail);
  }

  function renderGenbutsuDetail(parent, question, board) {
    const result = QuizEngine.analyzeGenbutsu(board, question.candidates || []);
    const detail = el('div', 'quiz-detail');

    line(detail, '判定の対象', result.targetLabel + 'に対する現物(ゲンブツ)');
    result.candidates.forEach((c) => {
      const label = c.label + (c.aka ? '(赤5)' : '');
      if (c.isGenbutsu) {
        const src = c.matchedFrom ? c.matchedFrom.text : result.targetLabel + 'の河にある牌と同じです。';
        let text = '現物(ロンされない) ・ ' + src;
        if (result.otherRiichiLabels.length > 0) {
          text +=
            c.dangerAgainst.length > 0
              ? ' ただし' + c.dangerAgainst.join('・') + 'に対しては現物ではないので、安全とは限りません。'
              : ' ' + c.alsoSafeAgainst.join('・') + 'に対しても現物です。';
        } else {
          text += ' 安全なのは' + result.targetLabel + 'に対してだけで、他家に対しては安全とは限りません。';
        }
        line(detail, label, text);
      } else {
        line(detail, label, '現物ではない ・ ' + result.targetLabel + 'の河には無く、リーチ後に通ってもいないため、ロンされる可能性があります。');
      }
    });
    detail.appendChild(
      el(
        'div',
        'quiz-detail-sub',
        '現物が安全な理由は振聴(フリテン)のルールです。自分が捨てた牌・見逃した牌ではロンできないため、その人からは絶対に当たりません。' +
          'なお赤5と通常の5は、安全かどうかの判断では同じ牌として扱います。'
      )
    );
    parent.appendChild(detail);
  }

  function renderFeedback(parent, question, board) {
    const graded = state.graded;
    const box = el('div', 'quiz-feedback ' + (graded.correct ? 'quiz-feedback-correct' : 'quiz-feedback-wrong'));

    const head = el('div', 'quiz-feedback-head');
    head.appendChild(el('span', 'quiz-feedback-mark', graded.correct ? '○' : '×'));
    head.appendChild(el('strong', null, graded.correct ? '正解' : '不正解'));
    box.appendChild(head);

    if (!graded.correct) {
      const correctLabels = question.choices
        .filter((c) => graded.correctIds.indexOf(c.id) !== -1)
        .map((c) => c.label || Tiles.shortLabel(c.tile));
      box.appendChild(el('div', 'quiz-feedback-answer', '正解: ' + correctLabels.join('・')));
    }

    box.appendChild(el('p', 'quiz-explanation', question.explanation));

    if (question.course === 'yaku') renderYakuDetail(box, question, board);
    else if (question.course === 'wait') renderWaitDetail(box, question, board);
    else if (question.course === 'furiten') renderFuritenDetail(box, question, board);
    else if (question.course === 'genbutsu') renderGenbutsuDetail(box, question, board);

    parent.appendChild(box);
  }

  // ==================================================
  // 出題画面
  // ==================================================

  function highlightSetFor(question, board) {
    if (!state.graded) return null;
    const tiles = (question.highlight || []).slice();
    if (question.course === 'wait' || question.course === 'genbutsu') {
      question.choices.forEach((c) => {
        if (state.graded.correctIds.indexOf(c.id) !== -1 && c.tile !== undefined) tiles.push(c.tile);
      });
    }
    if (question.course === 'furiten') {
      const f = QuizEngine.analyzeFuriten(board);
      (f.blockingOwnDiscards || []).forEach((t) => tiles.push(t));
    }
    return new Set(tiles);
  }

  function renderQuestion(root) {
    const session = state.session;
    const question = QuizSession.currentQuestion(session);
    if (!question) {
      showResult();
      return;
    }
    const board = QuizEngine.normalizeBoard(question.board);
    const course = QuizData.getCourse(session.courseId);

    const header = el('div', 'quiz-runner-header');
    header.appendChild(el('span', 'quiz-runner-course', course.name + (session.mode === 'review' ? '(復習)' : '')));
    header.appendChild(el('span', 'quiz-runner-progress', '第' + (session.index + 1) + '問 / 全' + session.questions.length + '問'));
    root.appendChild(header);

    const promptBox = el('div', 'quiz-prompt');
    promptBox.appendChild(el('p', null, question.prompt));
    if (question.multi) promptBox.appendChild(el('p', 'quiz-prompt-note', '※当てはまるものをすべて選んでください(複数選択)'));
    root.appendChild(promptBox);

    renderBoard(root, question, board, highlightSetFor(question, board));
    renderChoices(root, question);

    const actions = el('div', 'quiz-actions');
    if (!state.graded) {
      const answerBtn = el('button', 'primary', '回答する');
      answerBtn.disabled = state.selected.length === 0;
      answerBtn.addEventListener('click', submitAnswer);
      actions.appendChild(answerBtn);
      const quitBtn = el('button', null, 'コース選択へ戻る');
      quitBtn.addEventListener('click', backToList);
      actions.appendChild(quitBtn);
    }
    root.appendChild(actions);

    if (state.graded) {
      renderFeedback(root, question, board);
      const nextActions = el('div', 'quiz-actions');
      const isLast = session.index + 1 >= session.questions.length;
      const nextBtn = el('button', 'primary', isLast ? '結果を見る' : '次の問題へ');
      nextBtn.addEventListener('click', goNext);
      nextActions.appendChild(nextBtn);
      root.appendChild(nextActions);
    }
  }

  // ==================================================
  // 結果画面
  // ==================================================

  function renderResult(root) {
    const summary = state.summary;
    const course = QuizData.getCourse(state.session.courseId);

    root.appendChild(el('h3', 'quiz-result-title', course.name + ' の結果'));

    const scoreBox = el('div', 'quiz-result-score');
    scoreBox.appendChild(el('div', 'quiz-result-main', summary.correct + ' / ' + summary.total + ' 問正解'));
    scoreBox.appendChild(el('div', 'quiz-result-rate', '正答率 ' + summary.rate + '%'));
    root.appendChild(scoreBox);

    if (summary.wrongTags.length > 0) {
      const tagBox = el('div', 'quiz-result-tags');
      tagBox.appendChild(el('div', 'quiz-board-label', '間違えた問題の学習タグ'));
      const list = el('div', 'quiz-tag-list');
      summary.wrongTags.forEach((t) => list.appendChild(el('span', 'quiz-tag', t.label + '(' + t.count + '問)')));
      tagBox.appendChild(list);
      root.appendChild(tagBox);
    }

    root.appendChild(el('p', 'quiz-result-comment', summary.comment));

    const actions = el('div', 'quiz-actions');
    if (summary.wrongQuestionIds.length > 0) {
      const reviewBtn = el('button', 'primary', '間違えた' + summary.wrongQuestionIds.length + '問だけ復習する');
      reviewBtn.addEventListener('click', () => startSession(state.session.courseId, summary.wrongQuestionIds));
      actions.appendChild(reviewBtn);
    }
    const againBtn = el('button', summary.wrongQuestionIds.length > 0 ? '' : 'primary', 'もう一度挑戦する');
    againBtn.addEventListener('click', () => startSession(state.session.courseId, null));
    actions.appendChild(againBtn);
    const backBtn = el('button', null, 'コース選択へ戻る');
    backBtn.addEventListener('click', backToList);
    actions.appendChild(backBtn);
    root.appendChild(actions);
  }

  // ==================================================
  // 操作
  // ==================================================

  function startSession(courseId, questionIds) {
    state.session = QuizSession.createSession(courseId, questionIds ? { questionIds } : {});
    state.selected = [];
    state.graded = null;
    state.summary = null;
    state.recorded = false;
    state.view = 'question';
    render();
  }

  function submitAnswer() {
    if (state.selected.length === 0) return;
    state.graded = QuizSession.answerCurrent(state.session, state.selected);
    render();
  }

  function goNext() {
    const wasLast = state.session.index + 1 >= state.session.questions.length;
    QuizSession.goNext(state.session);
    state.selected = [];
    state.graded = null;
    if (wasLast) showResult();
    else render();
  }

  function showResult() {
    state.summary = QuizSession.summarize(state.session);
    if (!state.recorded) {
      QuizStats.recordAttempt(
        state.session.courseId,
        state.summary.results.map((r) => ({ questionId: r.questionId, correct: r.correct, tags: r.tags }))
      );
      state.recorded = true;
    }
    state.view = 'result';
    render();
  }

  function backToList() {
    state.view = 'list';
    state.session = null;
    state.selected = [];
    state.graded = null;
    render();
  }

  // ==================================================
  // 全体描画
  // ==================================================

  function render() {
    const root = container();
    if (!root) return;
    root.innerHTML = '';
    if (state.view === 'question' && state.session) renderQuestion(root);
    else if (state.view === 'result' && state.summary) renderResult(root);
    else renderList(root);
  }

  function init() {
    render();
  }

  document.addEventListener('DOMContentLoaded', init);

  window.MJ = window.MJ || {};
  window.MJ.AppQuiz = { init, render, startSession };
})();
