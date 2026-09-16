import { useEffect, useState } from 'react';
import App from './App.jsx';
import Login from './components/Login.jsx';
import ProjectPicker from './components/ProjectPicker.jsx';
import { api, detectRemote, remoteState } from './lib/server.js';

// Decides how the app runs:
//   • local  — opened as a file / static host: the offline V1 app, untouched.
//   • remote — served by the Tabelin server: sign in, pick a review, then the
//     same app backed by the shared server.
export default function Root() {
  const [phase, setPhase] = useState('loading'); // loading | local | login | pick | app
  const [user, setUser] = useState(null);
  const [project, setProject] = useState(null);

  useEffect(() => {
    (async () => {
      if (!(await detectRemote())) {
        setPhase('local');
        return;
      }
      try {
        setUser(await api.me());
        setPhase('pick');
      } catch (e) {
        setPhase(e.code === 401 ? 'login' : 'local');
      }
    })();
  }, []);

  const afterLogin = async () => {
    try {
      setUser(await api.me());
    } catch { /* keep going; picker shows minimal */ }
    setPhase('pick');
  };

  const pick = (p) => {
    remoteState.active = true;
    remoteState.projectId = p.id;
    remoteState.user = user;
    setProject(p);
    setPhase('app');
  };

  const signOut = async () => {
    try { await api.logout(); } catch { /* ignore */ }
    remoteState.active = false;
    remoteState.projectId = null;
    setUser(null);
    setProject(null);
    setPhase('login');
  };

  if (phase === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-on-surface-variant">
        <span className="text-sm">Loading…</span>
      </div>
    );
  }
  if (phase === 'login') return <Login onSuccess={afterLogin} />;
  if (phase === 'pick') return <ProjectPicker user={user} onPick={pick} onSignOut={signOut} />;
  if (phase === 'app') return <App remote={{ ...project, user }} onExitProject={() => setPhase('pick')} onSignOut={signOut} />;
  return <App />; // local
}
