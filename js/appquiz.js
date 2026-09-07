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
  const Reading = window.MJ.Reading;

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

    // 実戦学習(対局中の学習)の成績。弱点から既存コースへ移動できるようにする。
    if (window.MJ.AppLive && window.MJ.AppLive.renderDashboard) {
      window.MJ.AppLive.renderDashboard(root, (courseId) => startSession(courseId));
    }

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

      if (course.note) card.appendChild(el('p', 'quiz-course-note', course.note));

      if (course.difficulties && course.difficulties.length > 0) {
        card.appendChild(renderDifficultySection(course, questions, store));
      }

      const actions = el('div', 'quiz-course-actions');
      const allLabel = course.difficulties
        ? 'すべての難易度から10問'
        : '挑戦する(全' + questions.length + '問から10問)';
      const startBtn = el('button', 'primary', allLabel);
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

  /**
   * 難易度ごとの説明・成績・開始ボタン(守備判断クイズなど、段階的に学ぶコース用)。
   * 「おすすめ」は初級に付け、いきなり実戦へ入らないようにする。
   */
  function renderDifficultySection(course, questions, store) {
    const box = el('div', 'quiz-difficulty-list');
    const diffStats = QuizStats.difficultyStats(course.id, course.difficulties.map((d) => d.id), store);

    course.difficulties.forEach((d) => {
      const count = questions.filter((q) => q.difficulty === d.id).length;
      const row = el('div', 'quiz-difficulty-row');

      const head = el('div', 'quiz-difficulty-head');
      head.appendChild(el('strong', null, d.name));
      if (d.recommended) head.appendChild(el('span', 'quiz-recommend-badge', 'おすすめ'));
      head.appendChild(el('span', 'quiz-difficulty-count', '全' + count + '問'));
      const st = diffStats[d.id];
      if (st && st.answered > 0) {
        head.appendChild(el('span', 'quiz-difficulty-score', '正答率' + st.rate + '%(' + st.correct + '/' + st.answered + ')'));
      }
      row.appendChild(head);
      row.appendChild(el('div', 'quiz-difficulty-desc', d.description));

      const btn = el('button', d.recommended ? 'primary' : null, d.name + 'に挑戦する');
      btn.addEventListener('click', () => startSession(course.id, null, d.id));
      row.appendChild(btn);
      box.appendChild(row);
    });
    return box;
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

  function renderRivers(parent, board, highlightSet) {
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
      // 相手の副露(鳴いた面子)は全員に見えている情報なので、河と一緒に表示する
      if (p.melds && p.melds.length > 0) {
        const meldRow = el('div', 'quiz-opponent-melds');
        meldRow.appendChild(el('span', 'quiz-opponent-melds-label', '副露(フーロ)'));
        p.melds.forEach((meld) => {
          const group = el('span', 'quiz-fuuro-group');
          meld.tiles.forEach((tileIdx) => group.appendChild(UI.createMiniTile(tileIdx, { called: true })));
          const typeLabel = { pon: 'ポン', chi: 'チー', minkan: '明槓', ankan: '暗槓' }[meld.type] || meld.type;
          group.appendChild(el('span', 'quiz-fuuro-type', typeLabel));
          meldRow.appendChild(group);
        });
        pileBox.appendChild(meldRow);
      }
      const tilesRow = el('div', 'discard-pile-tiles');
      p.discards.forEach((d, i) => {
        const mini = UI.createMiniTile(d.tile, { isRiichiTile: p.riichiIndex === i });
        if (p.riichiIndex === i) mini.title = '立直(リーチ)宣言牌';
        // 判断の根拠になった牌(現物の元・筋の元など)は河の中でも強調する
        if (highlightSet && highlightSet.has(d.tile)) mini.classList.add('quiz-highlight-mini');
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

    if (question.course === 'yaku' || question.course === 'furiten' || question.course === 'defense') {
      add('場風(バカゼ): ' + (WIND_NAMES[board.roundWind] || '-'));
      add('自風(ジカゼ): ' + (WIND_NAMES[board.seatWind] || '-'));
      if (board.winTile !== undefined && board.winTile !== null) {
        add((board.isTsumo ? 'ツモ' : 'ロン') + ': ' + Tiles.shortLabel(board.winTile), 'quiz-chip-strong');
      }
      if (question.course !== 'defense') {
        add(board.fuuro.length > 0 ? '副露あり(門前ではない)' : '門前(メンゼン)');
      }
      if (board.isRiichi) add('立直(リーチ)宣言済み', 'quiz-chip-riichi');
      if (board.furitenTemporary) add('この巡で見逃しあり(同巡内フリテン)', 'quiz-chip-warn');
      if (board.furitenRiichi) add('リーチ後に見逃しあり', 'quiz-chip-warn');
    }
    if (question.course === 'reading') {
      add('場風(バカゼ): ' + (WIND_NAMES[board.roundWind] || '-'));
      add('自風(ジカゼ): ' + (WIND_NAMES[board.seatWind] || '-'));
      if (board.turn) add(board.turn + '巡目');
      const target = board.players.find((p) => p.seat === board.targetSeat);
      if (target) add('読む相手: ' + target.label + (target.riichi ? '(立直(リーチ)中)' : ''), 'quiz-chip-strong');
    }
    if (board.doraIndicators && board.doraIndicators.length > 0) {
      add('ドラ表示牌: ' + board.doraIndicators.map((t) => Tiles.shortLabel(t)).join('・'));
    }
    if (chips.childNodes.length > 0) parent.appendChild(chips);
  }

  /** 公開する手牌が誰のものか(2人リーチでは読む相手と違うことがある) */
  function hiddenOwnerLabel(question, board) {
    const seat = question.hidden && question.hidden.seat !== undefined ? question.hidden.seat : board.targetSeat;
    const player = board.players.find((p) => p.seat === seat);
    return player ? player.label : '相手';
  }

  /**
   * 「今回読む相手」を明示する。2人リーチのように読む対象を取り違えやすい局面では、
   * 推理評価・現物や筋の判定・公開する手牌・待ち的中が誰に対するものかを1つずつ書き出す。
   */
  function renderReadingFocus(parent, question) {
    const focus = QuizEngine.readingFocus(question);
    const box = el('div', 'quiz-focus' + (focus.multiRiichi ? ' quiz-focus-strong' : ''));
    box.appendChild(el('div', 'quiz-focus-head', focus.headline));
    if (focus.multiRiichi) {
      focus.lines.forEach((line) => box.appendChild(el('div', 'quiz-focus-line', '・' + line)));
    }
    parent.appendChild(box);
  }

  /** 相手の手牌は回答前には伏せておく(裏向きの牌だけを見せる) */
  function renderConcealedOpponentHand(parent, question, board) {
    const target = board.players.find((p) => p.seat === board.targetSeat);
    const meldCount = target && target.melds ? target.melds.length : 0;
    const block = el('div', 'quiz-board-block');
    block.appendChild(el('div', 'quiz-board-label', (target ? target.label : '相手') + 'の手牌(伏せています)'));
    const row = el('div', 'quiz-back-row');
    for (let i = 0; i < 13 - meldCount * 3; i++) row.appendChild(el('div', 'quiz-back-tile', '?'));
    block.appendChild(row);
    block.appendChild(
      el('div', 'quiz-detail-sub', '相手の手牌は回答後に公開されます。ここまでの情報(河・鳴き・ドラ)だけで考えてください。')
    );
    parent.appendChild(block);
  }

  function renderBoard(parent, question, board, highlightSet) {
    const box = el('div', 'quiz-board');

    renderSituation(box, question, board);

    if (question.course === 'reading' && board.describe) {
      box.appendChild(el('p', 'quiz-scene-describe', board.describe));
    }

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
    if (question.course === 'reading') renderConcealedOpponentHand(box, question, board);
    renderRivers(box, board, highlightSet);

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
    if (question.mode === 'reading') {
      // 待ち読みは「最大N種類」まで。上限を超えるタップは無視する。
      const i = state.selected.indexOf(choiceId);
      if (i !== -1) state.selected.splice(i, 1);
      else if (state.selected.length < (question.selectCount || 3)) state.selected.push(choiceId);
    } else if (question.mode === 'order') {
      // 並べ替えはタップした順番がそのまま回答になる。もう一度タップすると取り消す。
      const i = state.selected.indexOf(choiceId);
      if (i === -1) state.selected.push(choiceId);
      else state.selected.splice(i, 1);
    } else if (question.multi) {
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
    if (state.graded.mode === 'order') return state.graded.correct ? ' quiz-choice-correct' : ' quiz-choice-wrong';
    const isCorrectChoice = state.graded.correctIds.indexOf(choiceId) !== -1;
    const picked = state.graded.selectedIds.indexOf(choiceId) !== -1;
    if (isCorrectChoice) return ' quiz-choice-correct';
    if (picked) return ' quiz-choice-wrong';
    return '';
  }

  function choiceMark(choiceId) {
    if (!state.graded) return '';
    if (state.graded.mode === 'order') {
      const pos = state.graded.selectedIds.indexOf(choiceId);
      return pos === -1 ? '' : String(pos + 1) + '番目に選択';
    }
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

      if (question.mode === 'order') {
        const pos = state.selected.indexOf(choice.id);
        const badge = el('div', 'quiz-order-badge', pos === -1 ? '-' : String(pos + 1) + '番目');
        if (pos !== -1) badge.classList.add('quiz-order-badge-on');
        wrapper.appendChild(badge);
      }

      const mark = choiceMark(choice.id);
      if (mark) wrapper.appendChild(el('div', 'quiz-choice-mark', mark));
      box.appendChild(wrapper);
    });

    parent.appendChild(box);

    if (question.mode === 'order') {
      const hint = el('div', 'quiz-order-hint');
      hint.textContent =
        state.selected.length === 0
          ? '安全と思う牌から順にタップしてください(ドラッグは不要です)。'
          : '選んだ順: ' +
            state.selected
              .map((id) => {
                const c = question.choices.find((x) => x.id === id);
                return Tiles.shortLabel(c.tile);
              })
              .join(' → ');
      parent.appendChild(hint);

      if (state.selected.length > 0 && !state.graded) {
        const clear = el('button', 'quiz-order-clear', '選び直す');
        clear.addEventListener('click', () => {
          state.selected = [];
          render();
        });
        parent.appendChild(clear);
      }
    }
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
    if (waits.shapeSummary) line(detail, '待ちの形', waits.shapeSummary);

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

  /**
   * 守備判断クイズの解説。候補牌ごとに、安全度ランクと根拠(安全材料・危険材料)を並べる。
   * 判定は defense.js が計算したものをそのまま表示するだけ(ここでルールを再実装しない)。
   */
  function renderDefenseDetail(parent, question, board) {
    const result = QuizEngine.analyzeDefense(board, question.candidates || []);
    const detail = el('div', 'quiz-detail quiz-defense-detail');

    detail.appendChild(
      el('div', 'quiz-detail-sub', result.targetLabel + 'に対する評価です。同じ牌でも、相手が変われば評価は変わります。')
    );

    result.candidates.forEach((c) => {
      const card = el('div', 'quiz-defense-card rank-' + c.rank);

      const head = el('div', 'quiz-defense-head');
      const tileBox = el('div', 'quiz-defense-tile');
      const btn = UI.createTileButton(c.tile, { disabled: true });
      btn.classList.add('quiz-static-tile');
      tileBox.appendChild(btn);
      head.appendChild(tileBox);

      const rankBox = el('div', 'quiz-defense-rankbox');
      rankBox.appendChild(el('span', 'quiz-rank-badge rank-' + c.rank, c.rankShort));
      rankBox.appendChild(el('span', 'quiz-rank-label', c.rankLabel));
      head.appendChild(rankBox);
      card.appendChild(head);

      // 判定材料の一覧(○×だけでなく、文言でも読み取れるようにする)
      const facts = el('div', 'quiz-defense-facts');
      const factLine = (label, value) => {
        const row = el('span', 'quiz-defense-fact');
        row.appendChild(el('span', 'quiz-defense-fact-label', label));
        row.appendChild(el('span', 'quiz-defense-fact-value', value));
        facts.appendChild(row);
      };
      factLine('現物', c.genbutsu ? 'はい' : 'いいえ');
      if (!c.honor.isHonor) {
        factLine('筋', c.suji.isSuji ? (c.suji.isDoubleSuji ? '両スジ' : '片スジ') : 'なし');
        factLine('壁', c.kabe.isKabe ? 'あり' : 'なし');
        factLine('ワンチャンス', c.oneChance.isOneChance ? 'あり' : 'なし');
      } else {
        factLine('字牌の見え枚数', c.honor.visible + '枚(残り' + c.honor.remaining + '枚)');
        factLine('役牌', c.honor.isYakuhai ? 'なる(' + c.honor.yakuhaiKind + ')' : 'ならない(' + c.honor.yakuhaiKind + ')');
      }
      factLine('ドラ', c.dora.isDora ? 'ドラそのもの' : c.dora.isAdjacent ? 'ドラの隣' : '無関係');
      card.appendChild(facts);

      if (c.safeFactors.length > 0) {
        const box = el('div', 'quiz-factor-list quiz-factor-safe');
        box.appendChild(el('div', 'quiz-factor-title', '◯ 安全材料'));
        c.safeFactors.forEach((f) => {
          const item = el('div', 'quiz-factor-item');
          item.appendChild(el('span', 'quiz-factor-icon', '◯'));
          item.appendChild(el('span', null, f.label + '：' + f.detail));
          box.appendChild(item);
        });
        card.appendChild(box);
      }
      // どの牌にも同じ文言が付く一般的な注意は、下にまとめて1回だけ出す(解説を短く保つ)
      const specificDangers = c.dangerFactors.filter(
        (f) => window.MJ.Defense.GENERIC_DANGER_KEYS.indexOf(f.key) === -1
      );
      if (specificDangers.length > 0) {
        const box = el('div', 'quiz-factor-list quiz-factor-danger');
        box.appendChild(el('div', 'quiz-factor-title', '△ 危険材料'));
        specificDangers.forEach((f) => {
          const item = el('div', 'quiz-factor-item');
          item.appendChild(el('span', 'quiz-factor-icon', '△'));
          item.appendChild(el('span', null, f.label + '：' + f.detail));
          box.appendChild(item);
        });
        card.appendChild(box);
      }

      card.appendChild(el('div', 'quiz-defense-reason', '最終評価: ' + c.reason));
      detail.appendChild(card);
    });

    const notes = el('div', 'quiz-detail-sub');
    notes.textContent =
      'ランクS以外は、牌譜統計ではなく「現物・筋・壁・ワンチャンス・字牌・ドラ」という材料だけから決めた相対評価です。' +
      '筋や壁で否定できるのは両面待ちの一部だけで、どの牌も嵌張(カンチャン)・辺張(ペンチャン)・双碰(シャンポン)・単騎(タンキ)待ちには当たる可能性が残ります。';
    if (result.candidates.some((c) => c.dangerFactors.some((f) => f.key === 'other-player'))) {
      notes.textContent += ' また、この評価は' + result.targetLabel + 'に対するものです。他にリーチしている相手には別に安全度を考えてください。';
    }
    detail.appendChild(notes);
    parent.appendChild(detail);
  }

  /**
   * 待ち読みの解説。指定された順番で表示する。
   * 1.選んだ候補 2.妥当な候補 3.推理評価 4.相手の手牌公開 5.実際の待ち 6.待ちの形
   * 7.的中したか 8.河から読み取れたこと 9.断定できなかったこと (10.解説は共通処理)
   * この関数は回答後にだけ呼ばれる。回答前に隠し手牌を描画してはいけない。
   */
  function renderReadingDetail(parent, question, board) {
    const graded = state.graded;
    const detail = el('div', 'quiz-detail quiz-reading-detail');

    const tileRow = (tiles, extraClass) => {
      const row = el('div', 'quiz-tile-row quiz-reading-tiles');
      if (!tiles || tiles.length === 0) {
        row.appendChild(el('span', 'quiz-detail-sub', 'なし'));
        return row;
      }
      tiles.forEach((tileIdx) => {
        const btn = UI.createTileButton(tileIdx, { disabled: true });
        btn.classList.add('quiz-static-tile');
        if (extraClass) btn.classList.add(extraClass);
        row.appendChild(btn);
      });
      return row;
    };
    const section = (title, node, cls) => {
      const box = el('div', 'quiz-reading-section' + (cls ? ' ' + cls : ''));
      box.appendChild(el('div', 'quiz-board-label', title));
      if (node) box.appendChild(node);
      detail.appendChild(box);
      return box;
    };

    // 「河から読み取れる説明」を選ぶ形式でも、回答後には相手の手牌と実際の待ちを公開する
    if (question.mode !== 'reading') {
      const waits = QuizEngine.hiddenWaits(question.hidden);
      const box = el('div', 'quiz-reading-section');
      box.appendChild(el('div', 'quiz-board-label', hiddenOwnerLabel(question, board) + 'の手牌(答え合わせの参考)'));
      const reveal = el('div', 'quiz-reveal');
      const row = el('div', 'quiz-tile-row quiz-reading-tiles');
      question.hidden.hand
        .slice()
        .sort((a, b) => a - b)
        .forEach((tileIdx) => {
          const b2 = UI.createTileButton(tileIdx, { disabled: true });
          b2.classList.add('quiz-static-tile');
          row.appendChild(b2);
        });
      reveal.appendChild(row);
      if (question.hidden.melds && question.hidden.melds.length > 0) {
        const meldRow = el('div', 'quiz-fuuro-row');
        question.hidden.melds.forEach((meld) => {
          const group = el('div', 'quiz-fuuro-group');
          meld.tiles.forEach((tileIdx) => group.appendChild(UI.createMiniTile(tileIdx, { called: true })));
          const typeLabel = { pon: 'ポン', chi: 'チー', minkan: '明槓', ankan: '暗槓' }[meld.type] || meld.type;
          group.appendChild(el('span', 'quiz-fuuro-type', typeLabel));
          meldRow.appendChild(group);
        });
        reveal.appendChild(meldRow);
      }
      box.appendChild(reveal);
      const waitRow = el('div', 'quiz-tile-row quiz-reading-tiles');
      waits.forEach((tileIdx) => {
        const b3 = UI.createTileButton(tileIdx, { disabled: true });
        b3.classList.add('quiz-static-tile', 'quiz-actual-wait');
        waitRow.appendChild(b3);
      });
      box.appendChild(el('div', 'quiz-board-label', '実際の待ち牌(答え合わせの参考)'));
      box.appendChild(waitRow);
      if (question.hidden.shape) box.appendChild(el('div', 'quiz-detail-sub', '待ちの形: ' + question.hidden.shape));
      box.appendChild(el('div', 'quiz-scoring-note', Reading.scoringNote(question.scoring)));
      detail.appendChild(box);
      renderReadingClues(detail, board, waits);
      parent.appendChild(detail);
      return;
    }

    const reasoning = graded.reasoningDetail;
    const hit = graded.hitDetail;

    section('1. あなたが選んだ候補', tileRow(reasoning.selected, 'quiz-picked'));
    section('2. 公開情報から警戒するのが妥当な候補', tileRow(reasoning.reasonableTiles, 'quiz-reasonable'));

    const reasoningBox = section('3. 推理評価(公開情報の使い方)', null, 'quiz-reasoning-' + reasoning.gradeKey);
    const rHead = el('div', 'quiz-reasoning-head');
    rHead.appendChild(el('span', 'quiz-reasoning-mark', reasoning.mark));
    rHead.appendChild(el('span', null, reasoning.grade.label));
    reasoningBox.appendChild(rHead);
    reasoning.reasons.forEach((r) => reasoningBox.appendChild(el('div', 'quiz-detail-sub', '・' + r)));

    // ここから先が、回答後にだけ公開される情報
    const revealed = el('div', 'quiz-reveal');
    const hiddenInfo = question.hidden;
    const handRow = el('div', 'quiz-tile-row quiz-reading-tiles');
    hiddenInfo.hand
      .slice()
      .sort((a, b) => a - b)
      .forEach((tileIdx) => {
        const btn = UI.createTileButton(tileIdx, { disabled: true });
        btn.classList.add('quiz-static-tile');
        handRow.appendChild(btn);
      });
    revealed.appendChild(handRow);
    if (hiddenInfo.melds && hiddenInfo.melds.length > 0) {
      const meldRow = el('div', 'quiz-fuuro-row');
      hiddenInfo.melds.forEach((meld) => {
        const group = el('div', 'quiz-fuuro-group');
        meld.tiles.forEach((tileIdx) => group.appendChild(UI.createMiniTile(tileIdx, { called: true })));
        const typeLabel = { pon: 'ポン', chi: 'チー', minkan: '明槓', ankan: '暗槓' }[meld.type] || meld.type;
        group.appendChild(el('span', 'quiz-fuuro-type', typeLabel));
        meldRow.appendChild(group);
      });
      revealed.appendChild(meldRow);
    }
    const ownerLabel = hiddenOwnerLabel(question, board);
    const scored = !!hit;
    section(scored ? '4. ' + ownerLabel + 'の手牌(ここで公開)' : '4. ' + ownerLabel + 'の手牌(答え合わせの参考)', revealed);
    section(
      scored ? '5. 実際の待ち牌' : '5. 実際の待ち牌(答え合わせの参考)',
      tileRow(graded.actualWaits, 'quiz-actual-wait')
    );

    const shapes = QuizEngine.hiddenWaitDetails(question.hidden);
    const shapeText =
      hiddenInfo.shape || [...new Set(shapes.reduce((a, x) => a.concat(x.waitLabels), []))].join(' / ') || '-';
    section('6. 待ちの形', el('div', 'quiz-detail-sub', shapeText));

    if (!scored) {
      // 危険牌を選ぶ問題では、実際の待ち牌を自分が持っているとは限らない。
      // 「不的中」と出すと推理が正しくても失敗に見えるため、待ちの的中は採点しない。
      const noteBox = section('7. 待ちの的中について', null, 'quiz-hit-notscored');
      noteBox.appendChild(el('div', 'quiz-reasoning-head', Reading.scoringNote(question.scoring)));
      noteBox.appendChild(
        el(
          'div',
          'quiz-detail-sub',
          '上に出した' + ownerLabel + 'の手牌と待ちは、答え合わせの参考です。この問題の成績には、待ちの的中・不的中は入りません。'
        )
      );
    } else {
      const hitBox = section('7. 待ち的中(実際の待ちとの照合)', null, 'quiz-hit-' + hit.levelKey);
      const hHead = el('div', 'quiz-reasoning-head');
      hHead.appendChild(el('span', 'quiz-hit-mark', hit.mark));
      hHead.appendChild(el('span', null, hit.level.label));
      hitBox.appendChild(hHead);
      hitBox.appendChild(el('div', 'quiz-detail-sub', Reading.scoringNote(question.scoring)));
      if (hit.matched.length > 0) {
        hitBox.appendChild(el('div', 'quiz-detail-sub', '含まれていた待ち: ' + hit.matched.map((t) => Tiles.shortLabel(t)).join('・')));
      }
      if (hit.missedWaits.length > 0) {
        hitBox.appendChild(
          el(
            'div',
            'quiz-detail-sub',
            (question.scoring === 'hit-any' ? '選んでいなかった待ち(採点には影響しません): ' : '選べていなかった待ち: ') +
              hit.missedWaits.map((t) => Tiles.shortLabel(t)).join('・')
          )
        );
      }
      hitBox.appendChild(
        el(
          'div',
          'quiz-detail-sub',
          '待ちが外れても、公開情報の使い方(推理評価)が妥当なら読みとしては正しい判断です。逆に、根拠が薄いまま偶然当たることもあります。'
        )
      );
    }

    renderReadingClues(detail, board, graded.actualWaits);
    parent.appendChild(detail);
  }

  /** 8.河から読み取れたこと / 9.断定できなかったこと */
  function renderReadingClues(parent, board, actualWaits) {
    const clues = QuizEngine.readingClues(board);
    const clueBox = el('div');
    clues
      .filter((c) => c.kind !== 'limit')
      .forEach((c) => {
        const row = el('div', 'quiz-clue quiz-clue-' + c.kind);
        row.appendChild(el('span', 'quiz-clue-icon', c.kind === 'safe' ? '◯' : c.kind === 'danger' ? '△' : '・'));
        row.appendChild(el('span', null, c.text));
        clueBox.appendChild(row);
      });
    const box1 = el('div', 'quiz-reading-section');
    box1.appendChild(el('div', 'quiz-board-label', '河(カワ)・鳴きから読み取れたこと'));
    box1.appendChild(clueBox);
    parent.appendChild(box1);

    const limitBox = el('div');
    clues
      .filter((c) => c.kind === 'limit')
      .forEach((c) => limitBox.appendChild(el('div', 'quiz-clue quiz-clue-limit', c.text)));
    if (actualWaits && actualWaits.length > 0) {
      limitBox.appendChild(
        el(
          'div',
          'quiz-detail-sub',
          '答えを見た今は当たり前に見えますが、回答時点の公開情報だけで' +
            actualWaits.map((t) => Tiles.shortLabel(t)).join('・') +
            'に絞り込むことはできませんでした。'
        )
      );
    }
    const box2 = el('div', 'quiz-reading-section');
    box2.appendChild(el('div', 'quiz-board-label', '河だけでは断定できなかったこと'));
    box2.appendChild(limitBox);
    parent.appendChild(box2);
  }

  function renderFeedback(parent, question, board) {
    const graded = state.graded;
    const box = el('div', 'quiz-feedback ' + (graded.correct ? 'quiz-feedback-correct' : 'quiz-feedback-wrong'));

    const head = el('div', 'quiz-feedback-head');
    if (question.mode === 'reading') {
      // 待ち読みは「唯一の正解」ではなく、推理評価を主役に表示する
      head.appendChild(el('span', 'quiz-feedback-mark', graded.reasoningDetail.mark));
      head.appendChild(el('strong', null, graded.reasoningDetail.grade.label));
      if (graded.hitDetail) {
        head.appendChild(el('span', 'quiz-hit-badge quiz-hit-' + graded.hitDetail.levelKey, '待ち: ' + graded.hitDetail.mark));
      } else {
        head.appendChild(el('span', 'quiz-hit-badge quiz-hit-notscored', '待ち: 採点なし'));
      }
    } else {
      head.appendChild(el('span', 'quiz-feedback-mark', graded.correct ? '○' : '×'));
      head.appendChild(el('strong', null, graded.correct ? '正解' : '不正解'));
    }
    box.appendChild(head);

    if (!graded.correct && question.mode !== 'reading') {
      const correctLabels = question.choices
        .filter((c) => graded.correctIds.indexOf(c.id) !== -1)
        .map((c) => c.label || Tiles.shortLabel(c.tile));
      box.appendChild(el('div', 'quiz-feedback-answer', '正解: ' + correctLabels.join('・')));
    }

    // 解説が長くなる問題は折りたためるようにする(スマホで読みやすくするため)
    if (question.explanation.length > 140) {
      const details = document.createElement('details');
      details.className = 'quiz-explanation-details';
      details.open = true;
      const summary = document.createElement('summary');
      summary.textContent = '初心者向け解説(タップで開閉)';
      details.appendChild(summary);
      details.appendChild(el('p', 'quiz-explanation', question.explanation));
      box.appendChild(details);
    } else {
      box.appendChild(el('p', 'quiz-explanation', question.explanation));
    }

    if (question.course === 'yaku') renderYakuDetail(box, question, board);
    else if (question.course === 'wait') renderWaitDetail(box, question, board);
    else if (question.course === 'furiten') renderFuritenDetail(box, question, board);
    else if (question.course === 'genbutsu') renderGenbutsuDetail(box, question, board);
    else if (question.course === 'defense') renderDefenseDetail(box, question, board);
    else if (question.course === 'reading') renderReadingDetail(box, question, board);

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
    if (question.course === 'defense') {
      // 判断の根拠になった牌(現物の元・筋の元・壁/ワンチャンスの牌)を強調する
      const result = QuizEngine.analyzeDefense(board, question.candidates || []);
      result.candidates.forEach((c) => {
        if (c.genbutsu) tiles.push(c.tile);
        (c.suji.basis || []).forEach((t) => tiles.push(t));
        (c.kabe.blockerTiles || []).forEach((t) => tiles.push(t));
        (c.oneChance.blockerTiles || []).forEach((t) => tiles.push(t));
      });
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
    const diff =
      session.difficulty && course.difficulties
        ? (course.difficulties.find((d) => d.id === session.difficulty) || {}).name
        : null;
    header.appendChild(
      el('span', 'quiz-runner-course', course.name + (diff ? '・' + diff : '') + (session.mode === 'review' ? '(復習)' : ''))
    );
    header.appendChild(el('span', 'quiz-runner-progress', '第' + (session.index + 1) + '問 / 全' + session.questions.length + '問'));
    root.appendChild(header);

    const promptBox = el('div', 'quiz-prompt');
    promptBox.appendChild(el('p', null, question.prompt));
    if (question.multi) promptBox.appendChild(el('p', 'quiz-prompt-note', '※当てはまるものをすべて選んでください(複数選択)'));
    if (question.course === 'reading') {
      // 何を採点するのかを、回答する前にはっきり伝える
      promptBox.appendChild(el('p', 'quiz-scoring-note', Reading.scoringLabel(question.scoring)));
    }
    root.appendChild(promptBox);
    if (question.course === 'reading') renderReadingFocus(root, question);

    renderBoard(root, question, board, highlightSetFor(question, board));
    renderChoices(root, question);

    const actions = el('div', 'quiz-actions');
    if (!state.graded) {
      const answerBtn = el('button', 'primary', '回答する');
      answerBtn.disabled =
        question.mode === 'order' ? state.selected.length !== question.choices.length : state.selected.length === 0;
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

  /**
   * 待ち読みの結果内訳。
   * 推理評価と待ち的中は別々に出し、待ち的中の分母には
   * 「待ち予想を採点した問題」だけを数える(危険牌を選ぶ問題は入れない)。
   */
  function renderReadingSummary(parent, summary) {
    const box = el('div', 'quiz-result-reading');
    box.appendChild(el('div', 'quiz-board-label', '推理評価(公開情報の使い方)'));
    const r = summary.reasoningCounts;
    box.appendChild(
      el('div', 'quiz-detail-sub', '◎ ' + r.excellent + '問 / ○ ' + r.good + '問 / △ ' + r.needsWork + '問')
    );

    box.appendChild(el('div', 'quiz-board-label', '待ち予想の的中(採点した問題のみ)'));
    if (summary.hitAnswered === 0) {
      box.appendChild(el('div', 'quiz-detail-sub', '今回は待ち予想を採点する問題がありませんでした。'));
    } else {
      const h = summary.hitCounts;
      box.appendChild(
        el(
          'div',
          'quiz-detail-sub',
          '採点した問題: ' + summary.hitAnswered + '問 … 的中 ' + h.hit + '問 / 一部的中 ' + h.partial + '問 / 不的中 ' + h.miss + '問'
        )
      );
    }
    if (summary.reasoningOnlyAnswered > 0) {
      box.appendChild(
        el(
          'div',
          'quiz-scoring-note',
          '危険牌を選ぶ問題など' +
            summary.reasoningOnlyAnswered +
            '問は、待ちの的中・不的中を採点していません(推理評価だけで採点しています)。'
        )
      );
    }
    parent.appendChild(box);
  }

  function renderResult(root) {
    const summary = state.summary;
    const course = QuizData.getCourse(state.session.courseId);

    const difficultyName =
      state.session.difficulty && course.difficulties
        ? (course.difficulties.find((d) => d.id === state.session.difficulty) || {}).name
        : null;
    root.appendChild(el('h3', 'quiz-result-title', course.name + (difficultyName ? '(' + difficultyName + ')' : '') + ' の結果'));

    const scoreBox = el('div', 'quiz-result-score');
    scoreBox.appendChild(el('div', 'quiz-result-main', summary.correct + ' / ' + summary.total + ' 問正解'));
    scoreBox.appendChild(el('div', 'quiz-result-rate', '正答率 ' + summary.rate + '%'));
    root.appendChild(scoreBox);

    if (state.session.courseId === 'reading') renderReadingSummary(root, summary);

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
    againBtn.addEventListener('click', () => startSession(state.session.courseId, null, state.session.difficulty));
    actions.appendChild(againBtn);
    const backBtn = el('button', null, 'コース選択へ戻る');
    backBtn.addEventListener('click', backToList);
    actions.appendChild(backBtn);
    root.appendChild(actions);
  }

  // ==================================================
  // 操作
  // ==================================================

  function startSession(courseId, questionIds, difficulty) {
    const options = {};
    if (questionIds) options.questionIds = questionIds;
    if (difficulty) options.difficulty = difficulty;
    state.session = QuizSession.createSession(courseId, options);
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
    state.graded.mode = QuizSession.currentQuestion(state.session).mode || 'select';
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
        state.summary.results.map((r) => ({
          questionId: r.questionId,
          correct: r.correct,
          tags: r.tags,
          difficulty: r.difficulty,
          // 待ち読み(V1.9): 推理評価と待ち的中は別々の指標として保存する
          reasoning: r.reasoning,
          hit: r.hit,
        }))
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
