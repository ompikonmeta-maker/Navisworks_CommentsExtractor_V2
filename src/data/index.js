// =====================================================================
// The data layer. The app runs on exactly one data source at a time:
//
//   • localSource  — the offline file: records autosaved in this browser
//                    (IndexedDB), optionally mirrored to a session folder;
//   • serverSource — one review on the office server, as the signed-in user.
//
// Both have the same methods (see localSource.js for the list), so the store
// and the screens never ask which one they have. Where behaviour really
// differs (who may edit, whether there is history, a session folder, shared
// settings…) they read `source.caps`.
//
// The boot code (Root.jsx) picks the source: offline by default, a server
// review after sign-in and choosing Project › Review.
// =====================================================================
import { createLocalSource } from './localSource.js';
import { createServerSource } from './serverSource.js';

let current = createLocalSource();

/** The current data source (for plain modules and callbacks). */
export const data = () => current;

/** The current data source, for components. The source changes only while no
 *  review screen is mounted (sign-in / picker), so it is stable per mount. */
export const useData = () => current;

/** Boot: work on a server review as `user`. */
export function openServerReview({ project, review, user }) {
  current = createServerSource({ project, review, user });
  return current;
}

/** Boot: back to the offline browser source (signed out / picking a review). */
export function openLocal() {
  current = createLocalSource();
  return current;
}
