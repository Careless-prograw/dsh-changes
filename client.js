/**
 * Changes（变更）— browser half.
 *
 * Two surfaces, both fed by the Host half over same-origin loopback routes:
 *   - a review bar above the composer (`conversation.input.dock`) that is the
 *     plugin's only change hint, and disappears once nothing is pending;
 *   - a "Changes" page in the right sidebar (`sidebar.right.pane.tab`) that
 *     reviews one file's hunks, switches review baseline, and rolls the
 *     workspace back to a Git commit or an SVN revision.
 *
 * Plain-JavaScript bundle: React comes from the browser module table, and the
 * module registers itself into the page's module loader.
 */
window.__ModuleLoader__.load({
  id: 'dsh-changes',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } = React

    const TAB_ID = 'dsh-changes'
    const KIND = 'changes'
    const BAR_ID = 'dsh-changes-bar'
    const NS = '/dsh-changes'

    // ------------------------------------------------------------------ copy

    const DICT = {
      zh: {
        'bar.pending': '{count} 个文件待审查',
        'bar.keepAll': '全部保留',
        'bar.dropAll': '全部撤销',
        'bar.keep': '保留',
        'bar.drop': '撤销',
        'bar.confirmAll': '撤销全部 {count} 个文件的改动？会写回文件，且不可恢复。',
        'bar.expand': '展开文件清单',
        'bar.collapse': '收起文件清单',
        'bar.binaryOnly': '二进制文件只能保留',
        'bar.oversizedOnly': '文件过大，只能保留',
        'bar.failed': '操作失败',
        'bar.retry': '重试',
        'bar.droppedSome': '已撤销 {handled} 个文件，{skipped} 个二进制 / 超大文件只能保留',
        'bar.empty': '本会话改动已全部处理',
        'bar.broken': '变更记录器不可用，暂时无法提供改动提示',
        'bar.keepOne': '已保留 {name}',
        'bar.dropOne': '已撤销 {name}',
        'bar.keptAll': '已保留全部改动',
        'bar.droppedAll': '已撤销全部改动',
        'tab.title': '变更',
        'tab.guide': '审查本轮改动的文件与改动块，接受或撤销',
        'panel.empty': '暂无改动',
        'panel.loading': '加载中…',
        'panel.allHandled': '✓ 已全部处理',
        'panel.acceptAll': '全部接受',
        'panel.rejectAll': '全部拒绝',
        'panel.rollback': '整区回退',
        'panel.baseline': '基线：{name}',
        'panel.accept': '接受',
        'panel.reject': '拒绝',
        'panel.hunkProgress': '块 {index} / {total}',
        'panel.turn': '第 {turn} 轮',
        'panel.binary': '二进制文件，不展示 diff',
        'panel.oversized': '文件过大，不展示 diff',
        'panel.coarse': '该文件差异已降级为整文件替换，只支持文件级处置',
        'panel.noHunks': '该文件没有可逐块审查的改动',
        'panel.handled': '已处理',
        'panel.failed': '操作失败',
        'panel.loadFailed': '加载失败',
        'panel.diffUnavailable': '差异不可用',
        'panel.baselineLabel': '审查基线',
        'panel.pickRefFirst': '先选择一个版本点',
        'panel.refTooMany': '仅显示前 {shown} 个，还有 {rest} 个',
        'panel.rounds': '{count} 轮改动',
        'diff.folded': '⋯ 未改动的 {count} 行',
        'diff.expand': '展开未改动的行',
        'diff.fold': '收起未改动的行',
        'diff.foldHint': '收起',
        'diff.foldUnavailable': '内容过大，未提供文件全文',
        'diff.foldedUnknown': '⋯ 未改动的 {count} 行',
        'panel.round': '第 {turn} 轮改动',
        'panel.roundShort': '第 {count} 次改动',
        'panel.roundHint': '这一块来自对该文件的第 {count} 次改动（发生在对话第 {turn} 轮）',
        'panel.coarseTag': '整文件替换',
        'panel.restored': '来自上一次运行的存档',
        'panel.restoredBadge': '存档',
        'panel.rollbackHint': '整区回退会把工作区强制对齐到所选版本，丢弃其后的所有改动。先切换到 Git / SVN 基线并选择版本点。',
        'panel.rollbackConfirm': '把工作区强制对齐到 {ref}？这会丢弃该版本之后的所有改动，且不可恢复。',
        'panel.rolledBack': '已回退到 {ref}',
        'panel.refEmpty': '没有可用的版本点',
        'panel.refPick': '选择一个版本点查看其改动',
        'panel.vcsMissing': '当前工作目录不是 Git / SVN 仓库',
        'panel.drift': '文件已漂移',
        'panel.reload': '重新加载',
        'base.snapshot': '会话快照',
        'base.git': 'Git commit',
        'base.svn': 'SVN 版本',
        'err.no-recorder': '变更记录器不可用',
        'err.no-vcs': '未检测到版本控制',
        'cfg.title': 'DSH 原生交付卡片',
        'cfg.desc': '隐藏 DSH 原生的会话内「已编辑 N 个文件」变更卡片，让待审条成为唯一的变更提示。',
        'cfg.note': '该卡片与「交付卡片」「正文文件提及」「原生变更审查 tab」同属原生包 dsh-client-ui-deliverables，关闭时会一并隐藏；本插件的待审条与右侧面板不受影响。改动后本插件重启一次即生效，停用或卸载会自动恢复。',
        'cfg.hidden': '隐藏',
        'cfg.shown': '显示',
        'cfg.noChannel': '本页未提供配置读写通道',
        'cfg.readOnly': '当前 profile 无法保存配置',
        'cfg.saveFailed': '保存失败，开关已回弹',
      },
      en: {
        'bar.pending': '{count} files to review',
        'bar.keepAll': 'Keep all',
        'bar.dropAll': 'Revert all',
        'bar.keep': 'Keep',
        'bar.drop': 'Revert',
        'bar.confirmAll': 'Revert all {count} changed files? This writes to disk and cannot be undone.',
        'bar.expand': 'Show changed files',
        'bar.collapse': 'Hide changed files',
        'bar.binaryOnly': 'A binary file can only be kept',
        'bar.oversizedOnly': 'A file this large can only be kept',
        'bar.failed': 'The action failed',
        'bar.retry': 'Retry',
        'bar.droppedSome': 'Reverted {handled} files; {skipped} binary or oversized files can only be kept',
        'bar.empty': 'Every change in this session has been handled',
        'bar.broken': 'The change recorder is unavailable, so there is nothing to review',
        'bar.keepOne': 'Kept {name}',
        'bar.dropOne': 'Reverted {name}',
        'bar.keptAll': 'Kept every change',
        'bar.droppedAll': 'Reverted every change',
        'tab.title': 'Changes',
        'tab.guide': "Review this turn's changed files and hunks, then accept or revert them",
        'panel.empty': 'No changes',
        'panel.loading': 'Loading…',
        'panel.allHandled': '✓ All handled',
        'panel.acceptAll': 'Accept all',
        'panel.rejectAll': 'Reject all',
        'panel.rollback': 'Roll back',
        'panel.baseline': 'Baseline: {name}',
        'panel.accept': 'Accept',
        'panel.reject': 'Reject',
        'panel.hunkProgress': 'Hunk {index} / {total}',
        'panel.turn': 'Turn {turn}',
        'panel.binary': 'Binary file, no diff shown',
        'panel.oversized': 'File too large, no diff shown',
        'panel.coarse': 'This comparison degraded to whole-file replacement, so only file-level actions apply',
        'panel.noHunks': 'This file has no reviewable hunks',
        'panel.handled': 'Handled',
        'panel.failed': 'The action failed',
        'panel.loadFailed': 'Could not load',
        'panel.diffUnavailable': 'The comparison is unavailable',
        'panel.baselineLabel': 'Review baseline',
        'panel.pickRefFirst': 'Pick a version point first',
        'panel.refTooMany': 'Showing the first {shown}; {rest} more',
        'panel.rounds': '{count} rounds',
        'diff.folded': '⋯ {count} unchanged line(s)',
        'diff.expand': 'Expand unchanged lines',
        'diff.fold': 'Collapse unchanged lines',
        'diff.foldHint': 'collapse',
        'diff.foldUnavailable': 'File text unavailable for this size',
        'diff.foldedUnknown': '⋯ {count} unchanged line(s)',
        'panel.round': 'Turn {turn}',
        'panel.roundShort': 'change {count}',
        'panel.roundHint': 'From change {count} to this file (conversation turn {turn})',
        'panel.coarseTag': 'whole-file',
        'panel.restored': 'Restored from a previous run',
        'panel.restoredBadge': 'restored',
        'panel.rollbackHint': 'Rolling back forces the workspace onto the chosen version and discards everything after it. Switch to a Git / SVN baseline and pick a version point first.',
        'panel.rollbackConfirm': 'Force the workspace to {ref}? Every change after that version is discarded and cannot be recovered.',
        'panel.rolledBack': 'Rolled back to {ref}',
        'panel.refEmpty': 'No version points',
        'panel.refPick': 'Pick a version point to see its changes',
        'panel.vcsMissing': 'This working directory is not a Git / SVN repository',
        'panel.drift': 'The file drifted',
        'panel.reload': 'Reload',
        'base.snapshot': 'Session snapshot',
        'base.git': 'Git commit',
        'base.svn': 'SVN revision',
        'err.no-recorder': 'The change recorder is unavailable',
        'err.no-vcs': 'No version control detected',
        'cfg.title': 'DSH native delivery cards',
        'cfg.desc': "Hide DSH's native in-conversation \"edited N files\" card so the review bar is the only change hint.",
        'cfg.note': "That card shares a package with the delivery cards, the inline file mentions, and the native changes-review tab, so hiding it hides those too; this plugin's bar and panel are unaffected. The change applies after this plugin restarts once, and stopping or removing the plugin restores the card.",
        'cfg.hidden': 'Hidden',
        'cfg.shown': 'Shown',
        'cfg.noChannel': 'This page does not offer configuration access',
        'cfg.readOnly': 'This profile cannot save configuration',
        'cfg.saveFailed': 'Could not save; the switch reverted',
      },
    }

    function fill(template, params) {
      if (params === undefined) return template
      let text = template
      for (const key of Object.keys(params)) text = text.split(`{${key}}`).join(String(params[key]))
      return text
    }

    // ----------------------------------------------------------------- state

    /** Shared selection: the bar asks the panel to show one file. */
    function createStore(initial) {
      let state = initial
      const listeners = new Set()
      return {
        get: () => state,
        set(patch) {
          state = { ...state, ...patch }
          for (const listener of listeners) listener()
        },
        subscribe(listener) {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
      }
    }

    const focusStore = createStore({ path: '', rev: 0 })
    const localeStore = createStore({ rev: 0 })

    /** Bound at activation; every component reads it lazily so a reload rebinds cleanly. */
    const runtime = {
      translate: (key, params) => fill(DICT.zh[key] ?? key, params),
      openPanel: () => {},
      reload: () => {},
      /** Resolved lazily: the client service may arrive after this module loads. */
      configForms: () => undefined,
    }

    function t(key, params) {
      return runtime.translate(key, params)
    }

    function useStore(store) {
      return useSyncExternalStore(store.subscribe, store.get, store.get)
    }

    // ------------------------------------------------------------------ http

    function urlOf(endpoint, params) {
      const query = new URLSearchParams()
      for (const key of Object.keys(params ?? {})) {
        const value = params[key]
        if (value !== undefined && value !== null && value !== '') query.set(key, String(value))
      }
      const suffix = query.toString()
      return `${NS}/${endpoint}${suffix === '' ? '' : `?${suffix}`}`
    }

    async function readJson(response) {
      const text = await response.text()
      if (text.trim() === '') return { ok: false, error: `HTTP ${response.status}` }
      try {
        return JSON.parse(text)
      } catch {
        return { ok: false, error: `HTTP ${response.status}` }
      }
    }

    async function fetchJson(endpoint, params) {
      const response = await fetch(urlOf(endpoint, params), {
        headers: { accept: 'application/json' },
        credentials: 'same-origin',
      })
      const data = await readJson(response)
      if (data?.ok === false && typeof data.error === 'string') return data
      return data
    }

    async function sendAction(payload) {
      const response = await fetch(`${NS}/act`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload),
      })
      return readJson(response)
    }

    /**
     * Poll one endpoint while the surface is mounted.
     * Background windows are throttled by the browser, so a hidden page polls
     * far less often and refreshes as soon as it is visible again.
     */
    function useLive(enabled, sessionId, endpoint, params, intervalMs, nonce) {
      const [state, setState] = useState({ loading: true, data: undefined, error: '' })
      const key = useMemo(() => JSON.stringify(params ?? null), [JSON.stringify(params ?? null)])

      useEffect(() => {
        if (!enabled || sessionId === '') return undefined
        let alive = true
        let timer = 0
        let inFlight = false

        const schedule = (delay) => {
          clearTimeout(timer)
          const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden'
          timer = setTimeout(run, hidden ? Math.max(delay, 8000) : delay)
        }

        async function run() {
          if (!alive || inFlight) return
          inFlight = true
          try {
            const data = await fetchJson(endpoint, { sessionId, ...(params ?? {}) })
            if (alive) setState({ loading: false, data, error: '' })
          } catch (error) {
            if (alive) {
              setState((previous) => ({
                loading: false,
                data: previous.data,
                error: error instanceof Error ? error.message : String(error),
              }))
            }
          } finally {
            inFlight = false
            if (alive) schedule(intervalMs)
          }
        }

        run()
        const onVisible = () => {
          if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
          clearTimeout(timer)
          run()
        }
        if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible)
        if (typeof window !== 'undefined') window.addEventListener('focus', onVisible)
        return () => {
          alive = false
          clearTimeout(timer)
          if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible)
          if (typeof window !== 'undefined') window.removeEventListener('focus', onVisible)
        }
      }, [enabled, sessionId, endpoint, key, intervalMs, nonce])

      return state
    }

    // ----------------------------------------------------------------- styles

    const CSS = `
/* Matches the composer card it sits above: the dock renders inside the
   composer stack, whose children constrain themselves to this same axis. */
.dshc-dock{width:100%;max-width:var(--dsh-composer-card-max-width,952px);margin-inline:auto;box-sizing:border-box}
.dshc-bar{display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid var(--dsw-alias-border-l2,#303239);border-radius:var(--dsw-radius-md,10px);background:var(--dsw-alias-bg-layer-1,#1f2024);color:var(--dsw-alias-label-primary,#f2f3f5);font-size:13px;line-height:1.5}
.dshc-bar__icon{width:24px;height:24px;flex:none;display:grid;place-items:center;border:1px solid var(--dsw-alias-border-l2,#303239);border-radius:var(--dsw-radius-sm,6px);background:transparent;color:var(--dsw-alias-label-secondary,#9aa0ad);cursor:pointer;padding:0}
.dshc-bar__icon:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14));color:var(--dsw-alias-label-primary,#f2f3f5)}
.dshc-bar__label{display:inline-flex;align-items:center;gap:6px;padding:3px 6px;border:0;border-radius:var(--dsw-radius-sm,6px);background:transparent;color:inherit;font:inherit;cursor:pointer}
.dshc-bar__label:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14))}
.dshc-bar__count{font-weight:600}
.dshc-chev{font-size:10px;color:var(--dsw-alias-label-secondary,#9aa0ad)}
.dshc-stats{display:flex;gap:8px;font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);font-size:11.5px}
.dshc-plus{color:var(--dsw-alias-state-success-primary,#57c56f)}
.dshc-minus{color:var(--dsw-alias-state-error-primary,#f07070)}
.dshc-spacer{flex:1}
.dshc-act{padding:5px 12px;border:0;border-radius:var(--dsw-radius-sm,6px);background:transparent;color:inherit;font:inherit;cursor:pointer;white-space:nowrap}
.dshc-act:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14))}
.dshc-act--primary{background:var(--dsw-alias-button-contrast-fill,#f2f3f5);color:var(--dsw-alias-label-primary-inverted,#17181c);font-weight:600}
.dshc-act--primary:hover{background:var(--dsw-alias-button-contrast-fill,#ffffff);filter:brightness(1.04)}
.dshc-act:disabled,.dshc-btn:disabled,.dshc-mini:disabled{opacity:.45;cursor:default}
.dshc-list{margin-top:8px;border:1px solid var(--dsw-alias-border-l2,#303239);border-radius:var(--dsw-radius-md,10px);background:var(--dsw-alias-bg-layer-1,#1f2024);overflow:hidden;max-height:236px;overflow-y:auto}
.dshc-row{display:flex;align-items:center;gap:10px;padding:7px 12px;border-top:1px solid var(--dsw-alias-border-l2,#303239);font-size:12px}
.dshc-row:first-child{border-top:0}
.dshc-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14))}
.dshc-row__open{display:flex;align-items:center;gap:10px;flex:1;min-width:0;padding:0;border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.dshc-row__open:focus-visible,.dshc-file:focus-visible,.dshc-ref:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#6c8cff));outline-offset:-2px}
.dshc-path{flex:1;min-width:0;font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);font-size:11.5px;color:var(--dsw-alias-label-primary,#d7dae1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl;unicode-bidi:plaintext;text-align:left}
.dshc-mini{padding:2px 8px;border:1px solid var(--dsw-alias-border-l2,#303239);border-radius:var(--dsw-radius-sm,6px);background:transparent;color:var(--dsw-alias-label-secondary,#9aa0ad);font:inherit;font-size:11px;cursor:pointer;flex:none}
.dshc-mini:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14));color:var(--dsw-alias-label-primary,#f2f3f5)}
.dshc-mini--danger:hover{color:var(--dsw-alias-state-error-primary,#f07070);border-color:var(--dsw-alias-state-error-primary,#f07070);background:var(--dsw-alias-interactive-bg-hover-danger,rgba(240,112,112,.12))}
.dshc-note{flex:none;font-size:11.5px;color:var(--dsw-alias-state-warn-primary,#e0a44a)}
.dshc-bad{flex:none;font-size:11.5px;color:var(--dsw-alias-state-error-primary,#f07070)}
.dshc-ok{flex:none;font-size:11.5px;color:var(--dsw-alias-state-success-primary,#57c56f)}
.dshc-muted{flex:none;font-size:11.5px;color:var(--dsw-alias-label-tertiary,#6f7683)}
.dshc-panel{display:flex;flex-direction:column;height:100%;min-height:0;color:var(--dsw-alias-label-primary,#f2f3f5);font-size:13px}
.dshc-panel__head{display:flex;align-items:center;gap:10px;padding:9px 12px;border-bottom:1px solid var(--dsw-alias-border-l2,#303239);flex:none}
.dshc-panel__title{font-size:13.5px;font-weight:600}
.dshc-badge{font-size:11px;font-family:var(--dsw-font-mono,ui-monospace,Menlo,Consolas,monospace);color:var(--dsw-alias-label-secondary,#9aa0ad);border:1px solid var(--dsw-alias-border-l2,#303239);border-radius:999px;padding:0 6px}
.dshc-select{background:var(--dsw-alias-fill-l1,rgba(127,127,127,.12));color:var(--dsw-alias-label-primary,#f2f3f5);border:1px solid var(--dsw-alias-border-l2,#303239);border-radius:var(--dsw-radius-sm,6px);padding:4px 6px;font-size:12px;font-family:inherit;cursor:pointer}
.dshc-select:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#6c8cff));outline-offset:1px}
.dshc-tools{display:flex;gap:6px;padding:7px 10px;border-bottom:1px solid var(--dsw-alias-border-l2,#303239);flex-wrap:wrap;flex:none;align-items:center}
.dshc-btn{background:var(--dsw-alias-fill-l1,rgba(127,127,127,.12));color:var(--dsw-alias-label-primary,#f2f3f5);border:1px solid var(--dsw-alias-border-l2,#303239);border-radius:var(--dsw-radius-sm,6px);padding:4px 10px;font:inherit;font-size:12px;cursor:pointer}
.dshc-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.16))}
.dshc-btn--danger{color:var(--dsw-alias-state-error-primary,#f07070);border-color:var(--dsw-alias-state-error-primary,#f07070)}
.dshc-btn--danger:hover{background:var(--dsw-alias-interactive-bg-hover-danger,rgba(240,112,112,.12))}
.dshc-body{flex:1;display:flex;min-height:0}
.dshc-files{width:45%;min-width:120px;border-right:1px solid var(--dsw-alias-border-l2,#303239);overflow-y:auto}
.dshc-file{display:flex;align-items:center;gap:8px;width:100%;padding:7px 10px;cursor:pointer;border:0;border-left:2px solid transparent;background:transparent;color:inherit;font:inherit;text-align:left}
.dshc-file:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14))}
.dshc-file[data-selected="true"]{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14));border-left-color:var(--dsw-alias-state-business-primary,#6c8cff)}
.dshc-file[data-handled="true"]{opacity:.55}
.dshc-file__path{flex:1;min-width:0;font-family:var(--dsw-font-mono,ui-monospace,Menlo,Consolas,monospace);font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl;unicode-bidi:plaintext;text-align:left}
.dshc-file__stat{flex:none;display:flex;gap:6px;font-family:var(--dsw-font-mono,ui-monospace,Menlo,Consolas,monospace);font-size:11px}
.dshc-diff{flex:1;display:flex;flex-direction:column;min-width:0}
.dshc-diff__head{display:flex;align-items:center;gap:8px;padding:7px 10px;border-bottom:1px solid var(--dsw-alias-border-l2,#303239);background:var(--dsw-alias-fill-l1,rgba(127,127,127,.1));font-size:11.5px;flex:none}
.dshc-diff__path{flex:1;min-width:0;font-family:var(--dsw-font-mono,ui-monospace,Menlo,Consolas,monospace);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshc-progress{flex:none;color:var(--dsw-alias-label-secondary,#9aa0ad);font-family:var(--dsw-font-mono,ui-monospace,Menlo,Consolas,monospace);font-size:11px}
.dshc-diff__body{flex:1;overflow:auto;font-family:var(--dsw-font-mono,ui-monospace,Menlo,Consolas,monospace);font-size:12px;line-height:22px}
.dshc-hunk{border-bottom:1px solid var(--dsw-alias-border-l2,#303239);scroll-margin-top:6px}
.dshc-hunk[data-active="true"]{box-shadow:inset 3px 0 0 var(--dsw-alias-state-business-primary,#6c8cff)}
.dshc-hunk[data-state="accept"]{opacity:.5}
.dshc-hunk[data-state="reject"]{opacity:.5}
.dshc-hunk__head{display:flex;align-items:center;gap:8px;padding:3px 10px;min-width:100%;width:max-content;box-sizing:border-box;background:var(--dsw-alias-fill-l1,rgba(127,127,127,.1));color:var(--dsw-alias-label-secondary,#9aa0ad);font-size:11px}
.dshc-hunk__range{font-family:var(--dsw-font-mono,ui-monospace,Menlo,Consolas,monospace)}
.dshc-hunk__round{flex:none;font-size:10.5px;color:var(--dsw-alias-label-tertiary,#6f7683);border:1px solid var(--dsw-alias-border-l2,#303239);border-radius:var(--dsw-radius-xs,4px);padding:0 5px;white-space:nowrap}
/* Line rendering follows the host's own diff: the row background marks the
   change, the gutter and the sign carry its colour, and the CODE TEXT keeps the
   primary label colour so it stays readable. */
.dshc-line{display:flex;white-space:pre;min-width:100%;width:max-content;box-sizing:border-box;color:var(--dsw-alias-label-primary,#f2f3f5)}
.dshc-line__no{width:46px;flex:none;text-align:right;padding-right:8px;color:var(--dsw-alias-label-tertiary,#6f7683);user-select:none}
.dshc-line__sign{width:14px;flex:none;text-align:center;user-select:none;color:var(--dsw-alias-label-tertiary,#6f7683)}
.dshc-line__txt{flex:1;padding-right:10px;color:inherit}
.dshc-line[data-kind="ctx"] .dshc-line__txt{color:var(--dsw-alias-label-secondary,#aab0bd)}
.dshc-line[data-kind="add"]{--dshc-gutter:var(--dsw-alias-file-diff-added-gutter,rgba(87,197,111,.18));--dshc-marker:var(--dsw-alias-file-diff-added-marker,#57c56f);background:var(--dsw-alias-file-diff-added-bg,rgba(87,197,111,.12))}
.dshc-line[data-kind="del"]{--dshc-gutter:var(--dsw-alias-file-diff-deleted-gutter,rgba(240,112,112,.18));--dshc-marker:var(--dsw-alias-file-diff-deleted-marker,#f07070);background:var(--dsw-alias-file-diff-deleted-bg,rgba(240,112,112,.12))}
.dshc-line[data-kind="add"] .dshc-line__no,.dshc-line[data-kind="del"] .dshc-line__no{background:var(--dshc-gutter);color:var(--dshc-marker);font-weight:600}
.dshc-line[data-kind="add"] .dshc-line__sign,.dshc-line[data-kind="del"] .dshc-line__sign{color:var(--dshc-marker);font-weight:700}
/* Code text keeps the add/remove hue but is lifted toward the primary label, so
   it separates from its own row tint by lightness instead of matching it. The
   mix resolves per theme: lighter on a dark surface, darker on a light one. */
.dshc-line[data-kind="add"] .dshc-line__txt,.dshc-line[data-kind="del"] .dshc-line__txt{color:color-mix(in srgb, var(--dshc-marker) 58%, var(--dsw-alias-label-primary,#f2f3f5))}
.dshc-placeholder{padding:16px 14px;font-size:12px;color:var(--dsw-alias-label-secondary,#9aa0ad);line-height:1.6}
.dshc-error{padding:8px 12px;font-size:12px;color:var(--dsw-alias-state-error-primary,#f07070);border-bottom:1px solid var(--dsw-alias-border-l2,#303239);display:flex;gap:8px;align-items:center}
.dshc-chip{flex:none;font-family:var(--dsw-font-mono,ui-monospace,Menlo,Consolas,monospace);font-size:10.5px;color:var(--dsw-alias-label-secondary,#9aa0ad);border:1px solid var(--dsw-alias-border-l2,#303239);border-radius:var(--dsw-radius-xs,4px);padding:0 4px}
.dshc-fold{display:flex;align-items:center;gap:8px;min-width:100%;width:max-content;box-sizing:border-box;padding:3px 10px;border:0;border-top:1px solid var(--dsw-alias-border-l2,#303239);border-bottom:1px solid var(--dsw-alias-border-l2,#303239);background:var(--dsw-alias-fill-l2,rgba(127,127,127,.08));color:var(--dsw-alias-label-tertiary,#6f7683);font:inherit;font-size:10.5px;cursor:pointer;text-align:left}
.dshc-fold:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.16));color:var(--dsw-alias-label-secondary,#9aa0ad)}
.dshc-fold__sign{font-family:var(--dsw-font-mono,ui-monospace,Menlo,Consolas,monospace)}

.dshc-cfg{display:flex;align-items:flex-start;gap:16px;padding:14px;border:1px solid var(--dsw-alias-border-l2,#303239);border-radius:var(--dsw-radius-md,10px);background:var(--dsw-alias-fill-l1,rgba(127,127,127,.06));color:var(--dsw-alias-label-primary,#f2f3f5);font-size:13px}
.dshc-cfg__main{min-width:0;flex:1}
.dshc-cfg__title{font-size:13px;font-weight:600}
.dshc-cfg__desc{margin-top:4px;font-size:12px;color:var(--dsw-alias-label-secondary,#9aa0ad);line-height:1.55}
.dshc-cfg__note{margin-top:8px;font-size:11.5px;color:var(--dsw-alias-label-tertiary,#6f7683);line-height:1.5}
.dshc-cfg__ctrl{display:flex;align-items:center;gap:8px;flex:none;padding-top:2px}
.dshc-switch{position:relative;width:40px;height:22px;flex:none;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,#303239);background:var(--dsw-alias-fill-l2,rgba(127,127,127,.22));cursor:pointer;padding:0;transition:background .18s ease,border-color .18s ease}
.dshc-switch::after{content:'';position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-label-secondary,#b9bec9);transition:transform .18s ease,background .18s ease}
.dshc-switch[aria-checked="true"]{background:var(--dsw-alias-state-business-primary,#4c6ef5);border-color:var(--dsw-alias-state-business-primary,#4c6ef5)}
.dshc-switch[aria-checked="true"]::after{transform:translateX(18px);background:var(--dsw-alias-label-on-color,#fff)}
.dshc-switch:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#6c8cff));outline-offset:2px}
.dshc-switch:disabled{opacity:.6;cursor:default}
`

    function Styles() {
      return h('style', { 'data-dsh-changes': 'styles' }, CSS)
    }

    /**
     * A thrown render would blank the whole slot entry, so each surface is
     * wrapped and degrades to a one-line notice instead.
     */
    class Boundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { message: '' }
      }

      static getDerivedStateFromError(error) {
        return { message: error instanceof Error ? error.message : String(error) }
      }

      componentDidCatch(error) {
        try {
          // The page's console is the only channel available to a client
          // module; never let diagnostics escalate.
          console.error('[dsh-changes]', error)
        } catch {
          // ignore
        }
      }

      render() {
        if (this.state.message === '') return this.props.children
        return h(
          'div',
          { className: this.props.className ?? 'dshc-placeholder', role: 'alert' },
          `${this.props.label ?? '变更'}`, '：', this.state.message,
        )
      }
    }

    // -------------------------------------------------------------- components

    function listIcon() {
      return h(
        'svg',
        { width: 13, height: 13, viewBox: '0 0 16 16', 'aria-hidden': true },
        h('path', {
          d: 'M5.2 4h8.3M5.2 8h8.3M5.2 12h8.3',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
          fill: 'none',
        }),
        h('circle', { cx: 2.6, cy: 4, r: 0.9, fill: 'currentColor' }),
        h('circle', { cx: 2.6, cy: 8, r: 0.9, fill: 'currentColor' }),
        h('circle', { cx: 2.6, cy: 12, r: 0.9, fill: 'currentColor' }),
      )
    }

    function formatStat(value) {
      const number = Number.isFinite(value) ? value : 0
      return number
    }

    function shorten(path) {
      const parts = path.split(/[\\/]/)
      return parts.length <= 3 ? path : `…/${parts.slice(-2).join('/')}`
    }

    /** The composer-adjacent review bar: the plugin's only change hint. */
    function ChangesBar(props) {
      const sessionId = props.sessionId
      const [open, setOpen] = useState(false)
      const [busy, setBusy] = useState('')
      const [notice, setNotice] = useState(undefined)
      const [nonce, setNonce] = useState(0)
      useStore(localeStore)

      const live = useLive(true, sessionId, 'state', null, 1500, nonce)
      const data = live.data
      // Files, not batches: a path appears once and stays pending while any of
      // its rounds is unconfirmed.
      const pending = data?.ok === true ? data.pending : 0

      const flash = useCallback((text, bad) => {
        setNotice({ text, bad })
      }, [])

      useEffect(() => {
        if (notice === undefined) return undefined
        const timer = setTimeout(() => setNotice(undefined), 2400)
        return () => clearTimeout(timer)
      }, [notice])

      const run = useCallback(async (label, payload) => {
        setBusy(label)
        try {
          const result = await sendAction({ sessionId, ...payload })
          if (result?.ok !== true) flash(result?.error ?? '操作失败', true)
          return result
        } catch (error) {
          flash(error instanceof Error ? error.message : String(error), true)
          return { ok: false }
        } finally {
          setBusy('')
          setNonce((value) => value + 1)
        }
      }, [sessionId, flash])

      // A broken data path is still a change hint: say so inline instead of
      // going quiet while changes sit unreviewed.
      if (data === undefined && live.error === '') return null
      if (data === undefined || data.ok === false) {
        const failure = live.error !== ''
          ? live.error
          : data?.code === 'no-recorder' ? t('bar.broken') : data?.error ?? t('bar.failed')
        return h(
          'div',
          { className: 'dshc-dock' },
          h(Styles),
          h(
            'div',
            { className: 'dshc-bar', role: 'alert' },
            h('span', { className: 'dshc-bad' }, failure),
            h('span', { className: 'dshc-spacer' }),
            h('button', {
              type: 'button',
              className: 'dshc-mini',
              onClick: () => setNonce((value) => value + 1),
            }, t('bar.retry')),
          ),
        )
      }
      // Nothing left to review: the bar retreats — unless a result is still
      // being reported, which must not be swallowed by its own disappearance.
      if (pending === 0 && notice === undefined) return null

      const totals = data?.totals ?? { added: 0, deleted: 0 }
      const rows = (data?.files ?? []).filter((file) => !file.handled)

      if (pending === 0) {
        return h(
          'div',
          { className: 'dshc-dock' },
          h(Styles),
          h(
            'div',
            { className: 'dshc-bar' },
            h('span', { className: 'dshc-bar__icon', 'aria-hidden': true }, listIcon()),
            h('span', { className: 'dshc-muted' }, t('bar.empty')),
            h('span', { className: 'dshc-spacer' }),
            h('span', { className: notice.bad ? 'dshc-bad' : 'dshc-ok' }, notice.text),
          ),
        )
      }

      const reportDrop = (result) => {
        if (result?.ok === true) {
          const skipped = result.skipped?.length ?? 0
          if (skipped > 0) flash(t('bar.droppedSome', { handled: result.handled ?? 0, skipped }), true)
          else flash(t('bar.droppedAll'), false)
          return
        }
        flash(result?.failures?.[0] ?? result?.error ?? t('bar.failed'), true)
      }

      return h(
        'div',
        { className: 'dshc-dock' },
        h(Styles),
        h(
          'div',
          { className: 'dshc-bar' },
          h(
            'button',
            {
              type: 'button',
              className: 'dshc-bar__icon',
              title: open ? t('bar.collapse') : t('bar.expand'),
              'aria-expanded': open,
              onClick: () => setOpen((value) => !value),
            },
            listIcon(),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dshc-bar__label',
              onClick: () => setOpen((value) => !value),
            },
            h('span', { className: 'dshc-bar__count', role: 'status', 'aria-live': 'polite' },
              t('bar.pending', { count: pending })),
            
            h('span', { className: 'dshc-chev', 'aria-hidden': true }, open ? '▴' : '▾'),
          ),
          h(
            'span',
            { className: 'dshc-stats' },
            h('span', { className: 'dshc-plus' }, `+${formatStat(totals.added)}`),
            h('span', { className: 'dshc-minus' }, `−${formatStat(totals.deleted)}`),
          ),
          h('span', { className: 'dshc-spacer' }),
          notice !== undefined
            ? h('span', { className: notice.bad ? 'dshc-bad' : 'dshc-ok' }, notice.text)
            : null,
          h(
            'button',
            {
              type: 'button',
              className: 'dshc-act',
              disabled: busy !== '',
              onClick: async () => {
                if (!window.confirm(t('bar.confirmAll', { count: pending }))) return
                reportDrop(await run('all', { op: 'rejectAll' }))
              },
            },
            t('bar.dropAll'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dshc-act dshc-act--primary',
              disabled: busy !== '',
              onClick: async () => {
                const result = await run('all', { op: 'acceptAll' })
                if (result?.ok === true) flash(t('bar.keptAll'), false)
                else flash(result?.failures?.[0] ?? result?.error ?? t('bar.failed'), true)
              },
            },
            t('bar.keepAll'),
          ),
        ),
        live.error !== '' && data !== undefined
          ? h(
            'div',
            { className: 'dshc-list' },
            h(
              'div',
              { className: 'dshc-row' },
              h('span', { className: 'dshc-bad' }, live.error),
              h('span', { className: 'dshc-spacer' }),
              h('button', {
                type: 'button',
                className: 'dshc-mini',
                onClick: () => setNonce((value) => value + 1),
              }, t('bar.retry')),
            ),
          )
          : null,
        open
          ? h(
            'div',
            { className: 'dshc-list' },
            rows.map((file) => h(
              'div',
              { key: file.path, className: 'dshc-row' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'dshc-row__open',
                  title: file.display,
                  onClick: () => runtime.openPanel(file.path),
                },
                h('span', { className: 'dshc-path', title: file.display }, file.display),
                h(
                  'span',
                  { className: 'dshc-stats' },
                  h('span', { className: 'dshc-plus' }, `+${formatStat(file.added)}`),
                  h('span', { className: 'dshc-minus' }, `−${formatStat(file.deleted)}`),
                ),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dshc-mini',
                  disabled: busy !== '',
                  onClick: async () => {
                    const result = await run(file.path, { op: 'acceptFile', path: file.path })
                    if (result?.ok === true) flash(t('bar.keepOne', { name: shorten(file.display) }), false)
                  },
                },
                t('bar.keep'),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dshc-mini dshc-mini--danger',
                  disabled: busy !== '' || file.binary === true || file.oversized === true,
                  title: file.binary === true
                    ? t('bar.binaryOnly')
                    : file.oversized === true ? t('bar.oversizedOnly') : '',
                  onClick: async () => {
                    const result = await run(file.path, { op: 'revertFile', path: file.path })
                    if (result?.ok === true) flash(t('bar.dropOne', { name: shorten(file.display) }), false)
                    else flash(result?.error ?? t('bar.failed'), true)
                  },
                },
                t('bar.drop'),
              ),
            )),
          )
          : null,
      )
    }

    /**
     * One row per diff line, with a single line number.
     *
     * A unified diff needs one column, not two: an added line shows its number on
     * the new side, a removed line on the old side, and the `+`/`-` sign says
     * which. Context lines show the new-side number.
     */
    function hunkRows(hunk) {
      const rows = []
      let oldNo = hunk.oldStart
      let newNo = hunk.newStart
      for (const line of hunk.lines ?? []) {
        const prefix = line.slice(0, 1)
        const text = line.slice(1)
        if (prefix === '+') rows.push({ kind: 'add', text, sign: '+', no: newNo++ })
        else if (prefix === '-') rows.push({ kind: 'del', text, sign: '-', no: oldNo++ })
        else {
          oldNo += 1
          rows.push({ kind: 'ctx', text, sign: ' ', no: newNo++ })
        }
      }
      return rows
    }

    function HunkView(props) {
      const { hunk, state, active, round, originTurn, coarse } = props
      const ref = useRef(null)
      useEffect(() => {
        if (active && ref.current) ref.current.scrollIntoView({ block: 'nearest' })
      }, [active])
      const rows = hunkRows(hunk)
      // The round annotation rides in the hunk header, after the range: it reads
      // as a note on that hunk rather than a divider between sections, it cannot
      // overlap anything while scrolling, and it never touches a code line.
      const range = `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`
      return h(
        'div',
        {
          ref,
          className: 'dshc-hunk',
          'data-active': active,
          'data-state': state ?? undefined,
        },
        h(
          'div',
          { className: 'dshc-hunk__head' },
          h('span', { className: 'dshc-hunk__range' }, range),
          round === undefined
            ? null
            : h('span', {
              className: 'dshc-hunk__round',
              title: t('panel.roundHint', { count: round, turn: originTurn ?? '?' }),
            }, t('panel.roundShort', { count: round })),
          coarse === true ? h('span', { className: 'dshc-hunk__round' }, t('panel.coarseTag')) : null,
        ),
        rows.map((row, index) => h(
          'div',
          { key: index, className: 'dshc-line', 'data-kind': row.kind },
          h('span', { className: 'dshc-line__no' }, String(row.no)),
          // The sign carries the add/remove colour; the code text stays at the
          // primary label colour so it remains readable, which is how the host's
          // own diff renders lines.
          h('span', { className: 'dshc-line__sign' }, row.sign),
          h('span', { className: 'dshc-line__txt' }, row.text),
        )),
      )
    }

    /** The right sidebar page: per-file hunks, baseline switching, whole-area rollback. */
    function ChangesPanel(props) {
      const sessionId = props.sessionId
      const [nonce, setNonce] = useState(0)
      // A selection is one file of one batch: the same path can appear in
      // several batches, and each keeps its own decision.
      const [selected, setSelected] = useState({ path: '', seq: undefined })
      const [baseline, setBaseline] = useState('snapshot')
      const [ref, setRef] = useState('')
      const [busy, setBusy] = useState('')
      const [notice, setNotice] = useState(undefined)
      const [error, setError] = useState('')
      const focus = useStore(focusStore)
      useStore(localeStore)

      const live = useLive(true, sessionId, 'state', null, 2000, nonce)
      const data = live.data

      // A click in the bar names the file this page should show.
      useEffect(() => {
        if (focus.path !== '') setSelected({ path: focus.path, seq: undefined })
      }, [focus.rev])

      // One row per file: a file stays pending while ANY batch that touched it
      // is unconfirmed, so the list never repeats a path.
      const files = data?.ok === true ? data.files ?? [] : []

      useEffect(() => {
        if (selected.path !== '') return
        const first = files.find((file) => !file.handled) ?? files[0]
        if (first !== undefined) setSelected({ path: first.path, seq: undefined })
      }, [files.length, data?.ok])

      const vcs = data?.vcs ?? { kind: null, reason: '' }
      const vcsKind = vcs.kind === 'git' || vcs.kind === 'svn' ? vcs.kind : null

      // One continuous diff of the whole file, annotated per hunk by the round
      // that first introduced it.
      const diffLive = useLive(
        baseline === 'snapshot' && selected.path !== '',
        sessionId,
        'diff',
        { path: selected.path },
        2500,
        nonce,
      )
      const diff = diffLive.data
      const refsLive = useLive(baseline !== 'snapshot' && vcsKind !== null, sessionId, 'refs', { kind: vcsKind ?? '' }, 60000, nonce)
      const refFilesLive = useLive(baseline !== 'snapshot' && ref !== '', sessionId, 'ref-files', { kind: vcsKind ?? '', ref }, 60000, nonce)

      const hunks = useMemo(
        () => (diff?.ok === true && diff.kind === 'text' ? diff.hunks ?? [] : []),
        [diff],
      )
      const current = diff?.ok === true ? diff.cursor : undefined
      const progress = diff?.ok === true ? diff.progress ?? { decided: 0, total: 0 } : { decided: 0, total: 0 }

      // Fold state per untouched region: keyed by position so expanding one does
      // not disturb the others. Collapsed by default, like an SVN diff.
      const [expanded, setExpanded] = useState({})
      // The file text is needed for every fold — its line count decides how many
      // lines each untouched region hides, and expanding renders the real lines.
      const fileText = useLive(
        baseline === 'snapshot' && selected.path !== '',
        sessionId,
        'file',
        { path: selected.path },
        60000,
        nonce,
      )
      const fileLines = useMemo(() => {
        const text = fileText.data?.ok === true ? fileText.data.text : undefined
        return text === undefined ? [] : text.split('\n')
      }, [fileText.data])

      const flash = useCallback((text, bad) => {
        setNotice({ text, bad })
      }, [])

      useEffect(() => {
        if (notice === undefined) return undefined
        const timer = setTimeout(() => setNotice(undefined), 2600)
        return () => clearTimeout(timer)
      }, [notice])

      const run = useCallback(async (payload) => {
        setBusy(payload.op)
        setError('')
        try {
          const result = await sendAction({ sessionId, ...payload })
          if (result?.ok !== true) setError(result?.error ?? t('panel.failed'))
          return result
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : String(caught))
          return { ok: false }
        } finally {
          setBusy('')
          setNonce((value) => value + 1)
        }
      }, [sessionId])

      // -------------------------------------------------------------- render

      if (data === undefined) {
        return h('div', { className: 'dshc-panel' }, h(Styles), h('div', { className: 'dshc-placeholder' }, t('panel.loading')))
      }

      if (data.ok === false) {
        return h(
          'div',
          { className: 'dshc-panel' },
          h(Styles),
          h('div', { className: 'dshc-panel__head' }, h('span', { className: 'dshc-panel__title' }, t('tab.title'))),
          h('div', { className: 'dshc-error' }, data.code === 'no-recorder' ? t('err.no-recorder') : data.error ?? t('panel.loadFailed')),
          h(
            'div',
            { className: 'dshc-placeholder' },
            h('button', {
              type: 'button',
              className: 'dshc-btn',
              onClick: () => setNonce((value) => value + 1),
            }, t('panel.reload')),
          ),
        )
      }

      // The badge counts pending files; the batch count tells how many review
      // rounds those files came from.
      const pendingCount = files.filter((file) => !file.handled).length
      const head = h(
        'div',
        { className: 'dshc-panel__head' },
        h('span', { className: 'dshc-panel__title' }, t('tab.title')),
        h('span', { className: 'dshc-badge' }, String(pendingCount)),
        
        data.restored === true ? h('span', { className: 'dshc-muted' }, t('panel.restoredBadge')) : null,
        h('span', { className: 'dshc-spacer' }),
        h(
          'select',
          {
            className: 'dshc-select',
            value: baseline,
            'aria-label': t('panel.baselineLabel'),
            onChange: (event) => {
              setBaseline(event.target.value)
              setRef('')
            },
          },
          h('option', { value: 'snapshot' }, t('panel.baseline', { name: t('base.snapshot') })),
          h('option', { value: 'git', disabled: vcsKind !== 'git' }, t('panel.baseline', { name: t('base.git') })),
          h('option', { value: 'svn', disabled: vcsKind !== 'svn' }, t('panel.baseline', { name: t('base.svn') })),
        ),
      )

      const vcsRefs = refsLive.data?.ok === true ? refsLive.data.refs ?? [] : []
      const selectedRefFiles = refFilesLive.data?.ok === true ? refFilesLive.data.files ?? [] : []

      const reportDrop = (result) => {
        if (result?.ok === true) {
          const skipped = result.skipped?.length ?? 0
          if (skipped > 0) flash(t('bar.droppedSome', { handled: result.handled ?? 0, skipped }), true)
          else flash(t('bar.droppedAll'), false)
          return
        }
        flash(result?.failures?.[0] ?? result?.error ?? t('panel.failed'), true)
      }

      const tools = h(
        'div',
        { className: 'dshc-tools' },
        h('button', {
          type: 'button',
          className: 'dshc-btn',
          disabled: busy !== '' || pendingCount === 0,
          onClick: async () => {
            const result = await run({ op: 'acceptAll' })
            if (result?.ok === true) flash(t('bar.keptAll'), false)
            else flash(result?.failures?.[0] ?? result?.error ?? t('panel.failed'), true)
          },
        }, t('panel.acceptAll')),
        h('button', {
          type: 'button',
          className: 'dshc-btn',
          disabled: busy !== '' || pendingCount === 0,
          onClick: async () => {
            if (!window.confirm(t('bar.confirmAll', { count: pendingCount }))) return
            reportDrop(await run({ op: 'rejectAll' }))
          },
        }, t('panel.rejectAll')),
        h('button', {
          type: 'button',
          className: 'dshc-btn dshc-btn--danger',
          disabled: busy !== '' || baseline === 'snapshot' || ref === '',
          title: baseline === 'snapshot' ? t('panel.rollbackHint') : ref === '' ? t('panel.pickRefFirst') : '',
          onClick: async () => {
            if (!window.confirm(t('panel.rollbackConfirm', { ref }))) return
            const result = await run({ op: 'rollback', kind: baseline, ref })
            if (result?.ok === true) {
              flash(t('panel.rolledBack', { ref }), false)
              setSelected({ path: '', seq: undefined })
              setRef('')
            }
          },
        }, t('panel.rollback')),
        notice !== undefined ? h('span', { className: notice.bad ? 'dshc-bad' : 'dshc-ok' }, notice.text) : null,
        // A missing repository is the reason the VCS baselines are disabled.
        vcsKind === null && vcs.reason
          ? h('span', { className: 'dshc-muted' }, vcs.reason)
          : null,
      )

      if (baseline !== 'snapshot') {
        const refList = h(
          'div',
          { className: 'dshc-files' },
          vcsRefs.length === 0
            ? h('div', { className: 'dshc-placeholder' }, refsLive.loading ? t('panel.loading') : t('panel.refEmpty'))
            : vcsRefs.map((item) => h(
              'button',
              {
                key: item.id,
                type: 'button',
                className: 'dshc-file',
                'data-selected': item.id === ref,
                title: item.label,
                onClick: () => setRef(item.id),
              },
              h('span', { className: 'dshc-chip' }, item.id),
              h('span', { className: 'dshc-file__path' }, item.label || item.id),
            )),
        )
        const REF_FILE_LIMIT = 200
        const shownRefFiles = selectedRefFiles.slice(0, REF_FILE_LIMIT)
        const refPanel = h(
          'div',
          { className: 'dshc-diff' },
          h(
            'div',
            { className: 'dshc-diff__head' },
            h('span', { className: 'dshc-diff__path' }, ref === '' ? t('panel.refPick') : ref),
          ),
          ref === ''
            ? h('div', { className: 'dshc-placeholder' }, t('panel.refPick'))
            : selectedRefFiles.length === 0
              ? h('div', { className: 'dshc-placeholder' }, refFilesLive.loading ? t('panel.loading') : t('panel.empty'))
              : h(
                'div',
                { className: 'dshc-files', style: { width: '100%', borderRight: 'none' } },
                shownRefFiles.map((file, index) => h(
                  'button',
                  {
                    key: `${index}:${file.display}`,
                    type: 'button',
                    className: 'dshc-file',
                    title: file.display,
                    onClick: () => {
                      setBaseline('snapshot')
                      setSelected({ path: file.display, seq: undefined })
                    },
                  },
                  h('span', { className: 'dshc-chip' }, file.status),
                  h('span', { className: 'dshc-file__path' }, file.display),
                )),
                selectedRefFiles.length > REF_FILE_LIMIT
                  ? h('div', { className: 'dshc-placeholder' }, t('panel.refTooMany', {
                    shown: REF_FILE_LIMIT,
                    rest: selectedRefFiles.length - REF_FILE_LIMIT,
                  }))
                  : null,
              ),
        )
        return h(
          'div',
          { className: 'dshc-panel' },
          h(Styles),
          head,
          tools,
          error !== '' ? h('div', { className: 'dshc-error' }, error) : null,
          h('div', { className: 'dshc-body' }, refList, refPanel),
        )
      }

      if (files.length === 0) {
        return h(
          'div',
          { className: 'dshc-panel' },
          h(Styles),
          head,
          h('div', { className: 'dshc-placeholder' }, t('panel.empty')),
        )
      }

      // One row per changed file. A file touched by several rounds appears once
      // and stays pending until every round touching it is confirmed.
      const fileList = h(
        'div',
        { className: 'dshc-files' },
        files.map((file) => h(
          'button',
          {
            key: file.path,
            type: 'button',
            className: 'dshc-file',
            'data-selected': file.path === selected.path,
            'data-handled': file.handled === true,
            title: file.display,
            onClick: () => setSelected({ path: file.path, seq: undefined }),
          },
          h('span', { className: 'dshc-file__path' }, file.display),
          
          h(
            'span',
            { className: 'dshc-file__stat' },
            h('span', { className: 'dshc-plus' }, `+${formatStat(file.added)}`),
            h('span', { className: 'dshc-minus' }, `−${formatStat(file.deleted)}`),
          ),
        )),
      )

      let diffHead
      let diffBody

      const acceptFileButton = (path) => h('button', {
        type: 'button',
        className: 'dshc-btn',
        disabled: busy !== '',
        onClick: () => run({ op: 'acceptFile', path }),
      }, t('panel.accept'))

      if (diff === undefined) {
        diffHead = h('div', { className: 'dshc-diff__head' }, h('span', { className: 'dshc-diff__path' }, shorten(selected.path)))
        diffBody = h('div', { className: 'dshc-placeholder' }, t('panel.loading'))
      } else if (diff.ok === false) {
        diffHead = h(
          'div',
          { className: 'dshc-diff__head' },
          h('span', { className: 'dshc-diff__path' }, diff.path ?? shorten(selected.path)),
        )
        diffBody = h('div', { className: 'dshc-placeholder' }, diff.error ?? t('panel.diffUnavailable'))
      } else if (diff.kind === 'binary' || diff.kind === 'oversized' || diff.coarse === true || hunks.length === 0) {
        // Nothing hunk-level to review: only file-level actions apply.
        diffHead = h(
          'div',
          { className: 'dshc-diff__head' },
          h('span', { className: 'dshc-diff__path' }, diff.display ?? shorten(selected.path)),
          h('span', { className: 'dshc-progress' }, diff.kind === 'text' && hunks.length === 0 ? t('panel.noHunks') : ''),
          h('span', { className: 'dshc-spacer' }),
          acceptFileButton(diff.path),
        )
        diffBody = h(
          'div',
          { className: 'dshc-placeholder' },
          diff.kind === 'binary'
            ? t('panel.binary')
            : diff.kind === 'oversized'
              ? t('panel.oversized')
              : diff.coarse === true ? t('panel.coarse') : t('panel.noHunks'),
        )
      } else {
        diffHead = h(
          'div',
          { className: 'dshc-diff__head' },
          h('span', { className: 'dshc-diff__path' }, diff.display ?? shorten(selected.path)),
          h('span', { className: 'dshc-progress' }, current === undefined
            ? t('panel.allHandled')
            : t('panel.hunkProgress', { index: progress.decided + 1, total: progress.total })),
          current === undefined
            ? null
            : h('button', {
              type: 'button',
              className: 'dshc-btn',
              disabled: busy !== '',
              onClick: () => run({ op: 'acceptHunk', path: diff.path, hunkIdx: current.hunkIdx }),
            }, t('panel.accept')),
          current === undefined
            ? null
            : h('button', {
              type: 'button',
              className: 'dshc-btn dshc-btn--danger',
              disabled: busy !== '',
              onClick: () => run({ op: 'rejectHunk', path: diff.path, hunkIdx: current.hunkIdx }),
            }, t('panel.reject')),
        )

        // One continuous list in file order. Every untouched region — before the
        // first hunk, between hunks, and after the last one — folds into a single
        // expandable row, the way an SVN diff collapses unchanged text. A file
        // whose change is one isolated hunk still gets the two large folds around
        // it, which is why folding is no longer hit-or-miss.
        const rows = []
        let previousEnd = 1
        // The change ordinal last labelled, so consecutive hunks of the same
        // change share one tag instead of repeating it.
        let lastTagged
        // Total lines of the file on the new side; unknown until the text arrives.
        const totalLines = fileLines.length

        const pushFold = (key, from, to) => {
          const count = to - from + 1
          if (count <= 0) return
          const open = expanded[key] === true
          const known = totalLines >= to
          rows.push(h('button', {
            key,
            type: 'button',
            className: 'dshc-fold',
            disabled: !known,
            title: known ? (open ? t('diff.fold') : t('diff.expand')) : t('diff.foldUnavailable'),
            onClick: () => {
              if (!known) return
              setExpanded((value) => ({ ...value, [key]: !open }))
            },
          },
          h('span', { className: 'dshc-fold__sign' }, open && known ? '⌃' : '⋯'),
          h('span', null, known
            ? (open ? t('diff.foldHint') : t('diff.folded', { count }))
            : t('diff.foldedUnknown', { count })),
          ))
          if (!open || !known) return
          for (let line = from; line <= to; line += 1) {
            rows.push(h('div', { key: `${key}-${line}`, className: 'dshc-line', 'data-kind': 'ctx' },
              h('span', { className: 'dshc-line__no' }, String(line)),
              h('span', { className: 'dshc-line__sign' }, ' '),
              h('span', { className: 'dshc-line__txt' }, fileLines[line - 1] ?? ''),
            ))
          }
        }

        hunks.forEach((hunk, index) => {
          pushFold(`gap-${index}`, previousEnd, hunk.newStart - 1)
          // A tag names the change a hunk belongs to, so it is drawn only when
          // that changes: repeating "第 6 次改动" above every hunk of the same
          // change just adds headers. The tag rides in the header line, so it
          // never overlaps on scroll and never becomes part of a code line.
          const rounds = diff.rounds ?? 1
          const ordinal = hunk.round ?? rounds
          const showTag = rounds > 1 && ordinal !== lastTagged
          if (showTag) lastTagged = ordinal
          rows.push(h(HunkView, {
            key: `hunk-${hunk.idx}`,
            hunk,
            state: diff.states?.[hunk.idx],
            active: current !== undefined && current.hunkIdx === hunk.idx,
            round: showTag ? ordinal : undefined,
            originTurn: hunk.originTurn,
            coarse: diff.coarse === true,
          }))
          previousEnd = hunk.newStart + hunk.newLines
        })
        // The region after the last hunk, up to the end of the file.
        if (totalLines >= previousEnd) pushFold('tail', previousEnd, totalLines)
        diffBody = h('div', { className: 'dshc-diff__body' }, rows)
      }

      return h(
        'div',
        { className: 'dshc-panel' },
        h(Styles),
        head,
        tools,
        error !== '' ? h('div', { className: 'dshc-error' }, error) : null,
        h(
          'div',
          { className: 'dshc-body' },
          fileList,
          h('div', { className: 'dshc-diff' }, diffHead, diffBody),
        ),
      )
    }

    /**
     * The plugin's own configuration control, drawn on its bundle page.
     *
     * DSH renders no form from a plugin's `Config` alone: the Plugins page
     * declares `plugins.bundle.config` / `plugins.row.config` and renders
     * whichever occupant registers. For the bundle seat the page passes no
     * form, so the occupant reads the value and writes through the client
     * `configForms` service itself — the namespace is this plugin's row id.
     * The Host side must mark the field `.volatile()` for the namespace to
     * exist in that document at all.
     */
    const CONFIG_NS = 'dsh-changes'

    function NativeCardConfig(props) {
      const view = props.view
      const direct = props.form
      // The client service can arrive after this module loads, so resolution
      // retries a few times instead of latching `undefined` forever.
      const [attempt, setAttempt] = useState(0)
      const resolved = useMemo(() => {
        if (direct !== undefined) return direct
        try {
          const service = runtime.configForms()
          if (service === undefined) return undefined
          const created = service.get(CONFIG_NS)
          return {
            getSnapshot: () => created.getSnapshot(),
            subscribe: (listener) => created.subscribe(listener),
            set: (field, value) => created.set(field, value),
          }
        } catch {
          return undefined
        }
      }, [direct, attempt])

      useEffect(() => {
        if (resolved !== undefined || attempt >= 5) return undefined
        const timer = setTimeout(() => setAttempt((value) => value + 1), 400)
        return () => clearTimeout(timer)
      }, [resolved, attempt])

      const [, bump] = useState(0)
      useEffect(() => {
        if (resolved === undefined || typeof resolved.subscribe !== 'function') return undefined
        return resolved.subscribe(() => bump((value) => value + 1))
      }, [resolved])

      const snapshot = resolved === undefined
        ? undefined
        : typeof resolved.getSnapshot === 'function' ? resolved.getSnapshot() : resolved.state
      const value = snapshot?.value ?? {}
      const hidden = value.hideNativeChangesCard !== false
      const [pending, setPending] = useState(false)
      const [note, setNote] = useState('')
      const reported = useRef('')

      // One diagnostic per state, so the Host log can say what the page handed
      // over even when the rendered result cannot be seen here.
      useEffect(() => {
        const report = JSON.stringify({
          slot: props['data-slot'] ?? 'unknown',
          view,
          hasForm: direct !== undefined,
          hasService: resolved !== undefined,
          status: snapshot?.status ?? 'none',
          writable: snapshot?.writable,
          value: snapshot?.value,
        })
        if (reported.current === report) return
        reported.current = report
        void sendAction({ sessionId: '', op: 'debug', message: `config view ${report}` }).catch(() => {})
      }, [direct, resolved, snapshot?.status, snapshot?.writable, snapshot?.value])

      if (view === 'summary') return h('span', null, t('cfg.title'))

      const toggle = async () => {
        if (resolved === undefined || snapshot?.writable !== true || pending) return
        setPending(true)
        setNote('')
        try {
          const accepted = await resolved.set('hideNativeChangesCard', !hidden)
          if (!accepted) setNote(t('cfg.saveFailed'))
        } catch (error) {
          setNote(error instanceof Error ? error.message : String(error))
        } finally {
          setPending(false)
        }
      }

      const control = resolved === undefined
        ? h('span', { className: 'dshc-muted' }, t('cfg.noChannel'))
        : snapshot === undefined || snapshot.status === 'loading'
          ? h('span', { className: 'dshc-muted' }, t('panel.loading'))
          : snapshot.status === 'unavailable' || snapshot.writable !== true
            ? h('span', { className: 'dshc-muted' }, t('cfg.readOnly'))
            : h(
              'span',
              { className: 'dshc-cfg__ctrl' },
              h('span', { className: 'dshc-muted' }, hidden ? t('cfg.hidden') : t('cfg.shown')),
              h('button', {
                type: 'button',
                className: 'dshc-switch',
                role: 'switch',
                'aria-checked': hidden,
                'aria-label': t('cfg.title'),
                disabled: pending,
                onClick: toggle,
              }),
            )

      return h(
        'section',
        { className: 'dshc-cfg' },
        h(Styles),
        h(
          'div',
          { className: 'dshc-cfg__main' },
          h('div', { className: 'dshc-cfg__title' }, t('cfg.title')),
          h('div', { className: 'dshc-cfg__desc' }, t('cfg.desc')),
          h('div', { className: 'dshc-cfg__note' }, t('cfg.note')),
          note !== '' ? h('div', { className: 'dshc-bad' }, note) : null,
        ),
        control,
      )
    }

    // ---------------------------------------------------------------- activation

    return {
      inject: ['slots', 'locale', 'sidebarRightTabs', 'sidebarRight'],
      apply(ctx) {
        // Copy: register both dictionaries when the locale service accepts a
        // plain namespace, and fall back to the built-in zh table otherwise.
        try {
          ctx.locale.register('dshChanges', 'zh', DICT.zh)
          ctx.locale.register('dshChanges', 'en', DICT.en)
          const bound = ctx.locale.bind('dshChanges')
          runtime.translate = (key, params) => {
            let text
            try {
              text = bound(key, params)
            } catch {
              text = undefined
            }
            if (typeof text !== 'string' || text === key) return fill(DICT.zh[key] ?? key, params)
            return params === undefined ? text : fill(text, params)
          }
          ctx.effect(() => ctx.locale.subscribe(() => {
            localeStore.set({ rev: localeStore.get().rev + 1 })
          }), 'dsh-changes: locale changes')
        } catch {
          runtime.translate = (key, params) => fill(DICT.zh[key] ?? key, params)
        }

        runtime.configForms = () => ctx.get('configForms')

        runtime.openPanel = (path, seq) => {
          if (typeof path === 'string' && path !== '') {
            focusStore.set({ path, seq, rev: focusStore.get().rev + 1 })
          }
          try {
            ctx.sidebarRight.openTab(KIND)
          } catch {
            // Opening the page is best effort; the file is still selected.
          }
        }

        // The review bar above the composer.
        ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
          name: 'conversation.input.dock',
          id: BAR_ID,
          order: 25,
        }, (props) => h(
          Boundary,
          { className: 'dshc-bar', label: t('tab.title') },
          h(ChangesBar, props),
        )))

        // The right sidebar page type, plus its guide entry so the page is
        // reachable from the sidebar's own "+" catalog.
        ctx.effect(() => ctx.sidebarRightTabs.register({
          id: TAB_ID,
          kind: KIND,
          title: () => t('tab.title'),
          guide: [{
            id: 'changes',
            order: 30,
            title: () => t('tab.title'),
            description: () => t('tab.guide'),
          }],
        }), 'dsh-changes: tab type')

        ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab',
          key: TAB_ID,
        }, (props) => h(
          Boundary,
          { className: 'dshc-panel', label: t('tab.title') },
          h(ChangesPanel, props),
        ))), 'dsh-changes: panel body')

        // The configuration control on the Plugins page. The bundle key renders
        // it on this bundle's page; the row key gives the single row its own
        // configure page. Both are needed for either surface to exist at all.
        const packageName = 'dsh-changes'
        const rowId = 'dsh-changes'
        ctx.effect(() => ctx.slots.register({
          name: 'plugins.bundle.config',
          key: packageName,
        }, (props) => h(Boundary, { className: 'dshc-cfg', label: t('cfg.title') },
          h(NativeCardConfig, { ...props, 'data-slot': 'plugins.bundle.config' }))),
        'dsh-changes: bundle config')

        ctx.effect(() => ctx.slots.register({
          name: 'plugins.row.config',
          key: `${packageName}#${rowId}`,
        }, (props) => h(Boundary, { className: 'dshc-cfg', label: t('cfg.title') },
          h(NativeCardConfig, { ...props, 'data-slot': 'plugins.row.config' }))),
        'dsh-changes: row config')
      },
    }
  },
})
