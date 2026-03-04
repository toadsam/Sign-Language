export type ChoiceId = 'A' | 'B' | 'C' | 'D';

export type QuizSessionQuestion = {
  quizId: string;
  questionText: string;
  choices: string[];
  videoUrl: string;
  level: number;
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

function getBaseUrl() {
  return process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:8080';
}

export async function fetchQuizSession(count = 10): Promise<QuizSessionResponse> {
  const response = await fetch(`${getBaseUrl()}/api/quiz/session?count=${count}`);
  if (!response.ok) {
    throw new Error(`Failed to load quiz session: ${response.status}`);
  }
  return response.json() as Promise<QuizSessionResponse>;
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
