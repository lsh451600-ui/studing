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
