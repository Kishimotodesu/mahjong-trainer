/**
 * livecoach.js
 * 対局中の「学習価値がある局面」の検出と、押し引き(オシヒキ)の判断エンジン。
 *
 * ■ 前提(V2.0で最も大事なルール)
 *  この中の関数は livesnapshot.js が作った公開情報だけのスナップショットしか受け取らない。
 *  CPUの手牌・山の中身は引数にすら現れないため、構造的に隠し情報を使えない。
 *
 * ■ 何を返さないか
 *  放銃率・勝率のようなパーセントは一切返さない。
 *  押し引きは「初心者向けのルールベースの目安」であり、統計的な最適解ではない。
 */
(function (root) {
  'use strict';

  let Tiles, Shanten, Ukeire, Evaluator, HandInfo, Defense, Reading, YakuCandidates, LiveSnapshot;
  if (typeof module !== 'undefined' && module.exports) {
    Tiles = require('./tiles.js');
    Shanten = require('./shanten.js');
    Ukeire = require('./ukeire.js');
    Evaluator = require('./evaluator.js');
    HandInfo = require('./handinfo.js');
    Defense = require('./defense.js');
    Reading = require('./reading.js');
    YakuCandidates = require('./yakucandidates.js');
    LiveSnapshot = require('./livesnapshot.js');
  } else {
    Tiles = root.MJ.Tiles;
    Shanten = root.MJ.Shanten;
    Ukeire = root.MJ.Ukeire;
    Evaluator = root.MJ.Evaluator;
    HandInfo = root.MJ.HandInfo;
    Defense = root.MJ.Defense;
    Reading = root.MJ.Reading;
    YakuCandidates = root.MJ.YakuCandidates;
    LiveSnapshot = root.MJ.LiveSnapshot;
  }

  // ==================================================
  // 学習タグ(既存クイズの学習タグと対応させ、弱点から復習コースへ案内できるようにする)
  // ==================================================

  const TAGS = {
    efficiency: 'live-efficiency', // 牌効率・何切る
    shape: 'live-shape', // 形の選択(孤立牌・両面・嵌張)
    tenpai: 'live-tenpai', // 聴牌・待ち
    wait: 'live-wait', // 待ちの種類
    yaku: 'live-yaku', // 役・打点
    riichi: 'live-riichi', // リーチ判断
    furiten: 'live-furiten', // フリテン
    genbutsu: 'live-genbutsu', // 現物
    suji: 'live-suji', // 筋・壁・ワンチャンス
    defense: 'live-defense', // 守備全般
    reading: 'live-reading', // 河読み
    pushfold: 'live-pushfold', // 押し引き
    call: 'live-call', // 鳴き判断
  };

  /** 苦手だったときに案内する既存コース */
  const TAG_TO_COURSE = {
    'live-efficiency': null, // 何切る(トレーニングタブ)へ案内する
    'live-shape': null,
    'live-tenpai': 'wait',
    'live-wait': 'wait',
    'live-yaku': 'yaku',
    'live-riichi': 'yaku',
    'live-furiten': 'furiten',
    'live-genbutsu': 'genbutsu',
    'live-suji': 'defense',
    'live-defense': 'defense',
    'live-reading': 'reading',
    'live-pushfold': 'defense',
    'live-call': 'yaku',
  };

  const TAG_LABELS = {
    'live-efficiency': '牌効率(ハイコウリツ)',
    'live-shape': '形の選び方',
    'live-tenpai': '聴牌(テンパイ)判断',
    'live-wait': '待ちの読み取り',
    'live-yaku': '役(ヤク)・打点',
    'live-riichi': 'リーチ判断',
    'live-furiten': 'フリテン',
    'live-genbutsu': '現物(ゲンブツ)',
    'live-suji': '筋(スジ)・壁(カベ)',
    'live-defense': '守備',
    'live-reading': '河(カワ)読み',
    'live-pushfold': '押し引き(オシヒキ)',
    'live-call': '鳴き(ナキ)判断',
  };

  // ==================================================
  // 手牌の基本情報(公開情報だけで計算できるもの)
  // ==================================================

  /**
   * 自分の手牌についての基本情報。相手の手牌は使わない。
   */
  function handSummary(snapshot) {
    const counts = snapshot.counts14;
    const locked = snapshot.fuuroCount;
    const total = Tiles.totalCount(counts) + locked * 3;
    const has14 = total === 14;
    const analysis = has14 ? Evaluator.analyzeHand(counts, { lockedMelds: locked, visibleCounts: snapshot.visibleCounts }) : null;
    const counts13 = has14 && snapshot.drawnTile !== null ? snapshot.handCounts.slice() : counts.slice();
    const ukeire = Ukeire.calcUkeire(counts13, { lockedMelds: locked, visibleCounts: snapshot.visibleCounts });
    const shanten13 = ukeire.shanten;
    const shanten = analysis ? analysis.currentShanten : shanten13;

    return {
      analysis,
      shanten,
      shanten13,
      isTenpai13: shanten13 === 0,
      ukeire,
      waits: shanten13 === 0 ? ukeire.tiles.map((t) => t.tile) : [],
      waitDetails: shanten13 === 0 ? ukeire.tiles.slice() : [],
      isMenzen: locked === 0,
      lockedMelds: locked,
    };
  }

  /** 手の中のドラ枚数(公開されているドラ表示牌からのみ計算する) */
  function doraCount(snapshot) {
    let n = 0;
    snapshot.doraTiles.forEach((t) => {
      n += snapshot.counts14[t] || 0;
    });
    snapshot.melds.forEach((m) => m.tiles.forEach((t) => {
      if (snapshot.doraTiles.indexOf(t) !== -1) n++;
    }));
    return n;
  }

  /** 狙えそうな役(yakucandidates.js のヒューリスティック)。確定した役ではない。 */
  function yakuCandidates(snapshot) {
    return YakuCandidates.detectYakuCandidates(snapshot.counts14, {
      seatWind: snapshot.seatWind,
      roundWind: snapshot.roundWind,
    });
  }

  /**
   * おおよその打点感(翻数の目安)。統計ではなく「見えている材料の数」。
   */
  function roughHan(snapshot) {
    const dora = doraCount(snapshot);
    const candidates = yakuCandidates(snapshot);
    const yakuHan = candidates.length > 0 ? 1 : 0;
    const riichiHan = snapshot.fuuroCount === 0 ? 1 : 0;
    return dora + yakuHan + riichiHan;
  }

  // ==================================================
  // 守備の材料(公開情報だけ)
  // ==================================================

  /**
   * 各リーチ者に対する、自分の手牌の安全度をまとめる。
   * 相手が複数いる場合は「もっとも危険な評価」を採用する(1人にでも当たれば放銃のため)。
   */
  function safetyOverview(snapshot) {
    const targets = LiveSnapshot.riichiOpponentsOf(snapshot);
    const tiles = Tiles.toTileList(snapshot.counts14).filter((t, i, arr) => arr.indexOf(t) === i);
    if (targets.length === 0) return { targets: [], rows: [], hasGenbutsu: false, safestTiles: [], byTile: {} };

    const perTarget = targets.map((t) => {
      const ctx = Defense.buildContext(LiveSnapshot.boardView(snapshot, t.seat));
      return { target: t, ctx, evaluation: Defense.evaluateCandidates(tiles, ctx) };
    });

    const RANK_ORDER = ['S', 'A', 'B', 'C', 'D', 'E'];
    const byTile = {};
    tiles.forEach((tile) => {
      let worstRank = 'S';
      let worstScore = Infinity;
      const perTargetRows = [];
      perTarget.forEach((pt) => {
        const row = pt.evaluation.candidates.find((c) => c.tile === tile);
        perTargetRows.push({ seat: pt.target.seat, label: pt.target.label, rank: row.rank, category: Defense.categoryOf(row.rank), row });
        if (RANK_ORDER.indexOf(row.rank) > RANK_ORDER.indexOf(worstRank)) worstRank = row.rank;
        worstScore = Math.min(worstScore, row.score);
      });
      byTile[tile] = {
        tile,
        label: Tiles.shortLabel(tile),
        rank: worstRank,
        score: worstScore,
        category: Defense.categoryOf(worstRank),
        isGenbutsuForAll: perTargetRows.every((r) => r.rank === 'S'),
        perTarget: perTargetRows,
      };
    });

    const rows = tiles.map((t) => byTile[t]).sort((a, b) => {
      const ra = RANK_ORDER.indexOf(a.rank);
      const rb = RANK_ORDER.indexOf(b.rank);
      if (ra !== rb) return ra - rb;
      return b.score - a.score;
    });
    const bestRank = rows.length > 0 ? rows[0].rank : null;
    const safestTiles = rows.filter((r) => r.rank === bestRank).map((r) => r.tile);

    return {
      targets,
      perTarget,
      rows,
      byTile,
      safestTiles,
      hasGenbutsu: rows.some((r) => r.isGenbutsuForAll),
      // 現物が無くても「安全」とは言わない。あくまで比較上もっとも危険が低い牌。
      safestLabel: rows.some((r) => r.isGenbutsuForAll) ? '現物(ゲンブツ)' : '比較上もっとも危険が低い牌',
    };
  }

  // ==================================================
  // 押し引き(オシヒキ)判断エンジン
  // ==================================================

  const RECOMMENDATION = {
    push: { key: 'push', label: '押す', description: '手を進める方向で考えやすい局面です。' },
    cautious: { key: 'cautious', label: '慎重に進める', description: '安全度も見ながら、無理のない範囲で進める局面です。' },
    fold: { key: 'fold', label: '降りる', description: '安全度を優先して、放銃(ホウジュウ)を避ける方向で考えやすい局面です。' },
  };

  const PUSHFOLD_DISCLAIMER =
    'これは初心者向けのルールベースの目安です。統計的な最適解や勝率・放銃率ではありません。同じ局面でも打ち方によって正解は変わります。';

  /**
   * 押し引きの判断。公開情報だけを材料にする。
   * @param {object} snapshot
   * @param {object} [options] {tile: 切ろうとしている牌}
   */
  function judgePushFold(snapshot, options) {
    options = options || {};
    const hand = handSummary(snapshot);
    const safety = safetyOverview(snapshot);
    const riichiPlayers = safety.targets;
    const riichiCount = riichiPlayers.length;
    const dealerRiichi = riichiPlayers.some((p) => p.isDealer);
    const han = roughHan(snapshot);
    const dora = doraCount(snapshot);
    const yaku = yakuCandidates(snapshot);
    const turn = snapshot.turn || 0;
    const myScore = snapshot.scores[snapshot.seat];
    const maxOther = Math.max.apply(
      null,
      snapshot.scores.filter((s, i) => i !== snapshot.seat)
    );

    const positiveFactors = [];
    const negativeFactors = [];
    let score = 0;

    // ---- 自分の手の状態 ----
    if (hand.shanten <= 0) {
      score += 3;
      positiveFactors.push({ key: 'tenpai', text: '聴牌(テンパイ)しています。' });
      const waitCount = hand.waitDetails.reduce((s, w) => s + w.remaining, 0);
      if (waitCount >= 6) {
        score += 1;
        positiveFactors.push({ key: 'wide-wait', text: '待ちの残り枚数が' + waitCount + '枚あり、アガリやすい形です。' });
      } else if (waitCount > 0 && waitCount <= 3) {
        score -= 1;
        negativeFactors.push({ key: 'narrow-wait', text: '待ちの残りが' + waitCount + '枚と少なく、アガリにくい形です。' });
      }
    } else if (hand.shanten === 1) {
      score += 0.5;
      positiveFactors.push({ key: 'ishanten', text: '1シャンテンで、あと1歩で聴牌(テンパイ)です。' });
    } else {
      score -= 2;
      negativeFactors.push({ key: 'far', text: hand.shanten + 'シャンテンで、アガリまで距離があります。' });
    }

    // ---- 打点 ----
    if (han >= 4) {
      score += 1.5;
      positiveFactors.push({ key: 'value', text: 'ドラ' + dora + '枚などで、打点が期待できます。' });
    } else if (han >= 3) {
      score += 1;
      positiveFactors.push({ key: 'value', text: '役とドラが見えていて、そこそこの打点になりそうです。' });
    } else if (han <= 1 && hand.shanten <= 0) {
      score -= 0.5;
      negativeFactors.push({ key: 'cheap', text: '打点があまり高くないため、無理に押す価値は下がります。' });
    }
    if (yaku.length === 0 && snapshot.fuuroCount > 0) {
      score -= 1.5;
      negativeFactors.push({ key: 'no-yaku', text: '鳴いていて役(ヤク)が見えていないため、アガリにつながらない可能性があります。' });
    }

    // ---- 相手のリーチ ----
    if (riichiCount === 1) {
      score -= 1.5;
      negativeFactors.push({ key: 'riichi', text: riichiPlayers[0].labelWithReading + 'からリーチが入っています。' });
    } else if (riichiCount >= 2) {
      // 2人リーチは1人リーチより必ず守備寄りになるようにする
      score -= 1.5 + 2 * (riichiCount - 1);
      negativeFactors.push({
        key: 'multi-riichi',
        text: riichiCount + '人からリーチが入っています。1人のときより放銃(ホウジュウ)の危険が高くなります。',
      });
    }
    if (dealerRiichi) {
      score -= 1;
      negativeFactors.push({ key: 'dealer-riichi', text: '親(オヤ)からのリーチなので、放銃したときの失点が大きくなります。' });
    }

    // ---- 自分が親か ----
    if (snapshot.isDealer) {
      score += 0.5;
      positiveFactors.push({ key: 'dealer', text: '自分が親(オヤ)なので、アガれば連荘(レンチャン)につながります。' });
    }

    // ---- 巡目 ----
    if (turn >= 13) {
      score -= 1;
      negativeFactors.push({ key: 'late', text: turn + '巡目と終盤なので、遠い手を押す価値は下がります。' });
    } else if (turn <= 6 && hand.shanten >= 2) {
      score += 0.5;
      positiveFactors.push({ key: 'early', text: 'まだ' + turn + '巡目なので、手を作る余地があります。' });
    }

    // ---- 安全牌 ----
    if (riichiCount > 0) {
      if (safety.hasGenbutsu) {
        score -= 0.5;
        negativeFactors.push({ key: 'has-genbutsu', text: '現物(ゲンブツ)を持っているため、降りる選択も取りやすい局面です。' });
      } else {
        negativeFactors.push({
          key: 'no-genbutsu',
          text: '現物(ゲンブツ)がありません。安全な牌が無いので、降りると決めても危険な牌を切ることになります。',
        });
      }
      if (options.tile !== undefined && safety.byTile[options.tile]) {
        const row = safety.byTile[options.tile];
        if (row.rank === 'S') {
          score += 0.5;
          positiveFactors.push({ key: 'tile-safe', text: row.label + 'は現物(ゲンブツ)なので、切っても当たりません。' });
        } else if (row.rank === 'D' || row.rank === 'E') {
          score -= 1;
          negativeFactors.push({ key: 'tile-danger', text: row.label + 'は危険寄りの牌です。' });
        }
      }
    }

    // ---- 点棒状況 ----
    const diff = myScore - maxOther;
    if (diff <= -12000) {
      score += 1;
      positiveFactors.push({ key: 'behind', text: '点棒が' + Math.abs(diff) + '点差で離されているため、手を作りにいく価値が上がります。' });
    } else if (diff >= 12000) {
      score -= 1;
      negativeFactors.push({ key: 'ahead', text: '点棒が' + diff + '点リードしているため、放銃を避ける価値が上がります。' });
    }
    if (myScore <= 3000) {
      score -= 1;
      negativeFactors.push({ key: 'low-score', text: '持ち点が少ないため、大きな放銃を避けたい状況です。' });
    }

    // ---- 判定 ----
    let recommendation;
    if (riichiCount === 0) {
      recommendation = hand.shanten <= 1 ? RECOMMENDATION.push : RECOMMENDATION.cautious;
    } else if (score >= 2) {
      recommendation = RECOMMENDATION.push;
    } else if (score <= -1.5) {
      recommendation = RECOMMENDATION.fold;
    } else {
      recommendation = RECOMMENDATION.cautious;
    }

    // ---- 自信度 ----
    let confidence;
    const distance = Math.min(Math.abs(score - 2), Math.abs(score + 1.5));
    if (riichiCount === 0) confidence = 'medium';
    else if (distance >= 1.5) confidence = 'high';
    else if (distance >= 0.7) confidence = 'medium';
    else confidence = 'low';

    const reasons = [];
    if (recommendation.key === 'fold') {
      reasons.push('アガリまで距離があるか、放銃したときの損が大きいため、守備を優先しやすい局面です。');
      reasons.push(
        safety.hasGenbutsu
          ? '現物(ゲンブツ)から順に切っていけば、この巡は安全に回れます。'
          : '現物が無いため、比較上もっとも危険が低い牌を選ぶことになります。「安全な牌」ではない点に注意してください。'
      );
    } else if (recommendation.key === 'push') {
      reasons.push('自分の手が十分に進んでいて、押す価値がある局面です。');
      if (riichiCount > 0) reasons.push('ただし押すと決めた場合でも、同じ価値なら危険度の低い牌から切ります。');
    } else {
      reasons.push('押し引きどちらとも言い切れない局面です。無理をせず、安全度と手の進みを両方見ながら進めます。');
      if (riichiCount > 0 && safety.hasGenbutsu) reasons.push('現物が1枚あるうちは、1巡だけ様子を見るのも選択肢です。');
    }

    const alternatives = [];
    if (recommendation.key !== 'push') {
      alternatives.push({ key: 'push', label: '押す', note: '手が高い・聴牌が近いと考えるなら、押す判断もあり得ます。' });
    }
    if (recommendation.key !== 'fold') {
      alternatives.push({ key: 'fold', label: '降りる', note: '放銃を避けたい点棒状況なら、降りる判断もあり得ます。' });
    }
    if (recommendation.key !== 'cautious') {
      alternatives.push({ key: 'cautious', label: '慎重に進める', note: '安全牌を1枚使いながら様子を見る折衷案もあります。' });
    }

    return {
      recommendation: recommendation.key,
      recommendationLabel: recommendation.label,
      description: recommendation.description,
      confidence,
      score,
      reasons,
      positiveFactors,
      negativeFactors,
      alternatives,
      disclaimer: PUSHFOLD_DISCLAIMER,
      riichiCount,
      hasGenbutsu: safety.hasGenbutsu,
      safestTiles: safety.safestTiles,
      shanten: hand.shanten,
    };
  }

  // ==================================================
  // 学習局面の検出
  // ==================================================

  const DEFAULT_SETTINGS = {
    mode: 'key', // 'off' | 'key'(重要局面コーチ) | 'deep'(じっくり学習)
    maxPerRound: 3,
    cooldownTurns: 2, // 同じ種類を続けて出さないための最短間隔(巡目)
  };

  /** じっくり学習でだけ出す種類 */
  const DEEP_ONLY = { wait: true, reading: true, efficiencyMinor: true };

  function moment(kind, priority, reason, tags, extra) {
    return Object.assign({ kind, priority, reason, tags: tags || [] }, extra || {});
  }

  /**
   * 学習価値のある局面を検出する。
   * @param {object} snapshot 公開情報だけのスナップショット
   * @param {object} [settings] {mode, maxPerRound}
   * @param {object} [history] {count, askedKinds:{kind:turn}, askedTags:[], lastKind, lastTurn, skippedRound}
   * @returns {Array} 優先度の高い順に並んだ候補
   */
  function detectLearningMoments(snapshot, settings, history) {
    const s = Object.assign({}, DEFAULT_SETTINGS, settings || {});
    const h = Object.assign({ count: 0, askedKinds: {}, askedTags: [], lastKind: null, lastTurn: -99, askedSignatures: [] }, history || {});
    const found = [];
    if (s.mode === 'off') return found;
    if (snapshot.phase !== 'awaiting_discard' || snapshot.turnSeat !== snapshot.seat) return found;
    // リーチ後はツモ切りのみなので、打牌を考える問題は出さない
    if (snapshot.isRiichi) return found;
    // 山が残りわずかな場面(流局直前)は、余計な問題を差し込まない
    if (snapshot.wallCount <= 4) return found;

    const hand = handSummary(snapshot);
    if (!hand.analysis) return found;
    const analysis = hand.analysis;
    const riichiOpponents = LiveSnapshot.riichiOpponentsOf(snapshot);
    const openOpponents = LiveSnapshot.openOpponentsOf(snapshot);
    const deep = s.mode === 'deep';

    // ---------- 守備(相手のリーチ) ----------
    if (riichiOpponents.length > 0) {
      const safety = safetyOverview(snapshot);
      const tags = [TAGS.defense, TAGS.genbutsu];
      const hasGenbutsu = safety.hasGenbutsu;
      const compareTags = safety.rows.some((r) =>
        r.perTarget.some((pt) => ['suji', 'kabe', 'one-chance'].some((k) => (pt.row.safeFactors || []).some((f) => f.key === k)))
      );
      if (compareTags) tags.push(TAGS.suji);

      found.push(
        moment('safety', 90 + riichiOpponents.length * 5, hasGenbutsu ? '相手のリーチに対して現物(ゲンブツ)があります。' : '相手のリーチに対して現物がありません。', tags, {
          riichiCount: riichiOpponents.length,
          hasGenbutsu,
        })
      );

      // 押し引き: 手が進んでいて安全牌と競合しているとき
      const conflict = hand.shanten <= 1 && !safety.safestTiles.some((t) => t === analysis.recommended.tile);
      found.push(
        moment('pushfold', conflict ? 88 : 70, conflict ? '牌効率のおすすめと安全牌が違う牌です。' : '相手のリーチを受けています。', [TAGS.pushfold, TAGS.defense], {
          riichiCount: riichiOpponents.length,
          conflict,
        })
      );
    }

    // ---------- 聴牌・待ち・リーチ ----------
    if (hand.shanten <= 0) {
      const tenpaiAfterBest = analysis.recommended.resultShanten === 0;
      if (tenpaiAfterBest) {
        const canRiichi = hand.isMenzen && !snapshot.isRiichi;
        if (canRiichi) {
          found.push(moment('riichi', 86, '聴牌(テンパイ)していて、リーチを考えられる局面です。', [TAGS.riichi, TAGS.tenpai, TAGS.yaku]));
        }
        const waitInfo = analysis.recommended.ukeireTiles || [];
        const multiWait = waitInfo.length >= 2;
        const remainingGap =
          waitInfo.length >= 2
            ? Math.max.apply(null, waitInfo.map((w) => w.remaining)) - Math.min.apply(null, waitInfo.map((w) => w.remaining))
            : 0;
        if (deep || multiWait) {
          found.push(
            moment('wait', multiWait ? 80 : 66, multiWait ? '待ちが複数あり、形を確認する価値があります。' : '聴牌しています。待ちを確認しましょう。', [TAGS.wait, TAGS.tenpai, TAGS.furiten], {
              multiWait,
              remainingGap,
            })
          );
        }
      }
    }

    // ---------- 何切る(牌効率) ----------
    const discards = analysis.discards;
    const best = discards[0];
    const second = discards[1];
    const shantenVaries = discards.some((d) => d.resultShanten !== best.resultShanten);
    const ukeireGap = second ? best.ukeireTotal - second.ukeireTotal : 0;
    const closeCandidates = second && second.resultShanten === best.resultShanten && Math.abs(ukeireGap) <= 2;
    const shapeChoice = !!best.wasIsolated || ['penchan', 'kanchan', 'ryanmen', 'pair'].indexOf(best.wasBlockType) !== -1;

    let discardPriority = 0;
    const discardReasons = [];
    if (shantenVaries) {
      discardPriority = Math.max(discardPriority, 74);
      discardReasons.push('切る牌によってシャンテン数が変わります。');
    }
    if (ukeireGap >= 4) {
      discardPriority = Math.max(discardPriority, 72);
      discardReasons.push('受け入れ枚数に' + ukeireGap + '枚の差があります。');
    }
    if (closeCandidates) {
      discardPriority = Math.max(discardPriority, 68);
      discardReasons.push('同じくらいの候補が複数あります。');
    }
    if (shapeChoice) {
      discardPriority = Math.max(discardPriority, deep ? 64 : 60);
      discardReasons.push('孤立牌・対子・両面などの形の選択が発生しています。');
    }
    // 役や打点を考えると牌効率だけでは決められない
    const yakuList = yakuCandidates(snapshot);
    const valueConflict = yakuList.length > 0 && doraCount(snapshot) > 0 && closeCandidates;
    if (valueConflict) {
      discardPriority = Math.max(discardPriority, 76);
      discardReasons.push('役や打点を考えると、牌効率だけでは決められません。');
    }
    // 候補が横並びすぎる局面(配牌直後など)は、問題にしても学びが薄いので出さない
    const topTieCount = discards.filter(
      (d) => d.resultShanten === best.resultShanten && d.ukeireTotal === best.ukeireTotal
    ).length;
    const tooFlat = topTieCount > 5 && !valueConflict;

    if (discardPriority > 0 && !tooFlat) {
      const minor = discardPriority < 66;
      if (deep || !minor) {
        found.push(
          moment('discard', discardPriority, discardReasons.join(''), [TAGS.efficiency, shapeChoice ? TAGS.shape : TAGS.efficiency, valueConflict ? TAGS.yaku : TAGS.efficiency], {
            ukeireGap,
            shantenVaries,
            closeCandidates,
          })
        );
      }
    }

    // ---------- 河読み ----------
    if (openOpponents.length > 0 || riichiOpponents.length > 0) {
      const target = openOpponents.length > 0 ? openOpponents[0] : riichiOpponents[0];
      const board = LiveSnapshot.boardView(snapshot, target.seat);
      let direction = null;
      try {
        direction = Reading.handDirection(board);
      } catch (e) {
        direction = null;
      }
      const hasYakuhaiMeld = !!direction && (direction.yakuhai || []).length > 0;
      const interesting = !!direction && (!!direction.honitsu || !!direction.toitoi || hasYakuhaiMeld || direction.isOpen);
      if (interesting && (deep || direction.honitsu || direction.toitoi)) {
        found.push(
          moment('reading', direction.honitsu || direction.toitoi ? 78 : 62, '相手の鳴きや河から手の方向が読み取れます。', [TAGS.reading], {
            targetSeat: target.seat,
          })
        );
      }
    }

    // ---------- 出題を抑える条件 ----------
    const filtered = found.filter((m) => {
      if (h.count >= s.maxPerRound) return false;
      // 同じ種類は一定巡目あけてから
      const lastAsked = h.askedKinds[m.kind];
      if (lastAsked !== undefined && snapshot.turn - lastAsked < s.cooldownTurns) return false;
      // 同じ種類を連続して出さない
      if (h.lastKind === m.kind) return false;
      // 同じタグが続かないようにする
      if (h.askedTags.length > 0) {
        const lastTag = h.askedTags[h.askedTags.length - 1];
        if (m.tags.indexOf(lastTag) !== -1 && m.priority < 85) return false;
      }
      // 同じ巡目に2問は出さない
      if (h.lastTurn === snapshot.turn) return false;
      return true;
    });

    filtered.sort((a, b) => b.priority - a.priority);
    return filtered;
  }

  /**
   * 検出結果から今回出す1問を選ぶ。無ければ null。
   */
  function pickMoment(snapshot, settings, history) {
    const list = detectLearningMoments(snapshot, settings, history);
    return list.length > 0 ? list[0] : null;
  }

  // ==================================================
  // オンデマンドコーチ(「今の局面を教えて」)
  // ==================================================

  /**
   * 今の局面のまとめ。自動出題がOFFでも使える。
   */
  function coachSummary(snapshot) {
    const hand = handSummary(snapshot);
    const safety = safetyOverview(snapshot);
    const yakuList = yakuCandidates(snapshot);
    const analysis = hand.analysis;
    const pushfold = judgePushFold(snapshot);

    const recommended = analysis
      ? analysis.discards.slice(0, 3).map((d) => ({
          tile: d.tile,
          label: d.label,
          shanten: d.resultShanten,
          ukeire: d.ukeireTotal,
          ukeireKinds: d.ukeireKinds,
          reason: d.reason,
          safety: safety.byTile[d.tile] ? safety.byTile[d.tile].category : null,
        }))
      : [];

    // 有効牌は「打牌を選べるとき」は最善手を切ったあとの受け入れ、
    // 自分の手番でないとき(13枚)は今の手牌の受け入れを見せる。
    const effective = analysis
      ? (analysis.recommended.ukeireTiles || []).map((u) => ({ tile: u.tile, label: u.label, remaining: u.remaining }))
      : (hand.ukeire.tiles || []).map((u) => ({ tile: u.tile, label: Tiles.shortLabel(u.tile), remaining: u.remaining }));

    const lines = [];
    lines.push(
      hand.shanten <= 0
        ? '聴牌(テンパイ)しています。'
        : hand.shanten + 'シャンテン(アガリまであと' + (hand.shanten + 1) + '歩)です。'
    );
    if (safety.targets.length > 0) {
      lines.push(
        safety.targets.map((t) => t.labelWithReading).join('・') +
          'がリーチ中です。' +
          (safety.hasGenbutsu ? '現物(ゲンブツ)が手の中にあります。' : '現物は手の中にありません。')
      );
    }
    if (yakuList.length > 0) lines.push('狙えそうな役: ' + yakuList.map((y) => y.name).join('・') + '(まだ確定ではありません)');
    if (!analysis) lines.push('今は自分の打牌を選ぶ場面ではないため、打牌候補は出していません。手牌と受け入れだけを確認できます。');
    lines.push('押し引き(オシヒキ)の目安: ' + pushfold.recommendationLabel + '。' + pushfold.description);

    return {
      shanten: hand.shanten,
      isTenpai: hand.shanten <= 0,
      waits: hand.waits,
      waitDetails: hand.waitDetails,
      effectiveTiles: effective,
      yakuCandidates: yakuList,
      doraCount: doraCount(snapshot),
      recommendedDiscards: recommended,
      safety,
      safeTiles: safety.safestTiles.map((t) => ({ tile: t, label: Tiles.shortLabel(t), category: safety.byTile[t].category })),
      pushfold,
      riichiTargets: safety.targets.map((t) => ({ seat: t.seat, label: t.labelWithReading })),
      summaryLines: lines,
      oneLiner: buildOneLiner(hand, safety, pushfold),
    };
  }

  function buildOneLiner(hand, safety, pushfold) {
    if (safety.targets.length === 0) {
      return hand.shanten <= 0
        ? '聴牌(テンパイ)しています。リーチや役を確認して、アガリを目指しましょう。'
        : 'まだ相手のリーチはありません。受け入れの広い牌を残して手を進めましょう。';
    }
    if (pushfold.recommendation === 'fold') {
      return safety.hasGenbutsu
        ? '守備を優先したい局面です。現物(ゲンブツ)から切って、この巡は安全に回りましょう。'
        : '守備を優先したい局面ですが現物がありません。比較上もっとも危険が低い牌を選びましょう。';
    }
    if (pushfold.recommendation === 'push') {
      return '自分の手が十分に進んでいます。押すなら、同じ価値の中では危険度の低い牌から切りましょう。';
    }
    return '押すか降りるか難しい局面です。安全牌を1枚使って様子を見るのも選択肢です。';
  }

  const LiveCoach = {
    TAGS,
    TAG_LABELS,
    TAG_TO_COURSE,
    DEFAULT_SETTINGS,
    RECOMMENDATION,
    PUSHFOLD_DISCLAIMER,
    handSummary,
    doraCount,
    roughHan,
    yakuCandidates,
    safetyOverview,
    judgePushFold,
    detectLearningMoments,
    pickMoment,
    coachSummary,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = LiveCoach;
  } else {
    root.MJ = root.MJ || {};
    root.MJ.LiveCoach = LiveCoach;
  }
})(typeof window !== 'undefined' ? window : globalThis);
