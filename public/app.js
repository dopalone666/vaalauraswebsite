(function () {
  'use strict';

  var state = {
    config: null,
    bearerToken: null,
    session: null,
    handoff: null,
    activeTab: 'portal',
    activePyTab: 'prompt',
    pyBaseUrl: window.location.origin,
    pyScheme: 'vaalauras',
    pyPort: 48912,
    setupHostUrl: window.location.origin,
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

  function initialsFor(name) {
    var parts = String(name || 'VA').trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return String(name || 'VA').slice(0, 2).toUpperCase();
  }

  function sanitizeScheme(raw) {
    var cleaned = String(raw || '')
      .trim()
      .toLowerCase()
      .replace(/:\/?\/?$/, '');
    var reserved = {
      http: 1,
      https: 1,
      javascript: 1,
      data: 1,
      vbscript: 1,
      file: 1,
      about: 1,
      blob: 1,
    };
    if (!/^[a-z][a-z0-9+.-]{1,30}$/.test(cleaned) || reserved[cleaned]) {
      return 'vaalauras';
    }
    return cleaned;
  }

  function sanitizePort(raw) {
    var parsed = Number.parseInt(String(raw || ''), 10);
    if (!Number.isFinite(parsed) || parsed < 1024 || parsed > 65535) {
      return 48912;
    }
    return parsed;
  }

  function normalizeBaseUrl(raw) {
    var trimmed = String(raw || '').trim().replace(/\/+$/, '');
    if (/^https?:\/\//i.test(trimmed)) {
      return trimmed;
    }
    return window.location.origin;
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

  function copyText(text, buttonEl, doneLabel) {
    if (!text) return;
    var original = buttonEl ? buttonEl.textContent : '';
    var finish = function () {
      if (!buttonEl) return;
      buttonEl.textContent = doneLabel || 'Copied';
      setTimeout(function () {
        buttonEl.textContent = original;
      }, 1400);
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(finish).catch(function () {
        fallbackCopy(text);
        finish();
      });
    } else {
      fallbackCopy(text);
      finish();
    }
  }

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
    } catch (_) {}
    document.body.removeChild(ta);
  }

  function buildPromptSnippet() {
    var baseUrl = normalizeBaseUrl(state.pyBaseUrl);
    var scheme = sanitizeScheme(state.pyScheme);
    var port = sanitizePort(state.pyPort);

    return [
      'I host my VaalAuras membership login website on Cloudflare Workers at ' + baseUrl + '.',
      'When a user signs in with Twitch (active sub / Prime) or Patreon ($5+ tier) and clicks "Log in" on the website, it generates a single-use login code sent via:',
      '1. Custom Windows URI protocol: ' + scheme + '://auth?code=THE_CODE',
      '2. Local HTTP callback: http://127.0.0.1:' + port + '/callback?code=THE_CODE',
      '',
      'Please wire this into my VaalAuras Python Windows desktop app:',
      '1. Create a helper module (vaalauras_auth.py) using only Python standard library (urllib.request, http.server, webbrowser, json, pathlib) — no extra pip packages needed.',
      '2. Connect the existing "Log in" button in the top-right header of VaalAuras: when clicked, start a background local HTTP server on 127.0.0.1:' + port + ' listening on /callback, and open ' + baseUrl + ' in the default browser.',
      '3. Also inspect sys.argv on startup (and register HKCU\\Software\\Classes\\' + scheme + ' in the Windows Registry) so clicking "Log in" on the website can launch VaalAuras directly via ' + scheme + '://auth?code=....',
      '4. When the code arrives, POST JSON {"code": code} to ' + baseUrl + '/api/app/exchange. If "valid" is true, save "licenseToken" to the user app data folder, update the header status from "Log in" to the verified username/tier, and unlock paid features.',
      '5. On app startup, POST {"token": saved_token} to ' + baseUrl + '/api/app/verify so verified subscribers stay unlocked automatically.',
    ].join('\n');
  }

  function buildPythonSnippet() {
    var baseUrl = normalizeBaseUrl(state.pyBaseUrl);
    var scheme = sanitizeScheme(state.pyScheme);
    var port = sanitizePort(state.pyPort);

    return [
      '"""',
      'VaalAuras — Membership Login & Paid Feature Gate',
      'Connects to your Cloudflare Workers portal (' + baseUrl + ').',
      'Supports both Localhost Callback (http://127.0.0.1:' + port + '/callback?code=...)',
      'and Windows Custom Protocol (' + scheme + '://auth?code=...).',
      'Zero secret keys live inside this Python app!',
      '"""',
      '',
      'import json',
      'import sys',
      'import threading',
      'import urllib.error',
      'import urllib.parse',
      'import urllib.request',
      'import webbrowser',
      'from http.server import BaseHTTPRequestHandler, HTTPServer',
      'from pathlib import Path',
      '',
      'PORTAL_URL = "' + baseUrl + '"',
      'APP_SCHEME = "' + scheme + '"',
      'LOCAL_PORT = ' + port,
      'LICENSE_FILE = Path.home() / ".' + scheme + '_license.json"',
      '',
      '',
      'def exchange_code_with_portal(code: str) -> dict:',
      '    """Exchange the single-use browser handoff code for a signed license token."""',
      '    req = urllib.request.Request(',
      '        f"{PORTAL_URL}/api/app/exchange",',
      '        data=json.dumps({"code": code}).encode("utf-8"),',
      '        headers={"Content-Type": "application/json"},',
      '        method="POST",',
      '    )',
      '    with urllib.request.urlopen(req, timeout=10) as resp:',
      '        data = json.loads(resp.read().decode("utf-8"))',
      '    if data.get("valid"):',
      '        LICENSE_FILE.write_text(json.dumps(data, indent=2), encoding="utf-8")',
      '    return data',
      '',
      '',
      'def verify_saved_license() -> dict | None:',
      '    """Verify saved license on app startup so active subscribers stay logged in."""',
      '    if not LICENSE_FILE.exists():',
      '        return None',
      '    try:',
      '        saved = json.loads(LICENSE_FILE.read_text(encoding="utf-8"))',
      '        token = saved.get("licenseToken")',
      '        if not token:',
      '            return None',
      '        req = urllib.request.Request(',
      '            f"{PORTAL_URL}/api/app/verify",',
      '            data=json.dumps({"token": token}).encode("utf-8"),',
      '            headers={"Content-Type": "application/json"},',
      '            method="POST",',
      '        )',
      '        with urllib.request.urlopen(req, timeout=10) as resp:',
      '            result = json.loads(resp.read().decode("utf-8"))',
      '        return result if result.get("valid") else None',
      '    except Exception:',
      '        return None',
      '',
      '',
      'def wait_for_browser_login(timeout_seconds: int = 180) -> dict | None:',
      '    """Call this when the user clicks Log in inside VaalAuras."""',
      '    received = {"data": None}',
      '    done = threading.Event()',
      '',
      '    class CallbackHandler(BaseHTTPRequestHandler):',
      '        def do_GET(self):',
      '            parsed = urllib.parse.urlparse(self.path)',
      '            if parsed.path != "/callback":',
      '                self.send_response(404)',
      '                self.end_headers()',
      '                return',
      '            params = urllib.parse.parse_qs(parsed.query)',
      '            code = (params.get("code") or [None])[0]',
      '            if code:',
      '                try:',
      '                    received["data"] = exchange_code_with_portal(code)',
      '                    self.send_response(200)',
      '                    self.send_header("Content-Type", "text/html; charset=utf-8")',
      '                    self.end_headers()',
      '                    self.wfile.write(',
      '                        b"<html><body style=\'background:#0D0A0B;color:#EFE6DC;font-family:sans-serif;display:grid;place-items:center;height:100vh;margin:0\'>"',
      '                        b"<div style=\'border:1px solid #2D2224;background:#161112;padding:24px 32px;border-radius:8px;text-align:center\'>"',
      '                        b"<h2 style=\'color:#D4A257;margin:0 0 8px\'>VaalAuras Unlocked</h2>"',
      '                        b"<p style=\'margin:0;color:#A3948B\'>You can close this tab and return to VaalAuras.</p>"',
      '                        b"</div></body></html>"',
      '                    )',
      '                except Exception as exc:',
      '                    self.send_response(400)',
      '                    self.end_headers()',
      '                    self.wfile.write(f"Login failed: {exc}".encode("utf-8"))',
      '                finally:',
      '                    done.set()',
      '',
      '        def log_message(self, format, *args):',
      '            return',
      '',
      '    server = HTTPServer(("127.0.0.1", LOCAL_PORT), CallbackHandler)',
      '    thread = threading.Thread(target=server.serve_forever, daemon=True)',
      '    thread.start()',
      '',
      '    webbrowser.open(PORTAL_URL)',
      '    done.wait(timeout=timeout_seconds)',
      '    server.shutdown()',
      '    server.server_close()',
      '    return received["data"]',
      '',
      '',
      'def check_launch_args_for_code() -> dict | None:',
      '    """Handle Windows launches via ' + scheme + '://auth?code=..."""',
      '    for arg in sys.argv[1:]:',
      '        if arg.startswith(f"{APP_SCHEME}://"):',
      '            parsed = urllib.parse.urlparse(arg)',
      '            code = (urllib.parse.parse_qs(parsed.query).get("code") or [None])[0]',
      '            if code:',
      '                return exchange_code_with_portal(code)',
      '    return None',
      '',
      '',
      'if __name__ == "__main__":',
      '    session = check_launch_args_for_code() or verify_saved_license()',
      '    if not session:',
      '        print("Opening VaalAuras login portal...")',
      '        session = wait_for_browser_login()',
      '',
      '    if session and session.get("valid"):',
      '        user = session.get("user") or session.get("claims", {})',
      '        print("Paid features UNLOCKED for:", user)',
      '    else:',
      '        print("Paid features locked. Active Twitch Sub or $5+ Patreon tier required.")',
    ].join('\n');
  }

  function buildRegistrySnippet() {
    var scheme = sanitizeScheme(state.pyScheme);
    return [
      '# Optional: Register ' + scheme + ':// protocol in Windows (no admin needed, per-user)',
      '# Run this helper once inside your Python app on Windows:',
      '',
      'import sys',
      'import winreg',
      '',
      'def register_windows_protocol(exe_path: str = sys.executable) -> None:',
      '    base = r"Software\\Classes\\' + scheme + '"',
      '    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, base) as k:',
      '        winreg.SetValueEx(k, "", 0, winreg.REG_SZ, "URL:VaalAuras Protocol")',
      '        winreg.SetValueEx(k, "URL Protocol", 0, winreg.REG_SZ, "")',
      '    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, base + r"\\shell\\open\\command") as cmd:',
      '        winreg.SetValueEx(cmd, "", 0, winreg.REG_SZ, f\'"{exe_path}" "%1"\')',
    ].join('\n');
  }

  function switchTab(tab) {
    state.activeTab = tab;
    var tabs = document.querySelectorAll('.nav-tab');
    for (var i = 0; i < tabs.length; i += 1) {
      var btn = tabs[i];
      var isTarget = btn.getAttribute('data-tab') === tab;
      btn.classList.toggle('is-active', isTarget);
      btn.setAttribute('aria-pressed', isTarget ? 'true' : 'false');
    }
    show(el('view-portal'), tab === 'portal');
    show(el('view-python'), tab === 'python');
    show(el('view-setup'), tab === 'setup');
  }

  function renderPythonSnippet() {
    var pre = el('py-snippet-pre');
    var copyBtn = el('btn-copy-snippet');
    if (!pre) return;

    var tabBtns = document.querySelectorAll('[data-py-tab]');
    for (var i = 0; i < tabBtns.length; i += 1) {
      var active = tabBtns[i].getAttribute('data-py-tab') === state.activePyTab;
      tabBtns[i].classList.toggle('is-active', active);
    }

    if (state.activePyTab === 'prompt') {
      pre.textContent = buildPromptSnippet();
      pre.classList.add('is-wrapped');
      if (copyBtn) copyBtn.textContent = 'Copy Prompt';
    } else if (state.activePyTab === 'python') {
      pre.textContent = buildPythonSnippet();
      pre.classList.remove('is-wrapped');
      if (copyBtn) copyBtn.textContent = 'Copy Python Code';
    } else {
      pre.textContent = buildRegistrySnippet();
      pre.classList.remove('is-wrapped');
      if (copyBtn) copyBtn.textContent = 'Copy Registry Helper';
    }
  }

  function renderSetupCallbacks() {
    var base = normalizeBaseUrl(state.setupHostUrl);
    var twitchCb = el('setup-twitch-cb');
    var patreonCb = el('setup-patreon-cb');
    if (twitchCb) twitchCb.value = base + '/auth/twitch/callback';
    if (patreonCb) patreonCb.value = base + '/auth/patreon/callback';
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

  function renderPortal() {
    var cfg = state.config;
    var signedIn = Boolean(state.session && state.bearerToken);

    show(el('topbar-deploy-btn'), !signedIn);
    show(el('topbar-signout-btn'), signedIn);

    if (cfg) {
      el('portal-signing-warning').classList.toggle('hidden', Boolean(cfg.signingConfigured));
      var minDollars = '$' + (cfg.patreonMinTierCents / 100).toFixed(2);
      el('min-tier-copy').textContent = minDollars;
      el('patreon-tier-note').textContent = minDollars + '+ tier';
      el('cfg-twitch-status').textContent = cfg.twitchConfigured ? 'Configured' : 'Needs Keys';
      el('cfg-patreon-status').textContent = cfg.patreonConfigured ? 'Configured' : 'Needs Keys';
      show(el('unconfigured-notice'), !cfg.twitchConfigured && !cfg.patreonConfigured);
      el('btn-send-localhost').textContent =
        'Send to Localhost:' + String(cfg.localhostPort || 48912);
    }

    if (!signedIn) {
      show(el('state-logged-out'), true);
      show(el('state-verified'), false);
      show(el('state-denied'), false);
      return;
    }

    var user = state.session.user;
    var ent = state.session.entitlement;
    var isDemo = Boolean(state.session.isDemo);
    var providerLabel = user.provider === 'twitch' ? 'Twitch' : 'Patreon';
    var checkedLabel = ent.checkedAt ? new Date(ent.checkedAt).toLocaleString() : 'Just now';

    if (ent.active) {
      show(el('state-logged-out'), false);
      show(el('state-verified'), true);
      show(el('state-denied'), false);

      renderMemberAvatar('verified-avatar-img', 'verified-avatar-initials', user);
      el('verified-name').textContent = user.displayName || user.username;
      show(el('verified-demo-flag'), isDemo);
      el('verified-summary').textContent = providerLabel + ' · ' + ent.tierLabel;
      el('verified-reason').textContent = ent.reason;
      el('verified-checked-at').textContent = checkedLabel;

      if (state.handoff) {
        show(el('handoff-drawer'), true);
        el('handoff-protocol-link').href = state.handoff.appLaunchUri;
        el('handoff-code-input').value = state.handoff.handoffCode;
      } else {
        show(el('handoff-drawer'), false);
      }
    } else {
      show(el('state-logged-out'), false);
      show(el('state-verified'), false);
      show(el('state-denied'), true);

      renderMemberAvatar('denied-avatar-img', 'denied-avatar-initials', user);
      el('denied-name').textContent = user.displayName || user.username;
      show(el('denied-demo-flag'), isDemo);
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
        // Fallback when popups are blocked (e.g., strict mobile browser)
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
        isDemo: data.isDemo,
      };
      state.handoff = null;
      show(el('exchange-test-output'), false);
      renderPortal();
    } catch (err) {
      setBanner(err.message || 'Could not verify login handoff.', 'error');
    }
  }

  async function runDemo(scenario) {
    setBanner('');
    try {
      var data = await apiJson('/api/auth/demo', {
        method: 'POST',
        body: JSON.stringify({ scenario: scenario }),
      });
      state.bearerToken = data.bearerToken;
      state.session = {
        user: data.user,
        entitlement: data.entitlement,
        isDemo: true,
      };
      state.handoff = null;
      show(el('exchange-test-output'), false);
      renderPortal();
    } catch (err) {
      setBanner(err.message || 'Preview sandbox failed.', 'error');
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
        isDemo: Boolean(data.isDemo),
      };
      state.handoff = null;
      renderPortal();
      setBanner('Subscription status refreshed.', 'info');
    } catch (err) {
      setBanner(err.message || 'Could not refresh subscription.', 'error');
    }
  }

  async function signOut() {
    setBanner('');
    try {
      if (state.bearerToken) {
        await apiJson('/api/auth/logout', { method: 'POST' });
      }
    } catch (_) {}
    state.bearerToken = null;
    state.session = null;
    state.handoff = null;
    show(el('exchange-test-output'), false);
    show(el('sandbox-drawer'), false);
    if (el('btn-toggle-sandbox')) {
      el('btn-toggle-sandbox').textContent = 'Open Preview Sandbox';
    }
    renderPortal();
  }

  async function launchDesktopApp() {
    setBanner('');
    try {
      var payload = await apiJson('/api/license/issue', { method: 'POST' });
      state.handoff = payload;
      el('tester-code-input').value = payload.handoffCode;
      show(el('exchange-test-output'), false);
      renderPortal();

      // Trigger custom Windows URI protocol silently via hidden iframe
      var frame = document.createElement('iframe');
      frame.style.display = 'none';
      frame.src = payload.appLaunchUri;
      document.body.appendChild(frame);
      setTimeout(function () {
        if (frame.parentNode) frame.parentNode.removeChild(frame);
      }, 1500);
    } catch (err) {
      setBanner(err.message || 'Could not generate desktop launch code.', 'error');
    }
  }

  async function runExchangeRequest(code, outputNode) {
    if (!code) {
      outputNode.textContent = 'Enter a handoff code first.';
      show(outputNode, true);
      return;
    }
    try {
      var resp = await fetch('/api/app/exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code }),
      });
      var data = await resp.json();
      outputNode.textContent = JSON.stringify(data, null, 2);
      show(outputNode, true);
    } catch (err) {
      outputNode.textContent = JSON.stringify({ valid: false, error: err.message }, null, 2);
      show(outputNode, true);
    }
  }

  async function downloadCloudflareZip(buttonEl) {
    var origText = buttonEl ? buttonEl.textContent : '';
    if (buttonEl) {
      buttonEl.disabled = true;
      buttonEl.textContent = 'Packing .zip...';
    }
    setBanner('');
    try {
      var resp = await fetch('/api/local-export.zip');
      if (!resp.ok) {
        throw new Error('Could not build .zip archive (' + resp.status + ').');
      }
      var blob = await resp.blob();
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'vaalauras-cloudflare.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () {
        URL.revokeObjectURL(url);
      }, 2000);
      if (buttonEl) buttonEl.textContent = 'Downloaded';
    } catch (err) {
      setBanner(err.message || 'Download failed.', 'error');
      if (buttonEl) buttonEl.textContent = origText;
    } finally {
      if (buttonEl) {
        setTimeout(function () {
          buttonEl.disabled = false;
          buttonEl.textContent = origText;
        }, 1800);
      }
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
      switchTab('portal');
    });

    var navTabs = document.querySelectorAll('.nav-tab');
    for (var i = 0; i < navTabs.length; i += 1) {
      navTabs[i].addEventListener('click', function () {
        switchTab(this.getAttribute('data-tab'));
      });
    }

    var jumpBtns = document.querySelectorAll('[data-jump-tab]');
    for (var j = 0; j < jumpBtns.length; j += 1) {
      jumpBtns[j].addEventListener('click', function () {
        switchTab(this.getAttribute('data-jump-tab'));
      });
    }

    el('topbar-deploy-btn').addEventListener('click', function () {
      switchTab('setup');
    });
    el('topbar-signout-btn').addEventListener('click', signOut);

    el('btn-twitch-login').addEventListener('click', function () {
      startOAuth('twitch');
    });
    el('btn-patreon-login').addEventListener('click', function () {
      startOAuth('patreon');
    });

    el('btn-toggle-sandbox').addEventListener('click', function () {
      var box = el('sandbox-drawer');
      var isHidden = box.classList.contains('hidden');
      show(box, isHidden);
      this.textContent = isHidden ? 'Hide Preview Sandbox' : 'Open Preview Sandbox';
    });

    var demoBtns = document.querySelectorAll('[data-demo]');
    for (var d = 0; d < demoBtns.length; d += 1) {
      demoBtns[d].addEventListener('click', function () {
        runDemo(this.getAttribute('data-demo'));
      });
    }

    el('btn-launch-desktop').addEventListener('click', launchDesktopApp);
    el('btn-recheck-verified').addEventListener('click', recheckSubscription);
    el('btn-signout-verified').addEventListener('click', signOut);
    el('btn-recheck-denied').addEventListener('click', recheckSubscription);
    el('btn-signout-denied').addEventListener('click', signOut);

    el('btn-send-localhost').addEventListener('click', function () {
      if (!state.handoff) return;
      var frame = document.createElement('iframe');
      frame.style.display = 'none';
      frame.src = state.handoff.localhostCallbackUrl;
      document.body.appendChild(frame);
      setTimeout(function () {
        if (frame.parentNode) frame.parentNode.removeChild(frame);
      }, 1500);
      setBanner(
        'Sent login code to ' +
          state.handoff.localhostCallbackUrl +
          '. (Only works while your Python app is listening locally.)',
        'info'
      );
    });

    el('btn-copy-handoff').addEventListener('click', function () {
      copyText(el('handoff-code-input').value, this, 'Copied');
    });

    el('btn-test-exchange').addEventListener('click', function () {
      if (!state.handoff) return;
      runExchangeRequest(state.handoff.handoffCode, el('exchange-test-output'));
    });

    // Python App tab events
    el('py-base-url').addEventListener('input', function () {
      state.pyBaseUrl = this.value;
      renderPythonSnippet();
    });
    el('py-scheme').addEventListener('input', function () {
      state.pyScheme = this.value;
      renderPythonSnippet();
    });
    el('py-port').addEventListener('input', function () {
      state.pyPort = this.value;
      renderPythonSnippet();
    });

    var pyTabs = document.querySelectorAll('[data-py-tab]');
    for (var p = 0; p < pyTabs.length; p += 1) {
      pyTabs[p].addEventListener('click', function () {
        state.activePyTab = this.getAttribute('data-py-tab');
        renderPythonSnippet();
      });
    }

    el('btn-copy-snippet').addEventListener('click', function () {
      copyText(el('py-snippet-pre').textContent, this, 'Copied');
    });

    el('btn-download-py').addEventListener('click', function () {
      var blob = new Blob([buildPythonSnippet()], { type: 'text/x-python;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'vaalauras_auth.py';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });

    el('btn-run-exchange-test').addEventListener('click', function () {
      runExchangeRequest(el('tester-code-input').value.trim(), el('tester-result-pre'));
    });

    // Cloudflare Setup tab events
    el('setup-host-url').addEventListener('input', function () {
      state.setupHostUrl = this.value;
      renderSetupCallbacks();
    });

    var presets = document.querySelectorAll('[data-url-preset]');
    for (var r = 0; r < presets.length; r += 1) {
      presets[r].addEventListener('click', function () {
        var val = this.getAttribute('data-url-preset');
        state.setupHostUrl = val;
        el('setup-host-url').value = val;
        renderSetupCallbacks();
      });
    }

    var copyTargets = document.querySelectorAll('[data-copy-target]');
    for (var c = 0; c < copyTargets.length; c += 1) {
      copyTargets[c].addEventListener('click', function () {
        var target = el(this.getAttribute('data-copy-target'));
        if (target) copyText(target.value, this, 'Copied');
      });
    }

    if (el('btn-download-zip-home')) {
      el('btn-download-zip-home').addEventListener('click', function () {
        downloadCloudflareZip(this);
      });
    }
    if (el('btn-download-zip-setup')) {
      el('btn-download-zip-setup').addEventListener('click', function () {
        downloadCloudflareZip(this);
      });
    }

    // Listen for OAuth popup postMessage
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
      var detectedBase =
        state.config && state.config.appBaseUrl ? state.config.appBaseUrl : window.location.origin;

      // Avoid leaking AI Studio internal URLs into copyable self-host fields
      var looksInternal = /\.run\.app$/i.test(new URL(detectedBase).hostname);
      var cleanDefault = looksInternal
        ? 'https://vaalauras-auth.yourname.workers.dev'
        : detectedBase;

      state.pyBaseUrl = cleanDefault;
      state.pyScheme = state.config.protocolScheme || 'vaalauras';
      state.pyPort = state.config.localhostPort || 48912;
      state.setupHostUrl = cleanDefault;

      el('py-base-url').value = state.pyBaseUrl;
      el('py-scheme').value = state.pyScheme;
      el('py-port').value = String(state.pyPort);
      el('setup-host-url').value = state.setupHostUrl;
    } catch (err) {
      setBanner('Could not load portal configuration: ' + err.message, 'error');
    }

    renderPortal();
    renderPythonSnippet();
    renderSetupCallbacks();

    // Show local-export ZIP download button only when running on local/preview server
    fetch('/api/local-export-status')
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (info) {
        if (info && info.available) {
          show(el('btn-download-zip-home'), true);
          show(el('setup-zip-wrap'), true);
        }
      })
      .catch(function () {});

    // Support direct redirect fallback (?authCode=... or ?authError=...)
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
