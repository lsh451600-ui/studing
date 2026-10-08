const menu = document.getElementById('site-menu');
const trigger = document.getElementById('menu-open');
trigger.addEventListener('click', () => {
  if (!menu.open) { menu.showModal(); trigger.setAttribute('aria-expanded', 'true'); }
});
document.getElementById('menu-close').addEventListener('click', () => menu.close());
menu.addEventListener('close', () => { trigger.setAttribute('aria-expanded', 'false'); trigger.focus({ preventScroll: true }); });
menu.addEventListener('click', event => {
  if (event.target.closest('a')) menu.close();
  if (event.target === menu) {
    const box = menu.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) menu.close();
  }
});


// Hysteresis prevents header resizing from repeatedly toggling near the threshold.
const masthead = document.querySelector('header');
let scrollFrame = 0;
function updateMasthead() {
  scrollFrame = 0;
  if (window.scrollY > 80) masthead.classList.add('is-compact');
  else if (window.scrollY < 12) masthead.classList.remove('is-compact');
}
window.addEventListener('scroll', () => {
  if (!scrollFrame) scrollFrame = requestAnimationFrame(updateMasthead);
}, { passive: true });
window.addEventListener('pageshow', updateMasthead);
updateMasthead();

const startupToggle = document.getElementById('startup-toggle');
const startupSubmenu = document.getElementById('startup-submenu');
startupToggle.addEventListener('click', () => {
  const expanded = startupToggle.getAttribute('aria-expanded') !== 'true';
  startupToggle.setAttribute('aria-expanded', String(expanded));
  startupSubmenu.hidden = !expanded;
});
menu.addEventListener('close', () => {
  startupToggle.setAttribute('aria-expanded', 'false');
  startupSubmenu.hidden = true;
});
const backToTop = document.getElementById('back-to-top');
function updateBackToTop() {
  const remaining = document.documentElement.scrollHeight - innerHeight - scrollY;
  backToTop.hidden = scrollY < 160 || remaining > innerHeight;
}
backToTop.addEventListener('click', () => {
  document.querySelector('header .brand').focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: 'instant' });
  updateBackToTop();
});
window.addEventListener('scroll', updateBackToTop, { passive: true });
window.addEventListener('resize', updateBackToTop);
window.addEventListener('pageshow', updateBackToTop);
updateBackToTop();
