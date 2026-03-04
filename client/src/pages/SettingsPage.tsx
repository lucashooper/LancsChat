import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { api } from '../api';
import { User, MessageSquare, Loader2, Check, X, ChevronRight, Shield, Info, Camera, Trash2 } from 'lucide-react';
import './SettingsPage.css';

type SettingsSection = 'menu' | 'profile' | 'feedback' | 'about' | 'appearance';

export default function SettingsPage() {
  const { user, refreshUser, logout, token } = useAuth();
  const [section, setSection] = useState<SettingsSection>('profile');
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [feedback, setFeedback] = useState('');
  const [feedbackType, setFeedbackType] = useState<'bug_report' | 'feature_request' | 'other'>('feature_request');
  const [saving, setSaving] = useState(false);
  const [sendingFeedback, setSendingFeedback] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [feedbackSuccess, setFeedbackSuccess] = useState(false);
  const [error, setError] = useState('');
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(user?.avatarUrl || null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [theme, setTheme] = useState<'modern' | 'retro' | 'vaporwave'>(
    (localStorage.getItem('lancschat-theme') as 'modern' | 'retro' | 'vaporwave') || 'modern'
  );
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDisplayName(user?.displayName || '');
    setAvatarPreviewUrl(user?.avatarUrl || null);
  }, [user?.displayName, user?.avatarUrl]);

  useEffect(() => {
    return () => {
      if (avatarPreviewUrl && avatarPreviewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(avatarPreviewUrl);
      }
    };
  }, [avatarPreviewUrl]);

  useEffect(() => {
    // Apply theme to document root
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('lancschat-theme', theme);
  }, [theme]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim()) {
      setError('Display name cannot be empty');
      return;
    }

    setSaving(true);
    setError('');
    try {
      console.log('[Settings] Updating display name to:', displayName.trim());
      console.log('[Settings] Using token:', token ? 'Present' : 'Missing');
      console.log('[Settings] API URL:', import.meta.env.VITE_API_URL || 'http://localhost:3001/api');
      
      // Call backend API to update profile
      const response = await api('/me/profile', {
        method: 'PUT',
        token: token || '',
        body: { displayName: displayName.trim() },
      });
      
      console.log('[Settings] Backend update response:', response);
      
      // Refresh user data from server
      await refreshUser();
      console.log('[Settings] User refreshed, new user data:', user);
      
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      console.error('[Settings] Profile update error:', err);
      console.error('[Settings] Error details:', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      
      let errorMessage = 'Failed to update profile';
      if (err instanceof Error) {
        if (err.message.includes('<!DOCTYPE')) {
          errorMessage = 'Server not responding correctly. Please restart your local server or wait for production deployment.';
        } else {
          errorMessage = err.message;
        }
      }
      setError(errorMessage);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!token) {
      setError('Not authenticated');
      return;
    }

    setDeleting(true);
    setError('');
    try {
      console.log('[Settings] Deleting account...');
      await api('/me/account', {
        method: 'DELETE',
        token,
      });
      console.log('[Settings] Account deleted successfully from backend');
      
      // Logout from Supabase (may fail with 403 if user already deleted, which is fine)
      try {
        console.log('[Settings] Logging out from Supabase...');
        await logout();
        console.log('[Settings] Supabase logout successful');
      } catch (logoutErr) {
        console.log('[Settings] Supabase logout failed (expected if user deleted):', logoutErr);
        // Force logout by clearing local session
        await supabase.auth.signOut({ scope: 'local' });
        window.location.href = '/';
      }
    } catch (err) {
      console.error('[Settings] Account deletion error:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete account');
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const uploadAvatar = async (file: File) => {
    if (!user) {
      setError('Not signed in');
      return;
    }

    const nextPreview = URL.createObjectURL(file);
    setAvatarPreviewUrl(nextPreview);
    setUploadingAvatar(true);
    setError('');

    try {
      const ext = (file.name.split('.').pop() || 'png').toLowerCase();
      const filePath = `${user.id}/${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, file, {
          upsert: true,
          contentType: file.type || 'image/png',
        });

      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from('avatars').getPublicUrl(filePath);
      const publicUrl = data.publicUrl;

      const { error: updateError } = await supabase.auth.updateUser({
        data: { avatar_url: publicUrl }
      });
      if (updateError) throw updateError;

      await refreshUser();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Avatar upload failed. Ensure Supabase Storage bucket 'avatars' exists and is accessible."
      );
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleSendFeedback = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!feedback.trim()) {
      setError('Please enter your feedback');
      return;
    }

    setSendingFeedback(true);
    setError('');
    try {
      const { error: insertError } = await supabase
        .from('feedback')
        .insert({
          user_id: user?.id,
          user_email: user?.email,
          user_display_name: user?.displayName,
          feedback_type: feedbackType,
          feedback_text: feedback.trim(),
        });

      if (insertError) {
        console.error('Failed to submit feedback:', insertError);
        setError('Failed to submit feedback. Please try again.');
        return;
      }

      setFeedback('');
      setFeedbackSuccess(true);
      setTimeout(() => setFeedbackSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send feedback');
    } finally {
      setSendingFeedback(false);
    }
  };

  const menuItems = [
    { id: 'profile' as const, label: 'Edit profile', desc: 'Display name, avatar', icon: <User className="settingsMenuIcon" /> },
    { id: 'appearance' as const, label: 'Appearance', desc: 'Modern or Retro theme', icon: <Info className="settingsMenuIcon" /> },
    { id: 'feedback' as const, label: 'Send feedback', desc: 'Bug reports, feature requests', icon: <MessageSquare className="settingsMenuIcon" /> },
    { id: 'about' as const, label: 'About & Privacy', desc: 'How LancsChat works', icon: <Shield className="settingsMenuIcon" /> },
  ];

  /* ── Two-column layout: settings menu on left, content on right ── */
  return (
    <div className="settingsPage">
      <div className="settingsInner">
        <h1 className="settingsTitle">Settings</h1>

        <div className="settingsColumns">

          {/* Settings Sidebar / Menu */}
          <div className="settingsMenu">
            <div className="settingsMenuList">
              {menuItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => { setSection(item.id); setError(''); }}
                  className={`settingsMenuItem ${section === item.id ? 'isActive' : ''}`}
                >
                  {item.icon}
                  <div className="settingsMenuText">
                    <p className="settingsMenuLabel">{item.label}</p>
                    <p className="settingsMenuDesc">{item.desc}</p>
                  </div>
                  <ChevronRight className="settingsChevron" />
                </button>
              ))}
            </div>
          </div>

          {/* Settings Content */}
          <div className="settingsContent">

          {/* Profile */}
          {section === 'profile' && (
            <>
              <h2 className="settingsSectionTitle">Edit profile</h2>

              {/* Avatar preview */}
              <div className="profileCard">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="avatarButton"
                  style={{ backgroundColor: user?.avatarColor }}
                  disabled={uploadingAvatar}
                  title="Change photo"
                >
                  {avatarPreviewUrl ? (
                    <img src={avatarPreviewUrl} alt={displayName || user?.displayName || 'Avatar'} className="avatarImg" />
                  ) : (
                    <div className="avatarFallback">
                      {displayName?.charAt(0) || user?.displayName?.charAt(0)}
                    </div>
                  )}

                  <div className="avatarOverlay">
                    {uploadingAvatar ? (
                      <Loader2 className="settingsMenuIcon spin" />
                    ) : (
                      <Camera className="settingsMenuIcon" />
                    )}
                  </div>
                </button>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void uploadAvatar(f);
                    e.target.value = '';
                  }}
                />

                <div className="profileMeta">
                  <p className="profileName">{displayName || user?.displayName}</p>
                  <p className="profileEmail">{user?.email}</p>
                </div>
              </div>

              <form onSubmit={handleSaveProfile} className="formStack">
                <div className="fieldStack">
                  <label className="fieldLabel">Display name</label>
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    maxLength={24}
                    className="textInput"
                    placeholder="Your display name"
                  />
                  <p className="helpText">
                    This is how others see you in chats. Your email is never shown to other users.
                  </p>
                </div>

                {error && (
                  <div className="alert alertError">
                    <X className="alertIcon" />
                    {error}
                  </div>
                )}

                {saveSuccess && (
                  <div className="alert alertSuccess">
                    <Check className="alertIcon" />
                    Profile updated successfully
                  </div>
                )}

                <button
                  type="submit"
                  disabled={saving || !displayName.trim()}
                  className="primaryButton"
                >
                  {saving ? (
                    <>
                      <Loader2 className="settingsMenuIcon spin" />
                      Saving...
                    </>
                  ) : (
                    'Submit'
                  )}
                </button>
              </form>

              {/* Delete Account Section */}
              <div className="dangerZone">
                <h3 className="dangerZoneTitle">Danger Zone</h3>
                <p className="dangerZoneDesc">
                  Once you delete your account, there is no going back. All your messages will be deleted.
                </p>
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(true)}
                  className="dangerButton"
                >
                  <Trash2 size={16} />
                  Delete Account
                </button>
              </div>

              {/* Delete Confirmation Modal */}
              {showDeleteConfirm && (
                <div className="modalOverlay" onClick={() => setShowDeleteConfirm(false)}>
                  <div className="modalContent" onClick={(e) => e.stopPropagation()}>
                    <h3 className="modalTitle">Delete Account?</h3>
                    <p className="modalDesc">
                      This action cannot be undone. Your account and all your messages will be permanently deleted.
                    </p>
                    <div className="modalActions">
                      <button
                        onClick={() => setShowDeleteConfirm(false)}
                        className="secondaryButton"
                        disabled={deleting}
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleDeleteAccount}
                        className="dangerButton"
                        disabled={deleting}
                      >
                        {deleting ? (
                          <>
                            <Loader2 className="settingsMenuIcon spin" />
                            Deleting...
                          </>
                        ) : (
                          <>
                            <Trash2 size={16} />
                            Delete Forever
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Appearance */}
          {section === 'appearance' && (
            <>
              <h2 className="settingsSectionTitle">Appearance</h2>

              <div className="formStack">
                <div className="fieldStack">
                  <label className="fieldLabel">
                    Choose your theme
                  </label>
                  
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
                    {/* Modern Theme */}
                    <button
                      type="button"
                      onClick={() => setTheme('modern')}
                      style={{
                        padding: '14px 16px',
                        borderRadius: '12px',
                        border: theme === 'modern' ? '2px solid #0095f6' : '2px solid rgba(255,255,255,0.15)',
                        background: theme === 'modern' ? 'rgba(0,149,246,0.1)' : 'rgba(255,255,255,0.03)',
                        color: '#fff',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        textAlign: 'left',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                      }}
                    >
                      <span style={{ fontSize: '20px', lineHeight: 1 }}>✨</span>
                      <div style={{ flex: 1 }}>
                        <span style={{ fontSize: '15px', fontWeight: 600 }}>Modern</span>
                        <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.5)', marginLeft: '8px' }}>Clean & minimal</span>
                      </div>
                      {theme === 'modern' && (
                        <span style={{ color: '#0095f6', fontSize: '13px', fontWeight: 600 }}>✓</span>
                      )}
                    </button>

                    {/* Retro Theme */}
                    <button
                      type="button"
                      onClick={() => setTheme('retro')}
                      style={{
                        padding: '14px 16px',
                        borderRadius: '12px',
                        border: theme === 'retro' ? '2px solid #a67c52' : '2px solid rgba(255,255,255,0.15)',
                        background: theme === 'retro' ? 'rgba(166,124,82,0.15)' : 'rgba(255,255,255,0.03)',
                        color: '#fff',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        textAlign: 'left',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                      }}
                    >
                      <span style={{ fontSize: '20px', lineHeight: 1 }}>🎮</span>
                      <div style={{ flex: 1 }}>
                        <span style={{ fontSize: '15px', fontWeight: 600 }}>Retro</span>
                        <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.5)', marginLeft: '8px' }}>Early 2000s vibes</span>
                      </div>
                      {theme === 'retro' && (
                        <span style={{ color: '#a67c52', fontSize: '13px', fontWeight: 600 }}>✓</span>
                      )}
                    </button>

                    {/* Vaporwave Theme */}
                    <button
                      type="button"
                      onClick={() => setTheme('vaporwave')}
                      style={{
                        padding: '14px 16px',
                        borderRadius: '12px',
                        border: theme === 'vaporwave' ? '2px solid #ff71ce' : '2px solid rgba(255,255,255,0.15)',
                        background: theme === 'vaporwave' ? 'rgba(255,113,206,0.1)' : 'rgba(255,255,255,0.03)',
                        color: '#fff',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        textAlign: 'left',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                      }}
                    >
                      <span style={{ fontSize: '20px', lineHeight: 1 }}>🌆</span>
                      <div style={{ flex: 1 }}>
                        <span style={{ fontSize: '15px', fontWeight: 600 }}>Vaporwave</span>
                        <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.5)', marginLeft: '8px' }}>Synthwave neon</span>
                      </div>
                      {theme === 'vaporwave' && (
                        <span style={{ color: '#ff71ce', fontSize: '13px', fontWeight: 600 }}>✓</span>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Feedback */}
          {section === 'feedback' && (
            <>
              <h2 className="settingsSectionTitle">Send feedback</h2>

              <form onSubmit={handleSendFeedback} className="formStack">
                <div className="chipGroup">
                  <label className="fieldLabel">
                    What type of feedback?
                  </label>
                  <div className="chipRow">
                    {[
                      { value: 'feature_request', label: 'Feature request' },
                      { value: 'bug_report', label: 'Bug report' },
                      { value: 'other', label: 'Other' },
                    ].map((type) => (
                      <button
                        key={type.value}
                        type="button"
                        onClick={() => setFeedbackType(type.value as typeof feedbackType)}
                        className={`chipButton ${feedbackType === type.value ? 'isActive' : ''}`}
                      >
                        {type.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="fieldStack">
                  <label className="fieldLabel">
                    Your feedback
                  </label>
                  <textarea
                    value={feedback}
                    onChange={(e) => setFeedback(e.target.value)}
                    rows={6}
                    className="textArea"
                    placeholder="Tell us what you think, what features you'd like, or report any bugs..."
                  />
                </div>

                {error && (
                  <div className="alert alertError">
                    <X className="alertIcon" />
                    {error}
                  </div>
                )}

                {feedbackSuccess && (
                  <div className="alert alertSuccess">
                    <Check className="alertIcon" />
                    Thank you! Your feedback has been sent.
                  </div>
                )}

                <button
                  type="submit"
                  disabled={sendingFeedback || !feedback.trim()}
                  className="primaryButton"
                >
                  {sendingFeedback ? (
                    <>
                      <Loader2 className="settingsMenuIcon spin" />
                      Sending...
                    </>
                  ) : (
                    'Send Feedback'
                  )}
                </button>
              </form>
            </>
          )}

          {/* About */}
          {section === 'about' && (
            <>
              <h2 className="settingsSectionTitle">About & Privacy</h2>

              <div className="aboutHeader">
                <img
                  src="/Lancaster-Uni-Icon-1.png"
                  alt="LancsChat"
                  className="aboutLogo"
                />
                <div>
                  <p className="aboutAppName">LancsChat</p>
                  <p className="aboutVersion">v1.0.0</p>
                </div>
              </div>

              <p className="aboutText">
                Anonymous chat for Lancaster University students. Connect with fellow students, 
                join conversations, and make new friends — all while staying anonymous.
              </p>

              <div>
                <h3 className="aboutBlockTitle">Privacy</h3>
                <div className="aboutList">
                  <div className="aboutListItem">
                    <Info className="aboutInfoIcon" />
                    <p className="aboutListText">Your identity is always anonymous — others only see your display name</p>
                  </div>
                  <div className="aboutListItem">
                    <Info className="aboutInfoIcon" />
                    <p className="aboutListText">We verify you're a Lancaster student via your @lancaster.ac.uk email</p>
                  </div>
                  <div className="aboutListItem">
                    <Info className="aboutInfoIcon" />
                    <p className="aboutListText">Your email is never shared with other users</p>
                  </div>
                </div>
              </div>
            </>
          )}

          {section === 'menu' && null}
          </div>
        </div>
      </div>
    </div>
  );
}
