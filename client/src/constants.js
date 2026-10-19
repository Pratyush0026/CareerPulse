export const STAGES = [
  { id: 'Applied', color: 'var(--stage-applied)', hint: 'Waiting to hear back' },
  { id: 'Assessment', color: 'var(--stage-assessment)', hint: 'Tests & assignments' },
  { id: 'Interview', color: 'var(--stage-interview)', hint: 'Rounds in progress' },
  { id: 'Offer', color: 'var(--stage-offer)', hint: 'Offers received' },
  { id: 'Rejected', color: 'var(--stage-rejected)', hint: 'Closed applications' },
];

export const PLATFORMS = ['Naukri', 'LinkedIn', 'foundit', 'referral', 'company site', 'unknown'];

export function timeAgo(date) {
  if (!date) return '';
  const secs = Math.round((Date.now() - new Date(date).getTime()) / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export const formatDate = (date) =>
  date ? new Date(date).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }) : '';

// Same company, same colour.
const AVATAR_COLORS = ['#e0e7ff', '#fce7f3', '#dcfce7', '#fef3c7', '#e0f2fe', '#f3e8ff', '#ffe4e6', '#ccfbf1'];
const AVATAR_TEXT = ['#4338ca', '#be185d', '#15803d', '#b45309', '#0369a1', '#7e22ce', '#be123c', '#0f766e'];
export function avatarColors(name = '') {
  const i = [...name].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % AVATAR_COLORS.length;
  return { background: AVATAR_COLORS[i], color: AVATAR_TEXT[i] };
}

// authuser picks the right account when several are signed in. Putting the email in the
// /u/<...>/ path instead gets it URL-encoded, and Gmail answers that with a 404.
export function gmailUrl(messageId, accountEmail) {
  const account = accountEmail ? `?authuser=${encodeURIComponent(accountEmail)}` : '';
  return `https://mail.google.com/mail/${account}#all/${messageId}`;
}
