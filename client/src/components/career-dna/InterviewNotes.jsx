import { useEffect, useId, useState } from 'react';
import { IconChevron, IconClose, IconEdit, IconTrash } from '../Icons.jsx';
import { formatDate } from '../../constants.js';

const lines = (value) => value.split('\n').map((v) => v.trim()).filter(Boolean);
const joined = (list = []) => list.join('\n');
const titleOf = (item) => `${item.company}${item.role ? ` – ${item.role}` : ''}`;

function NotesDialog({ target, onSave, onClose }) {
  const ids = { title: useId(), topics: useId(), questions: useId(), feedback: useId(), practice: useId() };
  const existing = target.notes;
  const [form, setForm] = useState({
    topics: joined(existing?.topics),
    difficultQuestions: joined(existing?.difficultQuestions),
    feedback: existing?.feedback ?? '',
    practiceAreas: joined(existing?.practiceAreas),
  });
  const [saving, setSaving] = useState(false);
  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({
        topics: lines(form.topics),
        difficultQuestions: lines(form.difficultQuestions),
        feedback: form.feedback.trim(),
        practiceAreas: lines(form.practiceAreas),
      });
      onClose();
    } catch {
      // The error is shown as a toast; keep what the user typed.
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form className="modal dna-modal" role="dialog" aria-modal="true" aria-labelledby={ids.title} onMouseDown={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="modal-head">
          <div>
            <h2 id={ids.title}>How did it go?</h2>
            <p className="muted text-sm">{titleOf(target)}. Everything here is optional and only visible to you.</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><IconClose size={18} /></button>
        </div>

        <div className="modal-field">
          <label htmlFor={ids.topics}>Topics that came up</label>
          <textarea id={ids.topics} rows="4" value={form.topics} onChange={set('topics')} placeholder={'Server-side rendering\nReact hooks'} autoFocus />
          <span className="field-hint">One per line.</span>
        </div>
        <div className="modal-field">
          <label htmlFor={ids.questions}>Questions you found hard</label>
          <textarea id={ids.questions} rows="4" value={form.difficultQuestions} onChange={set('difficultQuestions')} />
          <span className="field-hint">One per line.</span>
        </div>
        <div className="modal-field">
          <label htmlFor={ids.feedback}>Feedback the interviewer gave</label>
          <textarea id={ids.feedback} rows="3" maxLength={2000} value={form.feedback} onChange={set('feedback')} placeholder="Only what they actually said" />
        </div>
        <div className="modal-field">
          <label htmlFor={ids.practice}>Areas you’d like to practise</label>
          <textarea id={ids.practice} rows="3" value={form.practiceAreas} onChange={set('practiceAreas')} />
          <span className="field-hint">One per line. Each area becomes a practice task in your plan; nothing else does.</span>
        </div>

        <div className="modal-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>{saving ? 'Saving…' : 'Save notes'}</button>
        </div>
      </form>
    </div>
  );
}

const sameArea = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

