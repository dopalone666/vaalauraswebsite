(function () {
  'use strict';

  var state = {
    activeView: 'home',
    developer: false,
    loginConfigured: true,
    site: null,
    siteStorageReady: true,
    homeEditorOpen: false,
    homeDraftButtons: [],
    homeDraftFeatures: [],

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

  var DEFAULT_HOME = {
    logoUrl: '/assets/vaalauras_logo.png', wordmarkUrl: '/assets/vaalauras_wordmark.png',
    eyebrow: 'THE PATH OF EXILE OVERLAY', footnote: 'BUILT FOR YOUR BUILD',
    sectionKicker: 'THE EXPERIENCE', sectionTitle: 'Every moment', sectionHighlight: 'matters.',
    sectionIntro: 'Your game deserves an interface that stays out of the way until it matters most. Explore VaalAuras and make your overlay your own.',
    features: [
      { eyebrow: 'I / AWARENESS', title: 'See what matters.', description: 'Keep important resources and abilities within sight, without letting the interface take over your screen.', icon: 'eye', iconUrl: '', imageUrl: '' },
      { eyebrow: 'II / CONTROL', title: 'Make it yours.', description: 'Shape your setup around the way you play. Your screen, your priorities, your experience.', icon: 'sliders', iconUrl: '', imageUrl: '' },
      { eyebrow: 'III / EVOLUTION', title: 'Always improving.', description: 'Follow the changelog as the project evolves, and find walkthroughs when you need a hand.', icon: 'shield', iconUrl: '', imageUrl: '' }
    ],
    ctaKicker: 'YOUR NEXT STEP', ctaTitle: 'Ready to enter', ctaHighlight: 'the fray?',
    ctaDescription: "Get started with the guide, or see what's changed in the latest updates.",
    guideLabel: 'Explore the guide', changelogLabel: 'View changelog'
  };
  var HOME_FIELDS = {
    logoUrl: 'home-logo-url', wordmarkUrl: 'home-wordmark-url', eyebrow: 'home-eyebrow',
    footnote: 'home-footnote', sectionKicker: 'home-section-kicker-input',
    sectionTitle: 'home-section-title-input', sectionHighlight: 'home-section-highlight-input',
    sectionIntro: 'home-section-intro-input', ctaKicker: 'home-cta-kicker-input',
    ctaTitle: 'home-cta-title-input', ctaHighlight: 'home-cta-highlight-input',
    ctaDescription: 'home-cta-description-input', guideLabel: 'home-guide-label-input',
    changelogLabel: 'home-changelog-label-input'
  };
  var ICON_SVGS = {
    eye: '<svg viewBox="0 0 48 48" fill="none"><path d="M5 24s7-11 19-11 19 11 19 11-7 11-19 11S5 24 5 24Z"/><circle cx="24" cy="24" r="7"/><circle cx="24" cy="24" r="2" fill="currentColor" stroke="none"/><path d="M24 4v5M24 39v5M4 24h5M39 24h5"/></svg>',
    sliders: '<svg viewBox="0 0 48 48" fill="none"><path d="M8 12h32M8 24h32M8 36h32"/><circle cx="18" cy="12" r="4" fill="#141011"/><circle cx="32" cy="24" r="4" fill="#141011"/><circle cx="21" cy="36" r="4" fill="#141011"/></svg>',
    shield: '<svg viewBox="0 0 48 48" fill="none"><path d="M24 4 39 12v17L24 44 9 29V12L24 4Z"/><path d="m16 24 6 6 12-13"/><path d="M24 4v8M9 12l8 5M39 12l-8 5"/></svg>'
  };

  var DEFAULT_SITE = {
    title: 'VaalAuras',
    home: DEFAULT_HOME,
    tags: [],
    headline: '',
    subline: '',
    footer: '',
    buttons: [{ id: 'download', label: 'Download', url: '', style: 'primary' }],
    socials: {
      patreon: 'https://www.patreon.com/SayakaNyokota',
      twitch: 'https://www.twitch.tv/icddsayaka',
      discord: 'https://discord.com/invite/GQVy8uUBW',
    },
  };

  function el(id) {
    return document.getElementById(id);
  }

  function show(node, visible) {
    if (!node) return;
    node.classList.toggle('hidden', !visible);
  }

  function setText(id, value) {
    var node = el(id);
    if (node) node.textContent = value;
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

  function setInlineFormError(id, message) {
    var node = el(id);
    if (!node) return;
    node.textContent = message || '';
    show(node, Boolean(message));
  }

  function isDeveloper() {
    return state.developer === true;
  }

  function isSafeHref(url) {
    return /^https?:\/\//i.test(url) || (url.charAt(0) === '/' && url.charAt(1) !== '/');
  }

  function isSafeIconSource(value) {
    return typeof value === 'string' && (
      isSafeHref(value) ||
      /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)
    );
  }

  // Resize uploaded icons in the browser before embedding in admin-protected KV content.
  // This avoids a separate storage dependency and keeps site settings lightweight.
  function readUploadedIcon(file) {
    return new Promise(function (resolve, reject) {
      if (!file || !/^image\/(?:png|jpeg|webp)$/.test(file.type)) {
        reject(new Error('Upload a PNG, JPEG or WebP icon.')); return;
      }
      if (file.size > 5 * 1024 * 1024) {
        reject(new Error('Choose an icon smaller than 5 MB.')); return;
      }
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('Could not read the selected icon.')); };
      reader.onload = function () {
        var image = new Image();
        image.onerror = function () { reject(new Error('Could not decode the selected icon.')); };
        image.onload = function () {
          if (!image.naturalWidth || !image.naturalHeight) { reject(new Error('Empty icon image.')); return; }
          var canvas = document.createElement('canvas');
          // Preserve aspect ratio; small icons are never scaled up.
          var scale = Math.min(1, 160 / Math.max(image.naturalWidth, image.naturalHeight));
          canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
          canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
          var context = canvas.getContext('2d');
          if (!context) { reject(new Error('Image processing is not supported by this browser.')); return; }
          context.clearRect(0, 0, canvas.width, canvas.height);
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          var output = canvas.toDataURL('image/webp', 0.86);
          if (!/^data:image\/webp;base64,/.test(output)) output = canvas.toDataURL('image/png');
          if (output.length > 140000) { reject(new Error('The icon is too complex. Try a smaller PNG or WebP.')); return; }
          resolve(output);
        };
        image.src = String(reader.result);
      };
      reader.readAsDataURL(file);
    });
  }

  async function apiJson(path, options) {
    var opts = options || {};
    var headers = Object.assign({ 'X-Requested-With': 'VaalAuras' }, opts.headers || {});
    if (opts.body && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }
    var resp = await fetch(path, {
      method: opts.method || 'GET',
      headers: headers,
      credentials: 'same-origin',
      cache: 'no-store',
      body: opts.body,
    });
    var data = null;
    try {
      data = await resp.json();
    } catch (_) {
      data = null;
    }
    if (resp.status === 401 && state.developer) {
      // Session expired: drop back to public mode.
      state.developer = false;
      applyDeveloperState();
    }
    if (!resp.ok) {
      throw new Error((data && data.error) || 'Request failed (' + resp.status + ').');
    }
    return data;
  }

  function formatDisplayDateToday() {
    var d = new Date();
    var months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    return d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear();
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
     VIEWS
     ========================================================= */

  function switchView(viewName, updateHash) {
    var valid = viewName === 'guide' || viewName === 'changelog' ? viewName : 'home';
    state.activeView = valid;

    var navBtns = document.querySelectorAll('.nav-link[data-view]');
    for (var i = 0; i < navBtns.length; i += 1) {
      var btn = navBtns[i];
      var isTarget = btn.getAttribute('data-view') === valid;
      btn.classList.toggle('is-active', isTarget);
      if (isTarget) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
    }

    show(el('view-home'), valid === 'home');
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

    if (valid === 'guide') renderGuideView();
    else if (valid === 'changelog') renderChangelogView();
  }

  /* =========================================================
     HOME PAGE
     ========================================================= */

  function currentSite() {
    return state.site || DEFAULT_SITE;
  }

  function renderSocials() {
    var s = currentSite().socials || DEFAULT_SITE.socials;
    var map = { patreon: 'social-patreon', twitch: 'social-twitch', discord: 'social-discord' };
    Object.keys(map).forEach(function (key) {
      var node = el(map[key]);
      if (node && s[key] && isSafeHref(s[key])) node.href = s[key];
    });
  }

  function renderHome() {
    var site = currentSite();
    var home = Object.assign({}, DEFAULT_HOME, site.home || {});
    var heroLogo = el('hero-logo');
    heroLogo.src = isSafeHref(home.logoUrl) ? home.logoUrl : DEFAULT_HOME.logoUrl;
    var heroWordmark = el('hero-title').querySelector('img');
    heroWordmark.src = isSafeHref(home.wordmarkUrl) ? home.wordmarkUrl : DEFAULT_HOME.wordmarkUrl;
    document.querySelectorAll('.brand-logo, .footer-brand img').forEach(function (img) { img.src = heroLogo.src; });
    document.querySelectorAll('.brand-wordmark-img').forEach(function (img) { img.src = heroWordmark.src; });
    var mapped = {
      eyebrow: 'home-hero-eyebrow', footnote: 'home-hero-footnote',
      sectionKicker: 'home-section-kicker', sectionTitle: 'home-section-title',
      sectionHighlight: 'home-section-highlight', sectionIntro: 'home-section-intro',
      ctaKicker: 'home-cta-kicker', ctaTitle: 'home-cta-title',
      ctaHighlight: 'home-cta-highlight', ctaDescription: 'home-cta-description',
      guideLabel: 'home-guide-label', changelogLabel: 'home-changelog-label'
    };
    Object.keys(mapped).forEach(function (key) { setText(mapped[key], home[key] || ''); });
    var features = Array.isArray(home.features) ? home.features : DEFAULT_HOME.features;
    var grid = el('home-feature-grid');
    grid.replaceChildren();
    features.forEach(function (feature) {
      var card = document.createElement('article'); card.className = 'feature-card';
      var eyebrow = document.createElement('div'); eyebrow.className = 'feature-number'; eyebrow.textContent = feature.eyebrow || '';
      card.appendChild(eyebrow);

      if (feature.imageUrl && isSafeHref(feature.imageUrl)) {
        var media = document.createElement('div'); media.className = 'feature-media';
        var mediaImg = document.createElement('img');
        mediaImg.className = 'feature-media-img';
        mediaImg.src = feature.imageUrl;
        mediaImg.alt = feature.title ? feature.title + ' artwork' : 'Feature artwork';
        mediaImg.loading = 'lazy';
        media.appendChild(mediaImg);
        card.appendChild(media);
      }

      var lower = document.createElement('div'); lower.className = 'feature-lower';
      var icon = null;
      if (feature.icon !== 'none') {
        if (feature.icon === 'custom') {
          if (isSafeIconSource(feature.iconUrl)) {
            icon = document.createElement('div'); icon.className = 'feature-icon feature-icon-custom';
            var customImg = document.createElement('img'); customImg.src = feature.iconUrl;
            customImg.alt = ''; customImg.loading = 'lazy'; customImg.decoding = 'async';
            icon.appendChild(customImg);
          }
        } else {
          icon = document.createElement('div'); icon.className = 'feature-icon'; icon.setAttribute('aria-hidden', 'true');
          icon.innerHTML = ICON_SVGS[feature.icon] || ICON_SVGS.eye; // Trusted local SVG templates only.
        }
      }
      var textWrap = document.createElement('div'); textWrap.className = 'feature-copy';
      var heading = document.createElement('h3'); heading.textContent = feature.title || '';
      var desc = document.createElement('p'); desc.textContent = feature.description || '';
      textWrap.append(heading, desc);
      if (icon) lower.append(icon, textWrap);
      else { lower.classList.add('feature-no-icon'); lower.appendChild(textWrap); }
      card.appendChild(lower);
      grid.appendChild(card);
    });
    show(el('home-explore-panel'), Boolean(home.ctaKicker || home.ctaTitle || home.ctaHighlight || home.ctaDescription));

    if (heroWordmark) heroWordmark.alt = site.title || 'VaalAuras';
    setText('site-footer-text', site.footer || '');
    setText('hero-headline', site.headline || '');
    setText('hero-subline', site.subline || '');
    show(el('hero-headline'), Boolean(site.headline));
    show(el('hero-subline'), Boolean(site.subline));
    document.title = site.title || 'VaalAuras';

    var tagsEl = el('hero-tags');
    tagsEl.textContent = '';
    var tags = Array.isArray(site.tags) ? site.tags : [];
    tags.forEach(function (tag, idx) {
      if (idx > 0) {
        var sep = document.createElement('span');
        sep.className = 'hero-tag-sep';
        sep.setAttribute('aria-hidden', 'true');
        tagsEl.appendChild(sep);
      }
      var chip = document.createElement('span');
      chip.className = 'hero-tag';
      chip.textContent = tag;
      tagsEl.appendChild(chip);
    });
    show(tagsEl, tags.length > 0);

    var wrap = el('hero-buttons');
    wrap.textContent = '';
    (site.buttons || []).forEach(function (b) {
      var hasUrl = Boolean(b.url) && isSafeHref(b.url);
      // Visitors only see buttons that have a link; the developer sees all (to finish setting them up).
      if (!hasUrl && !isDeveloper()) return;
      var a = document.createElement(hasUrl ? 'a' : 'span');
      a.className = 'btn btn-xl ' + (b.style === 'secondary' ? 'btn-secondary-cta' : 'btn-cta');
      a.textContent = b.label;
      if (hasUrl) {
        a.href = b.url;
        if (/^https?:\/\//i.test(b.url)) {
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
        }
      } else {
        a.classList.add('is-unset');
        a.title = 'No link set yet. Use Edit page to add one.';
      }
      wrap.appendChild(a);
    });

    renderSocials();
  }

  function setHomeError(message) {
    setInlineFormError('home-form-error', message);
  }

  function renderHomeButtonRows() {
    var list = el('home-buttons-editor');
    list.textContent = '';
    state.homeDraftButtons.forEach(function (b, idx) {
      var row = document.createElement('div');
      row.className = 'btn-editor-row';

      var label = document.createElement('input');
      label.type = 'text';
      label.className = 'text-input';
      label.placeholder = 'Label';
      label.maxLength = 40;
      label.value = b.label;
      label.setAttribute('aria-label', 'Button label');
      label.addEventListener('input', function () {
        b.label = label.value;
      });

      var url = document.createElement('input');
      url.type = 'text';
      url.className = 'text-input';
      url.placeholder = 'https://...';
      url.value = b.url;
      url.setAttribute('aria-label', 'Button link');
      url.addEventListener('input', function () {
        b.url = url.value;
      });

      var style = document.createElement('select');
      style.className = 'text-input';
      style.setAttribute('aria-label', 'Button style');
      [['primary', 'Filled'], ['secondary', 'Outline']].forEach(function (opt) {
        var o = document.createElement('option');
        o.value = opt[0];
        o.textContent = opt[1];
        if (b.style === opt[0]) o.selected = true;
        style.appendChild(o);
      });
      style.addEventListener('change', function () {
        b.style = style.value;
      });

      var controls = document.createElement('div');
      controls.className = 'btn-editor-controls';
      function mk(text, title, handler, disabled) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-ghost btn-sm';
        btn.textContent = text;
        btn.title = title;
        btn.disabled = Boolean(disabled);
        btn.addEventListener('click', handler);
        controls.appendChild(btn);
      }
      mk('\u2191', 'Move left', function () {
        var t = state.homeDraftButtons[idx - 1];
        state.homeDraftButtons[idx - 1] = state.homeDraftButtons[idx];
        state.homeDraftButtons[idx] = t;
        renderHomeButtonRows();
      }, idx === 0);
      mk('\u2193', 'Move right', function () {
        var t = state.homeDraftButtons[idx + 1];
        state.homeDraftButtons[idx + 1] = state.homeDraftButtons[idx];
        state.homeDraftButtons[idx] = t;
        renderHomeButtonRows();
      }, idx === state.homeDraftButtons.length - 1);
      mk('Remove', 'Remove button', function () {
        state.homeDraftButtons.splice(idx, 1);
        renderHomeButtonRows();
      }, false);

      row.appendChild(label);
      row.appendChild(url);
      row.appendChild(style);
      row.appendChild(controls);
      list.appendChild(row);
    });
    el('btn-add-home-button').disabled = state.homeDraftButtons.length >= 8;
  }

  function buildHomeField(label, value, max, multiline, onChange) {
    var wrapper = document.createElement('div'); wrapper.className = 'field-group';
    var lbl = document.createElement('label'); lbl.className = 'field-label'; lbl.textContent = label;
    var input = document.createElement(multiline ? 'textarea' : 'input');
    input.className = 'text-input' + (multiline ? ' textarea-input' : '');
    input.maxLength = max; input.value = value || '';
    if (multiline) input.rows = 3;
    input.addEventListener('input', function () { onChange(input.value); });
    lbl.appendChild(input); wrapper.appendChild(lbl);
    return wrapper;
  }

  function renderFeatureEditor() {
    var wrap = el('home-feature-editor'); wrap.replaceChildren();
    state.homeDraftFeatures.forEach(function (f, index) {
      var card = document.createElement('div'); card.className = 'feature-editor-card';
      var top = document.createElement('div'); top.className = 'feature-editor-top';
      var name = document.createElement('strong'); name.textContent = 'Card ' + (index + 1);
      var actions = document.createElement('div'); actions.className = 'feature-editor-actions';
      [['↑', -1, 'Move up'], ['↓', 1, 'Move down'], ['×', 0, 'Delete card']].forEach(function (action) {
        var btn = document.createElement('button'); btn.type = 'button'; btn.className = 'btn btn-ghost btn-sm';
        btn.textContent = action[0]; btn.title = action[2]; btn.setAttribute('aria-label', action[2] + ' ' + (index + 1));
        btn.disabled = action[1] !== 0 && (index + action[1] < 0 || index + action[1] >= state.homeDraftFeatures.length);
        btn.addEventListener('click', function () {
          if (!action[1]) state.homeDraftFeatures.splice(index, 1);
          else { var swap = index + action[1]; var old = state.homeDraftFeatures[swap]; state.homeDraftFeatures[swap] = f; state.homeDraftFeatures[index] = old; }
          renderFeatureEditor();
        }); actions.appendChild(btn);
      });
      top.append(name, actions); card.appendChild(top);
      card.appendChild(buildHomeField('Small caption', f.eyebrow, 60, false, function (v) { f.eyebrow = v; }));
      card.appendChild(buildHomeField('Image URL (shown under the caption)', f.imageUrl || '', 2048, false, function (v) { f.imageUrl = v; }));
      card.appendChild(buildHomeField('Title', f.title, 100, false, function (v) { f.title = v; }));
      card.appendChild(buildHomeField('Description', f.description, 800, true, function (v) { f.description = v; }));
      var iconGroup = document.createElement('div'); iconGroup.className = 'field-group feature-icon-editor';
      var iconLabel = document.createElement('label'); iconLabel.className = 'field-label'; iconLabel.textContent = 'Icon';
      var select = document.createElement('select'); select.className = 'text-input';
      [['eye', 'Eye / awareness'], ['sliders', 'Controls'], ['shield', 'Shield / evolution'], ['none', 'No icon'], ['custom', 'Custom icon (URL or upload)']].forEach(function (item) {
        var option = document.createElement('option'); option.value = item[0]; option.textContent = item[1]; option.selected = f.icon === item[0]; select.appendChild(option);
      });
      iconLabel.appendChild(select); iconGroup.appendChild(iconLabel);

      var customArea = document.createElement('div'); customArea.className = 'custom-icon-controls';
      var customLink = document.createElement('label'); customLink.className = 'field-label';
      customLink.textContent = 'Custom icon URL (or upload a file below)';
      var iconUrl = document.createElement('input'); iconUrl.type = 'text'; iconUrl.className = 'text-input';
      iconUrl.placeholder = 'https://... or /assets/icon.png';
      iconUrl.maxLength = 140000; iconUrl.value = f.iconUrl || '';
      iconUrl.addEventListener('input', function () { f.iconUrl = iconUrl.value; updatePreview(); });
      customLink.appendChild(iconUrl); customArea.appendChild(customLink);
      var uploadRow = document.createElement('div'); uploadRow.className = 'feature-upload-row';
      var upload = document.createElement('input'); upload.type = 'file';
      upload.className = 'text-input feature-icon-file'; upload.accept = 'image/png,image/jpeg,image/webp';
      upload.setAttribute('aria-label', 'Upload icon for feature card ' + (index + 1));
      var preview = document.createElement('div'); preview.className = 'feature-icon-preview';
      var status = document.createElement('span'); status.className = 'field-hint';
      status.textContent = 'PNG, JPG or WebP. Automatically resized to 160px; saved with the page.';
      function updatePreview() {
        preview.replaceChildren();
        if (isSafeIconSource(f.iconUrl)) {
          var img = document.createElement('img'); img.alt = 'Icon preview'; img.src = f.iconUrl;
          preview.appendChild(img);
        } else {
          preview.textContent = 'No preview';
        }
      }
      upload.addEventListener('change', async function () {
        if (!upload.files || !upload.files[0]) return;
        upload.disabled = true; status.textContent = 'Processing icon...';
        try {
          f.iconUrl = await readUploadedIcon(upload.files[0]);
          // Keep the large base64 out of the text input to avoid slow editing and accidental changes.
          iconUrl.value = '(uploaded image — saved when you save the page)';
          iconUrl.readOnly = true;
          status.textContent = 'Icon ready. Save the page to publish it.';
          updatePreview();
        } catch (err) { status.textContent = err.message; }
        finally { upload.disabled = false; upload.value = ''; }
      });
      uploadRow.append(upload, preview); customArea.append(uploadRow, status);
      var clearButton = document.createElement('button'); clearButton.type = 'button';
      clearButton.className = 'btn btn-ghost btn-sm'; clearButton.textContent = 'Clear custom image';
      clearButton.addEventListener('click', function () {
        f.iconUrl = ''; iconUrl.value = ''; iconUrl.readOnly = false;
        status.textContent = 'Icon cleared. Upload another, paste a URL, or choose No icon.';
        updatePreview();
      });
      customArea.appendChild(clearButton);
      function updateMode() {
        f.icon = select.value;
        show(customArea, select.value === 'custom');
        if (select.value === 'custom') {
          iconUrl.readOnly = /^data:image\//.test(f.iconUrl || '');
          if (iconUrl.readOnly) iconUrl.value = '(uploaded image — saved when you save the page)';
          else iconUrl.value = f.iconUrl || '';
          updatePreview();
        }
      }
      select.addEventListener('change', updateMode);
      updateMode();
      iconGroup.appendChild(customArea); card.appendChild(iconGroup); wrap.appendChild(card);
    });
    el('btn-add-feature').disabled = state.homeDraftFeatures.length >= 8;
  }

  function openHomeEditor() {
    var site = currentSite();
    state.homeEditorOpen = true;
    state.homeDraftButtons = (site.buttons || []).map(function (b) {
      return { id: b.id, label: b.label, url: b.url, style: b.style === 'secondary' ? 'secondary' : 'primary' };
    });
    var home = Object.assign({}, DEFAULT_HOME, site.home || {});
    state.homeDraftFeatures = (Array.isArray(home.features) ? home.features : DEFAULT_HOME.features).map(function (f) { return Object.assign({}, f); });
    Object.keys(HOME_FIELDS).forEach(function (key) { el(HOME_FIELDS[key]).value = home[key] || ''; });
    renderFeatureEditor();
    el('home-title-input').value = site.title || '';
    el('home-tags-input').value = (site.tags || []).join(', ');
    el('home-headline-input').value = site.headline || '';
    el('home-subline-input').value = site.subline || '';
    el('home-footer-input').value = site.footer || '';
    var s = site.socials || DEFAULT_SITE.socials;
    el('home-social-patreon').value = s.patreon || '';
    el('home-social-twitch').value = s.twitch || '';
    el('home-social-discord').value = s.discord || '';
    setHomeError('');
    renderHomeButtonRows();
    show(el('home-editor-panel'), true);
    el('home-editor-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function closeHomeEditor() {
    state.homeEditorOpen = false;
    show(el('home-editor-panel'), false);
    setHomeError('');
  }

  async function saveHome(event) {
    event.preventDefault();
    setHomeError('');
    var payload = {
      title: el('home-title-input').value,
      home: Object.assign(Object.keys(HOME_FIELDS).reduce(function (result, key) {
        result[key] = el(HOME_FIELDS[key]).value; return result;
      }, {}), { features: state.homeDraftFeatures }),
      tags: el('home-tags-input').value
        .split(',')
        .map(function (t) { return t.trim(); })
        .filter(Boolean),
      headline: el('home-headline-input').value,
      subline: el('home-subline-input').value,
      footer: el('home-footer-input').value,
      buttons: state.homeDraftButtons,
      socials: {
        patreon: el('home-social-patreon').value,
        twitch: el('home-social-twitch').value,
        discord: el('home-social-discord').value,
      },
    };
    var saveBtn = el('btn-save-home');
    saveBtn.disabled = true;
    try {
      var data = await apiJson('/api/site', { method: 'PUT', body: JSON.stringify(payload) });
      state.site = data.site;
      closeHomeEditor();
      renderHome();
    } catch (err) {
      setHomeError(err.message);
    } finally {
      saveBtn.disabled = false;
    }
  }

  /* =========================================================
     DEVELOPER LOGIN
     ========================================================= */

  function applyDeveloperState() {
    var dev = isDeveloper();
    show(el('btn-open-login'), !dev);
    show(el('btn-signout'), dev);
    show(el('btn-edit-home'), dev);
    if (!dev) closeHomeEditor();
    renderHome();
    if (state.activeView === 'guide') renderGuideView();
    if (state.activeView === 'changelog') renderChangelogView();
  }

  function setLoginError(message) {
    setInlineFormError('dev-login-error', message);
  }

  function openLoginDialog() {
    setLoginError('');
    var dlg = el('login-dialog');
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', '');
    el('dev-email').focus();
  }

  function closeLoginDialog() {
    var dlg = el('login-dialog');
    if (typeof dlg.close === 'function') dlg.close();
    else dlg.removeAttribute('open');
    el('dev-password').value = '';
  }

  async function submitLogin(event) {
    event.preventDefault();
    setLoginError('');
    var email = el('dev-email').value.trim();
    var password = el('dev-password').value;
    if (!email || !password) {
      setLoginError('Enter your email and password.');
      return;
    }
    var btn = el('btn-dev-submit');
    btn.disabled = true;
    try {
      await apiJson('/api/login', { method: 'POST', body: JSON.stringify({ email: email, password: password }) });
      state.developer = true;
      closeLoginDialog();
      applyDeveloperState();
    } catch (err) {
      setLoginError(err.message);
    } finally {
      btn.disabled = false;
    }
  }

  async function signOut() {
    try {
      await apiJson('/api/logout', { method: 'POST' });
    } catch (_) {}
    state.developer = false;
    applyDeveloperState();
  }

  /* =========================================================
     LOADING & WIRING
     ========================================================= */

  async function loadSession() {
    try {
      var data = await apiJson('/api/session');
      state.developer = Boolean(data.developer);
      state.loginConfigured = Boolean(data.loginConfigured);
    } catch (_) {
      state.developer = false;
    }
  }

  async function loadSite() {
    try {
      var data = await apiJson('/api/site');
      state.site = data.site;
      state.siteStorageReady = Boolean(data.storageReady);
    } catch (_) {
      state.site = null;
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
    var wordmarkImg = el('brand-wordmark-img');
    if (wordmarkImg) {
      wordmarkImg.addEventListener('error', function () {
        wordmarkImg.replaceWith(document.createTextNode('VaalAuras'));
      });
    }

    el('brand-link').addEventListener('click', function (e) {
      e.preventDefault();
      switchView('home');
    });

    var navBtns = document.querySelectorAll('.nav-link[data-view]');
    for (var i = 0; i < navBtns.length; i += 1) {
      navBtns[i].addEventListener('click', function () {
        switchView(this.getAttribute('data-view'));
      });
    }

    el('btn-open-login').addEventListener('click', openLoginDialog);
    el('btn-close-login').addEventListener('click', closeLoginDialog);
    el('developer-login-form').addEventListener('submit', submitLogin);
    el('btn-signout').addEventListener('click', signOut);

    // Home editor
    el('btn-edit-home').addEventListener('click', openHomeEditor);
    el('btn-cancel-home-edit').addEventListener('click', closeHomeEditor);
    el('home-editor-form').addEventListener('submit', saveHome);
    el('btn-add-home-button').addEventListener('click', function () {
      if (state.homeDraftButtons.length >= 8) return;
      state.homeDraftButtons.push({ id: '', label: 'New button', url: '', style: 'secondary' });
      renderHomeButtonRows();
    });

    el('btn-add-feature').addEventListener('click', function () {
      if (state.homeDraftFeatures.length >= 8) return;
      state.homeDraftFeatures.push({ eyebrow: '', imageUrl: '', title: 'New feature', description: '', icon: 'eye', iconUrl: '' });
      renderFeatureEditor();
    });

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
  }

  async function init() {
    wireEvents();

    var hash = window.location.hash.replace(/^#/, '').toLowerCase();
    if (hash === 'guide' || hash === 'changelog') {
      state.activeView = hash;
    }

    await Promise.all([loadSession(), loadSite(), loadContent()]);

    if (!state.siteStorageReady && state.developer) {
      setBanner('Storage is not set up: bind a KV namespace named CONTENT_KV to the Worker so your edits can be saved.', 'warn');
    }
    applyDeveloperState();
    switchView(state.activeView, false);
  }

  init();
})();
