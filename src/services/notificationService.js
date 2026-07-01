import { fetchNotifications, markNotificationRead, markAllNotificationsRead } from './dataService.js';
import { currentUser, DB } from './state.js';
import { h } from '../utils/sanitize.js';

let notifications = [];

export function toggleNotifDropdown(event) {
  if (event) event.stopPropagation();
  const dropdown = document.getElementById('notif-dropdown');
  if (!dropdown) return;
  const isShown = dropdown.style.display === 'flex' || dropdown.style.display === 'block';
  if (isShown) {
    dropdown.style.display = 'none';
  } else {
    dropdown.style.display = 'block';
    refreshNotifications();
  }
}

export async function refreshNotifications() {
  if (!currentUser) return;
  
  const activeFacId = DB.activeFacId;
  const { data, error } = await fetchNotifications(currentUser.id, activeFacId);
  
  if (error) {
    console.error('Failed to fetch notifications', error);
    return;
  }
  
  notifications = data || [];
  renderNotifications();
}

function timeAgo(dateString) {
  const now = new Date();
  const date = new Date(dateString);
  const seconds = Math.floor((now - date) / 1000);
  
  if (seconds < 0) return 'Just now';
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

const TYPE_ICONS = {
  referral_submitted: '<i class="ti ti-clipboard-text"></i>',
  referral_approved: '<i class="ti ti-thumb-up"></i>',
  referral_rejected: '<i class="ti ti-circle-x"></i>',
  referral_received: '<i class="ti ti-arrow-down-left"></i>',
  referral_completed: '<i class="ti ti-discount-check"></i>',
  user_created: '<i class="ti ti-user-plus"></i>',
  user_suspended: '<i class="ti ti-user-minus"></i>',
};

function renderNotifications() {
  const badge = document.getElementById('notif-unread-count');
  const listContainer = document.getElementById('notif-list');
  if (!listContainer) return;
  
  const unreadCount = notifications.filter(n => !n.read).length;
  
  if (badge) {
    if (unreadCount > 0) {
      badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  }
  
  if (!notifications.length) {
    listContainer.innerHTML = `<div class="notif-empty"><i class="ti ti-bell-off"></i>No notifications yet.</div>`;
    return;
  }
  
  listContainer.innerHTML = notifications
    .map(n => {
      const icon = TYPE_ICONS[n.type] || '<i class="ti ti-bell"></i>';
      const typeClass = TYPE_ICONS[n.type] ? n.type : 'default';
      const itemClass = n.read ? 'notif-item' : 'notif-item unread';
      const markReadBtn = n.read 
        ? '' 
        : `<button class="notif-mark-read-btn" onclick="markNotificationAsRead('${n.id}', event)" title="Mark as read"><i class="ti ti-circle-check"></i></button>`;
      const dot = n.read ? '' : `<div class="notif-item-dot"></div>`;
      
      return `<div class="${itemClass}">
        <div class="notif-icon-box ${typeClass}">${icon}</div>
        <div class="notif-content">
          <div class="notif-title">${h(n.title)}</div>
          <div class="notif-message">${h(n.message)}</div>
          <div class="notif-time">${timeAgo(n.created_at)}</div>
        </div>
        ${markReadBtn}
        ${dot}
      </div>`;
    })
    .join('');
}

export async function markNotificationAsRead(id, event) {
  if (event) event.stopPropagation();
  const { error } = await markNotificationRead(id);
  if (error) {
    console.error('Failed to mark notification as read', error);
    return;
  }
  
  // Update local state
  const notif = notifications.find(n => n.id === id);
  if (notif) notif.read = true;
  
  renderNotifications();
}

export async function markAllNotificationsAsRead() {
  if (!currentUser) return;
  const activeFacId = DB.activeFacId;
  const { error } = await markAllNotificationsRead(currentUser.id, activeFacId);
  if (error) {
    console.error('Failed to mark all notifications as read', error);
    return;
  }
  
  // Update local state
  notifications.forEach(n => n.read = true);
  renderNotifications();
}

// Click outside dropdown to close
document.addEventListener('click', (event) => {
  const dropdown = document.getElementById('notif-dropdown');
  const container = document.getElementById('notif-bell-container');
  if (dropdown && container && !container.contains(event.target)) {
    dropdown.style.display = 'none';
  }
});
