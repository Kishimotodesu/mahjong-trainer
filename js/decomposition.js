/**
 * decomposition.js
 * 完成形(アガリ形)の手牌を「4面子+雀頭」のあらゆる有効な分解パターンに
 * 展開するモジュール。役判定(yaku.js)・符計算(scoring.js)は、
 * 同じ14枚でも読み方(分解)によって結果が変わることがあるため、
 * すべての分解を列挙した上で最も点数が高くなる読み方を採用する
 * (実際の麻雀のルールと同じ考え方)。
 */
(function (root) {
  'use strict';

  let Tiles;
  if (typeof module !== 'undefined' && module.exports) {
    Tiles = require('./tiles.js');
  } else {
    Tiles = root.MJ.Tiles;
  }

  const TILE_COUNT = Tiles.TILE_COUNT;

  // 1スート(9種)の枚数配列を、面子(刻子/順子)だけで過不足なく分解する
  // すべてのパターンを列挙する。1枚でも余ると無効(結果に含めない)。
  function enumerateSuitDecompositions(counts9) {
    const c = counts9.slice();
    const results = [];
    const path = [];

    function rec(pos) {
      if (pos >= 9) {
        results.push(path.slice());
        return;
      }
      if (c[pos] === 0) {
        rec(pos + 1);
        return;
      }
      if (c[pos] >= 3) {
        c[pos] -= 3;
        path.push({ type: 'triplet', tiles: [pos, pos, pos] });
        rec(pos);
        path.pop();
        c[pos] += 3;
      }
      if (pos <= 6 && c[pos] >= 1 && c[pos + 1] >= 1 && c[pos + 2] >= 1) {
        c[pos]--; c[pos + 1]--; c[pos + 2]--;
        path.push({ type: 'sequence', tiles: [pos, pos + 1, pos + 2] });
        rec(pos);
        path.pop();
        c[pos]++; c[pos + 1]++; c[pos + 2]++;
      }
      // c[pos] を面子にできなければこの経路は無効(何も積まずに終了)
    }

    rec(0);
    return results;
  }

  // 字牌1種類の分解(0枚→空、3枚→刻子1つ、それ以外は分解不可能)
  function enumerateHonorDecomposition(count) {
    if (count === 0) return [[]];
    if (count === 3) return [[{ type: 'triplet', tiles: [] }]]; // tilesは呼び出し側で埋める
    return [];
  }

  /**
   * 完成した通常手(標準形)の、手の中に残っている牌(副露分は含めない)から、
   * あり得る「N面子+雀頭」の分解をすべて列挙する。国士無双・七対子は対象外。
   * @param {number[]} counts 手の中の牌の34枚数配列(副露は含めない)
   * @param {number} [requiredMelds] 手の中から作る必要がある面子の数。
   *   副露が無ければ4(デフォルト)。副露がある場合は 4-副露数 を指定する。
   * @returns {Array<{pair:{tile:number}, melds:Array<{type:string, tiles:number[]}>}>}
   */
  function enumerateWinningDecompositions(counts, requiredMelds) {
    requiredMelds = requiredMelds === undefined ? 4 : requiredMelds;
    const counts14 = counts;
    const decompositions = [];

    for (let pairTile = 0; pairTile < TILE_COUNT; pairTile++) {
      if (counts14[pairTile] < 2) continue;

      const working = counts14.slice();
      working[pairTile] -= 2;

      const manOptions = enumerateSuitDecompositions(working.slice(0, 9));
      const pinOptions = enumerateSuitDecompositions(working.slice(9, 18)).map((opt) =>
        opt.map((b) => ({ type: b.type, tiles: b.tiles.map((t) => t + 9) }))
      );
      const souOptions = enumerateSuitDecompositions(working.slice(18, 27)).map((opt) =>
        opt.map((b) => ({ type: b.type, tiles: b.tiles.map((t) => t + 18) }))
      );

      if (manOptions.length === 0 || pinOptions.length === 0 || souOptions.length === 0) continue;

      const honorOptionsList = [];
      let honorsFeasible = true;
      for (let h = 0; h < 7; h++) {
        const idx = 27 + h;
        const opts = enumerateHonorDecomposition(working[idx]).map((opt) =>
          opt.map((b) => ({ type: b.type, tiles: [idx, idx, idx] }))
        );
        if (opts.length === 0) {
          honorsFeasible = false;
          break;
        }
        honorOptionsList.push(opts);
      }
      if (!honorsFeasible) continue;

      // man×pin×sou×各字牌 の直積を取り、合計4面子になる組み合わせだけ採用する
      let combos = [[]];
      for (const optsForGroup of [manOptions, pinOptions, souOptions, ...honorOptionsList]) {
        const next = [];
        for (const combo of combos) {
          for (const opt of optsForGroup) {
            next.push(combo.concat(opt));
          }
        }
        combos = next;
      }

      for (const melds of combos) {
        if (melds.length === requiredMelds) {
          decompositions.push({ pair: { tile: pairTile }, melds });
        }
      }
    }

    return decompositions;
  }

  /**
   * 順子ブロック内での和了牌の位置から待ちの種類を判定する。
   * @param {number[]} seqTiles ソート済みの3枚 [lo, lo+1, lo+2]
   * @param {number} winningTile
   * @returns {'ryanmen'|'kanchan'|'penchan'}
   */
  function classifySequenceWait(seqTiles, winningTile) {
    const lo = seqTiles[0];
    const posInSuit = lo % 9;
    if (winningTile === seqTiles[1]) return 'kanchan';
    if (winningTile === seqTiles[0]) {
      // 下側が和了牌 = 残りは[lo+1,lo+2]、上端(7,8,9)の形なら辺張
      return posInSuit === 6 ? 'penchan' : 'ryanmen';
    }
    // winningTile === seqTiles[2] (上側が和了牌) = 残りは[lo,lo+1]、下端(1,2,3)の形なら辺張
    return posInSuit === 0 ? 'penchan' : 'ryanmen';
  }

  /**
   * 1つの分解(decomposition)について、和了牌がどのブロックを完成させたかを
   * 全パターン列挙し、それぞれを「解釈のバリエーション」として返す。
   * 同じ和了牌が複数のブロックに現れる場合(例: 同じ順子が2つある等)は、
   * それぞれを別バリエーションとして扱い、呼び出し側で最良のものを選ぶ。
   *
   * @param {object} decomposition {pair, melds}
   * @param {number} winningTile
   * @param {boolean} isRon
   * @returns {Array<{pair, melds, waitType:string, completedBlockIndex:number|'pair'}>}
   */
  function enumerateVariants(decomposition, winningTile, isRon) {
    const variants = [];

    if (decomposition.pair.tile === winningTile) {
      variants.push({
        pair: decomposition.pair,
        melds: decomposition.melds,
        waitType: 'tanki',
        completedBlock: 'pair',
      });
    }

    decomposition.melds.forEach((meld, idx) => {
      if (meld.type === 'triplet' && meld.tiles[0] === winningTile) {
        variants.push({
          pair: decomposition.pair,
          melds: decomposition.melds,
          waitType: 'shanpon',
          completedBlock: idx,
        });
      } else if (meld.type === 'sequence' && meld.tiles.includes(winningTile)) {
        variants.push({
          pair: decomposition.pair,
          melds: decomposition.melds,
          waitType: classifySequenceWait(meld.tiles, winningTile),
          completedBlock: idx,
        });
      }
    });

    return variants;
  }

  /**
   * バリエーション内で、指定した面子(インデックス)が「暗刻(concealed)」かどうかを返す。
   * ロンで完成させた刻子(シャボ待ちの一部)だけは明刻(open)扱いになる。
   * ツモの場合はどのブロックで和了しても常に暗刻扱い。
   * 副露(ポン・明槓)の面子は meld.concealed===false が明示されているため、
   * ロン/ツモに関わらず常に明刻。暗槓は meld.concealed===true で常に暗刻として扱う。
   */
  function isConcealedTriplet(variant, meldIndex, isRon) {
    const meld = variant.melds[meldIndex];
    if (meld && meld.concealed === false) return false;
    if (meld && meld.concealed === true) return true;
    if (!isRon) return true;
    return variant.completedBlock !== meldIndex;
  }

  const Decomposition = {
    enumerateSuitDecompositions,
    enumerateWinningDecompositions,
    enumerateVariants,
    classifySequenceWait,
    isConcealedTriplet,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Decomposition;
  } else {
    root.MJ = root.MJ || {};
    root.MJ.Decomposition = Decomposition;
  }
})(typeof window !== 'undefined' ? window : globalThis);
