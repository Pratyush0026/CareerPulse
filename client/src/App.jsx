import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { api } from './api.js';
import { timeAgo } from './constants.js';
import { useSyncJob } from './hooks/useSyncJob.js';
import Sidebar from './components/Sidebar.jsx';
import Header from './components/Header.jsx';
import SyncBanner from './components/SyncBanner.jsx';
import SyncOverlay from './components/SyncOverlay.jsx';
import AddApplicationModal from './components/AddApplicationModal.jsx';
import Toasts from './components/Toasts.jsx';
import ConfirmDialog from './components/ConfirmDialog.jsx';
import LoginScreen from './components/LoginScreen.jsx';
import { IconMail, IconTrash } from './components/Icons.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import ActivityPage from './pages/ActivityPage.jsx';

// Recharts is most of the bundle, so the insights page loads separately.
const InsightsPage = lazy(() => import('./pages/InsightsPage.jsx'));

// Opening the dashboard this long after the last sync checks Gmail automatically.
const AUTO_SYNC_AFTER_MS = 6 * 60 * 60 * 1000;

const SYNC_ERROR_TITLES = {
  RECONNECT_GMAIL: 'Gmail needs reconnecting',
  SERVER_DOWN: 'Sync interrupted',
  GEMINI_CONFIG: 'AI is unavailable',
};

function syncResultToast(summary) {
  if (summary.stoppedReason) {
    return {
      type: 'warning',
      title: 'Sync stopped early',
      message: `${summary.created} new, ${summary.updated} updated. See the banner for details.`,
    };
  }
  if (!summary.emailsFetched && !summary.remaining) {
    return { type: 'info', title: 'Already up to date', message: 'No new job emails since the last sync.' };
  }
  const waiting = summary.remaining ? ` ${summary.remaining} older emails are still waiting – sync again to continue.` : '';
  return {
    type: summary.remaining ? 'info' : 'success',
    title: summary.remaining ? 'Batch done' : 'Sync complete',
    message: `${summary.created} new, ${summary.updated} updated from ${summary.emailsFetched} emails.${waiting}`,
  };
}

