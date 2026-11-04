// Screens start covered by the inline pre-arm class, before deferred scripts or observers run.
// If this module never loads, that inline script removes the covers after five seconds.
export function startSecondaryPowerOn(screens: HTMLElement[]) {
  const root = document.documentElement;
  const fallback = Number(root.dataset.powerFallback);
  const clearFallback = () => {
    if (fallback) clearTimeout(fallback);
    delete root.dataset.powerFallback;
  };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  if (!root.classList.contains('crt-secondary-ready') || reduced.matches || !('IntersectionObserver' in window)) {
    screens.forEach(screen => { screen.dataset.powerState = 'played'; });
    root.classList.remove('crt-secondary-ready');
    clearFallback();
    return;
  }

  let remaining = screens.length;
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const screen = entry.target as HTMLElement;
      observer.unobserve(screen);
      if (screen.dataset.powerState !== 'played') screen.classList.add('is-powering-on');
    }
  }, { threshold: .05 });

  const finish = (screen: HTMLElement) => {
    if (screen.dataset.powerState === 'played') return;
    screen.dataset.powerState = 'played';
    screen.classList.remove('is-powering-on');
    observer.unobserve(screen);
    if (--remaining === 0) root.classList.remove('crt-secondary-ready');
  };
  for (const screen of screens) {
    const shutter = screen.querySelector<HTMLElement>(':scope > .crt-shutter');
    if (!shutter) {
      finish(screen); // Missing decoration must never hide the real content.
      continue;
    }
    shutter.addEventListener('animationend', event => {
      if (event.animationName === 'crt-shutter-open') finish(screen);
    });
    screen.addEventListener('focusin', () => finish(screen));
    screen.addEventListener('pointerdown', () => finish(screen));
    observer.observe(screen);
  }
  reduced.addEventListener('change', () => {
    if (reduced.matches) screens.forEach(finish);
  });
  if (!remaining) root.classList.remove('crt-secondary-ready');
  clearFallback();
}
