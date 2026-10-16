import { useMemo } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';

const percent = (part, whole) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);

// Any move beyond "Applied" counts as hearing back.
function platformStats(applications) {
  const byPlatform = new Map();
  let responses = 0;

  for (const app of applications) {
    const row = byPlatform.get(app.platform) ?? { platform: app.platform, applications: 0, responses: 0 };
    row.applications++;
    if (app.stage !== 'Applied') {
      row.responses++;
      responses++;
    }
    byPlatform.set(app.platform, row);
  }

  const rows = [...byPlatform.values()]
    .map((row) => ({ ...row, responseRate: percent(row.responses, row.applications) }))
    .sort((a, b) => b.applications - a.applications);

  return { rows, responseRate: percent(responses, applications.length) };
}

export default function PlatformInsights({ applications }) {
  const { rows, responseRate } = useMemo(() => platformStats(applications), [applications]);

  return (
    <section className="panel" id="insights">
      <div className="panel-head">
        <div>
          <h2>Platform insights</h2>
          <p>Where your applications come from, and which platforms get replies</p>
        </div>
        {rows.length > 0 && <span className="pill pill-muted">Overall response rate: {responseRate}%</span>}
      </div>

      {!rows.length ? (
        <div className="empty">No applications yet – sync Gmail or add one manually.</div>
      ) : (
        <div className="insights-grid">
          <div className="chart">
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={rows} margin={{ top: 8, right: 8, left: -18, bottom: 0 }} barGap={4}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="platform" tick={{ fontSize: 12, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: 'rgba(99,102,241,0.06)' }} contentStyle={{ borderRadius: 10, border: '1px solid var(--border)', fontSize: 13 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="applications" name="Applications" fill="#6366f1" radius={[6, 6, 0, 0]} maxBarSize={36} isAnimationActive={false} />
                <Bar dataKey="responses" name="Responses" fill="#14b8a6" radius={[6, 6, 0, 0]} maxBarSize={36} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <table className="table">
            <thead>
              <tr><th>Platform</th><th>Applications</th><th>Responses</th><th>Response rate</th></tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.platform}>
                  <td className="cap">{row.platform}</td>
                  <td>{row.applications}</td>
                  <td>{row.responses}</td>
                  <td>
                    <div className="rate">
                      <div className="rate-bar"><span style={{ width: `${row.responseRate}%` }} /></div>
                      {row.responseRate}%
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
