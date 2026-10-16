import MetricsRow from '../components/MetricsRow.jsx';
import PlatformInsights from '../components/PlatformInsights.jsx';

export default function InsightsPage({ applications }) {
  return (
    <>
      <div className="page-head">
        <h2>Insights</h2>
        <p>How your applications are doing and which platforms get you replies.</p>
      </div>
      <MetricsRow applications={applications} />
      <PlatformInsights applications={applications} />
    </>
  );
}
