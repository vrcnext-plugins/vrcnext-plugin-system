/**
 * The runtime permission prompt, as a modal.
 *
 * Only the rendering lives here; what is asked, when, and what the answer means is the
 * broker's business, and is tested without this file.
 */

import type { PermissionTone } from '@vrcnext/plugin-api';

import type { Decision, PermissionPrompt, PromptRequest } from '../permissions/types.js';
import { detailsBlock, showModal } from './modal.js';
import { badge, description } from './widgets.js';

const TONE_LABEL: Readonly<Record<PermissionTone, { readonly tone: 'ok' | 'warning' | 'err'; readonly text: string }>> = {
  low: { tone: 'ok', text: 'Low risk' },
  medium: { tone: 'warning', text: 'Medium risk' },
  high: { tone: 'err', text: 'High risk' },
};

export class PermissionModal implements PermissionPrompt {
  ask(request: PromptRequest): Promise<Decision> {
    const risk = TONE_LABEL[request.tone];
    return showModal<Decision>({
      title: request.title,
      icon: request.tone === 'high' ? 'warning' : 'shield',
      body: [
        badge(risk.tone, risk.text),
        description(
          'Confirm allows it until VRCNext is restarted. Confirm & Save remembers it; you can ' +
            'take it back under Manage Plugins → Permissions. Deny refuses it for this session.',
        ),
        request.details.length > 0 ? detailsBlock(request.details) : undefined,
      ],
      buttons: [
        { label: 'Confirm', icon: 'check', value: 'allow' },
        { label: 'Confirm & Save', icon: 'save', value: 'save' },
        { label: 'Deny', icon: 'block', value: 'deny' },
        { label: 'Uninstall', icon: 'delete', value: 'uninstall' },
      ],
    });
  }
}
