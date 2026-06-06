/** 本地开发与 Vercel+Turso 云端共用 step 同步；轮询间隔按环境微调。 */
window.UNO_RUNTIME = {
  isLocal: ["localhost", "127.0.0.1"].includes(window.location.hostname),
  /** 己方回合：云端略慢，减少 Turso 读压力 */
  pollMsHuman: ["localhost", "127.0.0.1"].includes(window.location.hostname) ? 1800 : 2200,
  /** Bot / 他人回合：加快以逐帧看动画 */
  pollMsBot: 700,
  pollMsOnline: 1100,
  animMs: 520,
  /** 一家出牌落位后，再开始下一家动作前的停顿 */
  pauseAfterPlayMs: 480,
  syncMode: "step",
};
