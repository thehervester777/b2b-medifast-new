import { esc } from '../core/dom.js';
import { ic } from '../core/icons.js';
import { notifications, markNotificationsRead } from '../core/store.js';
import { openSheet } from './sheet.js';

export function openNotifications() {
  const body = `
    <ul class="note-list">
      ${notifications
        .map(
          (n) => `
        <li class="note">
          <span class="note-ic">${ic(n.icon)}</span>
          <div><b>${esc(n.title)}</b><p>${esc(n.body)}</p><small>${esc(n.when)}</small></div>
        </li>`
        )
        .join('')}
    </ul>`;
  openSheet({ title: 'Notifications', body, className: 'note-sheet' });
  markNotificationsRead();
}
