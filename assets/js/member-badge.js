export function decorateMember(element, level) {
  element.querySelector('.member-crown')?.remove();
  if (level !== 'special') return element;
  const ns = 'http://www.w3.org/2000/svg', crown = document.createElementNS(ns, 'svg');
  crown.classList.add('member-crown'); crown.setAttribute('viewBox', '0 0 24 24');
  crown.setAttribute('role', 'img'); crown.setAttribute('aria-label', '특별회원');
  crown.style.cssText = 'width:1.15em;height:1.15em;display:inline-block;vertical-align:-.15em;margin-right:.28em;flex-shrink:0';
  const shape = document.createElementNS(ns, 'path');
  shape.setAttribute('d', 'M3 6 7.5 10 12 3 16.5 10 21 6 19 18H5ZM5 20H19');
  shape.setAttribute('fill', '#e9b936'); shape.setAttribute('stroke', '#a8790b');
  shape.setAttribute('stroke-width', '1.3'); shape.setAttribute('stroke-linejoin', 'round');
  crown.append(shape); element.prepend(crown); return element;
}
