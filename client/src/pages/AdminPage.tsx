import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../api';
import './AdminPage.css';

type AdminTab = 'stats' | 'users' | 'reports' | 'deleted' | 'feedback' | 'unban-requests';

type AdminUserRow = {
  id: string;
  email: string;
  displayName: string;
  avatarColor: string;
  isAdmin: boolean;
  isBanned: boolean;
  bannedAt: number | null;
  bannedReason: string | null;
  createdAt: number;
  lastSeen: number;
};

type ReportRow = {
  id: string;
  reportType?: 'message' | 'user';
  reason: string;
  createdAt: number;
  resolvedAt: number | null;
  resolvedBy: string | null;
  reporter: { id: string; displayName: string };
  reportedUser: { id: string; displayName: string };
  message: {
    id: string;
    content: string;
    isDeleted: boolean;
    roomId: string | null;
    recipientId: string | null;
    type: string;
    createdAt: number;
  };
};

type DeletedMessageRow = {
  id: string;
  messageId: string;
  deletedBy: string;
  deletedAt: number;
  reason: string | null;
  originalContent: string;
  sender: { id: string; displayName: string };
  roomId: string | null;
  recipientId: string | null;
  type: string;
  messageCreatedAt: number;
};

type FeedbackRow = {
  id: string;
  userId: string;
  displayName: string;
  type: string;
  content: string;
  createdAt: string;
};

type UnbanRequestRow = {
  id: number;
  userId: string;
  displayName: string;
  message: string;
  createdAt: number;
  resolvedAt: number | null;
  resolvedBy: string | null;
};

type StatsData = {
  messageCount: number;
  userCount: number;
  roomCount: number;
  dmCount: number;
  dbSizeMB: string;
};

function formatTs(ts: number | null) {
  if (!ts) return '-';
  const d = new Date(ts * 1000);
  return d.toLocaleString();
}

