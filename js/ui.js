/**
 * ui.js
 * DOM描画専用のヘルパー関数群。ゲームロジックやlocalStorageには触れない。
 */
(function (root) {
  'use strict';

  const Tiles = root.MJ.Tiles;
  const Evaluator = root.MJ.Evaluator;
  const Dictionary = root.MJ.Dictionary;
  const HandInfo = root.MJ.HandInfo;
  const HandBuilder = root.MJ.HandBuilder;

  let tooltipEl = null;

  function ensureTooltip() {
    if (!tooltipEl) {
      tooltipEl = document.getElementById('tile-tooltip');
    }
    return tooltipEl;
  }

  function showTooltip(evt, text) {
    const el = ensureTooltip();
    if (!el) return;
    el.textContent = text;
    el.hidden = false;
    el.style.left = evt.clientX + 12 + 'px';
    el.style.top = evt.clientY + 12 + 'px';
  }

  function hideTooltip() {
    const el = ensureTooltip();
    if (el) el.hidden = true;
  }

  /**
   * 1枚の牌ボタン要素を作る。
   * @param {number} tileIdx
   * @param {{selected:boolean, isDrawn:boolean, onClick:Function, disabled:boolean}} options
   */
  function createTileButton(tileIdx, options) {
    options = options || {};
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tile suit-' + Tiles.suitOf(tileIdx);
    if (options.selected) btn.classList.add('selected');
    if (options.isDrawn) btn.classList.add('drawn');
    btn.dataset.tile = String(tileIdx);

    const glyph = document.createElement('div');
    glyph.className = 'tile-glyph';
    glyph.textContent = Tiles.unicodeOf(tileIdx);

    const label = document.createElement('div');
    label.className = 'tile-label';
    label.textContent = Tiles.shortLabel(tileIdx);

    btn.appendChild(glyph);
    btn.appendChild(label);

    btn.addEventListener('mouseenter', (e) => showTooltip(e, Tiles.fullName(tileIdx)));
    btn.addEventListener('mousemove', (e) => showTooltip(e, Tiles.fullName(tileIdx)));
    btn.addEventListener('mouseleave', hideTooltip);

    if (options.disabled) {
      btn.disabled = true;
    } else if (typeof options.onClick === 'function') {
      btn.addEventListener('click', () => options.onClick(tileIdx));
    }

    return btn;
  }

  /**
   * 手牌(牌インデックス配列、昇順)を描画する。
   * @param {HTMLElement} container
   * @param {number[]} tiles
   * @param {{selectedPosition:?number, drawnPosition:?number, onTileClick:Function}} options
   *   selectedPosition/drawnPosition は tiles 配列内の位置(インデックス)で指定する。
   *   同種牌が複数あっても、位置指定なら「どの1枚か」を一意に区別できる。
   */
  function renderHand(container, tiles, options) {
    options = options || {};
    container.innerHTML = '';
    tiles.forEach((tileIdx, pos) => {
      const btn = createTileButton(tileIdx, {
        selected: pos === options.selectedPosition,
        isDrawn: pos === options.drawnPosition,
        onClick: options.onTileClick ? () => options.onTileClick(tileIdx, pos) : null,
      });
      container.appendChild(btn);
    });
  }

  /**
   * 打牌候補ランキング(上位N件)を描画する。
   * @param {HTMLElement} container <ol>要素
   * @param {Array} discards evaluator.analyzeHand().discards (ソート済み)
   * @param {{limit:number}} options
   */
  /**
   * discards(シャンテン数昇順・受け入れ枚数降順にソート済み)から、
   * 同じ(シャンテン数, 受け入れ枚数)のものを同順位としてまとめる。
   * 牌効率が完全に同じ候補に、意味の無い1位・2位の差を付けないため。
   * @returns {number[]} 各discardsの順位(1始まり、同率は同じ数字)
   */
  function computeTiedRanks(discards) {
    const ranks = [];
    let rank = 1;
    for (let i = 0; i < discards.length; i++) {
      if (i > 0) {
        const prev = discards[i - 1];
        const cur = discards[i];
        if (!(prev.resultShanten === cur.resultShanten && prev.ukeireTotal === cur.ukeireTotal)) {
          rank = i + 1;
        }
      }
      ranks.push(rank);
    }
    return ranks;
  }

  function renderRanking(container, discards, options) {
    options = options || {};
    const limit = options.limit || 3;
    container.innerHTML = '';

    const shown = discards.slice(0, limit);
    const ranks = computeTiedRanks(discards);
    const tieGroupSize = {};
    ranks.forEach((r) => {
      tieGroupSize[r] = (tieGroupSize[r] || 0) + 1;
    });

    shown.forEach((d, i) => {
      const rank = ranks[i];
      const isTie = tieGroupSize[rank] > 1;
      const li = document.createElement('li');
      li.className = 'rank-item rank-' + rank + (isTie ? ' rank-tie' : '');

      const header = document.createElement('div');
      header.className = 'rank-header';
      const rankNum = document.createElement('span');
      rankNum.className = 'rank-num';
      rankNum.textContent = isTie ? `同率${rank}位` : `${rank}位`;
      const tileLabel = document.createElement('span');
      tileLabel.textContent = `${d.label}(${d.fullName})を切る`;
      header.appendChild(rankNum);
      header.appendChild(tileLabel);

      const meta = document.createElement('div');
      meta.className = 'rank-meta';
      meta.textContent = `打牌後シャンテン数: ${d.resultShanten} / 有効牌: ${d.ukeireKinds}種類 ${d.ukeireTotal}枚`;
      if (isTie) {
        const tieNote = document.createElement('div');
        tieNote.className = 'rank-tie-note';
        tieNote.textContent = '牌効率上は同率です。役の可能性など別の観点で選んでも構いません。';
        meta.appendChild(document.createElement('br'));
        meta.appendChild(tieNote);
      }
      if (options.unseenTotal && window.MJ && window.MJ.Probability) {
        const prob = window.MJ.Probability.nextDrawProbability(d.ukeireTotal, options.unseenTotal);
        const probLine = document.createElement('div');
        probLine.className = 'rank-probability';
        probLine.textContent = `次のツモで手が進む確率: 約${window.MJ.Probability.toPercentLabel(prob)}`;
        meta.appendChild(probLine);
      }

      const reason = document.createElement('div');
      reason.className = 'rank-reason';
      reason.textContent = d.reason;

      const ukeireGrid = document.createElement('div');
      renderTileVisualGrid(ukeireGrid, d.ukeireTiles, { showResultShanten: true });

      li.appendChild(header);
      li.appendChild(meta);
      li.appendChild(reason);
      li.appendChild(ukeireGrid);

      container.appendChild(li);
    });
  }

  /**
   * 現在の手牌構造(両面・嵌張・対子・孤立牌など)をまとめて解説する。
   */
  function renderBlockSummary(container, analysis) {
    container.innerHTML = '';

    if (analysis.currentType !== 'standard') {
      const typeName = analysis.currentType === 'chiitoitsu' ? '七対子' : '国士無双';
      const p = document.createElement('div');
      p.className = 'block-summary-item';
      p.textContent = `現在は${typeName}を狙うのが最も近道です。`;
      container.appendChild(p);
    }

    if (!analysis.baseBlocks || analysis.baseBlocks.length === 0) {
      const p = document.createElement('div');
      p.className = 'block-summary-item';
      p.textContent = 'まだ完成した組み合わせがありません。まずは対子や両面を作ることを目指しましょう。';
      container.appendChild(p);
      return;
    }

    const summary = document.createElement('div');
    summary.className = 'block-summary';

    const dictByKey = {};
    Dictionary.TERMS.forEach((t) => (dictByKey[t.key] = t));
    const typeToDictKey = {
      triplet: 'kotsu',
      sequence: 'shuntsu',
      pair: 'toitsu',
      ryanmen: 'ryanmen',
      kanchan: 'kanchan',
      penchan: 'penchan',
    };

    analysis.baseBlocks.forEach((b) => {
      const item = document.createElement('div');
      item.className = 'block-summary-item';
      const desc = Evaluator.describeBlockJa(b);
      const dictEntry = dictByKey[typeToDictKey[b.type]];
      item.textContent = dictEntry ? `${desc} — ${dictEntry.short}` : desc;
      summary.appendChild(item);
    });

    container.appendChild(summary);
  }

  function renderDictionary(container, terms) {
    container.innerHTML = '';
    terms.forEach((t) => {
      const details = document.createElement('details');
      details.className = 'dict-term';
      const summary = document.createElement('summary');
      summary.textContent = t.term;
      const shortP = document.createElement('p');
      shortP.textContent = t.short;
      const detailP = document.createElement('p');
      detailP.textContent = t.detail;
      details.appendChild(summary);
      details.appendChild(shortP);
      details.appendChild(detailP);
      if (t.lessonId && window.MJ && window.MJ.Lessons && window.MJ.Lessons.getLesson(t.lessonId)) {
        const btn = document.createElement('button');
        btn.className = 'dict-lesson-link';
        btn.textContent = '例題を解く(' + window.MJ.Lessons.getLesson(t.lessonId).title + ')';
        btn.addEventListener('click', () => {
          const tabBtn = document.querySelector('.tab-btn[data-tab="tutorial"]');
          if (tabBtn) tabBtn.click();
          if (window.MJ.AppLesson) window.MJ.AppLesson.startLesson(t.lessonId);
        });
        details.appendChild(btn);
      }
      container.appendChild(details);
    });
  }

  function renderStats(container, summary) {
    container.innerHTML = '';

    const grid = document.createElement('div');
    grid.className = 'stats-grid';

    const cards = [
      { label: '問題回答数', value: summary.totalAnswered },
      { label: '牌効率上のおすすめ一致率', value: summary.matchRate + '%' },
      { label: '◎評価率', value: summary.excellentRate + '%' },
    ];

    cards.forEach((c) => {
      const card = document.createElement('div');
      card.className = 'stat-card';
      const value = document.createElement('div');
      value.className = 'stat-value';
      value.textContent = c.value;
      const label = document.createElement('div');
      label.className = 'stat-label';
      label.textContent = c.label;
      card.appendChild(value);
      card.appendChild(label);
      grid.appendChild(card);
    });

    container.appendChild(grid);

    const recentTitle = document.createElement('h3');
    recentTitle.textContent = '最近の成績';
    container.appendChild(recentTitle);

    const list = document.createElement('ul');
    list.id = 'stats-recent-list';
    if (summary.recent.length === 0) {
      const li = document.createElement('li');
      li.textContent = 'まだ記録がありません。トレーニングや何切る問題に挑戦してみましょう。';
      list.appendChild(li);
    } else {
      summary.recent.forEach((r) => {
        const li = document.createElement('li');
        const date = new Date(r.timestamp);
        const timeStr = `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
        li.textContent = `[${timeStr}] ${gradeLabelShort(r.grade)} 選択:${r.chosenLabel} / 牌効率上のおすすめ:${r.bestLabel}`;
        list.appendChild(li);
      });
    }
    container.appendChild(list);
  }

  function gradeLabelShort(grade) {
    return { excellent: '◎', good: '○', fair: '△', bad: '×', unknown: '?' }[grade] || '?';
  }

  // ==================================================
  // V1.1 追加分
  // ==================================================

  /**
   * 有効牌・待ち牌などを、小さな牌ビジュアル+補足テキストのグリッドとして表示する。
   * @param {HTMLElement} container
   * @param {Array<{tile:number,label:string,remaining:number,resultShanten?:number}>} tilesInfo
   * @param {{showResultShanten?:boolean}} options
   */
  function renderTileVisualGrid(container, tilesInfo, options) {
    options = options || {};
    container.innerHTML = '';
    container.classList.add('tile-visual-grid');

    tilesInfo.forEach((t) => {
      const card = document.createElement('div');
      card.className = 'tile-visual-card suit-' + Tiles.suitOf(t.tile);

      const glyph = document.createElement('div');
      glyph.className = 'tile-glyph';
      glyph.textContent = Tiles.unicodeOf(t.tile);

      const label = document.createElement('div');
      label.className = 'tile-label';
      label.textContent = t.label;

      const count = document.createElement('div');
      count.className = 'tile-visual-count';
      count.textContent = `×${t.remaining}枚`;

      card.appendChild(glyph);
      card.appendChild(label);
      card.appendChild(count);

      if (options.showResultShanten && typeof t.resultShanten === 'number') {
        const sh = document.createElement('div');
        sh.className = 'tile-visual-shanten';
        sh.textContent = t.resultShanten === -1 ? 'アガリ' : `→${t.resultShanten}シャンテン`;
        card.appendChild(sh);
      }

      card.title = Tiles.fullName(t.tile);
      container.appendChild(card);
    });
  }

  /**
   * 打牌候補の比較表(打牌/シャンテン/種類/枚数/評価)を描画する。
   * @param {HTMLElement} container
   * @param {Array} discards evaluator.analyzeHand().discards (ソート済み)
   * @param {{topLimit:number}} options
   */
  function renderComparisonTable(container, discards, options) {
    options = options || {};
    const topLimit = options.topLimit || 3;
    container.innerHTML = '';

    const showProb = !!(options.unseenTotal && window.MJ && window.MJ.Probability);

    function buildTable(rows) {
      const table = document.createElement('table');
      table.className = 'compare-table';
      const thead = document.createElement('thead');
      thead.innerHTML =
        '<tr><th>打牌</th><th>打牌後<br>シャンテン</th><th>有効牌<br>種類</th><th>受け入れ<br>枚数</th>' +
        (showProb ? '<th>次のツモで<br>改善</th>' : '') +
        '<th>評価</th></tr>';
      table.appendChild(thead);

      const tbody = document.createElement('tbody');
      rows.forEach((d) => {
        const tr = document.createElement('tr');
        tr.className = 'grade-row-' + d.grade.grade;
        const probCell = showProb
          ? `<td>${window.MJ.Probability.toPercentLabel(window.MJ.Probability.nextDrawProbability(d.ukeireTotal, options.unseenTotal))}</td>`
          : '';
        tr.innerHTML = `
          <td>${d.label}</td>
          <td>${d.resultShanten}</td>
          <td>${d.ukeireKinds}種</td>
          <td>${d.ukeireTotal}枚</td>
          ${probCell}
          <td>${d.grade.gradeLabel.split(' ')[0]}</td>
        `;
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      return table;
    }

    const wrapTop = document.createElement('div');
    wrapTop.className = 'compare-table-wrap';
    wrapTop.appendChild(buildTable(discards.slice(0, topLimit)));
    container.appendChild(wrapTop);

    if (discards.length > topLimit) {
      const details = document.createElement('details');
      details.className = 'compare-table-all';
      const summary = document.createElement('summary');
      summary.textContent = `すべての候補を見る(全${discards.length}種)`;
      details.appendChild(summary);
      const wrapAll = document.createElement('div');
      wrapAll.className = 'compare-table-wrap';
      wrapAll.appendChild(buildTable(discards));
      details.appendChild(wrapAll);
      container.appendChild(details);
    }
  }

  /**
   * 「自分の選択」と「牌効率上のおすすめ」を並べて比較表示する。
   * @param {HTMLElement} container
   * @param {object} chosen evaluator.analyzeHand().discards の1件
   * @param {object} best evaluator.analyzeHand().recommended
   * @param {{grade:string, gradeLabel:string, comment:string}} grade
   */
  function renderComparisonCards(container, chosen, best, grade) {
    container.innerHTML = '';
    container.classList.add('compare-cards');

    function card(title, d, isBest) {
      const box = document.createElement('div');
      box.className = 'compare-card' + (isBest ? ' compare-card-best' : '');
      const h = document.createElement('div');
      h.className = 'compare-card-title';
      h.textContent = title;
      const tileLine = document.createElement('div');
      tileLine.className = 'compare-card-tile';
      tileLine.textContent = `${d.label}(${d.fullName})`;
      const shantenLine = document.createElement('div');
      shantenLine.textContent = `シャンテン: ${d.resultShanten}`;
      const ukeireLine = document.createElement('div');
      ukeireLine.textContent = `受け入れ: ${d.ukeireKinds}種 ${d.ukeireTotal}枚`;
      box.appendChild(h);
      box.appendChild(tileLine);
      box.appendChild(shantenLine);
      box.appendChild(ukeireLine);
      return box;
    }

    const row = document.createElement('div');
    row.className = 'compare-cards-row';
    row.appendChild(card('あなたの選択', chosen, chosen.tile === best.tile));
    row.appendChild(card('牌効率上のおすすめ', best, true));
    container.appendChild(row);

    if (chosen.tile !== best.tile) {
      const diff = document.createElement('div');
      diff.className = 'compare-diff';
      const diffTotal = best.ukeireTotal - chosen.ukeireTotal;
      const sign = diffTotal > 0 ? '+' : '';
      diff.textContent = `受け入れの差: ${sign}${diffTotal}枚(おすすめ基準)`;
      container.appendChild(diff);
    }

    const gradeLine = document.createElement('div');
    gradeLine.className = 'grade-line grade-' + grade.grade;
    gradeLine.textContent = grade.gradeLabel;
    container.appendChild(gradeLine);

    const comment = document.createElement('div');
    comment.className = 'compare-comment';
    comment.textContent = grade.comment;
    container.appendChild(comment);
  }

  /**
   * テンパイ時の待ち牌情報を表示する。
   */
  function renderWaitPanel(container, waitInfo) {
    container.innerHTML = '';
    if (!waitInfo) {
      const p = document.createElement('div');
      p.textContent = 'まだテンパイしていません。';
      container.appendChild(p);
      return;
    }

    const header = document.createElement('div');
    header.className = 'wait-header';
    header.textContent = waitInfo.shapeLabel ? `テンパイ:${waitInfo.shapeLabel}` : 'テンパイ';
    container.appendChild(header);

    if (!waitInfo.shapeLabel) {
      const note = document.createElement('div');
      note.className = 'hint-text';
      note.textContent = '複数の形が組み合わさっているため、待ちの形は一意に分類できませんでした。下記の待ち牌一覧が正確な情報です。';
      container.appendChild(note);
    }

    const grid = document.createElement('div');
    renderTileVisualGrid(grid, waitInfo.tiles, {});
    container.appendChild(grid);

    const total = document.createElement('div');
    total.className = 'wait-total';
    total.textContent = `合計 ${waitInfo.total}枚`;
    container.appendChild(total);
  }

  /**
   * アガリ形の面子分解を表示する。
   */
  function renderAgariBreakdown(container, agariInfo) {
    container.innerHTML = '';
    if (!agariInfo) return;

    const row = document.createElement('div');
    row.className = 'agari-breakdown-row';
    agariInfo.groups.forEach((g) => {
      const badge = document.createElement('div');
      badge.className = 'agari-group-badge';
      const label = document.createElement('div');
      label.className = 'agari-group-label';
      label.textContent = g.label;
      const kind = document.createElement('div');
      kind.className = 'agari-group-kind';
      kind.textContent = g.kind;
      badge.appendChild(label);
      badge.appendChild(kind);
      row.appendChild(badge);
    });
    container.appendChild(row);
  }

  /**
   * 「この形からどの牌を引くとどう変わるか」の解説を表示する。
   */
  function renderShapeGrowth(container, growthList) {
    container.innerHTML = '';
    if (!growthList || growthList.length === 0) return;

    growthList.forEach((g) => {
      const box = document.createElement('div');
      box.className = 'shape-growth-box';
      const title = document.createElement('div');
      title.className = 'shape-growth-title';
      title.textContent = `${g.clusterLabel} の形は複数方向に発展できます`;
      box.appendChild(title);

      const list = document.createElement('ul');
      list.className = 'shape-growth-list';
      g.transitions.forEach((t) => {
        const li = document.createElement('li');
        li.className = t.improves ? 'shape-growth-improves' : '';
        li.textContent = `${t.drawLabel}を引く → ${t.resultLabel}${t.improves ? '(シャンテンが進む)' : ''}`;
        list.appendChild(li);
      });
      box.appendChild(list);
      container.appendChild(box);
    });
  }

  const HIGHLIGHT_LEGEND_ORDER = ['meld', 'pair-head', 'pair-taatsu', 'ryanmen', 'kanchan', 'penchan', 'isolated'];

  /**
   * renderHand で描画済みの手牌に対して、形のカテゴリ別ハイライトを追加する。
   * @param {HTMLElement} container renderHandで使ったのと同じコンテナ
   * @param {string[]} categories tiles配列と対応する位置ごとのカテゴリ
   */
  function applyShapeHighlights(container, categories) {
    const buttons = container.querySelectorAll('.tile');
    buttons.forEach((btn, i) => {
      HIGHLIGHT_LEGEND_ORDER.forEach((cat) => btn.classList.remove('cat-' + cat));
      if (categories[i]) btn.classList.add('cat-' + categories[i]);
    });
  }

  function renderHighlightLegend(container) {
    container.innerHTML = '';
    container.classList.add('highlight-legend');
    HIGHLIGHT_LEGEND_ORDER.forEach((cat) => {
      const item = document.createElement('span');
      item.className = 'legend-item cat-' + cat;
      item.textContent = HandInfo.CATEGORY_LABEL[cat];
      container.appendChild(item);
    });
  }

  /**
   * 手牌分析タブの34種パレットを描画する。
   * @param {HTMLElement} container
   * @param {number[]} counts 現在選択中の34要素カウント配列
   * @param {Function} onTileClick (tileIdx) => void
   */
  function renderPalette(container, counts, onTileClick) {
    container.innerHTML = '';
    for (let i = 0; i < Tiles.TILE_COUNT; i++) {
      const wrap = document.createElement('div');
      wrap.className = 'palette-item';

      const disabled = !HandBuilder.canAdd(counts, i);
      const btn = createTileButton(i, {
        disabled,
        onClick: disabled ? null : () => onTileClick(i),
      });
      if (counts[i] > 0) {
        const badge = document.createElement('span');
        badge.className = 'palette-badge';
        badge.textContent = String(counts[i]);
        btn.appendChild(badge);
      }
      wrap.appendChild(btn);
      container.appendChild(wrap);
    }
  }

  // ==================================================
  // V1.2 追加分: 役・符・点数の表示
  // ==================================================

  function renderYakuList(container, yakuList) {
    container.innerHTML = '';
    const list = document.createElement('ul');
    list.className = 'yaku-list';
    yakuList.forEach((y) => {
      const li = document.createElement('li');
      li.className = 'yaku-list-item';
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      const nameSpan = document.createElement('span');
      nameSpan.textContent = y.name;
      const hanSpan = document.createElement('span');
      hanSpan.className = 'yaku-han';
      hanSpan.textContent = y.isYakuman ? `役満 ×${y.multiple}` : `${y.han}翻`;
      summary.appendChild(nameSpan);
      summary.appendChild(hanSpan);
      const p = document.createElement('p');
      p.textContent = y.explanation || '';
      details.appendChild(summary);
      details.appendChild(p);
      li.appendChild(details);
      list.appendChild(li);
    });
    container.appendChild(list);
  }

  function renderScoreSummary(container, result, ctx) {
    container.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'score-summary';

    const tierLine = document.createElement('div');
    tierLine.className = 'score-tier';
    const hanText = result.isYakuman ? '役満' : `${result.han}翻${result.fu}符`;
    tierLine.textContent = result.score.tier ? `${hanText}(${result.score.tier})` : hanText;

    const pointsLine = document.createElement('div');
    pointsLine.className = 'score-points';
    pointsLine.textContent = `${result.score.total}点`;

    const paymentLine = document.createElement('div');
    paymentLine.className = 'score-payment';
    paymentLine.textContent = result.score.paymentText;

    box.appendChild(tierLine);
    box.appendChild(pointsLine);
    box.appendChild(paymentLine);
    container.appendChild(box);
  }

  function renderFuBreakdown(container, fuBreakdown, fuTotal) {
    container.innerHTML = '';
    if (!fuBreakdown || fuBreakdown.length === 0) return;

    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = '符の内訳を詳しく見る';
    details.appendChild(summary);

    const table = document.createElement('table');
    table.className = 'fu-breakdown-table';
    fuBreakdown.forEach((row) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${row.label}</td><td>${row.value >= 0 ? '+' : ''}${row.value}符</td>`;
      table.appendChild(tr);
    });
    const totalTr = document.createElement('tr');
    totalTr.innerHTML = `<td><strong>合計</strong></td><td><strong>${fuTotal}符</strong></td>`;
    table.appendChild(totalTr);

    details.appendChild(table);
    container.appendChild(details);
  }

  function renderNoYaku(container, message) {
    container.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'no-yaku-box';
    box.textContent = message;
    container.appendChild(box);
  }

  function renderYakuCandidates(container, candidates) {
    container.innerHTML = '';
    if (candidates.length === 0) {
      const p = document.createElement('div');
      p.className = 'hint-text';
      p.textContent = '現時点で特に見えている役はありません。';
      container.appendChild(p);
      return;
    }
    candidates.forEach((c) => {
      const item = document.createElement('div');
      item.className = 'yaku-candidate-item';
      const name = document.createElement('span');
      name.className = 'cand-name';
      name.textContent = c.name;
      const note = document.createElement('span');
      note.textContent = c.note;
      item.appendChild(name);
      item.appendChild(note);
      container.appendChild(item);
    });
  }

  /**
   * ドラ表示牌などを選ぶ、単一選択式の34種牌ピッカーを描画する。
   * @param {HTMLElement} container
   * @param {?number} selectedTile
   * @param {Function} onSelect (tileIdx|null) => void
   * @param {{enabledPredicate?:Function}} options
   */
  function renderSingleTilePicker(container, selectedTile, onSelect, options) {
    options = options || {};
    container.innerHTML = '';
    for (let i = 0; i < Tiles.TILE_COUNT; i++) {
      const disabled = options.enabledPredicate ? !options.enabledPredicate(i) : false;
      const btn = createTileButton(i, {
        selected: i === selectedTile,
        disabled,
        onClick: disabled ? null : () => onSelect(i === selectedTile ? null : i),
      });
      container.appendChild(btn);
    }
  }

  function populateWindSelect(selectEl, options) {
    options = options || {};
    selectEl.innerHTML = '';
    Tiles.HONOR_NAMES.slice(0, 4).forEach((name, i) => {
      const opt = document.createElement('option');
      opt.value = String(27 + i);
      opt.textContent = name;
      selectEl.appendChild(opt);
    });
  }

  // ==================================================
  // V1.3 追加分: CPU対局(河・プレイヤー状態・牌譜再生の共通表示)
  // ==================================================

  function createMiniTile(tileIdx, options) {
    options = options || {};
    const div = document.createElement('div');
    div.className = 'mini-tile suit-' + Tiles.suitOf(tileIdx);
    if (options.called) div.classList.add('called');
    if (options.isRiichiTile) div.classList.add('riichi-tile');
    div.textContent = Tiles.shortLabel(tileIdx);
    div.title = Tiles.fullName(tileIdx) + (options.called ? '(鳴かれた)' : '');
    return div;
  }

  /**
   * 1人分の河(捨て牌)を描画する。
   * @param {HTMLElement} container
   * @param {string} label 表示ラベル(例: "自分" "下家")
   * @param {Array<{tile:number, calledBy?:number|null, isRiichiDeclare?:boolean, riichi?:boolean}>} discards
   */
  function renderDiscardPileBox(container, label, discards) {
    container.innerHTML = '';
    container.className = 'discard-pile-box';
    const labelEl = document.createElement('div');
    labelEl.className = 'discard-pile-label';
    labelEl.textContent = label;
    container.appendChild(labelEl);

    const tilesRow = document.createElement('div');
    tilesRow.className = 'discard-pile-tiles';
    discards.forEach((d) => {
      const isCalled = d.calledBy !== null && d.calledBy !== undefined;
      const isRiichiTile = !!(d.isRiichiDeclare || d.riichi);
      tilesRow.appendChild(createMiniTile(d.tile, { called: isCalled, isRiichiTile }));
    });
    container.appendChild(tilesRow);
  }

  function renderDiscardsGrid(container, playersInfo) {
    container.innerHTML = '';
    playersInfo.forEach((info) => {
      const box = document.createElement('div');
      renderDiscardPileBox(box, info.relativeLabel + '(' + info.name + ')', info.discards);
      container.appendChild(box);
    });
  }

  /**
   * @param {object} info {name, relativeLabel, score, windLabel, isDealer, isSelf, isTurn,
   *                        riichi, fuuroCount}
   */
  function renderPlayerStatusCard(container, info) {
    container.innerHTML = '';
    container.className = 'player-status-card' + (info.isSelf ? ' is-self' : '') + (info.isTurn ? ' is-turn' : '');

    const nameRow = document.createElement('div');
    nameRow.className = 'player-name-row';
    const nameSpan = document.createElement('span');
    nameSpan.textContent = `${info.relativeLabel} ${info.name}`;
    const scoreSpan = document.createElement('span');
    scoreSpan.className = 'player-score';
    scoreSpan.textContent = `${info.score}点`;
    nameRow.appendChild(nameSpan);
    nameRow.appendChild(scoreSpan);
    container.appendChild(nameRow);

    const tags = document.createElement('div');
    tags.className = 'player-tags';
    if (info.isDealer) tags.appendChild(makeTag('親', false));
    if (info.windLabel) tags.appendChild(makeTag(info.windLabel, false));
    if (info.riichi) tags.appendChild(makeTag('リーチ', true));
    if (info.isTurn) tags.appendChild(makeTag('手番', false));
    container.appendChild(tags);

    function makeTag(text, isRiichi) {
      const span = document.createElement('span');
      span.className = 'player-tag' + (isRiichi ? ' riichi-tag' : '');
      span.textContent = text;
      return span;
    }

    if (info.fuuroCount > 0) {
      const fuuroLine = document.createElement('div');
      fuuroLine.className = 'player-fuuro-mini';
      fuuroLine.textContent = `副露: ${info.fuuroCount}組`;
      container.appendChild(fuuroLine);
    }
  }

  function renderPlayerStatusGrid(container, playersInfo) {
    container.innerHTML = '';
    playersInfo.forEach((info) => {
      const card = document.createElement('div');
      renderPlayerStatusCard(card, info);
      container.appendChild(card);
    });
  }

  function renderFuuroRow(container, fuuro) {
    container.innerHTML = '';
    fuuro.forEach((meld) => {
      const group = document.createElement('div');
      group.className = 'fuuro-group';
      meld.tiles.forEach((t) => {
        const btn = createTileButton(t, { disabled: true });
        group.appendChild(btn);
      });
      container.appendChild(group);
    });
  }

  const UI = {
    createTileButton,
    renderHand,
    renderRanking,
    renderBlockSummary,
    renderDictionary,
    renderStats,
    renderTileVisualGrid,
    renderComparisonTable,
    renderComparisonCards,
    renderWaitPanel,
    renderAgariBreakdown,
    renderShapeGrowth,
    applyShapeHighlights,
    renderHighlightLegend,
    renderPalette,
    renderYakuList,
    renderScoreSummary,
    renderFuBreakdown,
    renderNoYaku,
    renderYakuCandidates,
    renderSingleTilePicker,
    populateWindSelect,
    createMiniTile,
    renderDiscardPileBox,
    renderDiscardsGrid,
    renderPlayerStatusCard,
    renderPlayerStatusGrid,
    renderFuuroRow,
    showTooltip,
    hideTooltip,
    gradeLabelShort,
  };

  root.MJ = root.MJ || {};
  root.MJ.UI = UI;
})(window);
