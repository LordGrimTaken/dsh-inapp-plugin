/**
 * Client half of the Game Lab bundle.
 *
 * Registers a full-size main-slot page (keyed `game-lab`) plus the sidebar
 * panel icon that selects it. The page drives the host HTTP API under
 * `/_dsh/game-lab`: status polling, the multipart live PNG stream, pointer
 * input, the APK game library, Gradle builds, logcat and screenshot saving.
 *
 * Plain-JS React (no JSX, only `require('react')`, no Harness client
 * packages). Every visible string comes from the Client locale service and
 * all styling uses `--dsw-alias-*` theme tokens, scoped under the `gl-`
 * prefix, inside one `data-plugin` style tag rendered by the page itself.
 */
window.__ModuleLoader__.load({
  id: '@local/game-lab',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useRef, useCallback } = React;

    const NS = 'game-lab';
    const PANEL_ID = 'game-lab';
    const PLUGIN_ID = '@local/game-lab';
    const API = '/_dsh/game-lab';

    const SLOW_POLL_MS = 2500;
    const FAST_POLL_MS = 1000;
    const HEARTBEAT_MS = 10000;
    const STREAM_RETRY_MS = 1500;
    const INPUT_MIN_GAP_MS = 84;
    const TAP_MAX_PX = 6;
    const LIB_PAGE_ROWS = 80;
    const LOG_REQUEST_LINES = 200;
    const LOG_SHOWN_LINES = 15;
    const BUILD_LOG_SHOWN_LINES = 12;
    const DEFAULT_IDLE_MINUTES = 5;
    const DEFAULT_RESOLUTION = { width: 720, height: 1280 };

    /* ------------------------------------------------------------------ */
    /* Locale dictionary                                                   */
    /* ------------------------------------------------------------------ */

    const EN = {
      'panel.label': 'Game Lab',

      'app.eyebrow': 'Android workbench',
      'app.title': 'Game Lab',
      'app.subtitle': 'Your games, running inside the app',

      'state.off': 'Off',
      'state.booting': 'Booting',
      'state.online': 'Live',
      'state.stopping': 'Stopping',
      'state.error': 'Error',

      'action.start': 'Start emulator',
      'action.stop': 'Stop emulator',
      'action.starting': 'Starting...',
      'action.stopping': 'Stopping...',
      'action.refresh': 'Refresh',
      'action.refreshLibrary': 'Refresh game library',
      'action.retry': 'Retry',

      'boot.label': 'Starting Android...',
      'boot.elapsed': '{n} s',
      'boot.wait': 'Waiting for the screen',

      'device.title': 'Device',
      'device.screenAria': 'Android screen - tap to tap, drag to swipe',
      'device.streamAlt': 'Live Android emulator screen',
      'device.offTitle': 'No emulator running',
      'device.offBody': 'Start Game Lab and Android boots headless, then takes over this panel.',
      'device.offNote':
        'It boots headless on demand and stops itself after {n} minutes idle to keep RAM/CPU low.',
      'device.start': 'Start Game Lab',
      'device.retrying': 'Reconnecting to the live view...',
      'device.tapHint': 'Tap to tap - drag to swipe',
      'device.back': 'Back',
      'device.home': 'Home',
      'device.recents': 'Recents',
      'device.rotate': 'Rotate',
      'device.screenshot': 'Save screenshot',
      'device.reload': 'Reload stream',
      'device.rotateTo': 'Rotate to {value}',
      'device.portrait': 'portrait',
      'device.landscape': 'landscape',

      'lib.title': 'Game library',
      'lib.scanning': 'Scanning for APKs...',
      'lib.search': 'Filter games',
      'lib.emptyTitle': 'No APKs found yet',
      'lib.emptyBody': 'Drop your game builds into one of the scan roots, then refresh.',
      'lib.emptyHint': 'Games built with Build & play appear here automatically.',
      'lib.noMatch': 'No games match this filter.',
      'lib.showMore': 'Show {n} more',
      'lib.older': '{n} older builds',
      'lib.olderOpen': 'Hide older builds',
      'lib.play': 'Play',
      'lib.playGame': 'Play {name}',
      'lib.installing': 'Sending',
      'lib.fromBuild': 'built',
      'lib.fail': 'Could not load the game library.',
      'lib.truncated': 'Scan truncated - showing the first {n} games.',
      'lib.unknownAge': 'unknown age',

      'age.now': 'just now',
      'age.min': '{n} min ago',
      'age.hours': '{n} h ago',
      'age.days': '{n} d ago',
      'age.months': '{n} mo ago',
      'age.years': '{n} y ago',

      'proj.title': 'Projects',
      'proj.emptyTitle': 'No Gradle projects found',
      'proj.emptyBody': 'Put a game project with its own gradlew wrapper under a scan root, then refresh.',
      'proj.build': 'Build & play',
      'proj.building': 'Building...',
      'proj.running': 'Gradle is building...',
      'proj.log': 'Build output',

      'rt.title': 'Runtime',
      'rt.state': 'State',
      'rt.avd': 'AVD',
      'rt.resolution': 'Resolution',
      'rt.fps': 'FPS',
      'rt.ram': 'RAM',
      'rt.cpu': 'CPU',
      'rt.idle': 'Auto-stop',
      'rt.uptime': 'Uptime',
      'rt.idleLeft': '{v} left',
      'rt.none': '-',
      'rt.mb': '{n} MB',
      'rt.percent': '{n}%',
      'rt.size': '{w} x {h}',
      'rt.waiting': 'Waiting for the host...',
      'rt.notScheduled': 'not scheduled',

      'cfg.title': 'Configuration',
      'cfg.avd': 'AVD name',
      'cfg.idle': 'Idle stop',
      'cfg.maxFps': 'Max FPS',
      'cfg.ram': 'RAM',
      'cfg.cores': 'Cores',
      'cfg.gpu': 'GPU mode',
      'cfg.roots': 'Game roots',
      'cfg.minutes': '{n} min',
      'cfg.note': 'Read-only here - edit these in the Game Lab plugin configuration.',
      'cfg.waiting': 'Waiting for the host configuration.',

      'logs.title': 'Logs',
      'logs.load': 'Load logs',
      'logs.loading': 'Loading...',
      'logs.empty': 'No logs loaded yet.',
      'logs.emptyLines': 'Logcat returned no lines.',
      'logs.all': 'all packages',
      'logs.package': 'package {name}',
      'logs.failed': 'Could not read logcat.',
      'logs.buildFailed': 'Last build failed',
      'logs.view': 'Showing the last {n} of {total} lines.',
      'logs.failTitle': 'Could not read logcat',

      'foot.text': 'Headless emulator - live view only while this page is open - auto-stops when idle.',

      'unit.b': 'B',
      'unit.kb': 'KB',
      'unit.mb': 'MB',
      'unit.gb': 'GB',
      'unit.h': 'h',
      'unit.m': 'm',
      'unit.s': 's',

      'err.start': 'Could not start the emulator.',
      'err.stop': 'Could not stop the emulator.',
      'err.input': 'Could not send input.',
      'err.rotate': 'Could not rotate the display.',
      'err.screenshot': 'Could not save the screenshot.',
      'err.poll': 'Host status is unreachable - retrying.',
      'err.unknown': 'Unknown error',
      'err.games': 'Could not load the game library.',

      'install.ok': 'Installed {name}.',
      'install.launched': 'It is now open on the emulator.',
      'install.failed': 'Could not install {name}.',
      'install.hint': 'If the emulator is off, start it first and try again.',

      'build.done': 'Build finished - the APK is in the library.',
      'build.failed': 'The build failed - check the log output.',
      'build.requestFailed': 'Could not start the build.',

      'banner.dismiss': 'Dismiss message',

      'conn.offline': 'Host unreachable',
    };

    /* ------------------------------------------------------------------ */
    /* Small pure helpers                                                  */
    /* ------------------------------------------------------------------ */

    function pad2(value) {
      return value < 10 ? '0' + String(value) : String(value);
    }

    function clamp01(value) {
      if (!isFinite(value)) return 0;
      if (value < 0) return 0;
      if (value > 1) return 1;
      return value;
    }

    function round1(value) {
      return String(Math.round(value * 10) / 10);
    }

    function stripApk(name) {
      return String(name || '').replace(/\.apk$/i, '');
    }

    /** Stable key for a library entry across /games and /install responses. */
    function gameKey(game) {
      if (!game) return 'game:unknown';
      if (game.id !== null && game.id !== undefined && game.id !== '') return 'id:' + String(game.id);
      return 'path:' + String(game.path || game.fileName || '');
    }

    function baseName(value) {
      const text = String(value || '').replace(/[\\/]+$/, '');
      const parts = text.split(/[\\/]/);
      return parts.length > 0 ? parts[parts.length - 1] : text;
    }

    function pathKey(value) {
      return String(value || '')
        .replace(/[\\/]+/g, '/')
        .replace(/\/+$/, '')
        .toLowerCase();
    }

    function sameProject(left, right) {
      const a = pathKey(left);
      const b = pathKey(right);
      if (a === '' || b === '') return false;
      if (a === b) return true;
      return baseName(a) === baseName(b);
    }

    function formatBytes(bytes, tr) {
      const value = typeof bytes === 'number' && isFinite(bytes) && bytes > 0 ? bytes : 0;
      if (value <= 0) return '0 ' + tr('unit.b');
      if (value < 1024) return String(Math.round(value)) + ' ' + tr('unit.b');
      const kb = value / 1024;
      if (kb < 1024) return round1(kb) + ' ' + tr('unit.kb');
      const mb = kb / 1024;
      if (mb < 1024) return round1(mb) + ' ' + tr('unit.mb');
      return round1(mb / 1024) + ' ' + tr('unit.gb');
    }

    function formatAge(ms, tr) {
      const value = typeof ms === 'number' && isFinite(ms) && ms > 0 ? ms : 0;
      if (value < 60000) return tr('age.now');
      const minutes = Math.floor(value / 60000);
      if (minutes < 60) return tr('age.min', { n: minutes });
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return tr('age.hours', { n: hours });
      const days = Math.floor(hours / 24);
      if (days < 30) return tr('age.days', { n: days });
      const months = Math.floor(days / 30);
      if (months < 12) return tr('age.months', { n: months });
      return tr('age.years', { n: Math.floor(months / 12) });
    }

    function formatCountdown(ms) {
      const total = Math.max(0, Math.ceil(ms / 1000));
      const minutes = Math.floor(total / 60);
      const seconds = total % 60;
      return String(minutes) + ':' + pad2(seconds);
    }

    function formatUptime(ms, tr) {
      const total = Math.max(0, Math.floor((typeof ms === 'number' && isFinite(ms) ? ms : 0) / 1000));
      const hours = Math.floor(total / 3600);
      const minutes = Math.floor((total % 3600) / 60);
      const seconds = total % 60;
      if (hours > 0) return String(hours) + ' ' + tr('unit.h') + ' ' + pad2(minutes) + ' ' + tr('unit.m');
      if (minutes > 0) return String(minutes) + ' ' + tr('unit.m') + ' ' + pad2(seconds) + ' ' + tr('unit.s');
      return String(seconds) + ' ' + tr('unit.s');
    }

    function statusLabel(tr, state) {
      if (state === 'online') return tr('state.online');
      if (state === 'booting') return tr('state.booting');
      if (state === 'stopping') return tr('state.stopping');
      if (state === 'error') return tr('state.error');
      return tr('state.off');
    }

    function tailText(text, maxLines) {
      const value = typeof text === 'string' ? text : '';
      if (value === '') return '';
      const lines = value.split(/\r?\n/);
      return lines.slice(-maxLines).join('\n');
    }

    function errorText(error, tr) {
      if (typeof error === 'string' && error !== '') return error;
      if (error && typeof error.message === 'string' && error.message !== '') return error.message;
      return tr('err.unknown');
    }

    function screenshotStamp() {
      return new Date().toISOString().replace(/[:.]/g, '-');
    }

    /** Sort newest first and split into `group` buckets; newest item is first. */
    function groupGames(games) {
      const source = Array.isArray(games) ? games.slice() : [];
      source.sort((left, right) => {
        const a = left && typeof left.mtimeMs === 'number' ? left.mtimeMs : 0;
        const b = right && typeof right.mtimeMs === 'number' ? right.mtimeMs : 0;
        return b - a;
      });
      const order = [];
      const buckets = {};
      for (let i = 0; i < source.length; i += 1) {
        const game = source[i] || {};
        const key = game.group ? 'group:' + String(game.group) : 'id:' + String(game.id || i);
        if (!buckets[key]) {
          buckets[key] = [];
          order.push(key);
        }
        buckets[key].push(game);
      }
      const groups = [];
      for (let i = 0; i < order.length; i += 1) {
        groups.push({ key: order[i], items: buckets[order[i]] });
      }
      return groups;
    }

    function filterGames(games, needle) {
      const source = Array.isArray(games) ? games : [];
      if (!needle) return source;
      const matches = [];
      for (let i = 0; i < source.length; i += 1) {
        const game = source[i] || {};
        const haystack = [game.fileName, game.label, game.group, game.dir, game.packageName]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (haystack.indexOf(needle) !== -1) matches.push(game);
      }
      return matches;
    }

    /** Flatten groups into render entries, honouring the per-group expander. */
    function libraryEntries(groups, expanded) {
      const entries = [];
      for (let i = 0; i < groups.length; i += 1) {
        const group = groups[i];
        const items = group.items;
        entries.push({ kind: 'game', key: 'g:' + group.key, game: items[0], old: false });
        if (items.length > 1) {
          const open = Boolean(expanded && expanded[group.key]);
          entries.push({ kind: 'expander', key: 'x:' + group.key, groupKey: group.key, count: items.length - 1, open });
          if (open) {
            for (let j = 1; j < items.length; j += 1) {
              entries.push({ kind: 'game', key: 'o:' + group.key + ':' + String(j), game: items[j], old: true });
            }
          }
        }
      }
      return entries;
    }

    /** Normalise a client point into 0..1 of the displayed (letterboxed) frame. */
    function resolveScreenPoint(element, clientX, clientY, resolution) {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      if (!rect || rect.width <= 0 || rect.height <= 0) return null;
      const width = resolution && resolution.width > 0 ? resolution.width : DEFAULT_RESOLUTION.width;
      const height = resolution && resolution.height > 0 ? resolution.height : DEFAULT_RESOLUTION.height;
      const scale = Math.min(rect.width / width, rect.height / height);
      if (!(scale > 0)) return null;
      const contentWidth = width * scale;
      const contentHeight = height * scale;
      const left = rect.left + (rect.width - contentWidth) / 2;
      const top = rect.top + (rect.height - contentHeight) / 2;
      return {
        x: clamp01((clientX - left) / contentWidth),
        y: clamp01((clientY - top) / contentHeight),
      };
    }

    /* ------------------------------------------------------------------ */
    /* Icons (inline SVG only)                                             */
    /* ------------------------------------------------------------------ */

    function IconBase(props) {
      const size = props.size || 16;
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 16 16',
          fill: props.fill || 'none',
          stroke: 'currentColor',
          strokeWidth: props.strokeWidth || 1.5,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
          focusable: false,
        },
        props.children,
      );
    }

    const IconPlay = (props) =>
      h(IconBase, { size: props.size, fill: 'currentColor', strokeWidth: 0 }, h('path', { d: 'M5.2 3.4 12.6 8l-7.4 4.6z' }));

    const IconStop = (props) =>
      h(IconBase, { size: props.size, fill: 'currentColor', strokeWidth: 0 }, h('rect', { x: 4.4, y: 4.4, width: 7.2, height: 7.2, rx: 1 }));

    const IconBack = (props) => h(IconBase, { size: props.size }, h('path', { d: 'M9.8 3.4 5.4 8l4.4 4.6' }));

    const IconHome = (props) =>
      h(
        IconBase,
        { size: props.size },
        h('path', { d: 'M3.2 7.4 8 3.2l4.8 4.2' }),
        h('path', { d: 'M4.6 6.8v6h6.8v-6' }),
      );

    const IconRecents = (props) =>
      h(
        IconBase,
        { size: props.size },
        h('rect', { x: 3, y: 3, width: 8.2, height: 8.2, rx: 1.6 }),
        h('path', { d: 'M6.2 13.2h5.2a1.6 1.6 0 0 0 1.6-1.6V6.4' }),
      );

    const IconRotate = (props) =>
      h(
        IconBase,
        { size: props.size },
        h('path', { d: 'M12.9 6.6A5 5 0 1 0 13 9.4' }),
        h('path', { d: 'M13.2 2.9v3.9h-3.9' }),
      );

    const IconCamera = (props) =>
      h(
        IconBase,
        { size: props.size },
        h('path', { d: 'M2.6 5.4h2.2l1.1-1.7h4.2l1.1 1.7h2.2v7.6H2.6z' }),
        h('circle', { cx: 8, cy: 8.9, r: 2.2 }),
      );

    const IconReload = (props) =>
      h(
        IconBase,
        { size: props.size },
        h('path', { d: 'M3.1 6.6A5 5 0 1 1 3 9.4' }),
        h('path', { d: 'M2.8 2.9v3.9h3.9' }),
      );

    const IconRefresh = (props) =>
      h(
        IconBase,
        { size: props.size },
        h('path', { d: 'M13.2 8a5.2 5.2 0 1 1-1.5-3.7' }),
        h('path', { d: 'M13.4 2.8v3.6H9.8' }),
      );

    const IconSearch = (props) =>
      h(IconBase, { size: props.size }, h('circle', { cx: 7.2, cy: 7.2, r: 3.9 }), h('path', { d: 'm10.2 10.2 3 3' }));

    const IconClose = (props) =>
      h(IconBase, { size: props.size }, h('path', { d: 'M4.4 4.4 11.6 11.6' }), h('path', { d: 'M11.6 4.4 4.4 11.6' }));

    const IconChevron = (props) => h(IconBase, { size: props.size }, h('path', { d: 'M6.2 3.6 10.6 8l-4.4 4.4' }));

    const IconGamepad = (props) => {
      const size = props.size || 20;
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 20 20',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
          focusable: false,
        },
        h('rect', { x: 1.9, y: 5.2, width: 16.2, height: 9.6, rx: 4.8 }),
        h('path', { d: 'M5.9 8.3v3.4' }),
        h('path', { d: 'M4.2 10h3.4' }),
        h('circle', { cx: 13.5, cy: 9.1, r: 0.85, fill: 'currentColor', stroke: 'none' }),
        h('circle', { cx: 15.2, cy: 11, r: 0.85, fill: 'currentColor', stroke: 'none' }),
      );
    };

    function PanelIcon({ size = 20, active = false }) {
      const stroke = active ? 'var(--dsw-alias-brand-primary)' : 'currentColor';
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 20 20',
          fill: 'none',
          stroke,
          strokeWidth: 1.5,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
          focusable: false,
        },
        h('rect', { x: 1.9, y: 5.2, width: 16.2, height: 9.6, rx: 4.8 }),
        h('path', { d: 'M5.9 8.3v3.4' }),
        h('path', { d: 'M4.2 10h3.4' }),
        h('circle', { cx: 13.5, cy: 9.1, r: 0.85, fill: stroke, stroke: 'none' }),
        h('circle', { cx: 15.2, cy: 11, r: 0.85, fill: stroke, stroke: 'none' }),
      );
    }

    /* ------------------------------------------------------------------ */
    /* Styles (one data-plugin style tag, theme tokens only)               */
    /* ------------------------------------------------------------------ */

    const CSS = `
/* Game Lab page. Prefix: gl- . Colors are --dsw-alias-* tokens only. */
.gl-root { display:flex; flex-direction:column; height:100%; min-height:0; width:100%; overflow:hidden;
  background:var(--dsw-alias-bg-base); color:var(--dsw-alias-label-primary); font-family:inherit;
  font-size:13px; line-height:1.45; }
.gl-root *, .gl-root *::before, .gl-root *::after { box-sizing:border-box; }
.gl-root button { font:inherit; }
.gl-root input { font:inherit; }
.gl-root pre { margin:0; }

/* header */
.gl-head { flex:none; padding:20px 32px 14px;
  background:linear-gradient(180deg, var(--dsw-specific-sidebar-fill), var(--dsw-alias-bg-base));
  border-bottom:1px solid var(--dsw-alias-border-l1); }
.gl-head-row { display:flex; align-items:flex-end; justify-content:space-between; gap:20px; flex-wrap:wrap; }
.gl-head-main { min-width:0; }
.gl-eyebrow { display:inline-flex; align-items:center; gap:7px; margin-bottom:6px; font-size:10.5px;
  letter-spacing:.14em; text-transform:uppercase; color:var(--dsw-alias-label-secondary); }
.gl-eyebrow-dot { width:5px; height:5px; border-radius:50%; flex:none; background:var(--dsw-alias-brand-primary); }
.gl-title { margin:0; font-size:23px; font-weight:600; line-height:1.15; letter-spacing:-.02em; }
.gl-subtitle { margin:5px 0 0; max-width:560px; font-size:12.5px; color:var(--dsw-alias-label-secondary); }
.gl-head-actions { display:flex; align-items:center; gap:9px; flex-wrap:wrap; justify-content:flex-end; }

/* status pill */
.gl-pill { display:inline-flex; align-items:center; gap:7px; height:28px; padding:0 11px;
  border:1px solid var(--dsw-alias-border-l1); border-radius:999px;
  background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-secondary);
  font-size:11.5px; font-weight:500; white-space:nowrap; }
.gl-pill-dot { width:7px; height:7px; border-radius:50%; flex:none; background:var(--dsw-alias-state-idle-primary); }
.gl-pill[data-state='online'] { border-color:var(--dsw-alias-state-success-primary);
  color:var(--dsw-alias-state-success-primary); }
.gl-pill[data-state='online'] .gl-pill-dot { background:var(--dsw-alias-state-success-primary);
  animation:gl-pulse 2s ease-in-out infinite; }
.gl-pill[data-state='booting'] { border-color:var(--dsw-alias-state-warn-primary);
  color:var(--dsw-alias-state-warn-primary); }
.gl-pill[data-state='booting'] .gl-pill-dot { background:var(--dsw-alias-state-warn-primary);
  animation:gl-pulse 1.2s ease-in-out infinite; }
.gl-pill[data-state='stopping'] { border-color:var(--dsw-alias-state-warn-primary);
  color:var(--dsw-alias-state-warn-primary); }
.gl-pill[data-state='stopping'] .gl-pill-dot { background:var(--dsw-alias-state-warn-primary); }
.gl-pill[data-state='error'] { border-color:var(--dsw-alias-state-error-primary);
  color:var(--dsw-alias-state-error-primary); }
.gl-pill[data-state='error'] .gl-pill-dot { background:var(--dsw-alias-state-error-primary); }
.gl-conn { display:inline-flex; align-items:center; gap:5px; font-size:11px;
  color:var(--dsw-alias-state-error-primary); }
.gl-conn-dot { width:6px; height:6px; border-radius:50%; flex:none;
  background:var(--dsw-alias-state-error-primary); }

/* buttons + spinner */
.gl-btn { display:inline-flex; align-items:center; justify-content:center; gap:6px; height:30px;
  padding:0 12px; border:1px solid var(--dsw-alias-border-l2); border-radius:7px; background:transparent;
  color:var(--dsw-alias-label-secondary); font-size:12px; white-space:nowrap; cursor:pointer;
  transition:background .15s ease, border-color .15s ease, color .15s ease; }
.gl-btn:hover:not(:disabled) { background:var(--dsw-alias-bg-layer-2);
  border-color:var(--dsw-alias-border-l2); color:var(--dsw-alias-label-primary); }
.gl-btn:disabled { opacity:.45; cursor:not-allowed; }
.gl-btn-primary { border-color:var(--dsw-alias-brand-primary); color:var(--dsw-alias-brand-primary); }
.gl-btn-primary:hover:not(:disabled) { background:var(--dsw-alias-bg-layer-2);
  border-color:var(--dsw-alias-brand-primary); color:var(--dsw-alias-brand-primary); }
.gl-iconbtn { display:inline-flex; align-items:center; justify-content:center; width:26px; height:26px;
  padding:0; border:1px solid transparent; border-radius:6px; background:transparent;
  color:var(--dsw-alias-label-secondary); cursor:pointer; }
.gl-iconbtn:hover:not(:disabled) { background:var(--dsw-alias-bg-layer-2);
  color:var(--dsw-alias-label-primary); }
.gl-iconbtn:disabled { opacity:.4; cursor:not-allowed; }
.gl-btn:focus-visible, .gl-iconbtn:focus-visible, .gl-tool:focus-visible, .gl-play:focus-visible,
.gl-expander:focus-visible, .gl-showmore:focus-visible, .gl-banner-x:focus-visible {
  outline:2px solid var(--dsw-alias-brand-primary); outline-offset:1px; }
.gl-spin { display:inline-block; width:12px; height:12px; flex:none; border-radius:50%;
  border:1.5px solid var(--dsw-alias-border-l2); border-top-color:var(--dsw-alias-brand-primary);
  animation:gl-rot .8s linear infinite; }
.gl-spin-lg { width:20px; height:20px; border-width:2px; }

/* boot progress */
.gl-progress { max-width:560px; margin-top:12px; }
.gl-progress-top { display:flex; align-items:baseline; justify-content:space-between; gap:12px;
  margin-bottom:5px; font-size:11px; color:var(--dsw-alias-label-secondary); }
.gl-track { height:5px; border-radius:999px; border:1px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-layer-2); overflow:hidden; }
.gl-fill { height:100%; border-radius:999px; background:var(--dsw-alias-brand-primary);
  transition:width .4s ease; }

/* body + grid */
.gl-body { flex:1 1 auto; min-height:0; overflow-y:auto; overflow-x:hidden; padding:16px 32px 26px;
  scrollbar-width:thin; scrollbar-color:var(--dsw-alias-border-l2) transparent; }
.gl-body::-webkit-scrollbar { width:10px; }
.gl-body::-webkit-scrollbar-thumb { background:var(--dsw-alias-border-l1); border-radius:5px; }
.gl-grid { display:grid; grid-template-columns:272px minmax(0,1fr) 268px; gap:16px;
  max-width:1480px; margin:0 auto; align-items:start; }
.gl-col { display:flex; flex-direction:column; gap:16px; min-width:0; }
.gl-col-left { grid-column:1; }
.gl-col-center { grid-column:2; }
.gl-col-right { grid-column:3; }

/* banner */
.gl-banner { display:flex; align-items:flex-start; gap:9px; max-width:1480px; margin:0 auto 14px;
  padding:10px 12px; border:1px solid var(--dsw-alias-border-l2); border-radius:9px;
  background:var(--dsw-alias-bg-layer-2); font-size:12px; line-height:1.45; }
.gl-banner[data-tone='error'] { border-color:var(--dsw-alias-state-error-primary); }
.gl-banner[data-tone='success'] { border-color:var(--dsw-alias-state-success-primary); }
.gl-banner-dot { width:7px; height:7px; border-radius:50%; margin-top:4px; flex:none;
  background:var(--dsw-alias-brand-primary); }
.gl-banner[data-tone='error'] .gl-banner-dot { background:var(--dsw-alias-state-error-primary); }
.gl-banner[data-tone='success'] .gl-banner-dot { background:var(--dsw-alias-state-success-primary); }
.gl-banner-text { flex:1; min-width:0; color:var(--dsw-alias-label-primary); overflow-wrap:anywhere; }
.gl-banner-x { display:inline-flex; align-items:center; justify-content:center; width:22px; height:22px;
  flex:none; border:none; border-radius:5px; background:transparent;
  color:var(--dsw-alias-label-secondary); cursor:pointer; }
.gl-banner-x:hover { background:var(--dsw-alias-bg-overlay); color:var(--dsw-alias-label-primary); }

/* cards */
.gl-card { display:flex; flex-direction:column; min-width:0; overflow:hidden;
  border:1px solid var(--dsw-alias-border-l1); border-radius:12px; background:var(--dsw-alias-bg-layer-1); }
.gl-card-head { display:flex; align-items:center; gap:8px; padding:10px 13px;
  border-bottom:1px solid var(--dsw-alias-border-l1); background:var(--dsw-alias-bg-layer-2); }
.gl-card-title { font-size:12.5px; font-weight:600; white-space:nowrap;
  color:var(--dsw-alias-label-primary); }
.gl-card-sub { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  font-size:11px; color:var(--dsw-alias-label-secondary); }
.gl-push { margin-left:auto; }
.gl-count { display:inline-flex; align-items:center; justify-content:center; height:17px; min-width:17px;
  padding:0 5px; border:1px solid var(--dsw-alias-border-l1); border-radius:999px;
  background:var(--dsw-alias-bg-base); color:var(--dsw-alias-label-secondary); font-size:10px;
  font-variant-numeric:tabular-nums; }
.gl-card-body { min-width:0; padding:11px 13px 13px; }

/* library */
.gl-search { display:flex; align-items:center; gap:7px; height:30px; margin-bottom:9px;
  padding:0 9px; border:1px solid var(--dsw-alias-border-l1); border-radius:8px;
  background:var(--dsw-alias-bg-base); }
.gl-search:focus-within { border-color:var(--dsw-alias-brand-primary); }
.gl-search-icon { display:inline-flex; flex:none; color:var(--dsw-alias-label-secondary); }
.gl-search input { flex:1; min-width:0; height:100%; border:none; outline:none;
  background:transparent; color:var(--dsw-alias-label-primary); font-size:12.5px; }
.gl-search input::placeholder { color:var(--dsw-alias-label-secondary); opacity:.8; }
.gl-list { display:flex; flex-direction:column; gap:1px; min-width:0; }
.gl-grow { display:flex; align-items:center; gap:9px; min-width:0; padding:7px 8px;
  border:1px solid transparent; border-radius:8px; }
.gl-grow:hover { background:var(--dsw-alias-bg-layer-2); border-color:var(--dsw-alias-border-l1); }
.gl-grow[data-old='true'] { margin-left:10px; padding-left:9px; opacity:.85;
  border-left:2px solid var(--dsw-alias-border-l1); border-radius:0 8px 8px 0; }
.gl-glyph { display:inline-flex; align-items:center; justify-content:center; width:29px; height:29px;
  flex:none; border:1px solid var(--dsw-alias-border-l1); border-radius:8px;
  background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-brand-primary); }
.gl-grow-main { display:flex; flex-direction:column; gap:2px; flex:1; min-width:0; }
.gl-gname { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:12.5px;
  font-weight:500; color:var(--dsw-alias-label-primary); }
.gl-gmeta { display:flex; align-items:center; gap:5px; overflow:hidden; white-space:nowrap;
  font-size:10.5px; color:var(--dsw-alias-label-secondary); }
.gl-sep { color:var(--dsw-alias-border-l2); }
.gl-chip { display:inline-flex; align-items:center; max-width:96px; height:15px; padding:0 5px;
  overflow:hidden; text-overflow:ellipsis; border:1px solid var(--dsw-alias-border-l1);
  border-radius:4px; background:var(--dsw-alias-bg-base); color:var(--dsw-alias-label-secondary);
  font-size:9.5px; letter-spacing:.04em; text-transform:uppercase; white-space:nowrap; }
.gl-chip[data-tone='brand'] { border-color:var(--dsw-alias-brand-primary);
  background:transparent; color:var(--dsw-alias-brand-primary); }
.gl-play { display:inline-flex; align-items:center; justify-content:center; gap:5px; height:26px;
  padding:0 9px; flex:none; border:1px solid var(--dsw-alias-border-l2); border-radius:7px;
  background:transparent; color:var(--dsw-alias-label-secondary); font-size:11.5px; cursor:pointer; }
.gl-play:hover:not(:disabled) { background:var(--dsw-alias-bg-layer-2);
  border-color:var(--dsw-alias-brand-primary); color:var(--dsw-alias-brand-primary); }
.gl-play:disabled { opacity:.45; cursor:not-allowed; }
.gl-play[data-busy='true'] { border-color:var(--dsw-alias-brand-primary);
  color:var(--dsw-alias-brand-primary); }
.gl-expander { display:flex; align-items:center; gap:5px; width:calc(100% - 10px);
  margin:1px 0 1px 10px; padding:4px 8px; border:none; border-radius:6px; background:transparent;
  color:var(--dsw-alias-label-secondary); font-size:10.5px; text-align:left; cursor:pointer; }
.gl-expander:hover { background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-primary); }
.gl-chev { display:inline-flex; transition:transform .15s ease; }
.gl-chev[data-open='true'] { transform:rotate(90deg); }
.gl-showmore { display:block; width:100%; margin-top:7px; padding:6px;
  border:1px dashed var(--dsw-alias-border-l2); border-radius:7px; background:transparent;
  color:var(--dsw-alias-label-secondary); font-size:11px; cursor:pointer; }
.gl-showmore:hover:not(:disabled) { background:var(--dsw-alias-bg-layer-2);
  color:var(--dsw-alias-label-primary); }
.gl-empty { padding:16px 12px; border:1px dashed var(--dsw-alias-border-l2); border-radius:9px;
  background:var(--dsw-alias-bg-base); text-align:center; }
.gl-empty-title { margin-bottom:4px; font-size:12.5px; font-weight:600;
  color:var(--dsw-alias-label-primary); }
.gl-empty-body { font-size:11.5px; line-height:1.5; color:var(--dsw-alias-label-secondary); }
.gl-empty-roots { display:flex; flex-direction:column; gap:3px; margin-top:9px; padding-top:8px;
  border-top:1px solid var(--dsw-alias-border-l1); text-align:left; }
.gl-rootpath { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:10.5px;
  color:var(--dsw-alias-label-secondary); }
.gl-note { margin-top:8px; font-size:10.5px; line-height:1.5; color:var(--dsw-alias-label-secondary); }
.gl-mono { font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }

/* projects */
.gl-prow { display:flex; align-items:center; gap:9px; padding:7px 8px;
  border:1px solid transparent; border-radius:8px; }
.gl-prow:hover { background:var(--dsw-alias-bg-layer-2); border-color:var(--dsw-alias-border-l1); }
.gl-prow-main { display:flex; flex-direction:column; gap:1px; flex:1; min-width:0; }
.gl-pname { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:12.5px;
  font-weight:500; color:var(--dsw-alias-label-primary); }
.gl-ppath { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:10px;
  color:var(--dsw-alias-label-secondary); }
.gl-buildbox { margin-top:9px; padding:8px 9px; border:1px solid var(--dsw-alias-border-l1);
  border-radius:8px; background:var(--dsw-alias-bg-layer-2); }
.gl-buildbox[data-tone='error'] { border-color:var(--dsw-alias-state-error-primary); }
.gl-buildbox-title { margin-bottom:5px; font-size:10.5px; letter-spacing:.04em;
  text-transform:uppercase; color:var(--dsw-alias-label-secondary); }
.gl-buildlog, .gl-logs { max-height:180px; overflow:auto; padding:8px 9px;
  border:1px solid var(--dsw-alias-border-l1); border-radius:7px; background:var(--dsw-alias-bg-base);
  color:var(--dsw-alias-label-secondary);
  font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size:10.5px; line-height:1.5; white-space:pre-wrap; overflow-wrap:anywhere; }
.gl-logs { background:var(--dsw-alias-bg-layer-2); }

/* device */
.gl-device-card { min-width:0; }
.gl-stage { display:flex; align-items:center; justify-content:center; min-height:300px; padding:18px;
  background:radial-gradient(120% 100% at 50% 0%, var(--dsw-alias-bg-layer-2),
  var(--dsw-alias-bg-base)); }
.gl-phone { display:flex; flex-direction:column; padding:9px; border:1px solid var(--dsw-alias-border-l2);
  border-radius:26px; background:var(--dsw-alias-bg-overlay);
  box-shadow:0 22px 55px var(--dsw-alias-bg-overlay); }
.gl-phone[data-orient='portrait'] { height:min(54vh, 540px); aspect-ratio:var(--gl-ar); }
.gl-phone[data-orient='landscape'] { width:100%; aspect-ratio:var(--gl-ar); }
.gl-screen { position:relative; flex:1 1 auto; min-height:0; border-radius:18px; overflow:hidden;
  background:var(--dsw-alias-bg-base); touch-action:none; user-select:none; -webkit-user-select:none; }
.gl-screen[data-online='true'] { cursor:crosshair; }
.gl-screen-img { position:absolute; inset:0; width:100%; height:100%; object-fit:contain;
  display:block; }
.gl-skeleton { position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
  background:linear-gradient(100deg, var(--dsw-alias-bg-layer-1) 30%,
  var(--dsw-alias-bg-layer-2) 50%, var(--dsw-alias-bg-layer-1) 70%);
  background-size:220% 100%; animation:gl-shimmer 1.8s linear infinite; }
.gl-skel-inner { display:flex; flex-direction:column; align-items:center; gap:9px;
  padding:0 14px; text-align:center; }
.gl-skel-text { font-size:11px; color:var(--dsw-alias-label-secondary); }
.gl-streamfail { position:absolute; left:50%; bottom:12px; transform:translateX(-50%);
  display:inline-flex; align-items:center; gap:6px; padding:6px 10px;
  border:1px solid var(--dsw-alias-border-l2); border-radius:999px;
  background:var(--dsw-alias-bg-overlay); color:var(--dsw-alias-label-primary);
  font-size:11px; white-space:nowrap; }
.gl-offline { display:flex; flex-direction:column; align-items:center; max-width:380px;
  padding:22px 18px; text-align:center; }
.gl-offline-glyph { display:flex; align-items:center; justify-content:center; width:54px; height:54px;
  margin-bottom:12px; border:1px solid var(--dsw-alias-border-l2); border-radius:16px;
  background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-brand-primary); }
.gl-offline-title { font-size:15px; font-weight:600; color:var(--dsw-alias-label-primary); }
.gl-offline-body { margin-top:6px; font-size:12px; line-height:1.5;
  color:var(--dsw-alias-label-secondary); }
.gl-offline-error { margin-top:9px; padding:6px 9px; text-align:left; overflow-wrap:anywhere;
  border:1px solid var(--dsw-alias-state-error-primary); border-radius:7px; font-size:10.5px;
  line-height:1.45; color:var(--dsw-alias-state-error-primary); }
.gl-offline .gl-btn { margin-top:14px; height:32px; padding:0 14px; }
.gl-offline-note { margin-top:12px; font-size:10.5px; line-height:1.5;
  color:var(--dsw-alias-label-secondary); }
.gl-toolbar { display:flex; flex-wrap:wrap; align-items:center; gap:5px; padding:9px 12px;
  border-top:1px solid var(--dsw-alias-border-l1); background:var(--dsw-alias-bg-layer-1); }
.gl-tool { display:inline-flex; align-items:center; gap:4px; height:26px; padding:0 8px;
  border:1px solid var(--dsw-alias-border-l1); border-radius:6px; background:transparent;
  color:var(--dsw-alias-label-secondary); font-size:11px; white-space:nowrap; cursor:pointer; }
.gl-tool:hover:not(:disabled) { background:var(--dsw-alias-bg-layer-2);
  border-color:var(--dsw-alias-border-l2); color:var(--dsw-alias-label-primary); }
.gl-tool:disabled { opacity:.4; cursor:not-allowed; }
.gl-toolbar-sep { width:1px; height:16px; margin:0 3px; background:var(--dsw-alias-border-l1); }
.gl-toolbar-hint { margin-left:auto; padding-left:8px; font-size:10.5px;
  color:var(--dsw-alias-label-secondary); white-space:nowrap; }

/* runtime readouts */
.gl-kv { display:flex; align-items:baseline; justify-content:space-between; gap:12px;
  min-width:0; padding:6px 0; }
.gl-kv + .gl-kv { border-top:1px solid var(--dsw-alias-border-l1); }
.gl-kv-key { flex:none; font-size:11px; color:var(--dsw-alias-label-secondary); }
.gl-kv-val { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  text-align:right; font-size:11.5px; color:var(--dsw-alias-label-primary);
  font-variant-numeric:tabular-nums; }
.gl-kv-val[data-warn='true'] { color:var(--dsw-alias-state-warn-primary); }
.gl-kv-val[data-tone='ok'] { color:var(--dsw-alias-state-success-primary); }
.gl-kv-val[data-tone='bad'] { color:var(--dsw-alias-state-error-primary); }
.gl-num { font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-variant-numeric:tabular-nums; }
.gl-roots { display:flex; flex-direction:column; gap:4px; margin-top:8px; }
.gl-logmeta { margin-top:8px; font-size:10.5px; color:var(--dsw-alias-label-secondary); }
.gl-inline-error { margin-top:8px; padding:7px 9px; overflow-wrap:anywhere;
  border:1px solid var(--dsw-alias-state-error-primary); border-radius:7px; font-size:10.5px;
  line-height:1.45; color:var(--dsw-alias-state-error-primary); }

/* footer */
.gl-foot { flex:none; display:flex; align-items:center; gap:7px; padding:7px 32px;
  overflow:hidden; border-top:1px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-label-secondary);
  font-size:10.5px; white-space:nowrap; }
.gl-foot-dot { width:5px; height:5px; border-radius:50%; flex:none;
  background:var(--dsw-alias-state-idle-primary); }
.gl-foot[data-online='true'] .gl-foot-dot { background:var(--dsw-alias-state-success-primary); }

/* responsive */
@media (max-width: 1240px) {
  .gl-head { padding:18px 24px 13px; }
  .gl-body { padding:16px 24px 24px; }
  .gl-grid { grid-template-columns:250px minmax(0,1fr); }
  .gl-col-left { grid-column:1; }
  .gl-col-center { grid-column:2; }
  .gl-col-right { grid-column:1 / -1; display:grid;
    grid-template-columns:repeat(3, minmax(0, 1fr)); gap:16px; }
  .gl-phone[data-orient='portrait'] { height:min(50vh, 480px); }
}
@media (max-width: 920px) {
  .gl-grid { grid-template-columns:minmax(0, 1fr); }
  .gl-col-left, .gl-col-center, .gl-col-right { grid-column:auto; }
  .gl-col-center { order:0; }
  .gl-col-left { order:1; }
  .gl-col-right { order:2; display:flex; flex-direction:column; gap:16px; }
  .gl-phone[data-orient='portrait'] { height:min(58vh, 520px); }
}
@media (max-width: 640px) {
  .gl-head { padding:15px 15px 12px; }
  .gl-body { padding:13px 15px 20px; }
  .gl-foot { padding:7px 15px; }
  .gl-title { font-size:20px; }
  .gl-subtitle { display:none; }
  .gl-head-actions { width:100%; justify-content:space-between; }
  .gl-tool-label { display:none; }
  .gl-toolbar-hint { display:none; }
  .gl-phone[data-orient='portrait'] { height:min(52vh, 430px); }
}
@media (prefers-reduced-motion: reduce) {
  .gl-pill-dot, .gl-skeleton { animation:none; }
  .gl-fill, .gl-chev { transition:none; }
}

@keyframes gl-rot { to { transform:rotate(360deg); } }
@keyframes gl-pulse { 0%, 100% { opacity:1; } 50% { opacity:.35; } }
@keyframes gl-shimmer { 0% { background-position:120% 0; } 100% { background-position:-120% 0; } }
`;

    /* ------------------------------------------------------------------ */
    /* Shared small components                                             */
    /* ------------------------------------------------------------------ */

    function StatusPill({ tr, state }) {
      const known =
        state === 'booting' || state === 'online' || state === 'stopping' || state === 'error'
          ? state
          : 'off';
      return h(
        'span',
        { className: 'gl-pill', 'data-state': known, role: 'status', 'aria-live': 'polite' },
        h('span', { className: 'gl-pill-dot', 'aria-hidden': true }),
        h('span', { className: 'gl-pill-label' }, statusLabel(tr, known)),
      );
    }

    function BootProgress({ tr, emulator, bootElapsedMs }) {
      const raw = emulator && typeof emulator.progress === 'number' ? emulator.progress : 0;
      const progress = Math.max(0, Math.min(1, isFinite(raw) ? raw : 0));
      const percent = Math.round(progress * 100);
      let elapsed = typeof bootElapsedMs === 'number' && isFinite(bootElapsedMs) ? bootElapsedMs : null;
      if (elapsed === null && emulator && typeof emulator.bootElapsedMs === 'number') {
        elapsed = emulator.bootElapsedMs;
      }
      const seconds = elapsed === null ? null : Math.max(0, Math.floor(elapsed / 1000));
      const label = tr('boot.label') + (seconds === null ? '' : ' ' + tr('boot.elapsed', { n: seconds }));
      return h(
        'div',
        { className: 'gl-progress' },
        h(
          'div',
          { className: 'gl-progress-top' },
          h('span', null, label),
          h('span', { className: 'gl-num' }, String(percent) + '%'),
        ),
        h(
          'div',
          {
            className: 'gl-track',
            role: 'progressbar',
            'aria-label': tr('boot.label'),
            'aria-valuemin': 0,
            'aria-valuemax': 100,
            'aria-valuenow': percent,
          },
          h('div', { className: 'gl-fill', style: { width: String(percent) + '%' } }),
        ),
      );
    }

    function BannerView({ tr, banner, onDismiss }) {
      return h(
        'div',
        {
          className: 'gl-banner',
          'data-tone': banner.kind || 'info',
          role: banner.kind === 'error' ? 'alert' : 'status',
        },
        h('span', { className: 'gl-banner-dot', 'aria-hidden': true }),
        h('span', { className: 'gl-banner-text' }, banner.text),
        h(
          'button',
          {
            type: 'button',
            className: 'gl-banner-x',
            'aria-label': tr('banner.dismiss'),
            title: tr('banner.dismiss'),
            onClick: onDismiss,
          },
          h(IconClose, { size: 12 }),
        ),
      );
    }

    function Toolbar({ tr, online, orientation, onKey, onRotate, onScreenshot, onReload }) {
      const rotateTo = tr(orientation === 'portrait' ? 'device.landscape' : 'device.portrait');
      const rotateLabel = tr('device.rotateTo', { value: rotateTo });
      const tool = (key, label, icon, onClick, title) =>
        h(
          'button',
          {
            key,
            type: 'button',
            className: 'gl-tool',
            disabled: !online,
            'aria-label': title || label,
            title: title || label,
            onClick,
          },
          icon,
          h('span', { className: 'gl-tool-label' }, label),
        );
      return h(
        'div',
        { className: 'gl-toolbar', role: 'toolbar', 'aria-label': tr('device.title') },
        tool('back', tr('device.back'), h(IconBack, { size: 14 }), () => onKey('back')),
        tool('home', tr('device.home'), h(IconHome, { size: 14 }), () => onKey('home')),
        tool('recents', tr('device.recents'), h(IconRecents, { size: 14 }), () => onKey('recents')),
        h('span', { key: 'sep-1', className: 'gl-toolbar-sep', 'aria-hidden': true }),
        tool(
          'rotate',
          tr('device.rotate'),
          h(IconRotate, { size: 14 }),
          onRotate,
          rotateLabel,
        ),
        h('span', { key: 'sep-2', className: 'gl-toolbar-sep', 'aria-hidden': true }),
        tool('shot', tr('device.screenshot'), h(IconCamera, { size: 14 }), onScreenshot),
        tool('reload', tr('device.reload'), h(IconReload, { size: 14 }), onReload),
        h('span', { key: 'hint', className: 'gl-toolbar-hint' }, tr('device.tapHint')),
      );
    }

    function DeviceOffline({ tr, emulator, config, busy, statusError, onStart }) {
      const idleMinutes =
        config && typeof config.idleMinutes === 'number' ? config.idleMinutes : DEFAULT_IDLE_MINUTES;
      const error = emulator && emulator.error ? String(emulator.error) : statusError;
      return h(
        'div',
        { className: 'gl-offline' },
        h('div', { className: 'gl-offline-glyph', 'aria-hidden': true }, h(IconGamepad, { size: 26 })),
        h('div', { className: 'gl-offline-title' }, tr('device.offTitle')),
        h('div', { className: 'gl-offline-body' }, tr('device.offBody')),
        error ? h('div', { className: 'gl-offline-error' }, error) : null,
        h(
          'button',
          {
            type: 'button',
            className: 'gl-btn gl-btn-primary',
            disabled: Boolean(busy),
            'aria-label': tr('device.start'),
            title: tr('device.start'),
            onClick: onStart,
          },
          busy ? h('span', { className: 'gl-spin', 'aria-hidden': true }) : h(IconPlay, { size: 13 }),
          h('span', null, busy ? tr('action.starting') : tr('device.start')),
        ),
        h('div', { className: 'gl-offline-note' }, tr('device.offNote', { n: idleMinutes })),
      );
    }

    function GameRow({ tr, game, old, now, installing, disabled, onPlay }) {
      const name = stripApk(game.fileName || tr('lib.title'));
      const age =
        typeof game.mtimeMs === 'number' && game.mtimeMs > 0
          ? formatAge(now - game.mtimeMs, tr)
          : tr('lib.unknownAge');
      return h(
        'div',
        { className: 'gl-grow', 'data-old': old ? 'true' : 'false' },
        h('span', { className: 'gl-glyph', 'aria-hidden': true }, h(IconGamepad, { size: 15 })),
        h(
          'div',
          { className: 'gl-grow-main' },
          h('span', { className: 'gl-gname', title: game.path || name }, name),
          h(
            'div',
            { className: 'gl-gmeta' },
            h('span', null, age),
            h('span', { className: 'gl-sep', 'aria-hidden': true }, '/'),
            h('span', { className: 'gl-num' }, formatBytes(game.sizeBytes, tr)),
            game.versionName ? h('span', { className: 'gl-chip', title: String(game.versionName) }, String(game.versionName)) : null,
            game.group ? h('span', { className: 'gl-chip', title: String(game.group) }, String(game.group)) : null,
            game.fromBuild ? h('span', { className: 'gl-chip', 'data-tone': 'brand' }, tr('lib.fromBuild')) : null,
          ),
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'gl-play',
            'data-busy': installing ? 'true' : 'false',
            disabled: installing || disabled,
            'aria-label': tr('lib.playGame', { name }),
            title: tr('lib.playGame', { name }),
            onClick: () => onPlay(game),
          },
          installing
            ? h('span', { className: 'gl-spin', 'aria-hidden': true })
            : h(IconPlay, { size: 11 }),
          h('span', { className: 'gl-play-label' }, installing ? tr('lib.installing') : tr('lib.play')),
        ),
      );
    }

    function LibraryCard(props) {
      const tr = props.tr;
      const [query, setQuery] = useState('');
      const [expanded, setExpanded] = useState({});
      const [limit, setLimit] = useState(LIB_PAGE_ROWS);
      const needle = query.trim().toLowerCase();
      const filtered = filterGames(props.games, needle);
      const groups = groupGames(filtered);
      const entries = libraryEntries(groups, expanded);
      const visible = entries.slice(0, limit);
      const remaining = entries.length - visible.length;
      const roots = Array.isArray(props.roots) ? props.roots : [];
      const installingKey = props.installingKey;
      const busy = installingKey !== null && installingKey !== undefined;

      let body = null;
      if (props.loading && filtered.length === 0) {
        body = h(
          'div',
          { className: 'gl-empty' },
          h('div', { className: 'gl-empty-body' }, h('span', { className: 'gl-spin' }), ' ' + tr('lib.scanning')),
        );
      } else if (props.error) {
        body = h(
          'div',
          { className: 'gl-empty' },
          h('div', { className: 'gl-empty-title' }, tr('lib.fail')),
          h('div', { className: 'gl-empty-body' }, String(props.error)),
          h(
            'button',
            {
              type: 'button',
              className: 'gl-showmore',
              style: { marginTop: '10px' },
              onClick: props.onRefresh,
            },
            tr('action.retry'),
          ),
        );
      } else if (filtered.length === 0) {
        body = h(
          'div',
          { className: 'gl-empty' },
          h(
            'div',
            { className: 'gl-empty-title' },
            needle ? tr('lib.noMatch') : tr('lib.emptyTitle'),
          ),
          needle
            ? null
            : h('div', { className: 'gl-empty-body' }, tr('lib.emptyBody')),
          needle ? null : h('div', { className: 'gl-empty-roots' },
            roots.map((root, index) =>
              h('span', { key: 'root:' + String(index), className: 'gl-rootpath gl-mono', title: root }, root),
            ),
          ),
          needle ? null : h('div', { className: 'gl-note' }, tr('lib.emptyHint')),
        );
      } else {
        const rows = [];
        for (let i = 0; i < visible.length; i += 1) {
          const entry = visible[i];
          if (entry.kind === 'expander') {
            rows.push(
              h(
                'button',
                {
                  key: entry.key,
                  type: 'button',
                  className: 'gl-expander',
                  'aria-expanded': entry.open ? 'true' : 'false',
                  onClick: () =>
                    setExpanded((previous) => {
                      const next = Object.assign({}, previous);
                      next[entry.groupKey] = !previous[entry.groupKey];
                      return next;
                    }),
                },
                h(
                  'span',
                  { className: 'gl-chev', 'data-open': entry.open ? 'true' : 'false', 'aria-hidden': true },
                  h(IconChevron, { size: 11 }),
                ),
                h('span', null, entry.open ? tr('lib.olderOpen') : tr('lib.older', { n: entry.count })),
              ),
            );
          } else {
            rows.push(
              h(GameRow, {
                key: entry.key,
                tr,
                game: entry.game,
                old: entry.old,
                now: props.now,
                installing: installingKey === gameKey(entry.game),
                disabled: busy,
                onPlay: props.onPlay,
              }),
            );
          }
        }
        const truncated = props.scan && props.scan.truncated === true;
        body = h(
          'div',
          null,
          h('div', { className: 'gl-list' }, rows),
          remaining > 0
            ? h(
                'button',
                {
                  type: 'button',
                  className: 'gl-showmore',
                  onClick: () => setLimit((previous) => previous + LIB_PAGE_ROWS),
                },
                tr('lib.showMore', { n: remaining }),
              )
            : null,
          truncated
            ? h('div', { className: 'gl-note' }, tr('lib.truncated', { n: filtered.length }))
            : null,
        );
      }

      return h(
        'section',
        { className: 'gl-card' },
        h(
          'div',
          { className: 'gl-card-head' },
          h('span', { className: 'gl-card-title' }, tr('lib.title')),
          h('span', { className: 'gl-count' }, String(props.games.length)),
          h(
            'button',
            {
              type: 'button',
              className: 'gl-iconbtn gl-push',
              disabled: props.loading,
              'aria-label': tr('action.refreshLibrary'),
              title: tr('action.refreshLibrary'),
              onClick: props.onRefresh,
            },
            props.loading ? h('span', { className: 'gl-spin', 'aria-hidden': true }) : h(IconRefresh, { size: 13 }),
          ),
        ),
        h(
          'div',
          { className: 'gl-card-body' },
          h(
            'label',
            { className: 'gl-search' },
            h('span', { className: 'gl-search-icon', 'aria-hidden': true }, h(IconSearch, { size: 13 })),
            h('input', {
              type: 'search',
              value: query,
              placeholder: tr('lib.search'),
              'aria-label': tr('lib.search'),
              spellCheck: false,
              autoComplete: 'off',
              onChange: (event) => setQuery(event.target.value),
            }),
          ),
          body,
        ),
      );
    }

    function ProjectRow({ tr, project, building, starting, disabled, onBuild }) {
      const name = project.name ? String(project.name) : baseName(project.path);
      const busy = building || starting;
      return h(
        'div',
        { className: 'gl-prow' },
        h(
          'div',
          { className: 'gl-prow-main' },
          h('span', { className: 'gl-pname', title: project.path || name }, name),
          h('span', { className: 'gl-ppath gl-mono', title: project.path || '' }, project.path || ''),
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'gl-play',
            'data-busy': busy ? 'true' : 'false',
            disabled: disabled,
            'aria-label': tr('proj.build') + ' ' + name,
            title: tr('proj.build') + ' ' + name,
            onClick: () => onBuild(project),
          },
          busy ? h('span', { className: 'gl-spin', 'aria-hidden': true }) : h(IconPlay, { size: 11 }),
          h('span', { className: 'gl-play-label' }, busy ? tr('proj.building') : tr('proj.build')),
        ),
      );
    }

    function ProjectsCard({ tr, projects, build, starting, roots, onBuild }) {
      const list = Array.isArray(projects) ? projects : [];
      const rootList = Array.isArray(roots) ? roots : [];
      const running = Boolean(build && build.state === 'running');
      const projectPath = build && build.project ? String(build.project) : null;
      const startingPath = starting ? String(starting) : null;
      const disabled = running || startingPath !== null;
      let body = null;
      if (list.length === 0) {
        body = h(
          'div',
          { className: 'gl-empty' },
          h('div', { className: 'gl-empty-title' }, tr('proj.emptyTitle')),
          h('div', { className: 'gl-empty-body' }, tr('proj.emptyBody')),
          rootList.length > 0
            ? h(
                'div',
                { className: 'gl-empty-roots' },
                rootList.map((root, index) =>
                  h('span', { key: 'proot:' + String(index), className: 'gl-rootpath gl-mono', title: root }, root),
                ),
              )
            : null,
        );
      } else {
        body = h(
          'div',
          null,
          h(
            'div',
            { className: 'gl-list' },
            list.map((project) =>
              h(ProjectRow, {
                key: project.id || project.path,
                tr,
                project,
                building: running && projectPath !== null && sameProject(projectPath, project.path),
                starting: startingPath !== null && sameProject(startingPath, project.path),
                disabled,
                onBuild,
              }),
            ),
          ),
          running && build && build.logTail
            ? h(
                'div',
                { className: 'gl-buildbox' },
                h('div', { className: 'gl-buildbox-title' }, tr('proj.log')),
                h('pre', { className: 'gl-buildlog' }, tailText(build.logTail, BUILD_LOG_SHOWN_LINES)),
              )
            : null,
        );
      }
      return h(
        'section',
        { className: 'gl-card' },
        h(
          'div',
          { className: 'gl-card-head' },
          h('span', { className: 'gl-card-title' }, tr('proj.title')),
          h('span', { className: 'gl-count' }, String(list.length)),
          running ? h('span', { className: 'gl-spin gl-push', 'aria-hidden': true }) : null,
        ),
        h('div', { className: 'gl-card-body' }, body),
      );
    }

    function RuntimeCard({ tr, emulator, online, serverNow }) {
      const state = emulator && emulator.state ? emulator.state : 'off';
      const idleStopAt = emulator && typeof emulator.idleStopAt === 'number' ? emulator.idleStopAt : null;
      const idleMs = idleStopAt !== null ? idleStopAt - serverNow : null;
      let idleValue = tr('rt.none');
      let idleWarn = false;
      if (idleMs !== null) {
        if (idleMs <= 0) {
          idleValue = tr('state.stopping');
          idleWarn = true;
        } else {
          idleValue = tr('rt.idleLeft', { v: formatCountdown(idleMs) });
          idleWarn = idleMs < 60000;
        }
      }
      let uptimeValue = tr('rt.none');
      if (emulator && typeof emulator.bootedAt === 'number' && emulator.bootedAt > 0) {
        uptimeValue = formatUptime(serverNow - emulator.bootedAt, tr);
      } else if (emulator && typeof emulator.bootElapsedMs === 'number') {
        uptimeValue = formatUptime(emulator.bootElapsedMs, tr);
      }
      const resolution = emulator && emulator.resolution && emulator.resolution.width > 0
        ? emulator.resolution
        : null;
      const rows = [
        { key: 'state', label: tr('rt.state'), value: statusLabel(tr, state), tone: state === 'online' ? 'ok' : state === 'error' ? 'bad' : null },
        { key: 'avd', label: tr('rt.avd'), value: emulator && emulator.avd ? String(emulator.avd) : tr('rt.none') },
        {
          key: 'res',
          label: tr('rt.resolution'),
          value: resolution ? tr('rt.size', { w: resolution.width, h: resolution.height }) : tr('rt.none'),
        },
        {
          key: 'fps',
          label: tr('rt.fps'),
          value: emulator && typeof emulator.fps === 'number' ? round1(emulator.fps) : tr('rt.none'),
        },
        {
          key: 'ram',
          label: tr('rt.ram'),
          value: emulator && typeof emulator.ramMb === 'number' ? tr('rt.mb', { n: Math.round(emulator.ramMb) }) : tr('rt.none'),
        },
        {
          key: 'cpu',
          label: tr('rt.cpu'),
          value: emulator && typeof emulator.cpuPercent === 'number' ? tr('rt.percent', { n: round1(emulator.cpuPercent) }) : tr('rt.none'),
        },
        { key: 'idle', label: tr('rt.idle'), value: idleValue, warn: idleWarn },
        { key: 'uptime', label: tr('rt.uptime'), value: uptimeValue },
      ];
      return h(
        'section',
        { className: 'gl-card' },
        h(
          'div',
          { className: 'gl-card-head' },
          h('span', { className: 'gl-card-title' }, tr('rt.title')),
          h(
            'span',
            { className: 'gl-card-sub gl-push' },
            emulator && emulator.avd ? String(emulator.avd) : statusLabel(tr, state),
          ),
        ),
        h(
          'div',
          { className: 'gl-card-body' },
          rows.map((row) =>
            h(
              'div',
              { key: row.key, className: 'gl-kv' },
              h('span', { className: 'gl-kv-key' }, row.label),
              h(
                'span',
                {
                  className: 'gl-kv-val' + (row.tone === 'ok' || row.tone === 'bad' || row.warn ? '' : ' gl-num'),
                  'data-warn': row.warn ? 'true' : 'false',
                  'data-tone': row.tone || 'none',
                  title: String(row.value),
                },
                row.value,
              ),
            ),
          ),
        ),
      );
    }

    function ConfigCard({ tr, config, scan }) {
      let body = null;
      if (!config) {
        body = h('div', { className: 'gl-empty' }, h('div', { className: 'gl-empty-body' }, tr('cfg.waiting')));
      } else {
        const roots = Array.isArray(config.gameRoots) && config.gameRoots.length > 0
          ? config.gameRoots
          : scan && Array.isArray(scan.roots)
            ? scan.roots
            : [];
        const rows = [
          { key: 'avd', label: tr('cfg.avd'), value: config.avdName ? String(config.avdName) : tr('rt.none') },
          { key: 'idle', label: tr('cfg.idle'), value: tr('cfg.minutes', { n: config.idleMinutes }) },
          { key: 'fps', label: tr('cfg.maxFps'), value: String(config.maxFps) },
          { key: 'ram', label: tr('cfg.ram'), value: tr('rt.mb', { n: config.ramMb }) },
          { key: 'cores', label: tr('cfg.cores'), value: String(config.cores) },
          { key: 'gpu', label: tr('cfg.gpu'), value: String(config.gpuMode) },
        ];
        body = h(
          'div',
          null,
          rows.map((row) =>
            h(
              'div',
              { key: row.key, className: 'gl-kv' },
              h('span', { className: 'gl-kv-key' }, row.label),
              h('span', { className: 'gl-kv-val gl-num', title: row.value }, row.value),
            ),
          ),
          h(
            'div',
            null,
            h('div', { className: 'gl-kv' }, h('span', { className: 'gl-kv-key' }, tr('cfg.roots'))),
            h(
              'div',
              { className: 'gl-roots' },
              roots.length > 0
                ? roots.map((root, index) =>
                    h('span', { key: 'root:' + String(index), className: 'gl-rootpath gl-mono', title: root }, root),
                  )
                : h('span', { className: 'gl-rootpath' }, tr('rt.none')),
            ),
          ),
          h('div', { className: 'gl-note' }, tr('cfg.note')),
        );
      }
      return h(
        'section',
        { className: 'gl-card' },
        h('div', { className: 'gl-card-head' }, h('span', { className: 'gl-card-title' }, tr('cfg.title'))),
        h('div', { className: 'gl-card-body' }, body),
      );
    }

    function LogsCard({ tr, logs, loading, error, packageName, build, onLoad }) {
      const lines = logs && Array.isArray(logs.lines) ? logs.lines : null;
      const shown = lines ? lines.slice(-LOG_SHOWN_LINES) : null;
      const target = packageName ? tr('logs.package', { name: packageName }) : tr('logs.all');
      const buildFailed = Boolean(build && build.state === 'error' && build.logTail);
      let body = null;
      if (error) {
        body = h(
          'div',
          { className: 'gl-inline-error' },
          tr('logs.failed') + ' ' + String(error),
        );
      } else if (shown === null) {
        body = h('div', { className: 'gl-empty' },
          h('div', { className: 'gl-empty-body' }, tr('logs.empty')));
      } else if (shown.length === 0) {
        body = h('div', { className: 'gl-empty' },
          h('div', { className: 'gl-empty-body' }, tr('logs.emptyLines')));
      } else {
        body = h('pre', { className: 'gl-logs' }, shown.join('\n'));
      }
      return h(
        'section',
        { className: 'gl-card' },
        h(
          'div',
          { className: 'gl-card-head' },
          h('span', { className: 'gl-card-title' }, tr('logs.title')),
          h('span', { className: 'gl-card-sub gl-push', title: target }, target),
          h(
            'button',
            {
              type: 'button',
              className: 'gl-btn',
              disabled: loading,
              'aria-label': tr('logs.load'),
              title: tr('logs.load'),
              onClick: onLoad,
            },
            loading ? h('span', { className: 'gl-spin', 'aria-hidden': true }) : h(IconReload, { size: 12 }),
            h('span', null, loading ? tr('logs.loading') : tr('logs.load')),
          ),
        ),
        h(
          'div',
          { className: 'gl-card-body' },
          body,
          lines
            ? h('div', { className: 'gl-logmeta' }, tr('logs.view', { n: shown.length, total: lines.length }))
            : null,
          buildFailed
            ? h(
                'div',
                { className: 'gl-buildbox', 'data-tone': 'error' },
                h(
                  'div',
                  { className: 'gl-buildbox-title' },
                  tr('logs.buildFailed') + (build.project ? ' - ' + baseName(build.project) : ''),
                ),
                h('pre', { className: 'gl-buildlog' }, tailText(build.logTail, BUILD_LOG_SHOWN_LINES)),
              )
            : null,
        ),
      );
    }

    /* ------------------------------------------------------------------ */
    /* Page                                                                */
    /* ------------------------------------------------------------------ */

    function GameLabPage(props) {
      const t = props && typeof props.t === 'function' ? props.t : null;
      const tr = useCallback(
        (key, vars) => {
          let value = null;
          if (t) {
            try {
              value = t(key);
            } catch (error) {
              value = null;
            }
          }
          if (typeof value !== 'string' || value === '' || value === key) value = EN[key];
          if (typeof value !== 'string') value = key;
          if (vars) {
            const names = Object.keys(vars);
            for (let i = 0; i < names.length; i += 1) {
              value = value.split('{' + names[i] + '}').join(String(vars[names[i]]));
            }
          }
          return value;
        },
        [t],
      );

      const [status, setStatus] = useState(null);
      const [statusError, setStatusError] = useState(null);
      const [gamesData, setGamesData] = useState({ games: [], projects: [], scan: null });
      const [gamesLoading, setGamesLoading] = useState(true);
      const [gamesError, setGamesError] = useState(null);
      const [busy, setBusy] = useState(null);
      const [installingKey, setInstallingKey] = useState(null);
      const [buildStarting, setBuildStarting] = useState(null);
      const [banner, setBanner] = useState(null);
      const [streamNonce, setStreamNonce] = useState(0);
      const [streamFailed, setStreamFailed] = useState(false);
      const [logs, setLogs] = useState(null);
      const [logsLoading, setLogsLoading] = useState(false);
      const [logsError, setLogsError] = useState(null);
      const [logPackage, setLogPackage] = useState('');
      const [visible, setVisible] = useState(false);
      const [now, setNow] = useState(() => Date.now());

      const aliveRef = useRef(true);
      const controllersRef = useRef(new Set());
      const rootRef = useRef(null);
      const screenRef = useRef(null);
      const gestureRef = useRef(null);
      const lastInputRef = useRef(0);
      const intersectingRef = useRef(true);
      const retryTimerRef = useRef(0);
      const loadCheckTimerRef = useRef(0);
      const imgRef = useRef(null);
      const bootWatchRef = useRef(0);
      const prevBuildRef = useRef(null);

      const request = useCallback(async (path, options) => {
        const controller = new AbortController();
        controllersRef.current.add(controller);
        try {
          const settings = Object.assign({ signal: controller.signal, cache: 'no-store' }, options || {});
          const response = await fetch(API + path, settings);
          let data = null;
          try {
            data = await response.json();
          } catch (error) {
            data = null;
          }
          if (!response.ok || (data && data.ok === false)) {
            const message =
              data && typeof data.error === 'string' && data.error !== ''
                ? data.error
                : 'HTTP ' + String(response.status);
            throw new Error(message);
          }
          return data;
        } finally {
          controllersRef.current.delete(controller);
        }
      }, []);

      const post = useCallback(
        (path, body) =>
          request(path, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body || {}),
          }),
        [request],
      );

      const fetchStatus = useCallback(async () => {
        try {
          const data = await request('/status');
          if (!aliveRef.current) return;
          if (data && data.ok) {
            setStatus(Object.assign({}, data, { receivedAt: Date.now() }));
            setStatusError(null);
          }
        } catch (error) {
          if (!aliveRef.current) return;
          if (error && error.name === 'AbortError') return;
          setStatusError(errorText(error, tr));
        }
      }, [request, tr]);

      const loadGames = useCallback(
        async (force) => {
          if (!aliveRef.current) return;
          setGamesLoading(true);
          try {
            const data = await request('/games' + (force ? '?refresh=1' : ''));
            if (!aliveRef.current) return;
            setGamesData({
              games: data && Array.isArray(data.games) ? data.games : [],
              projects: data && Array.isArray(data.projects) ? data.projects : [],
              scan: data && data.scan ? data.scan : null,
            });
            setGamesError(null);
          } catch (error) {
            if (!aliveRef.current) return;
            if (error && error.name === 'AbortError') return;
            setGamesError(errorText(error, tr));
          } finally {
            if (aliveRef.current) setGamesLoading(false);
          }
        },
        [request, tr],
      );

      /* Unmount / abort cleanup for every outstanding request. */
      useEffect(() => {
        aliveRef.current = true;
        const controllers = controllersRef.current;
        return () => {
          aliveRef.current = false;
          controllers.forEach((controller) => {
            try {
              controller.abort();
            } catch (error) {
              /* ignore */
            }
          });
          controllers.clear();
        };
      }, []);

      /* 1 s local ticker for ages, uptime and the idle countdown, while visible. */
      useEffect(() => {
        if (!visible) return undefined;
        setNow(Date.now());
        const ticker = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(ticker);
      }, [visible]);

      /* Page visibility = document visible AND the page root on screen. */
      useEffect(() => {
        const update = () => {
          const documentVisible =
            typeof document !== 'undefined' && document.visibilityState === 'visible';
          const next = documentVisible && intersectingRef.current;
          setVisible(next);
        };
        if (rootRef.current && typeof IntersectionObserver === 'function') {
          const observer = new IntersectionObserver(
            (entries) => {
              const entry = entries && entries[0];
              intersectingRef.current = Boolean(entry && entry.isIntersecting && entry.intersectionRatio > 0);
              update();
            },
            { threshold: [0, 0.05] },
          );
          observer.observe(rootRef.current);
          if (typeof document !== 'undefined') document.addEventListener('visibilitychange', update);
          update();
          return () => {
            observer.disconnect();
            if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', update);
          };
        }
        intersectingRef.current = true;
        if (typeof document !== 'undefined') document.addEventListener('visibilitychange', update);
        update();
        return () => {
          if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', update);
        };
      }, []);

      /* Status polling: 1 s while booting, 2.5 s otherwise. */
      const emulator = status && status.emulator ? status.emulator : null;
      const config = status && status.config ? status.config : null;
      const build = status && status.build ? status.build : null;
      const emuState = emulator && emulator.state ? emulator.state : 'off';
      const pollDelay = emuState === 'booting' ? FAST_POLL_MS : SLOW_POLL_MS;

      useEffect(() => {
        let cancelled = false;
        let timer = 0;
        const tick = () => {
          fetchStatus().finally(() => {
            if (cancelled) return;
            timer = window.setTimeout(tick, pollDelay);
          });
        };
        tick();
        return () => {
          cancelled = true;
          window.clearTimeout(timer);
        };
      }, [fetchStatus, pollDelay]);

      /* Heartbeat only while the page is genuinely visible. */
      useEffect(() => {
        if (!visible) return undefined;
        let cancelled = false;
        let timer = 0;
        const beat = () => {
          post('/heartbeat', {}).catch((error) => {
            if (error && error.name === 'AbortError') return;
            /* Heartbeat failures must never crash the page; the status poll reports health. */
          });
          if (cancelled) return;
          timer = window.setTimeout(beat, HEARTBEAT_MS);
        };
        beat();
        return () => {
          cancelled = true;
          window.clearTimeout(timer);
        };
      }, [visible, post]);

      /* One games scan on mount (a forced rescan is used for manual refreshes). */
      useEffect(() => {
        loadGames(false);
      }, [loadGames]);

      const refreshGames = useCallback(() => {
        loadGames(true);
      }, [loadGames]);

      /*
       * The host only reports `bootElapsedMs` once the emulator is online, so
       * the page clocks the "Starting Android... N s" counter locally from
       * the first poll that reports state 'booting'.
       */
      useEffect(() => {
        if (emuState === 'booting') {
          if (bootWatchRef.current === 0) bootWatchRef.current = Date.now();
          return undefined;
        }
        bootWatchRef.current = 0;
        return undefined;
      }, [emuState]);

      /* Build transition watcher: refresh the library and surface the result. */
      const buildState = build ? build.state : 'idle';
      const buildProjectPath = build && build.project ? String(build.project) : null;
      useEffect(() => {
        if (buildState === 'idle') {
          prevBuildRef.current = 'idle';
          return;
        }
        const previous = prevBuildRef.current;
        prevBuildRef.current = buildState;
        if (previous !== 'running') return;
        if (buildState === 'done') {
          setBanner({ kind: 'success', text: tr('build.done') });
          loadGames(true);
          fetchStatus();
        } else if (buildState === 'error') {
          setBanner({ kind: 'error', text: tr('build.failed') });
          loadGames(true);
        }
      }, [buildState, buildProjectPath, loadGames, fetchStatus, tr]);

      /* Auto-dismiss non-error banners. */
      useEffect(() => {
        if (!banner || banner.kind === 'error') return undefined;
        const timer = window.setTimeout(() => setBanner(null), 6000);
        return () => window.clearTimeout(timer);
      }, [banner]);

      /* Stop stream retries while the emulator is not online. */
      useEffect(() => {
        if (emuState === 'online') return undefined;
        setStreamFailed(false);
        window.clearTimeout(loadCheckTimerRef.current);
        loadCheckTimerRef.current = 0;
        if (retryTimerRef.current) {
          window.clearTimeout(retryTimerRef.current);
          retryTimerRef.current = 0;
        }
        return undefined;
      }, [emuState]);

      useEffect(
        () => () => {
          window.clearTimeout(retryTimerRef.current);
          window.clearTimeout(loadCheckTimerRef.current);
        },
        [],
      );

      const scheduleStreamRetry = useCallback(() => {
        if (!aliveRef.current) return;
        setStreamFailed(true);
        if (retryTimerRef.current) window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = window.setTimeout(() => {
          retryTimerRef.current = 0;
          if (!aliveRef.current) return;
          setStreamNonce((value) => value + 1);
        }, STREAM_RETRY_MS);
      }, []);

      const onStreamError = useCallback(() => {
        scheduleStreamRetry();
      }, [scheduleStreamRetry]);

      /*
       * A stream that ends cleanly can still dispatch `load` rather than
       * `error`. After `load`, check whether the image really finished
       * (`complete === true`); a live multipart stream stays incomplete, so
       * only a finished stream is retried.
       */
      const onStreamLoad = useCallback(() => {
        if (aliveRef.current) setStreamFailed(false);
        window.clearTimeout(loadCheckTimerRef.current);
        loadCheckTimerRef.current = window.setTimeout(() => {
          loadCheckTimerRef.current = 0;
          if (!aliveRef.current) return;
          const image = imgRef.current;
          if (image && image.complete) scheduleStreamRetry();
        }, 250);
      }, [scheduleStreamRetry]);

      const reloadStream = useCallback(() => {
        window.clearTimeout(loadCheckTimerRef.current);
        loadCheckTimerRef.current = 0;
        if (retryTimerRef.current) {
          window.clearTimeout(retryTimerRef.current);
          retryTimerRef.current = 0;
        }
        setStreamFailed(false);
        setStreamNonce((value) => value + 1);
      }, []);

      const runEmulatorAction = useCallback(
        async (action) => {
          if (busy) return;
          setBusy(action);
          setBanner(null);
          try {
            const body = { action };
            if (action === 'start' && config && config.avdName) body.avd = config.avdName;
            await post('/emulator', body);
            if (!aliveRef.current) return;
            await fetchStatus();
          } catch (error) {
            if (!aliveRef.current) return;
            if (error && error.name === 'AbortError') return;
            const prefix = action === 'start' ? tr('err.start') : tr('err.stop');
            setBanner({ kind: 'error', text: prefix + ' ' + errorText(error, tr) });
          } finally {
            if (aliveRef.current) setBusy(null);
          }
        },
        [busy, config, post, fetchStatus, tr],
      );

      const playGame = useCallback(
        async (game) => {
          if (!game || installingKey !== null) return;
          const name = stripApk(game.fileName || tr('lib.title'));
          setInstallingKey(gameKey(game));
          try {
            const data = await post('/install', { path: game.path });
            if (!aliveRef.current) return;
            const label = data && data.label ? String(data.label) : name;
            let text = tr('install.ok', { name: label });
            if (data && data.launched) text += ' ' + tr('install.launched');
            setBanner({ kind: 'success', text });
            if (data && data.packageName) setLogPackage(String(data.packageName));
            await fetchStatus();
            loadGames(true);
          } catch (error) {
            if (!aliveRef.current) return;
            if (error && error.name === 'AbortError') return;
            let text = tr('install.failed', { name }) + ' ' + errorText(error, tr);
            if (emuState !== 'online') text += ' ' + tr('install.hint');
            setBanner({ kind: 'error', text });
          } finally {
            if (aliveRef.current) setInstallingKey(null);
          }
        },
        [installingKey, post, fetchStatus, loadGames, tr, emuState],
      );

      const startBuild = useCallback(
        async (project) => {
          if (!project || !project.path || buildStarting) return;
          setBuildStarting(project.path);
          try {
            await post('/build', { projectPath: project.path });
            if (!aliveRef.current) return;
            await fetchStatus();
          } catch (error) {
            if (!aliveRef.current) return;
            if (error && error.name === 'AbortError') return;
            setBanner({ kind: 'error', text: tr('build.requestFailed') + ' ' + errorText(error, tr) });
          } finally {
            if (aliveRef.current) setBuildStarting(null);
          }
        },
        [buildStarting, post, fetchStatus, tr],
      );

      const loadLogs = useCallback(async () => {
        if (!aliveRef.current || logsLoading) return;
        setLogsLoading(true);
        setLogsError(null);
        try {
          const query =
            '/logs?lines=' + String(LOG_REQUEST_LINES) +
            (logPackage ? '&packageName=' + encodeURIComponent(logPackage) : '');
          const data = await request(query);
          if (!aliveRef.current) return;
          setLogs({
            lines: data && Array.isArray(data.lines) ? data.lines : [],
            packageName: logPackage,
            at: Date.now(),
          });
        } catch (error) {
          if (!aliveRef.current) return;
          if (error && error.name === 'AbortError') return;
          setLogsError(errorText(error, tr));
        } finally {
          if (aliveRef.current) setLogsLoading(false);
        }
      }, [request, logPackage, logsLoading, tr]);

      const saveScreenshot = useCallback(() => {
        if (emuState !== 'online') return;
        const controller = new AbortController();
        controllersRef.current.add(controller);
        fetch(API + '/frame.png', { cache: 'no-store', signal: controller.signal })
          .then((response) => {
            if (!response.ok) throw new Error('HTTP ' + String(response.status));
            return response.blob();
          })
          .then((blob) => {
            if (!aliveRef.current) return;
            const url = URL.createObjectURL(blob);
            try {
              const link = document.createElement('a');
              link.href = url;
              link.download = 'game-lab-' + screenshotStamp() + '.png';
              link.rel = 'noopener';
              link.click();
            } finally {
              window.setTimeout(() => {
                try {
                  URL.revokeObjectURL(url);
                } catch (error) {
                  /* ignore */
                }
              }, 4000);
            }
          })
          .catch((error) => {
            if (!aliveRef.current) return;
            if (error && error.name === 'AbortError') return;
            setBanner({ kind: 'error', text: tr('err.screenshot') + ' ' + errorText(error, tr) });
          })
          .finally(() => {
            controllersRef.current.delete(controller);
          });
      }, [emuState, tr]);

      const sendKey = useCallback(
        (name) => {
          if (emuState !== 'online') return;
          post('/input', { kind: 'key', name }).catch((error) => {
            if (!aliveRef.current) return;
            if (error && error.name === 'AbortError') return;
            setBanner({ kind: 'error', text: tr('err.input') + ' ' + errorText(error, tr) });
          });
        },
        [emuState, post, tr],
      );

      /* Throttle pointer input to at most ~12 posts per second. */
      const queueInput = useCallback(
        (payload) => {
          const stamp = Date.now();
          if (stamp - lastInputRef.current < INPUT_MIN_GAP_MS) return;
          lastInputRef.current = stamp;
          post('/input', payload).catch((error) => {
            if (!aliveRef.current) return;
            if (error && error.name === 'AbortError') return;
            setBanner({ kind: 'error', text: tr('err.input') + ' ' + errorText(error, tr) });
          });
        },
        [post, tr],
      );

      const resolution = emulator && emulator.resolution && emulator.resolution.width > 0
        ? emulator.resolution
        : DEFAULT_RESOLUTION;
      const orientation = resolution.width >= resolution.height ? 'landscape' : 'portrait';
      const online = emuState === 'online';
      const booting = emuState === 'booting';
      const stopping = emuState === 'stopping';
      const offline = !online && !booting && !stopping;

      const rotateScreen = useCallback(() => {
        if (!online) return;
        const next = resolution.width >= resolution.height ? 'portrait' : 'landscape';
        post('/input', { kind: 'rotate', orientation: next })
          .then(() => {
            if (aliveRef.current) fetchStatus();
          })
          .catch((error) => {
            if (!aliveRef.current) return;
            if (error && error.name === 'AbortError') return;
            setBanner({ kind: 'error', text: tr('err.rotate') + ' ' + errorText(error, tr) });
          });
      }, [online, resolution, post, fetchStatus, tr]);

      const onScreenPointerDown = useCallback(
        (event) => {
          if (emuState !== 'online') return;
          if (typeof event.button === 'number' && event.button !== 0) return;
          const element = screenRef.current;
          if (!element) return;
          try {
            element.setPointerCapture(event.pointerId);
          } catch (error) {
            /* pointer capture is best effort */
          }
          gestureRef.current = {
            id: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            moved: 0,
            t0: Date.now(),
          };
        },
        [emuState],
      );

      const onScreenPointerMove = useCallback((event) => {
        const gesture = gestureRef.current;
        if (!gesture || gesture.id !== event.pointerId) return;
        const dx = event.clientX - gesture.startX;
        const dy = event.clientY - gesture.startY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance > gesture.moved) gesture.moved = distance;
      }, []);

      const onScreenPointerCancel = useCallback((event) => {
        const gesture = gestureRef.current;
        gestureRef.current = null;
        const element = screenRef.current;
        if (gesture && element && typeof event.pointerId === 'number') {
          try {
            element.releasePointerCapture(event.pointerId);
          } catch (error) {
            /* ignore */
          }
        }
      }, []);

      const onScreenPointerUp = useCallback(
        (event) => {
          const gesture = gestureRef.current;
          gestureRef.current = null;
          const element = screenRef.current;
          if (gesture && element) {
            try {
              element.releasePointerCapture(event.pointerId);
            } catch (error) {
              /* ignore */
            }
          }
          if (!gesture || gesture.id !== event.pointerId) return;
          if (emuState !== 'online' || !element) return;
          const start = resolveScreenPoint(element, gesture.startX, gesture.startY, resolution);
          const end = resolveScreenPoint(element, event.clientX, event.clientY, resolution);
          if (!start || !end) return;
          if (gesture.moved < TAP_MAX_PX) {
            queueInput({ kind: 'tap', x: end.x, y: end.y });
          } else {
            queueInput({
              kind: 'swipe',
              fromX: start.x,
              fromY: start.y,
              toX: end.x,
              toY: end.y,
              durationMs: Math.max(60, Date.now() - gesture.t0),
            });
          }
        },
        [emuState, resolution, queueInput],
      );

      const serverNow =
        status && typeof status.serverTime === 'number' && typeof status.receivedAt === 'number'
          ? status.serverTime + (now - status.receivedAt)
          : now;
      let bootElapsedMs = null;
      if (emulator && typeof emulator.bootElapsedMs === 'number') {
        bootElapsedMs = emulator.bootElapsedMs;
      } else if (booting && bootWatchRef.current > 0) {
        bootElapsedMs = Math.max(0, now - bootWatchRef.current);
      }
      const scan = gamesData.scan;
      const roots =
        scan && Array.isArray(scan.roots) && scan.roots.length > 0
          ? scan.roots
          : config && Array.isArray(config.gameRoots)
            ? config.gameRoots
            : [];
      const streamSrc = API + '/stream?_=' + String(streamNonce);

      const nextAction = online || booting ? 'stop' : 'start';
      const buttonDisabled = Boolean(busy) || stopping;
      let buttonText = nextAction === 'stop' ? tr('action.stop') : tr('action.start');
      if (busy === 'start') buttonText = tr('action.starting');
      else if (busy === 'stop' || stopping) buttonText = tr('action.stopping');
      const deviceSub =
        online && emulator && emulator.avd
          ? String(emulator.avd) + (emulator.serial ? ' / ' + String(emulator.serial) : '')
          : statusLabel(tr, emuState);

      return h(
        'div',
        { className: 'gl-root', ref: rootRef },
        h('style', { 'data-plugin': PLUGIN_ID }, CSS),
        h(
          'header',
          { className: 'gl-head' },
          h(
            'div',
            { className: 'gl-head-row' },
            h(
              'div',
              { className: 'gl-head-main' },
              h(
                'div',
                { className: 'gl-eyebrow' },
                h('span', { className: 'gl-eyebrow-dot', 'aria-hidden': true }),
                tr('app.eyebrow'),
              ),
              h('h1', { className: 'gl-title' }, tr('app.title')),
              h('p', { className: 'gl-subtitle' }, tr('app.subtitle')),
            ),
            h(
              'div',
              { className: 'gl-head-actions' },
              statusError
                ? h(
                    'span',
                    { className: 'gl-conn', title: statusError },
                    h('span', { className: 'gl-conn-dot', 'aria-hidden': true }),
                    tr('conn.offline'),
                  )
                : null,
              h(StatusPill, { tr, state: emuState }),
              h(
                'button',
                {
                  type: 'button',
                  className: 'gl-btn' + (nextAction === 'start' ? ' gl-btn-primary' : ''),
                  disabled: buttonDisabled,
                  'aria-label': buttonText,
                  title: buttonText,
                  onClick: () => runEmulatorAction(nextAction),
                },
                busy || stopping
                  ? h('span', { className: 'gl-spin', 'aria-hidden': true })
                  : nextAction === 'start'
                    ? h(IconPlay, { size: 13 })
                    : h(IconStop, { size: 13 }),
                h('span', null, buttonText),
              ),
            ),
          ),
          booting ? h(BootProgress, { tr, emulator, bootElapsedMs }) : null,
        ),
        h(
          'div',
          { className: 'gl-body' },
          banner ? h(BannerView, { tr, banner, onDismiss: () => setBanner(null) }) : null,
          h(
            'div',
            { className: 'gl-grid' },
            h(
              'div',
              { className: 'gl-col gl-col-left' },
              h(LibraryCard, {
                tr,
                games: gamesData.games,
                scan,
                roots,
                loading: gamesLoading,
                error: gamesError,
                now,
                installingKey,
                onRefresh: refreshGames,
                onPlay: playGame,
              }),
              h(ProjectsCard, {
                tr,
                projects: gamesData.projects,
                build,
                starting: buildStarting,
                roots,
                onBuild: startBuild,
              }),
            ),
            h(
              'div',
              { className: 'gl-col gl-col-center' },
              h(
                'section',
                { className: 'gl-card gl-device-card' },
                h(
                  'div',
                  { className: 'gl-card-head' },
                  h('span', { className: 'gl-card-title' }, tr('device.title')),
                  h('span', { className: 'gl-card-sub gl-push', title: deviceSub }, deviceSub),
                ),
                h(
                  'div',
                  { className: 'gl-stage' },
                  offline
                    ? h(DeviceOffline, {
                        tr,
                        emulator,
                        config,
                        busy,
                        statusError,
                        onStart: () => runEmulatorAction('start'),
                      })
                    : h(
                        'div',
                        {
                          className: 'gl-phone',
                          'data-orient': orientation,
                          style: {
                            '--gl-ar': String(resolution.width) + ' / ' + String(resolution.height),
                          },
                        },
                        h(
                          'div',
                          {
                            className: 'gl-screen',
                            ref: screenRef,
                            'data-online': online ? 'true' : 'false',
                            role: 'group',
                            'aria-label': tr('device.screenAria'),
                            title: tr('device.screenAria'),
                            onPointerDown: onScreenPointerDown,
                            onPointerMove: onScreenPointerMove,
                            onPointerUp: onScreenPointerUp,
                            onPointerCancel: onScreenPointerCancel,
                            onLostPointerCapture: onScreenPointerCancel,
                            onContextMenu: (event) => event.preventDefault(),
                          },
                          online
                            ? h('img', {
                                key: 'stream',
                                ref: imgRef,
                                className: 'gl-screen-img',
                                src: streamSrc,
                                alt: tr('device.streamAlt'),
                                draggable: false,
                                onError: onStreamError,
                                onLoad: onStreamLoad,
                              })
                            : null,
                          !online
                            ? h(
                                'div',
                                { className: 'gl-skeleton' },
                                h(
                                  'div',
                                  { className: 'gl-skel-inner' },
                                  h('span', { className: 'gl-spin gl-spin-lg', 'aria-hidden': true }),
                                  h(
                                    'span',
                                    { className: 'gl-skel-text' },
                                    booting ? tr('boot.label') : tr('state.stopping'),
                                  ),
                                ),
                              )
                            : null,
                          online && streamFailed
                            ? h(
                                'div',
                                { className: 'gl-streamfail', role: 'status' },
                                h('span', { className: 'gl-spin', 'aria-hidden': true }),
                                h('span', null, tr('device.retrying')),
                              )
                            : null,
                        ),
                      ),
                ),
                h(Toolbar, {
                  tr,
                  online,
                  orientation,
                  onKey: sendKey,
                  onRotate: rotateScreen,
                  onScreenshot: saveScreenshot,
                  onReload: reloadStream,
                }),
              ),
            ),
            h(
              'div',
              { className: 'gl-col gl-col-right' },
              h(RuntimeCard, { tr, emulator, online, serverNow }),
              h(ConfigCard, { tr, config, scan }),
              h(LogsCard, {
                tr,
                logs,
                loading: logsLoading,
                error: logsError,
                packageName: logPackage,
                build,
                onLoad: loadLogs,
              }),
            ),
          ),
        ),
        h(
          'footer',
          { className: 'gl-foot', 'data-online': online ? 'true' : 'false' },
          h('span', { className: 'gl-foot-dot', 'aria-hidden': true }),
          h('span', null, tr('foot.text')),
        ),
      );
    }

    /* ------------------------------------------------------------------ */
    /* Registration                                                        */
    /* ------------------------------------------------------------------ */

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        /* English dictionary; other locales fall back through it. */
        ctx.effect(() => ctx.locale.register(NS, 'en', EN));

        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS }, GameLabPage),
        );

        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: PANEL_ID,
              order: 25,
              label: () => ctx.locale.bind(NS)('panel.label'),
              locale: NS,
            },
            PanelIcon,
          ),
        );
      },
    };
  },
});
