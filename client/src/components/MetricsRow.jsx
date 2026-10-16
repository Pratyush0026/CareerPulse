import { memo, useMemo } from 'react';
import { IconBriefcase, IconUsers, IconTrophy, IconX, IconPercent } from './Icons.jsx';

function countStats(applications) {
  const today = new Date(new Date().toDateString());
  const byStage = { Applied: 0, Assessment: 0, Interview: 0, Offer: 0, Rejected: 0 };
  let upcoming = 0;

  for (const app of applications) {
    byStage[app.stage] = (byStage[app.stage] ?? 0) + 1;
    if (app.stage !== 'Rejected' && app.eventDate && new Date(app.eventDate) >= today) upcoming++;
  }

  const total = applications.length;
  const responded = total - byStage.Applied;
  return { byStage, total, responded, upcoming, responseRate: total ? Math.round((responded / total) * 100) : 0 };
}

function MetricsRow({ applications }) {
  const { byStage, total, responded, upcoming, responseRate } = useMemo(() => countStats(applications), [applications]);

  const metrics = [
    { label: 'Total applications', value: total, sub: `${byStage.Applied} awaiting response`, Icon: IconBriefcase, tone: 'indigo' },
    { label: 'Interviews', value: byStage.Interview, sub: `${upcoming} upcoming event${upcoming === 1 ? '' : 's'}`, Icon: IconUsers, tone: 'violet' },
    { label: 'Offers', value: byStage.Offer, sub: byStage.Offer ? 'Congratulations!' : 'Keep going', Icon: IconTrophy, tone: 'green' },
    { label: 'Rejections', value: byStage.Rejected, sub: 'Part of the process', Icon: IconX, tone: 'rose' },
    { label: 'Response rate', value: `${responseRate}%`, sub: `${responded} of ${total} heard back`, Icon: IconPercent, tone: 'teal', bar: responseRate },
  ];

  return (
    <section className="metrics">
      {metrics.map(({ label, value, sub, Icon, tone, bar }) => (
        <div className="metric-card" key={label}>
          <div className="metric-head">
            <span className="metric-label">{label}</span>
            <span className={`metric-icon tone-${tone}`}><Icon size={17} /></span>
          </div>
          <div className="metric-value">{value}</div>
          {bar !== undefined && (
            <div className="metric-bar"><span style={{ width: `${bar}%` }} /></div>
          )}
          <div className="metric-sub">{sub}</div>
        </div>
      ))}
    </section>
  );
}

export default memo(MetricsRow);
