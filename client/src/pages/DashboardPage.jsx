import { useDeferredValue, useMemo } from 'react';
import { applyView, isNewSince, useBoardView } from '../hooks/useBoardView.js';
import MetricsRow from '../components/MetricsRow.jsx';
import BoardToolbar from '../components/BoardToolbar.jsx';
import KanbanBoard from '../components/KanbanBoard.jsx';

export default function DashboardPage({ applications, lastSyncAt, gmailAccount, onMove, onDelete }) {
  const { view, update, reset, isFiltered } = useBoardView();
  const deferredView = useDeferredValue(view);

  const visible = useMemo(() => applyView(applications, deferredView, lastSyncAt), [applications, deferredView, lastSyncAt]);
  const newCount = useMemo(() => applications.filter((app) => isNewSince(app, lastSyncAt)).length, [applications, lastSyncAt]);

  return (
    <>
      <MetricsRow applications={applications} />

      <section className="panel board-panel">
        <div className="panel-head">
          <div>
            <h2>Application pipeline</h2>
            <p>Drag cards between columns to update a stage manually</p>
          </div>
        </div>
        <BoardToolbar
          view={view}
          onChange={update}
          onReset={reset}
          isFiltered={isFiltered}
          shown={visible.length}
          total={applications.length}
          newCount={newCount}
        />
        <KanbanBoard
          applications={visible}
          onMove={onMove}
          onDelete={onDelete}
          gmailAccount={gmailAccount}
          newSince={lastSyncAt}
        />
      </section>
    </>
  );
}
