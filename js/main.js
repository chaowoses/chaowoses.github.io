const html = document.documentElement;
const HASHES = ['home', 'about', 'projects', 'contact'];
const PANEL_IDS = ['p-home', 'p-about', 'p-projects', 'p-contact'];

const navLinks = document.getElementById('nav-links');
const toggle = document.getElementById('nav-toggle');
const prevBtn = document.getElementById('prev');
const nextBtn = document.getElementById('next');
const pagerName = document.getElementById('pager-name');

let court = null;

const icon = (id) => `<svg class="ico"><use href="#${id}"/></svg>`;
function closeMenu() {
  navLinks.classList.remove('open');
  toggle.innerHTML = icon('i-menu');
}
toggle?.addEventListener('click', () => {
  const open = navLinks.classList.toggle('open');
  toggle.innerHTML = icon(open ? 'i-close' : 'i-menu');
});

function stationFromHash() {
  const i = HASHES.indexOf(location.hash.replace('#', '').toLowerCase());
  return i < 0 ? 0 : i;
}

function go(i, { push = true } = {}) {
  i = (i + HASHES.length) % HASHES.length;
  if (court) {
    court.goTo(i);
  } else {
    // static fallback: just scroll to the section
    document.getElementById(PANEL_IDS[i])?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    syncUI(i);
  }
  if (push && location.hash !== '#' + HASHES[i]) history.pushState(null, '', '#' + HASHES[i]);
}

function syncUI(i, st) {
  document.querySelectorAll('.nav-links a[data-go]').forEach((a) => a.classList.toggle('active', +a.dataset.go === i));
  if (st) pagerName.textContent = st.name;
}

// every [data-go] element (nav, hero button, and docked clones) drives the camera
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-go]');
  if (!a) return;
  e.preventDefault();
  closeMenu();
  go(+a.dataset.go);
});
prevBtn.addEventListener('click', () => go((court?.current ?? 0) - 1));
nextBtn.addEventListener('click', () => go((court?.current ?? 0) + 1));

document.getElementById('night-toggle')?.addEventListener('click', () => court?.toggleNight());

addEventListener('keydown', (e) => {
  if (e.altKey || e.ctrlKey || e.metaKey || !court) return;
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') go(court.current + 1);
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') go(court.current - 1);
  else if (/^[1-4]$/.test(e.key)) go(+e.key - 1);
  else if (e.key === 'n' || e.key === 'N') court.toggleNight();
  else return;
  e.preventDefault();
});

addEventListener('popstate', () => court?.goTo(stationFromHash()));

function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGL2RenderingContext && c.getContext('webgl2'));
  } catch { return false; }
}

async function boot() {
  try {
    if (!hasWebGL() || !window.gsap) throw new Error('3D unavailable');
    const { createCourtroom } = await import('./courtroom.js');
    html.classList.add('has3d');
    court = await createCourtroom({
      stage: document.getElementById('stage'),
      panels: document.getElementById('panels'),
      dock: document.getElementById('dock'),
      onStation: (i, st) => syncUI(i, st),
    });
    court.goTo(stationFromHash());
    html.classList.remove('loading');
  } catch (err) {
    console.warn('Falling back to the flat page:', err);
    html.classList.remove('has3d', 'loading', 'docked');
    syncUI(0);
  }
}
boot();
