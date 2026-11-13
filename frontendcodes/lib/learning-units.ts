import type { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';

export type LearningUnit = {
  key: string;
  title: string;
  icon: ComponentProps<typeof Ionicons>['name'];
};

/**
 * 벌집 지도에 놓는 단원 목록.
 * 아직 백엔드에 단원 개념이 없어서 앱 안에 둔 임시 목록이다.
 * 단원별 진도 대신 "퀴즈 QUIZZES_PER_CELL 문제마다 한 칸"으로 채운다.
 */
export const LEARNING_UNITS: LearningUnit[] = [
  { key: 'greeting', title: '인사', icon: 'hand-left' },
  { key: 'family', title: '가족', icon: 'people' },
  { key: 'food', title: '음식', icon: 'restaurant' },
  { key: 'feeling', title: '감정', icon: 'heart' },
  { key: 'place', title: '장소', icon: 'location' },
  { key: 'weather', title: '날씨', icon: 'partly-sunny' },
  { key: 'school', title: '학교', icon: 'school' },
  { key: 'hospital', title: '병원', icon: 'medkit' },
];

export const QUIZZES_PER_CELL = 10;

export function getCompletedCells(totalSolved: number): number {
  return Math.min(Math.floor(Math.max(totalSolved, 0) / QUIZZES_PER_CELL), LEARNING_UNITS.length);
}