export default function AdminPage() {
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<AdminTab>('stats');
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [deleted, setDeleted] = useState<DeletedMessageRow[]>([]);
  const [feedback, setFeedback] = useState<FeedbackRow[]>([]);
  const [unbanRequests, setUnbanRequests] = useState<UnbanRequestRow[]>([]);
  const [statsData, setStatsData] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const canView = !!token && !!user?.isAdmin;

  const load = async () => {
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      if (tab === 'users') {
        const rows = await api('/admin/users', { token });
        setUsers(rows);
      } else if (tab === 'reports') {
        const rows = await api('/admin/reports', { token });
        setReports(rows);
      } else if (tab === 'deleted') {
        const rows = await api('/admin/deleted-messages', { token });
        setDeleted(rows);
      } else if (tab === 'feedback') {
        const rows = await api('/admin/feedback', { token });
        setFeedback(rows);
      } else if (tab === 'unban-requests') {
        const rows = await api('/admin/unban-requests', { token });
        setUnbanRequests(rows);
      } else if (tab === 'stats') {
        const data = await api('/admin/stats', { token });
        setStatsData(data);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load admin data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [tab]);

  const stats = useMemo(() => {
    return {
      users: users.length,
      banned: users.filter((u) => u.isBanned).length,
      openReports: reports.filter((r) => !r.resolvedAt).length,
    };
  }, [users, reports]);

  const banUser = async (userId: string, reason: string) => {
    if (!token) return;
    await api('/admin/ban', { token, method: 'POST', body: { userId, reason } });
    await load();
  };

  const unbanUser = async (userId: string) => {
    if (!token) return;
    await api('/admin/unban', { token, method: 'POST', body: { userId } });
    await load();
  };

  const resolveReport = async (reportId: string) => {
    if (!token) return;
    await api(`/admin/reports/${reportId}/resolve`, { token, method: 'POST' });
    await load();
  };

  if (!canView) {
    return (
      <div className="adminPage">
        <div className="adminInner">
          <h1 className="adminTitle">Admin</h1>
          <div className="adminCard">
            <p className="adminMuted">You do not have access to this page.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="adminPage">
      <div className="adminInner">
        <div className="adminHeader">
          <div className="adminHeaderLeft">
            <button className="adminBtn" onClick={() => navigate('/')}>Back to chat</button>
            <h1 className="adminTitle">Admin</h1>
          </div>
          <div className="adminStats">
            <span className="adminStat">Users: {stats.users}</span>
            <span className="adminStat">Banned: {stats.banned}</span>
            <span className="adminStat">Open reports: {stats.openReports}</span>
          </div>
        </div>

        <div className="adminTabs">
          <button className={`adminTab ${tab === 'stats' ? 'isActive' : ''}`} onClick={() => setTab('stats')}>Statistics</button>
          <button className={`adminTab ${tab === 'users' ? 'isActive' : ''}`} onClick={() => setTab('users')}>Users</button>
          <button className={`adminTab ${tab === 'reports' ? 'isActive' : ''}`} onClick={() => setTab('reports')}>Reports</button>
          <button className={`adminTab ${tab === 'deleted' ? 'isActive' : ''}`} onClick={() => setTab('deleted')}>Deleted messages</button>
          <button className={`adminTab ${tab === 'feedback' ? 'isActive' : ''}`} onClick={() => setTab('feedback')}>Feedback</button>
          <button className={`adminTab ${tab === 'unban-requests' ? 'isActive' : ''}`} onClick={() => setTab('unban-requests')}>Unban Requests</button>
        </div>

        {error && (
          <div className="adminAlert adminAlertError">{error}</div>
        )}

        {loading ? (
          <div className="adminCard">
            <p className="adminMuted">Loading…</p>
          </div>
        ) : (
          <>
            {tab === 'stats' && statsData && (
              <div className="adminCard">
                <h2 style={{ fontSize: '20px', fontWeight: 600, marginBottom: '20px' }}>Database Statistics</h2>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
                  <div style={{ padding: '16px', background: 'rgba(255,255,255,0.05)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)' }}>
                    <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.6)', marginBottom: '8px' }}>Total Messages</div>
                    <div style={{ fontSize: '28px', fontWeight: 600 }}>{statsData.messageCount.toLocaleString()}</div>
                  </div>
                  <div style={{ padding: '16px', background: 'rgba(255,255,255,0.05)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)' }}>
                    <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.6)', marginBottom: '8px' }}>Total Users</div>
                    <div style={{ fontSize: '28px', fontWeight: 600 }}>{statsData.userCount.toLocaleString()}</div>
                  </div>
                  <div style={{ padding: '16px', background: 'rgba(255,255,255,0.05)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)' }}>
                    <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.6)', marginBottom: '8px' }}>Total Rooms</div>
                    <div style={{ fontSize: '28px', fontWeight: 600 }}>{statsData.roomCount.toLocaleString()}</div>
                  </div>
                  <div style={{ padding: '16px', background: 'rgba(255,255,255,0.05)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)' }}>
                    <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.6)', marginBottom: '8px' }}>DM Conversations</div>
                    <div style={{ fontSize: '28px', fontWeight: 600 }}>{statsData.dmCount.toLocaleString()}</div>
                  </div>
                  <div style={{ padding: '16px', background: 'rgba(255,255,255,0.05)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)' }}>
                    <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.6)', marginBottom: '8px' }}>Database Size</div>
                    <div style={{ fontSize: '28px', fontWeight: 600 }}>{statsData.dbSizeMB} <span style={{ fontSize: '16px', color: 'rgba(255,255,255,0.6)' }}>MB</span></div>
                  </div>
                </div>
                <div style={{ marginTop: '24px', padding: '16px', background: 'rgba(0,149,246,0.1)', borderRadius: '12px', border: '1px solid rgba(0,149,246,0.2)' }}>
                  <div style={{ fontSize: '14px', color: 'rgba(255,255,255,0.8)' }}>
                    <strong>💡 Monitoring Tips:</strong>
                    <ul style={{ marginTop: '8px', paddingLeft: '20px', lineHeight: '1.6' }}>
                      <li>Database size under 100MB is healthy for free/starter tier</li>
                      <li>Monitor this page weekly during first month of launch</li>
                      <li>If DB size exceeds 500MB, consider implementing message cleanup</li>
                      <li>Check Render metrics for RAM/CPU usage alongside these stats</li>
                    </ul>
                  </div>
                </div>
              </div>
            )}

            {tab === 'users' && (
              <div className="adminCard">
                <div className="adminTable">
                  <div className="adminRow adminHead">
                    <div>User</div>
                    <div>Email</div>
                    <div>Status</div>
                    <div>Last seen</div>
                    <div>Actions</div>
                  </div>
                  {users.map((u) => (
                    <div key={u.id} className="adminRow">
                      <div className="adminUserCell">
                        <div className="adminAvatar" style={{ backgroundColor: u.avatarColor }}>{u.displayName.charAt(0)}</div>
                        <div className="adminUserText">
                          <div className="adminUserName">{u.displayName}{u.isAdmin ? ' (admin)' : ''}</div>
                          <div className="adminMuted adminSmall">{u.id}</div>
                        </div>
                      </div>
                      <div className="adminMono">{u.email}</div>
                      <div>
                        {u.isBanned ? (
                          <span className="adminBadge adminBadgeBad">Banned</span>
                        ) : (
                          <span className="adminBadge adminBadgeOk">Active</span>
                        )}
                      </div>
                      <div className="adminMuted">{formatTs(u.lastSeen)}</div>
                      <div className="adminActions">
                        {!u.isBanned ? (
                          <button
                            className="adminBtn adminBtnBad"
                            onClick={() => {
                              const reason = window.prompt('Ban reason', 'Violation of community rules') || 'Banned by admin';
                              void banUser(u.id, reason);
                            }}
                          >
                            Ban
                          </button>
                        ) : (
                          <button className="adminBtn" onClick={() => void unbanUser(u.id)}>Unban</button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {tab === 'reports' && (
              <div className="adminCard">
                {reports.length === 0 ? (
                  <p className="adminMuted">No reports.</p>
                ) : (
                  <div className="adminList">
                    {reports.map((r) => (
                      <div key={r.id} className="adminReport">
                        <div className="adminReportTop">
                          <div className="adminReportTitle">
                            {(r.reportType || 'message').toUpperCase()} · {r.reason.toUpperCase()} {r.resolvedAt ? '(resolved)' : ''}
                          </div>
                          <div className="adminMuted adminSmall">{formatTs(r.createdAt)}</div>
                        </div>
                        <div className="adminMuted adminSmall">Reporter: {r.reporter.displayName} → Reported: {r.reportedUser.displayName}</div>
                        <div className="adminReportMsg">
                          <div className="adminMuted adminSmall">Message ({r.message.type}):</div>
                          <div className="adminMono">{r.message.isDeleted ? '[deleted]' : r.message.content}</div>
                        </div>
                        <div className="adminActions">
                          {!r.resolvedAt && (
                            <button className="adminBtn" onClick={() => void resolveReport(r.id)}>Resolve</button>
                          )}
                          <button
                            className="adminBtn adminBtnBad"
                            onClick={() => {
                              const reason = window.prompt('Ban reason', `Reported: ${r.reason}`) || `Reported: ${r.reason}`;
                              void banUser(r.reportedUser.id, reason);
                            }}
                          >
                            Ban user
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {tab === 'deleted' && (
              <div className="adminCard">
                {deleted.length === 0 ? (
                  <p className="adminMuted">No deleted messages logged.</p>
                ) : (
                  <div className="adminList">
                    {deleted.map((d) => (
                      <div key={d.id} className="adminReport">
                        <div className="adminReportTop">
                          <div className="adminReportTitle">Deleted message</div>
                          <div className="adminMuted adminSmall">{formatTs(d.deletedAt)}</div>
                        </div>
                        <div className="adminMuted adminSmall">Sender: {d.sender.displayName} | Deleted by: {d.deletedBy}</div>
                        {d.reason && <div className="adminMuted adminSmall">Reason: {d.reason}</div>}
                        <div className="adminReportMsg">
                          <div className="adminMono">{d.originalContent}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {tab === 'feedback' && (
              <div className="adminCard">
                {feedback.length === 0 ? (
                  <p className="adminMuted">No feedback submitted yet.</p>
                ) : (
                  <div className="adminList">
                    {feedback.map((f) => (
                      <div key={f.id} className="adminReport">
                        <div className="adminReportTop">
                          <div className="adminReportTitle">
                            {f.type === 'bug' ? '🐛 Bug Report' : f.type === 'feature' ? '✨ Feature Request' : '💬 Feedback'}
                          </div>
                          <div className="adminMuted adminSmall">{new Date(f.createdAt).toLocaleString()}</div>
                        </div>
                        <div className="adminMuted adminSmall">From: {f.displayName}</div>
                        <div className="adminReportMsg">
                          <div className="adminMono">{f.content}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {tab === 'unban-requests' && (
              <div className="adminCard">
                {unbanRequests.length === 0 ? (
                  <p className="adminMuted">No unban requests.</p>
                ) : (
                  <div className="adminList">
                    {unbanRequests.map((r) => (
                      <div key={r.id} className="adminReport">
                        <div className="adminReportTop">
                          <div className="adminReportTitle">Unban Request</div>
                          <div className="adminMuted adminSmall">{formatTs(r.createdAt)}</div>
                        </div>
                        <div className="adminMuted adminSmall">From: {r.displayName}</div>
                        <div className="adminReportMsg">
                          <div className="adminMono">{r.message}</div>
                        </div>
                        {r.resolvedAt ? (
                          <div className="adminMuted adminSmall">Resolved by {r.resolvedBy} at {formatTs(r.resolvedAt)}</div>
                        ) : (
                          <div className="adminActions">
                            <button 
                              className="adminActionBtn success" 
                              onClick={async () => {
                                await api(`/admin/unban-requests/${r.id}/approve`, { token, method: 'POST' });
                                await load();
                              }}
                            >
                              Approve & Unban
                            </button>
                            <button 
                              className="adminActionBtn danger" 
                              onClick={async () => {
                                await api(`/admin/unban-requests/${r.id}/deny`, { token, method: 'POST' });
                                await load();
                              }}
                            >
                              Deny
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
