import { getBaseUrl, resolveBackendUrl } from './base-url';

export type ChoiceId = 'A' | 'B' | 'C' | 'D';

export type QuizSessionQuestion = {
  quizId: string;
  questionText: string;
  choices: string[];
  videoUrl: string;
  level: number;
  attemptCount?: number | null;
  correctCount?: number | null;
  correctRate?: number | null;
  difficultyLevel?: string | null;
};

export type QuizSessionResponse = {
  count: number;
  questions: QuizSessionQuestion[];
};

export type QuizAnswerResponse = {
  quizId: string;
  selectedChoiceId: ChoiceId;
  isCorrect: boolean;
  correctChoiceId: ChoiceId;
  correctChoiceText: string;
};

export async function fetchQuizSession(count = 10, category?: string): Promise<QuizSessionResponse> {
  const params = new URLSearchParams({ count: String(count) });
  if (category?.trim()) {
    params.set('category', category.trim());
  }
  const response = await fetch(`${getBaseUrl()}/api/quiz/session?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Failed to load quiz session: ${response.status}`);
  }
  const data = (await response.json()) as QuizSessionResponse;
  return {
    ...data,
    questions: (data.questions ?? []).map((question) => ({
      ...question,
      videoUrl: resolveBackendUrl(question.videoUrl),
    })),
  };
}

export async function fetchWrongQuizSession(uid: string, count = 10): Promise<QuizSessionResponse> {
  const response = await fetch(
    `${getBaseUrl()}/api/quiz/session/wrong?uid=${encodeURIComponent(uid)}&count=${count}`
  );
  if (!response.ok) {
    throw new Error(`Failed to load wrong-only quiz session: ${response.status}`);
  }
  const data = (await response.json()) as QuizSessionResponse;
  return {
    ...data,
    questions: (data.questions ?? []).map((question) => ({
      ...question,
      videoUrl: resolveBackendUrl(question.videoUrl),
    })),
  };
}

export async function submitQuizAnswer(
  quizId: string,
  selectedChoiceId: ChoiceId
): Promise<QuizAnswerResponse> {
  const response = await fetch(`${getBaseUrl()}/api/quiz/answer`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ quizId, selectedChoiceId }),
  });

  if (!response.ok) {
    throw new Error(`Failed to submit answer: ${response.status}`);
  }

  return response.json() as Promise<QuizAnswerResponse>;
}
