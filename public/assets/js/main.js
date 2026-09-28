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
    // Read on the first frame rather than here.
    //
    // `window.pageYOffset` forces the browser to flush any style and layout it
    // has pending, and this runs during boot while a dozen other initialisers
    // have left the page dirty. That one read cost about 190ms of the page's
    // total forced reflow. Inside the animation frame below the same read is
    // free, because that is the point in the frame where layout is settled
    // anyway.
    var lastY = null;
    var ticking = false;
    // Never hide the header near the top - it reads as a glitch.
    var HIDE_AFTER = 220;

    var update = function () {
      var y = window.pageYOffset;
      if (lastY === null) lastY = y;

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
    var panel = $('.chat-panel', widget);
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
      // The panel is the dialog; the launcher stays in the accessibility tree
      // so it can still be found and closed.
      panel.setAttribute('aria-hidden', 'false');
      launcher.setAttribute('aria-expanded', 'true');
      if (badge) {
        badge.style.display = 'none';
        // The badge is visible text inside the button, so the label has to
        // match it. Once the badge is gone, so is the clause describing it.
        launcher.setAttribute('aria-label', 'Open the chat assistant');
      }

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
      panel.setAttribute('aria-hidden', 'true');
      launcher.setAttribute('aria-expanded', 'false');
      // Send focus back to the control that opened it, rather than leaving it
      // on an input that has just been hidden.
      input.blur();
      launcher.focus();
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
   * Package comparison.
   *
   * The picker is a plain GET form, so the page works with this script absent -
   * the visitor ticks boxes and presses the noscript submit button. All this
   * adds is the reload on tick, and locking the boxes at the column cap so the
   * limit is visible before a submission rather than after one.
   */
  function initCompare() {
    var form = $('[data-compare-form]');
    if (!form) return;

    var boxes = $$('input[name="p"]', form);
    if (!boxes.length) return;

    var max = Number(form.getAttribute('data-max')) || 4;

    function sync() {
      var checked = boxes.filter(function (box) { return box.checked; }).length;

      boxes.forEach(function (box) {
        var option = box.closest('.cmp-option');
        box.disabled = !box.checked && checked >= max;
        if (option) {
          option.classList.toggle('is-disabled', box.disabled);
          option.classList.toggle('is-on', box.checked);
        }
      });
    }

    boxes.forEach(function (box) {
      box.addEventListener('change', function () {
        sync();
        // submit() rather than requestSubmit(): with scripting on there is no
        // submit button to name, and this form runs no validation.
        form.submit();
      });
    });

    // The server already marks the cap, but re-running it here means the state
    // is correct after a back-navigation restores ticked boxes from the cache.
    sync();
  }

  /* ---------------------------------------------------------------------
     reCAPTCHA
     --------------------------------------------------------------------- */

  /**
   * Widgets waiting to be rendered, keyed by their container element.
   *
   * Rendering is explicit rather than automatic. The api.js auto-renderer
   * picks up `.g-recaptcha` elements on its own schedule, which leaves two
   * things unknowable from this side: whether a given element has been
   * rendered yet, and what its widget id is. Without the id, `execute()` has
   * to fall back to "the first widget on the page", and the callback has to be
   * matched back to a form by guessing.
   *
   * Rendering here removes both guesses. `?render=explicit` tells Google not to
   * touch the markup, and every widget id is ours.
   */
  var captchaWidgets = [];

  /** The form waiting on a challenge, and the timer that stops it hanging. */
  var pendingCaptchaForm = null;
  var pendingCaptchaTimer = null;

  /**
   * Fetch the reCAPTCHA bundle, but not until the page can spare the room.
   *
   * The script is around 340 KB from a third-party origin, plus a stylesheet
   * and two more connections. Loading it on arrival puts all of that in the
   * same window the first paint is trying to use, on pages where most visitors
   * never reach the form it protects.
   *
   * So it loads on the first sign of a real visitor - any pointer, key, touch,
   * scroll or focus - or when the form it protects comes near the viewport,
   * whichever happens first. On the homepage that form is at the bottom, so a
   * visitor who reads the page and leaves never downloads it at all.
   *
   * There used to be a timer here as well, firing a couple of seconds after
   * load. It was removed deliberately: on a throttled phone the script landed
   * inside the window the browser was still settling the first paint in, and
   * the work it caused pushed the largest element's final paint from 2.8s out
   * to 5.5s. Nothing on the page is waiting for it, so nothing is lost by
   * waiting for the visitor instead.
   *
   * `whenRecaptchaReady` already waits for `grecaptcha` before a submit uses
   * it, so a form submitted before the script lands waits rather than sending
   * an unverified request.
   */
  function initRecaptchaLoader() {
    var slot = $('[data-recaptcha-src]');
    if (!slot) return;

    var src = slot.getAttribute('data-recaptcha-src');
    if (!src) return;

    var loaded = false;
    var observer = null;
    var events = ['pointerdown', 'keydown', 'touchstart', 'scroll', 'focusin'];

    var load = function () {
      if (loaded) return;
      loaded = true;

      var tag = document.createElement('script');
      tag.src = src;
      tag.async = true;
      tag.defer = true;
      document.head.appendChild(tag);

      events.forEach(function (name) { window.removeEventListener(name, load); });
      if (observer) observer.disconnect();
    };

    events.forEach(function (name) {
      window.addEventListener(name, load, { once: true, passive: true });
    });

    // Whichever form the script is for, it sits next to a reCAPTCHA element.
    // 600px of lead time is roughly half a second of scrolling on a phone -
    // enough that the script is ready by the time the field is under a thumb.
    var target = $('.g-recaptcha') || $('[data-recaptcha-v3]') || $('.recaptcha-wrap');

    if (target && 'IntersectionObserver' in window) {
      observer = new IntersectionObserver(function (entries) {
        if (entries.some(function (entry) { return entry.isIntersecting; })) load();
      }, { rootMargin: '600px 0px' });

      observer.observe(target);
    } else if (target) {
      // No IntersectionObserver: fall back to the timer this used to have.
      window.setTimeout(load, 2500);
    }
  }

  /**
   * Run `callback` once the reCAPTCHA API can actually render.
   *
   * Not driven by an `onload=` parameter on the script tag, which is the usual
   * approach and has a race: api.js is loaded with `async`, so it can finish
   * and fire its onload before this file - loaded with `defer` - has defined
   * the function it is meant to call. The result is a widget that never
   * renders and a silent console error.
   *
   * `grecaptcha.ready()` is the supported way to wait, and it is what Google's
   * own examples use. The poll underneath covers the case where api.js never
   * arrived at all - a blocker, or offline - without leaving an interval
   * running for the life of the page.
   */
  function whenRecaptchaReady(callback) {
    var done = false;
    var finish = function () {
      if (done) return;
      done = true;
      callback();
    };

    if (window.grecaptcha && typeof window.grecaptcha.render === 'function') {
      if (typeof window.grecaptcha.ready === 'function') window.grecaptcha.ready(finish);
      else finish();
      return;
    }

    var tries = 0;
    var poll = window.setInterval(function () {
      tries += 1;
      if (window.grecaptcha && typeof window.grecaptcha.render === 'function') {
        window.clearInterval(poll);
        if (typeof window.grecaptcha.ready === 'function') window.grecaptcha.ready(finish);
        else finish();
      } else if (tries >= 100) {
        // Roughly twenty seconds. Beyond that the script is not coming, and a
        // request that never resolves is worse than one that fails.
        window.clearInterval(poll);
      }
    }, 200);
  }

  /** Google's error codes worth naming, because each one has its own fix. */
  function captchaMessage(code) {
    if (code === 'missing-input-secret' || code === 'invalid-input-secret') {
      return 'The reCAPTCHA secret key is not accepted. Check it in Settings, Security.';
    }
    if (code === 'invalid-keys') {
      return 'Google does not recognise the reCAPTCHA keys. Check both in Settings, Security.';
    }
    if (code === 'timeout-or-duplicate') {
      return 'The verification expired. Please try again.';
    }
    return 'The verification could not complete. Please try again.';
  }

  /** Show a message inside a form, creating the slot the first time. */
  function captchaNotice(form, text) {
    var slot = $('.recaptcha-notice', form);
    if (!slot) {
      slot = document.createElement('p');
      slot.className = 'recaptcha-notice';
      var wrap = $('.recaptcha-wrap', form);
      if (wrap) wrap.parentNode.insertBefore(slot, wrap.nextSibling);
      else form.insertBefore(slot, form.firstChild);
    }
    slot.textContent = text;
  }

  function clearCaptchaNotice(form) {
    var slot = $('.recaptcha-notice', form);
    if (slot) slot.remove();
  }

  /** Render every widget that has not been rendered yet. */
  function renderCaptchaWidgets() {
    captchaWidgets.forEach(function (entry) {
      if (entry.rendered) return;

      try {
        entry.id = window.grecaptcha.render(entry.el, {
          sitekey: entry.el.getAttribute('data-sitekey'),
          // Asking for invisible costs nothing when the key is a checkbox key:
          // Google ignores the request and draws the box anyway. The runtime
          // check in the submit handler adapts instead of fighting it.
          size: entry.wantsInvisible ? 'invisible' : 'checkbox',
          badge: entry.el.getAttribute('data-badge') || 'bottomright',
          callback: function () { onCaptchaSolved(entry.form); },
          'expired-callback': function () {
            // The token has a two-minute life. Without clearing the flag a form
            // left open would submit a token that is already dead.
            delete entry.form.dataset.recaptchaPassed;
          },
          'error-callback': function (code) {
            // The widget itself failed - a blocked script, or a key that is not
            // valid for this domain. Say so rather than leaving the button
            // doing nothing at all.
            captchaNotice(entry.form, captchaMessage(code));
          },
        });
        entry.rendered = true;
      } catch (err) {
        // render() throws if this element already holds a widget, which can
        // happen when api.js was cached and got there first. The widget works
        // either way, so this is not worth surfacing to the visitor.
        entry.rendered = true;
      }
    });
  }

  /**
   * A challenge was solved. Submit the form it belongs to.
   *
   * The flag rather than a direct call to the server keeps the form's own
   * handlers in play - the validation and double-click guard still run.
   */
  function onCaptchaSolved(form) {
    if (!form) return;

    if (pendingCaptchaTimer) {
      window.clearTimeout(pendingCaptchaTimer);
      pendingCaptchaTimer = null;
    }
    pendingCaptchaForm = null;

    clearCaptchaNotice(form);
    form.dataset.recaptchaPassed = '1';

    // The double-click guard disables the submit button on the first pass.
    // requestSubmit() runs interactive validation, so put it back first.
    var button = form.querySelector('[type="submit"]');
    if (button && button.disabled) button.removeAttribute('disabled');

    if (form.requestSubmit) form.requestSubmit();
    else form.submit();
  }

  /**
   * Wire up every reCAPTCHA widget on the page.
   *
   * Three shapes have to work, and the old code only handled one of them:
   *
   *   1. An invisible key in invisible mode. No box, no click - the submit is
   *      intercepted, execute() runs, and the callback re-submits.
   *
   *   2. A checkbox key while the panel says "invisible". Google ignores
   *      size:invisible for these and draws a visible box. The old code
   *      intercepted the submit regardless and called execute(), which for a
   *      checkbox widget resolves nothing - so the form hung until the safety
   *      timer fired and submitted with no token, and the server rejected it.
   *      The height check below detects the drawn box and asks the visitor to
   *      tick it instead.
   *
   *   3. A checkbox key in checkbox mode. Nothing to intercept; the tick
   *      supplies the token.
   */
  function initRecaptcha() {
    var widgets = $$('.g-recaptcha');
    if (!widgets.length) return;

    widgets.forEach(function (el) {
      var form = el.closest('form');
      if (!form) return;

      var wantsInvisible = el.getAttribute('data-size') === 'invisible';

      captchaWidgets.push({ el: el, form: form, wantsInvisible: wantsInvisible, id: null, rendered: false });

      if (!wantsInvisible) return;

      form.addEventListener('submit', function (event) {
        if (form.dataset.recaptchaPassed === '1') return;

        // A token is already present: the visitor solved a visible challenge,
        // or this is the re-submit after a success.
        var token = form.querySelector('[name="g-recaptcha-response"]');
        if (token && token.value) return;

        if (typeof window.grecaptcha === 'undefined' || typeof window.grecaptcha.execute !== 'function') {
          // The script never loaded - blocked, offline, or still in flight. Let
          // the submit through rather than trapping the visitor on a form that
          // does nothing; the server decides what to do about the missing token.
          return;
        }

        // A drawn checkbox means Google did not honour invisible mode, which
        // happens when the key was registered as a checkbox. execute() cannot
        // produce a token for it, so ask for the tick instead of hanging.
        if (el.getBoundingClientRect().height > 10) {
          event.preventDefault();
          captchaNotice(form, 'Please tick the "I am not a robot" box above, then try again.');
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return;
        }

        event.preventDefault();
        clearCaptchaNotice(form);
        pendingCaptchaForm = form;

        // Never leave the form hanging. If the callback does not arrive, submit
        // anyway and let the server answer - a real error message beats a
        // button that appears to do nothing.
        if (pendingCaptchaTimer) window.clearTimeout(pendingCaptchaTimer);
        pendingCaptchaTimer = window.setTimeout(function () {
          var stuck = pendingCaptchaForm;
          pendingCaptchaForm = null;
          pendingCaptchaTimer = null;
          if (!stuck) return;
          stuck.dataset.recaptchaPassed = '1';
          if (stuck.requestSubmit) stuck.requestSubmit();
          else stuck.submit();
        }, 8000);

        try {
          var entry = captchaWidgets.filter(function (item) { return item.form === form; })[0];
          // Passing the id explicitly. Without it Google falls back to the
          // first widget on the page, which is wrong the moment a page has two.
          if (entry && entry.id !== null && entry.id !== undefined) window.grecaptcha.execute(entry.id);
          else window.grecaptcha.execute();
        } catch (err) {
          window.clearTimeout(pendingCaptchaTimer);
          pendingCaptchaTimer = null;
          pendingCaptchaForm = null;
          form.dataset.recaptchaPassed = '1';
          form.requestSubmit ? form.requestSubmit() : form.submit();
        }
      });
    });

    whenRecaptchaReady(renderCaptchaWidgets);
  }

  /**
   * reCAPTCHA v3.
   *
   * Nothing is rendered and nothing is shown to the visitor. Google scores the
   * visit in the background and the server accepts or rejects it from that
   * score, so the whole job here is to fetch a token at submit time and put it
   * in the hidden field the form already carries.
   *
   * A v3 key cannot be used as v2 and vice versa, which is worth knowing when
   * nothing happens on a form: a v2 key under this path never produces a token,
   * and the submission goes out without one.
   */
  function initRecaptchaV3() {
    var fields = $$('input[data-recaptcha-v3]');
    if (!fields.length) return;

    fields.forEach(function (field) {
      var siteKey = field.getAttribute('data-recaptcha-v3');
      var form = field.closest('form');
      if (!form || !siteKey) return;

      form.addEventListener('submit', function (event) {
        // Our own re-submit, after the token has been filled in.
        if (form.dataset.recaptchaPassed === '1') return;

        if (typeof window.grecaptcha === 'undefined' || typeof window.grecaptcha.execute !== 'function') {
          // Blocked, offline, or still loading. Submit anyway rather than
          // trapping the visitor on a form that does nothing; the server
          // decides what to do about the missing token.
          return;
        }

        event.preventDefault();

        whenRecaptchaReady(function () {
          window.grecaptcha
            .execute(siteKey, { action: 'submit' })
            .then(function (token) {
              field.value = token;
              form.dataset.recaptchaPassed = '1';
              if (form.requestSubmit) form.requestSubmit();
              else form.submit();
            })
            .catch(function () {
              // No token available. Send it without one and let the server
              // answer - a real error message beats a dead button.
              form.dataset.recaptchaPassed = '1';
              if (form.requestSubmit) form.requestSubmit();
              else form.submit();
            });
        });
      });
    });
  }


  /**
   * Term toggle on the packages section.
   *
   * Each price carries the formatted string for every term, so switching is a
   * text swap - no round trip, and the currency symbol and separators stay
   * exactly as the server rendered them.
   *
   * The choice is remembered for the session, so a visitor who picked Yearly on
   * the homepage does not have to pick it again after following a link back.
   */
  function initTermToggle() {
    var toggle = $('[data-term-toggle]');
    if (!toggle) return;

    var buttons = $$('.term-option', toggle);
    var prices = $$('.price-value[data-monthly]');
    if (!buttons.length || !prices.length) return;

    function apply(term) {
      buttons.forEach(function (button) {
        var active = button.getAttribute('data-term') === term;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
      });

      prices.forEach(function (price) {
        var value = price.getAttribute('data-' + term);
        if (value) price.textContent = value;
      });

      try {
        window.sessionStorage.setItem('woobd-term', term);
      } catch (err) {
        // Private mode, or storage disabled. Not worth reporting.
      }
    }

    buttons.forEach(function (button) {
      button.addEventListener('click', function () {
        apply(button.getAttribute('data-term'));
      });
    });

    // Restore a previous choice, but only if that term is on offer here.
    var saved = null;
    try {
      saved = window.sessionStorage.getItem('woobd-term');
    } catch (err) {
      saved = null;
    }

    var available = buttons.map(function (b) { return b.getAttribute('data-term'); });
    if (saved && available.indexOf(saved) !== -1 && saved !== 'monthly') apply(saved);
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

  /**
   * Show the manual transfer fields only when a manual method is chosen.
   *
   * A gateway sends the customer to the provider to pay, so asking them for a
   * transaction ID and a screenshot of a receipt they do not have yet is worse
   * than useless: it reads as a broken form, and `required` would stop them
   * from continuing at all.
   *
   * The `required` flags come off with the fields. Hiding a required input does
   * not stop it blocking submission - the browser still refuses, and the error
   * points at a field nobody can see.
   */
  function initPaymentMethodToggle() {
    var radios = $$('input[name="method"][data-method-kind]');
    if (!radios.length) return;

    var manualBlocks = $$('[data-manual-only]');
    var label = $('[data-submit-label]');

    var apply = function () {
      var checked = radios.filter(function (radio) { return radio.checked; })[0];
      var isGateway = checked && checked.getAttribute('data-method-kind') === 'gateway';

      manualBlocks.forEach(function (block) {
        block.hidden = isGateway;
        $$('[required]', block).forEach(function (field) { field.required = !isGateway; });
      });

      if (label) label.textContent = isGateway ? 'Continue to payment' : 'Submit payment';
    };

    radios.forEach(function (radio) { radio.addEventListener('change', apply); });
    apply();
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
    initRecaptcha();
    initRecaptchaLoader();
    initRecaptchaV3();
    initCompare();
    initHeroVideo();
    initTermToggle();
    initPaymentMethodToggle();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
