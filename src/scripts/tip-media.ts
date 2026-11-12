// Concept media is optional decoration. The poster is complete without JS or motion.
export function initTipMedia(): void {
  const machine = document.querySelector<HTMLElement>('[data-tip-media]');
  if (!machine) return;
  const screen = machine.querySelector<HTMLElement>('[data-tip-screen]');
  const video = screen?.querySelector<HTMLVideoElement>('video');
  const panel = machine.closest<HTMLElement>('[data-tip-panel]');
  const status = machine.querySelector<HTMLElement>('[data-tip-media-status]');
  if (!screen || !video || !panel || !status) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
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
      if (reduced.matches && video.hasAttribute('src')) {
        video.removeAttribute('src');
        video.load();
      }
      return;
    }
    if (!video.hasAttribute('src')) {
      video.src = '/media/settlement-silent.mp4';
      video.load();
    }
    const attempt = ++generation;
    try {
      await video.play();
      if (attempt !== generation || reduced.matches || !isOpen() || !visible || document.hidden) { stop(); return; }
      screen.classList.add('has-frame');
      machine.classList.add('is-playing');
      status.textContent = '';
    } catch {
      if (attempt !== generation || reduced.matches || !isOpen() || !visible || document.hidden) return;
      failed = true;
      stop();
      status.textContent = 'Video unavailable; concept still shown.';
      screen.dispatchEvent(new Event('tip-media-failure'));
    }
  };
  panel.addEventListener('tip-drawer-toggle', () => {
    if (!isOpen()) {
      stop();
      video.currentTime = 0;
    } else void sync();
  });
  video.addEventListener('error', () => {
    if (failed || reduced.matches) return;
    failed = true;
    stop();
    status.textContent = 'Video unavailable; concept still shown.';
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
