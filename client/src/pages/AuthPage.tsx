import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { isEmailVerified } from '../lib/authErrors';
import { getAuthRedirectUrl } from '../lib/authRedirect';
import { CheckCircle2, Eye, EyeOff, Loader2, Mail, Trash2 } from 'lucide-react';
import './AuthPage.css';

const PENDING_EMAIL_KEY = 'lancschat_pending_email';

type AuthStep = 'welcome' | 'register' | 'check-email' | 'login' | 'forgot-password' | 'reset-sent';

const LANCASTER_DOMAIN = 'lancaster.ac.uk';

function AuthHeader() {
  return (
    <>
      <img src="/Lancaster-Uni-Icon-1.png" alt="Lancaster University" className="authLogo" />
      <h1 className="authTitle">LancsChat</h1>
      <p className="authSubtitle">Exclusive to Lancaster University students</p>
    </>
  );
}

function EmailStatusPanel({
  emailAddress,
  onContinue,
  onResend,
  resendLoading,
}: {
  emailAddress: string;
  onContinue: () => void;
  onResend?: () => void;
  resendLoading?: boolean;
}) {
  const [resent, setResent] = useState(false);

  const handleResend = async () => {
    if (!onResend) return;
    onResend();
    setResent(true);
    setTimeout(() => setResent(false), 30000);
  };

  return (
    <div className="authEmailPanel">
      <div className="authEmailIcon">
        <Mail size={28} strokeWidth={1.75} />
      </div>
      <h2 className="authEmailHeading">Check your email</h2>
      <p className="authEmailAddress">{emailAddress}</p>
      <p className="authJunkTip">
        <Trash2 size={15} strokeWidth={1.75} />
        Check your junk folder too
      </p>
      {onResend && (
        <button
          type="button"
          className="authBtnGhost"
          disabled={resendLoading || resent}
          onClick={() => void handleResend()}
          style={{ marginBottom: 8 }}
        >
          {resendLoading
            ? 'Sending...'
            : resent
            ? 'Email resent ✓'
            : "Didn't get it? Resend email"}
        </button>
      )}
      <button type="button" className="authBtnPrimary" onClick={onContinue}>
        Go to Log In
      </button>
    </div>
  );
}

export default function AuthPage() {
  const { authMessage, authMessageType, clearAuthMessage } = useAuth();
  const [step, setStep] = useState<AuthStep>('welcome');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false); // green "email confirmed" banner
  const [loading, setLoading] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [allowAllEmails, setAllowAllEmails] = useState(false);

  useEffect(() => {
    if (!authMessage) return;
    if (authMessageType === 'confirmed') {
      // Safe Links already confirmed their email — show success state + pre-fill email
      const pending = sessionStorage.getItem(PENDING_EMAIL_KEY) || '';
      if (pending) setEmail(pending);
      setConfirmed(true);
      setError('');
    } else {
      setError(authMessage);
      setConfirmed(false);
    }
    setStep('login');
    clearAuthMessage();
  }, [authMessage, authMessageType, clearAuthMessage]);

  useEffect(() => {
    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
    fetch(`${apiUrl}/config`)
      .then((r) => r.json())
      .then((data) => { if (data.allowAllEmails) setAllowAllEmails(true); })
      .catch(() => {}); // fail silently — default stays false (strict Lancaster-only)
  }, []);

  const validateEmail = (val: string): string | null => {
    const trimmed = val.toLowerCase().trim();
    if (!trimmed) return 'Please enter an email address.';
    if (!trimmed.includes('@')) return 'Please enter a valid email address.';
    if (!allowAllEmails && !trimmed.endsWith(`@${LANCASTER_DOMAIN}`)) {
      return `LancsChat is exclusive to Lancaster University. Please use your @${LANCASTER_DOMAIN} email.`;
    }
    return null;
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!displayName.trim()) {
      setError('Please choose a display name.');
      return;
    }

    const emailError = validateEmail(email);
    if (emailError) {
      setError(emailError);
      return;
    }

    const signUpEmail = email.toLowerCase().trim();
    setLoading(true);

    try {
      const { error: signUpError } = await supabase.auth.signUp({
        email: signUpEmail,
        password,
        options: {
          data: {
            display_name: displayName.trim(),
            has_real_email: true,
          },
          emailRedirectTo: getAuthRedirectUrl(),
        },
      });

      if (signUpError) throw signUpError;
      // Save email so we can pre-fill it if Safe Links redirects them back with an error
      sessionStorage.setItem(PENDING_EMAIL_KEY, signUpEmail);
      setStep('check-email');
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
      // Block unverified real emails (no-email/noemail accounts are exempt)
      if (
        signedInUser &&
        !(signedInUser.email || '').includes('@noemail.lancschat.lol') &&
        !isEmailVerified(signedInUser.email, signedInUser.email_confirmed_at)
      ) {
        await supabase.auth.signOut();
        setEmail(loginEmail.includes('@') ? loginEmail : email);
        throw new Error(
          'Your email is not verified yet. Check your inbox (and junk folder), or tap below to resend.',
        );
      }

      // Successful login — clean up pending email
      sessionStorage.removeItem(PENDING_EMAIL_KEY);
      setConfirmed(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const handleResendVerification = async () => {
    const targetEmail = email.toLowerCase().trim();
    if (!targetEmail.includes('@')) {
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
    !confirmed && (
      error.includes('not verified') ||
      error.includes('verification link') ||
      error.includes('no longer valid') ||
      error.includes('Resend verification')
    );

  return (
    <div className="authPage">
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
                  autoComplete="off"
                />
                <input
                  type="email"
                  className="authInput"
                  placeholder={allowAllEmails ? 'Email address' : '@lancaster.ac.uk email'}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
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
                    autoComplete="new-password"
                  />
                  <button type="button" className="authEyeBtn" onClick={() => setShowPassword(!showPassword)} tabIndex={-1}>
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>
              {error && <div className="authError">{error}</div>}
              <button type="submit" className="authBtnPrimary" disabled={loading}>
                {loading ? <Loader2 size={16} className="spin" /> : 'Sign Up'}
              </button>
              <button type="button" className="authBtnGhost" onClick={() => { setStep('welcome'); setError(''); }}>
                Back
              </button>
            </form>
          )}

          {step === 'check-email' && (
            <EmailStatusPanel
              emailAddress={email}
              onContinue={() => { setStep('login'); setError(''); }}
              onResend={() => void handleResendVerification()}
              resendLoading={loading}
            />
          )}

          {step === 'login' && (
            <form onSubmit={handleLogin}>
              {confirmed && (
                <div className="authSuccess">
                  <CheckCircle2 size={15} strokeWidth={2} style={{ flexShrink: 0 }} />
                  Email confirmed — enter your password to get in
                </div>
              )}

              <div className="authFieldStack">
                <input
                  type="text"
                  className="authInput"
                  placeholder="Email or username"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setConfirmed(false); }}
                  required
                  autoComplete="email"
                />
                <div className="authPasswordWrap">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    className="authInput"
                    placeholder="Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                  />
                  <button type="button" className="authEyeBtn" onClick={() => setShowPassword(!showPassword)} tabIndex={-1}>
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
                onClick={() => { setResetEmail(email); setStep('forgot-password'); }}
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
                  autoComplete="email"
                />
              </div>
              <button type="submit" className="authBtnPrimary" disabled={loading}>
                {loading ? <Loader2 size={16} className="spin" /> : 'Send reset link'}
              </button>
              <button type="button" className="authBtnGhost" onClick={() => { setStep('login'); setError(''); }}>
                Back
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
