/**
 * The one color authority. The world is warm dark stone under torchlight; the color
 * HIERARCHY is what makes a frame readable at a glance:
 *
 *   threat   — every hostile telegraph and enemy projectile. One red. If it's red,
 *              dodge it. (Enemy identity comes from silhouette, not hue.)
 *   soulfire — the undead. Enemy cores/eyes, hit feedback, the boss, the rift maw.
 *              The single COLD accent against the firelit keep.
 *   gold     — the player's economy: shards, pickups, "way open", crit/weak-point.
 *   ember*   — the world's warm dressing (torches, seams, gates, sky). Background,
 *              never a signal.
 */
export const PAL = {
  // world dressing — warm dark stone + firelight
  emberBright: 0xff7a2c,
  emberDeep: 0xff5022,
  emberSeam: 0xff5a1e,
  amber: 0xffb24a,
  goldPale: 0xffd480,
  flameCore: 0xffe39a,
  moteWarm: 0xff9a44,

  // atmosphere — cooled off so distance reads as darkness, not orange wash
  fog: 0x0c0709,
  skyBg: 0x090607,
  hemiSky: 0x3d3a4e,   // cold slate ambient — the counterweight that makes torch pools pop
  hemiGround: 0x100805,
  keyLight: 0xffb877,

  // the hierarchy
  threat: 0xff2b33,
  soulfire: 0x4fe0d0,
  gold: 0xffc24a,
} as const;
