// Media is optional decoration. Transaction status never depends on playback.
export function initTipMedia(): void {
  const machine = document.querySelector<HTMLElement>('[data-tip-media]');
  if (!machine) return;
  const screen = machine.querySelector<HTMLElement>('[data-tip-screen]');
  const video = screen?.querySelector<HTMLVideoElement>('video');
  const panel = machine.closest<HTMLElement>('[data-tip-panel]');
  const status = machine.querySelector<HTMLElement>('[data-tip-media-status]');
  if (!screen || !video || !panel || !status) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const sources = {
    idle: '/media/firewatch-idle-silent.mp4',
    success: '/media/firewatch-success-silent.mp4',
  };
  let clip: keyof typeof sources = 'idle';
  let loadedClip: keyof typeof sources | null = null;
  let lastState = machine.querySelector<HTMLElement>('[data-tip-crt-state]')?.dataset.tipCrtState;
  let visible = false;
  let failed = false;
  let generation = 0;

  const stop = () => {
    generation++;
    video.pause();
    machine.classList.remove('is-playing');
    screen.classList.remove('has-frame');
  };
  const isOpen = () => panel.classList.contains('is-open');
  const sync = async () => {
    if (reduced.matches || failed || !isOpen() || !visible || document.hidden) {
      stop();
      if (reduced.matches) {
        // Do not queue a celebration to surprise someone who opted out of motion.
        clip = 'idle';
        loadedClip = null;
        if (video.hasAttribute('src')) {
          video.removeAttribute('src');
          video.load();
        }
      }
      return;
    }
    if (loadedClip !== clip) {
      stop();
      video.loop = clip === 'idle';
      video.src = sources[clip];
      loadedClip = clip;
      video.load();
    }
    const attempt = ++generation;
    try {
      await video.play();
      // An older play promise must never pause a newer clip.
      if (attempt !== generation) return;
      if (reduced.matches || !isOpen() || !visible || document.hidden) { stop(); return; }
      screen.classList.add('has-frame');
      machine.classList.add('is-playing');
      status.textContent = '';
    } catch {
      if (attempt !== generation || reduced.matches || !isOpen() || !visible || document.hidden) return;
      failed = true;
      stop();
      status.textContent = 'Video unavailable; still image shown. Transaction status is unaffected.';
      screen.dispatchEvent(new Event('tip-media-failure'));
    }
  };
  panel.addEventListener('tip-state-change', event => {
    const state = (event as CustomEvent<{ state: string }>).detail.state;
    // Temporary visual preview: a declined approval also plays the light-up clip.
    // This changes decoration only; the transaction readout still says declined.
    if ((state === 'confirmed' || state === 'declined') && lastState !== state && !reduced.matches && !failed) {
      // A transaction hash alone never starts the one-shot.
      clip = 'success';
      void sync();
    }
    lastState = state;
  });
  video.addEventListener('ended', () => {
    if (clip !== 'success' || loadedClip !== 'success' || failed) return;
    clip = 'idle';
    void sync();
  });
  panel.addEventListener('tip-drawer-toggle', () => {
    if (!isOpen()) {
      stop();
      // A celebration interrupted by closing resumes, rather than playing twice.
      if (clip === 'idle') video.currentTime = 0;
    } else void sync();
  });
  video.addEventListener('error', () => {
    if (failed || reduced.matches) return;
    failed = true;
    stop();
    status.textContent = 'Video unavailable; still image shown. Transaction status is unaffected.';
    screen.dispatchEvent(new Event('tip-media-failure'));
  });
  reduced.addEventListener('change', () => { void sync(); });
  document.addEventListener('visibilitychange', () => { void sync(); });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; void sync(); }, { threshold: .05 }).observe(machine);
  } else {
    const onScroll = () => {
      const bounds = machine.getBoundingClientRect();
      visible = isOpen() && bounds.bottom > 0 && bounds.top < innerHeight;
      void sync();
    };
    addEventListener('scroll', onScroll, { passive: true });
    panel.addEventListener('tip-drawer-toggle', onScroll);
    onScroll();
  }
}