// What Gemini suggested from one set of notes. Nothing becomes a task until the user adds it.
function PracticeSuggestions({ reflection, busy, onSuggest, onAdd }) {
  const { insights } = reflection;

  if (!insights) {
    return (
      <section className="insight-cta">
        <p className="text-xs muted">
          Want help deciding what to work on? Only this interview’s notes are sent to Google Gemini, and every suggestion points back to the lines it came from.
        </p>
        <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => onSuggest(reflection)}>
          {busy ? <><span className="spinner" /> Reading your notes…</> : 'Suggest what to work on'}
        </button>
      </section>
    );
  }

  return (
    <section className="insight-panel">
      <h4>Suggested from these notes <span className="dna-tag-pill">AI</span></h4>
      {insights.feedbackSummary && <p className="text-sm"><strong>In short:</strong> {insights.feedbackSummary}</p>}
      {insights.themes.length > 0 && (
        <p className="text-sm">
          <strong>Themes:</strong> {insights.themes.map((t) => `${t.name} (${t.fromNotes.length})`).join(' · ')}
        </p>
      )}
      {insights.learningNeeds.length ? (
        <ul className="insight-needs">
          {insights.learningNeeds.map((need) => {
            const added = reflection.practiceAreas.some((p) => sameArea(p, need.area));
            return (
              <li key={need.area}>
                <div className="insight-need-body">
                  <strong>{need.area}</strong>
                  {need.why && <span className="text-sm">{need.why}</span>}
                  <span className="text-sm"><span className="muted">Try:</span> {need.practice}</span>
                  <span className="text-xs muted">From your notes: “{need.basedOn.join('”, “')}”</span>
                </div>
                {added ? (
                  <span className="dna-pill pill-success">On your practice list</span>
                ) : (
                  reflection.applicationId && (
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => onAdd(reflection, need.area)}>Add to practice list</button>
                  )
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm muted">Nothing specific stood out in these notes. Adding the interviewer’s feedback or the questions you found hard gives more to work with.</p>
      )}
    </section>
  );
}

const count = (n, word) => (n ? `${n} ${word}${n === 1 ? '' : 's'}` : null);

// One interview's notes. Collapsed by default so a long list stays short; the summary line says
// what's inside without opening it.
function NoteCard({ reflection: r, suggesting, onEdit, onDelete, onSuggest, onAddPractice }) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const summary = [
    r.feedback && 'interviewer feedback',
    count(r.topics.length, 'topic'),
    count(r.difficultQuestions.length, 'hard question'),
    r.practiceAreas.length && `${r.practiceAreas.length} to practise`,
    r.insights && 'AI suggestions',
  ].filter(Boolean);

  return (
    <li className={`interview-note ${open ? 'is-open' : ''}`}>
      <div className="interview-note-head">
        <button type="button" className="interview-toggle" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((v) => !v)}>
          <IconChevron size={16} className="interview-chevron" />
          <span>
            <span className="interview-title">{titleOf(r)}</span>
            <span className="muted text-xs">
              {r.stage}{r.occurredOn ? ` · ${formatDate(r.occurredOn)}` : ''}
              {!open && summary.length > 0 && ` · ${summary.join(' · ')}`}
              {!r.applicationId && ' · the application card was deleted; your notes are kept'}
            </span>
          </span>
        </button>
        <div className="interview-actions">
          {r.applicationId && (
            <button type="button" className="icon-btn" aria-label={`Edit notes for ${r.company}`} onClick={onEdit}>
              <IconEdit size={15} />
            </button>
          )}
          <button type="button" className="icon-btn" aria-label={`Delete notes for ${r.company}`} onClick={() => onDelete(r)}>
            <IconTrash size={15} />
          </button>
        </div>
      </div>

      {open && (
        <div className="interview-note-body" id={bodyId}>
          {r.feedback && (
            <blockquote className="interview-feedback">
              <span>What the interviewer said</span>
              {r.feedback}
            </blockquote>
          )}

          <div className="interview-note-grid">
            {r.topics.length > 0 && (
              <section>
                <h4>Topics that came up</h4>
                <ul className="note-tags">{r.topics.map((t) => <li key={t}>{t}</li>)}</ul>
              </section>
            )}
            {r.difficultQuestions.length > 0 && (
              <section>
                <h4>Questions you found hard</h4>
                <ol className="note-questions">{r.difficultQuestions.map((q) => <li key={q}>{q}</li>)}</ol>
              </section>
            )}
          </div>

          {r.practiceAreas.length > 0 && (
            <section className="interview-practice">
              <h4>You want to practise</h4>
              <ul className="note-tags is-accent">{r.practiceAreas.map((p) => <li key={p}>{p}</li>)}</ul>
            </section>
          )}

          <PracticeSuggestions reflection={r} busy={suggesting} onSuggest={onSuggest} onAdd={onAddPractice} />
        </div>
      )}
    </li>
  );
}

/** Rounds waiting for notes, the notes already written, and topics that keep coming up. */
export default function InterviewNotes({ data, suggestingId, onSave, onDelete, onSuggest, onAddPractice }) {
  const [editing, setEditing] = useState(null);
  const { awaitingNotes, reflections, recurringTopics } = data;

  if (!awaitingNotes.length && !reflections.length) {
    return <div className="dna-empty-box">When an application reaches an interview, you can note how it went here.</div>;
  }

  return (
    <>
      {recurringTopics.length > 0 && (
        <div className="interview-recurring">
          <strong>Came up more than once:</strong>{' '}
          {recurringTopics.map((t) => `${t.topic} (${t.count} of your ${t.outOf} noted interviews)`).join(' · ')}
        </div>
      )}

      {awaitingNotes.length > 0 && (
        <ul className="interview-list">
          {awaitingNotes.map((app) => (
            <li key={app._id} className="interview-item is-waiting">
              <div>
                <div className="interview-title">{titleOf(app)}</div>
                <div className="muted text-xs">{app.stage}{app.eventDate ? ` · ${formatDate(app.eventDate)}` : ''}</div>
              </div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing({ ...app, applicationId: app._id })}>
                Add notes
              </button>
            </li>
          ))}
        </ul>
      )}

      {reflections.length > 0 && (
        <ul className="interview-list">
          {reflections.map((r) => (
            <NoteCard
              key={r._id}
              reflection={r}
              suggesting={suggestingId === r._id}
              onEdit={() => setEditing({ ...r, notes: r })}
              onDelete={onDelete}
              onSuggest={onSuggest}
              onAddPractice={onAddPractice}
            />
          ))}
        </ul>
      )}

      {editing && <NotesDialog target={editing} onSave={(notes) => onSave(editing.applicationId, notes)} onClose={() => setEditing(null)} />}
    </>
  );
}
