/**
 * Stylesheet injected by the plugin.
 *
 * Colours come from VRCNext's CSS custom properties rather than literals, so the plugin follows
 * the user's theme — including custom themes — instead of fighting it.
 */

export const PLUGIN_CSS = `
.ex-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
  padding: 10px 0;
}

.ex-stat {
  background: var(--bg-input);
  border-radius: 10px;
  padding: 12px 14px;
}

.ex-stat-label {
  font-size: calc(11px + var(--fs-off, 0px));
  color: var(--tx3);
}

.ex-stat-value {
  font-size: calc(20px + var(--fs-off, 0px));
  font-weight: 600;
  color: var(--tx0);
  font-variant-numeric: tabular-nums;
}

.ex-log {
  max-height: 220px;
  overflow-y: auto;
  font-family: ui-monospace, monospace;
  font-size: calc(11px + var(--fs-off, 0px));
  color: var(--tx2);
  background: var(--bg-input);
  border-radius: 8px;
  padding: 8px 10px;
}

.ex-log-line { white-space: pre-wrap; word-break: break-word; }
.ex-log-line + .ex-log-line { margin-top: 3px; }
`;
