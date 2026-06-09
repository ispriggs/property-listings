// Shared navigation behaviour: header scroll-hide, mobile menu toggle.
// Used by both the home page and the listing detail page.
import { $, $$ } from '../lib/utils.js';

export function initNav() {
  const header    = $('.site-header');
  const toggle    = $('.nav-menu-toggle');
  const mobileNav = $('.mobile-nav');
  const floatNav  = document.getElementById('float-nav');

  if (header) {
    let hidden = false;
    window.addEventListener('scroll', () => {
      const y = window.scrollY;
      header.classList.toggle('scrolled', y > 20);
      if (!hidden && y > 100) {
        hidden = true;
        header.classList.add('header-hide');
        if (floatNav) floatNav.classList.add('fn-visible');
      } else if (hidden && y < 60) {
        hidden = false;
        header.classList.remove('header-hide');
        if (floatNav) floatNav.classList.remove('fn-visible');
      }
    }, { passive: true });
  }

  if (toggle && mobileNav) {
    toggle.addEventListener('click', () => {
      const open = mobileNav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open);
      document.body.style.overflow = open ? 'hidden' : '';
    });
    $$('a, button', mobileNav).forEach(el => {
      el.addEventListener('click', e => {
        mobileNav.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
        document.body.style.overflow = '';
        const href = el.getAttribute('href');
        if (href && href.startsWith('#') && href.length > 1) {
          e.preventDefault();
          const target = document.querySelector(href);
          if (target) setTimeout(() => target.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
        }
      });
    });
  }
}
