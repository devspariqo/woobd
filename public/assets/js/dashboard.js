/**
 * Dashboard behaviour: sidebar toggle, confirmation prompts, file previews,
 * inline filters and the deliverables reveal.
 */
(function () {
  'use strict';

  var $ = function (sel, ctx) { return (ctx || document).querySelector(sel); };
  var $$ = function (sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); };

  /* Sidebar slide-out on small screens. */
  function initSidebar() {
    var sidebar = $('#dashSidebar');
    if (!sidebar) return;

    var toggles = $$('[data-dash-toggle]');

    toggles.forEach(function (button) {
      button.addEventListener('click', function () {
        sidebar.classList.toggle('is-open');
      });
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') sidebar.classList.remove('is-open');
    });
  }

  /* Confirm before anything destructive. */
  function initConfirm() {
    $$('[data-confirm]').forEach(function (element) {
      element.addEventListener('click', function (event) {
        var message = element.getAttribute('data-confirm') || 'Are you sure?';
        if (!window.confirm(message)) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      });
    });

    // Forms that need confirmation before submitting (status changes, deletes).
    $$('form[data-confirm]').forEach(function (form) {
      form.addEventListener('submit', function (event) {
        var message = form.getAttribute('data-confirm') || 'Are you sure?';
        if (!window.confirm(message)) event.preventDefault();
      });
    });
  }

  /* Live image preview next to a file input. */
  function initFilePreview() {
    $$('input[type="file"][data-preview]').forEach(function (input) {
      var target = document.getElementById(input.getAttribute('data-preview'));
      if (!target) return;

      input.addEventListener('change', function () {
        var file = input.files && input.files[0];
        if (!file) return;

        if (!file.type.startsWith('image/')) {
          target.innerHTML = '<svg style="width:36px;height:36px"><use href="#i-file"/></svg>';
          return;
        }

        var reader = new FileReader();
        reader.onload = function (event) {
          target.innerHTML = '<img src="' + event.target.result + '" alt="Preview" style="width:100%;height:100%;object-fit:cover">';
        };
        reader.readAsDataURL(file);
      });
    });
  }

  /* Submit a filter form automatically when a select changes, so the user does
     not have to also press a button. */
  function initAutoFilter() {
    $$('form[data-auto-filter] select').forEach(function (select) {
      select.addEventListener('change', function () {
        select.form.submit();
      });
    });
  }

  /* Debounced auto-submit for search boxes. */
  function initAutoSearch() {
    $$('input[data-auto-search]').forEach(function (input) {
      var timer = null;
      input.addEventListener('input', function () {
        window.clearTimeout(timer);
        timer = window.setTimeout(function () {
          if (input.value.length === 0 || input.value.length >= 2) {
            input.form.submit();
          }
        }, 550);
      });
    });
  }

  /* Status tabs that filter a table client-side. */
  function initClientTabs() {
    $$('[data-filter-target]').forEach(function (button) {
      button.addEventListener('click', function () {
        var group = button.closest('[data-filter-group]');
        if (!group) return;

        var value = button.getAttribute('data-filter-target');

        $$('[data-filter-target]', group).forEach(function (sibling) {
          sibling.classList.toggle('active', sibling === button);
        });

        var table = document.querySelector(button.getAttribute('data-table') || '');
        if (!table) return;

        $$('tbody tr', table).forEach(function (row) {
          var matches = value === 'all' || row.getAttribute('data-status') === value;
          row.style.display = matches ? '' : 'none';
        });

        // Show the empty row when every data row is hidden.
        var emptyRow = $('tr[data-empty-row]', table);
        if (emptyRow) {
          var visible = $$('tbody tr:not([data-empty-row])', table).some(function (row) {
            return row.style.display !== 'none';
          });
          emptyRow.style.display = visible ? 'none' : '';
        }
      });
    });
  }

  /* Repeatable rows - used by the order deliverables editor and invoice items. */
  function initRepeatable() {
    $$('[data-repeatable]').forEach(function (container) {
      var template = $('template[data-repeat-template]', container);
      if (!template) return;

      var list = $('[data-repeat-list]', container);
      var index = $$('[data-repeat-row]', list).length;

      var addButton = $('[data-repeat-add]', container);
      if (addButton) {
        addButton.addEventListener('click', function () {
          var html = template.innerHTML.replace(/__INDEX__/g, String(index));
          index += 1;

          var wrapper = document.createElement('div');
          wrapper.innerHTML = html;
          var row = wrapper.firstElementChild;
          if (row) {
            list.appendChild(row);
            var firstInput = $('input, textarea, select', row);
            if (firstInput) firstInput.focus();
          }
        });
      }

      // Delegated removal so newly added rows work too.
      list.addEventListener('click', function (event) {
        var removeButton = event.target.closest('[data-repeat-remove]');
        if (!removeButton) return;
        var row = removeButton.closest('[data-repeat-row]');
        if (row) row.remove();
      });
    });
  }

  /* Count characters in a textarea against a maxlength. */
  function initCharCount() {
    $$('[data-count-target]').forEach(function (input) {
      var target = document.getElementById(input.getAttribute('data-count-target'));
      if (!target) return;

      var max = parseInt(input.getAttribute('maxlength'), 10) || 0;
      var update = function () {
        target.textContent = max
          ? input.value.length + ' / ' + max
          : String(input.value.length);
      };
      input.addEventListener('input', update);
      update();
    });
  }

  /* Slug field that follows a title field until edited by hand. */
  function initSlugSync() {
    $$('[data-slug-source]').forEach(function (source) {
      var target = document.getElementById(source.getAttribute('data-slug-target'));
      if (!target) return;

      // An existing value means the user set it deliberately - do not overwrite.
      var locked = target.value.trim().length > 0;

      target.addEventListener('input', function () { locked = true; });

      source.addEventListener('input', function () {
        if (locked) return;
        target.value = source.value
          .toLowerCase()
          .replace(/[^a-z0-9\s-]/g, '')
          .replace(/\s+/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '');
      });
    });
  }

  /* Colour pickers paired with a text field, kept in sync both ways. */
  function initColourInputs() {
    $$('[data-colour-picker]').forEach(function (picker) {
      var text = document.getElementById(picker.getAttribute('data-colour-picker'));
      if (!text) return;

      picker.addEventListener('input', function () { text.value = picker.value; });
      text.addEventListener('input', function () {
        if (/^#[0-9a-f]{6}$/i.test(text.value)) picker.value = text.value;
      });
    });
  }

  /* Toggle visibility of a password cell in admin tables. */
  function initSecretReveal() {
    $$('[data-reveal-secret]').forEach(function (button) {
      button.addEventListener('click', function () {
        var target = document.getElementById(button.getAttribute('data-reveal-secret'));
        if (!target) return;
        var hidden = target.getAttribute('data-hidden') === '1';
        target.textContent = hidden ? target.getAttribute('data-value') : '••••••••••';
        target.setAttribute('data-hidden', hidden ? '0' : '1');
      });
    });
  }

  /**
   * Settings toggles: keep the On/Off word next to each switch in step with the
   * checkbox. The word is real text (not a CSS pseudo-element) so it is read
   * out by screen readers and survives a no-CSS render.
   */
  function initSwitchState() {
    $$('.switch input[type="checkbox"]').forEach(function (input) {
      var label = input.closest('.switch');
      if (!label) return;

      var state = label.querySelector('.switch-state');
      if (!state) return;

      var on = label.getAttribute('data-on') || 'On';
      var off = label.getAttribute('data-off') || 'Off';

      var sync = function () { state.textContent = input.checked ? on : off; };
      sync();
      input.addEventListener('change', sync);
    });
  }

  /**
   * Staff list: reveal the inline edit panel for one row at a time. Only one is
   * open at once, so the table does not grow into a wall of forms.
   */
  function initStaffEdit() {
    var panels = $$('.staff-edit');
    if (!panels.length) return;

    var closeAll = function () {
      panels.forEach(function (panel) {
        panel.hidden = true;
      });
    };

    $$('[data-staff-edit]').forEach(function (button) {
      button.addEventListener('click', function () {
        var id = button.getAttribute('data-staff-edit');
        var panel = document.getElementById('staff-edit-' + id);
        if (!panel) return;

        var wasHidden = panel.hidden;
        closeAll();
        panel.hidden = !wasHidden;

        if (!panel.hidden) {
          var first = panel.querySelector('input, select, textarea');
          if (first) first.focus();
        }
      });
    });

    $$('[data-staff-cancel]').forEach(function (button) {
      button.addEventListener('click', function () {
        var panel = document.getElementById('staff-edit-' + button.getAttribute('data-staff-cancel'));
        if (panel) panel.hidden = true;
      });
    });
  }

  /**
   * File inputs: reject a wrong type or an oversized file in the browser.
   *
   * The server enforces both anyway, but a round-trip to be told "that file is
   * too large" after waiting for a 6 MB upload to fail feels like the form is
   * broken. Catching it here gives an instant, specific message.
   *
   * Reads `data-max-mb` on the input, and the `accept` attribute for types.
   */
  function initFileLimits() {
    var MAX_LABEL = function (mb) { return mb + ' MB'; };

    $$('input[type="file"][data-max-mb]').forEach(function (input) {
      // Where to show the message: an explicit id, or just after the input.
      var note = input.getAttribute('data-error-target')
        ? document.getElementById(input.getAttribute('data-error-target'))
        : null;

      if (!note) {
        note = document.createElement('p');
        note.className = 'form-error';
        note.hidden = true;
        input.parentNode.insertBefore(note, input.nextSibling);
      }

      var clear = function () {
        note.hidden = true;
        note.textContent = '';
        input.classList.remove('is-invalid');
      };

      input.addEventListener('change', function () {
        clear();

        var file = input.files && input.files[0];
        if (!file) return;

        var maxMb = parseFloat(input.getAttribute('data-max-mb')) || 0;
        if (maxMb && file.size > maxMb * 1024 * 1024) {
          var actual = (file.size / 1024 / 1024).toFixed(1);
          note.textContent =
            'That file is ' + actual + ' MB. The limit is ' + MAX_LABEL(maxMb) +
            ' — please choose a smaller image.';
          note.hidden = false;
          input.classList.add('is-invalid');
          input.value = '';
          return;
        }

        // The accept attribute is a comma-separated list of types or extensions.
        var accept = (input.getAttribute('accept') || '').trim();
        if (accept && accept !== '*') {
          var allowed = accept.split(',').map(function (s) { return s.trim().toLowerCase(); });
          var name = file.name.toLowerCase();
          var type = (file.type || '').toLowerCase();

          var ok = allowed.some(function (rule) {
            if (rule.endsWith('/*')) return type.startsWith(rule.slice(0, -1));
            if (rule.startsWith('.')) return name.endsWith(rule);
            return type === rule;
          });

          if (!ok) {
            note.textContent = 'That file type is not supported. Please choose an image.';
            note.hidden = false;
            input.classList.add('is-invalid');
            input.value = '';
          }
        }
      });
    });
  }

  /**
   * Rich text editor for CMS "html" fields.
   *
   * A contenteditable surface plus a toolbar, syncing into the textarea that
   * carries the field name. Deliberately dependency-free: the project ships no
   * CDN and no third-party JavaScript.
   *
   * The sync runs on every input AND again on submit. Relying on the input
   * event alone would lose the last edit if the form were submitted by pressing
   * Enter in a field, or by a browser that coalesces events.
   */
  function initHtmlEditors() {
    $$('[data-html-editor]').forEach(function (editor) {
      var surface = $('[data-he-surface]', editor);
      var store = $('[data-he-store]', editor);
      if (!surface || !store) return;

      var form = editor.closest('form');

      // --- keep the hidden field in step ---------------------------------
      var syncToStore = function () {
        store.value = surface.innerHTML;
      };

      surface.addEventListener('input', syncToStore);
      surface.addEventListener('blur', syncToStore);

      if (form) {
        // Capture phase, so this runs before any other submit handler decides
        // whether to cancel the submission.
        form.addEventListener('submit', syncToStore, true);
      }

      // A placeholder only shows when the surface is truly empty.
      surface.setAttribute('data-placeholder', surface.getAttribute('data-placeholder') || 'Write the content here…');

      // --- toolbar -------------------------------------------------------
      var refreshActive = function () {
        $$('[data-he-cmd]', editor).forEach(function (button) {
          var cmd = button.getAttribute('data-he-cmd');
          if (cmd === 'unlink' || cmd === 'removeFormat') return;
          var active = false;
          try {
            active = document.queryCommandState(cmd);
          } catch (e) {
            active = false;
          }
          button.classList.toggle('is-active', active);
        });
      };

      $$('[data-he-cmd]', editor).forEach(function (button) {
        // mousedown, not click: clicking would move focus out of the surface
        // and collapse the selection before the command runs.
        button.addEventListener('mousedown', function (event) {
          event.preventDefault();
        });

        button.addEventListener('click', function () {
          var cmd = button.getAttribute('data-he-cmd');
          surface.focus();
          try {
            document.execCommand(cmd, false, null);
          } catch (e) {
            /* unsupported command - leave the content alone */
          }
          syncToStore();
          refreshActive();
        });
      });

      // Block-level formatting: headings, paragraphs, quotes.
      $$('[data-he-block]', editor).forEach(function (button) {
        button.addEventListener('mousedown', function (event) {
          event.preventDefault();
        });

        button.addEventListener('click', function () {
          var tag = button.getAttribute('data-he-block');
          surface.focus();
          try {
            document.execCommand('formatBlock', false, tag);
          } catch (e) {
            /* ignore */
          }
          syncToStore();
          refreshActive();
        });
      });

      // --- link ----------------------------------------------------------
      var linkButton = $('[data-he-link]', editor);
      if (linkButton) {
        linkButton.addEventListener('mousedown', function (event) {
          event.preventDefault();
        });

        linkButton.addEventListener('click', function () {
          var selection = window.getSelection();
          var hasSelection = selection && String(selection).trim().length > 0;

          var url = window.prompt('Link URL', 'https://');
          if (!url) return;

          // Only allow http(s) and site-relative links. A javascript: URL here
          // would be stored and rendered on the public page.
          if (!/^(https?:\/\/|\/|#|mailto:)/i.test(url)) {
            window.alert('Use a full https:// address or a path starting with /.');
            return;
          }

          surface.focus();
          if (hasSelection) {
            document.execCommand('createLink', false, url);
          } else {
            // Nothing selected: insert the URL as its own link text.
            document.execCommand('insertHTML', false,
              '<a href="' + url.replace(/"/g, '&quot;') + '">' + url.replace(/[<>&]/g, '') + '</a>');
          }
          syncToStore();
        });
      }

      // --- source mode ---------------------------------------------------
      var sourceButton = $('[data-he-source]', editor);
      if (sourceButton) {
        sourceButton.addEventListener('click', function () {
          var isSource = surface.hasAttribute('data-source-mode');

          if (!isSource) {
            // Leaving the rich view: put the markup on screen as text so it can
            // be edited literally.
            surface.textContent = surface.innerHTML;
            surface.setAttribute('data-source-mode', '');
            sourceButton.classList.add('is-active');
            sourceButton.textContent = 'Visual';
          } else {
            surface.innerHTML = surface.textContent;
            surface.removeAttribute('data-source-mode');
            sourceButton.classList.remove('is-active');
            sourceButton.textContent = 'Source';
          }

          syncToStore();
        });
      }

      // --- keyboard ------------------------------------------------------
      surface.addEventListener('keyup', refreshActive);
      surface.addEventListener('mouseup', refreshActive);

      // Paste as plain text, so pasting from Word or Google Docs does not drag
      // in a wall of inline styles and font tags that fight the site's CSS.
      surface.addEventListener('paste', function (event) {
        var clipboard = event.clipboardData || window.clipboardData;
        if (!clipboard) return;

        var text = clipboard.getData('text/plain');
        if (!text) return;

        event.preventDefault();
        var html = text
          .split(/\n{2,}/)
          .map(function (block) {
            return '<p>' + block.trim().replace(/[<>&]/g, function (c) {
              return { '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c];
            }).replace(/\n/g, '<br>') + '</p>';
          })
          .join('');
        document.execCommand('insertHTML', false, html);
        syncToStore();
      });

      // Final safety net: make sure the stored value matches what is on screen
      // before the page is left, however that happens.
      window.addEventListener('beforeunload', syncToStore);

      syncToStore();
    });
  }

  /**
   * Checkout term selector.
   *
   * Each option carries its own total, so switching the term updates the order
   * summary without a round trip. The figures come from the server (rendered
   * into data attributes) rather than being recomputed here - the two would
   * otherwise drift, and the server's number is the one that gets charged.
   */
  function initTermSelector() {
    var options = $$('[data-term-option]');
    if (!options.length) return;

    var monthsOut = $('[data-summary-months]');
    var grossOut = $('[data-summary-gross]');
    var discountRow = $('[data-summary-discount-row]');
    var discountOut = $('[data-summary-discount]');
    var totalOut = $('[data-summary-total]');

    var sync = function () {
      var checked = options.filter(function (option) {
        var input = $('input[name="term_months"]', option);
        return input && input.checked;
      })[0];

      options.forEach(function (option) {
        option.classList.toggle('is-selected', option === checked);
      });

      if (!checked) return;

      // Every figure is taken from the option's own data attributes, which the
      // server rendered. Nothing is recomputed here, so the summary cannot
      // disagree with what the server will charge.
      var attr = function (name) { return checked.getAttribute(name) || ''; };
      var discount = Number(attr('data-discount')) || 0;

      if (monthsOut) monthsOut.textContent = attr('data-months');
      if (grossOut) grossOut.textContent = attr('data-gross-label');

      if (discountRow && discountOut) {
        discountRow.hidden = discount <= 0;
        discountOut.textContent = '−' + attr('data-discount-label');
      }

      if (totalOut) totalOut.textContent = attr('data-total-label');
    };

    options.forEach(function (option) {
      var input = $('input[name="term_months"]', option);
      if (input) input.addEventListener('change', sync);
    });

    sync();
  }

  function boot() {
    initSidebar();
    initConfirm();
    initFilePreview();
    initFileLimits();
    initAutoFilter();
    initAutoSearch();
    initClientTabs();
    initRepeatable();
    initCharCount();
    initSlugSync();
    initColourInputs();
    initSecretReveal();
    initSwitchState();
    initStaffEdit();
    initHtmlEditors();
    initTermSelector();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
