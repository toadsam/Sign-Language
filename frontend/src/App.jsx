import { useEffect, useState } from 'react';
import { apiGet } from './api/client.js';

export default function App() {
  const [health, setHealth] = useState('loading');

  useEffect(() => {
    apiGet('/api/health')
      .then((data) => setHealth(data.status))
      .catch(() => setHealth('offline'));
  }, []);

  return (
    <main className="page">
      <header className="hero">
        <p className="eyebrow">Sign Language Learning</p>
        <h1>수어를 읽고 이해하는 감각을 키우는 퀴즈형 학습</h1>
        <p className="subtitle">
          아바타 동작을 보고 의미를 입력하며 반복 학습하는 경험을 제공합니다.
        </p>
      </header>

      <section className="card">
        <h2>Backend 상태</h2>
        <p className="status">{health}</p>
      </section>
    </main>
  );
}
