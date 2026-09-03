/**
 * furiten.js
 * フリテン判定。
 *
 * - 捨て牌フリテン: 自分の待ち牌のいずれかを、自分自身がすでに捨てている状態。
 *   この場合ロンできず、ツモでのみアガれる。
 * - 同巡フリテン(一時的): 自分の待ち牌が出た(ロンできた)のに見逃した場合、
 *   次に自分がツモるまでロンできなくなる。
 * - リーチ後フリテン(永続): リーチ後に一度でも見逃すと、その局が終わるまで
 *   ロンできなくなる(ツモのみ)。
 *
 * 一時的/永続フリテンの状態そのものは round.js 側でプレイヤーごとに管理し、
 * このモジュールは判定・説明文の生成のみを行う。
 */
(function (root) {
  'use strict';

  /**
   * @param {number[]} waitTiles 現在の待ち牌一覧(牌インデックス)
   * @param {number[]} ownDiscards 自分の捨て牌(牌インデックスの配列)
   */
  function isDiscardFuriten(waitTiles, ownDiscards) {
    return waitTiles.some((t) => ownDiscards.includes(t));
  }

  /**
   * @param {{discards:Array<{tile:number}>, furitenTemporary:boolean, furitenRiichi:boolean}} player
   * @param {number[]} waitTiles
   */
  function canRon(player, waitTiles) {
    if (isDiscardFuriten(waitTiles, player.discards.map((d) => d.tile))) return false;
    if (player.furitenTemporary || player.furitenRiichi) return false;
    return true;
  }

  /**
   * ロンできない理由を初心者向けに説明する(ロンできる場合はnull)。
   */
  function explainFuriten(player, waitTiles) {
    if (isDiscardFuriten(waitTiles, player.discards.map((d) => d.tile))) {
      return '自分の待ち牌をすでに自分で捨てているため(フリテン)、ロンできません。ツモでのみアガれます。';
    }
    if (player.furitenRiichi) {
      return 'リーチ後に一度アガリを見逃したため、この局はずっとフリテンです。ツモでのみアガれます。';
    }
    if (player.furitenTemporary) {
      return 'この巡でアガリを見逃したため、次に自分がツモるまでは一時的にロンできません。';
    }
    return null;
  }

  const Furiten = { isDiscardFuriten, canRon, explainFuriten };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Furiten;
  } else {
    root.MJ = root.MJ || {};
    root.MJ.Furiten = Furiten;
  }
})(typeof window !== 'undefined' ? window : globalThis);
