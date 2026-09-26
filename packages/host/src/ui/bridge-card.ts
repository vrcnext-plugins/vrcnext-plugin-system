/**
 * The VRCNext Bridge card: the first thing the Plugins tab shows, and the only thing until the
 * bridge is connected. Four states, each saying what the user has to do next.
 */

import type { BridgeClient, BridgeStatus } from '../capabilities/native.js';
import {
  button,
  card,
  controlRow,
  description,
  row,
  sectionLabel,
  statusCard,
  textField,
  value,
  type StatusTone,
} from './widgets.js';

const INSTALL_URL = 'https://github.com/vrcnext-plugins/vrcnext-plugin-system/tree/main/install#readme';

interface StateCopy {
  readonly tone: StatusTone;
  readonly label: string;
  readonly help: string;
}

const COPY: Readonly<Record<BridgeStatus, StateCopy>> = {
  not_detected: {
    tone: 'offline',
    label: 'Not detected',
    help:
      'Nothing answered at the endpoint below. The VRCNext Bridge installs plugins, stores ' +
      'settings and builds the bundle this page runs, so nothing works without it. Run the ' +
      'installer, or start the daemon if it is installed.',
  },
  running_not_connected: {
    tone: 'warn',
    label: 'Running, connecting…',
    help: 'The bridge answered a health check; the socket is being opened.',
  },
  unpaired: {
    tone: 'warn',
    label: 'Running, not paired',
    help:
      'The bridge refused the pairing token, or none is stored. Paste the token the installer ' +
      'printed — or run `vrcnext-bridge --print-token` — and press Pair.',
  },
  connected: {
    tone: 'online',
    label: 'Connected',
    help: 'Plugins can be installed, enabled and updated.',
  },
};

export interface BridgeCardDeps {
  readonly native: BridgeClient;
  readonly openUrl: (url: string) => void;
}

export function buildBridgeCard(deps: BridgeCardDeps): HTMLElement {
  const { native } = deps;
  const status = native.status;
  const copy = COPY[status];
  const panel = card('VRCNext Bridge', 'hub');

  panel.appendChild(
    statusCard({
      tone: copy.tone,
      label: copy.label,
      action: button({
        label: 'Re-check',
        icon: 'refresh',
        onClick: () => { void native.recheck(); },
      }),
    }),
  );
  panel.appendChild(description(copy.help));

  if (status === 'connected') {
    const welcome = native.describe();
    panel.appendChild(row('Bridge version', value(welcome?.version ?? 'unknown')));
    panel.appendChild(row('Services', value(Object.keys(welcome?.services ?? {}).join(', ') || 'none')));
  }

  if (status !== 'connected') {
    panel.appendChild(sectionLabel('Pairing token'));
    const tokenField = textField({
      value: native.token,
      placeholder: 'paste the token here',
      onCommit: () => undefined,
    });
    tokenField.type = 'password';
    panel.appendChild(
      controlRow(
        tokenField,
        button({ label: 'Pair', icon: 'link', onClick: () => { native.setToken(tokenField.value); } }),
      ),
    );
  }

  panel.appendChild(sectionLabel('Endpoint'));
  panel.appendChild(
    controlRow(
      textField({
        value: native.endpoint,
        placeholder: 'http://127.0.0.1:42081',
        onCommit: (next) => { native.setEndpoint(next); },
      }),
      button({ label: 'Installer', icon: 'open_in_new', onClick: () => { deps.openUrl(INSTALL_URL); } }),
    ),
  );
  return panel;
}
