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

  // Desktop nav: highlight the link whose section is in view (mirrors the
  // mobile float-nav mango active state). No-ops on pages without these sections.
  const sectionLinks = $$('.nav-links a[href^="#"]');
  const linkBySection = new Map();
  sectionLinks.forEach(a => {
    const id  = a.getAttribute('href').slice(1);
    const sec = id && document.getElementById(id);
    if (sec) linkBySection.set(sec, a);
  });
  if (linkBySection.size) {
    const spy = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (!e.isIntersecting) return;
        const link = linkBySection.get(e.target);
        if (!link) return;
        sectionLinks.forEach(a => a.classList.remove('active'));
        link.classList.add('active');
      });
    }, { rootMargin: '-45% 0px -50% 0px', threshold: 0 });
    linkBySection.forEach((_, sec) => spy.observe(sec));
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
