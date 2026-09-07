/**
 * livequiz.js
 * 対局中に出す学習問題の組み立てと、回答の評価。
 *
 * ■ 評価の考え方(V2.0)
 *  実戦では「唯一の正解」が決まらないことが多い。そのため評価は4段階にする。
 *   ◎ 非常に妥当 / ○ 十分あり / △ 注意点がある / × 明確に不利、またはルール上できない
 *  同じ評価になった候補はすべて正解として扱う。
 *  「CPUのおすすめと違う=不正解」にはしない。
 *
 * ■ 隠し情報
 *  ここでも livesnapshot.js のスナップショットしか受け取らない。
 *  相手の手牌・山の中身は引数に存在しないため、構造的に使えない。
 */
(function (root) {
  'use strict';

  let Tiles, Shanten, Ukeire, Evaluator, HandInfo, Defense, Reading, Melds, Coach, LiveSnapshot, LiveCoach;
  if (typeof module !== 'undefined' && module.exports) {
    Tiles = require('./tiles.js');
    Shanten = require('./shanten.js');
    Ukeire = require('./ukeire.js');
    Evaluator = require('./evaluator.js');
    HandInfo = require('./handinfo.js');
    Defense = require('./defense.js');
    Reading = require('./reading.js');
    Melds = require('./melds.js');
    Coach = require('./coach.js');
    LiveSnapshot = require('./livesnapshot.js');
    LiveCoach = require('./livecoach.js');
  } else {
    Tiles = root.MJ.Tiles;
    Shanten = root.MJ.Shanten;
    Ukeire = root.MJ.Ukeire;
    Evaluator = root.MJ.Evaluator;
    HandInfo = root.MJ.HandInfo;
    Defense = root.MJ.Defense;
    Reading = root.MJ.Reading;
    Melds = root.MJ.Melds;
    Coach = root.MJ.Coach;
    LiveSnapshot = root.MJ.LiveSnapshot;
    LiveCoach = root.MJ.LiveCoach;
  }

  // ==================================================
  // 評価の段階
  // ==================================================

  const GRADES = {
    excellent: { key: 'excellent', mark: '◎', label: '非常に妥当です', order: 4 },
    good: { key: 'good', mark: '○', label: '十分ありえる選択です', order: 3 },
    fair: { key: 'fair', mark: '△', label: '注意点があります', order: 2 },
    bad: { key: 'bad', mark: '×', label: '明確に不利、またはルール上できません', order: 1 },
  };

  const GRADE_KEYS = ['excellent', 'good', 'fair', 'bad'];

  /** 評価の理由を分ける軸。画面ではこの順に並べる。 */
  const AXES = [
    { key: 'efficiency', label: '牌効率(ハイコウリツ)' },
    { key: 'yaku', label: '役(ヤク)・打点' },
    { key: 'defense', label: '守備' },
    { key: 'score', label: '点棒状況' },
    { key: 'turn', label: '巡目' },
  ];

  function gradeOf(key) {
    return GRADES[key] || GRADES.fair;
  }

  function tileChoice(tile, index) {
    return { id: 't' + index, tile, label: Tiles.shortLabel(tile), value: tile };
  }

  function uniqueTiles(counts) {
    const out = [];
    for (let i = 0; i < Tiles.TILE_COUNT; i++) if (counts[i] > 0) out.push(i);
    return out;
  }

  // ==================================================
  // 何切る(打牌選択)の評価
  // ==================================================

  /**
   * 打牌候補ごとの評価を作る。攻め寄りか守り寄りかで評価の基準を変える。
   * @returns {{rows:Array, mode:string, bestKeys:string[]}}
   */
  function gradeDiscardCandidates(snapshot) {
    const hand = LiveCoach.handSummary(snapshot);
    const analysis = hand.analysis;
    if (!analysis) return { rows: [], mode: 'attack', pushfold: null };

    const safety = LiveCoach.safetyOverview(snapshot);
    const pushfold = LiveCoach.judgePushFold(snapshot);
    const underRiichi = safety.targets.length > 0;
    const mode = !underRiichi ? 'attack' : pushfold.recommendation === 'fold' ? 'defense' : pushfold.recommendation === 'push' ? 'attack' : 'balance';

    const best = analysis.discards[0];
    const bestShanten = best.resultShanten;
    const bestUkeire = best.ukeireTotal;
    const doraTiles = snapshot.doraTiles;
    const windCtx = { seatWind: snapshot.seatWind, roundWind: snapshot.roundWind };
    const RANK_ORDER = ['S', 'A', 'B', 'C', 'D', 'E'];
    const safestRank = safety.rows.length > 0 ? safety.rows[0].rank : null;

    const rows = analysis.discards.map((d) => {
      const safeRow = safety.byTile[d.tile] || null;
      const keepsShanten = d.resultShanten === bestShanten;
      const ukeireRatio = bestUkeire > 0 ? d.ukeireTotal / bestUkeire : 1;

      // ---- 牌効率の段階 ----
      let efficiency;
      if (!keepsShanten) efficiency = 'bad';
      else if (d.ukeireTotal === bestUkeire) efficiency = 'excellent';
      else if (ukeireRatio >= 0.7) efficiency = 'good';
      else efficiency = 'fair';

      // ---- 守備の段階 ----
      let defense = null;
      if (safeRow) {
        if (safeRow.rank === safestRank) defense = 'excellent';
        else if (safeRow.rank === 'A' || safeRow.rank === 'B') defense = 'good';
        else if (safeRow.rank === 'C') defense = 'fair';
        else defense = 'bad';
      }

      // ---- 打点・役の段階(切ったあとの手に役の見込みが残るか) ----
      const after = snapshot.counts14.slice();
      after[d.tile]--;
      const yakuAfter = LiveCoach.yakuCandidates(Object.assign({}, snapshot, { counts14: after }));
      const doraLost = doraTiles.indexOf(d.tile) !== -1;

      // ---- 総合評価 ----
      let grade;
      if (mode === 'defense') {
        grade = defense || efficiency;
        // 守備優先でも、安全度が同じなら手が進む方を上に見る
        if (grade === 'excellent' && efficiency === 'bad' && safeRow && safeRow.rank !== 'S' && safestRank !== 'S') {
          grade = 'good';
        }
      } else if (mode === 'attack') {
        grade = efficiency;
        // 押すと決めた場合でも、極端に危険な牌は一段下げる
        if (defense === 'bad' && grade === 'excellent') grade = 'good';
      } else {
        // 慎重: 効率と守備の低い方を採用する(両方そこそこの牌を上に出す)
        const eOrder = GRADES[efficiency].order;
        const dOrder = defense ? GRADES[defense].order : eOrder;
        const key = GRADE_KEYS.find((k) => GRADES[k].order === Math.min(eOrder, dOrder));
        grade = key || 'fair';
      }
      if (doraLost && grade === 'excellent' && mode !== 'defense') grade = 'good';

      return {
        tile: d.tile,
        label: d.label,
        resultShanten: d.resultShanten,
        ukeireTotal: d.ukeireTotal,
        ukeireKinds: d.ukeireKinds,
        ukeireTiles: (d.ukeireTiles || []).slice(0, 8),
        wasIsolated: d.wasIsolated,
        wasBlockType: d.wasBlockType,
        efficiency,
        defense,
        safetyCategory: safeRow ? safeRow.category : null,
        safetyRank: safeRow ? safeRow.rank : null,
        isGenbutsu: safeRow ? safeRow.isGenbutsuForAll : false,
        yakuAfter: yakuAfter.map((y) => y.name),
        doraLost,
        grade,
        gradeMark: gradeOf(grade).mark,
        reason: d.reason,
      };
    });

    // 最良の評価を持つ候補はすべて正解として扱う
    const topOrder = Math.max.apply(null, rows.map((r) => GRADES[r.grade].order));
    rows.forEach((r) => {
      r.isTop = GRADES[r.grade].order === topOrder;
    });

    return { rows, mode, pushfold, safety, analysis, bestShanten, bestUkeire };
  }

  // ==================================================
  // 問題の組み立て
  // ==================================================

  function discardQuestion(snapshot, moment) {
    const tiles = uniqueTiles(snapshot.counts14);
    return {
      kind: 'discard',
      title: '何を切る？',
      prompt: 'この手牌から切る牌を1つ選んでください。',
      note: moment && moment.reason ? moment.reason : '',
      choices: tiles.map(tileChoice),
      multi: false,
      tags: moment ? moment.tags : [LiveCoach.TAGS.efficiency],
      allowDiscardAfter: true,
    };
  }

  function waitQuestion(snapshot, moment) {
    const hand = LiveCoach.handSummary(snapshot);
    const analysis = hand.analysis;
    const waits = (analysis.recommended.ukeireTiles || []).map((u) => u.tile);
    // 選択肢: 実際の待ち + まぎらわしい牌(隣の牌など)。相手の手牌は一切使わない。
    const decoys = [];
    waits.forEach((w) => {
      [w - 1, w + 1, w - 3, w + 3].forEach((d) => {
        if (d < 0 || d >= Tiles.TILE_COUNT) return;
        if (Tiles.suitOf(d) !== Tiles.suitOf(w)) return;
        if (waits.indexOf(d) !== -1 || decoys.indexOf(d) !== -1) return;
        decoys.push(d);
      });
    });
    const pool = waits.concat(decoys.slice(0, Math.max(2, 6 - waits.length))).sort((a, b) => a - b);
    return {
      kind: 'wait',
      title: 'この手は何待ち？',
      prompt: (analysis.recommended.label + 'を切って聴牌(テンパイ)したとき、待ち牌になるものをすべて選んでください。'),
      note: '待ちは複数あることがあります。',
      choices: pool.map(tileChoice),
      multi: true,
      discardTile: analysis.recommended.tile,
      tags: moment ? moment.tags : [LiveCoach.TAGS.wait],
    };
  }

  function riichiQuestion(snapshot, moment) {
    return {
      kind: 'riichi',
      title: '今リーチできる？',
      prompt: 'この局面で、あなたはリーチを宣言できますか。',
      note: '門前(メンゼン)であること・聴牌(テンパイ)していることが条件です。',
      choices: [
        { id: 'yes', label: 'リーチできる', value: 'yes' },
        { id: 'no', label: 'リーチできない', value: 'no' },
      ],
      multi: false,
      tags: moment ? moment.tags : [LiveCoach.TAGS.riichi],
    };
  }

  function safetyQuestion(snapshot, moment) {
    const safety = LiveCoach.safetyOverview(snapshot);
    const tiles = uniqueTiles(snapshot.counts14);
    const targetLabels = safety.targets.map((t) => t.labelWithReading).join('・');
    return {
      kind: 'safety',
      title: '何が安全？',
      prompt: targetLabels + 'のリーチに対して、もっとも安全に近い牌を1つ選んでください。',
      note: safety.hasGenbutsu
        ? '現物(ゲンブツ)=その相手の河にある牌は、ロンされません。'
        : '現物(ゲンブツ)がありません。「安全な牌」ではなく「比較上もっとも危険が低い牌」を選びます。',
      choices: tiles.map(tileChoice),
      multi: false,
      tags: moment ? moment.tags : [LiveCoach.TAGS.defense],
    };
  }

  function readingQuestion(snapshot, moment) {
    const targetSeat = moment && moment.targetSeat !== undefined ? moment.targetSeat : snapshot.targetSeat;
    const board = LiveSnapshot.boardView(snapshot, targetSeat);
    const target = snapshot.players.find((p) => p.seat === targetSeat);
    const direction = Reading.handDirection(board);

    const statements = [];
    const suitNames = { m: '萬子(マンズ)', p: '筒子(ピンズ)', s: '索子(ソウズ)' };
    ['m', 'p', 's'].forEach((suit) => {
      if (direction.honitsu && direction.honitsu.suit === suit) {
        statements.push({ label: suitNames[suit] + 'の混一色(ホンイツ)が考えられる', statement: { type: 'honitsu', suit } });
      }
    });
    if (statements.length === 0) {
      statements.push({ label: '萬子(マンズ)の混一色(ホンイツ)が考えられる', statement: { type: 'honitsu', suit: 'm' } });
    }
    statements.push({ label: '対々和(トイトイ)が考えられる', statement: { type: 'toitoi' } });
    statements.push({ label: target.riichi ? 'この相手はリーチしている' : 'この相手は鳴いている(門前ではない)', statement: target.riichi ? { type: 'riichi' } : { type: 'open-hand' } });

    // 現物・筋は自分の手牌から1枚選んで題材にする
    const handTiles = uniqueTiles(snapshot.counts14);
    const ctx = Defense.buildContext(board);
    const genbutsuTile = handTiles.find((t) => Defense.isGenbutsu(t, ctx));
    if (genbutsuTile !== undefined) {
      statements.push({ label: Tiles.shortLabel(genbutsuTile) + 'は現物(ゲンブツ)なので、この相手には当たらない', statement: { type: 'genbutsu', tile: genbutsuTile } });
    } else if (handTiles.length > 0) {
      const t = handTiles[0];
      statements.push({ label: Tiles.shortLabel(t) + 'は現物(ゲンブツ)である', statement: { type: 'genbutsu', tile: t } });
    }
    statements.push({ label: 'この河だけで、待ちを1つに断定できる', statement: { type: 'certain-wait' } });

    return {
      kind: 'reading',
      title: '相手の河から何が読める？',
      prompt: (target ? target.labelWithReading : '相手') + 'について、公開されている情報から正しく言えることをすべて選んでください。',
      note: '相手の手牌は見えません。河(カワ)と鳴き、ドラ表示牌だけで考えます。',
      choices: statements.map((s, i) => ({ id: 's' + i, label: s.label, statement: s.statement, value: 'st' + i })),
      multi: true,
      targetSeat,
      tags: moment ? moment.tags : [LiveCoach.TAGS.reading],
    };
  }

  function pushfoldQuestion(snapshot, moment) {
    const safety = LiveCoach.safetyOverview(snapshot);
    return {
      kind: 'pushfold',
      title: '押す・慎重・降りる',
      prompt: safety.targets.map((t) => t.labelWithReading).join('・') + 'のリーチに対して、この局面の進め方を選んでください。',
      note: '正解が1つに決まらない場面もあります。理由を確認することが大切です。',
      choices: [
        { id: 'push', label: '押す(手を進める)', value: 'push' },
        { id: 'cautious', label: '慎重に進める', value: 'cautious' },
        { id: 'fold', label: '降りる(安全を優先)', value: 'fold' },
      ],
      multi: false,
      tags: moment ? moment.tags : [LiveCoach.TAGS.pushfold],
    };
  }

  /**
   * 鳴き判断。call フェーズでのみ作る。
   * @param {object} callInfo {action:'pon'|'chi'|'kan', tile, chiTiles}
   */
  function callQuestion(snapshot, callInfo) {
    const actionLabel = { pon: 'ポン', chi: 'チー', kan: 'カン' }[callInfo.action] || callInfo.action;
    return {
      kind: 'call',
      title: '鳴く？鳴かない？',
      prompt: Tiles.shortLabel(callInfo.tile) + 'を' + actionLabel + 'できます。鳴くべきでしょうか。',
      note: '鳴く(副露=フーロする)と門前(メンゼン)ではなくなり、リーチ・平和(ピンフ)・門前清自摸和が使えなくなります。',
      choices: [
        { id: 'call', label: actionLabel + 'する', value: 'call' },
        { id: 'pass', label: '鳴かない(スルー)', value: 'pass' },
      ],
      multi: false,
      callInfo,
      tags: [LiveCoach.TAGS.call, LiveCoach.TAGS.yaku],
    };
  }

  const BUILDERS = {
    discard: discardQuestion,
    wait: waitQuestion,
    riichi: riichiQuestion,
    safety: safetyQuestion,
    reading: readingQuestion,
    pushfold: pushfoldQuestion,
  };

  /**
   * 検出した局面から問題を作る。
   * @param {object} snapshot
   * @param {object} moment detectLearningMoments が返した1件
   */
  function buildQuestion(snapshot, moment) {
    const builder = BUILDERS[moment.kind];
    if (!builder) throw new Error('未知の学習局面: ' + moment.kind);
    const question = builder(snapshot, moment);
    question.momentKind = moment.kind;
    question.turn = snapshot.turn;
    question.priority = moment.priority;
    question.id = 'live-' + moment.kind + '-t' + snapshot.turn;
    return question;
  }

  // ==================================================
  // 回答の評価
  // ==================================================

  function axisEntry(key, text) {
    const axis = AXES.find((a) => a.key === key);
    return { key, label: axis ? axis.label : key, text };
  }

  function commonAxes(snapshot, extra) {
    const list = [];
    (extra || []).forEach((e) => list.push(e));
    const turn = snapshot.turn;
    list.push(
      axisEntry(
        'turn',
        turn <= 6
          ? turn + '巡目とまだ早い段階なので、手を作る余地があります。'
          : turn >= 13
          ? turn + '巡目と終盤なので、安全度を重く見る場面が増えます。'
          : turn + '巡目です。手の進み具合と相手の動きを両方見る時間帯です。'
      )
    );
    const my = snapshot.scores[snapshot.seat];
    const maxOther = Math.max.apply(null, snapshot.scores.filter((s, i) => i !== snapshot.seat));
    const diff = my - maxOther;
    list.push(
      axisEntry(
        'score',
        diff >= 8000
          ? '持ち点でリードしているため、放銃(ホウジュウ)を避ける価値が高い状況です。'
          : diff <= -8000
          ? '持ち点で離されているため、手を作りにいく価値が高い状況です。'
          : '持ち点は競っています。無理をしすぎない範囲で手を進めましょう。'
      )
    );
    return list;
  }

  function evaluateDiscard(snapshot, question, selectedIds) {
    const graded = gradeDiscardCandidates(snapshot);
    const choice = question.choices.find((c) => c.id === selectedIds[0]);
    const row = choice ? graded.rows.find((r) => r.tile === choice.tile) : null;
    const topRows = graded.rows.filter((r) => r.isTop);
    const correctIds = question.choices.filter((c) => topRows.some((r) => r.tile === c.tile)).map((c) => c.id);
    const grade = row ? row.grade : 'bad';

    const axes = [];
    if (row) {
      const bestRow = graded.rows.find((r) => r.resultShanten === graded.bestShanten && r.ukeireTotal === graded.bestUkeire);
      const bestText = bestRow ? bestRow.label + '(' + graded.bestShanten + 'シャンテン・受け入れ' + graded.bestUkeire + '枚)' : '';
      let efficiencyText = row.label + 'を切ると' + row.resultShanten + 'シャンテン・受け入れ' + row.ukeireTotal + '枚(' + row.ukeireKinds + '種類)です。';
      if (row.resultShanten > graded.bestShanten) {
        // 受け入れ枚数だけを見ると多く見えることがあるが、シャンテン数が戻っている
        efficiencyText +=
          'ただしシャンテン数が' + graded.bestShanten + 'から' + row.resultShanten + 'へ戻ってしまいます。' +
          '枚数が多くてもアガリからは遠くなるので、まずはシャンテン数を優先します。最善は' + bestText + 'でした。';
      } else if (row.ukeireTotal < graded.bestUkeire) {
        efficiencyText += 'もっとも広いのは' + bestText + 'でした。';
      } else {
        efficiencyText += 'この中でもっとも受け入れが広い選択です。';
      }
      axes.push(axisEntry('efficiency', efficiencyText));
      axes.push(
        axisEntry(
          'yaku',
          (row.yakuAfter.length > 0 ? '切ったあとも「' + row.yakuAfter.join('・') + '」が狙えます。' : '切ったあと、今のところ狙える役は見えていません。') +
            (row.doraLost ? 'ドラを手放すため打点は下がります。' : '')
        )
      );
      if (row.safetyCategory) {
        axes.push(
          axisEntry(
            'defense',
            row.label + 'は' + row.safetyCategory + 'です。' +
              (graded.safety.hasGenbutsu
                ? '現物(ゲンブツ)は' + graded.safety.rows.filter((r) => r.isGenbutsuForAll).map((r) => r.label).join('・') + 'です。'
                : '現物がないため、比較上もっとも危険が低いのは' + graded.safety.rows[0].label + 'です(安全とは言い切れません)。')
          )
        );
      } else {
        axes.push(axisEntry('defense', 'まだリーチが入っていないため、守備よりも手を進めることを優先できます。'));
      }
    }

    return {
      grade,
      correctIds,
      rows: graded.rows,
      mode: graded.mode,
      pushfold: graded.pushfold,
      axes: commonAxes(snapshot, axes),
      chosen: row,
      topLabels: topRows.map((r) => r.label),
    };
  }

  function evaluateWait(snapshot, question, selectedIds) {
    const hand = LiveCoach.handSummary(snapshot);
    const counts13 = snapshot.counts14.slice();
    counts13[question.discardTile]--;
    const ukeire = Ukeire.calcUkeire(counts13, { lockedMelds: snapshot.fuuroCount, visibleCounts: snapshot.visibleCounts });
    const waits = ukeire.shanten === 0 ? ukeire.tiles.map((t) => t.tile) : [];
    const selectedTiles = selectedIds.map((id) => (question.choices.find((c) => c.id === id) || {}).tile).filter((t) => t !== undefined);
    const correctIds = question.choices.filter((c) => waits.indexOf(c.tile) !== -1).map((c) => c.id);

    const missing = waits.filter((w) => selectedTiles.indexOf(w) === -1);
    const wrong = selectedTiles.filter((t) => waits.indexOf(t) === -1);
    let grade;
    if (waits.length === 0) grade = selectedTiles.length === 0 ? 'excellent' : 'bad';
    else if (missing.length === 0 && wrong.length === 0) grade = 'excellent';
    else if (wrong.length === 0) grade = 'fair';
    else if (missing.length === 0) grade = 'good';
    else grade = 'bad';

    const waitInfo = HandInfo.classifyWait(counts13);
    const furiten = waits.some((w) => snapshot.ownDiscards.some((d) => d.tile === w));
    const detail = {
      waits: ukeire.tiles.map((t) => ({ tile: t.tile, label: Tiles.shortLabel(t.tile), remaining: t.remaining })),
      shapeLabels: waitInfo && waitInfo.labels ? waitInfo.labels : [],
      totalRemaining: ukeire.tiles.reduce((s, t) => s + t.remaining, 0),
      furiten,
    };

    const axes = [
      axisEntry(
        'efficiency',
        '待ちは' + detail.waits.map((w) => w.label).join('・') + 'で、見えている牌を除いた残りは合計' + detail.totalRemaining + '枚です。'
      ),
      axisEntry(
        'yaku',
        (LiveCoach.yakuCandidates(snapshot).length > 0
          ? '狙える役: ' + LiveCoach.yakuCandidates(snapshot).map((y) => y.name).join('・') + '。'
          : '今のところ役が見えていません。門前(メンゼン)ならリーチで役を付けられます。')
      ),
      axisEntry(
        'defense',
        furiten
          ? 'この待ちは自分の河にある牌を含むためフリテンです。ロンはできず、ツモのみになります。'
          : 'フリテンではないので、ロンもツモもできます。'
      ),
    ];

    return { grade, correctIds, detail, axes: commonAxes(snapshot, axes) };
  }

  function evaluateRiichi(snapshot, question, selectedIds) {
    const hand = LiveCoach.handSummary(snapshot);
    const isMenzen = snapshot.fuuroCount === 0;
    const analysis = hand.analysis;
    const canTenpai = analysis && analysis.recommended.resultShanten === 0;
    const canRiichi = isMenzen && canTenpai && !snapshot.isRiichi && snapshot.wallCount >= 4;
    const answer = canRiichi ? 'yes' : 'no';
    const selected = selectedIds[0];
    const grade = selected === answer ? 'excellent' : 'bad';
    const correctIds = [answer];

    const waits = analysis && canTenpai ? (analysis.recommended.ukeireTiles || []) : [];
    const furiten = waits.some((w) => snapshot.ownDiscards.some((d) => d.tile === w.tile));

    const axes = [
      axisEntry('efficiency', isMenzen ? '副露(フーロ)していないので門前(メンゼン)です。' : '副露しているため門前ではなく、リーチはできません。'),
      axisEntry(
        'yaku',
        canTenpai
          ? analysis.recommended.label + 'を切れば聴牌(テンパイ)します。リーチすれば役が付くので、役がない手でもアガれるようになります。'
          : '今は聴牌していないため、リーチの条件を満たしていません。'
      ),
      axisEntry(
        'defense',
        canRiichi
          ? 'リーチ後は手を変えられません。' + (furiten ? 'さらにこの待ちはフリテンのため、ロンできずツモのみになります。' : '降りられなくなる点も考えて決めましょう。')
          : 'リーチできない場合は、聴牌を目指すか安全に進めるかを選びます。'
      ),
    ];

    return {
      grade,
      correctIds,
      detail: {
        isMenzen,
        canTenpai,
        canRiichi,
        furiten,
        waits: waits.map((w) => ({ tile: w.tile, label: w.label, remaining: w.remaining })),
        discardTile: canTenpai ? analysis.recommended.tile : null,
      },
      axes: commonAxes(snapshot, axes),
    };
  }

  function evaluateSafety(snapshot, question, selectedIds) {
    const safety = LiveCoach.safetyOverview(snapshot);
    const choice = question.choices.find((c) => c.id === selectedIds[0]);
    const row = choice ? safety.byTile[choice.tile] : null;
    const bestRank = safety.rows.length > 0 ? safety.rows[0].rank : null;
    const correctIds = question.choices.filter((c) => safety.byTile[c.tile] && safety.byTile[c.tile].rank === bestRank).map((c) => c.id);

    let grade = 'bad';
    if (row) {
      if (row.rank === bestRank) grade = 'excellent';
      else if (row.rank === 'A' || row.rank === 'B') grade = 'good';
      else if (row.rank === 'C') grade = 'fair';
      else grade = 'bad';
    }

    const detail = {
      hasGenbutsu: safety.hasGenbutsu,
      rows: safety.rows.slice(0, 8),
      targets: safety.targets.map((t) => ({ seat: t.seat, label: t.labelWithReading })),
      chosen: row,
      note: safety.hasGenbutsu
        ? '現物(ゲンブツ)はロンされません。まずここから切るのが基本です。'
        : '現物がないため、どれも「安全」とは言い切れません。比較上もっとも危険が低い牌を選ぶ場面です。',
    };

    const axes = [
      axisEntry(
        'defense',
        row
          ? row.label + 'は' + row.category + 'です。' + (row.perTarget.length > 1 ? '相手ごとに評価が変わるため、' + row.perTarget.map((pt) => pt.label + 'に対して' + pt.category).join('、') + 'です。' : '')
          : '牌を選べていません。'
      ),
      axisEntry('efficiency', '守備を優先する場面では、受け入れよりも当たらないことを優先します。'),
      axisEntry('yaku', '安全に回った局は、次の局で手を作り直せます。無理に押して放銃するより損が小さくなります。'),
    ];

    return { grade, correctIds, detail, axes: commonAxes(snapshot, axes) };
  }

  function evaluateReading(snapshot, question, selectedIds) {
    const board = LiveSnapshot.boardView(snapshot, question.targetSeat);
    const trueIds = question.choices.filter((c) => Reading.evaluateStatement(board, c.statement)).map((c) => c.id);
    const selected = selectedIds.slice();
    const missing = trueIds.filter((id) => selected.indexOf(id) === -1);
    const wrong = selected.filter((id) => trueIds.indexOf(id) === -1);

    let grade;
    if (missing.length === 0 && wrong.length === 0) grade = 'excellent';
    else if (wrong.length === 0) grade = 'good';
    else if (wrong.length === 1 && missing.length === 0) grade = 'fair';
    else grade = 'bad';

    const clues = Reading.riverClues(board);
    const target = snapshot.players.find((p) => p.seat === question.targetSeat);
    const axes = [
      axisEntry('defense', '河(カワ)と鳴きから分かるのは候補を絞ることまでで、待ちを1つに断定することはできません。'),
      axisEntry(
        'yaku',
        (Reading.handDirection(board).notes || []).join(' ') || (target ? target.labelWithReading + 'の手の方向は、まだはっきりしません。' : '')
      ),
      axisEntry('efficiency', '読みで危険な牌を減らせても、自分の手が進まなければアガれません。両方のバランスを考えます。'),
    ];

    return { grade, correctIds: trueIds, detail: { clues, target: target ? target.labelWithReading : '相手' }, axes: commonAxes(snapshot, axes) };
  }

  function evaluatePushFoldAnswer(snapshot, question, selectedIds) {
    const judged = LiveCoach.judgePushFold(snapshot);
    const selected = selectedIds[0];
    const ORDER = ['fold', 'cautious', 'push'];
    const distance = Math.abs(ORDER.indexOf(selected) - ORDER.indexOf(judged.recommendation));

    let grade;
    if (distance === 0) grade = 'excellent';
    else if (distance === 1) grade = judged.confidence === 'low' ? 'excellent' : 'good';
    else grade = 'fair';
    // 「押す」と「降りる」は正反対だが、実戦では成立し得るため×にはしない
    const correctIds = question.choices
      .filter((c) => {
        const d = Math.abs(ORDER.indexOf(c.value) - ORDER.indexOf(judged.recommendation));
        return d === 0 || (d === 1 && judged.confidence === 'low');
      })
      .map((c) => c.id);

    const axes = [
      axisEntry('defense', judged.negativeFactors.map((f) => f.text).join(' ') || '守備面で特に大きな不安はありません。'),
      axisEntry('efficiency', judged.positiveFactors.map((f) => f.text).join(' ') || '押す材料は多くありません。'),
      axisEntry('yaku', '打点が見えている手ほど押す価値が上がり、安い手ほど降りる価値が上がります。'),
    ];

    return { grade, correctIds, detail: judged, axes: commonAxes(snapshot, axes) };
  }

  function evaluateCall(snapshot, question, selectedIds) {
    const info = question.callInfo;
    const advice = Coach.evaluateCallAdvice({
      handCounts: snapshot.handCounts,
      fuuro: snapshot.melds,
      action: info.action,
      tile: info.tile,
      chiTiles: info.chiTiles,
      windCtx: { seatWind: snapshot.seatWind, roundWind: snapshot.roundWind },
    });
    const shantenBefore = Shanten.calcShanten(snapshot.handCounts, snapshot.fuuroCount).shanten;
    let applied;
    if (info.action === 'pon') applied = Melds.applyPon(snapshot.handCounts, info.tile, 0);
    else if (info.action === 'kan') applied = Melds.applyMinkan(snapshot.handCounts, info.tile, 0);
    else applied = Melds.applyChi(snapshot.handCounts, info.chiTiles, info.tile, 0);
    const shantenAfter = Shanten.calcShanten(applied.handCounts, snapshot.fuuroCount + 1).shanten;
    const yakuCheck = Coach.hasYakuPotential(applied.handCounts, snapshot.melds.concat([applied.meld]), {
      seatWind: snapshot.seatWind,
      roundWind: snapshot.roundWind,
    });

    const shouldCall = advice.grade === 'good';
    const selected = selectedIds[0];
    let grade;
    if (advice.grade === 'good') grade = selected === 'call' ? 'excellent' : 'good';
    else if (advice.grade === 'bad') grade = selected === 'pass' ? 'excellent' : 'bad';
    else if (advice.grade === 'caution') grade = selected === 'pass' ? 'excellent' : 'fair';
    else grade = selected === 'pass' ? 'excellent' : 'good';
    const correctIds = grade === 'excellent' ? [selected] : question.choices.filter((c) => (shouldCall ? c.value === 'call' : c.value === 'pass')).map((c) => c.id);

    const axes = [
      axisEntry(
        'efficiency',
        '鳴く前は' + shantenBefore + 'シャンテン、鳴いたあとは' + shantenAfter + 'シャンテンになります。' +
          (shantenAfter < shantenBefore ? '手は進みます。' : shantenAfter === shantenBefore ? '手は進みません。' : 'かえって遠くなります。')
      ),
      axisEntry(
        'yaku',
        yakuCheck.ok
          ? '鳴いても' + yakuCheck.reason + 'ので、アガリにつながります。'
          : '鳴くと門前(メンゼン)でなくなり、リーチ・平和(ピンフ)・門前清自摸和が使えません。今のところ代わりの役も見えていません。'
      ),
      axisEntry(
        'defense',
        '鳴くと門前(メンゼン)でなくなり、手牌も減ります。あとで守りに使える牌が減るため、安全牌を持ちにくくなる点も考えます。'
      ),
    ];

    return { grade, correctIds, detail: { advice, shantenBefore, shantenAfter, yakuCheck }, axes: commonAxes(snapshot, axes) };
  }

  const EVALUATORS = {
    discard: evaluateDiscard,
    wait: evaluateWait,
    riichi: evaluateRiichi,
    safety: evaluateSafety,
    reading: evaluateReading,
    pushfold: evaluatePushFoldAnswer,
    call: evaluateCall,
  };

  /**
   * 回答を評価する。
   * @param {object} snapshot 出題時のスナップショット(対局状態ではない)
   * @param {object} question buildQuestion が返した問題
   * @param {string[]} selectedIds 選んだ選択肢のID
   */
  function evaluateAnswer(snapshot, question, selectedIds) {
    const evaluator = EVALUATORS[question.kind];
    if (!evaluator) throw new Error('未知の問題形式: ' + question.kind);
    const result = evaluator(snapshot, question, (selectedIds || []).slice());
    const grade = gradeOf(result.grade);
    return Object.assign(
      {
        gradeKey: grade.key,
        gradeMark: grade.mark,
        gradeLabel: grade.label,
        selectedIds: (selectedIds || []).slice(),
        // △・× は復習候補にする
        shouldReview: grade.key === 'fair' || grade.key === 'bad',
        kind: question.kind,
        tags: question.tags || [],
      },
      result
    );
  }

  const LiveQuiz = {
    GRADES,
    GRADE_KEYS,
    AXES,
    gradeOf,
    gradeDiscardCandidates,
    buildQuestion,
    callQuestion,
    evaluateAnswer,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = LiveQuiz;
  } else {
    root.MJ = root.MJ || {};
    root.MJ.LiveQuiz = LiveQuiz;
  }
})(typeof window !== 'undefined' ? window : globalThis);
