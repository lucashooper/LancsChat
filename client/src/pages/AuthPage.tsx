import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { isEmailVerified, isNoEmailAccount } from '../lib/authErrors';
import { getAuthRedirectUrl } from '../lib/authRedirect';
import AuthBackground from '../components/AuthBackground';
import { Eye, EyeOff, Loader2, Mail, Trash2 } from 'lucide-react';
import './AuthPage.css';

type AuthStep = 'welcome' | 'register' | 'check-email' | 'login' | 'forgot-password' | 'reset-sent';

const ALLOWED_DOMAIN = 'lancaster.ac.uk';
void ALLOWED_DOMAIN;

function AuthHeader() {
  return (
    <>
      <img src="/Lancaster-Uni-Icon-1.png" alt="Lancaster University" className="authLogo" />
      <h1 className="authTitle">LancsChat</h1>
      <p className="authSubtitle">Exclusive anonymous chat for Lancaster students</p>
    </>
  );
}

function JunkFolderTip() {
  return (
    <p className="authJunkTip">
      <Trash2 size={16} strokeWidth={1.75} />
      Can&apos;t see it? Check your junk folder
    </p>
  );
}

function EmailStatusPanel({
  emailAddress,
  onContinue,
  continueLabel = 'Go to Log In',
}: {
  emailAddress: string;
  onContinue: () => void;
  continueLabel?: string;
}) {
  return (
    <div className="authEmailPanel">
      <div className="authEmailIcon">
        <Mail size={26} strokeWidth={1.75} />
      </div>
      <h2 className="authEmailHeading">Check your email</h2>
      <p className="authEmailAddress">{emailAddress}</p>
      <JunkFolderTip />
      <button type="button" className="authBtnPrimary" onClick={onContinue}>
        {continueLabel}
      </button>
    </div>
  );
}

