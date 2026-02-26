import { useAuth } from './context/AuthContext';
import { useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { SocketProvider } from './context/SocketContext';
import AuthPage from './pages/AuthPage';
import ChatPage from './pages/ChatPage';
import AdminPage from './pages/AdminPage';
import './App.css';

function App() {
  const { user, loading, logout, markIntroSeen, token } = useAuth();
  const [unbanRequested, setUnbanRequested] = useState(false);
  const [unbanMessage, setUnbanMessage] = useState('');
  const [showUnbanForm, setShowUnbanForm] = useState(false);

  const handleUnbanRequest = async () => {
    if (!unbanMessage.trim()) return;
    try {
      await fetch(`${import.meta.env.VITE_SERVER_URL || 'http://localhost:3001'}/api/unban-request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ message: unbanMessage }),
      });
      setUnbanRequested(true);
      setShowUnbanForm(false);
    } catch (err) {
      console.error('Unban request error:', err);
    }
  };

  if (loading) {
    return (
      <div className="appLoading">
        <div className="appLoadingInner animate-fade-in">
          <img
            src="/Lancaster-Uni-Icon-1.png"
            alt="LancsChat"
            className="appLoadingLogo"
          />
          <div className="appLoadingRow">
            <svg className="appLoadingSpinner spin" fill="none" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" opacity="0.25" />
              <path fill="currentColor" opacity="0.75" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <p className="appLoadingText">Loading...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/" element={<AuthPage />} />
        <Route path="/admin" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    );
  }

  if (user.isBanned) {
    return (
      <div className="appGate">
        <div className="appGateCard animate-fade-in">
          <img
            src="/Lancaster-Uni-Icon-1.png"
            alt="LancsChat"
            className="appGateLogo"
          />
          <h2 className="appGateTitle">Your account has been suspended</h2>
          <p className="appGateText">
            {user.bannedReason || 'If you believe this is a mistake, contact support.'}
          </p>
          {unbanRequested ? (
            <p className="appGateSuccess">Your unban request has been submitted. An admin will review it shortly.</p>
          ) : showUnbanForm ? (
            <div className="appGateForm">
              <textarea
                className="appGateTextarea"
                placeholder="Explain why you should be unbanned..."
                value={unbanMessage}
                onChange={(e) => setUnbanMessage(e.target.value)}
                rows={4}
              />
              <div className="appGateFormActions">
                <button className="appGateBtn secondary" onClick={() => setShowUnbanForm(false)}>Cancel</button>
                <button className="appGateBtn" onClick={handleUnbanRequest} disabled={!unbanMessage.trim()}>Submit Request</button>
              </div>
            </div>
          ) : (
            <div className="appGateActions">
              <button className="appGateBtn secondary" onClick={() => setShowUnbanForm(true)}>Request Unban</button>
              <button className="appGateBtn" onClick={() => void logout()}>Log out</button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      {user.hasSeenIntro === false && (
        <div className="introOverlay" role="dialog" aria-modal="true">
          <div className="introCard animate-fade-in">
            <img src="/Lancaster-Uni-Icon-1.png" alt="LancsChat" className="introLogo" />
            <h2 className="introTitle">Welcome to LancsChat</h2>
            <p className="introText">Anonymous chat for Lancaster University students.</p>

            <div className="introRules">
              <h3 className="introRulesTitle">Community rules</h3>
              <div className="introRule">No harassment</div>
              <div className="introRule">No spam</div>
              <div className="introRule">No hate speech</div>
            </div>

            <button className="introBtn" onClick={() => void markIntroSeen()}>
              I understand, let's go
            </button>
          </div>
        </div>
      )}

      <Routes>
        <Route
          path="/"
          element={(
            <SocketProvider>
              <ChatPage />
            </SocketProvider>
          )}
        />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}

export default App
