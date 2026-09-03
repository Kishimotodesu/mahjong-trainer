/**
 * furiten.js
 * フリテン判定。
 *
 * - 捨て牌フリテン: 自分の待ち牌のいずれかを、自分自身がすでに捨てている状態。
 *   この場合ロンできず、ツモでのみアガれる。
 *   最重要: 待ち牌のうち1種類でも自分の河にあれば、待ち牌"全部"でロンできなくなる
 *   (自分で捨てた牌そのものだけがロン不可になるのではない)。
 * - 同巡フリテン(一時的): 自分の待ち牌が出た(ロンできた)のに見逃した場合、
 *   次に自分がツモるまでロンできなくなる。
 * - リーチ後フリテン(永続): リーチ後に一度でも見逃すと、その局が終わるまで
 *   ロンできなくなる(ツモのみ)。
 *
 * 一時的/永続フリテンの状態そのものは round.js 側でプレイヤーごとに管理し、
 * このモジュールは判定・説明文の生成のみを行う。
 * V1.5: 教材(lessons.js)・対局中コーチが同じ判定結果を使えるよう、
 * 文字列だけでなく構造化された状態(getFuritenState)も提供する。
 * 本番対局と教材とで判定がずれないよう、判定ロジックは常にこのファイル1箇所にまとめる。
 */
(function (root) {
  'use strict';

  let Tiles;
  if (typeof module !== 'undefined' && module.exports) {
    Tiles = require('./tiles.js');
  } else {
    Tiles = root.MJ.Tiles;
  }

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
   * フリテンの状態を構造化して返す(本番対局・教材・コーチが共通で使うAPI)。
   * @param {{discards:Array<{tile:number}>, furitenTemporary:boolean, furitenRiichi:boolean}} player
   * @param {number[]} waitTiles 現在の待ち牌一覧
   * @returns {{
   *   type: 'none'|'discard'|'temporary'|'riichi',
   *   canRon: boolean,
   *   canTsumo: boolean,
   *   waitTiles: number[],
   *   blockingOwnDiscards: number[],
   *   temporary: boolean,
   *   riichiPermanent: boolean,
   *   beginnerMessage: ?string
   * }}
   */
  function getFuritenState(player, waitTiles) {
    const ownDiscardTiles = player.discards.map((d) => d.tile);
    const blocking = waitTiles.filter((t) => ownDiscardTiles.includes(t));
    const isDiscard = blocking.length > 0;

    let type = 'none';
    if (isDiscard) type = 'discard';
    else if (player.furitenRiichi) type = 'riichi';
    else if (player.furitenTemporary) type = 'temporary';

    const waitLabels = waitTiles.map((t) => Tiles.shortLabel(t));
    const blockLabels = blocking.map((t) => Tiles.shortLabel(t));

    let beginnerMessage = null;
    if (type === 'discard') {
      beginnerMessage =
        'あなたの待ち(' + waitLabels.join('・') + ')のうち、' + blockLabels.join('・') + 'を自分ですでに捨てています。' +
        '待ち牌が1種類でも自分の河にあると、待ち牌全部で他家からロンできなくなります(フリテン)。' +
        'ツモでは' + waitLabels.join('・') + 'のどれでもアガれます。';
    } else if (type === 'riichi') {
      beginnerMessage =
        'リーチ後に一度アガリ牌を見逃したため、この局が終わるまでずっとフリテンです。他家からはロンできません。ツモでのみアガれます。';
    } else if (type === 'temporary') {
      beginnerMessage =
        'この巡でアガリ牌を見逃したため、次に自分がツモるまでは一時的にロンできません(一時フリテン)。ツモでのみアガれます。';
    }

    return {
      type,
      canRon: type === 'none',
      canTsumo: true,
      waitTiles: waitTiles.slice(),
      blockingOwnDiscards: blocking,
      temporary: type === 'temporary',
      riichiPermanent: type === 'riichi',
      beginnerMessage,
    };
  }

  /**
   * ロンできない理由を初心者向けに説明する(ロンできる場合はnull)。
   * (後方互換のため文字列のみを返す。内部ではgetFuritenStateを使う)
   */
  function explainFuriten(player, waitTiles) {
    const state = getFuritenState(player, waitTiles);
    return state.beginnerMessage;
  }

  const Furiten = { isDiscardFuriten, canRon, getFuritenState, explainFuriten };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Furiten;
  } else {
    root.MJ = root.MJ || {};
    root.MJ.Furiten = Furiten;
  }
})(typeof window !== 'undefined' ? window : globalThis);
