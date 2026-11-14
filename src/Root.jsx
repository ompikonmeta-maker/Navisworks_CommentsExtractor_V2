import { useEffect, useState } from 'react';
import App from './App.jsx';
import Login from './components/Login.jsx';
import ProjectPicker from './components/ProjectPicker.jsx';
import { api, detectRemote, loadLastOpened, saveLastOpened } from './lib/server.js';
import { openServerReview, openLocal } from './data/index.js';

// Boot: decides how the app runs and picks its data source (src/data).
//   • local  — opened as a file / static host: the offline app on the
//     browser's own data (the default source).
//   • remote — served by the Tabelin server: sign in, pick Project › Review,
//     then the same app on that review's server source.
export default function Root() {
  const [phase, setPhase] = useState('loading'); // loading | local | login | pick | app
  const [user, setUser] = useState(null);
  const [open, setOpen] = useState(null); // { project, review }
  const [pickerProject, setPickerProject] = useState(null);

  // Signed in: reopen the last review if it still exists, else show the picker
  // (inside the last project when only that is remembered).
  const enter = async (me) => {
    setUser(me);
    const last = loadLastOpened();
    if (last?.project) {
      try {
        const reviews = await api.listReviews(last.project.id);
        const r = last.review && reviews.find((x) => x.id === last.review.id);
        if (r) {
          pick({ project: last.project, review: { id: r.id, name: r.name } }, me);
          return;
        }
        setPickerProject(last.project);
      } catch {
        saveLastOpened(null); // project gone
      }
    }
    setPhase('pick');
  };

  useEffect(() => {
    (async () => {
      if (!(await detectRemote())) {
        setPhase('local');
        return;
      }
      try {
        await enter(await api.me());
      } catch (e) {
        setPhase(e.code === 401 ? 'login' : 'local');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const afterLogin = async () => {
    try {
      await enter(await api.me());
    } catch {
      setPhase('login');
    }
  };

  const pick = (sel, me = user) => {
    openServerReview({ project: sel.project, review: sel.review, user: me });
    saveLastOpened(sel);
    setOpen(sel);
    setPhase('app');
  };

  const exitReview = () => {
    openLocal();
    saveLastOpened({ project: open.project }); // reload lands in this project's list
    setPickerProject(open.project);
    setPhase('pick');
  };

  const signOut = async () => {
    try { await api.logout(); } catch { /* ignore */ }
    openLocal();
    setUser(null);
    setOpen(null);
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
  if (phase === 'pick') return <ProjectPicker user={user} initialProject={pickerProject} onPick={(s) => pick(s)} onSignOut={signOut} />;
  if (phase === 'app') return <App key={`${open.project.id}/${open.review.id}`} onExitProject={exitReview} onSignOut={signOut} />;
  return <App />; // local
}
