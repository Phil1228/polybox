/** UNO 牌桌音效（Web Audio 合成，无需外部音频文件） */
(function () {
  const VOL = 0.36;

  function createEngine() {
    /** @type {AudioContext | null} */
    let ctx = null;
    let enabled = true;

    function ensure() {
      if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === "suspended") void ctx.resume();
      return ctx;
    }

    function unlock() {
      try {
        ensure();
      } catch {
        /* 部分环境不支持音频 */
      }
    }

    function t0() {
      return ensure().currentTime;
    }

    function envelope(gain, start, attack, hold, release, peak) {
      const peakGain = peak * VOL;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(Math.max(peakGain, 0.0002), start + attack);
      gain.gain.setValueAtTime(Math.max(peakGain, 0.0002), start + attack + hold);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + attack + hold + release);
    }

    function tone(freq, duration, type, when, peak = 0.5) {
      if (!enabled) return;
      const c = ensure();
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, when);
      envelope(gain, when, 0.007, duration * 0.55, duration * 0.45, peak);
      osc.connect(gain);
      gain.connect(c.destination);
      osc.start(when);
      osc.stop(when + duration + 0.06);
    }

    function noiseBurst(duration, when, peak = 0.4, centerFreq = 700) {
      if (!enabled) return;
      const c = ensure();
      const len = Math.max(1, Math.floor(c.sampleRate * duration));
      const buf = c.createBuffer(1, len, c.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      }
      const src = c.createBufferSource();
      src.buffer = buf;
      const filt = c.createBiquadFilter();
      filt.type = "bandpass";
      filt.frequency.value = centerFreq;
      filt.Q.value = 0.9;
      const gain = c.createGain();
      envelope(gain, when, 0.004, duration * 0.45, duration * 0.55, peak);
      src.connect(filt);
      filt.connect(gain);
      gain.connect(c.destination);
      src.start(when);
    }

    return {
      unlock,
      setEnabled(on) {
        enabled = Boolean(on);
      },
      isEnabled() {
        return enabled;
      },

      /** 普通出牌 */
      play() {
        const t = t0();
        tone(540, 0.07, "triangle", t, 0.48);
        tone(820, 0.05, "sine", t + 0.018, 0.32);
        noiseBurst(0.055, t, 0.22, 1300);
      },

      /** 摸牌 */
      draw(index = 0) {
        const t = t0() + index * 0.045;
        noiseBurst(0.085, t, 0.42, 520);
        tone(300 + index * 18, 0.1, "sine", t + 0.025, 0.28);
      },

      /** +2 */
      drawTwo() {
        const t = t0();
        tone(440, 0.085, "square", t, 0.38);
        tone(554, 0.085, "square", t + 0.105, 0.42);
        tone(659, 0.11, "square", t + 0.21, 0.48);
      },

      /** +4 */
      drawFour() {
        const t = t0();
        [349, 415, 494, 587].forEach((f, i) => {
          tone(f, 0.09, "sawtooth", t + i * 0.095, 0.4 - i * 0.015);
        });
        noiseBurst(0.14, t + 0.38, 0.32, 380);
      },

      /** 跳过 */
      skip() {
        const t = t0();
        tone(210, 0.065, "square", t, 0.42);
        tone(160, 0.11, "square", t + 0.075, 0.5);
        tone(95, 0.16, "sawtooth", t + 0.13, 0.34);
      },

      /** 喊 UNO */
      callUno() {
        const t = t0();
        tone(523, 0.09, "square", t, 0.46);
        tone(659, 0.09, "square", t + 0.1, 0.5);
        tone(784, 0.14, "square", t + 0.2, 0.55);
        noiseBurst(0.06, t + 0.08, 0.18, 900);
      },

      /** 己方获胜 */
      win() {
        const t = t0();
        [523, 659, 784, 988, 1175].forEach((f, i) => {
          tone(f, 0.16, "triangle", t + i * 0.11, 0.48 - i * 0.02);
        });
        noiseBurst(0.1, t + 0.55, 0.28, 700);
      },

      /** 对局结束（未获胜） */
      lose() {
        const t = t0();
        tone(392, 0.22, "sine", t, 0.38);
        tone(330, 0.26, "sine", t + 0.2, 0.34);
        tone(262, 0.32, "sine", t + 0.42, 0.28);
      },

      /** 按牌面选音效 */
      forCard(card) {
        if (!card) return this.play();
        switch (card.value) {
          case "skip":
            return this.skip();
          case "draw_two":
            return this.drawTwo();
          case "wild_draw_four":
            return this.drawFour();
          default:
            return this.play();
        }
      },
    };
  }

  window.UNO_SOUNDS = createEngine();
})();
