// lib/sound.js

export const playDingSound = () => {
  // بررسی روشن/خاموش بودن صدا در تنظیمات کاربر
  if (typeof window !== 'undefined') {
    const isSoundEnabled = localStorage.getItem('motopol_sound_enabled');
    if (isSoundEnabled === 'false') return;

    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();

      // صدای اول (نُت زیرتر)
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      gain1.gain.setValueAtTime(0.15, ctx.currentTime);
      gain1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);

      osc1.connect(gain1);
      gain1.connect(ctx.destination);

      osc1.start(ctx.currentTime);
      osc1.stop(ctx.currentTime + 0.5);

      // صدای دوم (نُت دینگ پایانی شاد و واضح)
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(880, ctx.currentTime + 0.1); // A5
      gain2.gain.setValueAtTime(0.2, ctx.currentTime + 0.1);
      gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);

      osc2.connect(gain2);
      gain2.connect(ctx.destination);

      osc2.start(ctx.currentTime + 0.1);
      osc2.stop(ctx.currentTime + 0.8);
    } catch (e) {
      console.warn('پخش صدای اعلان با محدودیت مرورگر مواجه شد:', e);
    }
  }
};
