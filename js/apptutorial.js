/**
 * apptutorial.js
 * 「学習」タブ。初心者向けのステップ一覧を表示し、関連するタブへ誘導する。
 * 新しい教材コンテンツを作るのではなく、既存の各タブを順番に案内する構成。
 */
(function () {
  'use strict';

  const STEPS = [
    {
      title: 'STEP1: 面子(メンツ)を作る',
      body: '麻雀は「3枚組(面子)を4つ+2枚組(雀頭)1つ」を作るゲームです。まずは用語辞典で「面子」「順子」「刻子」「雀頭」を確認しましょう。',
      targetTab: 'dictionary',
      buttonLabel: '用語辞典を見る',
    },
    {
      title: 'STEP2: シャンテン数を覚える',
      body: 'テンパイ(あと1枚でアガリ)まで何回良い牌を引けば良いかを表す数字が「シャンテン数」です。トレーニングタブで実際に打牌しながら体感しましょう。',
      targetTab: 'training',
      buttonLabel: 'トレーニングを試す',
    },
    {
      title: 'STEP3: 両面(リャンメン)を覚える',
      body: '3・4のように連続した2枚は、2か5を引けばアガれる強い形(両面)です。何切る問題で「なぜその牌を残すのか」の解説を読んでみましょう。',
      targetTab: 'mondai',
      buttonLabel: '何切る問題を試す',
    },
    {
      title: 'STEP4: 役を覚える',
      body: 'アガるには「役」が最低1つ必要です。局面分析タブで手牌を作り、アガリ形にしてから「アガリ条件を設定」で役・点数を確認してみましょう。',
      targetTab: 'analysis',
      buttonLabel: '局面分析を試す',
    },
    {
      title: 'STEP5: リーチを覚える',
      body: 'テンパイ(役が無くても)すればリーチができ、1翻つきます。対局タブでCPU相手にテンパイしたら「リーチ」ボタンを押してみましょう。',
      targetTab: 'game',
      buttonLabel: '対局を試す',
    },
    {
      title: 'STEP6: 鳴き(ポン・チー・カン)を覚える',
      body: '他家の捨て牌をもらって面子を作ることを「鳴き」と言います。対局タブでは他家が捨てた牌に応じてポン・チー・カンの選択肢が自動で表示されます。',
      targetTab: 'game',
      buttonLabel: '対局を試す',
    },
    {
      title: 'STEP7: 安全牌を覚える',
      body: '他家がリーチしたら、自分の手が悪ければ無理をせず安全牌を切ることも大切です。対局タブの「コーチ:フルコーチ」で、安全度の目安を確認しながら打ってみましょう。',
      targetTab: 'game',
      buttonLabel: '対局を試す',
    },
  ];

  function initTutorialTab() {
    const container = document.getElementById('tutorial-list');
    container.innerHTML = '';
    STEPS.forEach((step) => {
      const box = document.createElement('div');
      box.className = 'result-panel';
      const title = document.createElement('h3');
      title.textContent = step.title;
      const body = document.createElement('p');
      body.textContent = step.body;
      const btn = document.createElement('button');
      btn.className = 'primary';
      btn.textContent = step.buttonLabel;
      btn.addEventListener('click', () => {
        const tabBtn = document.querySelector(`.tab-btn[data-tab="${step.targetTab}"]`);
        if (tabBtn) tabBtn.click();
      });
      box.appendChild(title);
      box.appendChild(body);
      box.appendChild(btn);
      container.appendChild(box);
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    initTutorialTab();
  });
})();
