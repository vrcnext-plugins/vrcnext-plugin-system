/**
 * Stylesheet injected by the plugin.
 *
 * Colours come from VRCNext's CSS custom properties rather than literals, so the plugin follows
 * the user's theme — including custom themes — instead of fighting it.
 */

export const PLUGIN_CSS = `
.ks-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
  padding: 10px 0;
}

.ks-stat {
  background: var(--bg-input);
  border-radius: 10px;
  padding: 12px 14px;
}

.ks-stat-label {
  font-size: calc(11px + var(--fs-off, 0px));
  color: var(--tx3);
}

.ks-stat-value {
  font-size: calc(20px + var(--fs-off, 0px));
  font-weight: 600;
  color: var(--tx0);
  font-variant-numeric: tabular-nums;
}

.ks-log {
  max-height: 220px;
  overflow-y: auto;
  font-family: ui-monospace, monospace;
  font-size: calc(11px + var(--fs-off, 0px));
  color: var(--tx2);
  background: var(--bg-input);
  border-radius: 8px;
  padding: 8px 10px;
}

.ks-log-line { white-space: pre-wrap; word-break: break-word; }
.ks-log-line + .ks-log-line { margin-top: 3px; }
`;
