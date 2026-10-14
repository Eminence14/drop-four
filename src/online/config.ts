/**
 * Firebase web config. These values are public by design (they ship in every
 * Firebase web app); access is controlled by database.rules.json.
 * Environment variables (VITE_FIREBASE_*) override them if set.
 */
const e = import.meta.env;
export const firebaseConfig = {
  apiKey: e.VITE_FIREBASE_API_KEY || 'AIzaSyB1uBahij-25SI6yfVRA-zs7fPh9hzJQuk',
  authDomain: e.VITE_FIREBASE_AUTH_DOMAIN || 'drop-four-7a440.firebaseapp.com',
  databaseURL: e.VITE_FIREBASE_DATABASE_URL || 'https://drop-four-7a440-default-rtdb.firebaseio.com',
  projectId: e.VITE_FIREBASE_PROJECT_ID || 'drop-four-7a440',
  appId: e.VITE_FIREBASE_APP_ID || '1:945862852711:web:780808a505f4f440c9d4c2',
};
