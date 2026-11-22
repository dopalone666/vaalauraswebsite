(function () {
  'use strict';

  var state = {
    config: null,
    bearerToken: null,
    session: null,
    handoff: null,
    devFormOpen: false,
    popupWindow: null,
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
      'alert-banner ' + (type === 'error' ? 'alert-error' : type === 'warn' ? 'alert-warn' : '');
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

  function setLaunchStatus(message) {
    var node = el('launch-status-msg');
    if (!node) return;
    if (!message) {
      node.textContent = '';
      show(node, false);
      return;
    }
    node.textContent = message;
    show(node, true);
  }

  function initialsFor(name) {
    var parts = String(name || 'VA').trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return String(name || 'VA').slice(0, 2).toUpperCase();
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
      el('portal-signing-warning').classList.toggle('hidden', Boolean(cfg.signingConfigured));
      var minDollars = '$' + (cfg.patreonMinTierCents / 100).toFixed(2);
      el('min-tier-copy').textContent = minDollars;
      el('patreon-tier-note').textContent = minDollars + '+ tier';
      var localhostPort = String(cfg.localhostPort || 48912);
      el('btn-send-localhost-inline').textContent =
        "Desktop app didn't open? Send to localhost:" + localhostPort;
    }

    if (!signedIn) {
      show(el('state-logged-out'), true);
      show(el('state-verified'), false);
      show(el('state-denied'), false);
      return;
    }

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

      var twLink = el('link-subscribe-twitch');
      var patLink = el('link-subscribe-patreon');
      if (cfg && cfg.twitchChannelUrl) {
        twLink.href = cfg.twitchChannelUrl;
        show(twLink, true);
      } else {
        show(twLink, false);
      }
      if (cfg && cfg.patreonCreatorUrl) {
        patLink.href = cfg.patreonCreatorUrl;
        show(patLink, true);
      } else {
        show(patLink, false);
      }
    }
  }

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
      setLaunchStatus('');
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
      setLaunchStatus('');
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
      setLaunchStatus('');
      renderPortal();
      setBanner('Membership status refreshed.', 'info');
    } catch (err) {
      setBanner(err.message || 'Could not refresh subscription.', 'error');
    }
  }

  async function signOut() {
    setBanner('');
    setDevError('');
    setLaunchStatus('');
    try {
      if (state.bearerToken) {
        await apiJson('/api/auth/logout', { method: 'POST' });
      }
    } catch (_) {}
    state.bearerToken = null;
    state.session = null;
    state.handoff = null;
    renderPortal();
  }

  async function launchDesktopApp() {
    setBanner('');
    setLaunchStatus('');
    var btn = el('btn-launch-desktop');
    if (btn) btn.disabled = true;

    try {
      var payload = await apiJson('/api/license/issue', { method: 'POST' });
      state.handoff = payload;
      triggerHiddenNavigation(payload.appLaunchUri);
      setLaunchStatus('Opening VaalAuras desktop app...');
    } catch (err) {
      setBanner(err.message || 'Could not generate desktop launch code.', 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function sendToLocalhostFallback() {
    setBanner('');
    setLaunchStatus('');
    try {
      var payload = await apiJson('/api/license/issue', { method: 'POST' });
      state.handoff = payload;
      triggerHiddenNavigation(payload.localhostCallbackUrl);
      var port = (state.config && state.config.localhostPort) || 48912;
      setLaunchStatus('Sent login code to localhost:' + String(port) + '.');
    } catch (err) {
      setBanner(err.message || 'Could not send login code to localhost.', 'error');
    }
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

    el('brand-link').addEventListener('click', function (e) {
      e.preventDefault();
    });

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

    window.addEventListener('message', function (event) {
      var data = event.data;
      if (!data || typeof data !== 'object') return;
      if (event.origin !== window.location.origin) return;

      if (data.type === 'VAAL_AUTH_COMPLETE' && data.authCode) {
        claimAuthCode(data.authCode);
      } else if (data.type === 'VAAL_AUTH_ERROR') {
        setBanner(data.error || 'OAuth login failed.', 'error');
      }
    });
  }

  async function init() {
    wireEvents();

    try {
      state.config = await apiJson('/api/config');
    } catch (err) {
      setBanner('Could not load portal configuration: ' + err.message, 'error');
    }

    renderPortal();

    var params = new URLSearchParams(window.location.search);
    var authCode = params.get('authCode');
    var authError = params.get('authError');
    if (authCode || authError) {
      window.history.replaceState({}, '', window.location.pathname);
      if (authError) {
        setBanner(authError, 'error');
      } else if (authCode) {
        await claimAuthCode(authCode);
      }
    }
  }

  init();
})();
