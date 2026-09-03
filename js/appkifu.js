/**
 * appkifu.js
 * 「牌譜・復習」タブの画面制御。保存した対局を1手ずつ再生し、
 * 各時点で「この時点を分析する」から手牌分析(牌効率上のおすすめ)を確認できる。
 */
(function () {
  'use strict';

  const Tiles = window.MJ.Tiles;
  const Kifu = window.MJ.Kifu;
  const Evaluator = window.MJ.Evaluator;
  const HandInfo = window.MJ.HandInfo;
  const UI = window.MJ.UI;

  const RELATIVE_LABELS = ['自分', '下家', '対面', '上家'];

  const kifuTab = {
    list: [],
    selectedMatchIndex: null,
    selectedRoundIndex: 0,
    step: 0,
  };

  function initKifuTab() {
    document.getElementById('kifu-back-to-list-btn').addEventListener('click', showList);
    document.getElementById('kifu-prev-btn').addEventListener('click', () => moveStep(-1));
    document.getElementById('kifu-next-btn').addEventListener('click', () => moveStep(1));
    document.getElementById('kifu-analyze-btn').addEventListener('click', analyzeCurrentStep);
    renderList();
  }

  function renderList() {
    kifuTab.list = Kifu.loadAllKifu();
    const container = document.getElementById('kifu-list');
    container.innerHTML = '';

    if (kifuTab.list.length === 0) {
      const p = document.createElement('p');
      p.className = 'hint-text';
      p.textContent = '保存された牌譜はまだありません。「対局」タブでCPU対局を行い、対局後に「牌譜を保存する」を押すとここに表示されます。';
      container.appendChild(p);
      return;
    }

    kifuTab.list.forEach((kifu, idx) => {
      const box = document.createElement('div');
      box.className = 'result-panel';
      const title = document.createElement('h3');
      const date = new Date(kifu.createdAt);
      title.textContent = `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')} の対局(全${kifu.rounds.length}局)`;
      box.appendChild(title);

      const controls = document.createElement('div');
      controls.className = 'controls';
      const openBtn = document.createElement('button');
      openBtn.className = 'primary';
      openBtn.textContent = '開く';
      openBtn.addEventListener('click', () => openMatch(idx));
      const deleteBtn = document.createElement('button');
      deleteBtn.textContent = '削除';
      deleteBtn.addEventListener('click', () => {
        Kifu.deleteKifu(idx);
        renderList();
      });
      controls.appendChild(openBtn);
      controls.appendChild(deleteBtn);
      box.appendChild(controls);
      container.appendChild(box);
    });
  }

  function openMatch(matchIndex) {
    kifuTab.selectedMatchIndex = matchIndex;
    kifuTab.selectedRoundIndex = 0;
    kifuTab.step = 0;
    document.getElementById('kifu-list').hidden = true;
    document.getElementById('kifu-viewer').hidden = false;
    renderStep();
  }

  function showList() {
    document.getElementById('kifu-list').hidden = false;
    document.getElementById('kifu-viewer').hidden = true;
    renderList();
  }

  function currentRoundRecord() {
    const kifu = kifuTab.list[kifuTab.selectedMatchIndex];
    return kifu.rounds[kifuTab.selectedRoundIndex];
  }

  function moveStep(delta) {
    const roundRecord = currentRoundRecord();
    const maxStep = roundRecord.events.length;
    let next = kifuTab.step + delta;
    if (next < 0) {
      if (kifuTab.selectedRoundIndex > 0) {
        kifuTab.selectedRoundIndex--;
        kifuTab.step = currentRoundRecord().events.length;
      } else {
        next = 0;
      }
    } else if (next > maxStep) {
      const kifu = kifuTab.list[kifuTab.selectedMatchIndex];
      if (kifuTab.selectedRoundIndex < kifu.rounds.length - 1) {
        kifuTab.selectedRoundIndex++;
        kifuTab.step = 0;
      } else {
        next = maxStep;
      }
    } else {
      kifuTab.step = next;
    }
    document.getElementById('kifu-analysis').hidden = true;
    renderStep();
  }

  function renderStep() {
    const roundRecord = currentRoundRecord();
    const state = Kifu.reconstructRoundState(roundRecord, kifuTab.step);

    document.getElementById('kifu-round-info').textContent =
      `局 ${kifuTab.selectedRoundIndex + 1} (親:${RELATIVE_LABELS[roundRecord.dealerSeat]})`;
    document.getElementById('kifu-step-info').textContent = `${kifuTab.step} / ${roundRecord.events.length} 手目`;

    const playersInfo = state.players.map((p, seat) => ({
      seat,
      name: `プレイヤー${seat}`,
      relativeLabel: RELATIVE_LABELS[seat],
      score: '-',
      windLabel: '',
      isDealer: seat === roundRecord.dealerSeat,
      isSelf: seat === 0,
      isTurn: seat === state.turnSeat,
      riichi: p.riichi,
      fuuroCount: p.fuuro.length,
      discards: p.discards,
    }));
    UI.renderPlayerStatusGrid(document.getElementById('kifu-player-status-grid'), playersInfo);
    UI.renderDiscardsGrid(document.getElementById('kifu-discards-grid'), playersInfo);

    const selfState = state.players[0];
    const tiles = Tiles.toTileList(selfState.handCounts);
    if (selfState.drawnTile !== null) tiles.push(selfState.drawnTile);
    tiles.sort((a, b) => a - b);
    UI.renderHand(document.getElementById('kifu-hand'), tiles, {});
  }

  function analyzeCurrentStep() {
    const roundRecord = currentRoundRecord();
    const state = Kifu.reconstructRoundState(roundRecord, kifuTab.step);
    const selfState = state.players[0];
    const counts = selfState.handCounts.slice();
    if (selfState.drawnTile !== null) counts[selfState.drawnTile]++;

    const panel = document.getElementById('kifu-analysis');
    panel.hidden = false;
    panel.innerHTML = '';

    const total = Tiles.totalCount(counts);
    if (total !== 14) {
      const p = document.createElement('p');
      p.className = 'hint-text';
      p.textContent = `この時点は${total}枚のため、打牌分析には14枚(ツモ直後)の場面を選んでください。`;
      panel.appendChild(p);
      return;
    }

    const analysis = Evaluator.analyzeHand(counts, { lockedMelds: selfState.fuuro.length });
    const title = document.createElement('h3');
    title.textContent = `このとき何を切るべきだった?(シャンテン: ${analysis.currentShanten})`;
    panel.appendChild(title);
    const ranking = document.createElement('ol');
    panel.appendChild(ranking);
    UI.renderRanking(ranking, analysis.discards, { limit: 3 });
  }

  window.MJ = window.MJ || {};
  window.MJ.AppKifu = { initKifuTab, refreshList: renderList };

  document.addEventListener('DOMContentLoaded', () => {
    initKifuTab();
  });
})();
