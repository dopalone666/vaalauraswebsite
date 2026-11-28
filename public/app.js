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
    homeDraftImages: { heroImages: [], featureSectionImages: [] },
    showcaseIndices: { heroImages: 0, featureSectionImages: 0 },

    // Changelog state
    changelogs: null,
    changelogStorageReady: true,
    activeChangelogCategory: 'All',
    expandedChangelogIds: {},
    editingChangelogId: null,
    changelogEditorOpen: false,

    // Guide state
    guides: null,
    guideStorageReady: true,
    activeGuideTopic: 'All',
    guideSearchQuery: '',
    selectedGuideId: null,
    editingGuideId: null,
    guideEditorOpen: false,
  };

  var contentLoading = {};

  var DEFAULT_HOME = {
    logoUrl: '/assets/vaalauras_logo.png', wordmarkUrl: '/assets/vaalauras_wordmark.png',
    windowsDownloadUrl: '', linuxDownloadUrl: '',
    eyebrow: 'THE PATH OF EXILE OVERLAY', footnote: 'BUILT FOR YOUR BUILD',
    heroImageUrl: '', heroImages: [], featureSectionImageUrl: '', featureSectionImages: [],
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
    logoUrl: 'home-logo-url', wordmarkUrl: 'home-wordmark-url',
    windowsDownloadUrl: 'home-windows-download-url', linuxDownloadUrl: 'home-linux-download-url',
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

  function isVideoMediaSource(url, mediaType) {
    if (mediaType === 'video') return true;
    if (mediaType === 'image') return false;
    return typeof url === 'string' && /\.(?:mp4|webm|m4v)(?:[?#]|$)/i.test(url.trim());
  }

  function inferMimeFromFile(file) {
    var mime = (file && file.type ? file.type : '').split(';')[0].trim().toLowerCase();
    if (mime) return mime;
    var name = file && file.name ? file.name.toLowerCase() : '';
    if (name.endsWith('.mp4') || name.endsWith('.m4v')) return 'video/mp4';
    if (name.endsWith('.webm')) return 'video/webm';
    if (name.endsWith('.png')) return 'image/png';
    if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg';
    if (name.endsWith('.webp')) return 'image/webp';
    return '';
  }

  async function uploadCardMediaFile(file) {
    var mime = inferMimeFromFile(file);
    if (!/^(?:video\/(?:mp4|webm)|image\/(?:png|jpeg|webp))$/.test(mime)) {
      throw new Error('Use MP4 (H.264) or WebM video, or PNG, JPG, or WebP image.');
    }
    if (!file || file.size === 0) {
      throw new Error('Selected file is empty.');
    }
    if (file.size > 15 * 1024 * 1024) {
      throw new Error('File is too large. Keep card videos and images under 15 MB.');
    }
    var res = await fetch('/api/media', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'X-Requested-With': 'VaalAuras',
        'Content-Type': mime
      },
      body: file
    });
    var data = {};
    try { data = await res.json(); } catch (_) {}
    if (!res.ok) {
      throw new Error(data.error || ('Upload failed (' + res.status + ').'));
    }
    return { url: data.url, mediaType: data.mediaType || (/^video\//.test(mime) ? 'video' : 'image') };
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

  // Section images are resized locally, then saved in the existing admin-protected KV record.
  function readUploadedSectionImage(file) {
    return new Promise(function (resolve, reject) {
      if (!file || !/^image\/(?:png|jpeg|webp)$/.test(file.type)) {
        reject(new Error('Choose a PNG, JPG, or WebP image.')); return;
      }
      if (file.size > 12 * 1024 * 1024) {
        reject(new Error('Choose an image smaller than 12 MB.')); return;
      }
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('Could not read the image.')); };
      reader.onload = function () {
        var img = new Image();
        img.onerror = function () { reject(new Error('Could not decode the image.')); };
        img.onload = function () {
          var max = 1400;
          var scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
          var output = '';
          for (var pass = 0; pass < 4; pass++) {
            var canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
            canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
            var context = canvas.getContext('2d');
            if (!context) { reject(new Error('Your browser cannot resize images.')); return; }
            context.drawImage(img, 0, 0, canvas.width, canvas.height);
            output = canvas.toDataURL('image/webp', pass === 0 ? .78 : .65);
            if (!/^data:image\/webp;base64,/.test(output)) output = canvas.toDataURL('image/jpeg', .7);
            if (output.length <= 750000) { resolve(output); return; }
            scale *= .73;
          }
          reject(new Error('Could not compress image enough. Try a smaller file or paste its URL.'));
        };
        img.src = String(reader.result);
      };
      reader.readAsDataURL(file);
    });
  }

  function getShowcaseImages(home, arrayKey, legacyKey) {
    var raw = Array.isArray(home[arrayKey]) && home[arrayKey].length > 0
      ? home[arrayKey]
      : (home[legacyKey] ? [home[legacyKey]] : []);
    return raw.filter(isSafeIconSource);
  }

  function initializeSectionImageEditor(prefix, key) {
    var input = el(prefix + '-url');
    var addBtn = el(prefix + '-add');
    var file = el(prefix + '-upload');
    var clear = el(prefix + '-clear');
    var listEl = el(prefix + '-list');
    var status = el(prefix + '-status');

    function refresh() {
      var list = Array.isArray(state.homeDraftImages[key]) ? state.homeDraftImages[key] : [];
      listEl.replaceChildren();
      list.forEach(function (src, idx) {
        var row = document.createElement('div');
        row.className = 'section-media-item';

        var thumb = document.createElement('img');
        thumb.alt = 'Screenshot ' + (idx + 1);
        if (isSafeIconSource(src)) thumb.src = src;

        var label = document.createElement('span');
        label.className = 'section-media-item-label';
        label.textContent = /^data:image\//.test(src)
          ? 'Screenshot ' + (idx + 1) + ' (uploaded image)'
          : src;

        var actions = document.createElement('div');
        actions.className = 'section-media-item-actions';

        function mkBtn(text, title, handler, disabled) {
          var b = document.createElement('button');
          b.type = 'button';
          b.className = 'btn btn-ghost btn-sm';
          b.textContent = text;
          b.title = title;
          b.disabled = Boolean(disabled);
          b.addEventListener('click', handler);
          actions.appendChild(b);
        }

        mkBtn('\u2191', 'Move up', function () {
          var t = list[idx - 1];
          list[idx - 1] = list[idx];
          list[idx] = t;
          refresh();
        }, idx === 0);

        mkBtn('\u2193', 'Move down', function () {
          var t = list[idx + 1];
          list[idx + 1] = list[idx];
          list[idx] = t;
          refresh();
        }, idx === list.length - 1);

        mkBtn('\u00d7', 'Remove screenshot', function () {
          list.splice(idx, 1);
          status.textContent = 'Screenshot removed. Save changes to publish.';
          refresh();
        }, false);

        row.append(thumb, label, actions);
        listEl.appendChild(row);
      });
      var full = list.length >= 12;
      addBtn.disabled = full;
      file.disabled = full;
    }

    addBtn.addEventListener('click', function () {
      var list = state.homeDraftImages[key];
      if (list.length >= 12) {
        status.textContent = 'Maximum 12 screenshots per section.';
        return;
      }
      var value = (input.value || '').trim();
      if (!value) return;
      if (!isSafeHref(value)) {
        status.textContent = 'Enter a valid https:// URL or /assets/... path.';
        return;
      }
      list.push(value);
      input.value = '';
      status.textContent = 'Screenshot added. Save changes to publish.';
      refresh();
    });

    file.addEventListener('change', async function () {
      if (!file.files || file.files.length === 0) return;
      var list = state.homeDraftImages[key];
      var remaining = 12 - list.length;
      if (remaining <= 0) {
        status.textContent = 'Maximum 12 screenshots per section.';
        file.value = '';
        return;
      }
      file.disabled = true;
      addBtn.disabled = true;
      var selected = Array.prototype.slice.call(file.files, 0, remaining);
      status.textContent = 'Preparing ' + selected.length + ' screenshot' + (selected.length > 1 ? 's' : '') + '...';
      try {
        for (var i = 0; i < selected.length; i += 1) {
          var encoded = await readUploadedSectionImage(selected[i]);
          list.push(encoded);
        }
        status.textContent = selected.length + ' screenshot' + (selected.length > 1 ? 's' : '') + ' added. Save changes to publish.';
        refresh();
      } catch (err) {
        status.textContent = err.message;
      } finally {
        file.disabled = list.length >= 12;
        addBtn.disabled = list.length >= 12;
        file.value = '';
      }
    });

    clear.addEventListener('click', function () {
      state.homeDraftImages[key] = [];
      input.value = '';
      status.textContent = 'All screenshots removed. Save changes to publish.';
      refresh();
    });

    return refresh;
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
  function appendGuideText(container, text) {
    var imageTag = /\[img\][ \t]*(https:\/\/i\.imgur\.com\/[a-z0-9]+\.(?:png|jpe?g|gif|webp|avif)(?:\?[^\s\[\]<>]*)?)[ \t]*\[\/img\]/gi;
    text.split(imageTag).forEach(function (part, index) {
      if (index % 2 === 0) {
        if (part) container.append(part);
        return;
      }
      var image = document.createElement('img');
      image.loading = 'lazy';
      image.decoding = 'async';
      image.alt = 'Guide image';
      image.src = part;
      container.appendChild(image);
    });
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
        appendGuideText(heading, trimmed.replace(/^#{1,3}\s+/, ''));
        container.appendChild(heading);
        continue;
      }

      if (/^[-*]\s+/.test(trimmed)) {
        if (!currentUl) {
          currentUl = document.createElement('ul');
        }
        var li = document.createElement('li');
        appendGuideText(li, trimmed.replace(/^[-*]\s+/, ''));
        currentUl.appendChild(li);
        continue;
      }

      flushUl();
      var p = document.createElement('p');
      appendGuideText(p, trimmed);
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
    show(el('btn-new-guide'), dev && Boolean(state.guides));
    show(el('guide-kv-warning'), dev && !state.guideStorageReady);
    if (!dev && state.guideEditorOpen) {
      closeGuideEditor();
    }

    var topicFiltersEl = el('guide-topic-filters');
    var sidebarListEl = el('guide-sidebar-list');
    var readerEl = el('guide-reader');
    if (!state.guides || !topicFiltersEl || !sidebarListEl || !readerEl) return;

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
    show(el('btn-new-changelog'), dev && Boolean(state.changelogs));
    show(el('changelog-kv-warning'), dev && !state.changelogStorageReady);
    if (!dev && state.changelogEditorOpen) {
      closeChangelogEditor();
    }

    var filterEl = el('changelog-category-filters');
    var listEl = el('changelog-list');
    if (!state.changelogs || !filterEl || !listEl) return;

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
    if (window.VaalEye && typeof window.VaalEye.refresh === 'function') window.VaalEye.refresh();

    if (updateHash !== false) {
      var nextHash = '#' + valid;
      if (window.location.hash !== nextHash) {
        try {
          window.history.replaceState({}, '', nextHash);
        } catch (_) {}
      }
    }

    if (valid !== 'home') loadContent(valid);

    if (updateHash !== false && window.scrollY > 4) {
      smoothScrollTo(0);
    }
  }

  /* =========================================================
     HOME PAGE
     ========================================================= */

  function currentSite() {
    return state.site || DEFAULT_SITE;
  }

  function detectDownloadPlatform(browser) {
    var hints = browser.userAgentData;
    var userAgent = browser.userAgent || '';
    if ((hints && hints.mobile) || /\b(?:Android|CrOS|iPhone|iPad|iPod)\b/i.test(userAgent)) return '';

    var platform = hints && hints.platform ? hints.platform : userAgent + ' ' + (browser.platform || '');
    if (/\b(?:Windows|Win32|Win64)\b/i.test(platform)) return 'windows';
    if (/\bLinux\b/i.test(platform)) return 'linux';
    return '';
  }

  function appendHomeButton(wrap, button, url, label) {
    var hasUrl = Boolean(url) && isSafeHref(url);
    if (!hasUrl && !isDeveloper()) return;
    var link = document.createElement(hasUrl ? 'a' : 'span');
    link.className = 'btn btn-xl ' + (button.style === 'secondary' ? 'btn-secondary-cta' : 'btn-cta');
    link.textContent = label;
    if (hasUrl) {
      link.href = url;
      if (/^https?:\/\//i.test(url)) {
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      }
    } else {
      link.classList.add('is-unset');
      link.title = 'No link set yet. Use Edit page to add one.';
    }
    wrap.appendChild(link);
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
    document.querySelectorAll('img.brand-logo, .footer-brand img').forEach(function (img) { img.src = heroLogo.src; });
    if (window.VaalEye && typeof window.VaalEye.refresh === 'function') window.VaalEye.refresh();
    document.querySelectorAll('.brand-wordmark-img').forEach(function (img) { img.src = heroWordmark.src; });
    var mapped = {
      footnote: 'home-hero-footnote',
      sectionKicker: 'home-section-kicker', sectionTitle: 'home-section-title',
      sectionHighlight: 'home-section-highlight', sectionIntro: 'home-section-intro',
      ctaKicker: 'home-cta-kicker', ctaTitle: 'home-cta-title',
      ctaHighlight: 'home-cta-highlight', ctaDescription: 'home-cta-description',
      guideLabel: 'home-guide-label', changelogLabel: 'home-changelog-label'
    };
    Object.keys(mapped).forEach(function (key) { setText(mapped[key], home[key] || ''); });
    [['heroImages', 'heroImageUrl', 'home-hero-media'],
     ['featureSectionImages', 'featureSectionImageUrl', 'home-feature-media']].forEach(function (entry) {
      var images = getShowcaseImages(home, entry[0], entry[1]);
      var wrap = el(entry[2]);
      var image = el(entry[2] + '-image');
      var nav = el(entry[2] + '-nav');
      var dots = el(entry[2] + '-dots');
      var counter = el(entry[2] + '-counter');
      if (images.length === 0) {
        image.removeAttribute('src');
        if (dots) dots.replaceChildren();
        show(wrap, false);
        show(nav, false);
        return;
      }
      var idx = state.showcaseIndices[entry[0]] || 0;
      if (idx < 0 || idx >= images.length) idx = 0;
      state.showcaseIndices[entry[0]] = idx;
      if (image.getAttribute('src') !== images[idx]) {
        image.src = images[idx];
      }
      images.forEach(function (src) {
        var pre = new Image();
        pre.decoding = 'async';
        pre.src = src;
      });
      if (dots) {
        dots.replaceChildren();
        if (images.length > 1) {
          images.forEach(function (_src, dotIndex) {
            var dot = document.createElement('button');
            dot.type = 'button';
            dot.className = 'showcase-dot' + (dotIndex === idx ? ' is-active' : '');
            dot.setAttribute('aria-label', 'Show screenshot ' + (dotIndex + 1));
            dot.setAttribute('aria-pressed', dotIndex === idx ? 'true' : 'false');
            dot.dataset.index = String(dotIndex);
            dots.appendChild(dot);
          });
        }
      }
      wrap.classList.toggle('is-single', images.length <= 1);
      show(wrap, true);
      show(nav, images.length > 1);
      if (counter) counter.textContent = (idx + 1) + ' / ' + images.length;
    });
    var features = Array.isArray(home.features) ? home.features : DEFAULT_HOME.features;
    var grid = el('home-feature-grid');
    grid.replaceChildren();
    features.forEach(function (feature) {
      var card = document.createElement('article'); card.className = 'feature-card';
      var eyebrow = document.createElement('div'); eyebrow.className = 'feature-number'; eyebrow.textContent = feature.eyebrow || '';
      card.appendChild(eyebrow);

      if (feature.imageUrl && isSafeHref(feature.imageUrl)) {
        var media = document.createElement('div'); media.className = 'feature-media';
        var isVideo = isVideoMediaSource(feature.imageUrl, feature.mediaType);
        var mediaEl;
        if (isVideo) {
          mediaEl = document.createElement('video');
          mediaEl.className = 'feature-media-img';
          mediaEl.src = feature.imageUrl;
          mediaEl.autoplay = true;
          mediaEl.loop = true;
          mediaEl.muted = true;
          mediaEl.defaultMuted = true;
          mediaEl.playsInline = true;
          mediaEl.preload = 'metadata';
          mediaEl.setAttribute('aria-label', 'Maximize ' + (feature.title || 'feature') + ' video');
        } else {
          mediaEl = document.createElement('img');
          mediaEl.className = 'feature-media-img';
          mediaEl.src = feature.imageUrl;
          mediaEl.alt = feature.title ? feature.title + ' artwork' : 'Feature artwork';
          mediaEl.loading = 'lazy';
          mediaEl.setAttribute('aria-label', 'Maximize ' + (feature.title || 'feature') + ' screenshot');
        }
        mediaEl.tabIndex = 0;
        mediaEl.setAttribute('role', 'button');
        mediaEl.addEventListener('click', function () { openLightbox(mediaEl, null); });
        mediaEl.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openLightbox(mediaEl, null); }
        });
        var zoomHint = document.createElement('span');
        zoomHint.className = 'showcase-zoom-hint';
        zoomHint.setAttribute('aria-hidden', 'true');
        zoomHint.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>';
        media.append(mediaEl, zoomHint);
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
    var platform = detectDownloadPlatform(navigator);
    var downloads = [
      { platform: 'windows', name: 'Windows 11', url: home.windowsDownloadUrl },
      { platform: 'linux', name: 'Linux', url: home.linuxDownloadUrl },
    ].filter(function (download) {
      return typeof download.url === 'string' && isSafeHref(download.url);
    });
    (site.buttons || []).forEach(function (button, index) {
      if (index === 0) {
        var match = downloads.find(function (download) { return download.platform === platform; });
        if (match) {
          appendHomeButton(wrap, button, match.url, button.label);
          return;
        }
        if (downloads.length && (!button.url || !isSafeHref(button.url))) {
          downloads.forEach(function (download) {
            appendHomeButton(wrap, button, download.url, button.label + ' (' + download.name + ')');
          });
          return;
        }
      }
      appendHomeButton(wrap, button, button.url, button.label);
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
      url.placeholder = idx === 0 ? 'Fallback link (optional)' : 'https://...';
      url.value = b.url;
      url.setAttribute('aria-label', idx === 0 ? 'Download fallback link' : 'Button link');
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

      var cardMediaGroup = document.createElement('div');
      cardMediaGroup.className = 'field-group feature-card-media-editor';
      var cardMediaLabel = document.createElement('label');
      cardMediaLabel.className = 'field-label';
      cardMediaLabel.textContent = 'Card media URL or upload (video or image)';
      var cardMediaUrl = document.createElement('input');
      cardMediaUrl.type = 'text';
      cardMediaUrl.className = 'text-input';
      cardMediaUrl.maxLength = 2048;
      cardMediaUrl.placeholder = 'https://... or upload MP4 / WebM / PNG below';
      cardMediaUrl.value = f.imageUrl || '';
      cardMediaLabel.appendChild(cardMediaUrl);
      cardMediaGroup.appendChild(cardMediaLabel);

      var cardMediaRow = document.createElement('div');
      cardMediaRow.className = 'feature-upload-row';
      var cardMediaUpload = document.createElement('input');
      cardMediaUpload.type = 'file';
      cardMediaUpload.className = 'text-input feature-icon-file';
      cardMediaUpload.accept = 'video/mp4,video/webm,image/png,image/jpeg,image/webp,.mp4,.webm,.png,.jpg,.jpeg,.webp';
      cardMediaUpload.setAttribute('aria-label', 'Upload video or screenshot for feature card ' + (index + 1));
      var cardMediaPreview = document.createElement('div');
      cardMediaPreview.className = 'feature-media-preview';
      var cardMediaStatus = document.createElement('span');
      cardMediaStatus.className = 'field-hint';
      cardMediaStatus.textContent = 'Best format: MP4 (H.264) or WebM under 15 MB. PNG, JPG, and WebP screenshots also supported.';

      function updateCardMediaPreview() {
        cardMediaPreview.replaceChildren();
        var src = (f.imageUrl || '').trim();
        if (src && isSafeHref(src)) {
          if (isVideoMediaSource(src, f.mediaType)) {
            var vid = document.createElement('video');
            vid.src = src;
            vid.muted = true;
            vid.defaultMuted = true;
            vid.loop = true;
            vid.autoplay = true;
            vid.playsInline = true;
            vid.preload = 'metadata';
            cardMediaPreview.appendChild(vid);
          } else {
            var thumb = document.createElement('img');
            thumb.src = src;
            thumb.alt = 'Card media preview';
            cardMediaPreview.appendChild(thumb);
          }
        } else {
          cardMediaPreview.textContent = 'No media';
        }
      }

      cardMediaUrl.addEventListener('input', function () {
        f.imageUrl = cardMediaUrl.value;
        f.mediaType = isVideoMediaSource(cardMediaUrl.value) ? 'video' : undefined;
        updateCardMediaPreview();
      });

      cardMediaUpload.addEventListener('change', async function () {
        if (!cardMediaUpload.files || !cardMediaUpload.files[0]) return;
        cardMediaUpload.disabled = true;
        cardMediaStatus.textContent = 'Uploading media...';
        try {
          var uploaded = await uploadCardMediaFile(cardMediaUpload.files[0]);
          f.imageUrl = uploaded.url;
          f.mediaType = uploaded.mediaType;
          cardMediaUrl.value = uploaded.url;
          cardMediaStatus.textContent = (uploaded.mediaType === 'video' ? 'Video' : 'Image') + ' uploaded. Click Save changes to update the page.';
          updateCardMediaPreview();
        } catch (err) {
          cardMediaStatus.textContent = err.message;
        } finally {
          cardMediaUpload.disabled = false;
          cardMediaUpload.value = '';
        }
      });

      var cardMediaClear = document.createElement('button');
      cardMediaClear.type = 'button';
      cardMediaClear.className = 'btn btn-ghost btn-sm';
      cardMediaClear.textContent = 'Clear card media';
      cardMediaClear.addEventListener('click', function () {
        f.imageUrl = '';
        delete f.mediaType;
        cardMediaUrl.value = '';
        cardMediaStatus.textContent = 'Card media cleared. Save changes to remove it from the live card.';
        updateCardMediaPreview();
      });

      cardMediaRow.append(cardMediaUpload, cardMediaPreview);
      cardMediaGroup.append(cardMediaRow, cardMediaStatus, cardMediaClear);
      updateCardMediaPreview();
      card.appendChild(cardMediaGroup);

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
    Object.keys(HOME_FIELDS).forEach(function (key) {
      var field = el(HOME_FIELDS[key]);
      if (field) field.value = home[key] || '';
    });
    state.homeDraftImages = {
      heroImages: getShowcaseImages(home, 'heroImages', 'heroImageUrl').slice(),
      featureSectionImages: getShowcaseImages(home, 'featureSectionImages', 'featureSectionImageUrl').slice()
    };
    if (!state.homeSectionImageRefresh) {
      state.homeSectionImageRefresh = [
        initializeSectionImageEditor('home-hero-media', 'heroImages'),
        initializeSectionImageEditor('home-feature-media', 'featureSectionImages')
      ];
    }
    state.homeSectionImageRefresh.forEach(function (refresh) { refresh(); });
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
    var homePayload = Object.keys(HOME_FIELDS).reduce(function (result, key) {
      var field = el(HOME_FIELDS[key]);
      if (field) result[key] = field.value;
      return result;
    }, {});
    homePayload.features = state.homeDraftFeatures;
    homePayload.heroImages = state.homeDraftImages.heroImages;
    homePayload.heroImageUrl = state.homeDraftImages.heroImages[0] || '';
    homePayload.featureSectionImages = state.homeDraftImages.featureSectionImages;
    homePayload.featureSectionImageUrl = state.homeDraftImages.featureSectionImages[0] || '';
    var payload = {
      title: el('home-title-input').value,
      home: homePayload,
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
    if (dev && !state.siteStorageReady) {
      setBanner('Storage is not set up: bind a KV namespace named CONTENT_KV to the Worker so your edits can be saved.', 'warn');
    }
    renderHome();
    if (state.activeView === 'guide') renderGuideView();
    if (state.activeView === 'changelog') renderChangelogView();
  }

  function setLoginError(message) {
    setInlineFormError('dev-login-error', message);
  }

  async function openLoginDialog() {
    var btn = el('btn-open-login');
    btn.disabled = true;
    await loadSession();
    btn.disabled = false;
    if (isDeveloper()) {
      applyDeveloperState();
      el('btn-signout').focus();
      return;
    }

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

  async function loadContent(view) {
    var isGuide = view === 'guide';
    var itemsKey = isGuide ? 'guides' : 'changelogs';
    if (!state[itemsKey] && !contentLoading[view]) {
      var statusId = isGuide ? 'guide-reader' : 'changelog-list';
      var label = isGuide ? 'guides' : 'changelog';
      contentLoading[view] = true;
      setText(statusId, 'Loading ' + label + '…');
      try {
        var data = await apiJson('/api/content/' + itemsKey);
        var items = data && (isGuide ? data.articles : data.posts);
        if (!Array.isArray(items)) throw new Error('Unexpected content response.');
        state[itemsKey] = items;
        state[view + 'StorageReady'] = Boolean(data.storageReady);
      } catch (_) {
        setText(statusId, 'Could not load ' + label + '. Reopen this tab to try again.');
        return;
      } finally {
        delete contentLoading[view];
      }
    }

    if (state.activeView !== view) return;
    if (isGuide) renderGuideView();
    else renderChangelogView();
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

    var showcaseControllers = {};

    [['home-hero-media', 'heroImages', 'heroImageUrl'],
     ['home-feature-media', 'featureSectionImages', 'featureSectionImageUrl']].forEach(function (cfg) {
      var prefix = cfg[0];
      var arrayKey = cfg[1];
      var legacyKey = cfg[2];
      var switchToken = 0;
      var heightTimer = 0;
      var sheenTimer = 0;

      function updateDotsAndCounter(nextIndex, total) {
        var counter = el(prefix + '-counter');
        var dots = el(prefix + '-dots');
        if (counter) counter.textContent = (nextIndex + 1) + ' / ' + total;
        if (dots) {
          var btns = dots.querySelectorAll('.showcase-dot');
          for (var i = 0; i < btns.length; i += 1) {
            var active = i === nextIndex;
            btns[i].classList.toggle('is-active', active);
            btns[i].setAttribute('aria-pressed', active ? 'true' : 'false');
          }
        }
      }

      function runSlideAnimation(nextSrc, delta, naturalWidth, naturalHeight) {
        var wrap = el(prefix);
        var frame = wrap ? wrap.querySelector('.section-showcase') : null;
        var image = el(prefix + '-image');
        if (!image || !frame) return;

        var oldOutgoing = frame.querySelectorAll('.showcase-outgoing');
        for (var i = 0; i < oldOutgoing.length; i += 1) {
          oldOutgoing[i].remove();
        }

        var currentHeight = frame.getBoundingClientRect().height;
        var targetHeight = (naturalWidth > 0 && naturalHeight > 0 && frame.clientWidth > 0)
          ? Math.round(frame.clientWidth * (naturalHeight / naturalWidth))
          : 0;
        if (currentHeight > 0 && targetHeight > 0 && Math.abs(targetHeight - currentHeight) > 2) {
          clearTimeout(heightTimer);
          frame.style.height = Math.round(currentHeight) + 'px';
          void frame.offsetHeight;
          frame.style.height = targetHeight + 'px';
          heightTimer = setTimeout(function () {
            frame.style.height = '';
          }, 520);
        }

        var prevSrc = image.getAttribute('src');
        if (prevSrc && prevSrc !== nextSrc) {
          var outgoing = document.createElement('img');
          outgoing.className = 'showcase-outgoing ' + (delta > 0 ? 'showcase-exit-next' : 'showcase-exit-prev');
          outgoing.alt = '';
          outgoing.setAttribute('aria-hidden', 'true');
          outgoing.src = prevSrc;
          frame.appendChild(outgoing);
          var cleanup = function () {
            if (outgoing.parentNode) outgoing.parentNode.removeChild(outgoing);
          };
          outgoing.addEventListener('animationend', cleanup, { once: true });
          setTimeout(cleanup, 620);
        }

        image.classList.remove('showcase-enter-next', 'showcase-enter-prev');
        frame.classList.remove('is-switching-next', 'is-switching-prev');
        void image.offsetWidth;
        image.src = nextSrc;
        image.classList.add(delta > 0 ? 'showcase-enter-next' : 'showcase-enter-prev');
        frame.classList.add(delta > 0 ? 'is-switching-next' : 'is-switching-prev');
        clearTimeout(sheenTimer);
        sheenTimer = setTimeout(function () {
          frame.classList.remove('is-switching-next', 'is-switching-prev');
        }, 640);
      }

      function switchShowcaseImage(nextSrc, nextIndex, total, delta) {
        updateDotsAndCounter(nextIndex, total);
        var myToken = ++switchToken;
        var loader = new Image();
        loader.decoding = 'async';
        var done = false;
        function finish() {
          if (done || myToken !== switchToken) return;
          done = true;
          requestAnimationFrame(function () {
            if (myToken !== switchToken) return;
            runSlideAnimation(nextSrc, delta, loader.naturalWidth || 0, loader.naturalHeight || 0);
          });
        }
        loader.onload = function () {
          if (typeof loader.decode === 'function') {
            loader.decode().then(finish, finish);
          } else {
            finish();
          }
        };
        loader.onerror = finish;
        loader.src = nextSrc;
        if (loader.complete && loader.naturalWidth > 0) {
          if (typeof loader.decode === 'function') {
            loader.decode().then(finish, finish);
          } else {
            finish();
          }
        }
      }

      function goToIndex(targetIndex, delta) {
        var home = Object.assign({}, DEFAULT_HOME, currentSite().home || {});
        var images = getShowcaseImages(home, arrayKey, legacyKey);
        if (images.length <= 1) return;
        var nextIndex = ((targetIndex % images.length) + images.length) % images.length;
        var current = state.showcaseIndices[arrayKey] || 0;
        if (nextIndex === current) return;
        state.showcaseIndices[arrayKey] = nextIndex;
        switchShowcaseImage(images[nextIndex], nextIndex, images.length, delta);
      }

      function step(delta) {
        var current = state.showcaseIndices[arrayKey] || 0;
        goToIndex(current + delta, delta);
      }

      showcaseControllers[prefix] = {
        prefix: prefix,
        arrayKey: arrayKey,
        legacyKey: legacyKey,
        step: step,
        goToIndex: goToIndex
      };

      el(prefix + '-prev').addEventListener('click', function () { step(-1); });
      el(prefix + '-next').addEventListener('click', function () { step(1); });
      var dotsEl = el(prefix + '-dots');
      if (dotsEl) {
        dotsEl.addEventListener('click', function (e) {
          var btn = e.target && e.target.closest ? e.target.closest('.showcase-dot') : null;
          if (!btn) return;
          var idx = parseInt(btn.dataset.index || '', 10);
          if (isNaN(idx)) return;
          var current = state.showcaseIndices[arrayKey] || 0;
          if (idx === current) return;
          goToIndex(idx, idx > current ? 1 : -1);
        });
      }
      el(prefix).addEventListener('keydown', function (e) {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); step(-1); }
        else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); step(1); }
      });
      var swipeStartX = 0;
      var swipeStartY = 0;
      var swipeActive = false;
      var swipeDragged = false;
      var frameEl = el(prefix).querySelector('.section-showcase');
      if (frameEl) {
        frameEl.addEventListener('pointerdown', function (e) {
          if (e.button && e.button !== 0) return;
          swipeStartX = e.clientX;
          swipeStartY = e.clientY;
          swipeActive = true;
          swipeDragged = false;
        });
        frameEl.addEventListener('pointermove', function (e) {
          if (!swipeActive) return;
          if (Math.abs(e.clientX - swipeStartX) > 10 || Math.abs(e.clientY - swipeStartY) > 10) {
            swipeDragged = true;
          }
        });
        frameEl.addEventListener('pointerup', function (e) {
          if (!swipeActive) return;
          swipeActive = false;
          var dx = e.clientX - swipeStartX;
          var dy = e.clientY - swipeStartY;
          if (Math.abs(dx) > 42 && Math.abs(dx) > Math.abs(dy) * 1.2) {
            swipeDragged = true;
            step(dx < 0 ? 1 : -1);
          }
        });
        frameEl.addEventListener('pointercancel', function () { swipeActive = false; });
        frameEl.addEventListener('click', function () {
          if (swipeDragged) {
            swipeDragged = false;
            return;
          }
          var imgEl = el(prefix + '-image');
          if (imgEl && imgEl.getAttribute('src')) {
            openLightbox(imgEl, showcaseControllers[prefix]);
          }
        });
        frameEl.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            var imgEl = el(prefix + '-image');
            if (imgEl && imgEl.getAttribute('src')) {
              openLightbox(imgEl, showcaseControllers[prefix]);
            }
          }
        });
      }
    });

    wireLightboxEvents(showcaseControllers);

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

  var smoothScrollState = {
    rafId: 0,
    currentY: 0,
    targetY: 0,
    lastTime: 0,
    driving: false
  };

  function maxScrollY() {
    return Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  }

  function stopSmoothScroll() {
    if (smoothScrollState.rafId) {
      cancelAnimationFrame(smoothScrollState.rafId);
      smoothScrollState.rafId = 0;
    }
    document.documentElement.style.scrollBehavior = '';
    smoothScrollState.driving = false;
    smoothScrollState.lastTime = 0;
  }

  function stepSmoothScroll(now) {
    if (!smoothScrollState.lastTime) smoothScrollState.lastTime = now;
    var dt = Math.min(50, Math.max(4, now - smoothScrollState.lastTime));
    smoothScrollState.lastTime = now;

    var maxY = maxScrollY();
    if (smoothScrollState.targetY < 0) smoothScrollState.targetY = 0;
    if (smoothScrollState.targetY > maxY) smoothScrollState.targetY = maxY;

    var diff = smoothScrollState.targetY - smoothScrollState.currentY;
    if (Math.abs(diff) < 0.6) {
      smoothScrollState.driving = true;
      window.scrollTo({ top: smoothScrollState.targetY, behavior: 'instant' });
      smoothScrollState.currentY = smoothScrollState.targetY;
      stopSmoothScroll();
      return;
    }

    var alpha = 1 - Math.exp(-0.0115 * dt);
    smoothScrollState.currentY += diff * alpha;
    smoothScrollState.driving = true;
    document.documentElement.style.scrollBehavior = 'auto';
    window.scrollTo({ top: smoothScrollState.currentY, behavior: 'instant' });
    requestAnimationFrame(function () { smoothScrollState.driving = false; });
    smoothScrollState.rafId = requestAnimationFrame(stepSmoothScroll);
  }

  function smoothScrollTo(nextTargetY) {
    var maxY = maxScrollY();
    var clamped = Math.max(0, Math.min(maxY, nextTargetY));
    if (!smoothScrollState.rafId) {
      smoothScrollState.currentY = window.scrollY;
    }
    smoothScrollState.targetY = clamped;
    if (!smoothScrollState.rafId) {
      smoothScrollState.lastTime = 0;
      smoothScrollState.rafId = requestAnimationFrame(stepSmoothScroll);
    }
  }

  function findScrollableAncestor(target, deltaY) {
    var node = target && target.nodeType === 1 ? target : (target && target.parentElement);
    while (node && node !== document.body && node !== document.documentElement) {
      if (node.scrollHeight > node.clientHeight + 1) {
        var style = window.getComputedStyle(node);
        var oy = style.overflowY;
        if (oy === 'auto' || oy === 'scroll' || oy === 'overlay') {
          var canScrollUp = deltaY < 0 && node.scrollTop > 0;
          var canScrollDown = deltaY > 0 && node.scrollTop + node.clientHeight < node.scrollHeight - 1;
          if (canScrollUp || canScrollDown) return node;
        }
      }
      node = node.parentElement;
    }
    return null;
  }

  function initSmoothScroll() {
    smoothScrollState.currentY = window.scrollY;
    smoothScrollState.targetY = window.scrollY;

    window.addEventListener('wheel', function (e) {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (!e.deltaY) return;
      if (lightboxState.open || document.querySelector('dialog[open]')) return;
      if (findScrollableAncestor(e.target, e.deltaY)) return;

      var delta = e.deltaY;
      if (e.deltaMode === 1) delta *= 36;
      else if (e.deltaMode === 2) delta *= window.innerHeight * 0.85;

      // Preserve native sub-pixel precision for ultra-tiny trackpad micro-deltas only when idle
      if (e.deltaMode === 0 && Math.abs(delta) < 3 && !smoothScrollState.rafId) return;

      e.preventDefault();
      var base = smoothScrollState.rafId ? smoothScrollState.targetY : window.scrollY;
      smoothScrollState.currentY = smoothScrollState.rafId ? smoothScrollState.currentY : window.scrollY;
      smoothScrollTo(base + delta);
    }, { passive: false });

    window.addEventListener('scroll', function () {
      if (smoothScrollState.driving) return;
      if (!smoothScrollState.rafId) {
        smoothScrollState.currentY = window.scrollY;
        smoothScrollState.targetY = window.scrollY;
      }
    }, { passive: true });

    window.addEventListener('touchstart', stopSmoothScroll, { passive: true });
    window.addEventListener('mousedown', function (e) {
      // Stop inertia immediately if grabbing the browser scrollbar
      if (e.clientX >= document.documentElement.clientWidth) {
        stopSmoothScroll();
      }
    }, { passive: true });
    window.addEventListener('keydown', function (e) {
      if (e.key === 'PageUp' || e.key === 'PageDown' || e.key === 'Home' || e.key === 'End' || e.key === ' ') {
        if (document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/i.test(document.activeElement.tagName)) return;
        stopSmoothScroll();
      }
    }, { passive: true });
  }

  var lightboxState = {
    open: false,
    closing: false,
    sourceEl: null,
    controller: null,
    activeAnim: null,
    closeTimer: 0,
    switchToken: 0,
    sheenTimer: 0
  };

  function getLightboxFlipTransform(sourceEl, stageEl) {
    if (!sourceEl || !stageEl || !document.body.contains(sourceEl)) return null;
    var src = sourceEl.getBoundingClientRect();
    var dst = stageEl.getBoundingClientRect();
    if (!src.width || !src.height || !dst.width || !dst.height) return null;
    if (src.bottom < 0 || src.top > window.innerHeight) return null;
    var srcCx = src.left + src.width / 2;
    var srcCy = src.top + src.height / 2;
    var dstCx = dst.left + dst.width / 2;
    var dstCy = dst.top + dst.height / 2;
    var sx = Math.max(0.15, Math.min(1.5, src.width / dst.width));
    var sy = Math.max(0.15, Math.min(1.5, src.height / dst.height));
    return 'translate3d(' + Math.round(srcCx - dstCx) + 'px, ' + Math.round(srcCy - dstCy) + 'px, 0) scale(' + sx.toFixed(4) + ', ' + sy.toFixed(4) + ')';
  }

  function renderLightboxNav() {
    var nav = el('lightbox-nav');
    var dots = el('lightbox-dots');
    var counter = el('lightbox-counter');
    var ctrl = lightboxState.controller;
    if (!nav || !ctrl) {
      if (nav) show(nav, false);
      return;
    }
    var home = Object.assign({}, DEFAULT_HOME, currentSite().home || {});
    var images = getShowcaseImages(home, ctrl.arrayKey, ctrl.legacyKey);
    if (images.length <= 1) {
      show(nav, false);
      if (dots) dots.replaceChildren();
      return;
    }
    var idx = state.showcaseIndices[ctrl.arrayKey] || 0;
    if (idx < 0 || idx >= images.length) idx = 0;
    if (counter) counter.textContent = (idx + 1) + ' / ' + images.length;
    if (dots) {
      dots.replaceChildren();
      images.forEach(function (_src, dotIndex) {
        var dot = document.createElement('button');
        dot.type = 'button';
        dot.className = 'showcase-dot' + (dotIndex === idx ? ' is-active' : '');
        dot.setAttribute('aria-label', 'Show screenshot ' + (dotIndex + 1));
        dot.setAttribute('aria-pressed', dotIndex === idx ? 'true' : 'false');
        dot.dataset.index = String(dotIndex);
        dots.appendChild(dot);
      });
    }
    show(nav, true);
  }

  function animateLightboxSlide(nextSrc, nextIndex, total, delta) {
    var stage = el('lightbox-stage');
    var image = el('lightbox-image');
    var counter = el('lightbox-counter');
    var dots = el('lightbox-dots');
    if (!stage || !image) return;
    if (counter) counter.textContent = (nextIndex + 1) + ' / ' + total;
    if (dots) {
      var btns = dots.querySelectorAll('.showcase-dot');
      for (var i = 0; i < btns.length; i += 1) {
        var active = i === nextIndex;
        btns[i].classList.toggle('is-active', active);
        btns[i].setAttribute('aria-pressed', active ? 'true' : 'false');
      }
    }

    var myToken = ++lightboxState.switchToken;
    var loader = new Image();
    loader.decoding = 'async';
    var done = false;
    function finish() {
      if (done || myToken !== lightboxState.switchToken) return;
      done = true;
      requestAnimationFrame(function () {
        if (myToken !== lightboxState.switchToken) return;
        var oldOutgoing = stage.querySelectorAll('.showcase-outgoing');
        for (var j = 0; j < oldOutgoing.length; j += 1) oldOutgoing[j].remove();

        var prevSrc = image.getAttribute('src');
        if (prevSrc && prevSrc !== nextSrc) {
          var outgoing = document.createElement('img');
          outgoing.className = 'showcase-outgoing ' + (delta > 0 ? 'showcase-exit-next' : 'showcase-exit-prev');
          outgoing.alt = '';
          outgoing.setAttribute('aria-hidden', 'true');
          outgoing.src = prevSrc;
          stage.appendChild(outgoing);
          var cleanup = function () {
            if (outgoing.parentNode) outgoing.parentNode.removeChild(outgoing);
          };
          outgoing.addEventListener('animationend', cleanup, { once: true });
          setTimeout(cleanup, 620);
        }

        image.classList.remove('showcase-enter-next', 'showcase-enter-prev');
        stage.classList.remove('is-switching-next', 'is-switching-prev');
        void image.offsetWidth;
        image.src = nextSrc;
        image.classList.add(delta > 0 ? 'showcase-enter-next' : 'showcase-enter-prev');
        stage.classList.add(delta > 0 ? 'is-switching-next' : 'is-switching-prev');
        clearTimeout(lightboxState.sheenTimer);
        lightboxState.sheenTimer = setTimeout(function () {
          stage.classList.remove('is-switching-next', 'is-switching-prev');
        }, 640);
      });
    }
    loader.onload = function () {
      if (typeof loader.decode === 'function') loader.decode().then(finish, finish);
      else finish();
    };
    loader.onerror = finish;
    loader.src = nextSrc;
    if (loader.complete && loader.naturalWidth > 0) {
      if (typeof loader.decode === 'function') loader.decode().then(finish, finish);
      else finish();
    }
  }

  function stepLightbox(targetIndexOrDelta, isAbsolute) {
    var ctrl = lightboxState.controller;
    if (!ctrl || !lightboxState.open || lightboxState.closing) return;
    var home = Object.assign({}, DEFAULT_HOME, currentSite().home || {});
    var images = getShowcaseImages(home, ctrl.arrayKey, ctrl.legacyKey);
    if (images.length <= 1) return;
    var current = state.showcaseIndices[ctrl.arrayKey] || 0;
    var nextIndex = isAbsolute
      ? ((targetIndexOrDelta % images.length) + images.length) % images.length
      : ((current + targetIndexOrDelta + images.length) % images.length);
    if (nextIndex === current) return;
    var delta = isAbsolute ? (nextIndex > current ? 1 : -1) : targetIndexOrDelta;
    ctrl.goToIndex(nextIndex, delta);
    animateLightboxSlide(images[nextIndex], nextIndex, images.length, delta);
  }

  function cancelStageAnimations(stage) {
    if (lightboxState.activeAnim) {
      try { lightboxState.activeAnim.cancel(); } catch (_) {}
      lightboxState.activeAnim = null;
    }
    if (stage && typeof stage.getAnimations === 'function') {
      var list = stage.getAnimations();
      for (var i = 0; i < list.length; i += 1) {
        try { list[i].cancel(); } catch (_) {}
      }
    }
  }

  function openLightbox(sourceMediaEl, controller) {
    var box = el('screenshot-lightbox');
    var stage = el('lightbox-stage');
    var image = el('lightbox-image');
    var video = el('lightbox-video');
    var closeBtn = el('lightbox-close');
    if (!box || !stage || !image || !sourceMediaEl) return;
    if (lightboxState.open && !lightboxState.closing) return;

    clearTimeout(lightboxState.closeTimer);
    cancelStageAnimations(stage);
    stage.style.opacity = '';
    stage.style.transform = '';

    stopSmoothScroll();
    lightboxState.open = true;
    lightboxState.closing = false;
    lightboxState.sourceEl = sourceMediaEl;
    lightboxState.controller = controller || null;

    var oldOutgoing = stage.querySelectorAll('.showcase-outgoing');
    for (var i = 0; i < oldOutgoing.length; i += 1) oldOutgoing[i].remove();
    image.classList.remove('showcase-enter-next', 'showcase-enter-prev');
    stage.classList.remove('is-switching-next', 'is-switching-prev');

    var srcUrl = sourceMediaEl.currentSrc || sourceMediaEl.getAttribute('src') || '';
    var isVideo = sourceMediaEl.tagName === 'VIDEO';
    if (isVideo && video) {
      box.setAttribute('aria-label', 'Maximized video');
      image.classList.add('hidden');
      image.removeAttribute('src');
      video.classList.remove('hidden');
      video.src = srcUrl;
      try {
        video.currentTime = sourceMediaEl.currentTime || 0;
        var p = video.play();
        if (p && typeof p.catch === 'function') p.catch(function () {});
      } catch (_) {}
    } else {
      box.setAttribute('aria-label', 'Maximized screenshot');
      if (video) {
        try { video.pause(); } catch (_) {}
        video.classList.add('hidden');
        video.removeAttribute('src');
        if (typeof video.load === 'function') video.load();
      }
      image.classList.remove('hidden');
      image.src = srcUrl;
      image.alt = sourceMediaEl.alt || 'Maximized screenshot';
    }
    renderLightboxNav();

    box.classList.remove('hidden', 'is-closing', 'is-open');
    box.setAttribute('aria-hidden', 'false');
    void box.offsetWidth;

    var fromTransform = getLightboxFlipTransform(sourceMediaEl, stage) || 'translate3d(0, 20px, 0) scale(0.84)';
    box.classList.add('is-open');
    if (typeof stage.animate === 'function') {
      var openAnim = stage.animate(
        [
          { transform: fromTransform, opacity: 0.25 },
          { transform: 'translate3d(0, 0, 0) scale(1)', opacity: 1 }
        ],
        { duration: 400, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'none' }
      );
      lightboxState.activeAnim = openAnim;
      openAnim.onfinish = function () {
        if (lightboxState.activeAnim === openAnim) {
          lightboxState.activeAnim = null;
        }
      };
    }
    if (closeBtn) closeBtn.focus();
  }

  function closeLightbox() {
    var box = el('screenshot-lightbox');
    var stage = el('lightbox-stage');
    if (!box || !stage || !lightboxState.open || lightboxState.closing) return;

    lightboxState.closing = true;
    box.classList.remove('is-open');
    box.classList.add('is-closing');

    cancelStageAnimations(stage);

    var toTransform = getLightboxFlipTransform(lightboxState.sourceEl, stage) || 'translate3d(0, 18px, 0) scale(0.86)';
    var finished = false;
    function finishClose() {
      if (finished) return;
      finished = true;
      clearTimeout(lightboxState.closeTimer);
      box.classList.add('hidden');
      box.classList.remove('is-closing', 'is-open');
      box.setAttribute('aria-hidden', 'true');
      cancelStageAnimations(stage);
      stage.style.opacity = '';
      stage.style.transform = '';
      var video = el('lightbox-video');
      if (video) {
        try { video.pause(); } catch (_) {}
        video.classList.add('hidden');
        video.removeAttribute('src');
        if (typeof video.load === 'function') video.load();
      }
      var image = el('lightbox-image');
      if (image) image.classList.remove('hidden');
      lightboxState.open = false;
      lightboxState.closing = false;
      var restoreFocusEl = lightboxState.sourceEl;
      lightboxState.sourceEl = null;
      lightboxState.controller = null;
      if (restoreFocusEl && document.body.contains(restoreFocusEl)) {
        var focusTarget = restoreFocusEl.closest('.section-showcase') || restoreFocusEl;
        if (typeof focusTarget.focus === 'function') {
          try { focusTarget.focus({ preventScroll: true }); } catch (_) {}
        }
      }
    }

    if (typeof stage.animate === 'function') {
      var closeAnim = stage.animate(
        [
          { transform: 'translate3d(0, 0, 0) scale(1)', opacity: 1 },
          { transform: toTransform, opacity: 0 }
        ],
        { duration: 300, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'forwards' }
      );
      lightboxState.activeAnim = closeAnim;
      closeAnim.onfinish = finishClose;
      lightboxState.closeTimer = setTimeout(finishClose, 340);
    } else {
      lightboxState.closeTimer = setTimeout(finishClose, 300);
    }
  }

  function wireLightboxEvents() {
    var closeBtn = el('lightbox-close');
    var backdrop = el('lightbox-backdrop');
    var prevBtn = el('lightbox-prev');
    var nextBtn = el('lightbox-next');
    var dotsEl = el('lightbox-dots');
    if (closeBtn) closeBtn.addEventListener('click', closeLightbox);
    if (backdrop) backdrop.addEventListener('click', closeLightbox);
    if (prevBtn) prevBtn.addEventListener('click', function () { stepLightbox(-1, false); });
    if (nextBtn) nextBtn.addEventListener('click', function () { stepLightbox(1, false); });
    if (dotsEl) {
      dotsEl.addEventListener('click', function (e) {
        var btn = e.target && e.target.closest ? e.target.closest('.showcase-dot') : null;
        if (!btn) return;
        var idx = parseInt(btn.dataset.index || '', 10);
        if (!isNaN(idx)) stepLightbox(idx, true);
      });
    }
    window.addEventListener('keydown', function (e) {
      if (!lightboxState.open) return;
      if (e.key === 'Escape') { e.preventDefault(); closeLightbox(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); stepLightbox(-1, false); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); stepLightbox(1, false); }
    });
  }

  async function init() {
    wireEvents();
    initSmoothScroll();

    var hash = window.location.hash.replace(/^#/, '').toLowerCase();
    var siteLoad = loadSite();
    switchView(hash, false);
    await siteLoad;
    applyDeveloperState();
  }

  init();
})();
