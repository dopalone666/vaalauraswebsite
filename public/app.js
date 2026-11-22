(function () {
  'use strict';

  var state = {
    activeView: 'access',
    config: null,
    bearerToken: null,
    session: null,
    handoff: null,
    devFormOpen: false,
    popupWindow: null,

    // Changelog state
    changelogs: [],
    changelogStorageReady: true,
    activeChangelogCategory: 'All',
    expandedChangelogIds: {},
    editingChangelogId: null,
    changelogEditorOpen: false,

    // Guide state
    guides: [],
    guideStorageReady: true,
    activeGuideTopic: 'All',
    guideSearchQuery: '',
    selectedGuideId: null,
    editingGuideId: null,
    guideEditorOpen: false,
  };

  function el(id) {
    return document.getElementById(id);
  }

  function show(node, visible) {
    if (!node) return;
    if (visible) {
      node.classList.remove('hidden');
    } else {
      node.classList.add('hidden');
    }
  }

  function setText(id, value) {
    var node = el(id);
    if (node) {
      node.textContent = value;
    }
  }

  function setBanner(message, type) {
    var banner = el('global-banner');
    if (!banner) return;
    if (!message) {
      banner.textContent = '';
      banner.className = 'alert-banner hidden';
      return;
    }
    banner.textContent = message;
    banner.className =
      'alert-banner global-banner ' +
      (type === 'error' ? 'alert-error' : type === 'warn' ? 'alert-warn' : '');
  }

  function setDevError(message) {
    var errNode = el('dev-login-error');
    if (!errNode) return;
    if (!message) {
      errNode.textContent = '';
      show(errNode, false);
      return;
    }
    errNode.textContent = message;
    show(errNode, true);
  }

  function setInlineFormError(id, message) {
    var node = el(id);
    if (!node) return;
    if (!message) {
      node.textContent = '';
      show(node, false);
      return;
    }
    node.textContent = message;
    show(node, true);
  }

  function isDeveloper() {
    return Boolean(
      state.bearerToken &&
        state.session &&
        state.session.entitlement &&
        state.session.entitlement.active &&
        (state.session.user.provider === 'developer' ||
          state.session.entitlement.tierCode === 'developer')
    );
  }

  function initialsFor(name) {
    var parts = String(name || 'VA').trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return String(name || 'VA').slice(0, 2).toUpperCase();
  }

  function extractYouTubeId(rawUrl) {
    var trimmed = String(rawUrl || '').trim();
    if (!trimmed) return null;
    var parsed;
    try {
      parsed = new URL(trimmed);
    } catch (_) {
      return null;
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return null;
    }
    var host = parsed.hostname.toLowerCase();
    var allowed = {
      'youtube.com': 1,
      'www.youtube.com': 1,
      'm.youtube.com': 1,
      'youtu.be': 1,
      'www.youtu.be': 1,
      'youtube-nocookie.com': 1,
      'www.youtube-nocookie.com': 1,
    };
    if (!allowed[host]) return null;

    var candidate = null;
    if (host === 'youtu.be' || host === 'www.youtu.be') {
      var segs = parsed.pathname.split('/').filter(Boolean);
      candidate = segs[0] || null;
    } else if (parsed.pathname === '/watch' || parsed.pathname === '/watch/') {
      candidate = parsed.searchParams.get('v');
    } else {
      var m = parsed.pathname.match(/^\/(?:embed|shorts|live)\/([a-zA-Z0-9_-]{11})(?:\/|$)/);
      if (m) candidate = m[1];
    }
    if (!candidate || !/^[a-zA-Z0-9_-]{11}$/.test(candidate)) {
      return null;
    }
    return candidate;
  }

  function createYouTubeEmbedNode(videoId, titleText) {
    var wrap = document.createElement('div');
    wrap.className = 'video-frame';
    var iframe = document.createElement('iframe');
    iframe.src = 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(videoId);
    iframe.title = titleText || 'YouTube video guide';
    iframe.setAttribute(
      'allow',
      'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture'
    );
    iframe.setAttribute('allowfullscreen', '');
    iframe.setAttribute('loading', 'lazy');
    iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    wrap.appendChild(iframe);
    return wrap;
  }

  function formatDisplayDateToday() {
    var d = new Date();
    var months = [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ];
    return d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear();
  }

  async function apiJson(path, options) {
    var opts = options || {};
    var headers = Object.assign({}, opts.headers || {});
    if (state.bearerToken) {
      headers.Authorization = 'Bearer ' + state.bearerToken;
    }
    if (opts.body && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }
    var resp = await fetch(path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body,
    });
    var data = null;
    try {
      data = await resp.json();
    } catch (_) {
      data = null;
    }
    if (!resp.ok) {
      var msg = (data && data.error) || 'Request failed (' + resp.status + ').';
      throw new Error(msg);
    }
    return data;
  }

  function renderMemberAvatar(imgId, initialsId, user) {
    var img = el(imgId);
    var init = el(initialsId);
    if (!img || !init) return;

    init.textContent = initialsFor(user.displayName || user.username);
    if (user.avatarUrl && /^https?:\/\//i.test(user.avatarUrl)) {
      img.src = user.avatarUrl;
      img.alt = user.displayName;
      show(img, true);
      show(init, false);
    } else {
      img.removeAttribute('src');
      show(img, false);
      show(init, true);
    }
  }

  function providerDisplayName(provider) {
    if (provider === 'twitch') return 'Twitch';
    if (provider === 'patreon') return 'Patreon';
    if (provider === 'developer') return 'Developer';
    return 'Member';
  }

  function triggerHiddenNavigation(targetUrl) {
    var frame = document.createElement('iframe');
    frame.style.display = 'none';
    frame.src = targetUrl;
    document.body.appendChild(frame);
    setTimeout(function () {
      if (frame.parentNode) frame.parentNode.removeChild(frame);
    }, 1500);
  }

  function switchView(viewName, updateHash) {
    var valid = viewName === 'guide' || viewName === 'changelog' ? viewName : 'access';
    state.activeView = valid;

    var navBtns = document.querySelectorAll('.nav-link[data-view]');
    for (var i = 0; i < navBtns.length; i += 1) {
      var btn = navBtns[i];
      var isTarget = btn.getAttribute('data-view') === valid;
      btn.classList.toggle('is-active', isTarget);
      if (isTarget) {
        btn.setAttribute('aria-current', 'page');
      } else {
        btn.removeAttribute('aria-current');
      }
    }

    show(el('view-access'), valid === 'access');
    show(el('view-guide'), valid === 'guide');
    show(el('view-changelog'), valid === 'changelog');

    if (updateHash !== false) {
      var nextHash = '#' + valid;
      if (window.location.hash !== nextHash) {
        try {
          window.history.replaceState({}, '', nextHash);
        } catch (_) {}
      }
    }

    if (valid === 'guide') {
      renderGuideView();
    } else if (valid === 'changelog') {
      renderChangelogView();
    }
  }

  function toggleDevForm(forceOpen) {
    var form = el('developer-login-form');
    var toggleBtn = el('btn-toggle-dev-login');
    if (!form || !toggleBtn) return;

    var nextOpen = typeof forceOpen === 'boolean' ? forceOpen : !state.devFormOpen;
    state.devFormOpen = nextOpen;
    show(form, nextOpen);
    toggleBtn.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
    if (nextOpen) {
      setDevError('');
      var emailInput = el('dev-email');
      if (emailInput) emailInput.focus();
    }
  }

  function renderPortal() {
    var cfg = state.config;
    var signedIn = Boolean(state.session && state.bearerToken);

    show(el('topbar-signout-btn'), signedIn);

    if (cfg) {
      var warnNode = el('portal-signing-warning');
      if (warnNode) {
        warnNode.classList.toggle('hidden', Boolean(cfg.signingConfigured));
      }
      var minDollars = '$' + (cfg.patreonMinTierCents / 100).toFixed(2);
      setText('min-tier-copy', minDollars);
      setText('patreon-tier-note', minDollars + '+ tier');
    }

    if (!signedIn) {
      show(el('state-logged-out'), true);
      show(el('state-verified'), false);
      show(el('state-denied'), false);
    } else {
      var user = state.session.user;
      var ent = state.session.entitlement;
      var providerLabel = providerDisplayName(user.provider);
      var checkedLabel = ent.checkedAt ? new Date(ent.checkedAt).toLocaleString() : 'Just now';

      if (ent.active) {
        show(el('state-logged-out'), false);
        show(el('state-verified'), true);
        show(el('state-denied'), false);

        renderMemberAvatar('verified-avatar-img', 'verified-avatar-initials', user);
        el('verified-name').textContent = user.displayName || user.username;
        el('verified-summary').textContent =
          user.provider === 'developer'
            ? 'Developer · Permanent Access'
            : providerLabel + ' · ' + ent.tierLabel;
        el('verified-reason').textContent = ent.reason;
        el('verified-checked-at').textContent = checkedLabel;

        show(el('btn-recheck-verified'), user.provider !== 'developer');
      } else {
        show(el('state-logged-out'), false);
        show(el('state-verified'), false);
        show(el('state-denied'), true);

        renderMemberAvatar('denied-avatar-img', 'denied-avatar-initials', user);
        el('denied-name').textContent = user.displayName || user.username;
        el('denied-summary').textContent = providerLabel + ' · ' + ent.tierLabel;
        el('denied-reason').textContent = ent.reason;
        el('denied-checked-at').textContent = checkedLabel;

        var linksWrap = el('denied-subscribe-links');
        var twLink = el('link-subscribe-twitch');
        var patLink = el('link-subscribe-patreon');
        var showTwitch = Boolean(user.provider === 'twitch' && cfg && cfg.twitchChannelUrl);
        var showPatreon = Boolean(user.provider === 'patreon' && cfg && cfg.patreonCreatorUrl);

        if (twLink) {
          if (showTwitch) twLink.href = cfg.twitchChannelUrl;
          show(twLink, showTwitch);
        }
        if (patLink) {
          if (showPatreon) patLink.href = cfg.patreonCreatorUrl;
          show(patLink, showPatreon);
        }
        show(linksWrap, showTwitch || showPatreon);
      }
    }

    renderGuideView();
    renderChangelogView();
  }

  /* =========================================================
     GUIDE VIEW & DEVELOPER EDITOR
     ========================================================= */

  function renderRichBody(container, rawBody, embedVideos) {
    var lines = String(rawBody || '').split(/\r?\n/);
    var currentUl = null;

    function flushUl() {
      if (currentUl) {
        container.appendChild(currentUl);
        currentUl = null;
      }
    }

    for (var i = 0; i < lines.length; i += 1) {
      var trimmed = lines[i].trim();
      if (!trimmed) {
        flushUl();
        continue;
      }

      if (embedVideos) {
        var ytId = extractYouTubeId(trimmed);
        if (ytId) {
          flushUl();
          container.appendChild(createYouTubeEmbedNode(ytId, 'Guide video walkthrough'));
          continue;
        }
      }

      if (/^#{1,3}\s+/.test(trimmed)) {
        flushUl();
        var heading = document.createElement('h3');
        heading.textContent = trimmed.replace(/^#{1,3}\s+/, '');
        container.appendChild(heading);
        continue;
      }

      if (/^[-*]\s+/.test(trimmed)) {
        if (!currentUl) {
          currentUl = document.createElement('ul');
        }
        var li = document.createElement('li');
        li.textContent = trimmed.replace(/^[-*]\s+/, '');
        currentUl.appendChild(li);
        continue;
      }

      flushUl();
      var p = document.createElement('p');
      p.textContent = trimmed;
      container.appendChild(p);
    }

    flushUl();
  }

  function openGuideEditor(article) {
    state.guideEditorOpen = true;
    state.editingGuideId = article ? article.id : null;
    setInlineFormError('guide-form-error', '');
    setText('guide-editor-heading', article ? 'Edit Guide Article' : 'New Guide Article');
    setText('btn-save-guide', article ? 'Save Changes' : 'Save Article');

    el('guide-title-input').value = article ? article.title : '';
    el('guide-topic-input').value = article ? article.topic : '';
    el('guide-summary-input').value = article ? article.summary : '';
    el('guide-youtube-input').value = article && article.youtubeUrl ? article.youtubeUrl : '';
    el('guide-body-input').value = article ? article.body : '';

    show(el('guide-editor-panel'), true);
    el('guide-title-input').focus();
  }

  function closeGuideEditor() {
    state.guideEditorOpen = false;
    state.editingGuideId = null;
    setInlineFormError('guide-form-error', '');
    show(el('guide-editor-panel'), false);
  }

  async function saveGuideArticle(event) {
    event.preventDefault();
    setInlineFormError('guide-form-error', '');

    var payload = {
      title: (el('guide-title-input').value || '').trim(),
      topic: (el('guide-topic-input').value || '').trim(),
      summary: (el('guide-summary-input').value || '').trim(),
      youtubeUrl: (el('guide-youtube-input').value || '').trim(),
      body: (el('guide-body-input').value || '').trim(),
    };

    var btn = el('btn-save-guide');
    if (btn) btn.disabled = true;

    try {
      var data;
      if (state.editingGuideId) {
        data = await apiJson(
          '/api/content/guides/' + encodeURIComponent(state.editingGuideId),
          {
            method: 'PUT',
            body: JSON.stringify(payload),
          }
        );
      } else {
        data = await apiJson('/api/content/guides', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      state.guides = Array.isArray(data.articles) ? data.articles : [];
      if (data.article && data.article.id) {
        state.selectedGuideId = data.article.id;
      }
      closeGuideEditor();
      renderGuideView();
    } catch (err) {
      setInlineFormError('guide-form-error', err.message || 'Could not save guide article.');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function deleteGuideArticle(article) {
    if (!article || !article.id) return;
    setBanner('');
    try {
      var data = await apiJson('/api/content/guides/' + encodeURIComponent(article.id), {
        method: 'DELETE',
      });
      state.guides = Array.isArray(data.articles) ? data.articles : [];
      if (state.selectedGuideId === article.id) {
        state.selectedGuideId = state.guides[0] ? state.guides[0].id : null;
      }
      if (state.editingGuideId === article.id) {
        closeGuideEditor();
      }
      renderGuideView();
    } catch (err) {
      setBanner(err.message || 'Could not delete guide article.', 'error');
    }
  }

  function renderGuideView() {
    var dev = isDeveloper();
    show(el('btn-new-guide'), dev);
    show(el('guide-kv-warning'), dev && !state.guideStorageReady);
    if (!dev && state.guideEditorOpen) {
      closeGuideEditor();
    }

    var topicFiltersEl = el('guide-topic-filters');
    var sidebarListEl = el('guide-sidebar-list');
    var readerEl = el('guide-reader');
    if (!topicFiltersEl || !sidebarListEl || !readerEl) return;

    var topics = ['All'];
    var seenTopic = { All: 1 };
    for (var i = 0; i < state.guides.length; i += 1) {
      var t = state.guides[i].topic || 'General';
      if (!seenTopic[t]) {
        seenTopic[t] = 1;
        topics.push(t);
      }
    }
    if (!seenTopic[state.activeGuideTopic]) {
      state.activeGuideTopic = 'All';
    }

    topicFiltersEl.textContent = '';
    for (var ti = 0; ti < topics.length; ti += 1) {
      (function (topicName) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'filter-tab' + (state.activeGuideTopic === topicName ? ' is-active' : '');
        btn.textContent = topicName;
        btn.setAttribute('aria-pressed', state.activeGuideTopic === topicName ? 'true' : 'false');
        btn.addEventListener('click', function () {
          state.activeGuideTopic = topicName;
          renderGuideView();
        });
        topicFiltersEl.appendChild(btn);
      })(topics[ti]);
    }

    var q = state.guideSearchQuery.trim().toLowerCase();
    var filtered = [];
    for (var gi = 0; gi < state.guides.length; gi += 1) {
      var art = state.guides[gi];
      var matchesTopic = state.activeGuideTopic === 'All' || art.topic === state.activeGuideTopic;
      var haystack = (art.title + ' ' + art.topic + ' ' + art.summary + ' ' + art.body).toLowerCase();
      var matchesQuery = !q || haystack.indexOf(q) !== -1;
      if (matchesTopic && matchesQuery) {
        filtered.push(art);
      }
    }

    sidebarListEl.textContent = '';
    if (filtered.length === 0) {
      var emptySide = document.createElement('p');
      emptySide.className = 'empty-state-box';
      emptySide.textContent = 'No matching guide articles.';
      sidebarListEl.appendChild(emptySide);

      readerEl.textContent = '';
      var emptyMain = document.createElement('p');
      emptyMain.className = 'empty-state-box';
      emptyMain.textContent = dev
        ? 'No matching articles. Click "+ New Article" to write a guide.'
        : 'No matching guide articles found.';
      readerEl.appendChild(emptyMain);
      return;
    }

    var selected = null;
    for (var fi = 0; fi < filtered.length; fi += 1) {
      if (filtered[fi].id === state.selectedGuideId) {
        selected = filtered[fi];
        break;
      }
    }
    if (!selected) {
      selected = filtered[0];
      state.selectedGuideId = selected.id;
    }

    for (var si = 0; si < filtered.length; si += 1) {
      (function (item) {
        var navBtn = document.createElement('button');
        navBtn.type = 'button';
        navBtn.className = 'guide-nav-item' + (item.id === selected.id ? ' is-active' : '');

        var topicSpan = document.createElement('span');
        topicSpan.className = 'guide-nav-topic';
        topicSpan.textContent = item.topic || 'General';

        var titleSpan = document.createElement('span');
        titleSpan.className = 'guide-nav-title';
        titleSpan.textContent = item.title;

        navBtn.appendChild(topicSpan);
        navBtn.appendChild(titleSpan);
        navBtn.addEventListener('click', function () {
          state.selectedGuideId = item.id;
          renderGuideView();
        });
        sidebarListEl.appendChild(navBtn);
      })(filtered[si]);
    }

    // Render selected article reader
    readerEl.textContent = '';
    var topRow = document.createElement('div');
    topRow.className = 'reader-top';

    var headingBox = document.createElement('div');
    var metaLine = document.createElement('div');
    metaLine.className = 'reader-meta';
    var updatedLabel = selected.updatedAt
      ? new Date(selected.updatedAt).toLocaleDateString()
      : '';
    metaLine.textContent =
      (selected.topic || 'General') + (updatedLabel ? ' · Updated ' + updatedLabel : '');

    var h2 = document.createElement('h2');
    h2.className = 'reader-title';
    h2.textContent = selected.title;

    headingBox.appendChild(metaLine);
    headingBox.appendChild(h2);
    topRow.appendChild(headingBox);

    if (dev) {
      var devActions = document.createElement('div');
      devActions.className = 'dev-item-actions';

      var editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'btn btn-outline btn-xs';
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', function () {
        openGuideEditor(selected);
      });

      var delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn btn-danger-ghost btn-xs';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', function () {
        deleteGuideArticle(selected);
      });

      devActions.appendChild(editBtn);
      devActions.appendChild(delBtn);
      topRow.appendChild(devActions);
    }

    readerEl.appendChild(topRow);

    if (selected.summary) {
      var lead = document.createElement('p');
      lead.className = 'reader-lead';
      lead.textContent = selected.summary;
      readerEl.appendChild(lead);
    }

    if (selected.youtubeUrl) {
      var mainYtId = extractYouTubeId(selected.youtubeUrl);
      if (mainYtId) {
        readerEl.appendChild(createYouTubeEmbedNode(mainYtId, selected.title));
      }
    }

    if (selected.body) {
      var rich = document.createElement('div');
      rich.className = 'rich-article';
      renderRichBody(rich, selected.body, true);
      readerEl.appendChild(rich);
    }
  }

  /* =========================================================
     CHANGELOG VIEW & DEVELOPER EDITOR
     ========================================================= */

  function parseChangelogSections(rawBody) {
    var lines = String(rawBody || '').split(/\r?\n/);
    var sections = [];
    var current = { title: 'Release Notes', items: [] };

    for (var i = 0; i < lines.length; i += 1) {
      var line = lines[i].trim();
      if (!line) continue;

      if (/^#{1,3}\s+/.test(line)) {
        if (current.items.length > 0 || sections.length > 0) {
          if (current.items.length > 0) {
            sections.push(current);
          }
        }
        current = {
          title: line.replace(/^#{1,3}\s+/, ''),
          items: [],
        };
      } else if (/^[-*]\s+/.test(line)) {
        current.items.push(line.replace(/^[-*]\s+/, ''));
      } else {
        current.items.push(line);
      }
    }

    if (current.items.length > 0) {
      sections.push(current);
    }
    return sections;
  }

  function openChangelogEditor(post) {
    state.changelogEditorOpen = true;
    state.editingChangelogId = post ? post.id : null;
    setInlineFormError('cl-form-error', '');
    setText('changelog-editor-heading', post ? 'Edit Changelog Post' : 'New Changelog Post');
    setText('btn-save-changelog', post ? 'Save Changes' : 'Publish Post');

    el('cl-version-input').value = post ? post.version : '';
    el('cl-category-input').value = post ? post.category : 'Core';
    el('cl-date-input').value = post ? post.publishedAt : formatDisplayDateToday();
    el('cl-summary-input').value = post ? post.summary : '';
    el('cl-body-input').value = post ? post.body : '';

    show(el('changelog-editor-panel'), true);
    el('cl-version-input').focus();
  }

  function closeChangelogEditor() {
    state.changelogEditorOpen = false;
    state.editingChangelogId = null;
    setInlineFormError('cl-form-error', '');
    show(el('changelog-editor-panel'), false);
  }

  async function saveChangelogPost(event) {
    event.preventDefault();
    setInlineFormError('cl-form-error', '');

    var payload = {
      version: (el('cl-version-input').value || '').trim(),
      category: (el('cl-category-input').value || '').trim(),
      publishedAt: (el('cl-date-input').value || '').trim(),
      summary: (el('cl-summary-input').value || '').trim(),
      body: (el('cl-body-input').value || '').trim(),
    };

    var btn = el('btn-save-changelog');
    if (btn) btn.disabled = true;

    try {
      var data;
      if (state.editingChangelogId) {
        data = await apiJson(
          '/api/content/changelogs/' + encodeURIComponent(state.editingChangelogId),
          {
            method: 'PUT',
            body: JSON.stringify(payload),
          }
        );
      } else {
        data = await apiJson('/api/content/changelogs', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      state.changelogs = Array.isArray(data.posts) ? data.posts : [];
      if (data.post && data.post.id) {
        state.expandedChangelogIds[data.post.id] = true;
      }
      closeChangelogEditor();
      renderChangelogView();
    } catch (err) {
      setInlineFormError('cl-form-error', err.message || 'Could not save changelog post.');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function deleteChangelogPost(post) {
    if (!post || !post.id) return;
    setBanner('');
    try {
      var data = await apiJson('/api/content/changelogs/' + encodeURIComponent(post.id), {
        method: 'DELETE',
      });
      state.changelogs = Array.isArray(data.posts) ? data.posts : [];
      if (state.editingChangelogId === post.id) {
        closeChangelogEditor();
      }
      renderChangelogView();
    } catch (err) {
      setBanner(err.message || 'Could not delete changelog post.', 'error');
    }
  }

  function renderChangelogView() {
    var dev = isDeveloper();
    show(el('btn-new-changelog'), dev);
    show(el('changelog-kv-warning'), dev && !state.changelogStorageReady);
    if (!dev && state.changelogEditorOpen) {
      closeChangelogEditor();
    }

    var filterEl = el('changelog-category-filters');
    var listEl = el('changelog-list');
    if (!filterEl || !listEl) return;

    var categories = ['All'];
    var seenCat = { All: 1 };
    for (var i = 0; i < state.changelogs.length; i += 1) {
      var cat = state.changelogs[i].category || 'Core';
      if (!seenCat[cat]) {
        seenCat[cat] = 1;
        categories.push(cat);
      }
    }
    if (!seenCat[state.activeChangelogCategory]) {
      state.activeChangelogCategory = 'All';
    }

    filterEl.textContent = '';
    for (var ci = 0; ci < categories.length; ci += 1) {
      (function (catName) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'filter-tab' + (state.activeChangelogCategory === catName ? ' is-active' : '');
        btn.textContent = catName;
        btn.addEventListener('click', function () {
          state.activeChangelogCategory = catName;
          renderChangelogView();
        });
        filterEl.appendChild(btn);
      })(categories[ci]);
    }

    var filtered = [];
    for (var pi = 0; pi < state.changelogs.length; pi += 1) {
      var post = state.changelogs[pi];
      if (state.activeChangelogCategory === 'All' || post.category === state.activeChangelogCategory) {
        filtered.push({ post: post, isLatest: pi === 0 });
      }
    }

    listEl.textContent = '';
    if (filtered.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'panel empty-state-box';
      empty.textContent = dev
        ? 'No changelog posts yet. Click "+ New Changelog Post" to publish your first release.'
        : 'No changelog posts published yet.';
      listEl.appendChild(empty);
      return;
    }

    for (var fi = 0; fi < filtered.length; fi += 1) {
      (function (entry, index) {
        var p = entry.post;
        if (typeof state.expandedChangelogIds[p.id] !== 'boolean') {
          state.expandedChangelogIds[p.id] = index === 0;
        }
        var isOpen = Boolean(state.expandedChangelogIds[p.id]);

        var card = document.createElement('article');
        card.className = 'cl-card' + (isOpen ? ' is-open' : '');

        var head = document.createElement('div');
        head.className = 'cl-card-head';

        var toggleBtn = document.createElement('button');
        toggleBtn.type = 'button';
        toggleBtn.className = 'cl-toggle-btn';
        toggleBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');

        var left = document.createElement('span');
        left.className = 'cl-head-left';

        var chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        chevron.setAttribute('viewBox', '0 0 24 24');
        chevron.setAttribute('fill', 'none');
        chevron.setAttribute('stroke', 'currentColor');
        chevron.setAttribute('stroke-width', '2');
        chevron.setAttribute('aria-hidden', 'true');
        chevron.setAttribute('class', 'cl-chevron');
        var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', 'M6 9l6 6 6-6');
        chevron.appendChild(path);

        var verSpan = document.createElement('span');
        verSpan.className = 'cl-version';
        verSpan.textContent = p.version;

        left.appendChild(chevron);
        left.appendChild(verSpan);

        if (entry.isLatest) {
          var latestTag = document.createElement('span');
          latestTag.className = 'cl-latest-tag';
          latestTag.textContent = 'Latest';
          left.appendChild(latestTag);
        }

        if (p.category) {
          var catSpan = document.createElement('span');
          catSpan.className = 'cl-category-meta';
          catSpan.textContent = '· ' + p.category;
          left.appendChild(catSpan);
        }

        var dateSpan = document.createElement('span');
        dateSpan.className = 'cl-date mono tabular-nums';
        dateSpan.textContent = p.publishedAt || '';

        toggleBtn.appendChild(left);
        toggleBtn.appendChild(dateSpan);
        toggleBtn.addEventListener('click', function () {
          state.expandedChangelogIds[p.id] = !Boolean(state.expandedChangelogIds[p.id]);
          renderChangelogView();
        });

        head.appendChild(toggleBtn);

        if (dev) {
          var devWrap = document.createElement('div');
          devWrap.className = 'cl-dev-actions';

          var editBtn = document.createElement('button');
          editBtn.type = 'button';
          editBtn.className = 'btn btn-outline btn-xs';
          editBtn.textContent = 'Edit';
          editBtn.addEventListener('click', function () {
            openChangelogEditor(p);
          });

          var delBtn = document.createElement('button');
          delBtn.type = 'button';
          delBtn.className = 'btn btn-danger-ghost btn-xs';
          delBtn.textContent = 'Delete';
          delBtn.addEventListener('click', function () {
            deleteChangelogPost(p);
          });

          devWrap.appendChild(editBtn);
          devWrap.appendChild(delBtn);
          head.appendChild(devWrap);
        }

        card.appendChild(head);

        if (isOpen) {
          var body = document.createElement('div');
          body.className = 'cl-card-body';

          if (p.summary) {
            var sumP = document.createElement('p');
            sumP.className = 'cl-summary';
            sumP.textContent = p.summary;
            body.appendChild(sumP);
          }

          var sections = parseChangelogSections(p.body);
          if (sections.length > 0) {
            var secWrap = document.createElement('div');
            secWrap.className = 'cl-sections';
            for (var s = 0; s < sections.length; s += 1) {
              var sec = sections[s];
              var secBox = document.createElement('section');
              secBox.className = 'cl-section';

              var secHeading = document.createElement('h3');
              secHeading.className = 'cl-section-title';
              secHeading.textContent = sec.title;
              secBox.appendChild(secHeading);

              var ul = document.createElement('ul');
              ul.className = 'cl-bullets';
              for (var b = 0; b < sec.items.length; b += 1) {
                var li = document.createElement('li');
                li.textContent = sec.items[b];
                ul.appendChild(li);
              }
              secBox.appendChild(ul);
              secWrap.appendChild(secBox);
            }
            body.appendChild(secWrap);
          }

          card.appendChild(body);
        }

        listEl.appendChild(card);
      })(filtered[fi], fi);
    }
  }

  /* =========================================================
     AUTH & DESKTOP LAUNCH
     ========================================================= */

  async function startOAuth(provider) {
    setBanner('');
    try {
      var data = await apiJson('/api/auth/' + provider + '/url');
      var popup = window.open(
        data.url,
        'vaalauras_' + provider + '_oauth',
        'width=560,height=720,menubar=no,toolbar=no'
      );
      if (!popup) {
        window.location.href = data.url;
        return;
      }
      state.popupWindow = popup;
    } catch (err) {
      setBanner(err.message || 'Could not start OAuth login.', 'error');
    }
  }

  async function claimAuthCode(authCode) {
    setBanner('');
    try {
      var data = await apiJson('/api/auth/claim', {
        method: 'POST',
        body: JSON.stringify({ authCode: authCode }),
      });
      state.bearerToken = data.bearerToken;
      state.session = {
        user: data.user,
        entitlement: data.entitlement,
      };
      state.handoff = null;
      renderPortal();
    } catch (err) {
      setBanner(err.message || 'Could not verify login handoff.', 'error');
    }
  }

  async function submitDeveloperLogin(event) {
    event.preventDefault();
    setBanner('');
    setDevError('');

    var email = (el('dev-email').value || '').trim();
    var password = el('dev-password').value || '';
    if (!email || !password) {
      setDevError('Enter your email and password.');
      return;
    }

    var submitBtn = el('btn-dev-submit');
    var origText = submitBtn ? submitBtn.textContent : 'Sign in as Developer';
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Signing in...';
    }

    try {
      var data = await apiJson('/api/auth/developer', {
        method: 'POST',
        body: JSON.stringify({ email: email, password: password }),
      });
      state.bearerToken = data.bearerToken;
      state.session = {
        user: data.user,
        entitlement: data.entitlement,
      };
      state.handoff = null;
      el('dev-password').value = '';
      toggleDevForm(false);
      renderPortal();
    } catch (err) {
      setDevError(err.message || 'Invalid email or password.');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = origText;
      }
    }
  }

  async function recheckSubscription() {
    setBanner('');
    try {
      var data = await apiJson('/api/auth/recheck', { method: 'POST' });
      if (data.bearerToken) {
        state.bearerToken = data.bearerToken;
      }
      state.session = {
        user: data.user,
        entitlement: data.entitlement,
      };
      state.handoff = null;
      renderPortal();
      setBanner('Membership status refreshed.', 'info');
    } catch (err) {
      setBanner(err.message || 'Could not refresh subscription.', 'error');
    }
  }

  async function signOut() {
    setBanner('');
    setDevError('');
    try {
      if (state.bearerToken) {
        await apiJson('/api/auth/logout', { method: 'POST' });
      }
    } catch (_) {}
    state.bearerToken = null;
    state.session = null;
    state.handoff = null;
    closeGuideEditor();
    closeChangelogEditor();
    renderPortal();
  }

  async function launchDesktopApp() {
    setBanner('');
    var btn = el('btn-launch-desktop');
    if (btn) btn.disabled = true;

    try {
      var payload = await apiJson('/api/license/issue', { method: 'POST' });
      state.handoff = payload;
      triggerHiddenNavigation(payload.appLaunchUri);
    } catch (err) {
      setBanner(err.message || 'Could not generate desktop launch code.', 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function sendToLocalhostFallback() {
    setBanner('');
    try {
      var payload = await apiJson('/api/license/issue', { method: 'POST' });
      state.handoff = payload;
      triggerHiddenNavigation(payload.localhostCallbackUrl);
    } catch (err) {
      setBanner(err.message || 'Could not send login code to localhost.', 'error');
    }
  }

  async function loadContent() {
    try {
      var results = await Promise.all([
        apiJson('/api/content/changelogs'),
        apiJson('/api/content/guides'),
      ]);
      if (results[0] && Array.isArray(results[0].posts)) {
        state.changelogs = results[0].posts;
        state.changelogStorageReady = Boolean(results[0].storageReady);
      }
      if (results[1] && Array.isArray(results[1].articles)) {
        state.guides = results[1].articles;
        state.guideStorageReady = Boolean(results[1].storageReady);
      }
    } catch (_) {}
  }

  function wireEvents() {
    var logoImg = el('brand-logo-img');
    var logoFallback = el('brand-logo-fallback');
    if (logoImg && logoFallback) {
      logoImg.addEventListener('error', function () {
        show(logoImg, false);
        show(logoFallback, true);
      });
    }

    var wordmarkImg = el('brand-wordmark-img');
    var wordmarkFallback = el('brand-wordmark-fallback');
    if (wordmarkImg && wordmarkFallback) {
      wordmarkImg.addEventListener('error', function () {
        show(wordmarkImg, false);
        show(wordmarkFallback, true);
      });
    }

    el('brand-link').addEventListener('click', function (e) {
      e.preventDefault();
      switchView('access');
    });

    var navBtns = document.querySelectorAll('.nav-link[data-view]');
    for (var i = 0; i < navBtns.length; i += 1) {
      navBtns[i].addEventListener('click', function () {
        switchView(this.getAttribute('data-view'));
      });
    }

    el('topbar-signout-btn').addEventListener('click', signOut);

    el('btn-twitch-login').addEventListener('click', function () {
      startOAuth('twitch');
    });
    el('btn-patreon-login').addEventListener('click', function () {
      startOAuth('patreon');
    });

    el('btn-toggle-dev-login').addEventListener('click', function () {
      toggleDevForm();
    });
    el('developer-login-form').addEventListener('submit', submitDeveloperLogin);

    el('btn-launch-desktop').addEventListener('click', launchDesktopApp);
    el('btn-send-localhost-inline').addEventListener('click', sendToLocalhostFallback);
    el('btn-recheck-verified').addEventListener('click', recheckSubscription);
    el('btn-signout-verified').addEventListener('click', signOut);
    el('btn-recheck-denied').addEventListener('click', recheckSubscription);
    el('btn-signout-denied').addEventListener('click', signOut);

    // Guide events
    el('btn-new-guide').addEventListener('click', function () {
      openGuideEditor(null);
    });
    el('btn-cancel-guide-edit').addEventListener('click', closeGuideEditor);
    el('guide-editor-form').addEventListener('submit', saveGuideArticle);
    el('guide-search-input').addEventListener('input', function () {
      state.guideSearchQuery = this.value;
      renderGuideView();
    });

    // Changelog events
    el('btn-new-changelog').addEventListener('click', function () {
      openChangelogEditor(null);
    });
    el('btn-cancel-changelog-edit').addEventListener('click', closeChangelogEditor);
    el('changelog-editor-form').addEventListener('submit', saveChangelogPost);

    window.addEventListener('message', function (event) {
      var data = event.data;
      if (!data || typeof data !== 'object') return;
      if (event.origin !== window.location.origin) return;

      if (data.type === 'VAAL_AUTH_COMPLETE' && data.authCode) {
        switchView('access');
        claimAuthCode(data.authCode);
      } else if (data.type === 'VAAL_AUTH_ERROR') {
        switchView('access');
        setBanner(data.error || 'OAuth login failed.', 'error');
      }
    });
  }

  async function init() {
    wireEvents();

    var hash = window.location.hash.replace(/^#/, '').toLowerCase();
    if (hash === 'guide' || hash === 'changelog' || hash === 'access') {
      state.activeView = hash;
    }

    try {
      var initial = await Promise.all([apiJson('/api/config'), loadContent()]);
      state.config = initial[0];
    } catch (err) {
      setBanner('Could not load portal configuration: ' + err.message, 'error');
    }

    renderPortal();
    switchView(state.activeView, false);

    var params = new URLSearchParams(window.location.search);
    var authCode = params.get('authCode');
    var authError = params.get('authError');
    if (authCode || authError) {
      window.history.replaceState({}, '', window.location.pathname);
      switchView('access', false);
      if (authError) {
        setBanner(authError, 'error');
      } else if (authCode) {
        await claimAuthCode(authCode);
      }
    }
  }

  init();
})();
