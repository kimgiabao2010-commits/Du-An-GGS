import { Suspense } from 'react';
import LoginForm from '../../components/LoginForm';

export const metadata = { title: 'Sign in' };
export default function LoginPage() {
  return <Suspense fallback={<main className="login-page"><section className="login-card panel">Loading secure session…</section></main>}><LoginForm /></Suspense>;
}
