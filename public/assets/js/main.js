/**
 * WooBD.Com - front-end behaviour.
 *
 * No dependencies. Each module is a small IIFE that exits early when its hooks
 * are absent, so the same bundle is loaded on every page without guarding.
 */
(function () {
  'use strict';

  var $ = function (sel, ctx) { return (ctx || document).querySelector(sel); };
  var $$ = function (sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); };

  /* ---------------------------------------------------------------------
     Theme toggle
     The initial theme is set by an inline script in <head> so there is no
     flash of the wrong colour; this only handles the switch itself.
     --------------------------------------------------------------------- */
  function initTheme() {
    var root = document.documentElement;

    var apply = function (mode) {
      root.setAttribute('data-theme', mode);
      // Keep the browser UI (address bar, form controls) in step.
      var meta = $('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', mode === 'dark' ? '#0c0e1a' : '#ffffff');
    };

    $$('[data-theme-toggle]').forEach(function (button) {
      button.addEventListener('click', function () {
        var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        apply(next);
        try {
          localStorage.setItem('woobd-theme', next);
        } catch (err) {
          /* Private mode - the theme just will not persist. */
        }
        // Let other widgets (charts, maps) react without polling.
        document.dispatchEvent(new CustomEvent('themechange', { detail: { mode: next } }));
      });
    });

    // Follow the OS preference only while the visitor has not chosen manually.
    if (window.matchMedia) {
      var query = window.matchMedia('(prefers-color-scheme: dark)');
      var handler = function (event) {
        try {
          if (localStorage.getItem('woobd-theme')) return;
        } catch (err) { /* ignore */ }
        apply(event.matches ? 'dark' : 'light');
      };
      if (query.addEventListener) query.addEventListener('change', handler);
      else if (query.addListener) query.addListener(handler);
    }
  }

  /* ---------------------------------------------------------------------
     Sticky header: shadow on scroll, hide on scroll-down.
     --------------------------------------------------------------------- */
  function initHeader() {
    var header = $('.site-header');
    if (!header) return;

    var sticky = header.getAttribute('data-sticky') !== '0';
    var lastY = window.pageYOffset;
    var ticking = false;
    // Never hide the header near the top - it reads as a glitch.
    var HIDE_AFTER = 220;

    var update = function () {
      var y = window.pageYOffset;

      header.classList.toggle('is-stuck', y > 12);

      if (sticky && !document.body.classList.contains('no-scroll')) {
        var goingDown = y > lastY;
        if (goingDown && y > HIDE_AFTER) {
          header.classList.add('is-hidden');
        } else {
          header.classList.remove('is-hidden');
        }
      } else {
        header.classList.remove('is-hidden');
      }

      lastY = y;
      ticking = false;
    };

    window.addEventListener(
      'scroll',
      function () {
        if (!ticking) {
          window.requestAnimationFrame(update);
          ticking = true;
        }
      },
      { passive: true }
    );

    update();
  }

  /* ---------------------------------------------------------------------
     Mobile slide menu
     --------------------------------------------------------------------- */
  function initMobileMenu() {
    var menu = $('#mobileMenu');
    if (!menu) return;

    var openers = $$('[data-menu-open]');
    var closers = $$('[data-menu-close]');
    var backdrop = $('.mobile-menu-backdrop', menu);
    var panel = $('.mobile-menu-panel', menu);
    var lastFocused = null;

    var open = function () {
      lastFocused = document.activeElement;
      menu.classList.add('is-open');
      menu.setAttribute('aria-hidden', 'false');
      document.body.classList.add('no-scroll');
      $$('[data-menu-open]').forEach(function (b) { b.classList.add('is-open'); });

      // Move focus into the panel so keyboard users land somewhere useful.
      window.setTimeout(function () {
        var first = $('a, button', panel);
        if (first) first.focus();
      }, 120);
    };

    var close = function () {
      menu.classList.remove('is-open');
      menu.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('no-scroll');
      $$('[data-menu-open]').forEach(function (b) { b.classList.remove('is-open'); });
      if (lastFocused && lastFocused.focus) lastFocused.focus();
    };

    openers.forEach(function (b) { b.addEventListener('click', open); });
    closers.forEach(function (b) { b.addEventListener('click', close); });
    if (backdrop) backdrop.addEventListener('click', close);

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && menu.classList.contains('is-open')) close();
    });

    // Simple focus trap while the panel is open.
    menu.addEventListener('keydown', function (event) {
      if (event.key !== 'Tab' || !menu.classList.contains('is-open')) return;
      var focusables = $$('a[href], button:not([disabled]), input, select, textarea', panel).filter(function (el) {
        return el.offsetParent !== null;
      });
      if (!focusables.length) return;

      var first = focusables[0];
      var last = focusables[focusables.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });

    // Collapsible submenus.
    $$('[data-submenu-toggle]').forEach(function (toggle) {
      toggle.addEventListener('click', function (event) {
        event.preventDefault();
        var submenu = toggle.nextElementSibling;
        if (!submenu) return;
        var isOpen = submenu.classList.toggle('is-open');
        toggle.classList.toggle('is-expanded', isOpen);
        toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      });
    });

    // Close the menu when a link inside it navigates.
    $$('a', menu).forEach(function (link) {
      link.addEventListener('click', function () {
        if (link.hasAttribute('data-submenu-toggle')) return;
        close();
      });
    });
  }

  /* ---------------------------------------------------------------------
     Typing animation for the hero headline
     --------------------------------------------------------------------- */
  function initTyping() {
    var target = $('[data-typing]');
    if (!target) return;

    var words = (target.getAttribute('data-typing') || '')
      .split(',')
      .map(function (word) { return word.trim(); })
      .filter(Boolean);

    if (!words.length) return;

    // Respect the reduced-motion preference: show the first word statically.
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      target.textContent = words[0];
      return;
    }

    var typeSpeed = 78;
    var deleteSpeed = 42;
    var holdTime = 1750;
    var wordIndex = 0;
    var charIndex = 0;
    var deleting = false;

    var tick = function () {
      var word = words[wordIndex];

      if (!deleting) {
        charIndex += 1;
        target.textContent = word.slice(0, charIndex);
        if (charIndex === word.length) {
          deleting = true;
          window.setTimeout(tick, holdTime);
          return;
        }
        window.setTimeout(tick, typeSpeed);
      } else {
        charIndex -= 1;
        target.textContent = word.slice(0, charIndex);
        if (charIndex === 0) {
          deleting = false;
          wordIndex = (wordIndex + 1) % words.length;
          window.setTimeout(tick, 360);
          return;
        }
        window.setTimeout(tick, deleteSpeed);
      }
    };

    // Start after the headline has settled so it does not fight the page load.
    window.setTimeout(tick, 520);
  }

  /* ---------------------------------------------------------------------
     Duplicate marquee content so the loop is seamless.
     The track animates to -50%; the two halves must be identical for that to
     read as an infinite scroll with no visible jump.
     --------------------------------------------------------------------- */
  function initMarquee() {
    $$('[data-marquee]').forEach(function (track) {
      if (track.getAttribute('data-cloned') === '1') return;
      var items = $$('.marquee-item', track);
      if (items.length < 2) return;

      items.forEach(function (item) {
        var clone = item.cloneNode(true);
        clone.setAttribute('aria-hidden', 'true');
        track.appendChild(clone);
      });
      track.setAttribute('data-cloned', '1');
    });
  }

  /* ---------------------------------------------------------------------
     Reveal on scroll
     --------------------------------------------------------------------- */
  function initReveal() {
    var elements = $$('[data-reveal]');
    if (!elements.length) return;

    if (!('IntersectionObserver' in window)) {
      elements.forEach(function (el) { el.classList.add('is-visible'); });
      return;
    }

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry, index) {
          if (!entry.isIntersecting) return;
          // Stagger items inside the same grid so they cascade rather than pop.
          var delay = Math.min(index * 70, 280);
          window.setTimeout(function () {
            entry.target.classList.add('is-visible');
          }, delay);
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -60px 0px' }
    );

    elements.forEach(function (el) { observer.observe(el); });
  }

  /* ---------------------------------------------------------------------
     Accordion
     --------------------------------------------------------------------- */
  function initAccordion() {
    $$('.accordion').forEach(function (group) {
      var single = group.getAttribute('data-single') === '1';

      $$('.accordion-trigger', group).forEach(function (trigger) {
        trigger.addEventListener('click', function () {
          var item = trigger.closest('.accordion-item');
          var willOpen = !item.classList.contains('is-open');

          if (single) {
            $$('.accordion-item', group).forEach(function (other) {
              other.classList.remove('is-open');
              var button = $('.accordion-trigger', other);
              if (button) button.setAttribute('aria-expanded', 'false');
            });
          }

          item.classList.toggle('is-open', willOpen);
          trigger.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
        });
      });
    });
  }

  /* ---------------------------------------------------------------------
     Password visibility toggles
     --------------------------------------------------------------------- */
  function initPasswordToggles() {
    $$('[data-toggle-password]').forEach(function (button) {
      button.addEventListener('click', function () {
        var input = $('#' + button.getAttribute('data-toggle-password'));
        if (!input) return;
        var show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        button.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      });
    });
  }

  /* ---------------------------------------------------------------------
     Form helpers: inline validation and duplicate-submit protection
     --------------------------------------------------------------------- */
  function initForms() {
    $$('form[data-validate]').forEach(function (form) {
      var submitBtn = $('[type="submit"]', form);

      form.addEventListener('submit', function (event) {
        var firstInvalid = null;

        $$('[required]', form).forEach(function (field) {
          var valid = field.checkValidity();
          field.classList.toggle('is-invalid', !valid);
          if (!valid && !firstInvalid) firstInvalid = field;
        });

        // Email fields get a stricter pattern than the browser's default.
        $$('input[type="email"]', form).forEach(function (field) {
          if (!field.value) return;
          var ok = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(field.value);
          field.classList.toggle('is-invalid', !ok);
          if (!ok && !firstInvalid) firstInvalid = field;
        });

        // Password confirmation, where present.
        var password = $('input[name="password"]', form);
        var confirm = $('input[name="password_confirm"], input[name="confirm_password"]', form);
        if (password && confirm && password.value !== confirm.value) {
          confirm.classList.add('is-invalid');
          var note = confirm.parentElement.querySelector('.form-error');
          if (!note) {
            note = document.createElement('span');
            note.className = 'form-error';
            confirm.parentElement.appendChild(note);
          }
          note.textContent = 'The two passwords do not match.';
          if (!firstInvalid) firstInvalid = confirm;
        }

        if (firstInvalid) {
          event.preventDefault();
          firstInvalid.focus();
          firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return;
        }

        // Prevent the double-click double-order. The button is re-enabled if the
        // browser restores the page from the back/forward cache.
        if (submitBtn) {
          submitBtn.classList.add('is-loading');
          submitBtn.setAttribute('disabled', 'disabled');
        }

        window.setTimeout(function () {
          if (submitBtn) {
            submitBtn.classList.remove('is-loading');
            submitBtn.removeAttribute('disabled');
          }
        }, 9000);
      });

      // Clear the error state as soon as the visitor starts fixing it.
      $$('.form-control', form).forEach(function (field) {
        field.addEventListener('input', function () {
          field.classList.remove('is-invalid');
        });
      });
    });
  }

  /* ---------------------------------------------------------------------
     Copy-to-clipboard
     --------------------------------------------------------------------- */
  function initCopy() {
    $$('[data-copy]').forEach(function (button) {
      button.addEventListener('click', function () {
        var value = button.getAttribute('data-copy');
        var done = function () {
          var original = button.getAttribute('data-label') || button.textContent;
          button.setAttribute('data-label', original);
          button.textContent = 'Copied';
          window.setTimeout(function () { button.textContent = original; }, 1600);
        };

        if (navigator.clipboard && window.isSecureContext) {
          navigator.clipboard.writeText(value).then(done).catch(function () {});
        } else {
          // Fallback for plain-HTTP contexts, where the Clipboard API is blocked.
          var area = document.createElement('textarea');
          area.value = value;
          area.style.position = 'fixed';
          area.style.opacity = '0';
          document.body.appendChild(area);
          area.select();
          try { document.execCommand('copy'); done(); } catch (err) { /* ignore */ }
          document.body.removeChild(area);
        }
      });
    });
  }

  /* ---------------------------------------------------------------------
     Relative timestamps ("3 minutes ago") across pages
     --------------------------------------------------------------------- */
  function initRelativeTimes() {
    var nodes = $$('time[data-relative]');
    if (!nodes.length) return;

    var render = function (node) {
      var date = new Date(node.getAttribute('datetime'));
      if (isNaN(date.getTime())) return;
      var seconds = Math.floor((Date.now() - date.getTime()) / 1000);

      if (seconds < 45) { node.textContent = 'just now'; return; }
      var units = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
      for (var i = 0; i < units.length; i += 1) {
        var count = Math.floor(seconds / units[i][1]);
        if (count >= 1) {
          node.textContent = count + ' ' + units[i][0] + (count > 1 ? 's' : '') + ' ago';
          return;
        }
      }
      node.textContent = seconds + ' seconds ago';
    };

    nodes.forEach(render);
    window.setInterval(function () { nodes.forEach(render); }, 60000);
  }

  /* ---------------------------------------------------------------------
     Auto-dismiss flash messages
     --------------------------------------------------------------------- */
  function initAlerts() {
    $$('.alert[data-auto-dismiss]').forEach(function (alert) {
      window.setTimeout(function () {
        alert.style.transition = 'opacity .35s, transform .35s, margin .35s, padding .35s, height .35s';
        alert.style.opacity = '0';
        alert.style.transform = 'translateY(-8px)';
        window.setTimeout(function () { alert.remove(); }, 380);
      }, parseInt(alert.getAttribute('data-auto-dismiss'), 10) || 5200);
    });
  }

  /* ---------------------------------------------------------------------
     Live chat widget
     --------------------------------------------------------------------- */
  function initChat() {
    var widget = $('#chatWidget');
    if (!widget) return;

    var launcher = $('.chat-launcher', widget);
    var body = $('.chat-body', widget);
    var form = $('.chat-form', widget);
    var input = $('textarea', form);
    var sendButton = $('.chat-send', form);
    var closeButton = $('.close-btn', widget);
    var badge = $('.chat-badge', widget);

    var endpoint = widget.getAttribute('data-endpoint');
    var greeting = widget.getAttribute('data-greeting') || 'Hi! How can I help?';
    var storageKey = 'woobd-chat-token';
    var localKey = 'woobd-chat-history';

    var busy = false;
    var greeted = false;

    // Session token lets the server stitch a conversation together across page
    // loads without the visitor having an account.
    var getToken = function () {
      try {
        var existing = localStorage.getItem(storageKey);
        if (existing) return existing;
        var bytes = new Uint8Array(24);
        (window.crypto || window.msCrypto).getRandomValues(bytes);
        var token = Array.prototype.map.call(bytes, function (b) {
          return ('0' + b.toString(16)).slice(-2);
        }).join('');
        localStorage.setItem(storageKey, token);
        return token;
      } catch (err) {
        return '';
      }
    };

    var sessionToken = getToken();

    var scrollDown = function () {
      window.requestAnimationFrame(function () { body.scrollTop = body.scrollHeight; });
    };

    // Persist the visible transcript so a page navigation does not wipe it.
    var saveHistory = function () {
      try {
        var messages = $$('.chat-msg', body).map(function (node) {
          return {
            role: node.classList.contains('user') ? 'user' : 'assistant',
            text: $('.bubble', node).textContent,
          };
        });
        localStorage.setItem(localKey, JSON.stringify(messages.slice(-40)));
      } catch (err) { /* ignore */ }
    };

    var restoreHistory = function () {
      try {
        var stored = JSON.parse(localStorage.getItem(localKey) || '[]');
        if (!Array.isArray(stored) || !stored.length) return false;
        stored.forEach(function (message) {
          append(message.role, message.text, true);
        });
        greeted = true;
        return true;
      } catch (err) {
        return false;
      }
    };

    var escapeHtml = function (text) {
      var div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    };

    var append = function (role, text, skipSave) {
      var wrapper = document.createElement('div');
      wrapper.className = 'chat-msg ' + role;

      if (role === 'assistant') {
        wrapper.innerHTML =
          '<div class="avatar-sm">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">' +
          '<path d="M12 2a10 10 0 1 0 10 10"/><path d="M12 6v6l4 2"/>' +
          '</svg></div>';
      }

      var bubble = document.createElement('div');
      bubble.className = 'bubble';
      // textContent rather than innerHTML - assistant output is untrusted.
      bubble.textContent = text;
      wrapper.appendChild(bubble);
      body.appendChild(wrapper);

      if (!skipSave) saveHistory();
      return wrapper;
    };

    var showTyping = function () {
      var wrapper = document.createElement('div');
      wrapper.className = 'chat-msg assistant';
      wrapper.setAttribute('data-typing-indicator', '1');
      wrapper.innerHTML =
        '<div class="avatar-sm">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">' +
        '<path d="M12 2a10 10 0 1 0 10 10"/><path d="M12 6v6l4 2"/>' +
        '</svg></div>' +
        '<div class="bubble"><div class="typing"><span></span><span></span><span></span></div></div>';
      body.appendChild(wrapper);
      scrollDown();
      return wrapper;
    };

    var send = function (message) {
      if (busy || !message.trim()) return;

      busy = true;
      append('user', message.trim());
      input.value = '';
      input.style.height = 'auto';
      sendButton.setAttribute('disabled', 'disabled');
      var indicator = showTyping();
      scrollDown();

      // The CSRF token has to be sent explicitly.
      //
      // This posts JSON, so the token cannot ride along as a hidden form field
      // the way it does on every other form - and the global CSRF check runs on
      // the parsed body. Without the header every message is rejected as an
      // expired session, which is exactly how it looked from the widget.
      var csrfMeta = document.querySelector('meta[name="csrf-token"]');
      var csrfToken = csrfMeta ? csrfMeta.getAttribute('content') : '';

      fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({
          message: message.trim(),
          session_token: sessionToken,
          page_url: window.location.pathname,
        }),
        credentials: 'same-origin',
      })
        .then(function (response) {
          // 419 is the CSRF/session rejection. Say so, because "the assistant is
          // unavailable" sends people looking at the API key instead of the
          // session - and a reload is all it takes to fix.
          if (response.status === 419) {
            return {
              ok: false,
              message: 'Your session expired. Please refresh the page and try again.',
            };
          }

          return response.json().catch(function () {
            // A non-JSON body means the request never reached the handler.
            return { ok: false, message: 'The assistant is unavailable right now. Please try again.' };
          });
        })
        .then(function (data) {
          indicator.remove();
          if (data && data.session_token) {
            sessionToken = data.session_token;
            try { localStorage.setItem(storageKey, sessionToken); } catch (err) { /* ignore */ }
          }
          append('assistant', (data && (data.message || data.error)) || 'Something went wrong. Please try again.');
        })
        .catch(function () {
          indicator.remove();
          append('assistant', 'I could not connect. Please check your internet and try again.');
        })
        .then(function () {
          busy = false;
          sendButton.removeAttribute('disabled');
          input.focus();
          scrollDown();
        });
    };

    var open = function () {
      widget.classList.add('is-open');
      widget.setAttribute('aria-hidden', 'false');
      if (badge) badge.style.display = 'none';

      if (!greeted) {
        if (!restoreHistory()) append('assistant', greeting);
        greeted = true;
      }

      window.setTimeout(function () {
        scrollDown();
        input.focus();
      }, 220);
    };

    var close = function () {
      widget.classList.remove('is-open');
      widget.setAttribute('aria-hidden', 'true');
    };

    launcher.addEventListener('click', function () {
      if (widget.classList.contains('is-open')) close();
      else open();
    });

    if (closeButton) {
      closeButton.addEventListener('click', function (event) {
        event.stopPropagation();
        close();
      });
    }

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      send(input.value);
    });

    // Enter sends, Shift+Enter makes a new line.
    input.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        send(input.value);
      }
    });

    // Grow the textarea with the content, up to the CSS max-height.
    input.addEventListener('input', function () {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 116) + 'px';
    });

    $$('[data-chat-suggest]', widget).forEach(function (button) {
      button.addEventListener('click', function () {
        send(button.getAttribute('data-chat-suggest'));
      });
    });

    // Deep link: /?chat=1 opens the widget on load.
    if (new URLSearchParams(window.location.search).get('chat') === '1') {
      window.setTimeout(open, 600);
    }
  }

  /* ---------------------------------------------------------------------
     Boot
     --------------------------------------------------------------------- */
  /**
   * Reviews carousel.
   *
   * The track is a native horizontal scroller with scroll-snap, so swiping and
   * trackpad scrolling work with no script at all. This adds the arrows and the
   * dot indicators on top, and keeps them in step with whatever the user does
   * by hand - the active dot is derived from scroll position, not from which
   * button was pressed last.
   */
  function initCarousel() {
    $$('[data-carousel]').forEach(function (root) {
      var track = $('[data-carousel-track]', root);
      var prev = $('[data-carousel-prev]', root);
      var next = $('[data-carousel-next]', root);
      var dotsWrap = $('[data-carousel-dots]', root.parentNode);

      if (!track) return;

      var items = $$('[data-carousel-item]', track);
      if (items.length < 2) return;

      /** How far one card plus its gap moves the track. */
      function step() {
        if (items.length < 2) return track.clientWidth;
        return items[1].offsetLeft - items[0].offsetLeft;
      }

      /** The index of the card nearest the left edge. */
      function currentIndex() {
        var x = track.scrollLeft;
        var best = 0;
        var bestDistance = Infinity;

        items.forEach(function (item, i) {
          var distance = Math.abs(item.offsetLeft - track.offsetLeft - x);
          if (distance < bestDistance) {
            bestDistance = distance;
            best = i;
          }
        });

        return best;
      }

      /** How many cards fit at once, so the last dot is the last useful stop. */
      function perView() {
        var s = step();
        if (!s) return 1;
        return Math.max(1, Math.round(track.clientWidth / s));
      }

      function maxScroll() {
        return track.scrollWidth - track.clientWidth;
      }

      function goTo(index) {
        var target = items[Math.max(0, Math.min(index, items.length - 1))];
        if (!target) return;

        var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        track.scrollTo({
          left: target.offsetLeft - track.offsetLeft,
          behavior: reduced ? 'auto' : 'smooth',
        });
      }

      // --- arrows -------------------------------------------------------
      function syncArrows() {
        // A 2px tolerance: fractional scroll positions never land exactly.
        var atStart = track.scrollLeft <= 2;
        var atEnd = track.scrollLeft >= maxScroll() - 2;

        if (prev) prev.disabled = atStart;
        if (next) next.disabled = atEnd;
      }

      if (prev) {
        prev.addEventListener('click', function () {
          goTo(currentIndex() - 1);
        });
      }

      if (next) {
        next.addEventListener('click', function () {
          goTo(currentIndex() + 1);
        });
      }

      // --- dots ---------------------------------------------------------
      var dots = [];

      if (dotsWrap) {
        // One dot per scroll position, not per card: with three cards visible
        // there is only one useful stop, so a dot per card would be dead ends.
        var stops = Math.max(1, items.length - perView() + 1);

        for (var i = 0; i < stops; i += 1) {
          var dot = document.createElement('button');
          dot.type = 'button';
          dot.className = 'carousel-dot';
          dot.setAttribute('role', 'tab');
          dot.setAttribute('aria-label', 'Show reviews starting at ' + (i + 1));
          (function (index) {
            dot.addEventListener('click', function () { goTo(index); });
          })(i);
          dotsWrap.appendChild(dot);
          dots.push(dot);
        }
      }

      function syncDots() {
        if (!dots.length) return;
        var active = Math.min(currentIndex(), dots.length - 1);
        dots.forEach(function (dot, i) {
          dot.classList.toggle('is-active', i === active);
          dot.setAttribute('aria-selected', i === active ? 'true' : 'false');
        });
      }

      // --- keyboard -----------------------------------------------------
      // The track is focusable; left/right move a card at a time and the
      // browser's default scroll is suppressed so the two do not fight.
      track.addEventListener('keydown', function (event) {
        if (event.key === 'ArrowRight') {
          event.preventDefault();
          goTo(currentIndex() + 1);
        } else if (event.key === 'ArrowLeft') {
          event.preventDefault();
          goTo(currentIndex() - 1);
        }
      });

      // --- keep everything in sync --------------------------------------
      var frame = null;
      track.addEventListener('scroll', function () {
        if (frame) return;
        // Coalesce scroll events into one update per frame.
        frame = window.requestAnimationFrame(function () {
          frame = null;
          syncArrows();
          syncDots();
        });
      });

      window.addEventListener('resize', function () {
        syncArrows();
        syncDots();
      });

      syncArrows();
      syncDots();
    });
  }

  /**
   * Invisible reCAPTCHA.
   *
   * The widget renders no box, so it cannot submit the form itself - it has to
   * be told when to run. This intercepts the submit, asks Google for a token,
   * and re-submits once the token arrives.
   *
   * `onRecaptchaSolved` is a global because the reCAPTCHA script calls it by
   * name from the widget's data-callback attribute.
   */
  var pendingCaptchaForm = null;

  window.onRecaptchaSolved = function () {
    if (!pendingCaptchaForm) return;
    var form = pendingCaptchaForm;
    pendingCaptchaForm = null;
    // Set a flag rather than calling submit() directly, so the form's own
    // submit handlers run and validation still applies.
    form.dataset.recaptchaPassed = '1';
    form.requestSubmit ? form.requestSubmit() : form.submit();
  };

  function initInvisibleCaptcha() {
    var widgets = $$('.g-recaptcha[data-size="invisible"]');
    if (!widgets.length) return;

    widgets.forEach(function (widget) {
      var form = widget.closest('form');
      if (!form) return;

      form.addEventListener('submit', function (event) {
        // Already verified - let it through.
        if (form.dataset.recaptchaPassed === '1') return;

        if (typeof window.grecaptcha === 'undefined' || !window.grecaptcha.execute) {
          // The script did not load - a blocker, or offline. Let the submit
          // through rather than trapping the visitor on a form they cannot
          // send; the server still verifies the token it never received.
          return;
        }

        event.preventDefault();
        pendingCaptchaForm = form;

        try {
          window.grecaptcha.execute();
        } catch (err) {
          // If execution fails, do not leave them stuck.
          pendingCaptchaForm = null;
          form.dataset.recaptchaPassed = '1';
          form.requestSubmit ? form.requestSubmit() : form.submit();
        }
      });
    });
  }

  /**
   * Hero video.
   *
   * Autoplay is a request, not a guarantee: browsers block it for a video with
   * sound, in low-power mode, and on some metered connections. When it is
   * refused the element just sits on its poster frame, which looks broken.
   *
   * So if play() rejects and the controls were switched off, turn them on -
   * the visitor can start it themselves rather than being left with a still
   * image and no explanation.
   */
  function initHeroVideo() {
    $$('.hero-video').forEach(function (video) {
      var attempt = video.play();
      if (!attempt || typeof attempt.catch !== 'function') return;

      attempt.catch(function () {
        video.setAttribute('controls', 'controls');
        video.classList.add('is-paused');
      });
    });
  }

  function boot() {
    initTheme();
    initHeader();
    initMobileMenu();
    initTyping();
    initMarquee();
    initReveal();
    initAccordion();
    initPasswordToggles();
    initForms();
    initCopy();
    initRelativeTimes();
    initAlerts();
    initChat();
    initCarousel();
    initInvisibleCaptcha();
    initHeroVideo();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
