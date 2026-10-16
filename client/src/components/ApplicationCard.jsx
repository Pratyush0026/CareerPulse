import { avatarColors, formatDate, timeAgo } from '../constants.js';
import { IconTrash, IconLink, IconCalendar, IconMail } from './Icons.jsx';

const FallbackTag = ({ what }) => (
  <span className="tag tag-fallback" title={`Not stated in the email – ${what}`}>Fallback</span>
);

// authuser picks the right account when several are signed in. Putting the email in the
// /u/<...>/ path instead gets it URL-encoded, and Gmail answers that with a 404.
export function gmailUrl(messageId, accountEmail) {
  const account = accountEmail ? `?authuser=${encodeURIComponent(accountEmail)}` : '';
  return `https://mail.google.com/mail/${account}#all/${messageId}`;
}

export default function ApplicationCard({ app, provided, isDragging, isNew, onDelete, gmailAccount }) {
  const isUpcoming = app.eventDate && new Date(app.eventDate) >= new Date(new Date().toDateString());
  const inferred = app.inferredFields || [];
  const emailHref = app.lastMessageId ? gmailUrl(app.lastMessageId, gmailAccount) : null;

  const openEmail = () => emailHref && window.open(emailHref, '_blank', 'noopener');
  const stop = (e) => e.stopPropagation();

  return (
    <article
      ref={provided.innerRef}
      {...provided.draggableProps}
      {...provided.dragHandleProps}
      className={`card ${isDragging ? 'dragging' : ''} ${emailHref ? 'clickable' : ''} ${isNew ? 'is-new' : ''}`}
      onClick={openEmail}
      onKeyDown={(e) => e.key === 'Enter' && openEmail()}
      title={emailHref ? 'Open the email in Gmail' : undefined}
    >
      <div className="card-top">
        <div className="avatar" style={avatarColors(app.company)}>{app.company.charAt(0).toUpperCase()}</div>
        <div className="card-title">
          <div className="company">
            {app.company}
            {isNew && <span className="new-badge">New</span>}
          </div>
          <div className="platform">
            {app.platform === 'unknown' ? 'Platform unknown' : app.platform}
            {inferred.includes('platform') && <FallbackTag what="platform guessed from the sender's address" />}
          </div>
        </div>
      </div>

      {app.role && <div className="role">{app.role}</div>}

      {inferred.includes('stage') && (
        <div className="fallback-note">
          Stage “{app.stage}” assumed <FallbackTag what="the email didn't say which stage this is" />
        </div>
      )}

      {app.eventDate && (
        <div className={`event ${isUpcoming ? 'event-upcoming' : ''}`}>
          <IconCalendar size={14} /> {formatDate(app.eventDate)}
        </div>
      )}

      {app.lastSummary && <p className="summary">{app.lastSummary}</p>}

      {app.link && (
        <a className="link-btn" href={app.link} target="_blank" rel="noreferrer" onClick={stop}>
          <IconLink size={13} /> Open link
        </a>
      )}

      <div className="card-footer">
        <div className="card-meta">
          <span className={`tag ${app.source === 'gmail' ? 'tag-ai' : 'tag-manual'}`}>
            {app.source === 'gmail' ? 'AI' : 'Manual'}
          </span>
          {app.source === 'gmail' && app.lastEmailAt ? (
            <span className="updated" title={`Latest email: ${new Date(app.lastEmailAt).toLocaleString('en-IN')}`}>
              {timeAgo(app.lastEmailAt)}
            </span>
          ) : (
            <span className="updated" title="When you added this card">Added {timeAgo(app.createdAt)}</span>
          )}
        </div>
        <div className="card-actions">
          {emailHref && (
            <a className="icon-btn" href={emailHref} target="_blank" rel="noreferrer" onClick={stop} title="Open email in Gmail">
              <IconMail size={15} />
            </a>
          )}
          <button
            className="icon-btn danger"
            title="Delete application"
            onClick={(e) => {
              stop(e);
              onDelete(app);
            }}
          >
            <IconTrash size={15} />
          </button>
        </div>
      </div>
    </article>
  );
}
