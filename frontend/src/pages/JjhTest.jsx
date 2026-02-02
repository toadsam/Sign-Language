import { useMemo, useState } from 'react';

const QUESTIONS = [
  {
    id: 'q1',
    prompt: '영상 속 수어의 의미를 선택하세요.',
    videoSrc: '/videos/수어지교시연영상.mp4',
    options: [
      { id: 'o1', label: '안녕하세요', correct: false },
      { id: 'o2', label: '감사합니다', correct: true },
      { id: 'o3', label: '미안합니다', correct: false },
      { id: 'o4', label: '괜찮아요', correct: false },
    ],
  },
];

export default function JjhTest() {
  const [selectedId, setSelectedId] = useState(null);
  const [isCorrect, setIsCorrect] = useState(null);
  const [pulseKey, setPulseKey] = useState(0);
  const question = useMemo(() => QUESTIONS[0], []);

  const handleSelect = (option) => {
    setSelectedId(option.id);
    setIsCorrect(option.correct);
    setPulseKey((prev) => prev + 1);
  };

  const reset = () => {
    setSelectedId(null);
    setIsCorrect(null);
  };

  return (
    <div className="jjh-page">
      <div className="bg-orb orb-1" />
      <div className="bg-orb orb-2" />
      <div className="grid-overlay" />

      <header className="jjh-header">
        <div>
          <p className="eyebrow">JJH TEST</p>
          <h1>수어 임시 퀴즈</h1>
          <p className="subtitle">
            영상 시청 후 아래 선택지에서 문장/단어를 골라주세요.
          </p>
        </div>
        <button className="ghost" type="button" onClick={reset}>
          다시 선택
        </button>
      </header>

      <main className="jjh-main">
        <section className="jjh-video-card">
          <div className="jjh-video-frame">
            <video
              className="jjh-video"
              src={question.videoSrc}
              controls
              playsInline
            />
          </div>
          <p className="jjh-prompt">{question.prompt}</p>
        </section>

        <section className="jjh-options">
          {question.options.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => handleSelect(option)}
              className={`jjh-option ${
                selectedId === option.id ? 'selected' : ''
              }`}
            >
              {option.label}
            </button>
          ))}
        </section>

        <section
          className={`jjh-result ${
            isCorrect === true ? 'ok' : isCorrect === false ? 'wrong' : ''
          }`}
          aria-live="polite"
          key={pulseKey}
        >
          {isCorrect === null && (
            <span className="jjh-result-text">선택지를 눌러주세요.</span>
          )}
          {isCorrect === true && (
            <span className="jjh-result-text ok">맞았습니다!</span>
          )}
          {isCorrect === false && (
            <span className="jjh-result-text wrong">틀렸습니다.</span>
          )}
        </section>
      </main>
    </div>
  );
}
