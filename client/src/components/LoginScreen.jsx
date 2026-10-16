const GoogleLogo = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
    <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.1 24.6c0-1.6-.1-3.1-.4-4.6H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17z" />
    <path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z" />
    <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.5 2.3-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z" />
  </svg>
);

export default function LoginScreen({ onSignIn, checking }) {
  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <div className="brand-logo" aria-hidden>
            <svg viewBox="0 0 32 32" width="24" height="24"><path d="M5 17h5l3-7 5 13 3-6h6" fill="none" stroke="#5eead4" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </div>
          <div>
            <div className="brand-name">CareerPulse</div>
            <div className="brand-sub">Job Tracker</div>
          </div>
        </div>

        <h1>Your job search, organised from Gmail</h1>
        <p className="login-lead">
          Sign in with the Gmail account you use for job applications. CareerPulse reads your application emails
          and keeps a board of every company, stage and interview.
        </p>

        <button className="btn btn-google" onClick={onSignIn} disabled={checking}>
          <GoogleLogo /> {checking ? 'Checking…' : 'Sign in with Google'}
        </button>

        <ul className="login-points">
          <li>Each Gmail account has its own private board – switch any time, nothing is lost.</li>
          <li>Read-only: CareerPulse can never send, delete or change emails.</li>
          <li>Email content is never stored – only company, role, stage and dates.</li>
        </ul>
        <p className="login-note">
          Prototype in Google “Testing” mode: an account can only sign in after it’s added as a <em>test user</em> in
          Google Cloud Console.
        </p>
      </div>
    </div>
  );
}
