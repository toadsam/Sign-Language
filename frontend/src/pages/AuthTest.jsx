import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

const TOKEN_KEY = 'wow_auth_token';

function parseErrorMessage(data, fallback) {
  if (!data) return fallback;
  if (typeof data.message === 'string' && data.message.trim()) return data.message;
  if (typeof data.error === 'string' && data.error.trim()) return data.error;
  return fallback;
}

export default function AuthTest() {
  const [username, setUsername] = useState('tester');
  const [password, setPassword] = useState('password123');
  const [displayName, setDisplayName] = useState('테스트유저');
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || '');
  const [me, setMe] = useState(null);
  const [result, setResult] = useState('API 호출 결과가 여기에 표시됩니다.');
  const [loading, setLoading] = useState(false);

  const tokenPreview = useMemo(() => {
    if (!token) return '없음';
    if (token.length < 24) return token;
    return `${token.slice(0, 12)}...${token.slice(-8)}`;
  }, [token]);

  const callApi = async (path, options = {}) => {
    setLoading(true);
    try {
      const response = await fetch(path, {
        headers: {
          Accept: 'application/json',
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
          ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
          ...(options.headers || {}),
        },
        method: options.method || 'GET',
        body: options.body ? JSON.stringify(options.body) : undefined,
      });

      let data = null;
      try {
        data = await response.json();
      } catch {
        data = null;
      }

      if (!response.ok) {
        throw new Error(parseErrorMessage(data, `Request failed: ${response.status}`));
      }
      return data;
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    try {
      const data = await callApi('/api/auth/register', {
        method: 'POST',
        body: { username, password, displayName },
      });
      setToken(data.token || '');
      if (data.token) localStorage.setItem(TOKEN_KEY, data.token);
      setResult(JSON.stringify(data, null, 2));
    } catch (error) {
      setResult(`register error: ${error.message}`);
    }
  };

  const handleLogin = async () => {
    try {
      const data = await callApi('/api/auth/login', {
        method: 'POST',
        body: { username, password },
      });
      setToken(data.token || '');
      if (data.token) localStorage.setItem(TOKEN_KEY, data.token);
      setResult(JSON.stringify(data, null, 2));
    } catch (error) {
      setResult(`login error: ${error.message}`);
    }
  };

  const handleMe = async () => {
    try {
      const data = await callApi('/api/auth/me', { token });
      setMe(data);
      setResult(JSON.stringify(data, null, 2));
    } catch (error) {
      setResult(`me error: ${error.message}`);
    }
  };

  const handleLogout = async () => {
    try {
      const data = await callApi('/api/auth/logout', {
        method: 'POST',
        token,
      });
      setMe(null);
      setToken('');
      localStorage.removeItem(TOKEN_KEY);
      setResult(JSON.stringify(data, null, 2));
    } catch (error) {
      setResult(`logout error: ${error.message}`);
    }
  };

  return (
    <div className="auth-page">
      <div className="bg-orb orb-1" />
      <div className="bg-orb orb-2" />
      <div className="grid-overlay" />

      <header className="auth-header">
        <div>
          <p className="eyebrow">AUTH API TEST</p>
          <h1>로그인 API 테스트</h1>
          <p className="subtitle">회원가입, 로그인, 내 정보 조회, 로그아웃을 한 페이지에서 확인합니다.</p>
        </div>
        <Link className="ghost" to="/">
          홈으로
        </Link>
      </header>

      <main className="auth-grid">
        <section className="auth-card">
          <h2>계정 입력</h2>
          <label htmlFor="username">Username</label>
          <input
            id="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="username"
          />

          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="password (8자 이상)"
          />

          <label htmlFor="displayName">Display Name</label>
          <input
            id="displayName"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="표시 이름"
          />

          <div className="auth-actions">
            <button className="primary" type="button" onClick={handleRegister} disabled={loading}>
              회원가입
            </button>
            <button className="ghost" type="button" onClick={handleLogin} disabled={loading}>
              로그인
            </button>
          </div>
        </section>

        <section className="auth-card">
          <h2>토큰 / 세션</h2>
          <p className="auth-token-label">Current Token</p>
          <code className="auth-token-value">{tokenPreview}</code>

          <label htmlFor="token">Token 직접 입력</label>
          <input
            id="token"
            value={token}
            onChange={(e) => {
              setToken(e.target.value);
              if (e.target.value) {
                localStorage.setItem(TOKEN_KEY, e.target.value);
              } else {
                localStorage.removeItem(TOKEN_KEY);
              }
            }}
            placeholder="Bearer 토큰 값"
          />

          <div className="auth-actions">
            <button className="primary" type="button" onClick={handleMe} disabled={loading}>
              내 정보 조회
            </button>
            <button className="ghost" type="button" onClick={handleLogout} disabled={loading}>
              로그아웃
            </button>
          </div>

          <div className="auth-me-box">
            <p className="metric-title">현재 사용자</p>
            <p className="metric-value">{me ? `${me.displayName} (${me.username})` : '로그인 정보 없음'}</p>
          </div>
        </section>
      </main>

      <section className="auth-result">
        <h2>응답 결과</h2>
        <pre>{result}</pre>
      </section>
    </div>
  );
}
