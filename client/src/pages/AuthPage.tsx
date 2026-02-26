import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { Eye, EyeOff, Loader2 } from 'lucide-react';

type AuthStep = 'welcome' | 'register' | 'check-email' | 'login' | 'forgot-password' | 'reset-sent';

const ALLOWED_DOMAIN = 'lancaster.ac.uk';
void ALLOWED_DOMAIN;

export default function AuthPage() {
  const [step, setStep] = useState<AuthStep>('welcome');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resetEmail, setResetEmail] = useState('');

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const domain = email.split('@')[1]?.toLowerCase();
    if (domain !== ALLOWED_DOMAIN) {
      setError('Only @lancaster.ac.uk email addresses are allowed');
      return;
    }
    if (!displayName.trim()) {
      setError('Please choose a display name');
      return;
    }

    setLoading(true);
    try {
      const { error: signUpError } = await supabase.auth.signUp({
        email: email.toLowerCase(),
        password,
        options: {
          data: {
            display_name: displayName.trim(),
          },
          emailRedirectTo: import.meta.env.VITE_APP_URL || window.location.origin,
        },
      });
      if (signUpError) throw signUpError;
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
      
      // If input doesn't contain @, treat as username and fetch email from server
      if (!loginEmail.includes('@')) {
        const response = await fetch(`${import.meta.env.VITE_SERVER_URL || 'http://localhost:3001'}/api/email-by-username?username=${encodeURIComponent(loginEmail)}`);
        if (!response.ok) {
          throw new Error('Username not found');
        }
        const data = await response.json();
        loginEmail = data.email;
      }
      
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: loginEmail,
        password,
      });
      if (signInError) throw signInError;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
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
        {
          redirectTo: `${import.meta.env.VITE_APP_URL || window.location.origin}/reset-password`,
        }
      );
      if (resetError) throw resetError;
      setStep('reset-sent');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '14px 16px',
    backgroundColor: '#121212',
    border: '1px solid #363636',
    borderRadius: '6px',
    color: '#fafafa',
    fontSize: '14px',
    outline: 'none',
    transition: 'border-color 0.2s',
    fontFamily: 'inherit',
  };

  const primaryBtnStyle: React.CSSProperties = {
    width: '100%',
    padding: '12px 16px',
    backgroundColor: '#0095f6',
    border: 'none',
    borderRadius: '10px',
    color: '#fff',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'background-color 0.2s',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    fontFamily: 'inherit',
  };

  const secondaryBtnStyle: React.CSSProperties = {
    width: '100%',
    padding: '12px 16px',
    backgroundColor: 'transparent',
    border: '1px solid #363636',
    borderRadius: '10px',
    color: '#a8a8a8',
    fontSize: '14px',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.2s',
    fontFamily: 'inherit',
  };

  const cardStyle: React.CSSProperties = {
    backgroundColor: '#000',
    border: '1px solid #262626',
    borderRadius: '12px',
    padding: '40px',
    width: '100%',
    maxWidth: '400px',
  };

  const dividerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    margin: '20px 0',
  };

  const dividerLineStyle: React.CSSProperties = {
    flex: 1,
    height: '1px',
    backgroundColor: '#262626',
  };

  const passwordWrapperStyle: React.CSSProperties = {
    position: 'relative',
    width: '100%',
  };

  const eyeBtnStyle: React.CSSProperties = {
    position: 'absolute',
    right: '12px',
    top: '50%',
    transform: 'translateY(-50%)',
    background: 'none',
    border: 'none',
    color: '#737373',
    cursor: 'pointer',
    padding: '4px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  };

  const errorStyle: React.CSSProperties = {
    padding: '12px 14px',
    backgroundColor: 'rgba(239,68,68,0.1)',
    border: '1px solid rgba(239,68,68,0.2)',
    borderRadius: '8px',
    color: '#f87171',
    fontSize: '13px',
    marginBottom: '14px',
  };

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#000',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '20px',
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    }}>
      <div style={{ width: '100%', maxWidth: '400px' }} className="animate-fade-in">

        {/* Main Card */}
        <div style={cardStyle}>
          {/* Logo */}
          <img
            src="/Lancaster-Uni-Icon-1.png"
            alt="Lancaster University"
            style={{
              height: '40px',
              width: '40px',
              margin: '0 auto 16px',
              display: 'block',
              objectFit: 'contain',
            }}
          />
          {/* Title */}
          <h1 style={{
            fontSize: '30px',
            fontWeight: 700,
            color: '#fafafa',
            textAlign: 'center',
            marginBottom: '4px',
            letterSpacing: '-0.5px',
          }}>
            LancsChat
          </h1>
          <p style={{
            color: '#737373',
            fontSize: '14px',
            textAlign: 'center',
            marginBottom: '28px',
            lineHeight: '20px',
          }}>
            Anonymous chat for Lancaster University students
          </p>

          {/* Welcome */}
          {step === 'welcome' && (
            <div>
              <button
                onClick={() => setStep('login')}
                style={primaryBtnStyle}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#1aa1f7'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#0095f6'; }}
              >
                Log In
              </button>

              <div style={dividerStyle}>
                <div style={dividerLineStyle} />
                <span style={{ color: '#737373', fontSize: '13px', fontWeight: 500 }}>OR</span>
                <div style={dividerLineStyle} />
              </div>

              <button
                onClick={() => setStep('register')}
                style={secondaryBtnStyle}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#555'; e.currentTarget.style.color = '#e0e0e0'; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#363636'; e.currentTarget.style.color = '#a8a8a8'; }}
              >
                Create new account
              </button>
            </div>
          )}

          {/* Register */}
          {step === 'register' && (
            <form onSubmit={handleRegister}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '18px' }}>
                <input
                  type="text"
                  placeholder="Display name (others will see this)"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  required
                  maxLength={24}
                  style={inputStyle}
                  onFocus={(e) => { e.currentTarget.style.borderColor = '#0095f6'; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = '#363636'; }}
                />
                <input
                  type="email"
                  placeholder="University email (@lancaster.ac.uk)"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  style={inputStyle}
                  onFocus={(e) => { e.currentTarget.style.borderColor = '#0095f6'; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = '#363636'; }}
                />
                <div style={passwordWrapperStyle}>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Password (min 6 characters)"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                    style={{ ...inputStyle, paddingRight: '44px' }}
                    onFocus={(e) => { e.currentTarget.style.borderColor = '#0095f6'; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = '#363636'; }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    style={eyeBtnStyle}
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              {error && <div style={errorStyle}>{error}</div>}

              <button
                type="submit"
                disabled={loading}
                style={{ ...primaryBtnStyle, opacity: loading ? 0.6 : 1 }}
                onMouseEnter={(e) => { if (!loading) e.currentTarget.style.backgroundColor = '#1aa1f7'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#0095f6'; }}
              >
                {loading ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : 'Sign Up'}
              </button>

              <button
                type="button"
                onClick={() => { setStep('welcome'); setError(''); }}
                style={{
                  width: '100%',
                  padding: '10px',
                  background: 'none',
                  border: 'none',
                  color: '#737373',
                  fontSize: '13px',
                  cursor: 'pointer',
                  marginTop: '12px',
                  fontFamily: 'inherit',
                }}
              >
                Back to login
              </button>
            </form>
          )}

          {/* Check Email */}
          {step === 'check-email' && (
            <div style={{ textAlign: 'center' }}>
              <div style={{
                width: '56px',
                height: '56px',
                borderRadius: '50%',
                backgroundColor: '#0095f6',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 20px',
                fontSize: '24px',
              }}>
                ✉️
              </div>
              <h2 style={{ color: '#fafafa', fontSize: '18px', fontWeight: 600, marginBottom: '8px' }}>
                Check your email
              </h2>
              <p style={{ color: '#a8a8a8', fontSize: '14px', lineHeight: '22px', marginBottom: '8px' }}>
                We sent a confirmation link to
              </p>
              <p style={{ color: '#fafafa', fontSize: '14px', fontWeight: 500, marginBottom: '24px' }}>
                {email}
              </p>
              <p style={{ color: '#737373', fontSize: '13px', lineHeight: '20px', marginBottom: '24px' }}>
                Click the link in the email to verify your account. You can close this page.
              </p>
              <button
                onClick={() => { setStep('login'); setError(''); }}
                style={primaryBtnStyle}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#1aa1f7'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#0095f6'; }}
              >
                Go to Log In
              </button>
            </div>
          )}

          {/* Login */}
          {step === 'login' && (
            <form onSubmit={handleLogin}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '18px' }}>
                <input
                  type="text"
                  placeholder="Email or username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  style={inputStyle}
                  onFocus={(e) => { e.currentTarget.style.borderColor = '#0095f6'; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = '#363636'; }}
                />
                <div style={passwordWrapperStyle}>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    style={{ ...inputStyle, paddingRight: '44px' }}
                    onFocus={(e) => { e.currentTarget.style.borderColor = '#0095f6'; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = '#363636'; }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    style={eyeBtnStyle}
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              {error && <div style={errorStyle}>{error}</div>}

              <button
                type="submit"
                disabled={loading}
                style={{ ...primaryBtnStyle, opacity: loading ? 0.6 : 1 }}
                onMouseEnter={(e) => { if (!loading) e.currentTarget.style.backgroundColor = '#1aa1f7'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#0095f6'; }}
              >
                {loading ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : 'Log In'}
              </button>

              <button
                type="button"
                onClick={() => {
                  setResetEmail(email);
                  setStep('forgot-password');
                }}
                style={{
                  width: '100%',
                  padding: '10px',
                  background: 'none',
                  border: 'none',
                  color: '#737373',
                  fontSize: '13px',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                Forgot password?
              </button>

              <div style={dividerStyle}>
                <div style={dividerLineStyle} />
                <span style={{ color: '#737373', fontSize: '13px', fontWeight: 500 }}>OR</span>
                <div style={dividerLineStyle} />
              </div>

              <button
                type="button"
                onClick={() => { setStep('register'); setError(''); }}
                style={{
                  width: '100%',
                  padding: '10px',
                  background: 'none',
                  border: 'none',
                  color: '#0095f6',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                Don't have an account? Sign up
              </button>
            </form>
          )}
        </div>

        {/* Footer */}
        <p style={{
          textAlign: 'center',
          color: '#484848',
          fontSize: '12px',
          marginTop: '24px',
          lineHeight: '18px',
        }}>
          Your identity is always anonymous.<br />
          We only verify you're a Lancaster student.
        </p>

        {step === 'check-email' && (
          <div className="authCard">
            <h1 className="authTitle">Check your email</h1>
            <p className="authText">
              We sent a confirmation link to <strong>{email}</strong>
            </p>
            <p className="authText">
              Click the link in the email to verify your account and start chatting.
            </p>
          </div>
        )}

        {step === 'forgot-password' && (
          <form onSubmit={handleForgotPassword}>
            {error && <div style={errorStyle}>{error}</div>}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '18px' }}>
              <input
                type="email"
                placeholder="University email (@lancaster.ac.uk)"
                value={resetEmail}
                onChange={(e) => setResetEmail(e.target.value)}
                required
                style={inputStyle}
                onFocus={(e) => { e.currentTarget.style.borderColor = '#0095f6'; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = '#363636'; }}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              style={{ ...primaryBtnStyle, opacity: loading ? 0.6 : 1 }}
              onMouseEnter={(e) => { if (!loading) e.currentTarget.style.backgroundColor = '#1aa1f7'; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#0095f6'; }}
            >
              {loading ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : 'Send reset link'}
            </button>

            <button
              type="button"
              onClick={() => { setStep('login'); setError(''); }}
              style={{
                width: '100%',
                padding: '10px',
                background: 'none',
                border: 'none',
                color: '#737373',
                fontSize: '13px',
                cursor: 'pointer',
                marginTop: '12px',
                fontFamily: 'inherit',
              }}
            >
              Back to login
            </button>
          </form>
        )}

        {step === 'reset-sent' && (
          <div style={{ textAlign: 'center' }}>
            <div style={{
              width: '56px',
              height: '56px',
              borderRadius: '50%',
              backgroundColor: '#0095f6',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 20px',
              fontSize: '24px',
            }}>
              ✉️
            </div>
            <h2 style={{ color: '#fafafa', fontSize: '18px', fontWeight: 600, marginBottom: '8px' }}>
              Check your email
            </h2>
            <p style={{ color: '#a8a8a8', fontSize: '14px', lineHeight: '22px', marginBottom: '8px' }}>
              We sent a password reset link to
            </p>
            <p style={{ color: '#fafafa', fontSize: '14px', fontWeight: 500, marginBottom: '24px' }}>
              {resetEmail}
            </p>
            <p style={{ color: '#737373', fontSize: '13px', lineHeight: '20px', marginBottom: '24px' }}>
              Click the link in the email to reset your password. You can close this page.
            </p>
            <button
              onClick={() => { setStep('login'); setError(''); }}
              style={primaryBtnStyle}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#1aa1f7'; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#0095f6'; }}
            >
              Go to Log In
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