export default function AuthPage() {
  const { authMessage, clearAuthMessage } = useAuth();
  const [step, setStep] = useState<AuthStep>('welcome');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resetEmail, setResetEmail] = useState('');

  useEffect(() => {
    if (authMessage) {
      setError(authMessage);
      setStep('login');
      clearAuthMessage();
    }
  }, [authMessage, clearAuthMessage]);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!displayName.trim()) {
      setError('Please choose a display name');
      return;
    }

    setLoading(true);
    try {
      const hasRealEmail = email.trim().length > 0;
      const signUpEmail = hasRealEmail
        ? email.toLowerCase().trim()
        : `${displayName.trim().toLowerCase().replace(/[^a-z0-9]/g, '')}${Date.now()}@noemail.lancschat.lol`;

      const { data, error: signUpError } = await supabase.auth.signUp({
        email: signUpEmail,
        password,
        options: {
          data: {
            display_name: displayName.trim(),
            has_real_email: hasRealEmail,
          },
          emailRedirectTo: getAuthRedirectUrl(),
        },
      });

      if (signUpError) throw signUpError;

      if (hasRealEmail) {
        setStep('check-email');
      } else {
        const userId = data?.user?.id;
        if (userId) {
          const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
          const serverUrl = apiUrl.replace('/api', '');
          const confirmRes = await fetch(`${serverUrl}/api/auth/confirm-user`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId }),
          });
          const confirmData = await confirmRes.json();

          if (!confirmRes.ok) {
            throw new Error(confirmData.error || 'Failed to confirm account');
          }

          const { error: loginError } = await supabase.auth.signInWithPassword({
            email: signUpEmail,
            password,
          });
          if (loginError) throw loginError;
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      let loginEmail = email.toLowerCase().trim();

      if (!loginEmail.includes('@')) {
        const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
        const serverUrl = apiUrl.replace('/api', '');
        const response = await fetch(`${serverUrl}/api/email-by-username?username=${encodeURIComponent(loginEmail)}`);
        if (!response.ok) throw new Error('Username not found');
        const data = await response.json();
        loginEmail = data.email;
      }

      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: loginEmail,
        password,
      });
      if (signInError) throw signInError;

      const signedInUser = data.user;
      if (
        signedInUser &&
        !isNoEmailAccount(signedInUser.email) &&
        !isEmailVerified(signedInUser.email, signedInUser.email_confirmed_at)
      ) {
        await supabase.auth.signOut();
        setEmail(loginEmail.includes('@') ? loginEmail : email);
        throw new Error(
          'Your email is not verified yet. Check your inbox (and junk folder), or tap below to resend.',
        );
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const handleResendVerification = async () => {
    const targetEmail = email.includes('@') ? email.toLowerCase().trim() : '';
    if (!targetEmail) {
      setError('Enter your email address above, then try resending.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { error: resendError } = await supabase.auth.resend({
        type: 'signup',
        email: targetEmail,
        options: { emailRedirectTo: getAuthRedirectUrl() },
      });
      if (resendError) throw resendError;
      setStep('check-email');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not resend verification email');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(
        resetEmail.toLowerCase().trim(),
        { redirectTo: `${getAuthRedirectUrl()}/reset-password` },
      );
      if (resetError) throw resetError;
      setStep('reset-sent');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const showResend =
    error.includes('not verified') ||
    error.includes('verification link') ||
    error.includes('no longer valid');

  return (
    <div className="authPage">
      <AuthBackground />

      <div className="authShell animate-fade-in">
        <div className="authCard">
          <AuthHeader />

          {step === 'welcome' && (
            <div>
              <button type="button" className="authBtnPrimary" onClick={() => setStep('login')}>
                Log In
              </button>
              <div className="authDivider">
                <div className="authDividerLine" />
                <span className="authDividerText">OR</span>
                <div className="authDividerLine" />
              </div>
              <button type="button" className="authBtnSecondary" onClick={() => setStep('register')}>
                Create new account
              </button>
            </div>
          )}

          {step === 'register' && (
            <form onSubmit={handleRegister}>
              <div className="authFieldStack">
                <input
                  type="text"
                  className="authInput"
                  placeholder="Display name (others will see this)"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  required
                  maxLength={24}
                />
                <input
                  type="email"
                  className="authInput"
                  placeholder="Email (optional)"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <div className="authPasswordWrap">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    className="authInput"
                    placeholder="Password (min 6 characters)"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                  />
                  <button
                    type="button"
                    className="authEyeBtn"
                    onClick={() => setShowPassword(!showPassword)}
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              {error && <div className="authError">{error}</div>}

              <button type="submit" className="authBtnPrimary" disabled={loading}>
                {loading ? <Loader2 size={16} className="spin" /> : 'Sign Up'}
              </button>
              <button type="button" className="authBtnGhost" onClick={() => { setStep('welcome'); setError(''); }}>
                Back to login
              </button>
            </form>
          )}

          {step === 'check-email' && (
            <EmailStatusPanel
              emailAddress={email}
              onContinue={() => { setStep('login'); setError(''); }}
            />
          )}

          {step === 'login' && (
            <form onSubmit={handleLogin}>
              <div className="authFieldStack">
                <input
                  type="text"
                  className="authInput"
                  placeholder="Email or username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
                <div className="authPasswordWrap">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    className="authInput"
                    placeholder="Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                  <button
                    type="button"
                    className="authEyeBtn"
                    onClick={() => setShowPassword(!showPassword)}
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              {error && <div className="authError">{error}</div>}

              <button type="submit" className="authBtnPrimary" disabled={loading}>
                {loading ? <Loader2 size={16} className="spin" /> : 'Log In'}
              </button>

              {showResend && (
                <button type="button" className="authBtnLink" disabled={loading} onClick={() => void handleResendVerification()}>
                  Resend verification email
                </button>
              )}

              <button
                type="button"
                className="authBtnGhost"
                onClick={() => {
                  setResetEmail(email);
                  setStep('forgot-password');
                }}
              >
                Forgot password?
              </button>

              <div className="authDivider">
                <div className="authDividerLine" />
                <span className="authDividerText">OR</span>
                <div className="authDividerLine" />
              </div>

              <button type="button" className="authBtnLink" onClick={() => { setStep('register'); setError(''); }}>
                Don&apos;t have an account? Sign up
              </button>
            </form>
          )}

          {step === 'forgot-password' && (
            <form onSubmit={handleForgotPassword}>
              {error && <div className="authError">{error}</div>}
              <div className="authFieldStack">
                <input
                  type="email"
                  className="authInput"
                  placeholder="Email"
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  required
                />
              </div>
              <button type="submit" className="authBtnPrimary" disabled={loading}>
                {loading ? <Loader2 size={16} className="spin" /> : 'Send reset link'}
              </button>
              <button type="button" className="authBtnGhost" onClick={() => { setStep('login'); setError(''); }}>
                Back to login
              </button>
            </form>
          )}

          {step === 'reset-sent' && (
            <EmailStatusPanel
              emailAddress={resetEmail}
              onContinue={() => { setStep('login'); setError(''); }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
