import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { IconTrash, IconClose, IconDna, IconTarget, IconCheck } from '../components/Icons.jsx';
import ResumeUploadDropzone from '../components/career-dna/ResumeUploadDropzone.jsx';
import CareerProfileForm from '../components/career-dna/CareerProfileForm.jsx';
import CareerDnaOverview from '../components/career-dna/CareerDnaOverview.jsx';
import SkillEvidenceModal from '../components/career-dna/SkillEvidenceModal.jsx';
import JobDnaSection from '../components/career-dna/JobDnaSection.jsx';
import ActionPlanSection from '../components/career-dna/ActionPlanSection.jsx';

const EDITABLE = [
  'headline', 'summary', 'yearsOfExperience', 'experience', 'education', 'skills', 'toolsAndFrameworks',
  'projects', 'certifications', 'achievements', 'links', 'inferredInterests', 'missingOrAmbiguous', 'goals',
];
const editable = (profile) => Object.fromEntries(EDITABLE.filter((k) => profile?.[k] !== undefined).map((k) => [k, profile[k]]));

const key = (...parts) => parts.map((p) => String(p ?? '').trim().toLowerCase()).join('|');

// Adds anything new from a fresh resume to the existing profile. What the user already has –
// goals, confirmations, things they typed in – is kept; new items arrive unconfirmed.
function mergeDraft(profile, draft) {
  if (!profile) return draft;
  const union = (current = [], incoming = [], keyOf) => {
    const seen = new Set(current.map(keyOf));
    return [...current, ...incoming.filter((item) => !seen.has(keyOf(item)))];
  };
  return {
    ...editable(profile),
    headline: profile.headline || draft.headline,
    summary: draft.summary || profile.summary,
    yearsOfExperience: draft.yearsOfExperience ?? profile.yearsOfExperience,
    links: Object.fromEntries(['portfolio', 'github', 'linkedin'].map((k) => [k, profile.links?.[k] || draft.links?.[k] || ''])),
    skills: union(profile.skills, draft.skills, (s) => key(s.name)),
    toolsAndFrameworks: [...new Set([...(profile.toolsAndFrameworks ?? []), ...(draft.toolsAndFrameworks ?? [])])],
    experience: union(profile.experience, draft.experience, (e) => key(e.role, e.company)),
    projects: union(profile.projects, draft.projects, (p) => key(p.title)),
    education: union(profile.education, draft.education, (e) => key(e.degree, e.institution)),
    certifications: union(profile.certifications, draft.certifications, (c) => key(c.name)),
    achievements: [...new Set([...(profile.achievements ?? []), ...(draft.achievements ?? [])])],
    inferredInterests: union(profile.inferredInterests, draft.inferredInterests, (i) => key(i.interest)),
    missingOrAmbiguous: draft.missingOrAmbiguous ?? [],
  };
}

function ResumeDialog({ uploading, onUpload, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && !uploading && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [uploading, onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={() => !uploading && onClose()}>
      <div className="modal dna-modal" role="dialog" aria-modal="true" aria-labelledby="resume-dialog-title" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2 id="resume-dialog-title">Update from a newer resume</h2>
            <p className="muted">New roles, projects and skills are added for you to review. Your goals and confirmations stay as they are.</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} disabled={uploading} aria-label="Close"><IconClose size={18} /></button>
        </div>
        <ResumeUploadDropzone onUpload={onUpload} isUploading={uploading} compact />
      </div>
    </div>
  );
}