export default function App() {
  const [status, setStatus] = useState(null);
  const [applications, setApplications] = useState([]);
  const [syncSummary, setSyncSummary] = useState(null);
  const [syncCount, setSyncCount] = useState(0);
  const [toasts, setToasts] = useState([]);
  const [dialog, setDialog] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const notify = useCallback((message, type = 'info', extra = {}) => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((list) => [...list.slice(-3), { id, message, type, ...extra }]);
  }, []);
  const dismissToast = useCallback((id) => setToasts((list) => list.filter((t) => t.id !== id)), []);

  const resolveDialog = useRef(null);
  const confirm = useCallback(
    (options) =>
      new Promise((resolve) => {
        resolveDialog.current = resolve;
        setDialog(options);
      }),
    []
  );
  const closeDialog = useCallback((answer) => {
    resolveDialog.current?.(answer);
    resolveDialog.current = null;
    setDialog(null);
  }, []);

  const loadData = useCallback(async () => {
    try {
      setApplications(await api.listApplications());
    } catch (err) {
      notify(`Could not load data: ${err.message}`, 'error');
    }
  }, [notify]);

  const loadStatus = useCallback(async () => {
    const next = await api.authStatus().catch(() => ({ loggedIn: false, connected: false, email: null }));
    setStatus(next);
    return next;
  }, []);

  const clearBoard = useCallback(() => {
    setApplications([]);
    setSyncSummary(null);
  }, []);

  useEffect(() => {
    api.onLoggedOut = () => {
      setStatus((s) => (s?.loggedIn ? { loggedIn: false, connected: false, email: null } : s));
      clearBoard();
    };

    loadStatus().then((s) => s.loggedIn && loadData());

    // Google sends us back to /?gmail=connected or /?gmail=error&reason=...
    const params = new URLSearchParams(location.search);
    const result = params.get('gmail');
    if (result === 'connected') {
      notify('Click “Sync Gmail” to import your applications.', 'success', { title: 'Signed in' });
    }
    if (result === 'error') {
      const reason = params.get('reason') || 'unknown error';
      const message =
        reason === 'access_denied'
          ? 'You declined access on Google’s screen, or this account isn’t a test user of the app yet.'
          : reason;
      notify(message, 'error', { title: 'Sign-in failed' });
    }
    if (result) navigate(location.pathname, { replace: true });
    // Runs once on load; the OAuth result is only ever in the first URL.
  }, []);

  // Sync

  const startSyncRef = useRef(null);

  const handleSyncFinished = useCallback(
    (job) => {
      if (job.status === 'failed') {
        const { code, message } = job.error ?? {};
        if (code === 'RECONNECT_GMAIL') loadStatus();
        notify(message, 'error', {
          title: SYNC_ERROR_TITLES[code] ?? 'Sync failed',
          action: code === 'SERVER_DOWN' ? { label: 'Retry', onClick: () => startSyncRef.current() } : undefined,
        });
      } else {
        setSyncSummary({ ...job.summary, at: new Date() });
        const { type, title, message } = syncResultToast(job.summary);
        notify(message, type, { title });
      }
      setSyncCount((n) => n + 1);
      loadData();
    },
    [loadData, loadStatus, notify]
  );

  const sync = useSyncJob({ enabled: Boolean(status?.loggedIn && status?.connected), onFinish: handleSyncFinished });
  const { start: startJob } = sync;

  const startSync = useCallback(async () => {
    try {
      await startJob();
    } catch (err) {
      notify(err.message, 'error', { title: 'Could not start sync' });
    }
  }, [startJob, notify]);
  startSyncRef.current = startSync;

  // Only auto-sync accounts that have finished a sync before, so this is always the quick incremental kind.
  const autoSynced = useRef(false);
  useEffect(() => {
    if (!sync.loaded || sync.running || autoSynced.current || !sync.lastCompleteSyncAt) return;
    if (Date.now() - new Date(sync.lastSyncAt).getTime() < AUTO_SYNC_AFTER_MS) return;
    autoSynced.current = true;
    notify(`Last sync was ${timeAgo(sync.lastSyncAt)}. Checking Gmail for anything new.`, 'info', { title: 'Catching up' });
    startSync();
  }, [sync.loaded, sync.running, sync.lastSyncAt, sync.lastCompleteSyncAt, startSync, notify]);

  // Board actions

  const handleMove = async (id, stage, { isUndo = false } = {}) => {
    const card = applications.find((a) => a._id === id);
    if (!card || card.stage === stage) return;
    const fromStage = card.stage;

    setApplications((apps) => apps.map((a) => (a._id === id ? { ...a, stage } : a)));
    try {
      const saved = await api.updateApplication(id, { stage });
      setApplications((apps) => apps.map((a) => (a._id === id ? saved : a)));
      if (isUndo) {
        notify(`${card.company} is back in ${stage}.`, 'info', { title: 'Move undone' });
      } else {
        notify(`${card.company}: ${fromStage} → ${stage}`, 'success', {
          title: 'Stage updated',
          action: { label: 'Undo', onClick: () => moveRef.current(id, fromStage, { isUndo: true }) },
        });
      }
    } catch (err) {
      setApplications((apps) => apps.map((a) => (a._id === id ? { ...a, stage: fromStage } : a)));
      notify(err.message, 'error', { title: `Could not move ${card.company}` });
    }
  };

  const handleDelete = async (app) => {
    const ok = await confirm({
      title: 'Delete application?',
      icon: <IconTrash size={18} />,
      tone: 'danger',
      message: `${app.company}${app.role ? ` – ${app.role}` : ''} will be removed from your board.`,
      details: [
        { ok: false, text: 'Its stage history is deleted too. This can’t be undone.' },
        { ok: true, text: 'Its emails won’t be re-imported by future syncs.' },
      ],
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    try {
      await api.deleteApplication(app._id);
      setApplications((apps) => apps.filter((a) => a._id !== app._id));
      notify(`${app.company} was removed from your board.`, 'success', { title: 'Application deleted' });
    } catch (err) {
      notify(err.message, 'error', { title: 'Could not delete' });
    }
  };

  // Stable callbacks for the memoised board; the refs always point at the latest handlers.
  const moveRef = useRef(handleMove);
  moveRef.current = handleMove;
  const deleteRef = useRef(handleDelete);
  deleteRef.current = handleDelete;
  const onMove = useCallback((id, stage) => moveRef.current(id, stage), []);
  const onDelete = useCallback((app) => deleteRef.current(app), []);

  const handleAdd = async (form) => {
    try {
      const created = await api.createApplication(form);
      setApplications((apps) => [created, ...apps]);
      notify(`${created.company} added to ${created.stage}.`, 'success', { title: 'Application added' });
    } catch (err) {
      notify(err.message, 'error', { title: 'Could not add application' });
      throw err;
    }
  };

  // Account

  const handleConnect = async () => {
    const ok = await confirm({
      title: !status?.loggedIn ? 'Sign in with Google' : 'Reconnect Gmail',
      icon: <IconMail size={18} />,
      message: 'Google will ask you to allow CareerPulse to read your email. Here’s what that means:',
      details: [
        { ok: true, text: 'Read-only access: CareerPulse can never send, delete or change emails.' },
        { ok: true, text: 'Only emails matching job keywords from the last 30 days are read.' },
        { ok: true, text: 'Email content is sent to Gemini for classification and is never stored. Only company, role, stage and dates are saved.' },
        { ok: false, text: 'Google will show an “unverified app” warning because this is a test app. Click Continue.' },
      ],
      confirmLabel: 'Continue to Google',
    });
    if (ok) window.location.href = api.connectUrl;
  };

  const handleSignOut = async () => {
    try {
      await api.logout();
      clearBoard();
      await loadStatus();
      notify('Your board is saved – sign in again any time.', 'info', { title: 'Signed out' });
    } catch (err) {
      notify(err.message, 'error', { title: 'Could not sign out' });
    }
  };

  const handleSwitch = async () => {
    const ok = await confirm({
      title: 'Switch Gmail account?',
      icon: <IconMail size={18} />,
      message: `You'll be signed out of ${status?.email} and Google will ask which account to use.`,
      details: [
        { ok: true, text: `${status?.email}'s board, history and Gmail connection stay saved – switch back any time.` },
        { ok: true, text: 'Each account has its own private board and its own sync progress.' },
        { ok: false, text: 'The other account must be added as a test user in Google Cloud Console first.' },
      ],
      confirmLabel: 'Continue to Google',
    });
    if (!ok) return;
    // Signing in again replaces the session anyway, so a failed logout here doesn't matter.
    await api.logout().catch(() => {});
    window.location.href = api.connectUrl;
  };

  const handleDisconnect = async () => {
    const ok = await confirm({
      title: 'Disconnect Gmail?',
      icon: <IconMail size={18} />,
      tone: 'danger',
      message: `CareerPulse will forget the Gmail access token for ${status?.email || 'your account'} and sign you out.`,
      details: [
        { ok: true, text: 'Your applications and history stay saved for this account.' },
        { ok: false, text: 'Signing in again will ask for Gmail permission again.' },
      ],
      confirmLabel: 'Disconnect',
    });
    if (!ok) return;
    try {
      await api.disconnect();
      clearBoard();
      await loadStatus();
      notify('Sign in again any time to continue where you left off.', 'info', { title: 'Gmail disconnected' });
    } catch (err) {
      notify(err.message, 'error', { title: 'Could not disconnect' });
    }
  };

  if (!status?.loggedIn) {
    return (
      <>
        <LoginScreen onSignIn={handleConnect} checking={status === null} />
        <ConfirmDialog dialog={dialog} onClose={closeDialog} />
        <Toasts toasts={toasts} onDismiss={dismissToast} />
      </>
    );
  }

  return (
    <>
      <div className={`layout ${sync.running ? 'is-syncing' : ''}`} inert={sync.running ? '' : undefined}>
        <Sidebar status={status} />

        <main className="main">
          <Header
            status={status}
            syncing={sync.running}
            lastSyncAt={sync.lastSyncAt}
            onSync={startSync}
            onAdd={() => setModalOpen(true)}
            onConnect={handleConnect}
            onSwitch={handleSwitch}
            onSignOut={handleSignOut}
            onDisconnect={handleDisconnect}
          />

          {status.needsReconnect && (
            <div className="alert">Your Gmail access has expired (Google test-mode tokens last 7 days). Click “Reconnect Gmail”.</div>
          )}

          <SyncBanner summary={syncSummary} onClose={() => setSyncSummary(null)} onSyncAgain={startSync} syncing={sync.running} />
          <Routes>
            <Route
              path="/"
              element={
                <DashboardPage
                  applications={applications}
                  lastSyncAt={sync.lastSyncAt}
                  gmailAccount={status.email}
                  onMove={onMove}
                  onDelete={onDelete}
                />
              }
            />
            <Route
              path="/insights"
              element={
                <Suspense fallback={<div className="empty">Loading insights…</div>}>
                  <InsightsPage applications={applications} />
                </Suspense>
              }
            />
            <Route path="/activity" element={<ActivityPage refreshKey={syncCount} />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>

      <SyncOverlay job={sync.job} />
      <AddApplicationModal open={modalOpen} onClose={() => setModalOpen(false)} onSave={handleAdd} />
      <ConfirmDialog dialog={dialog} onClose={closeDialog} />
      <Toasts toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}
