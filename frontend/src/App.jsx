import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet } from './api/client.js';

export default function App() {
  const [health, setHealth] = useState('loading');

  useEffect(() => {
    apiGet('/api/health')
      .then((data) => setHealth(data.status))
      .catch(() => setHealth('offline'));
  }, []);

  return (
    <div className="app">
      <div className="bg-orb orb-1" />
      <div className="bg-orb orb-2" />
      <div className="grid-overlay" />

      <header className="nav">
        <div className="logo">
          <span className="logo-mark" />
          <span>Whims of Wonder</span>
        </div>
        <div className="nav-actions">
          <Link className="ghost" to="/auth-test">
            Auth 테스트
          </Link>
          <Link className="ghost" to="/jjhtest">
            데모 보기
          </Link>
          <button className="primary">시작하기</button>
        </div>
      </header>

      <main className="hero">
        <div className="hero-text">
          <p className="eyebrow">Sign Language Learning</p>
          <h1>
            수어를 <span>읽는 감각</span>을 키우는
            <br />
            몰입형 퀴즈 스튜디오
          </h1>
          <p className="subtitle">
            아바타가 보여주는 동작을 보고, 의미를 바로 입력해 보세요.
            반복 학습으로 수어와 뜻을 자연스럽게 연결합니다.
          </p>
          <div className="hero-actions">
            <button className="primary">퀴즈 시작</button>
            <button className="ghost">표현 검색</button>
          </div>
          <div className="status-pill">
            <span className={`dot ${health}`} />
            Backend: {health}
          </div>
        </div>

        <div className="hero-card">
          <div className="card-header">
            <h2>오늘의 퀴즈</h2>
            <span className="badge">Level 1</span>
          </div>
          <div className="avatar-stage">
            <div className="avatar">
              <div className="avatar-ring" />
              <div className="avatar-core">🤟</div>
            </div>
            <div className="prompt">
              <span>아바타가 표현하는 뜻은?</span>
              <strong>“감사합니다”</strong>
            </div>
          </div>
          <div className="input-row">
            <input placeholder="한글 또는 영어로 입력" />
            <button className="primary">확인</button>
          </div>
          <div className="card-footer">
            <div>
              <p className="metric-title">연속 정답</p>
              <p className="metric-value">7</p>
            </div>
            <div>
              <p className="metric-title">오늘 학습</p>
              <p className="metric-value">12 단어</p>
            </div>
            <div>
              <p className="metric-title">이번 주 목표</p>
              <p className="metric-value">65%</p>
            </div>
          </div>
        </div>
      </main>

      <section className="features">
        <div className="feature">
          <h3>퀴즈형 반복 학습</h3>
          <p>아바타 동작을 보고 바로 뜻을 입력하며 기억을 강화합니다.</p>
        </div>
        <div className="feature">
          <h3>표현 즉시 변환</h3>
          <p>한글/영어 문장을 수어 동작으로 바꿔 확인합니다.</p>
        </div>
        <div className="feature">
          <h3>일상에서 바로 활용</h3>
          <p>복잡한 장비 없이도 빠르게 수어를 확인하고 연습합니다.</p>
        </div>
      </section>
    </div>
  );
}
