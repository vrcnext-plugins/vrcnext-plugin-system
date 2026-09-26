/**
 * "Rebuilt — reload to apply".
 *
 * The bundle on disk has changed but this page still runs the old one. VRCNext's toast is text
 * only and disappears on its own, so this is a small persistent strip with a Reload button. It
 * never reloads by itself: the user may be mid-conversation in VRCNext.
 */

import { CLASSES, element } from './dom.js';
import { button, controlRow } from './widgets.js';

const STRIP_ID = 'vrcnext-plugins-reload-strip';

export function showReloadToast(message: string, onReload: () => void): void {
  document.getElementById(STRIP_ID)?.remove();
  const strip = element('div', CLASSES.card);
  strip.id = STRIP_ID;
  strip.style.cssText =
    'position:fixed;right:16px;bottom:16px;z-index:100000;display:flex;align-items:center;gap:12px;padding:10px 14px;';
  strip.appendChild(element('span', undefined, message));
  strip.appendChild(
    controlRow(
      button({ label: 'Reload', icon: 'refresh', onClick: onReload }),
      button({ label: 'Later', onClick: () => { strip.remove(); } }),
    ),
  );
  document.body.appendChild(strip);
}