export default function CareerDnaPage({ notify, confirm, gmailAccount }) {
  const [tab, setTab] = useState('profile');
  const [state, setState] = useState('loading');
  const [profile, setProfile] = useState(null);
  const [completeness, setCompleteness] = useState(null);
  const [evidence, setEvidence] = useState({ items: [], error: false });
  const [inspecting, setInspecting] = useState(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [editor, setEditor] = useState(null); // { mode, data, extraction }
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resumeDialog, setResumeDialog] = useState(false);
  // Bumped whenever the profile or evidence changes, so saved job scores are reloaded.
  const [fitVersion, setFitVersion] = useState(0);

  const loadEvidence = useCallback(async () => {
    setFitVersion((v) => v + 1);
    try {
      setEvidence({ items: await api.getEvidenceOverview(), error: false });
    } catch {
      setEvidence((e) => ({ ...e, error: true }));
    }
  }, []);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const res = await api.getCareerDna();
      setProfile(res.profile);
      setCompleteness(res.completeness);
      setState('ready');
      if (res.profile) loadEvidence();
    } catch {
      setState('error');
    }
  }, [loadEvidence]);

  useEffect(() => {
    load();
  }, [load]);

  const refreshInspected = async (skill) => {
    if (skill) setInspecting(await api.getSkillEvidence(skill));
  };

  const uploadResume = async (file) => {
    setUploading(true);
    try {
      const res = await api.parseResume(file);
      setEditor({ mode: 'review', data: mergeDraft(profile, res.draft), extraction: res.extraction });
      setResumeDialog(false);
      notify?.(res.reused ? 'Same resume as before, so the earlier reading was reused.' : 'Check what was read before saving.', 'success', { title: 'Resume read' });
    } catch (err) {
      notify?.(err.message, 'error', { title: 'Couldn’t read the resume' });
    } finally {
      setUploading(false);
    }
  };

  const save = async (formData) => {
    setSaving(true);
    try {
      const res = await api.saveCareerDna({ ...formData, extraction: editor?.extraction });
      setProfile(res.profile);
      setCompleteness(res.completeness);
      setEditor(null);
      loadEvidence();
      notify?.('Your skills evidence and job fit scores were updated too.', 'success', { title: 'Profile saved' });
    } catch (err) {
      notify?.(err.message, 'error', { title: 'Couldn’t save' });
    } finally {
      setSaving(false);
    }
  };

  const toggleSkill = async (name) => {
    const skills = profile.skills.map((s) => (s.name === name ? { ...s, isConfirmed: !s.isConfirmed } : s));
    const previous = profile;
    setProfile({ ...profile, skills });
    try {
      const res = await api.saveCareerDna({ ...editable(profile), skills });
      setProfile(res.profile);
      setCompleteness(res.completeness);
      loadEvidence();
    } catch (err) {
      setProfile(previous);
      notify?.(err.message, 'error', { title: 'Couldn’t update skill' });
    }
  };

  const deleteAll = async () => {
    const ok = await confirm?.({
      title: 'Delete all Career DNA data?',
      icon: <IconTrash size={18} />,
      tone: 'danger',
      message: 'Your profile, goals, skill evidence and saved job analyses will be permanently deleted.',
      details: [
        { ok: false, text: 'This can’t be undone.' },
        { ok: true, text: 'Your application board and Gmail sync are not affected.' },
      ],
      confirmLabel: 'Delete Career DNA',
    });
    if (!ok) return;
    try {
      await api.deleteCareerDna();
      setProfile(null);
      setCompleteness(null);
      setEvidence({ items: [], error: false });
      setEditor(null);
      setTab('profile');
      notify?.('All Career DNA data for this account was deleted.', 'info', { title: 'Deleted' });
    } catch (err) {
      notify?.(err.message, 'error', { title: 'Couldn’t delete' });
    }
  };

  const evidenceAction = async (action, success) => {
    try {
      const res = await action();
      setEvidence({ items: res.overview, error: false });
      setFitVersion((v) => v + 1);
      await refreshInspected(inspecting?.skill);
      if (success) notify?.(success, 'success');
    } catch (err) {
      notify?.(err.message, 'error');
      throw err;
    }
  };

  const rebuild = async () => {
    setRebuilding(true);
    try {
      const res = await api.rebuildEvidence();
      setEvidence({ items: res.overview, error: false });
      setFitVersion((v) => v + 1);
      notify?.('Evidence rebuilt from your current profile.', 'success');
    } catch (err) {
      notify?.(err.message, 'error', { title: 'Couldn’t rebuild' });
    } finally {
      setRebuilding(false);
    }
  };

  if (state === 'loading') {
    return (
      <div className="dna-loading-state" aria-live="polite">
        <div className="dna-spinner" />
        <p className="muted">Loading Career DNA…</p>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="dna-error-state">
        <div className="dna-error-box" role="alert">
          <p>Couldn’t load Career DNA.</p>
          <button type="button" className="btn btn-secondary btn-sm" onClick={load}>Try again</button>
        </div>
      </div>
    );
  }

  if (editor) {
    return (
      <div className="career-dna-page">
        <CareerProfileForm initialData={editor.data} mode={editor.mode} onSave={save} onCancel={() => setEditor(null)} isSaving={saving} />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="career-dna-page">
        <ResumeUploadDropzone onUpload={uploadResume} onManualCreate={() => setEditor({ mode: 'create', data: {} })} isUploading={uploading} />
      </div>
    );
  }

  return (
    <div className="career-dna-page">
      <div className="dna-top-tabs" role="tablist" aria-label="Career DNA sections">
        <button type="button" role="tab" id="dna-tab-profile" aria-controls="dna-panel-profile" aria-selected={tab === 'profile'} className={`dna-top-tab ${tab === 'profile' ? 'active' : ''}`} onClick={() => setTab('profile')}>
          <IconDna size={16} /> Profile & evidence
        </button>
        <button type="button" role="tab" id="dna-tab-jobs" aria-controls="dna-panel-jobs" aria-selected={tab === 'jobs'} className={`dna-top-tab ${tab === 'jobs' ? 'active' : ''}`} onClick={() => setTab('jobs')}>
          <IconTarget size={16} /> Job fit
        </button>
        <button type="button" role="tab" id="dna-tab-plan" aria-controls="dna-panel-plan" aria-selected={tab === 'plan'} className={`dna-top-tab ${tab === 'plan' ? 'active' : ''}`} onClick={() => setTab('plan')}>
          <IconCheck size={16} /> Action plan
        </button>
      </div>

      <div role="tabpanel" id="dna-panel-profile" aria-labelledby="dna-tab-profile" hidden={tab !== 'profile'}>
        <CareerDnaOverview
          profile={profile}
          completeness={completeness}
          evidenceOverview={evidence.items}
          evidenceError={evidence.error}
          onRetryEvidence={loadEvidence}
          onEdit={() => setEditor({ mode: 'edit', data: profile })}
          onReupload={() => setResumeDialog(true)}
          onDelete={deleteAll}
          onToggleSkillConfirm={toggleSkill}
          onInspectSkill={async (item) => setInspecting(await api.getSkillEvidence(item.skill).catch(() => item))}
          onRebuildEvidence={rebuild}
          isRebuildingEvidence={rebuilding}
        />
      </div>
      {/* Kept mounted so an analysis in progress survives switching tabs. */}
      <div role="tabpanel" id="dna-panel-jobs" aria-labelledby="dna-tab-jobs" hidden={tab !== 'jobs'}>
        <JobDnaSection notify={notify} confirm={confirm} gmailAccount={gmailAccount} refreshKey={fitVersion} profile={profile} onEditProfile={() => setEditor({ mode: 'edit', data: profile })} />
      </div>
      <div role="tabpanel" id="dna-panel-plan" aria-labelledby="dna-tab-plan" hidden={tab !== 'plan'}>
        <ActionPlanSection
          notify={notify}
          confirm={confirm}
          active={tab === 'plan'}
          refreshKey={fitVersion}
          onEditProfile={() => setEditor({ mode: 'edit', data: profile })}
          onOpenJobFit={() => setTab('jobs')}
        />
      </div>

      {inspecting && (
        <SkillEvidenceModal
          skillData={inspecting}
          onClose={() => setInspecting(null)}
          onAddEvidence={(payload) => evidenceAction(() => api.addEvidence(payload), `Evidence added for ${payload.skillName}.`)}
          onSetStatus={(id, status) => evidenceAction(() => api.updateEvidence(id, { status })).catch(() => {})}
          onDeleteEvidence={(id) => evidenceAction(() => api.deleteEvidence(id), 'Evidence deleted.').catch(() => {})}
        />
      )}

      {resumeDialog && <ResumeDialog uploading={uploading} onUpload={uploadResume} onClose={() => setResumeDialog(false)} />}
    </div>
  );
}
