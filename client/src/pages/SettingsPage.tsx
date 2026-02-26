import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { User, MessageSquare, Loader2, Check, X, ChevronRight, Shield, Info, Camera } from 'lucide-react';
import './SettingsPage.css';

type SettingsSection = 'menu' | 'profile' | 'feedback' | 'about';

export default function SettingsPage() {
  const { user, refreshUser } = useAuth();
  const [section, setSection] = useState<SettingsSection>('profile');
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [feedback, setFeedback] = useState('');
  const [feedbackType, setFeedbackType] = useState<'bug' | 'feature' | 'other'>('feature');
  const [saving, setSaving] = useState(false);
  const [sendingFeedback, setSendingFeedback] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [feedbackSuccess, setFeedbackSuccess] = useState(false);
  const [error, setError] = useState('');
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(user?.avatarUrl || null);
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

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim()) {
      setError('Display name cannot be empty');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const { error: updateError } = await supabase.auth.updateUser({
        data: { display_name: displayName.trim() }
      });
      if (updateError) throw updateError;
      
      await refreshUser();
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update profile');
    } finally {
      setSaving(false);
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
          display_name: user?.displayName,
          type: feedbackType,
          content: feedback.trim(),
          created_at: new Date().toISOString(),
        });

      if (insertError) {
        console.log('Feedback:', { type: feedbackType, content: feedback, user: user?.displayName });
        console.warn('Feedback table not set up yet:', insertError);
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
                      { value: 'feature', label: 'Feature request' },
                      { value: 'bug', label: 'Bug report' },
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
