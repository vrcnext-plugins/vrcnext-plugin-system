/**
 * The runtime permission prompt, as a modal.
 *
 * Only the rendering lives here; what is asked, when, and what the answer means is the
 * broker's business, and is tested without this file.
 *
 * The prompt is read in one order and built in that order: who is asking, what they want, and
 * the one name the answer turns on — a host, an action — on its own line, large enough that it
 * cannot be skimmed past. Everything a careful reader wants and a hurried one does not stays
 * folded into Details.
 */

import type { PermissionTone } from '@vrcnext/plugin-api';

import { element } from './dom.js';
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
    const headline = request.headline ?? '';
    const head = element('div', 'vrcnx-ask');
    // With no headline the lead is the whole sentence, so it is the line that gets the weight.
    head.append(
      element('div', 'vrcnx-ask-lead', headline === '' ? `${request.plugin.name} wants to` : `${request.plugin.name} ${request.lead}`),
      element('div', 'vrcnx-ask-headline', headline === '' ? request.lead.replace(/^wants to /, '') : headline),
    );
    return showModal<Decision>({
      title: `${request.plugin.name} (${request.plugin.id})`,
      icon: request.tone === 'high' ? 'warning' : 'shield',
      body: [
        head,
        badge(risk.tone, risk.text),
        description(
          'Confirm allows it until VRCNext is restarted. Confirm & Save remembers it; you can ' +
            'take it back under Settings → Plugins → Permissions. Deny refuses it for this session.',
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
